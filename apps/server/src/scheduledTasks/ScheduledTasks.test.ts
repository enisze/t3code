import { assert, it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import {
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
import { make, ScheduledTasks } from "./ScheduledTasks.ts";
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
        const invalid = yield* Effect.result(tasks.triggerWebhook(saved.task.id, "wrong", {}));
        assert.strictEqual(invalid._tag, "Failure");
        const first = yield* tasks.triggerWebhook(
          saved.task.id,
          token,
          { ref: "main" },
          "delivery-1",
        );
        const recovered = yield* restart;
        const repeated = yield* recovered.triggerWebhook(
          saved.task.id,
          token,
          { ref: "other" },
          "delivery-1",
        );
        assert.strictEqual(first.id, repeated.id);
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
          (yield* Effect.result(recovered.triggerWebhook(saved.task.id, token, {})))._tag,
          "Failure",
        );
        yield* recovered.triggerWebhook(saved.task.id, rotated.webhookPath.split("/").at(-1)!, {});
        yield* recovered.setEnabled(saved.task.id, false);
        assert.strictEqual(
          (yield* Effect.result(
            recovered.triggerWebhook(saved.task.id, rotated.webhookPath.split("/").at(-1)!, {}),
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
        yield* tasks.triggerWebhook(saved.task.id, token, {}, "delivery");
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
        yield* tasks.triggerWebhook(hook.task.id, token, {}, `delivery-${index}`);
      const limited = yield* Effect.result(
        tasks.triggerWebhook(hook.task.id, token, {}, "over-limit"),
      );
      assert.strictEqual(limited._tag, "Failure");
      if (limited._tag === "Failure") assert.strictEqual(limited.failure.reason, "rate_limited");
    }),
  );
});
