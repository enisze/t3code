import { describe, expect, it } from "vite-plus/test";

import { canAutoSubmitResolvedReference } from "./PullRequestThreadDialog.logic";

describe("canAutoSubmitResolvedReference", () => {
  it("waits for the pull request even when a same-named branch already resolved", () => {
    expect(
      canAutoSubmitResolvedReference({
        isPullRequestReference: true,
        hasResolvedPullRequest: false,
        hasResolvedBranch: true,
      }),
    ).toBe(false);
  });

  it("submits a pull request reference once the pull request resolves", () => {
    expect(
      canAutoSubmitResolvedReference({
        isPullRequestReference: true,
        hasResolvedPullRequest: true,
        hasResolvedBranch: false,
      }),
    ).toBe(true);
  });

  it("submits a branch reference on the resolved branch", () => {
    expect(
      canAutoSubmitResolvedReference({
        isPullRequestReference: false,
        hasResolvedPullRequest: false,
        hasResolvedBranch: true,
      }),
    ).toBe(true);
  });

  it("does not submit while nothing has resolved", () => {
    expect(
      canAutoSubmitResolvedReference({
        isPullRequestReference: false,
        hasResolvedPullRequest: false,
        hasResolvedBranch: false,
      }),
    ).toBe(false);
  });
});
