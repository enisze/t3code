import { describe, expect, it } from "@effect/vitest";
import { type OrchestrationProject, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ProjectWorktreeFileCopier from "./ProjectWorktreeFileCopier.ts";

const makeProject = (input: {
  readonly workspaceRoot: string;
  readonly worktreeCopyFiles: ReadonlyArray<string>;
}): OrchestrationProject => ({
  id: ProjectId.make("project-1"),
  title: "Project",
  workspaceRoot: input.workspaceRoot,
  defaultModelSelection: null,
  gitHubAccount: null,
  worktreeBranchPrefix: null,
  defaultWorktreeBranch: null,
  previewPort: null,
  worktreeCopyFiles: input.worktreeCopyFiles,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
});

const makeProjectionSnapshotQueryLayer = (project: OrchestrationProject) =>
  Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
    getCommandReadModel: () => Effect.die("unused"),
    getSnapshot: () => Effect.die("unused"),
    getShellSnapshot: () => Effect.die("unused"),
    listAccountRoutes: () => Effect.die("unused"),
    getArchivedShellSnapshot: () => Effect.die("unused"),
    getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 1 }),
    getCounts: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: (workspaceRoot) =>
      Effect.succeed(
        workspaceRoot === project.workspaceRoot ? Option.some(project) : Option.none(),
      ),
    getDefaultModelSelectionForCwd: () => Effect.die("unused"),
    getProjectShellById: (projectId) =>
      Effect.succeed(projectId === project.id ? Option.some(project) : Option.none()),
    getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
    getThreadCheckpointContext: () => Effect.die("unused"),
    getFullThreadDiffContext: () => Effect.die("unused"),
    getThreadShellById: () => Effect.die("unused"),
    getThreadDetailById: () => Effect.die("unused"),
    getThreadDetailSnapshot: () => Effect.die("unused"),
  });

const testLayer = (project: OrchestrationProject) =>
  ProjectWorktreeFileCopier.layer.pipe(
    Layer.provideMerge(makeProjectionSnapshotQueryLayer(project)),
    Layer.provideMerge(WorkspacePaths.layer),
    Layer.provideMerge(NodeServices.layer),
  );

/** Create an isolated project root + worktree pair under a temp directory. */
const makeWorkspace = Effect.fn("makeWorkspace")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-copy-files-" });
  const projectRoot = path.join(root, "project");
  const worktreePath = path.join(root, "worktree");
  yield* fileSystem.makeDirectory(projectRoot, { recursive: true });
  yield* fileSystem.makeDirectory(worktreePath, { recursive: true });
  return { fileSystem, path, projectRoot, worktreePath };
});

describe("ProjectWorktreeFileCopier", () => {
  it.effect("copies configured files into the worktree", () =>
    Effect.gen(function* () {
      const { fileSystem, path, projectRoot, worktreePath } = yield* makeWorkspace();
      yield* fileSystem.writeFileString(path.join(projectRoot, ".env.local"), "TOKEN=abc\n");
      yield* fileSystem.makeDirectory(path.join(projectRoot, "config"), { recursive: true });
      yield* fileSystem.writeFileString(path.join(projectRoot, "config/local.json"), "{}\n");

      const project = makeProject({
        workspaceRoot: projectRoot,
        worktreeCopyFiles: [".env.local", "config/local.json"],
      });

      const result = yield* Effect.gen(function* () {
        const copier = yield* ProjectWorktreeFileCopier.ProjectWorktreeFileCopier;
        return yield* copier.copyForThread({
          threadId: "thread-1",
          projectId: "project-1",
          worktreePath,
        });
      }).pipe(Effect.provide(testLayer(project)));

      expect(result.copiedCount).toBe(2);
      expect(yield* fileSystem.readFileString(path.join(worktreePath, ".env.local"))).toBe(
        "TOKEN=abc\n",
      );
      // Nested destinations are created rather than skipped.
      expect(yield* fileSystem.readFileString(path.join(worktreePath, "config/local.json"))).toBe(
        "{}\n",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("dereferences a symlinked source into an independent copy", () =>
    Effect.gen(function* () {
      const { fileSystem, path, projectRoot, worktreePath } = yield* makeWorkspace();
      // A project sharing `.env.local` by symlink is the exact case this feature
      // replaces: the worktree must get real content it can edit in isolation.
      const shared = path.join(projectRoot, "..", "shared.env");
      yield* fileSystem.writeFileString(shared, "SHARED=1\n");
      yield* fileSystem.symlink(shared, path.join(projectRoot, ".env.local"));

      const project = makeProject({
        workspaceRoot: projectRoot,
        worktreeCopyFiles: [".env.local"],
      });

      const result = yield* Effect.gen(function* () {
        const copier = yield* ProjectWorktreeFileCopier.ProjectWorktreeFileCopier;
        return yield* copier.copyForThread({
          threadId: "thread-1",
          projectId: "project-1",
          worktreePath,
        });
      }).pipe(Effect.provide(testLayer(project)));

      expect(result.copiedCount).toBe(1);
      const destination = path.join(worktreePath, ".env.local");
      expect(yield* fileSystem.readFileString(destination)).toBe("SHARED=1\n");
      // Not a link: editing the worktree copy must not touch the shared original.
      const info = yield* fileSystem.stat(destination);
      expect(info.type).toBe("File");
      yield* fileSystem.writeFileString(destination, "SHARED=2\n");
      expect(yield* fileSystem.readFileString(shared)).toBe("SHARED=1\n");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("skips missing sources and rejects paths outside the project", () =>
    Effect.gen(function* () {
      const { fileSystem, path, projectRoot, worktreePath } = yield* makeWorkspace();
      const outside = path.join(projectRoot, "..", "secret.txt");
      yield* fileSystem.writeFileString(outside, "secret\n");

      const project = makeProject({
        workspaceRoot: projectRoot,
        worktreeCopyFiles: ["missing.env", "../secret.txt"],
      });

      const result = yield* Effect.gen(function* () {
        const copier = yield* ProjectWorktreeFileCopier.ProjectWorktreeFileCopier;
        return yield* copier.copyForThread({
          threadId: "thread-1",
          projectId: "project-1",
          worktreePath,
        });
      }).pipe(Effect.provide(testLayer(project)));

      expect(result.copiedCount).toBe(0);
      expect(result.entries).toEqual([
        { relativePath: "missing.env", copied: false, reason: "source-missing" },
        { relativePath: "../secret.txt", copied: false, reason: "path-outside-project" },
      ]);
      // The traversal attempt must not have written anything into the worktree.
      expect(yield* fileSystem.exists(path.join(worktreePath, "secret.txt"))).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("returns an empty result when no files are configured", () =>
    Effect.gen(function* () {
      const { projectRoot, worktreePath } = yield* makeWorkspace();
      const project = makeProject({ workspaceRoot: projectRoot, worktreeCopyFiles: [] });

      const result = yield* Effect.gen(function* () {
        const copier = yield* ProjectWorktreeFileCopier.ProjectWorktreeFileCopier;
        return yield* copier.copyForThread({
          threadId: "thread-1",
          projectCwd: projectRoot,
          worktreePath,
        });
      }).pipe(Effect.provide(testLayer(project)));

      expect(result).toEqual({ entries: [], copiedCount: 0 });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
