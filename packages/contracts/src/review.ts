import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { GitCommandError } from "./git.ts";
import { VcsError } from "./vcs.ts";

export const ReviewDiffPreviewInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  baseRef: Schema.optional(TrimmedNonEmptyString),
  /** Prefer the primary remote's copy when `baseRef` is an unqualified branch name. */
  preferRemoteBaseRef: Schema.optionalKey(Schema.Boolean),
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
  /** Include complete changed-file contents so omitted regions can be expanded client-side. */
  fullContext: Schema.optionalKey(Schema.Boolean),
});
export type ReviewDiffPreviewInput = typeof ReviewDiffPreviewInput.Type;

export const ReviewDiffPreviewSourceKind = Schema.Literals([
  "working-tree-all",
  "working-tree",
  "branch-range",
]);
export type ReviewDiffPreviewSourceKind = typeof ReviewDiffPreviewSourceKind.Type;

export const ReviewDiffPreviewSource = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: ReviewDiffPreviewSourceKind,
  title: TrimmedNonEmptyString,
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  diff: Schema.String,
  diffHash: TrimmedNonEmptyString,
  truncated: Schema.Boolean,
});
export type ReviewDiffPreviewSource = typeof ReviewDiffPreviewSource.Type;

export const ReviewDiffFileContentsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  sourceKind: ReviewDiffPreviewSourceKind,
  changeType: Schema.Literals(["change", "rename-pure", "rename-changed", "new", "deleted"]),
  baseRef: Schema.NullOr(TrimmedNonEmptyString),
  headRef: Schema.NullOr(TrimmedNonEmptyString),
  oldPath: TrimmedNonEmptyString,
  newPath: TrimmedNonEmptyString,
});
export type ReviewDiffFileContentsInput = typeof ReviewDiffFileContentsInput.Type;

export const ReviewDiffFileContentsResult = Schema.Struct({
  oldContents: Schema.String,
  newContents: Schema.String,
});
export type ReviewDiffFileContentsResult = typeof ReviewDiffFileContentsResult.Type;

export const ReviewDiffPreviewResult = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  generatedAt: Schema.DateTimeUtc,
  sources: Schema.Array(ReviewDiffPreviewSource),
});
export type ReviewDiffPreviewResult = typeof ReviewDiffPreviewResult.Type;

export const ReviewDiffPreviewError = Schema.Union([VcsError, GitCommandError]);
export type ReviewDiffPreviewError = typeof ReviewDiffPreviewError.Type;

/**
 * Which changes an inline chat diff shows. Mirrors the diff panel's git
 * scopes: `all` is every change since the fork point (committed and
 * uncommitted), `unstaged` the local dirty diff, `branch` the committed range.
 */
export const ChatDiffScope = Schema.Literals(["all", "unstaged", "branch"]);
export type ChatDiffScope = typeof ChatDiffScope.Type;

export const ShowDiffInput = Schema.Struct({
  scope: Schema.optionalKey(
    ChatDiffScope.annotate({
      description:
        "Which changes to show: 'all' (default) is every change on this branch since it forked, committed and uncommitted; 'unstaged' is only uncommitted local changes; 'branch' is only committed changes.",
    }),
  ),
  paths: Schema.optionalKey(
    Schema.Array(TrimmedNonEmptyString).annotate({
      description:
        "Optional workspace-relative file or directory paths to limit the diff to. Omit to show every changed file.",
    }),
  ),
});
export type ShowDiffInput = typeof ShowDiffInput.Type;

/** Thread activity kind a client renders as an inline, live diff card. */
export const DIFF_SHOWN_ACTIVITY_KIND = "diff.shown";

export const DiffShownActivityPayload = Schema.Struct({
  scope: ChatDiffScope,
  paths: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
});
export type DiffShownActivityPayload = typeof DiffShownActivityPayload.Type;
