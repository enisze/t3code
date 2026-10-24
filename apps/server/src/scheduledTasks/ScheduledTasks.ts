import * as NodeCrypto from "node:crypto";

import {
  automationMessageId,
  CommandId,
  DEFAULT_WEBHOOK_COALESCE_SECONDS,
  type OrchestrationThreadShell,
  ScheduledTask,
  ScheduledTaskError,
  ScheduledTaskInput,
  ScheduledTaskRun,
  ThreadTurnStartCommand,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { forkParked } from "../serverActivation.ts";
import { ServerRuntimeStartup } from "../serverRuntimeStartup.ts";
import { isSameSchedule, mergeWebhookSchedule, nextScheduledRunAt } from "./Schedule.ts";
import {
  failedWebhookFilter,
  renderWebhookKey,
  renderWebhookPrompt,
  type WebhookRequest,
} from "./webhookTemplate.ts";

interface TaskRow {
  readonly id: string;
  readonly config_json: string;
  readonly enabled: number;
  readonly next_run_at: string | null;
  readonly webhook_token_hash: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}
interface RunRow {
  readonly id: string;
  readonly task_id: string;
  readonly trigger: ScheduledTaskRun["trigger"];
  readonly status: ScheduledTaskRun["status"];
  readonly command_json: string | null;
  readonly created_at: string;
  readonly finished_at: string | null;
  readonly error: string | null;
  readonly due_at: string | null;
  readonly prompt_text: string | null;
}

/** How a webhook delivery was handled, for the HTTP response. */
export type WebhookDelivery =
  | { readonly outcome: "filtered"; readonly reason: string }
  | { readonly outcome: "run" | "coalesced"; readonly run: ScheduledTaskRun };

/** Deliveries that join an open window per automation per minute. */
const WEBHOOK_JOINS_PER_MINUTE = 60;

const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(ScheduledTaskInput));
const validateInput = Schema.decodeUnknownEffect(ScheduledTaskInput);
const isScheduledTaskError = Schema.is(ScheduledTaskError);
const decodeCommand = Schema.decodeUnknownEffect(Schema.fromJsonString(ThreadTurnStartCommand));
const encodeCommand = Schema.encodeEffect(Schema.fromJsonString(ThreadTurnStartCommand));
const encodeConfig = Schema.encodeEffect(Schema.fromJsonString(ScheduledTaskInput));
const tokenHash = (token: string) => NodeCrypto.createHash("sha256").update(token).digest("hex");
const secretMatches = (token: string, hash: string) => {
  const actual = Buffer.from(tokenHash(token), "hex");
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && NodeCrypto.timingSafeEqual(actual, expected);
};
const failure = (reason: ScheduledTaskError["reason"], message: string) =>
  new ScheduledTaskError({ reason, message });
const runView = (row: RunRow): ScheduledTaskRun => ({
  id: row.id,
  taskId: row.task_id,
  trigger: row.trigger,
  status: row.status,
  createdAt: row.created_at,
  finishedAt: row.finished_at,
  error: row.error,
  ...(row.due_at === null ? {} : { dueAt: row.due_at }),
});
// Busy threads are skipped rather than interrupting work or accumulating prompts.
const isBusy = (thread: OrchestrationThreadShell) =>
  thread.session?.status === "running" ||
  thread.session?.status === "starting" ||
  thread.hasPendingApprovals ||
  thread.hasPendingUserInput;
const BUSY_ERROR = "The thread is busy or waiting for input.";
const turnCommand = (
  runId: string,
  text: string,
  thread: OrchestrationThreadShell,
  now: string,
): typeof ThreadTurnStartCommand.Type => ({
  type: "thread.turn.start",
  commandId: CommandId.make(`automation:${runId}`),
  threadId: thread.id,
  message: {
    messageId: automationMessageId(runId),
    role: "user",
    text,
    attachments: [],
  },
  modelSelection: thread.modelSelection,
  runtimeMode: thread.runtimeMode,
  interactionMode: thread.interactionMode,
  createdAt: now,
});
const renderPrompt = (prompt: string, request: WebhookRequest) =>
  Effect.try({
    try: () => renderWebhookPrompt(prompt, request),
    catch: () => failure("invalid", "The expanded webhook prompt exceeds 128 KiB."),
  });
const failureText = (cause: unknown) =>
  (cause instanceof Error ? cause.message : "The turn could not be started.").slice(0, 1_000);

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const engine = yield* OrchestrationEngineService;
  const projections = yield* ProjectionSnapshotQuery;
  // A single writer owns both claiming due work and dispatching the outbox.
  const mutex = yield* Semaphore.make(1);
  const protect = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catch((error) =>
        isScheduledTaskError(error)
          ? Effect.fail(error)
          : Effect.logError("Automation operation failed", error).pipe(
              Effect.andThen(Effect.fail(failure("internal", "The automation operation failed."))),
            ),
      ),
    );
  const locked = <A, E, R>(effect: Effect.Effect<A, E, R>) => protect(mutex.withPermits(1)(effect));
  const taskRow = Effect.fnUntraced(function* (id: string) {
    const rows = yield* sql<TaskRow>`SELECT * FROM scheduled_tasks WHERE id = ${id}`;
    if (!rows[0]) return yield* failure("not_found", "Automation not found.");
    return rows[0];
  });
  const taskView = Effect.fnUntraced(function* (row: TaskRow, lastRun?: RunRow | null) {
    const config = yield* decodeConfig(row.config_json);
    const run =
      lastRun !== undefined
        ? lastRun
        : ((yield* sql<RunRow>`SELECT * FROM scheduled_task_runs WHERE task_id = ${row.id} ORDER BY created_at DESC, rowid DESC LIMIT 1`)[0] ??
          null);
    return {
      ...config,
      id: row.id,
      enabled: row.enabled === 1,
      nextRunAt: row.next_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastRun: run === null ? null : runView(run),
    } satisfies ScheduledTask;
  });
  const activeThread = Effect.fnUntraced(function* (threadId: ScheduledTaskInput["threadId"]) {
    const thread = yield* projections.getThreadShellById(threadId);
    if (Option.isNone(thread) || thread.value.archivedAt !== null) {
      return yield* failure("invalid", "Choose an active thread in this environment.");
    }
    return thread.value;
  });
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const cancelPending = Effect.fnUntraced(function* (taskId: string) {
    yield* sql`UPDATE scheduled_task_runs SET status = 'skipped', command_json = NULL,
      due_at = NULL, prompt_text = NULL,
      finished_at = ${yield* nowIso}, error = 'Automation paused before dispatch.'
      WHERE task_id = ${taskId} AND status = 'pending'`;
  });
  const pruneRuns = (taskId: string) => sql`
    DELETE FROM scheduled_task_runs WHERE task_id = ${taskId} AND status <> 'pending'
      AND id NOT IN (SELECT id FROM scheduled_task_runs WHERE task_id = ${taskId} ORDER BY created_at DESC, rowid DESC LIMIT 50)
  `;
  const enqueue = Effect.fnUntraced(function* (
    row: TaskRow,
    trigger: ScheduledTaskRun["trigger"],
    now: string,
    request?: WebhookRequest,
    deliveryId?: string,
  ) {
    if (deliveryId !== undefined) {
      const previous =
        yield* sql<RunRow>`SELECT * FROM scheduled_task_runs WHERE task_id = ${row.id} AND delivery_id = ${deliveryId}`;
      if (previous[0]) return runView(previous[0]);
    }
    const config = yield* decodeConfig(row.config_json);
    const id = NodeCrypto.randomUUID();
    const thread = yield* activeThread(config.threadId);
    const busy = isBusy(thread);
    const text =
      trigger === "webhook" && request !== undefined
        ? yield* renderPrompt(config.prompt, request)
        : config.prompt;
    const status = busy ? "skipped" : "pending";
    const error = busy ? BUSY_ERROR : null;
    yield* sql`INSERT INTO scheduled_task_runs (id, task_id, trigger, status, delivery_id, command_json, created_at, finished_at, error)
      VALUES (${id}, ${row.id}, ${trigger}, ${status}, ${deliveryId ?? null}, ${busy ? null : yield* encodeCommand(turnCommand(id, text, thread, now))}, ${now}, ${busy ? now : null}, ${error})`;
    yield* pruneRuns(row.id);
    return {
      id,
      taskId: row.id,
      trigger,
      status,
      createdAt: now,
      finishedAt: busy ? now : null,
      error,
    } satisfies ScheduledTaskRun;
  });
  // A window closes at its deadline: its latest prompt becomes a durable command
  // for the drain below, or the run is skipped when the thread is busy.
  const closeDueWindows = Effect.fnUntraced(function* (now: string, taskId?: string) {
    const due =
      taskId === undefined
        ? yield* sql<RunRow>`SELECT * FROM scheduled_task_runs WHERE status = 'pending' AND due_at IS NOT NULL AND due_at <= ${now} ORDER BY due_at, rowid`
        : yield* sql<RunRow>`SELECT * FROM scheduled_task_runs WHERE task_id = ${taskId} AND status = 'pending' AND due_at IS NOT NULL AND due_at <= ${now} ORDER BY due_at, rowid`;
    for (const run of due) {
      const task = yield* taskRow(run.task_id);
      if (task.enabled === 0) {
        yield* cancelPending(run.task_id);
        continue;
      }
      const closed = yield* Effect.result(
        Effect.gen(function* () {
          const config = yield* decodeConfig(task.config_json);
          const thread = yield* activeThread(config.threadId);
          if (run.prompt_text === null)
            return yield* failure("internal", "Missing saved webhook prompt.");
          if (isBusy(thread)) return null;
          return yield* encodeCommand(turnCommand(run.id, run.prompt_text, thread, now));
        }),
      );
      if (closed._tag === "Success" && closed.success !== null) {
        yield* sql`UPDATE scheduled_task_runs SET command_json = ${closed.success}, due_at = NULL, prompt_text = NULL WHERE id = ${run.id}`;
      } else {
        const skipped = closed._tag === "Success";
        yield* sql`UPDATE scheduled_task_runs SET status = ${skipped ? "skipped" : "failed"}, due_at = NULL, prompt_text = NULL,
          finished_at = ${now}, error = ${skipped ? BUSY_ERROR : failureText(closed.failure)} WHERE id = ${run.id}`;
      }
    }
  });
  // The exact command is durable before dispatch. Recovery reuses its command ID,
  // letting the orchestration receipt deduplicate a crash after acceptance.
  const drainUnlocked = Effect.gen(function* () {
    for (;;) {
      // Open windows wait for closeDueWindows.
      const pending =
        yield* sql<RunRow>`SELECT * FROM scheduled_task_runs WHERE status = 'pending' AND due_at IS NULL ORDER BY created_at, rowid LIMIT 25`;
      if (pending.length === 0) break;
      for (const row of pending) {
        const task = yield* taskRow(row.task_id);
        if (task.enabled === 0 && row.trigger !== "manual") {
          yield* cancelPending(row.task_id);
          continue;
        }
        const result = yield* Effect.result(
          Effect.gen(function* () {
            if (row.command_json === null)
              return yield* failure("internal", "Missing saved automation command.");
            const command = yield* decodeCommand(row.command_json);
            yield* engine.dispatch(command);
          }),
        );
        const finishedAt = yield* nowIso;
        const error = result._tag === "Failure" ? failureText(result.failure) : null;
        yield* sql`UPDATE scheduled_task_runs SET status = ${error === null ? "started" : "failed"}, finished_at = ${finishedAt}, error = ${error}, command_json = NULL WHERE id = ${row.id}`;
      }
    }
  });

  const list = () =>
    protect(
      Effect.gen(function* () {
        const rows = yield* sql<TaskRow>`SELECT * FROM scheduled_tasks ORDER BY created_at, id`;
        const lastRuns =
          yield* sql<RunRow>`SELECT r.id, r.task_id, r.trigger, r.status, NULL AS command_json, r.created_at, r.finished_at, r.error, r.due_at, NULL AS prompt_text
      FROM scheduled_task_runs r WHERE r.id IN (
        SELECT (SELECT id FROM scheduled_task_runs WHERE task_id = t.id ORDER BY created_at DESC, rowid DESC LIMIT 1) FROM scheduled_tasks t
      )`;
        const byTask = new Map(lastRuns.map((run) => [run.task_id, run]));
        return yield* Effect.forEach(rows, (row) => taskView(row, byTask.get(row.id) ?? null));
      }),
    );
  const save = (input: ScheduledTaskInput) =>
    locked(
      Effect.gen(function* () {
        const validated = yield* validateInput(input).pipe(
          Effect.mapError(() =>
            failure("invalid", "Check the automation name, prompt, and schedule."),
          ),
        );
        const previous = validated.id === undefined ? null : yield* taskRow(validated.id);
        const oldConfig = previous === null ? null : yield* decodeConfig(previous.config_json);
        const config =
          validated.schedule.type === "webhook"
            ? {
                ...validated,
                schedule: mergeWebhookSchedule(validated.schedule, oldConfig?.schedule ?? null),
              }
            : validated;
        yield* activeThread(config.threadId);
        if (config.schedule.type === "fixed_time") {
          const zone = DateTime.zoneMakeNamed(config.schedule.timeZone);
          if (Option.isNone(zone))
            return yield* failure("invalid", "Choose a valid IANA time zone.");
        }
        if (previous === null) {
          const count = yield* sql<{
            readonly total: number;
          }>`SELECT count(*) AS total FROM scheduled_tasks`;
          if ((count[0]?.total ?? 0) >= 500)
            return yield* failure("invalid", "This environment already has 500 automations.");
        }
        const now = yield* DateTime.now;
        const nowText = DateTime.formatIso(now);
        const id = previous?.id ?? NodeCrypto.randomUUID();
        const unchanged =
          previous !== null &&
          previous.enabled === 1 &&
          oldConfig !== null &&
          isSameSchedule(oldConfig.schedule, config.schedule);
        const nextRun = !config.enabled
          ? null
          : unchanged
            ? previous.next_run_at
            : nextScheduledRunAt(config.schedule, now);
        const needsToken =
          config.schedule.type === "webhook" && (previous?.webhook_token_hash ?? null) === null;
        const token = needsToken ? NodeCrypto.randomBytes(32).toString("base64url") : null;
        const hash =
          config.schedule.type === "webhook"
            ? token === null
              ? (previous?.webhook_token_hash ?? null)
              : tokenHash(token)
            : null;
        yield* sql`INSERT INTO scheduled_tasks (id, config_json, enabled, next_run_at, webhook_token_hash, created_at, updated_at)
      VALUES (${id}, ${yield* encodeConfig({ ...config, id })}, ${config.enabled ? 1 : 0}, ${nextRun}, ${hash}, ${previous?.created_at ?? nowText}, ${nowText})
      ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json, enabled = excluded.enabled, next_run_at = excluded.next_run_at, webhook_token_hash = excluded.webhook_token_hash, updated_at = excluded.updated_at`;
        if (!config.enabled) yield* cancelPending(id);
        return {
          task: yield* taskView(yield* taskRow(id)),
          ...(token === null ? {} : { webhookPath: `/api/hooks/${id}/${token}` }),
        };
      }),
    );
  const remove = (id: string) =>
    locked(
      Effect.gen(function* () {
        yield* taskRow(id);
        yield* sql`DELETE FROM scheduled_tasks WHERE id = ${id}`;
      }),
    );
  const setEnabled = (id: string, enabled: boolean) =>
    locked(
      Effect.gen(function* () {
        const row = yield* taskRow(id);
        const config = yield* decodeConfig(row.config_json);
        const now = yield* DateTime.now;
        const next = enabled
          ? row.enabled === 1
            ? row.next_run_at
            : nextScheduledRunAt(config.schedule, now)
          : null;
        yield* sql`UPDATE scheduled_tasks SET enabled = ${enabled ? 1 : 0}, next_run_at = ${next}, updated_at = ${DateTime.formatIso(now)} WHERE id = ${id}`;
        if (!enabled) yield* cancelPending(id);
        return yield* taskView(yield* taskRow(id));
      }),
    );
  const history = (id: string) =>
    protect(
      Effect.gen(function* () {
        yield* taskRow(id);
        return (yield* sql<RunRow>`SELECT * FROM scheduled_task_runs WHERE task_id = ${id} ORDER BY created_at DESC, rowid DESC LIMIT 50`).map(
          runView,
        );
      }),
    );
  const runNow = (id: string) =>
    locked(
      Effect.gen(function* () {
        const row = yield* taskRow(id);
        const run = yield* enqueue(row, "manual", yield* nowIso);
        yield* drainUnlocked;
        const rows = yield* sql<RunRow>`SELECT * FROM scheduled_task_runs WHERE id = ${run.id}`;
        return runView(rows[0]!);
      }),
    );
  const rotateWebhook = (id: string) =>
    locked(
      Effect.gen(function* () {
        const row = yield* taskRow(id);
        if ((yield* decodeConfig(row.config_json)).schedule.type !== "webhook")
          return yield* failure("invalid", "This automation does not use a webhook.");
        const token = NodeCrypto.randomBytes(32).toString("base64url");
        yield* sql`UPDATE scheduled_tasks SET webhook_token_hash = ${tokenHash(token)}, updated_at = ${yield* nowIso} WHERE id = ${id}`;
        return { webhookPath: `/api/hooks/${id}/${token}` };
      }),
    );
  const tooManyDeliveries = () =>
    failure("rate_limited", "Too many webhook deliveries. Try again in a minute.");
  const triggerWebhook = (
    id: string,
    token: string,
    request: WebhookRequest,
    deliveryId?: string,
  ): Effect.Effect<WebhookDelivery, ScheduledTaskError> =>
    locked(
      Effect.gen(function* () {
        const rows = yield* sql<TaskRow>`SELECT * FROM scheduled_tasks WHERE id = ${id}`;
        const row = rows[0];
        if (
          !row?.webhook_token_hash ||
          token.length > 128 ||
          !secretMatches(token, row.webhook_token_hash)
        )
          return yield* failure("unauthorized", "Webhook not found.");
        if (row.enabled !== 1) return yield* failure("disabled", "This automation is paused.");
        if (deliveryId !== undefined && (deliveryId.length === 0 || deliveryId.length > 256))
          return yield* failure("invalid", "Invalid delivery ID.");
        const config = yield* decodeConfig(row.config_json);
        const schedule = config.schedule.type === "webhook" ? config.schedule : undefined;
        // Filtered deliveries write nothing, so they cannot flood history or use the rate budget.
        const filtered = failedWebhookFilter(schedule?.filters ?? [], request);
        if (filtered !== null) return { outcome: "filtered", reason: filtered } as const;
        // Rate limiting and deduplication survive restarts along with delivery history.
        if (deliveryId !== undefined) {
          const previous =
            yield* sql<RunRow>`SELECT * FROM scheduled_task_runs WHERE task_id = ${id} AND delivery_id = ${deliveryId}`;
          if (previous[0]) return { outcome: "run", run: runView(previous[0]) } as const;
          const joined = yield* sql<RunRow>`SELECT r.* FROM scheduled_task_webhook_joins j
            JOIN scheduled_task_runs r ON r.id = j.run_id
            WHERE j.task_id = ${id} AND j.delivery_id = ${deliveryId}`;
          if (joined[0]) return { outcome: "coalesced", run: runView(joined[0]) } as const;
        }
        const now = yield* DateTime.now;
        const nowText = DateTime.formatIso(now);
        const since = DateTime.formatIso(DateTime.subtractDuration(now, 60_000));
        const coalesce = schedule?.coalesce ?? undefined;
        const key = coalesce === undefined ? "" : renderWebhookKey(coalesce.key, request);
        if (key !== "") {
          // A window past its deadline is closed first, so this delivery opens a new one.
          yield* closeDueWindows(nowText, id);
          const open = (yield* sql<RunRow>`SELECT * FROM scheduled_task_runs
            WHERE task_id = ${id} AND coalesce_key = ${key} AND status = 'pending' AND due_at IS NOT NULL`)[0];
          if (open !== undefined) {
            // Joining uses no run budget, but its own bound keeps prompt rewrites in check.
            const joins = yield* sql<{
              readonly total: number;
            }>`SELECT count(*) AS total FROM scheduled_task_webhook_joins WHERE task_id = ${id} AND created_at >= ${since}`;
            if ((joins[0]?.total ?? 0) >= WEBHOOK_JOINS_PER_MINUTE)
              return yield* tooManyDeliveries();
            const text = yield* renderPrompt(config.prompt, request);
            yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`UPDATE scheduled_task_runs SET prompt_text = ${text} WHERE id = ${open.id}`;
                yield* sql`INSERT INTO scheduled_task_webhook_joins (task_id, run_id, delivery_id, created_at)
                  VALUES (${id}, ${open.id}, ${deliveryId ?? null}, ${nowText})`;
              }),
            );
            return { outcome: "coalesced", run: runView(open) } as const;
          }
        }
        const recent = yield* sql<{
          readonly total: number;
        }>`SELECT count(*) AS total FROM scheduled_task_runs WHERE task_id = ${id} AND created_at >= ${since}`;
        if ((recent[0]?.total ?? 0) >= 10) return yield* tooManyDeliveries();
        if (coalesce === undefined || key === "") {
          return {
            outcome: "run",
            run: yield* enqueue(row, "webhook", nowText, request, deliveryId),
          } as const;
        }
        // The deadline counts from the first delivery and does not move.
        yield* activeThread(config.threadId);
        const text = yield* renderPrompt(config.prompt, request);
        const runId = NodeCrypto.randomUUID();
        const dueAt = DateTime.formatIso(
          DateTime.addDuration(
            now,
            (coalesce.windowSeconds ?? DEFAULT_WEBHOOK_COALESCE_SECONDS) * 1000,
          ),
        );
        yield* sql`INSERT INTO scheduled_task_runs (id, task_id, trigger, status, delivery_id, command_json, created_at, finished_at, error, coalesce_key, due_at, prompt_text)
          VALUES (${runId}, ${id}, 'webhook', 'pending', ${deliveryId ?? null}, NULL, ${nowText}, NULL, NULL, ${key}, ${dueAt}, ${text})`;
        yield* pruneRuns(id);
        return {
          outcome: "run",
          run: {
            id: runId,
            taskId: id,
            trigger: "webhook",
            status: "pending",
            createdAt: nowText,
            finishedAt: null,
            error: null,
            dueAt,
          },
        } as const;
      }),
    );
  const tick = locked(
    Effect.gen(function* () {
      // Recover pending dispatches first, including manual and webhook runs.
      yield* closeDueWindows(yield* nowIso);
      yield* drainUnlocked;
      const now = yield* DateTime.now;
      const nowText = DateTime.formatIso(now);
      const due =
        yield* sql<TaskRow>`SELECT * FROM scheduled_tasks WHERE enabled = 1 AND next_run_at <= ${nowText} ORDER BY next_run_at, id`;
      for (const row of due) {
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const config = yield* decodeConfig(row.config_json);
            // Fixed-time work older than ten minutes is skipped after downtime.
            const missed =
              config.schedule.type === "fixed_time" &&
              row.next_run_at !== null &&
              DateTime.toEpochMillis(now) -
                DateTime.toEpochMillis(DateTime.makeUnsafe(row.next_run_at)) >
                600_000;
            if (!missed) {
              yield* enqueue(row, "schedule", nowText).pipe(
                Effect.catch((error) =>
                  isScheduledTaskError(error) && error.reason === "invalid"
                    ? sql`UPDATE scheduled_tasks SET enabled = 0 WHERE id = ${row.id}`.pipe(
                        Effect.asVoid,
                      )
                    : Effect.fail(error),
                ),
              );
            }
            yield* sql`UPDATE scheduled_tasks SET next_run_at = CASE WHEN enabled = 1 THEN ${nextScheduledRunAt(config.schedule, now)} ELSE NULL END WHERE id = ${row.id}`;
          }),
        );
      }
      yield* drainUnlocked;
    }),
  );
  return { list, save, remove, setEnabled, history, runNow, rotateWebhook, triggerWebhook, tick };
});

export class ScheduledTasks extends Context.Service<ScheduledTasks, Effect.Success<typeof make>>()(
  "t3/scheduledTasks/ScheduledTasks",
) {}

export const layer = Layer.effect(
  ScheduledTasks,
  Effect.gen(function* () {
    const service = yield* make;
    const startup = yield* ServerRuntimeStartup;
    yield* forkParked(
      startup.awaitCommandReady.pipe(
        Effect.andThen(
          service.tick.pipe(
            Effect.catchCause((cause) => Effect.logError("Automation worker failed", cause)),
            Effect.repeat(Schedule.spaced("15 seconds")),
          ),
        ),
      ),
    );
    return service;
  }),
);
