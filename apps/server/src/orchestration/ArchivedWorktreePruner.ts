import type { OrchestrationEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { splitNullSeparatedGitStdoutPaths } from "../vcs/GitVcsDriverCore.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";

/**
 * Frees disk space when a thread is archived: the thread's worktree keeps its
 * source and git state (so unarchive still works), but git-ignored dependency
 * and build output that a reinstall or rebuild recreates is deleted.
 */
export class ArchivedWorktreePruner extends Context.Service<
  ArchivedWorktreePruner,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/orchestration/ArchivedWorktreePruner") {}

// Only these ignored names are removed. Anything else ignored (.env files,
// local databases, editor state) may be irreplaceable, so it is left alone.
const PRUNABLE_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".output",
  ".turbo",
  ".vercel",
  ".parcel-cache",
  ".expo",
  ".gradle",
  ".cxx",
  "Pods",
  "DerivedData",
  "dist",
  "build",
  "target",
  "coverage",
  "__pycache__",
  ".venv",
]);
const PRUNABLE_FILE_EXTENSIONS = new Set([".apk", ".aab", ".ipa"]);

/** Picks the prunable entries from `git ls-files --ignored --directory` output. */
export function selectPrunablePaths(ignoredPaths: ReadonlyArray<string>): string[] {
  return ignoredPaths.filter((entry) => {
    const isDirectory = entry.endsWith("/");
    const trimmed = isDirectory ? entry.slice(0, -1) : entry;
    const name = trimmed.slice(trimmed.lastIndexOf("/") + 1);
    if (isDirectory) return PRUNABLE_DIRECTORY_NAMES.has(name);
    const dot = name.lastIndexOf(".");
    return dot > 0 && PRUNABLE_FILE_EXTENSIONS.has(name.slice(dot).toLowerCase());
  });
}

/**
 * Deletes prunable ignored paths inside a linked git worktree. Refuses to run
 * on a main checkout (whose `.git` is a directory), so a project root is never
 * touched even if a thread points at it.
 */
export const pruneWorktreeArtifacts = Effect.fn("ArchivedWorktreePruner.pruneWorktreeArtifacts")(
  function* (worktreePath: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const git = yield* GitVcsDriver.GitVcsDriver;

    const gitEntry = yield* fileSystem
      .stat(path.join(worktreePath, ".git"))
      .pipe(Effect.orElseSucceed(() => null));
    if (gitEntry?.type !== "File") return [];

    const result = yield* git.execute({
      operation: "ArchivedWorktreePruner.listIgnored",
      cwd: worktreePath,
      args: ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
      maxOutputBytes: 16 * 1024 * 1024,
    });
    const prunable = selectPrunablePaths(splitNullSeparatedGitStdoutPaths(result));
    yield* Effect.forEach(
      prunable,
      (entry) => fileSystem.remove(path.join(worktreePath, entry), { recursive: true }),
      { concurrency: 4, discard: true },
    );
    return prunable;
  },
);

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const context = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | GitVcsDriver.GitVcsDriver
  >();

  const prune = Effect.fn("ArchivedWorktreePruner.prune")(function* (
    event: Extract<OrchestrationEvent, { type: "thread.archived" }>,
  ) {
    const archived = yield* snapshots.getArchivedShellSnapshot();
    const thread = archived.threads.find((candidate) => candidate.id === event.payload.threadId);
    if (thread?.worktreePath == null) return;
    const worktreePath = thread.worktreePath;
    // Another live thread still working in this worktree needs its dependencies.
    const live = yield* snapshots.getShellSnapshot();
    if (
      live.threads.some(
        (candidate) => candidate.archivedAt === null && candidate.worktreePath === worktreePath,
      )
    ) {
      return;
    }
    if (live.projects.some((project) => project.workspaceRoot === worktreePath)) return;

    const removed = yield* pruneWorktreeArtifacts(worktreePath).pipe(Effect.provide(context));
    if (removed.length > 0) {
      yield* Effect.logInfo("pruned archived worktree artifacts", {
        threadId: thread.id,
        worktreePath,
        removed,
      });
    }
  });

  const worker = yield* makeDrainableWorker(
    (event: Extract<OrchestrationEvent, { type: "thread.archived" }>) =>
      prune(event).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("archived worktree pruning failed", {
                threadId: event.payload.threadId,
                cause: Cause.pretty(cause),
              }),
        ),
      ),
  );

  const start = Effect.fn("ArchivedWorktreePruner.start")(function* () {
    const events = yield* engine.subscribeDomainEvents;
    yield* forkParked(
      Stream.runForEach(events, (event) =>
        event.type === "thread.archived" ? worker.enqueue(event) : Effect.void,
      ),
    );
  });

  return { start, drain: worker.drain } satisfies ArchivedWorktreePruner["Service"];
});

export const layer = Layer.effect(ArchivedWorktreePruner, make);
