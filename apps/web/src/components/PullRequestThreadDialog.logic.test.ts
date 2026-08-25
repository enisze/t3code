import { describe, expect, it } from "vite-plus/test";

import {
  canAutoSubmitResolvedReference,
  findBranchRefForReference,
  resolveBranchWorktreeTarget,
} from "./PullRequestThreadDialog.logic";

describe("findBranchRefForReference", () => {
  const remoteOnly = { name: "origin/claude/schedule-limit", remoteName: "origin" };
  const local = { name: "claude/schedule-limit" };

  it("resolves a remote-only branch from the fully qualified name a suggestion passes", () => {
    // `listRefs` reports the ref as `origin/<branch>`, which is what the
    // workspace picker shows and hands back on click.
    expect(findBranchRefForReference([remoteOnly], "origin/claude/schedule-limit")).toBe(
      remoteOnly,
    );
  });

  it("resolves a remote-only branch from the plain branch name a user types", () => {
    expect(findBranchRefForReference([remoteOnly], "claude/schedule-limit")).toBe(remoteOnly);
  });

  it("prefers the local branch when both a local and a remote ref match", () => {
    expect(findBranchRefForReference([remoteOnly, local], "claude/schedule-limit")).toBe(local);
  });

  it("ignores surrounding whitespace", () => {
    expect(findBranchRefForReference([local], "  claude/schedule-limit  ")).toBe(local);
  });

  it("resolves nothing for an empty or unmatched reference", () => {
    expect(findBranchRefForReference([remoteOnly, local], "")).toBeUndefined();
    expect(findBranchRefForReference([remoteOnly, local], "   ")).toBeUndefined();
    expect(findBranchRefForReference([remoteOnly, local], "claude/other")).toBeUndefined();
    // The doubled prefix a caller must never build.
    expect(
      findBranchRefForReference([remoteOnly], "origin/origin/claude/schedule-limit"),
    ).toBeUndefined();
  });
});

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
        ref: {
          name: "origin/feature/review",
          isRemote: true,
          remoteName: "origin",
          worktreePath: null,
        },
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
