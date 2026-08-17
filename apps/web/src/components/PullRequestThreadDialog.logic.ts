import type { VcsCreateWorktreeInput, VcsRef } from "@t3tools/contracts";

import { resolveExactBranchWorktreeInput } from "./BranchToolbar.logic";

export type ResolvedBranchWorktreeTarget = {
  branch: string;
  worktreePath: string | null;
  /**
   * The branch is already checked out, so no worktree is created — the existing
   * checkout is reused. When `worktreePath` is null the primary checkout backs
   * it as the local workspace; otherwise it is a secondary worktree.
   */
  reuseExisting: boolean;
  createInput: VcsCreateWorktreeInput | null;
};

/**
 * Adapts a resolved branch to the dialog's reuse-or-create flow.
 *
 * Remote refs need a new local branch, while a branch already checked out is
 * reused: a secondary worktree as-is, the primary checkout as the local
 * workspace (git refuses to add a second worktree for an already-checked-out
 * branch).
 */
export function resolveBranchWorktreeTarget(input: {
  readonly cwd: string;
  readonly ref: Pick<VcsRef, "name" | "isRemote" | "worktreePath">;
}): ResolvedBranchWorktreeTarget {
  const target = resolveExactBranchWorktreeInput({
    activeProjectCwd: input.cwd,
    ref: input.ref,
  });
  if (target.kind === "reuse") {
    return {
      branch: target.branch,
      worktreePath: target.worktreePath,
      reuseExisting: true,
      createInput: null,
    };
  }
  const { kind: _, ...createInput } = target;
  return {
    branch: target.newRefName ?? target.refName,
    worktreePath: null,
    reuseExisting: false,
    createInput,
  };
}

/**
 * Whether an auto-submitted reference has resolved into something safe to act on.
 *
 * A reference that names a pull request must resolve *as a pull request*. The
 * local branch lookup settles well before the debounced pull-request resolution,
 * so a same-named branch would otherwise win the race and submit down the plain
 * "create a worktree from this ref" path — skipping the server's pull-request
 * path that fetches the head, configures its upstream, and runs the project
 * setup script. The result is a worktree without the pull request's content.
 *
 * References that don't name a pull request are branch references, so there the
 * resolved branch is the only signal available.
 */
export function canAutoSubmitResolvedReference(input: {
  readonly isPullRequestReference: boolean;
  readonly hasResolvedPullRequest: boolean;
  readonly hasResolvedBranch: boolean;
}): boolean {
  return input.isPullRequestReference ? input.hasResolvedPullRequest : input.hasResolvedBranch;
}
