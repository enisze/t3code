// @effect-diagnostics nodeBuiltinImport:off - Project lookup is exercised against real temp folders and symlinks.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Runtime from "effect/Runtime";

import {
  ThreadArchivedError,
  ThreadNeedsInputError,
  ThreadProjectNotFoundError,
  type ThreadServer,
  resolveModelSelection,
  resolveProject,
  threadStatus,
  titleFromMessage,
  waitForIdle,
  waitForTurn,
} from "./thread.ts";

const threadId = ThreadId.make("thread-1");
const projectId = ProjectId.make("project-1");
const sentAt = "2026-10-23T12:00:10.000Z";
const codex = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" };

const shellThread = (
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell => ({
  id: threadId,
  projectId,
  title: "Fix the flaky test",
  modelSelection: codex,
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-10-23T11:00:00.000Z",
  updatedAt: "2026-10-23T11:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  ...overrides,
});

const turn = (
  id: string,
  state: "running" | "completed" | "interrupted" | "error",
  times: { readonly requestedAt: string; readonly completedAt?: string },
) => ({
  turnId: TurnId.make(id),
  state,
  requestedAt: times.requestedAt,
  startedAt: times.requestedAt,
  completedAt: times.completedAt ?? null,
  assistantMessageId: null,
});

const session = (
  status: "ready" | "running" | "error" | "stopped",
  updatedAt: string,
  lastError: string | null = null,
) => ({
  threadId,
  status,
  providerName: "codex",
  runtimeMode: "full-access" as const,
  activeTurnId: null,
  lastError,
  updatedAt,
});

/** Answers each shell read with the next scripted thread state. */
const scriptedServer = (
  shells: Array<OrchestrationThreadShell | null>,
  details: Array<OrchestrationThread> = [],
) => {
  const server: ThreadServer = {
    shell: Effect.suspend(() => {
      const next = shells.shift();
      return next === undefined
        ? Effect.die("unscripted shell read")
        : Effect.succeed({
            snapshotSequence: 0,
            projects: [],
            threads: next === null ? [] : [next],
            updatedAt: sentAt,
          });
    }),
    thread: () =>
      Effect.suspend(() => {
        const next = details.shift();
        return next === undefined ? Effect.die("unscripted thread read") : Effect.succeed(next);
      }),
    dispatch: () => Effect.die("unexpected dispatch"),
  };
  return server;
};

describe("waitForTurn", () => {
  it.effect("skips the turn that ended before the message, then reports the message's turn", () =>
    Effect.gen(function* () {
      const server = scriptedServer([
        shellThread({
          latestTurn: turn("turn-0", "completed", {
            requestedAt: "2026-10-23T12:00:00.000Z",
            completedAt: "2026-10-23T12:00:05.000Z",
          }),
          session: session("ready", "2026-10-23T12:00:05.000Z"),
        }),
        shellThread({
          latestTurn: turn("turn-1", "running", { requestedAt: sentAt }),
          session: { ...session("running", sentAt), activeTurnId: TurnId.make("turn-1") },
        }),
        shellThread({
          latestTurn: turn("turn-1", "completed", {
            requestedAt: sentAt,
            completedAt: "2026-10-23T12:00:20.000Z",
          }),
          session: session("ready", "2026-10-23T12:00:20.000Z"),
        }),
      ]);

      const outcome = yield* waitForTurn(server, { threadId, sentAt }, Duration.zero);

      assert.deepStrictEqual(outcome, {
        type: "ended",
        turnId: TurnId.make("turn-1"),
        status: "completed",
        error: null,
      });
    }),
  );

  it.effect("stops when the turn waits for an answer instead of polling forever", () =>
    Effect.gen(function* () {
      const server = scriptedServer([
        shellThread({
          latestTurn: turn("turn-1", "running", { requestedAt: sentAt }),
          session: session("running", sentAt),
          hasPendingApprovals: true,
        }),
      ]);

      assert.deepStrictEqual(yield* waitForTurn(server, { threadId, sentAt }, Duration.zero), {
        type: "needs_input",
      });
    }),
  );

  it.effect("reports a start the provider refused, which no turn records", () =>
    Effect.gen(function* () {
      const server = scriptedServer([
        shellThread({
          latestTurn: turn("turn-0", "completed", {
            requestedAt: "2026-10-23T12:00:00.000Z",
            completedAt: "2026-10-23T12:00:05.000Z",
          }),
          session: session("error", sentAt, "Codex CLI is not installed."),
        }),
      ]);

      assert.deepStrictEqual(yield* waitForTurn(server, { threadId, sentAt }, Duration.zero), {
        type: "ended",
        turnId: null,
        status: "error",
        error: "Codex CLI is not installed.",
      });
    }),
  );

  it.effect("ends with another client's turn when the message joined it", () =>
    Effect.gen(function* () {
      const server = scriptedServer([
        shellThread({
          latestTurn: turn("turn-0", "running", { requestedAt: "2026-10-23T12:00:09.000Z" }),
          session: session("running", "2026-10-23T12:00:09.000Z"),
        }),
        shellThread({
          latestTurn: turn("turn-0", "completed", {
            requestedAt: "2026-10-23T12:00:09.000Z",
            completedAt: "2026-10-23T12:00:30.000Z",
          }),
          session: session("ready", "2026-10-23T12:00:30.000Z"),
        }),
      ]);

      const outcome = yield* waitForTurn(server, { threadId, sentAt }, Duration.zero);

      assert.deepStrictEqual(outcome, {
        type: "ended",
        turnId: TurnId.make("turn-0"),
        status: "completed",
        error: null,
      });
    }),
  );
});

describe("waitForIdle", () => {
  it.effect("returns the thread once its current turn ends", () =>
    Effect.gen(function* () {
      const idle = shellThread({
        latestTurn: turn("turn-0", "completed", {
          requestedAt: "2026-10-23T12:00:00.000Z",
          completedAt: "2026-10-23T12:00:05.000Z",
        }),
        session: session("ready", "2026-10-23T12:00:05.000Z"),
      });
      const server = scriptedServer([
        shellThread({
          latestTurn: turn("turn-0", "running", { requestedAt: "2026-10-23T12:00:00.000Z" }),
          session: session("running", "2026-10-23T12:00:00.000Z"),
        }),
        idle,
      ]);

      assert.strictEqual(yield* waitForIdle(server, threadId, Duration.zero), idle);
    }),
  );

  it.effect("refuses to queue behind a turn blocked on an answer, with exit code 2", () =>
    Effect.gen(function* () {
      const server = scriptedServer([
        shellThread({
          latestTurn: turn("turn-0", "running", { requestedAt: "2026-10-23T12:00:00.000Z" }),
          session: session("running", "2026-10-23T12:00:00.000Z"),
          hasPendingUserInput: true,
        }),
      ]);

      const error = yield* waitForIdle(server, threadId, Duration.zero).pipe(Effect.flip);

      assert.instanceOf(error, ThreadNeedsInputError);
      assert.isFalse(error.sent);
      assert.strictEqual(Runtime.getErrorExitCode(error), 2);
      assert.include(error.message, "was not sent");
    }),
  );

  it.effect("names an archived thread instead of reporting it missing", () =>
    Effect.gen(function* () {
      const server = scriptedServer(
        [null],
        [
          {
            ...shellThread(),
            archivedAt: "2026-10-23T11:30:00.000Z",
            deletedAt: null,
            messages: [],
            proposedPlans: [],
            activities: [],
            checkpoints: [],
          },
        ],
      );

      const error = yield* waitForIdle(server, threadId, Duration.zero).pipe(Effect.flip);

      assert.instanceOf(error, ThreadArchivedError);
    }),
  );
});

it.layer(NodeServices.layer)("resolveProject", (it) => {
  const project = (id: string, workspaceRoot: string): OrchestrationProjectShell => ({
    id: ProjectId.make(id),
    title: id,
    workspaceRoot,
    defaultModelSelection: null,
    gitHubAccount: null,
    worktreeBranchPrefix: null,
    defaultWorktreeBranch: null,
    previewPort: null,
    worktreeCopyFiles: [],
    scripts: [],
    createdAt: sentAt,
    updatedAt: sentAt,
  });

  it.effect("matches an id, the deepest project containing a path, and symlinked roots", () =>
    Effect.gen(function* () {
      const root = NodeFS.realpathSync(
        NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-thread-cli-")),
      );
      const outer = NodePath.join(root, "repo");
      const inner = NodePath.join(outer, "packages", "app");
      NodeFS.mkdirSync(NodePath.join(inner, "src"), { recursive: true });
      const alias = NodePath.join(root, "alias");
      NodeFS.symlinkSync(outer, alias);
      const projects = [project("outer", alias), project("inner", inner)];

      const byId = yield* resolveProject(projects, "outer", "/");
      const deepest = yield* resolveProject(projects, "src", inner);
      const throughSymlink = yield* resolveProject(projects, ".", outer);
      const missing = yield* resolveProject(projects, ".", root).pipe(Effect.flip);

      assert.strictEqual(byId.id, "outer");
      assert.strictEqual(deepest.id, "inner");
      assert.strictEqual(throughSymlink.id, "outer");
      assert.instanceOf(missing, ThreadProjectNotFoundError);
      NodeFS.rmSync(root, { recursive: true, force: true });
    }),
  );
});

describe("new threads", () => {
  it("title themselves after the message's first line", () => {
    assert.strictEqual(
      titleFromMessage("\n  Fix the flaky test  \nIt fails on CI."),
      "Fix the flaky test",
    );
    const long = titleFromMessage("a".repeat(120));
    assert.strictEqual(long.length, 80);
    assert.isTrue(long.endsWith("…"));
  });

  it("take the model from the flags, then the project, then the server, then Codex", () => {
    const claude = { instanceId: ProviderInstanceId.make("claude"), model: "claude-opus-5-5" };
    const server = { instanceId: ProviderInstanceId.make("cursor"), model: "auto" };

    assert.deepStrictEqual(
      resolveModelSelection({ flags: claude, projectDefault: codex, serverDefault: server }),
      claude,
    );
    assert.deepStrictEqual(
      resolveModelSelection({ flags: undefined, projectDefault: codex, serverDefault: server }),
      codex,
    );
    assert.deepStrictEqual(
      resolveModelSelection({ flags: undefined, projectDefault: null, serverDefault: server }),
      server,
    );
    assert.strictEqual(
      resolveModelSelection({ flags: undefined, projectDefault: null, serverDefault: null })
        .instanceId,
      "codex",
    );
  });
});

describe("threadStatus", () => {
  it("separates a blocked turn from a running one and reports how the last turn ended", () => {
    const running = turn("turn-1", "running", { requestedAt: sentAt });

    assert.strictEqual(threadStatus(shellThread()), "idle");
    assert.strictEqual(threadStatus(shellThread({ latestTurn: running })), "running");
    assert.strictEqual(
      threadStatus(shellThread({ latestTurn: running, hasPendingApprovals: true })),
      "waiting",
    );
    assert.strictEqual(
      threadStatus(
        shellThread({ latestTurn: turn("turn-1", "interrupted", { requestedAt: sentAt }) }),
      ),
      "interrupted",
    );
    assert.strictEqual(
      threadStatus(shellThread({ session: session("error", sentAt, "No such model.") })),
      "error",
    );
  });
});
