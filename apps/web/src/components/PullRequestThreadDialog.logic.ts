import type { VcsCreateWorktreeInput, VcsRef } from "@t3tools/contracts";
import { stripRemoteRefPrefix } from "@t3tools/shared/git";

import { resolveExactBranchWorktreeInput } from "./BranchToolbar.logic";

/**
 * Match a typed or clicked reference against listed refs.
 *
 * A remote ref carries its remote in `name` (`origin/claude/foo`) and again in
 * `remoteName`, so a reference can legitimately arrive in either shape: the
 * fully qualified `origin/claude/foo` a suggestion row shows, or the plain
 * `claude/foo` a user types. Both must resolve, or the branch never gets its
 * worktree. Local refs win over remote ones so an already-fetched branch is
 * checked out as-is instead of being recreated from the remote.
 */
export function findBranchRefForReference<Ref extends Pick<VcsRef, "name" | "remoteName">>(
  refs: ReadonlyArray<Ref>,
  reference: string,
): Ref | undefined {
  const trimmed = reference.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const matches = refs.filter(
    (ref) => ref.name === trimmed || stripRemoteRefPrefix(ref.name, ref.remoteName) === trimmed,
  );
  return matches.find((ref) => ref.name === trimmed) ?? matches[0];
}

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
  readonly ref: Pick<VcsRef, "name" | "isRemote" | "remoteName" | "worktreePath">;
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
 * Take a reference at its word when no listed ref matches it.
 *
 * The ref list is read from local refs only, so a branch pushed from somewhere
 * else — another machine, an agent, a collaborator — matches nothing here until
 * something fetches it, and that is exactly the branch a user types instead of
 * picking. Send the name as given: the server resolves it against the remotes,
 * fetching the branch before it creates the worktree, and reports back the local
 * branch the worktree landed on.
 */
export function resolveTypedBranchWorktreeTarget(input: {
  readonly cwd: string;
  readonly reference: string;
  /**
   * A reference that names a pull request is never a branch name, so it must
   * keep waiting on — and failing with — the pull request lookup rather than
   * being sent off as a ref nothing can resolve.
   */
  readonly isPullRequestReference: boolean;
}): ResolvedBranchWorktreeTarget | null {
  const branch = input.reference.trim();
  if (branch.length === 0 || input.isPullRequestReference) {
    return null;
  }
  return {
    branch,
    worktreePath: null,
    reuseExisting: false,
    createInput: { cwd: input.cwd, refName: branch, path: null },
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
 * resolved branch target is the only signal available — including the typed
 * fallback, which only becomes a target once the ref lookup has settled without
 * a match.
 */
export function canAutoSubmitResolvedReference(input: {
  readonly isPullRequestReference: boolean;
  readonly hasResolvedPullRequest: boolean;
  readonly hasResolvedBranch: boolean;
}): boolean {
  return input.isPullRequestReference ? input.hasResolvedPullRequest : input.hasResolvedBranch;
}
