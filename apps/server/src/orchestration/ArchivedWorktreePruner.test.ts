// @effect-diagnostics nodeBuiltinImport:off - synchronous fixture setup and real processes.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, EventId, type OrchestrationEvent, ThreadId } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import {
  ENVIRONMENT_PROCESS_ENV,
  setThreadProcessEnvironment,
  stopThreadProcesses,
  THREAD_PROCESS_ENV,
} from "../process/threadProcesses.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ArchivedWorktreePruner from "./ArchivedWorktreePruner.ts";
import { pruneWorktreeArtifacts } from "./ArchivedWorktreePruner.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

const TestLayer = GitVcsDriver.layer.pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-worktree-pruner-test-" })),
  Layer.provideMerge(NodeServices.layer),
);

const git = (cwd: string, args: string[]) =>
  NodeChildProcess.execFileSync("git", args, { cwd, stdio: "pipe" });

const write = (root: string, relativePath: string, contents = "x") => {
  const target = NodePath.join(root, relativePath);
  NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
  NodeFS.writeFileSync(target, contents);
};

const makeRepoWithWorktree = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-worktree-pruner-" });
  const repo = NodePath.join(root, "repo");
  const worktree = NodePath.join(root, "worktree");
  NodeFS.mkdirSync(repo);
  git(repo, ["init", "--initial-branch=main"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test User"]);
  write(repo, ".gitignore", "node_modules/\n.next/\n*.apk\n.env\ncache/\n");
  write(repo, "apps/web/index.ts");
  write(repo, "tracked/build/keep.txt");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "init"]);
  git(repo, ["worktree", "add", "-b", "feature", worktree]);
  return { repo, worktree };
});

it.layer(TestLayer)("pruneWorktreeArtifacts", (it) => {
  it.effect("removes ignored build output and keeps source, secrets, and tracked files", () =>
    Effect.gen(function* () {
      const { worktree } = yield* makeRepoWithWorktree;
      write(worktree, "node_modules/pkg/index.js");
      write(worktree, "apps/web/node_modules/pkg/index.js");
      write(worktree, "apps/web/.next/server.js");
      write(worktree, "android/app-release.apk");
      write(worktree, ".env", "SECRET=1");
      write(worktree, "cache/data.bin");

      const removed = yield* pruneWorktreeArtifacts(worktree);

      assert.deepStrictEqual(removed.toSorted(), [
        "android/app-release.apk",
        "apps/web/.next/",
        "apps/web/node_modules/",
        "node_modules/",
      ]);
      assert.isFalse(NodeFS.existsSync(NodePath.join(worktree, "node_modules")));
      assert.isFalse(NodeFS.existsSync(NodePath.join(worktree, "apps/web/node_modules")));
      assert.isFalse(NodeFS.existsSync(NodePath.join(worktree, "apps/web/.next")));
      assert.isFalse(NodeFS.existsSync(NodePath.join(worktree, "android/app-release.apk")));
      assert.isTrue(NodeFS.existsSync(NodePath.join(worktree, ".env")));
      assert.isTrue(NodeFS.existsSync(NodePath.join(worktree, "cache/data.bin")));
      assert.isTrue(NodeFS.existsSync(NodePath.join(worktree, "apps/web/index.ts")));
      assert.isTrue(NodeFS.existsSync(NodePath.join(worktree, "tracked/build/keep.txt")));
    }).pipe(Effect.scoped),
  );

  it.effect("never prunes a main checkout", () =>
    Effect.gen(function* () {
      const { repo } = yield* makeRepoWithWorktree;
      write(repo, "node_modules/pkg/index.js");

      const removed = yield* pruneWorktreeArtifacts(repo);

      assert.deepStrictEqual(removed, []);
      assert.isTrue(NodeFS.existsSync(NodePath.join(repo, "node_modules/pkg/index.js")));
    }).pipe(Effect.scoped),
  );
});

const CleanupTestLayer = ProcessRunner.layer.pipe(Layer.provideMerge(TestLayer));

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("archived thread cleanup", () => {
  it.live.skipIf(HostProcessPlatform.defaultValue() === "win32")(
    "leaves the processes of a thread restored before cleanup ran",
    () =>
      Effect.gen(function* () {
        const threadId = ThreadId.make(`thread-${NodeCrypto.randomUUID()}`);
        const environmentId = `pruner-test-${NodeCrypto.randomUUID()}`;
        setThreadProcessEnvironment(environmentId);
        // A dev server the thread left running: the shell stands in for its
        // session, and the node process it starts outlives the shell's turn.
        const leftoverCommand = `"${process.execPath}" -e "setTimeout(() => {}, 60000)"`;
        const shell = NodeChildProcess.spawn(
          "/bin/sh",
          ["-c", `${leftoverCommand} & echo $!; wait`],
          {
            env: {
              ...process.env,
              [THREAD_PROCESS_ENV]: threadId,
              [ENVIRONMENT_PROCESS_ENV]: environmentId,
            },
            stdio: ["ignore", "pipe", "ignore"],
          },
        );
        const leftover = yield* Effect.promise(
          () =>
            new Promise<number>((resolve) =>
              shell.stdout.once("data", (chunk: Buffer) => resolve(Number(String(chunk).trim()))),
            ),
        );

        yield* Effect.gen(function* () {
          const events = yield* Queue.unbounded<OrchestrationEvent>();
          const archivedSnapshotRead = yield* Deferred.make<void>();
          const pruner = yield* ArchivedWorktreePruner.make.pipe(
            Effect.provideService(OrchestrationEngineService, {
              readEvents: () => Stream.empty,
              readThreadEvents: () => Stream.empty,
              getThreadReplayStats: () => Effect.die("unused"),
              dispatch: () => Effect.die("unused"),
              streamDomainEvents: Stream.empty,
              subscribeDomainEvents: Effect.succeed(Stream.fromQueue(events)),
              latestSequence: Effect.succeed(0),
            } satisfies OrchestrationEngineService["Service"]),
            Effect.provideService(ProjectionSnapshotQuery, {
              getUserInputActivity: () => Effect.die("unused"),
              getCommandReadModel: () => Effect.die("unused"),
              listAccountRoutes: () => Effect.die("unused"),
              getDefaultModelSelectionForCwd: () => Effect.die("unused"),
              getSnapshot: () => Effect.die("unused"),
              getShellSnapshot: () => Effect.die("unused"),
              // Undo restored the thread before the cleanup read the archive.
              getArchivedShellSnapshot: () =>
                Deferred.succeed(archivedSnapshotRead, undefined).pipe(
                  Effect.as({
                    snapshotSequence: 2,
                    projects: [],
                    threads: [],
                    updatedAt: "2026-01-02T00:00:01.000Z",
                  }),
                ),
              getSnapshotSequence: () => Effect.die("unused"),
              getCounts: () => Effect.die("unused"),
              getEventReplayStats: () => Effect.die("unused"),
              getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
              getProjectShellById: () => Effect.die("unused"),
              getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
              getImportedAgentSessionSources: () => Effect.die("unused"),
              getThreadCheckpointContext: () => Effect.die("unused"),
              getFullThreadDiffContext: () => Effect.die("unused"),
              getThreadRuntimeContext: () => Effect.die("unused"),
              getTurnStartMessage: () => Effect.die("unused"),
              getThreadShellById: () => Effect.die("unused"),
              getThreadDetailById: () => Effect.die("unused"),
              getThreadDetailSnapshot: () => Effect.die("unused"),
              searchThreads: () => Effect.die("unused"),
            }),
          );
          yield* pruner.start();

          yield* Queue.offer(events, {
            sequence: 1,
            eventId: EventId.make(`evt-archive-${threadId}`),
            aggregateKind: "thread",
            aggregateId: threadId,
            type: "thread.archived",
            occurredAt: "2026-01-02T00:00:00.000Z",
            commandId: CommandId.make(`cmd-archive-${threadId}`),
            causationEventId: null,
            correlationId: CommandId.make(`cmd-archive-${threadId}`),
            metadata: {},
            payload: {
              threadId,
              archivedAt: "2026-01-02T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
          });
          yield* Deferred.await(archivedSnapshotRead);
          yield* pruner.drain;

          assert.isTrue(isAlive(leftover));
          // It was a process the cleanup would stop: stopping it directly finds it.
          const stopped = yield* stopThreadProcesses(threadId, { killGrace: "100 millis" });
          assert.deepStrictEqual(stopped, [leftover]);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              for (const pid of [leftover, shell.pid]) {
                if (pid !== undefined && isAlive(pid)) process.kill(pid, "SIGKILL");
              }
            }),
          ),
        );
      }).pipe(Effect.scoped, Effect.provide(CleanupTestLayer)),
  );
});
