import { assert, it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import {
  isAutomationMessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
  type ScheduledTaskInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { HttpRouter } from "effect/unstable/http";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts";
import { make, ScheduledTasks, type WebhookDelivery } from "./ScheduledTasks.ts";
import { webhookRouteLayer } from "./http.ts";

const NOW = "2026-10-23T08:00:00.000Z";
const THREAD_ID = ThreadId.make("automation-thread");
const encodeSavedCommand = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const baseInput = {
  name: "Review changes",
  threadId: THREAD_ID,
  prompt: "Review the current diff",
  enabled: true,
  schedule: { type: "interval", everyMs: 60_000 },
} satisfies ScheduledTaskInput;
const thread: OrchestrationThreadShell = {
  id: THREAD_ID,
  projectId: ProjectId.make("project"),
  title: "Review",
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "claude-sonnet-4-6" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: NOW,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};

const fixture = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM scheduled_tasks`;
  const commands: Array<OrchestrationCommand> = [];
  const accepted = new Map<string, OrchestrationCommand>();
  let currentThread: OrchestrationThreadShell | null = thread;
  let reject = false;
  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: () => Effect.sync(() => Option.fromNullishOr(currentThread)),
    }),
    Layer.mock(OrchestrationEngineService)({
      dispatch: (command) =>
        Effect.gen(function* () {
          commands.push(command);
          if (reject)
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "Provider is unavailable",
            });
          const previous = accepted.get(command.commandId);
          if (previous) expect(command).toEqual(previous);
          else accepted.set(command.commandId, command);
          return { sequence: accepted.size };
        }),
    }),
  );
  const tasks = yield* make.pipe(Effect.provide(dependencies));
  const restart = make.pipe(Effect.provide(dependencies));
  return {
    tasks,
    restart,
    commands,
    accepted,
    setThread: (value: OrchestrationThreadShell | null) => {
      currentThread = value;
    },
    setReject: (value: boolean) => {
      reject = value;
    },
  };
});

const runOf = (delivery: WebhookDelivery) => {
  if (delivery.outcome === "filtered") throw new Error(`Unexpectedly filtered: ${delivery.reason}`);
  return delivery.run;
};
const tokenOf = (saved: { readonly webhookPath?: string }) => saved.webhookPath!.split("/").at(-1)!;
const texts = (commands: ReadonlyArray<OrchestrationCommand>) =>
  commands.map((command) => (command.type === "thread.turn.start" ? command.message.text : null));

const test = it.layer(SqlitePersistenceMemory);
test("persistent automations", (it) => {
  it.effect("persists schedules across service restarts and coalesces missed intervals", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const { tasks, restart, commands } = yield* fixture;
      const { task } = yield* tasks.save(baseInput);
      assert.strictEqual(task.nextRunAt, "2026-10-23T08:01:00.000Z");
      yield* TestClock.adjust("5 minutes");
      const recovered = yield* restart;
      yield* recovered.tick;
      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0]?.type, "thread.turn.start");
      if (commands[0]?.type !== "thread.turn.start") throw new Error("Missing turn");
      expect(commands[0].modelSelection).toEqual(thread.modelSelection);
      assert.strictEqual(commands[0].runtimeMode, "approval-required");
      // Clients fold the prompt by this mark.
      assert.isTrue(isAutomationMessageId(commands[0].message.messageId));
      const listed = yield* recovered.list();
      assert.strictEqual(listed[0]?.nextRunAt, "2026-10-23T08:06:00.000Z");
      assert.strictEqual(listed[0]?.lastRun?.status, "started");
      yield* recovered.tick;
      assert.strictEqual(commands.length, 1);
    }),
  );

  it.effect("preserves the pending time on edits, pauses, resumes, and deletes", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const { tasks, commands } = yield* fixture;
      const { task } = yield* tasks.save(baseInput);
      yield* TestClock.adjust("30 seconds");
      const edited = yield* tasks.save({ ...baseInput, id: task.id, name: "Renamed" });
      assert.strictEqual(edited.task.nextRunAt, task.nextRunAt);
      yield* tasks.setEnabled(task.id, false);
      yield* TestClock.adjust("2 minutes");
      yield* tasks.tick;
      assert.strictEqual(commands.length, 0);
      assert.strictEqual((yield* tasks.list())[0]?.nextRunAt, null);
      yield* tasks.setEnabled(task.id, true);
      assert.strictEqual((yield* tasks.list())[0]?.nextRunAt, "2026-10-23T08:03:30.000Z");
      yield* tasks.runNow(task.id);
      yield* tasks.remove(task.id);
      expect(yield* tasks.list()).toEqual([]);
      const sql = yield* SqlClient.SqlClient;
      expect(yield* sql`SELECT id FROM scheduled_task_runs`).toEqual([]);
    }),
  );

  it.effect(
    "authenticates, deduplicates, and rotates webhook deliveries without leaking tokens",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(NOW));
        const { tasks, restart, commands } = yield* fixture;
        const saved = yield* tasks.save({
          ...baseInput,
          schedule: { type: "webhook" },
          prompt: "Review {{payload}}",
        });
        const token = saved.webhookPath!.split("/").at(-1)!;
        const invalid = yield* Effect.result(
          tasks.triggerWebhook(saved.task.id, "wrong", { body: {} }),
        );
        assert.strictEqual(invalid._tag, "Failure");
        const first = yield* tasks.triggerWebhook(
          saved.task.id,
          token,
          { body: { ref: "main" } },
          "delivery-1",
        );
        const recovered = yield* restart;
        const repeated = yield* recovered.triggerWebhook(
          saved.task.id,
          token,
          { body: { ref: "other" } },
          "delivery-1",
        );
        assert.strictEqual(runOf(first).id, runOf(repeated).id);
        yield* recovered.tick;
        assert.strictEqual(commands.length, 1);
        if (commands[0]?.type !== "thread.turn.start") throw new Error("Missing turn");
        assert.strictEqual(commands[0].message.text, 'Review {\n  "ref": "main"\n}');
        expect(yield* recovered.list()).not.toContainEqual(
          expect.objectContaining({ webhookPath: expect.any(String) }),
        );
        const sql = yield* SqlClient.SqlClient;
        const stored = yield* sql<{
          readonly webhook_token_hash: string;
        }>`SELECT webhook_token_hash FROM scheduled_tasks`;
        expect(stored[0]?.webhook_token_hash).not.toContain(token);
        const rotated = yield* recovered.rotateWebhook(saved.task.id);
        assert.strictEqual(
          (yield* Effect.result(recovered.triggerWebhook(saved.task.id, token, { body: {} })))._tag,
          "Failure",
        );
        yield* recovered.triggerWebhook(saved.task.id, rotated.webhookPath.split("/").at(-1)!, {
          body: {},
        });
        yield* recovered.setEnabled(saved.task.id, false);
        assert.strictEqual(
          (yield* Effect.result(
            recovered.triggerWebhook(saved.task.id, rotated.webhookPath.split("/").at(-1)!, {
              body: {},
            }),
          ))._tag,
          "Failure",
        );
      }),
  );

  it.effect("replays the same saved command after a crash following dispatch acceptance", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const { tasks, restart, accepted, commands } = yield* fixture;
      const { task } = yield* tasks.save(baseInput);
      yield* tasks.runNow(task.id);
      const command = commands[0]!;
      const sql = yield* SqlClient.SqlClient;
      const encoded = yield* encodeSavedCommand(command);
      yield* sql`UPDATE scheduled_task_runs SET status = 'pending', command_json = ${encoded}, finished_at = NULL`;
      const recovered = yield* restart;
      yield* recovered.tick;
      assert.strictEqual(commands.length, 2);
      expect(commands[1]).toEqual(command);
      assert.strictEqual(accepted.size, 1);
      assert.strictEqual((yield* recovered.history(task.id))[0]?.status, "started");
    }),
  );

  it.effect(
    "cancels pending webhook deliveries when paused and allows an explicit manual run",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(NOW));
        const { tasks, commands } = yield* fixture;
        const saved = yield* tasks.save({ ...baseInput, schedule: { type: "webhook" } });
        const token = saved.webhookPath!.split("/").at(-1)!;
        yield* tasks.triggerWebhook(saved.task.id, token, { body: {} }, "delivery");
        yield* tasks.setEnabled(saved.task.id, false);
        yield* tasks.tick;
        assert.strictEqual(commands.length, 0);
        assert.strictEqual((yield* tasks.history(saved.task.id))[0]?.status, "skipped");
        assert.strictEqual((yield* tasks.runNow(saved.task.id)).status, "started");
        assert.strictEqual((yield* tasks.list())[0]?.lastRun?.trigger, "manual");
      }),
  );

  it.effect(
    "handles webhook HTTP requests without a client session and enforces JSON and size limits",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(NOW));
        const { tasks, commands } = yield* fixture;
        const saved = yield* tasks.save({ ...baseInput, schedule: { type: "webhook" } });
        const app = yield* Effect.acquireRelease(
          Effect.sync(() =>
            HttpRouter.toWebHandler(
              webhookRouteLayer.pipe(
                HttpRouter.provideRequest(Layer.succeed(ScheduledTasks, tasks)),
              ),
              { disableLogger: true },
            ),
          ),
          (handler) => Effect.promise(() => handler.dispose()),
        );
        const url = `http://environment.test${saved.webhookPath}`;
        const post = (target: string, body: string, headers?: Record<string, string>) =>
          Effect.promise(() => app.handler(new Request(target, { method: "POST", body, headers })));
        const accepted = yield* post(url, '{"ref":"main"}', { "x-github-delivery": "delivery" });
        assert.strictEqual(accepted.status, 202);
        const body = yield* Effect.promise(() => accepted.json());
        const duplicate = yield* post(url, '{"ref":"other"}', { "x-github-delivery": "delivery" });
        expect(yield* Effect.promise(() => duplicate.json())).toEqual(body);
        assert.strictEqual((yield* post(url, "{bad json")).status, 400);
        assert.strictEqual((yield* post(url, "{}", { "content-length": "65537" })).status, 413);
        assert.strictEqual((yield* post(url, '"' + "x".repeat(65_536) + '"')).status, 413);
        assert.strictEqual((yield* post(url.slice(0, -4) + "nope", "{}")).status, 404);
        yield* tasks.tick;
        assert.strictEqual(commands.length, 1);
        yield* tasks.setEnabled(saved.task.id, false);
        assert.strictEqual((yield* post(url, "{}")).status, 409);
      }),
  );

  it.effect("skips busy threads, records failures, and disables targets that disappeared", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const { tasks, commands, setThread, setReject } = yield* fixture;
      const { task } = yield* tasks.save(baseInput);
      setThread({ ...thread, hasPendingApprovals: true });
      assert.strictEqual((yield* tasks.runNow(task.id)).status, "skipped");
      assert.strictEqual(commands.length, 0);
      setThread(thread);
      setReject(true);
      const failed = yield* tasks.runNow(task.id);
      assert.strictEqual(failed.status, "failed");
      expect(failed.error).toContain("Provider is unavailable");
      setThread(null);
      yield* TestClock.adjust("1 minute");
      yield* tasks.tick;
      assert.strictEqual((yield* tasks.list())[0]?.enabled, false);
    }),
  );

  it.effect("retains only the latest 50 runs and drops dispatched command bodies", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const { tasks } = yield* fixture;
      const { task } = yield* tasks.save(baseInput);
      let latestId = "";
      for (let index = 0; index < 55; index += 1) latestId = (yield* tasks.runNow(task.id)).id;
      const history = yield* tasks.history(task.id);
      assert.strictEqual(history.length, 50);
      assert.strictEqual(history[0]?.id, latestId);
      const sql = yield* SqlClient.SqlClient;
      assert.strictEqual(
        (yield* sql`SELECT id FROM scheduled_task_runs WHERE command_json IS NOT NULL`).length,
        0,
      );
    }),
  );

  it.effect("skips old fixed-time runs, validates zones, and limits webhook rates", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const { tasks, commands } = yield* fixture;
      const bad = yield* Effect.result(
        tasks.save({
          ...baseInput,
          schedule: {
            type: "fixed_time",
            timeOfDay: "09:00",
            timeZone: "wrong/zone",
            weekdays: [],
          },
        }),
      );
      assert.strictEqual(bad._tag, "Failure");
      yield* tasks.save({
        ...baseInput,
        schedule: { type: "fixed_time", timeOfDay: "08:01", timeZone: "UTC", weekdays: [] },
      });
      yield* TestClock.adjust("1 hour");
      yield* tasks.tick;
      assert.strictEqual(commands.length, 0);
      const hook = yield* tasks.save({ ...baseInput, schedule: { type: "webhook" } });
      const token = hook.webhookPath!.split("/").at(-1)!;
      for (let index = 0; index < 10; index += 1)
        yield* tasks.triggerWebhook(hook.task.id, token, { body: {} }, `delivery-${index}`);
      const limited = yield* Effect.result(
        tasks.triggerWebhook(hook.task.id, token, { body: {} }, "over-limit"),
      );
      assert.strictEqual(limited._tag, "Failure");
      if (limited._tag === "Failure") assert.strictEqual(limited.failure.reason, "rate_limited");
    }),
  );
});

test("webhook rules", (it) => {
  it.effect("filters deliveries before dedupe and rate limits, writing nothing for them", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const { tasks, commands } = yield* fixture;
      const saved = yield* tasks.save({
        ...baseInput,
        prompt: "Triage {{body.action}} {{headers.x-github-event}}",
        schedule: {
          type: "webhook",
          filters: [
            { path: "headers.x-github-event", op: "equals", value: "pull_request" },
            { path: "body.action", op: "in", value: ["opened", "reopened"] },
          ],
        },
      });
      const token = tokenOf(saved);
      const pullRequest = { "x-github-event": "pull_request" };
      expect(
        yield* tasks.triggerWebhook(
          saved.task.id,
          token,
          { body: { action: "opened" }, headers: { "x-github-event": "push" } },
          "delivery",
        ),
      ).toEqual({
        outcome: "filtered",
        reason: "Filter 1 (headers.x-github-event) did not match.",
      });
      for (let index = 0; index < 20; index += 1) {
        expect(
          yield* tasks.triggerWebhook(
            saved.task.id,
            token,
            { body: { action: "closed" }, headers: pullRequest },
            `closed-${index}`,
          ),
        ).toEqual({ outcome: "filtered", reason: "Filter 2 (body.action) did not match." });
      }
      expect(yield* tasks.history(saved.task.id)).toEqual([]);
      // The filtered delivery left no record, so its ID still starts a run once it matches.
      const run = runOf(
        yield* tasks.triggerWebhook(
          saved.task.id,
          token,
          { body: { action: "opened" }, headers: pullRequest },
          "delivery",
        ),
      );
      assert.strictEqual(run.status, "pending");
      yield* tasks.tick;
      expect(texts(commands)).toEqual(["Triage opened pull_request"]);
    }),
  );

  it.effect("keeps stored rules when a save omits them and clears them with [] or null", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const { tasks } = yield* fixture;
      const saved = yield* tasks.save({
        ...baseInput,
        schedule: {
          type: "webhook",
          filters: [{ path: "body.action", op: "exists" }],
          coalesce: { key: "{{body.number}}", windowSeconds: 30 },
        },
      });
      const renamed = yield* tasks.save({
        ...baseInput,
        id: saved.task.id,
        name: "Renamed",
        schedule: { type: "webhook" },
      });
      expect(renamed.task.schedule).toEqual(saved.task.schedule);
      const cleared = yield* tasks.save({
        ...baseInput,
        id: saved.task.id,
        schedule: { type: "webhook", filters: [], coalesce: null },
      });
      expect(cleared.task.schedule).toEqual({ type: "webhook" });
    }),
  );

  it.effect("coalesces a burst into one run with the latest payload when the window closes", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const { tasks, commands } = yield* fixture;
      const saved = yield* tasks.save({
        ...baseInput,
        prompt: "Review PR {{body.number}} at {{body.sha}}",
        schedule: { type: "webhook", coalesce: { key: "pr-{{body.number}}", windowSeconds: 60 } },
      });
      const id = saved.task.id;
      const token = tokenOf(saved);
      const opened = runOf(
        yield* tasks.triggerWebhook(id, token, { body: { number: 7, sha: "a" } }, "a"),
      );
      expect(opened).toMatchObject({ status: "pending", dueAt: "2026-10-23T08:01:00.000Z" });
      yield* TestClock.adjust("30 seconds");
      expect(
        yield* tasks.triggerWebhook(id, token, { body: { number: 7, sha: "b" } }, "b"),
      ).toEqual({ outcome: "coalesced", run: opened });
      const other = runOf(
        yield* tasks.triggerWebhook(id, token, { body: { number: 8, sha: "c" } }, "c"),
      );
      assert.notStrictEqual(other.id, opened.id);
      // Without a key the delivery runs at once.
      const immediate = runOf(yield* tasks.triggerWebhook(id, token, { body: { sha: "d" } }, "d"));
      assert.strictEqual(immediate.dueAt, undefined);
      yield* tasks.tick;
      expect(texts(commands)).toEqual(["Review PR  at d"]);
      // The deadline counts from the first delivery, not the latest one.
      yield* TestClock.adjust("30 seconds");
      yield* tasks.tick;
      expect(texts(commands)).toEqual(["Review PR  at d", "Review PR 7 at b"]);
      const history = yield* tasks.history(id);
      expect(history.find((run) => run.id === opened.id)).toMatchObject({ status: "started" });
      expect(history.find((run) => run.id === opened.id)).not.toHaveProperty("dueAt");
      expect(history.find((run) => run.id === other.id)).toMatchObject({
        status: "pending",
        dueAt: "2026-10-23T08:01:30.000Z",
      });
      // A delivery after the deadline opens a new window instead of joining the closed one.
      const reopened = runOf(
        yield* tasks.triggerWebhook(id, token, { body: { number: 7, sha: "e" } }, "e"),
      );
      assert.notStrictEqual(reopened.id, opened.id);
      assert.strictEqual(reopened.dueAt, "2026-10-23T08:02:00.000Z");
    }),
  );

  it.effect("keeps open windows across restarts and treats retried deliveries as duplicates", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const { tasks, restart, commands } = yield* fixture;
      const saved = yield* tasks.save({
        ...baseInput,
        prompt: "Deploy {{body.sha}}",
        schedule: { type: "webhook", coalesce: { key: "{{body.env}}", windowSeconds: 60 } },
      });
      const id = saved.task.id;
      const token = tokenOf(saved);
      const opened = runOf(
        yield* tasks.triggerWebhook(id, token, { body: { env: "prod", sha: "a" } }, "first"),
      );
      yield* tasks.triggerWebhook(id, token, { body: { env: "prod", sha: "b" } }, "second");
      const recovered = yield* restart;
      // Retries return the run they belong to and leave the latest payload alone.
      expect(
        yield* recovered.triggerWebhook(id, token, { body: { env: "prod", sha: "x" } }, "first"),
      ).toEqual({ outcome: "run", run: opened });
      expect(
        yield* recovered.triggerWebhook(id, token, { body: { env: "prod", sha: "y" } }, "second"),
      ).toEqual({ outcome: "coalesced", run: opened });
      yield* TestClock.adjust("1 minute");
      yield* recovered.tick;
      expect(texts(commands)).toEqual(["Deploy b"]);
      const late = yield* recovered.triggerWebhook(
        id,
        token,
        { body: { env: "prod", sha: "z" } },
        "second",
      );
      expect(late).toMatchObject({
        outcome: "coalesced",
        run: { id: opened.id, status: "started" },
      });
      yield* recovered.tick;
      assert.strictEqual(commands.length, 1);
    }),
  );

  it.effect(
    "skips a window whose thread is busy at the deadline and cancels windows on pause",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(NOW));
        const { tasks, commands, setThread } = yield* fixture;
        const saved = yield* tasks.save({
          ...baseInput,
          schedule: { type: "webhook", coalesce: { key: "{{body.group}}", windowSeconds: 10 } },
        });
        const id = saved.task.id;
        const token = tokenOf(saved);
        const busyWindow = runOf(yield* tasks.triggerWebhook(id, token, { body: { group: "a" } }));
        setThread({ ...thread, hasPendingApprovals: true });
        yield* TestClock.adjust("10 seconds");
        yield* tasks.tick;
        assert.strictEqual(commands.length, 0);
        expect((yield* tasks.history(id)).find((run) => run.id === busyWindow.id)).toMatchObject({
          status: "skipped",
          error: "The thread is busy or waiting for input.",
        });
        setThread(thread);
        const paused = runOf(yield* tasks.triggerWebhook(id, token, { body: { group: "b" } }));
        yield* tasks.setEnabled(id, false);
        yield* tasks.setEnabled(id, true);
        yield* TestClock.adjust("10 seconds");
        yield* tasks.tick;
        assert.strictEqual(commands.length, 0);
        expect((yield* tasks.history(id)).find((run) => run.id === paused.id)).toMatchObject({
          status: "skipped",
          error: "Automation paused before dispatch.",
        });
      }),
  );

  it.effect("bounds joins per minute without spending the run budget", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const { tasks } = yield* fixture;
      const saved = yield* tasks.save({
        ...baseInput,
        schedule: { type: "webhook", coalesce: { key: "{{body.group}}", windowSeconds: 3600 } },
      });
      const id = saved.task.id;
      const token = tokenOf(saved);
      const deliver = (group: string) =>
        Effect.result(tasks.triggerWebhook(id, token, { body: { group } }));
      assert.strictEqual((yield* deliver("joined"))._tag, "Success");
      for (let index = 0; index < 60; index += 1) {
        const joined = yield* deliver("joined");
        assert.strictEqual(joined._tag === "Success" && joined.success.outcome, "coalesced");
      }
      const overJoins = yield* deliver("joined");
      assert.strictEqual(overJoins._tag === "Failure" && overJoins.failure.reason, "rate_limited");
      // Nine more windows fit in the run budget the joins left untouched.
      for (let index = 0; index < 9; index += 1) {
        assert.strictEqual((yield* deliver(`group-${index}`))._tag, "Success");
      }
      const overRuns = yield* deliver("one-more");
      assert.strictEqual(overRuns._tag === "Failure" && overRuns.failure.reason, "rate_limited");
      // The rate windows count deliveries from the last full minute.
      yield* TestClock.adjust("61 seconds");
      assert.strictEqual((yield* deliver("joined"))._tag, "Success");
    }),
  );

  it.effect("passes headers and the query string through the HTTP route", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW));
      const { tasks, commands } = yield* fixture;
      const saved = yield* tasks.save({
        ...baseInput,
        prompt: "From {{query.source}} for {{headers.x-group}}",
        schedule: {
          type: "webhook",
          filters: [{ path: "query.source", op: "equals", value: "ci" }],
          coalesce: { key: "{{headers.x-group}}", windowSeconds: 10 },
        },
      });
      const app = yield* Effect.acquireRelease(
        Effect.sync(() =>
          HttpRouter.toWebHandler(
            webhookRouteLayer.pipe(HttpRouter.provideRequest(Layer.succeed(ScheduledTasks, tasks))),
            { disableLogger: true },
          ),
        ),
        (handler) => Effect.promise(() => handler.dispose()),
      );
      const post = (query: string, headers: Record<string, string>) =>
        Effect.promise(async () => {
          const response = await app.handler(
            new Request(`http://environment.test${saved.webhookPath}${query}`, {
              method: "POST",
              body: "{}",
              headers,
            }),
          );
          return { status: response.status, body: (await response.json()) as unknown };
        });
      expect(yield* post("?source=other", {})).toEqual({
        status: 202,
        body: { status: "filtered", reason: "Filter 1 (query.source) did not match." },
      });
      // The handler runs on the real clock, so only the shape of the window is checked here.
      const opened = (yield* post("?source=ci", { "x-group": "g", "x-webhook-id": "one" }))
        .body as {
        runId: string;
        dueAt: string;
      };
      expect(opened).toMatchObject({ status: "pending", dueAt: expect.any(String) });
      expect(yield* post("?source=ci", { "x-group": "g", "x-webhook-id": "two" })).toEqual({
        status: 202,
        body: { runId: opened.runId, status: "coalesced", dueAt: opened.dueAt },
      });
      const otherGroup = (yield* post("?source=ci", { "x-group": "h" })).body as { runId: string };
      assert.notStrictEqual(otherGroup.runId, opened.runId);
      assert.strictEqual(commands.length, 0);
    }),
  );
});
