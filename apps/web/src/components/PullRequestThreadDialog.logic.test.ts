import { describe, expect, it } from "vite-plus/test";

import {
  canAutoSubmitResolvedReference,
  resolveBranchWorktreeTarget,
} from "./PullRequestThreadDialog.logic";

describe("resolveBranchWorktreeTarget", () => {
  it("creates a dedicated worktree for an existing local branch", () => {
    expect(
      resolveBranchWorktreeTarget({
        cwd: "/repo",
        ref: { name: "feature/review", isRemote: false, worktreePath: null },
      }),
    ).toEqual({
      branch: "feature/review",
      worktreePath: null,
      reuseExisting: false,
      createInput: {
        cwd: "/repo",
        refName: "feature/review",
        path: null,
      },
    });
  });

  it("creates and reports a local branch when the resolved ref is remote", () => {
    expect(
      resolveBranchWorktreeTarget({
        cwd: "/repo",
        ref: { name: "origin/feature/review", isRemote: true, worktreePath: null },
      }),
    ).toEqual({
      branch: "feature/review",
      worktreePath: null,
      reuseExisting: false,
      createInput: {
        cwd: "/repo",
        refName: "origin/feature/review",
        newRefName: "feature/review",
        path: null,
      },
    });
  });

  it("reuses a secondary worktree", () => {
    expect(
      resolveBranchWorktreeTarget({
        cwd: "/repo",
        ref: {
          name: "feature/review",
          isRemote: false,
          worktreePath: "/worktrees/feature-review",
        },
      }),
    ).toEqual({
      branch: "feature/review",
      worktreePath: "/worktrees/feature-review",
      reuseExisting: true,
      createInput: null,
    });
  });

  it("reuses the primary checkout as the local workspace instead of creating a worktree", () => {
    // git refuses a second worktree for a branch already checked out in the
    // primary, so this must reuse the checkout rather than run `git worktree add`.
    expect(
      resolveBranchWorktreeTarget({
        cwd: "/repo",
        ref: { name: "feature/review", isRemote: false, worktreePath: "/repo" },
      }),
    ).toEqual({
      branch: "feature/review",
      worktreePath: null,
      reuseExisting: true,
      createInput: null,
    });
  });
});

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
