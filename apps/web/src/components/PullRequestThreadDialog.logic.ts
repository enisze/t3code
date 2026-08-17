import type { VcsCreateWorktreeInput, VcsRef } from "@t3tools/contracts";

import { resolveExactBranchWorktreeInput } from "./BranchToolbar.logic";

export type ResolvedBranchWorktreeTarget = {
  branch: string;
  worktreePath: string | null;
  createInput: VcsCreateWorktreeInput | null;
};

/**
 * Adapts a resolved branch to the dialog's reuse-or-create flow.
 *
 * Remote refs need a new local branch, while a branch checked out in a
 * secondary worktree must be reused. The primary checkout is deliberately not
 * treated as a dedicated worktree.
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
      createInput: null,
    };
  }
  const { kind: _, ...createInput } = target;
  return {
    branch: target.newRefName ?? target.refName,
    worktreePath: null,
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
