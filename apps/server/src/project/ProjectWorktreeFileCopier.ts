/**
 * ProjectWorktreeFileCopier - copies a project's configured local files into a
 * freshly created worktree.
 *
 * Projects often keep untracked local files at the project root (`.env.local`,
 * service-account JSON, …) that every worktree needs. Configuring them here
 * avoids hand-writing a setup script, and each worktree receives an independent
 * *copy* rather than a symlink back to the project root — so editing the file in
 * one worktree can never change it in another.
 *
 * Copy failures are reported per entry and never abort worktree creation.
 *
 * @module ProjectWorktreeFileCopier
 */
import { ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";

/** Why a configured entry was not copied. */
export type ProjectWorktreeFileCopySkipReason =
  | "source-missing"
  | "path-outside-project"
  | "copy-failed";

export interface ProjectWorktreeFileCopyEntryResult {
  readonly relativePath: string;
  readonly copied: boolean;
  readonly reason?: ProjectWorktreeFileCopySkipReason;
}

export interface ProjectWorktreeFileCopierResult {
  readonly entries: ReadonlyArray<ProjectWorktreeFileCopyEntryResult>;
  readonly copiedCount: number;
}

export interface ProjectWorktreeFileCopierInput {
  readonly threadId: string;
  readonly projectId?: string;
  readonly projectCwd?: string;
  readonly worktreePath: string;
}

export class ProjectWorktreeFileCopyOperationError extends Schema.TaggedErrorClass<ProjectWorktreeFileCopyOperationError>()(
  "ProjectWorktreeFileCopyOperationError",
  {
    threadId: Schema.String,
    projectId: Schema.optional(Schema.String),
    projectCwd: Schema.optional(Schema.String),
    worktreePath: Schema.String,
    operation: Schema.Literals(["resolveProject"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Project worktree file copy operation '${this.operation}' failed for thread '${this.threadId}' in '${this.worktreePath}'.`;
  }
}

export class ProjectWorktreeFileCopyProjectNotFoundError extends Schema.TaggedErrorClass<ProjectWorktreeFileCopyProjectNotFoundError>()(
  "ProjectWorktreeFileCopyProjectNotFoundError",
  {
    threadId: Schema.String,
    projectId: Schema.optional(Schema.String),
    projectCwd: Schema.optional(Schema.String),
    worktreePath: Schema.String,
  },
) {
  override get message(): string {
    return `Project was not found for worktree file copy for thread '${this.threadId}' in '${this.worktreePath}'.`;
  }
}

export const ProjectWorktreeFileCopierError = Schema.Union([
  ProjectWorktreeFileCopyOperationError,
  ProjectWorktreeFileCopyProjectNotFoundError,
]);
export type ProjectWorktreeFileCopierError = typeof ProjectWorktreeFileCopierError.Type;

export class ProjectWorktreeFileCopier extends Context.Service<
  ProjectWorktreeFileCopier,
  {
    readonly copyForThread: (
      input: ProjectWorktreeFileCopierInput,
    ) => Effect.Effect<ProjectWorktreeFileCopierResult, ProjectWorktreeFileCopierError>;
  }
>()("t3/project/ProjectWorktreeFileCopier") {}

export const make = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const copyForThread: ProjectWorktreeFileCopier["Service"]["copyForThread"] = Effect.fn(
    "ProjectWorktreeFileCopier.copyForThread",
  )(function* (input) {
    const errorContext = {
      threadId: input.threadId,
      worktreePath: input.worktreePath,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.projectCwd === undefined ? {} : { projectCwd: input.projectCwd }),
    };
    const projectById = input.projectId
      ? yield* projectionSnapshotQuery.getProjectShellById(ProjectId.make(input.projectId)).pipe(
          Effect.map(Option.getOrUndefined),
          Effect.mapError(
            (cause) =>
              new ProjectWorktreeFileCopyOperationError({
                ...errorContext,
                operation: "resolveProject",
                cause,
              }),
          ),
        )
      : null;
    const project =
      projectById ??
      (input.projectCwd
        ? yield* projectionSnapshotQuery.getActiveProjectByWorkspaceRoot(input.projectCwd).pipe(
            Effect.map(Option.getOrUndefined),
            Effect.mapError(
              (cause) =>
                new ProjectWorktreeFileCopyOperationError({
                  ...errorContext,
                  operation: "resolveProject",
                  cause,
                }),
            ),
          )
        : null);

    if (!project) {
      return yield* new ProjectWorktreeFileCopyProjectNotFoundError(errorContext);
    }

    const configured = project.worktreeCopyFiles;
    const entries: Array<ProjectWorktreeFileCopyEntryResult> = [];
    for (const configuredPath of configured) {
      // Resolve on both sides so a crafted entry (absolute path, `..`) can
      // neither read outside the project nor write outside the worktree.
      const source = yield* workspacePaths
        .resolveRelativePathWithinRoot({
          workspaceRoot: project.workspaceRoot,
          relativePath: configuredPath,
        })
        .pipe(Effect.option);
      const destination = yield* workspacePaths
        .resolveRelativePathWithinRoot({
          workspaceRoot: input.worktreePath,
          relativePath: configuredPath,
        })
        .pipe(Effect.option);
      if (Option.isNone(source) || Option.isNone(destination)) {
        entries.push({
          relativePath: configuredPath,
          copied: false,
          reason: "path-outside-project",
        });
        continue;
      }

      // `stat` follows symlinks, so a symlinked source (a common way projects
      // share `.env.local` today) is copied as real content rather than as a
      // link — and a broken link is skipped instead of failing the worktree.
      const sourceInfo = yield* fileSystem.stat(source.value.absolutePath).pipe(Effect.option);
      if (Option.isNone(sourceInfo)) {
        entries.push({ relativePath: configuredPath, copied: false, reason: "source-missing" });
        continue;
      }

      const copied = yield* Effect.gen(function* () {
        const parent = path.dirname(destination.value.absolutePath);
        yield* fileSystem.makeDirectory(parent, { recursive: true });
        if (sourceInfo.value.type === "Directory") {
          yield* fileSystem.copy(source.value.absolutePath, destination.value.absolutePath, {
            overwrite: true,
          });
        } else {
          // copyFile reads through to the target's contents, giving the worktree
          // an independent file even when the source is a symlink.
          yield* fileSystem.copyFile(source.value.absolutePath, destination.value.absolutePath);
        }
        return true;
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Failed to copy project file into worktree", {
            threadId: input.threadId,
            projectId: project.id,
            worktreePath: input.worktreePath,
            relativePath: configuredPath,
            cause,
          }).pipe(Effect.as(false)),
        ),
      );

      entries.push(
        copied
          ? { relativePath: configuredPath, copied: true }
          : { relativePath: configuredPath, copied: false, reason: "copy-failed" },
      );
    }

    return {
      entries,
      copiedCount: entries.filter((entry) => entry.copied).length,
    } satisfies ProjectWorktreeFileCopierResult;
  });

  return ProjectWorktreeFileCopier.of({ copyForThread });
});

export const layer = Layer.effect(ProjectWorktreeFileCopier, make);
