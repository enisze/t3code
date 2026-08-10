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
