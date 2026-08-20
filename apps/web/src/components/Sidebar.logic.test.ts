import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  archiveSelectedThreadEntries,
  buildMultiSelectThreadContextMenuItems,
  collapseWorktreeSiblings,
  collectWorktreeSiblingThreads,
  resolveWorktreeActiveThread,
  resolveWorktreeWorkspaceRepresentative,
  createThreadJumpHintVisibilityController,
  getSidebarThreadIdsToPrewarm,
  getVisibleSidebarThreadIds,
  resolveAdjacentThreadId,
  getFallbackThreadIdAfterDelete,
  getFallbackThreadAfterArchive,
  groupSidebarThreadsByProject,
  getVisibleThreadsForProject,
  getProjectSortTimestamp,
  hasUnseenCompletion,
  isContextMenuPointerDown,
  isTrailingDoubleClick,
  mergeWorktreeSiblingRunningStatus,
  orderItemsByPreferredIds,
  resolveProjectStatusIndicator,
  resolveSidebarStageBadgeLabel,
  resolveSidebarThreadBranch,
  resolveSidebarV2Status,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
  resolveWorkingStartedAt,
  formatWorkingDurationLabel,
  shouldNavigateAfterProjectRemoval,
  shouldClearThreadSelectionOnMouseDown,
  sortLogicalProjectsForSidebar,
  sortSettledThreadsForSidebarV2,
  sortThreadsForSidebarV2,
  sortProjectsForSidebar,
  sortScopedProjectsForSidebar,
  THREAD_JUMP_HINT_SHOW_DELAY_MS,
} from "./Sidebar.logic";
import {
  EnvironmentId,
  OrchestrationLatestTurn,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";

import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type Project,
  type Thread,
} from "../types";

const localEnvironmentId = EnvironmentId.make("environment-local");

describe("resolveSidebarThreadBranch", () => {
  it("shows the branch currently checked out in a dedicated worktree", () => {
    expect(
      resolveSidebarThreadBranch({
        worktreePath: "/repo/.worktrees/feature-next",
        threadBranch: "feature/previous",
        currentGitBranch: "feature/next",
      }),
    ).toBe("feature/next");
  });

  it("keeps the recorded branch for a local-checkout thread", () => {
    expect(
      resolveSidebarThreadBranch({
        worktreePath: null,
        threadBranch: "feature/thread",
        currentGitBranch: "feature/local-checkout",
      }),
    ).toBe("feature/thread");
  });

  it("falls back to the recorded branch while worktree status is unavailable", () => {
    expect(
      resolveSidebarThreadBranch({
        worktreePath: "/repo/.worktrees/feature",
        threadBranch: "feature/thread",
        currentGitBranch: null,
      }),
    ).toBe("feature/thread");
  });
});

describe("shouldNavigateAfterProjectRemoval", () => {
  const projectThreads = [{ environmentId: "environment-local", id: "thread-1" }];

  it("navigates away from a draft route owned by the removed project", () => {
    expect(
      shouldNavigateAfterProjectRemoval({
        routeTarget: { kind: "draft", draftId: "draft-1" as never },
        projectThreads,
        projectDraftId: "draft-1",
      }),
    ).toBe(true);
  });

  it("does not navigate away from a different draft route", () => {
    expect(
      shouldNavigateAfterProjectRemoval({
        routeTarget: { kind: "draft", draftId: "draft-2" as never },
        projectThreads,
        projectDraftId: "draft-1",
      }),
    ).toBe(false);
  });

  it("navigates away from a server thread owned by the removed project", () => {
    expect(
      shouldNavigateAfterProjectRemoval({
        routeTarget: {
          kind: "server",
          threadRef: {
            environmentId: EnvironmentId.make("environment-local"),
            threadId: ThreadId.make("thread-1"),
          },
        },
        projectThreads,
        projectDraftId: null,
      }),
    ).toBe(true);
  });

  it("does not navigate from an unrelated route", () => {
    expect(
      shouldNavigateAfterProjectRemoval({
        routeTarget: null,
        projectThreads,
        projectDraftId: null,
      }),
    ).toBe(false);
  });
});

describe("archiveSelectedThreadEntries", () => {
  const entries = [{ threadKey: "one" }, { threadKey: "two" }, { threadKey: "three" }] as const;
  const success = { _tag: "Success" } as const;
  const failure = { _tag: "Failure" } as const;

  it("records every entry after full success", async () => {
    const outcome = await archiveSelectedThreadEntries({
      entries,
      archive: async (_entry, onArchived) => {
        onArchived();
        return success;
      },
    });

    expect(outcome).toEqual({
      archivedThreadKeys: ["one", "two", "three"],
      mutationFailure: null,
      followupFailures: [],
    });
  });

  it("stops at a mutation failure and retains prior successes", async () => {
    const archive = vi.fn(async (entry: (typeof entries)[number], onArchived: () => void) => {
      if (entry.threadKey === "two") return failure;
      onArchived();
      return success;
    });
    const outcome = await archiveSelectedThreadEntries({ entries, archive });

    expect(archive).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({
      archivedThreadKeys: ["one"],
      mutationFailure: failure,
      followupFailures: [],
    });
  });

  it("continues after a post-archive failure", async () => {
    const archive = vi.fn(async (entry: (typeof entries)[number], onArchived: () => void) => {
      onArchived();
      return entry.threadKey === "two" ? failure : success;
    });
    const outcome = await archiveSelectedThreadEntries({ entries, archive });

    expect(archive).toHaveBeenCalledTimes(3);
    expect(outcome).toEqual({
      archivedThreadKeys: ["one", "two", "three"],
      mutationFailure: null,
      followupFailures: [failure],
    });
  });
});

describe("buildMultiSelectThreadContextMenuItems", () => {
  it("offers bulk archive with the selected count", () => {
    expect(
      buildMultiSelectThreadContextMenuItems({ count: 3, hasRunningThread: false }),
    ).toContainEqual({ id: "archive", label: "Archive (3)", disabled: false });
  });

  it("disables bulk archive when a selected thread is running", () => {
    expect(
      buildMultiSelectThreadContextMenuItems({ count: 2, hasRunningThread: true }),
    ).toContainEqual({ id: "archive", label: "Archive (2)", disabled: true });
  });
});

describe("resolveSidebarStageBadgeLabel", () => {
  it("returns Nightly for nightly primary server versions", () => {
    expect(
      resolveSidebarStageBadgeLabel({
        primaryServerVersion: "0.0.28-nightly.20260616.12",
        fallbackStageLabel: "Alpha",
      }),
    ).toBe("Nightly");
  });

  it("returns the fallback label for stable primary server versions", () => {
    expect(
      resolveSidebarStageBadgeLabel({
        primaryServerVersion: "0.0.27",
        fallbackStageLabel: "Alpha",
      }),
    ).toBe("Alpha");
  });

  it("returns the fallback label when the primary server version is missing", () => {
    expect(
      resolveSidebarStageBadgeLabel({
        primaryServerVersion: null,
        fallbackStageLabel: "Dev",
      }),
    ).toBe("Dev");
  });

  it("returns the fallback label for malformed nightly prerelease versions", () => {
    expect(
      resolveSidebarStageBadgeLabel({
        primaryServerVersion: "0.0.28-nightly.20260616",
        fallbackStageLabel: "Alpha",
      }),
    ).toBe("Alpha");
  });
});

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): OrchestrationLatestTurn {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt:
      overrides?.startedAt !== undefined ? overrides.startedAt : "2026-03-09T10:00:00.000Z",
    completedAt:
      overrides?.completedAt !== undefined ? overrides.completedAt : "2026-03-09T10:05:00.000Z",
  };
}

describe("hasUnseenCompletion", () => {
  it("returns true when a thread completed after its last visit", () => {
    expect(
      hasUnseenCompletion({
        hasActionableProposedPlan: false,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        interactionMode: "default",
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
        session: null,
      }),
    ).toBe(true);
  });

  it("treats a missing client visit marker as read", () => {
    expect(
      hasUnseenCompletion({
        hasActionableProposedPlan: false,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        interactionMode: "default",
        latestTurn: makeLatestTurn(),
        lastVisitedAt: undefined,
        session: null,
      }),
    ).toBe(false);
  });
});

describe("createThreadJumpHintVisibilityController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delays showing jump hints until the configured delay elapses", () => {
    const visibilityChanges: boolean[] = [];
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        visibilityChanges.push(visible);
      },
    });

    controller.sync(true);
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS - 1);

    expect(visibilityChanges).toEqual([]);

    vi.advanceTimersByTime(1);

    expect(visibilityChanges).toEqual([true]);
  });

  it("hides immediately when the modifiers are released", () => {
    const visibilityChanges: boolean[] = [];
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        visibilityChanges.push(visible);
      },
    });

    controller.sync(true);
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);
    controller.sync(false);

    expect(visibilityChanges).toEqual([true, false]);
  });

  it("cancels a pending reveal when the modifier is released early", () => {
    const visibilityChanges: boolean[] = [];
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        visibilityChanges.push(visible);
      },
    });

    controller.sync(true);
    vi.advanceTimersByTime(Math.floor(THREAD_JUMP_HINT_SHOW_DELAY_MS / 2));
    controller.sync(false);
    vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS);

    expect(visibilityChanges).toEqual([]);
  });
});

describe("getSidebarThreadIdsToPrewarm", () => {
  it("returns only the first visible thread ids up to the prewarm limit", () => {
    expect(getSidebarThreadIdsToPrewarm(["t1", "t2", "t3"], 2)).toEqual(["t1", "t2"]);
  });

  it("returns all visible thread ids when they fit within the limit", () => {
    expect(getSidebarThreadIdsToPrewarm(["t1", "t2"], 10)).toEqual(["t1", "t2"]);
  });

  it("returns no thread ids when the limit is zero", () => {
    expect(getSidebarThreadIdsToPrewarm(["t1", "t2"], 0)).toEqual([]);
  });
});

describe("shouldClearThreadSelectionOnMouseDown", () => {
  it("preserves selection for thread items", () => {
    const child = {
      closest: (selector: string) =>
        selector.includes("[data-thread-item]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(child)).toBe(false);
  });

  it("preserves selection for thread list toggle controls", () => {
    const selectionSafe = {
      closest: (selector: string) =>
        selector.includes("[data-thread-selection-safe]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(selectionSafe)).toBe(false);
  });

  it("clears selection for unrelated sidebar clicks", () => {
    const unrelated = {
      closest: () => null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(unrelated)).toBe(true);
  });
});

describe("isTrailingDoubleClick", () => {
  it("treats a single click as a normal activation", () => {
    expect(isTrailingDoubleClick(1)).toBe(false);
  });

  it("treats synthetic/keyboard activations (detail 0) as a normal activation", () => {
    expect(isTrailingDoubleClick(0)).toBe(false);
  });

  it("ignores the second click of a double-click so it does not navigate", () => {
    expect(isTrailingDoubleClick(2)).toBe(true);
  });

  it("ignores further clicks of a triple-click", () => {
    expect(isTrailingDoubleClick(3)).toBe(true);
  });
});

describe("orderItemsByPreferredIds", () => {
  it("keeps preferred ids first, skips stale ids, and preserves the relative order of remaining items", () => {
    const ordered = orderItemsByPreferredIds({
      items: [
        { id: ProjectId.make("project-1"), name: "One" },
        { id: ProjectId.make("project-2"), name: "Two" },
        { id: ProjectId.make("project-3"), name: "Three" },
      ],
      preferredIds: [
        ProjectId.make("project-3"),
        ProjectId.make("project-missing"),
        ProjectId.make("project-1"),
      ],
      getId: (project) => project.id,
    });

    expect(ordered.map((project) => project.id)).toEqual([
      ProjectId.make("project-3"),
      ProjectId.make("project-1"),
      ProjectId.make("project-2"),
    ]);
  });

  it("does not duplicate items when preferred ids repeat", () => {
    const ordered = orderItemsByPreferredIds({
      items: [
        { id: ProjectId.make("project-1"), name: "One" },
        { id: ProjectId.make("project-2"), name: "Two" },
      ],
      preferredIds: [
        ProjectId.make("project-2"),
        ProjectId.make("project-1"),
        ProjectId.make("project-2"),
      ],
      getId: (project) => project.id,
    });

    expect(ordered.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("honors projectOrder physical keys via getProjectOrderKey", async () => {
    // Regression guard for #1904 / the regression introduced by #2055:
    // `projectOrder` is populated with physical keys (envId + cwd-derived)
    // by the store and by drag-end handlers. Readers must identify projects
    // with the same key format, or manual sort silently snaps back.
    const { getProjectOrderKey } = await import("../logicalProject");
    const projects = [
      {
        environmentId: EnvironmentId.make("environment-local"),
        id: ProjectId.make("id-alpha"),
        workspaceRoot: "/work/alpha",
      },
      {
        environmentId: EnvironmentId.make("environment-local"),
        id: ProjectId.make("id-beta"),
        workspaceRoot: "/work/beta",
      },
      {
        environmentId: EnvironmentId.make("environment-local"),
        id: ProjectId.make("id-gamma"),
        workspaceRoot: "/work/gamma",
      },
    ];
    const ordered = orderItemsByPreferredIds({
      items: projects,
      preferredIds: [getProjectOrderKey(projects[2]!), getProjectOrderKey(projects[0]!)],
      getId: getProjectOrderKey,
    });

    expect(ordered.map((project) => project.workspaceRoot)).toEqual([
      "/work/gamma",
      "/work/alpha",
      "/work/beta",
    ]);
  });

  it("resolves legacy preference aliases without materializing project state", () => {
    const ordered = orderItemsByPreferredIds({
      items: [
        { id: "physical-a", cwd: "/work/a" },
        { id: "physical-b", cwd: "/work/b" },
        { id: "physical-c", cwd: "/work/c" },
      ],
      preferredIds: ["legacy:/work/c", "legacy:/work/a"],
      getId: (project) => project.id,
      getPreferenceIds: (project) => [project.id, `legacy:${project.cwd}`],
    });

    expect(ordered.map((project) => project.id)).toEqual([
      "physical-c",
      "physical-a",
      "physical-b",
    ]);
  });
});

describe("resolveAdjacentThreadId", () => {
  it("resolves adjacent thread ids in ordered sidebar traversal", () => {
    const threads = [
      ThreadId.make("thread-1"),
      ThreadId.make("thread-2"),
      ThreadId.make("thread-3"),
    ];

    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[1] ?? null,
        direction: "previous",
      }),
    ).toBe(threads[0]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[1] ?? null,
        direction: "next",
      }),
    ).toBe(threads[2]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: null,
        direction: "next",
      }),
    ).toBe(threads[0]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: null,
        direction: "previous",
      }),
    ).toBe(threads[2]);
    expect(
      resolveAdjacentThreadId({
        threadIds: threads,
        currentThreadId: threads[0] ?? null,
        direction: "previous",
      }),
    ).toBeNull();
  });
});

describe("getVisibleSidebarThreadIds", () => {
  it("returns only the rendered visible thread order across projects", () => {
    expect(
      getVisibleSidebarThreadIds([
        {
          renderedThreadIds: [
            ThreadId.make("thread-12"),
            ThreadId.make("thread-11"),
            ThreadId.make("thread-10"),
          ],
        },
        {
          renderedThreadIds: [ThreadId.make("thread-8"), ThreadId.make("thread-6")],
        },
      ]),
    ).toEqual([
      ThreadId.make("thread-12"),
      ThreadId.make("thread-11"),
      ThreadId.make("thread-10"),
      ThreadId.make("thread-8"),
      ThreadId.make("thread-6"),
    ]);
  });

  it("skips threads from collapsed projects whose thread panels are not shown", () => {
    expect(
      getVisibleSidebarThreadIds([
        {
          shouldShowThreadPanel: false,
          renderedThreadIds: [ThreadId.make("thread-hidden-2"), ThreadId.make("thread-hidden-1")],
        },
        {
          shouldShowThreadPanel: true,
          renderedThreadIds: [ThreadId.make("thread-12"), ThreadId.make("thread-11")],
        },
      ]),
    ).toEqual([ThreadId.make("thread-12"), ThreadId.make("thread-11")]);
  });
});

describe("isContextMenuPointerDown", () => {
  it("treats secondary-button presses as context menu gestures on all platforms", () => {
    expect(
      isContextMenuPointerDown({
        button: 2,
        ctrlKey: false,
        isMac: false,
      }),
    ).toBe(true);
  });

  it("treats ctrl+primary-click as a context menu gesture on macOS", () => {
    expect(
      isContextMenuPointerDown({
        button: 0,
        ctrlKey: true,
        isMac: true,
      }),
    ).toBe(true);
  });

  it("does not treat ctrl+primary-click as a context menu gesture off macOS", () => {
    expect(
      isContextMenuPointerDown({
        button: 0,
        ctrlKey: true,
        isMac: false,
      }),
    ).toBe(false);
  });
});

describe("resolveSidebarV2Status", () => {
  const session = {
    threadId: ThreadId.make("thread-1"),
    status: "running" as const,
    providerName: "Codex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    runtimeMode: DEFAULT_RUNTIME_MODE,
    activeTurnId: "turn-1" as never,
    lastError: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
  };

  const idle = { hasPendingApprovals: false, hasPendingUserInput: false };

  it("prioritizes approval over a running session", () => {
    expect(resolveSidebarV2Status({ ...idle, hasPendingApprovals: true, session })).toBe(
      "approval",
    );
  });

  it("prioritizes awaiting input over a running session, below approval", () => {
    expect(resolveSidebarV2Status({ ...idle, hasPendingUserInput: true, session })).toBe("input");
    expect(
      resolveSidebarV2Status({
        ...idle,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
        session,
      }),
    ).toBe("approval");
  });

  it("reports working for running and starting sessions", () => {
    expect(resolveSidebarV2Status({ ...idle, session })).toBe("working");
    expect(
      resolveSidebarV2Status({
        ...idle,
        session: { ...session, status: "starting" as const },
      }),
    ).toBe("working");
  });

  it("reports failed only while the session status is error", () => {
    expect(
      resolveSidebarV2Status({
        ...idle,
        session: { ...session, status: "error" as const, lastError: "boom" },
      }),
    ).toBe("failed");
    expect(
      resolveSidebarV2Status({
        ...idle,
        session: { ...session, status: "stopped" as const, lastError: "persisted" },
      }),
    ).toBe("ready");
    expect(
      resolveSidebarV2Status({
        ...idle,
        session: { ...session, status: "ready" as const, lastError: "persisted" },
      }),
    ).toBe("ready");
  });

  it("defaults to ready with no session", () => {
    expect(resolveSidebarV2Status({ ...idle, session: null })).toBe("ready");
  });
});

describe("sortThreadsForSidebarV2", () => {
  const sortable = (input: { id: string; createdAt: string; latestUserMessageAt?: string }) => ({
    id: input.id,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    latestUserMessageAt: input.latestUserMessageAt ?? null,
  });

  it("orders by latest activity within the project", () => {
    const sorted = sortThreadsForSidebarV2([
      sortable({
        id: "oldest",
        createdAt: "2026-03-09T08:00:00.000Z",
        latestUserMessageAt: "2026-03-09T13:00:00.000Z",
      }),
      sortable({ id: "newest", createdAt: "2026-03-09T12:00:00.000Z" }),
      sortable({ id: "middle", createdAt: "2026-03-09T10:00:00.000Z" }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual(["oldest", "newest", "middle"]);
  });

  it("breaks activity ties by id so the order is stable", () => {
    const sorted = sortThreadsForSidebarV2([
      sortable({ id: "b", createdAt: "2026-03-09T10:00:00.000Z" }),
      sortable({ id: "a", createdAt: "2026-03-09T10:00:00.000Z" }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual(["b", "a"]);
  });

  it("lifts a chat by its worktree's recorded activity so a closed sibling doesn't sink the row", () => {
    // `wt-old` is a surviving chat in a worktree whose newer sibling was just
    // closed; `other` is a more recently active chat in a different worktree.
    // Without the recorded close activity, `wt-old` would sort below `other`.
    const wtOld = {
      id: "wt-old",
      environmentId: "env",
      worktreePath: "/repo/wt",
      createdAt: "2026-03-09T08:00:00.000Z",
      updatedAt: "2026-03-09T08:00:00.000Z",
      latestUserMessageAt: "2026-03-09T09:00:00.000Z",
    };
    const other = {
      id: "other",
      environmentId: "env",
      worktreePath: "/repo/other",
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      latestUserMessageAt: "2026-03-09T11:00:00.000Z",
    };

    expect(sortThreadsForSidebarV2([wtOld, other]).map((thread) => thread.id)).toEqual([
      "other",
      "wt-old",
    ]);
    expect(
      sortThreadsForSidebarV2([wtOld, other], {
        "env\0/repo/wt": "2026-03-09T12:00:00.000Z",
      }).map((thread) => thread.id),
    ).toEqual(["wt-old", "other"]);
  });
});

describe("sortSettledThreadsForSidebarV2", () => {
  const settled = (input: {
    id: string;
    settledAt?: string | null;
    latestUserMessageAt?: string | null;
    latestTurn?: OrchestrationLatestTurn | null;
    updatedAt?: string;
  }) => ({
    id: input.id,
    settledAt: input.settledAt ?? null,
    latestUserMessageAt: input.latestUserMessageAt ?? null,
    latestTurn: input.latestTurn ?? null,
    updatedAt: input.updatedAt ?? "2026-03-09T09:00:00.000Z",
  });

  it("orders by settle time, most recently settled first", () => {
    const sorted = sortSettledThreadsForSidebarV2([
      settled({
        id: "settled-first",
        settledAt: "2026-03-09T10:00:00.000Z",
        // Created/active later than the other thread: settle time must win.
        latestUserMessageAt: "2026-03-09T09:59:00.000Z",
      }),
      settled({
        id: "settled-last",
        settledAt: "2026-03-09T12:00:00.000Z",
        latestUserMessageAt: "2026-03-09T08:00:00.000Z",
      }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual(["settled-last", "settled-first"]);
  });

  it("falls back to last activity for auto-settled threads without a settledAt stamp", () => {
    const sorted = sortSettledThreadsForSidebarV2([
      settled({ id: "auto-old", latestUserMessageAt: "2026-03-09T08:00:00.000Z" }),
      settled({ id: "explicit", settledAt: "2026-03-09T10:00:00.000Z" }),
      settled({ id: "auto-recent", latestUserMessageAt: "2026-03-09T11:00:00.000Z" }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual(["auto-recent", "explicit", "auto-old"]);
  });

  it("counts a turn completion as activity for auto-settled threads", () => {
    // The message came in before the other thread's, but its turn finished
    // after: completion time is the real "work ended" moment.
    const sorted = sortSettledThreadsForSidebarV2([
      settled({ id: "message-only", latestUserMessageAt: "2026-03-09T10:04:00.000Z" }),
      settled({
        id: "completed-later",
        latestUserMessageAt: "2026-03-09T10:00:00.000Z",
        latestTurn: makeLatestTurn({ completedAt: "2026-03-09T10:30:00.000Z" }),
      }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual(["completed-later", "message-only"]);
  });

  it("breaks timestamp ties by id so the order is stable", () => {
    const sorted = sortSettledThreadsForSidebarV2([
      settled({ id: "b", settledAt: "2026-03-09T10:00:00.000Z" }),
      settled({ id: "a", settledAt: "2026-03-09T10:00:00.000Z" }),
    ]);

    expect(sorted.map((thread) => thread.id)).toEqual(["a", "b"]);
  });
});

describe("resolveWorkingStartedAt", () => {
  const session = {
    threadId: ThreadId.make("thread-1"),
    status: "running" as const,
    providerName: "Codex",
    providerInstanceId: ProviderInstanceId.make("codex"),
    runtimeMode: DEFAULT_RUNTIME_MODE,
    activeTurnId: "turn-1" as never,
    lastError: null,
    updatedAt: "2026-03-09T10:02:00.000Z",
  };

  it("uses the running turn's start time", () => {
    expect(
      resolveWorkingStartedAt({
        latestTurn: makeLatestTurn({ completedAt: null }),
        session,
      }),
    ).toBe("2026-03-09T10:00:00.000Z");
  });

  it("uses the request time while a turn awaits adoption", () => {
    expect(
      resolveWorkingStartedAt({
        latestTurn: makeLatestTurn({ startedAt: null, completedAt: null }),
        session,
      }),
    ).toBe("2026-03-09T10:00:00.000Z");
  });

  it("falls back to the session transition when the latest turn already completed", () => {
    expect(
      resolveWorkingStartedAt({
        latestTurn: makeLatestTurn(),
        session,
      }),
    ).toBe("2026-03-09T10:02:00.000Z");
  });

  it("skips a malformed startedAt instead of returning it", () => {
    expect(
      resolveWorkingStartedAt({
        latestTurn: makeLatestTurn({ startedAt: "not-a-date", completedAt: null }),
        session,
      }),
    ).toBe("2026-03-09T10:00:00.000Z");
  });

  it("returns null with neither a running turn nor a session", () => {
    expect(resolveWorkingStartedAt({ latestTurn: null, session: null })).toBeNull();
  });
});

describe("formatWorkingDurationLabel", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatWorkingDurationLabel(0)).toBe("0s");
    expect(formatWorkingDurationLabel(42_000)).toBe("42s");
    expect(formatWorkingDurationLabel(5 * 60_000)).toBe("5m");
    expect(formatWorkingDurationLabel(90 * 60_000)).toBe("1h 30m");
  });

  it("clamps negative and non-finite elapsed values to zero", () => {
    expect(formatWorkingDurationLabel(-5_000)).toBe("0s");
    expect(formatWorkingDurationLabel(Number.NaN)).toBe("0s");
  });
});

describe("resolveThreadStatusPill", () => {
  const baseThread = {
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    interactionMode: "plan" as const,
    latestTurn: null,
    lastVisitedAt: undefined,
    session: {
      threadId: ThreadId.make("thread-1"),
      status: "running" as const,
      providerName: "Codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: DEFAULT_RUNTIME_MODE,
      activeTurnId: "turn-1" as never,
      lastError: null,
      updatedAt: "2026-03-09T10:00:00.000Z",
    },
  };

  it("shows pending approval before all other statuses", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          hasPendingApprovals: true,
          hasPendingUserInput: true,
        },
      }),
    ).toMatchObject({ label: "Pending Approval", pulse: false });
  });

  it("shows awaiting input when plan mode is blocked on user answers", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          hasPendingUserInput: true,
        },
      }),
    ).toMatchObject({ label: "Awaiting Input", pulse: false });
  });

  it("falls back to working when the thread is actively running without blockers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
      }),
    ).toMatchObject({ label: "Working", pulse: true });
  });

  it("shows plan ready when a settled plan turn has a proposed plan ready for follow-up", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          hasActionableProposedPlan: true,
          latestTurn: makeLatestTurn(),
          session: {
            ...baseThread.session,
            status: "ready",
            activeTurnId: null,
          },
        },
      }),
    ).toMatchObject({ label: "Plan Ready", pulse: false });
  });

  it("does not manufacture completed state without a client visit marker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          session: {
            ...baseThread.session,
            status: "ready",
            activeTurnId: null,
          },
        },
      }),
    ).toBeNull();
  });

  it("shows completed when there is an unseen completion and no active blocker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          interactionMode: "default",
          latestTurn: makeLatestTurn(),
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          session: {
            ...baseThread.session,
            status: "ready",
            activeTurnId: null,
          },
        },
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });
});

describe("resolveThreadRowClassName", () => {
  it("uses the active sidebar surface when a thread is both selected and active", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: true });
    expect(className).toContain("bg-sidebar-row-active");
    expect(className).toContain("text-sidebar-foreground");
    expect(className).not.toContain("bg-primary");
  });

  it("uses selected hover colors for selected threads", () => {
    const className = resolveThreadRowClassName({ isActive: false, isSelected: true });
    expect(className).toContain("bg-sidebar-row-selected");
    expect(className).toContain("hover:bg-sidebar-row-active");
    expect(className).not.toContain("bg-primary");
  });

  it("uses the active sidebar surface for active-only threads", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: false });
    expect(className).toContain("bg-sidebar-row-active");
    expect(className).toContain("hover:bg-sidebar-row-active");
  });
});

describe("resolveProjectStatusIndicator", () => {
  it("returns null when no threads have a notable status", () => {
    expect(resolveProjectStatusIndicator([null, null])).toBeNull();
  });

  it("surfaces the highest-priority actionable state across project threads", () => {
    expect(
      resolveProjectStatusIndicator([
        {
          label: "Completed",
          colorClass: "text-emerald-600",
          dotClass: "bg-emerald-500",
          pulse: false,
        },
        {
          label: "Pending Approval",
          colorClass: "text-amber-600",
          dotClass: "bg-amber-500",
          pulse: false,
        },
        {
          label: "Working",
          colorClass: "text-sky-600",
          dotClass: "bg-sky-500",
          pulse: true,
        },
      ]),
    ).toMatchObject({ label: "Pending Approval", dotClass: "bg-amber-500" });
  });

  it("prefers plan-ready over completed when no stronger action is needed", () => {
    expect(
      resolveProjectStatusIndicator([
        {
          label: "Completed",
          colorClass: "text-emerald-600",
          dotClass: "bg-emerald-500",
          pulse: false,
        },
        {
          label: "Plan Ready",
          colorClass: "text-violet-600",
          dotClass: "bg-violet-500",
          pulse: false,
        },
      ]),
    ).toMatchObject({ label: "Plan Ready", dotClass: "bg-violet-500" });
  });
});

describe("getVisibleThreadsForProject", () => {
  it("includes the active thread even when it falls below the folded preview", () => {
    const threads = Array.from({ length: 8 }, (_, index) =>
      makeThread({
        id: ThreadId.make(`thread-${index + 1}`),
        title: `Thread ${index + 1}`,
      }),
    );

    const result = getVisibleThreadsForProject({
      threads,
      activeThreadId: ThreadId.make("thread-8"),
      isThreadListExpanded: false,
      previewLimit: 6,
    });

    expect(result.hasHiddenThreads).toBe(true);
    expect(result.visibleThreads.map((thread) => thread.id)).toEqual([
      ThreadId.make("thread-1"),
      ThreadId.make("thread-2"),
      ThreadId.make("thread-3"),
      ThreadId.make("thread-4"),
      ThreadId.make("thread-5"),
      ThreadId.make("thread-6"),
      ThreadId.make("thread-8"),
    ]);
    expect(result.hiddenThreads.map((thread) => thread.id)).toEqual([ThreadId.make("thread-7")]);
  });

  it("returns all threads when the list is expanded", () => {
    const threads = Array.from({ length: 8 }, (_, index) =>
      makeThread({
        id: ThreadId.make(`thread-${index + 1}`),
      }),
    );

    const result = getVisibleThreadsForProject({
      threads,
      activeThreadId: ThreadId.make("thread-8"),
      isThreadListExpanded: true,
      previewLimit: 6,
    });

    expect(result.hasHiddenThreads).toBe(true);
    expect(result.visibleThreads.map((thread) => thread.id)).toEqual(
      threads.map((thread) => thread.id),
    );
    expect(result.hiddenThreads).toEqual([]);
  });
});

describe("collapseWorktreeSiblings", () => {
  type CollapsibleThread = {
    id: string;
    environmentId: string;
    worktreePath: string | null;
    createdAt: string;
  };
  const keyOf = (thread: CollapsibleThread) => `${thread.environmentId}:${thread.id}`;
  const make = (
    id: string,
    worktreePath: string | null,
    createdAt: string,
    environmentId = "env-1",
  ): CollapsibleThread => ({ id, environmentId, worktreePath, createdAt });

  it("keeps the earliest-created representative at the newest sibling's position", () => {
    const threads = [
      make("newer", "/wt/a", "2026-03-09T12:00:00.000Z"),
      make("standalone", null, "2026-03-09T11:00:00.000Z"),
      make("older", "/wt/a", "2026-03-09T10:00:00.000Z"),
    ];

    const { threads: collapsed } = collapseWorktreeSiblings(threads, keyOf);

    // "older" survives as the stable route, but the group occupies "newer"'s
    // first-place position so recent activity in any sibling promotes it.
    expect(collapsed.map((thread) => thread.id)).toEqual(["older", "standalone"]);
  });

  it("promotes a worktree when a collapsed sibling is newer than another chat", () => {
    const sortedByActivity = [
      make("new-worktree-chat", "/wt/a", "2026-03-09T12:00:00.000Z"),
      make("other-worktree", "/wt/b", "2026-03-09T11:00:00.000Z"),
      make("worktree-representative", "/wt/a", "2026-03-09T10:00:00.000Z"),
    ];

    const { threads: collapsed } = collapseWorktreeSiblings(sortedByActivity, keyOf);

    expect(collapsed.map((thread) => thread.id)).toEqual([
      "worktree-representative",
      "other-worktree",
    ]);
  });

  it("never collapses threads without a worktree", () => {
    const threads = [
      make("a", null, "2026-03-09T10:00:00.000Z"),
      make("b", null, "2026-03-09T10:00:00.000Z"),
    ];

    const { threads: collapsed } = collapseWorktreeSiblings(threads, keyOf);

    expect(collapsed.map((thread) => thread.id)).toEqual(["a", "b"]);
  });

  it("does not merge same-path worktrees across environments", () => {
    const threads = [
      make("a", "/wt/shared", "2026-03-09T10:00:00.000Z", "env-1"),
      make("b", "/wt/shared", "2026-03-09T11:00:00.000Z", "env-2"),
    ];

    const { threads: collapsed } = collapseWorktreeSiblings(threads, keyOf);

    expect(collapsed.map((thread) => thread.id)).toEqual(["a", "b"]);
  });

  it("maps every sibling and the representative to the representative's key", () => {
    const threads = [
      make("older", "/wt/a", "2026-03-09T10:00:00.000Z"),
      make("newer", "/wt/a", "2026-03-09T12:00:00.000Z"),
      make("solo", null, "2026-03-09T11:00:00.000Z"),
    ];

    const { representativeKeyByThreadKey } = collapseWorktreeSiblings(threads, keyOf);

    expect(representativeKeyByThreadKey.get("env-1:newer")).toBe("env-1:older");
    expect(representativeKeyByThreadKey.get("env-1:older")).toBe("env-1:older");
    expect(representativeKeyByThreadKey.get("env-1:solo")).toBe("env-1:solo");
  });

  it("breaks createdAt ties deterministically by id", () => {
    const threads = [
      make("beta", "/wt/a", "2026-03-09T10:00:00.000Z"),
      make("alpha", "/wt/a", "2026-03-09T10:00:00.000Z"),
    ];

    const { threads: collapsed } = collapseWorktreeSiblings(threads, keyOf);

    expect(collapsed.map((thread) => thread.id)).toEqual(["alpha"]);
  });
});

describe("resolveWorktreeWorkspaceRepresentative", () => {
  type WorkspaceThread = {
    id: string;
    environmentId: string;
    worktreePath: string | null;
    createdAt: string;
    archivedAt: string | null;
  };
  const make = (
    id: string,
    worktreePath: string | null,
    createdAt: string,
    overrides: { environmentId?: string; archivedAt?: string | null } = {},
  ): WorkspaceThread => ({
    id,
    environmentId: overrides.environmentId ?? "env-1",
    worktreePath,
    createdAt,
    archivedAt: overrides.archivedAt ?? null,
  });

  it("returns the earliest-created live sibling sharing the worktree", () => {
    const threads = [
      make("newer", "/wt/a", "2026-03-09T12:00:00.000Z"),
      make("older", "/wt/a", "2026-03-09T10:00:00.000Z"),
      make("other-wt", "/wt/b", "2026-03-09T08:00:00.000Z"),
    ];

    const representative = resolveWorktreeWorkspaceRepresentative({
      threads,
      target: { environmentId: "env-1", worktreePath: "/wt/a" },
    });

    expect(representative?.id).toBe("older");
  });

  it("returns null for threads with no worktree so the caller keeps its own ref", () => {
    const threads = [make("solo", null, "2026-03-09T10:00:00.000Z")];

    expect(
      resolveWorktreeWorkspaceRepresentative({
        threads,
        target: { environmentId: "env-1", worktreePath: null },
      }),
    ).toBeNull();
  });

  it("skips archived siblings when choosing the representative", () => {
    const threads = [
      make("archived-oldest", "/wt/a", "2026-03-09T09:00:00.000Z", {
        archivedAt: "2026-03-09T13:00:00.000Z",
      }),
      make("live-older", "/wt/a", "2026-03-09T10:00:00.000Z"),
      make("live-newer", "/wt/a", "2026-03-09T12:00:00.000Z"),
    ];

    const representative = resolveWorktreeWorkspaceRepresentative({
      threads,
      target: { environmentId: "env-1", worktreePath: "/wt/a" },
    });

    expect(representative?.id).toBe("live-older");
  });

  it("does not cross environments for the same worktree path", () => {
    const threads = [
      make("other-env", "/wt/shared", "2026-03-09T08:00:00.000Z", { environmentId: "env-2" }),
      make("mine", "/wt/shared", "2026-03-09T10:00:00.000Z", { environmentId: "env-1" }),
    ];

    const representative = resolveWorktreeWorkspaceRepresentative({
      threads,
      target: { environmentId: "env-1", worktreePath: "/wt/shared" },
    });

    expect(representative?.id).toBe("mine");
  });

  it("breaks createdAt ties by id", () => {
    const threads = [
      make("beta", "/wt/a", "2026-03-09T10:00:00.000Z"),
      make("alpha", "/wt/a", "2026-03-09T10:00:00.000Z"),
    ];

    const representative = resolveWorktreeWorkspaceRepresentative({
      threads,
      target: { environmentId: "env-1", worktreePath: "/wt/a" },
    });

    expect(representative?.id).toBe("alpha");
  });

  const runningSession = (id: string) =>
    ({
      threadId: ThreadId.make(id),
      status: "running" as const,
      providerName: "Codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: DEFAULT_RUNTIME_MODE,
      activeTurnId: "turn-1" as never,
      lastError: null,
      updatedAt: "2026-03-09T12:01:00.000Z",
    }) satisfies NonNullable<Thread["session"]>;

  // The collapse merge reads the shell-only pending flags, so tests build
  // shell-shaped rows: a full Thread plus the two attention booleans.
  const mergeThread = (
    overrides: Partial<Thread>,
    flags: { hasPendingApprovals?: boolean; hasPendingUserInput?: boolean } = {},
  ) => ({
    ...makeThread(overrides),
    hasPendingApprovals: flags.hasPendingApprovals ?? false,
    hasPendingUserInput: flags.hasPendingUserInput ?? false,
  });

  it("projects a running sibling's status onto the representative row", () => {
    const representative = mergeThread({
      id: ThreadId.make("older"),
      worktreePath: "/wt/a",
      createdAt: "2026-03-09T10:00:00.000Z",
    });
    const runningSibling = mergeThread({
      id: ThreadId.make("newer"),
      worktreePath: "/wt/a",
      createdAt: "2026-03-09T12:00:00.000Z",
      session: runningSession("newer"),
    });

    const { threads: collapsed } = collapseWorktreeSiblings(
      [representative, runningSibling],
      (thread) => `${thread.environmentId}:${thread.id}`,
      mergeWorktreeSiblingRunningStatus,
    );

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.id).toBe("older");
    const representativeStatus = { ...collapsed[0]!, hasActionableProposedPlan: false };
    expect(resolveSidebarV2Status(representativeStatus)).toBe("working");
    expect(resolveThreadStatusPill({ thread: representativeStatus })?.label).toBe("Working");
  });

  it("surfaces a sibling awaiting input as Input over the running Working state", () => {
    // Representative is idle; one sibling is running, another is waiting on the
    // user. The row must read "Input" — needing the user beats "Working".
    const representative = mergeThread({
      id: ThreadId.make("older"),
      worktreePath: "/wt/a",
      createdAt: "2026-03-09T10:00:00.000Z",
    });
    const runningSibling = mergeThread({
      id: ThreadId.make("running"),
      worktreePath: "/wt/a",
      createdAt: "2026-03-09T11:00:00.000Z",
      session: runningSession("running"),
    });
    const inputSibling = mergeThread(
      {
        id: ThreadId.make("waiting"),
        worktreePath: "/wt/a",
        createdAt: "2026-03-09T12:00:00.000Z",
        session: runningSession("waiting"),
      },
      { hasPendingUserInput: true },
    );

    const { threads: collapsed } = collapseWorktreeSiblings(
      [representative, runningSibling, inputSibling],
      (thread) => `${thread.environmentId}:${thread.id}`,
      mergeWorktreeSiblingRunningStatus,
    );

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.id).toBe("older");
    const representativeStatus = { ...collapsed[0]!, hasActionableProposedPlan: false };
    expect(resolveSidebarV2Status(representativeStatus)).toBe("input");
    expect(resolveThreadStatusPill({ thread: representativeStatus })?.label).toBe("Awaiting Input");
  });

  it("surfaces a sibling pending approval as Approval over Input and Working", () => {
    const representative = mergeThread({
      id: ThreadId.make("older"),
      worktreePath: "/wt/a",
      createdAt: "2026-03-09T10:00:00.000Z",
    });
    const inputSibling = mergeThread(
      {
        id: ThreadId.make("waiting"),
        worktreePath: "/wt/a",
        createdAt: "2026-03-09T11:00:00.000Z",
        session: runningSession("waiting"),
      },
      { hasPendingUserInput: true },
    );
    const approvalSibling = mergeThread(
      {
        id: ThreadId.make("approve"),
        worktreePath: "/wt/a",
        createdAt: "2026-03-09T12:00:00.000Z",
        session: runningSession("approve"),
      },
      { hasPendingApprovals: true },
    );

    const { threads: collapsed } = collapseWorktreeSiblings(
      [representative, inputSibling, approvalSibling],
      (thread) => `${thread.environmentId}:${thread.id}`,
      mergeWorktreeSiblingRunningStatus,
    );

    expect(collapsed).toHaveLength(1);
    const representativeStatus = { ...collapsed[0]!, hasActionableProposedPlan: false };
    expect(resolveSidebarV2Status(representativeStatus)).toBe("approval");
  });
});

describe("collectWorktreeSiblingThreads", () => {
  type SiblingThread = {
    id: string;
    environmentId: string;
    worktreePath: string | null;
    createdAt: string;
    archivedAt: string | null;
  };
  const make = (
    id: string,
    worktreePath: string | null,
    overrides: Partial<SiblingThread> = {},
  ): SiblingThread => ({
    id,
    environmentId: "env-1",
    worktreePath,
    createdAt: "2026-03-09T10:00:00.000Z",
    archivedAt: null,
    ...overrides,
  });

  it("returns every non-archived chat sharing the target's worktree", () => {
    const threads = [
      make("a", "/wt/a"),
      make("b", "/wt/a"),
      make("c", "/wt/other"),
      make("solo", null),
    ];

    const collected = collectWorktreeSiblingThreads({ threads, target: threads[0]! });

    // Both /wt/a chats archive together; unrelated worktrees stay untouched.
    expect(collected.map((thread) => thread.id)).toEqual(["a", "b"]);
  });

  it("preserves input order so navigation and toasts stay stable", () => {
    const threads = [make("b", "/wt/a"), make("a", "/wt/a")];

    const collected = collectWorktreeSiblingThreads({ threads, target: threads[1]! });

    expect(collected.map((thread) => thread.id)).toEqual(["b", "a"]);
  });

  it("skips already-archived siblings", () => {
    const threads = [
      make("a", "/wt/a"),
      make("b", "/wt/a", { archivedAt: "2026-03-09T11:00:00.000Z" }),
    ];

    const collected = collectWorktreeSiblingThreads({ threads, target: threads[0]! });

    expect(collected.map((thread) => thread.id)).toEqual(["a"]);
  });

  it("archives only the target itself when it has no worktree", () => {
    const threads = [make("solo", null), make("other", null)];

    const collected = collectWorktreeSiblingThreads({ threads, target: threads[0]! });

    expect(collected.map((thread) => thread.id)).toEqual(["solo"]);
  });

  it("never crosses environment boundaries for a shared worktree path", () => {
    const threads = [
      make("a", "/wt/shared", { environmentId: "env-1" }),
      make("b", "/wt/shared", { environmentId: "env-2" }),
    ];

    const collected = collectWorktreeSiblingThreads({ threads, target: threads[0]! });

    expect(collected.map((thread) => thread.id)).toEqual(["a"]);
  });
});

describe("resolveWorktreeActiveThread", () => {
  type ActiveThread = {
    id: string;
    environmentId: string;
    worktreePath: string | null;
    createdAt: string;
    archivedAt: string | null;
    settledAt: string | null;
    latestUserMessageAt: string | null;
    latestTurn: null;
    updatedAt: string;
  };
  const keyOf = (thread: ActiveThread) => `${thread.environmentId}:${thread.id}`;
  const make = (
    id: string,
    worktreePath: string | null,
    createdAt: string,
    overrides: Partial<ActiveThread> = {},
  ): ActiveThread => ({
    id,
    environmentId: "env-1",
    worktreePath,
    createdAt,
    archivedAt: null,
    settledAt: null,
    latestUserMessageAt: null,
    latestTurn: null,
    updatedAt: createdAt,
    ...overrides,
  });

  it("returns the clicked thread when it has no worktree", () => {
    const clicked = make("solo", null, "2026-03-09T10:00:00.000Z");
    const result = resolveWorktreeActiveThread({
      threads: [clicked],
      clicked,
      keyOf,
      lastVisitedAtByKey: {},
    });
    expect(result.id).toBe("solo");
  });

  it("opens the sibling the user visited most recently", () => {
    const older = make("older", "/wt/a", "2026-03-09T10:00:00.000Z");
    const newer = make("newer", "/wt/a", "2026-03-09T12:00:00.000Z");
    const result = resolveWorktreeActiveThread({
      threads: [older, newer],
      clicked: older,
      keyOf,
      lastVisitedAtByKey: {
        "env-1:older": "2026-03-09T13:00:00.000Z",
        "env-1:newer": "2026-03-09T14:00:00.000Z",
      },
    });
    expect(result.id).toBe("newer");
  });

  it("falls back to server activity for chats never visited", () => {
    const older = make("older", "/wt/a", "2026-03-09T10:00:00.000Z");
    const newer = make("newer", "/wt/a", "2026-03-09T12:00:00.000Z", {
      latestUserMessageAt: "2026-03-09T15:00:00.000Z",
      updatedAt: "2026-03-09T15:00:00.000Z",
    });
    const result = resolveWorktreeActiveThread({
      threads: [older, newer],
      clicked: older,
      keyOf,
      lastVisitedAtByKey: {},
    });
    expect(result.id).toBe("newer");
  });

  it("prefers the chat the user opened over a sibling with newer server activity", () => {
    const opened = make("opened", "/wt/a", "2026-03-09T10:00:00.000Z");
    const busier = make("busier", "/wt/a", "2026-03-09T12:00:00.000Z", {
      latestUserMessageAt: "2026-03-09T18:00:00.000Z",
      updatedAt: "2026-03-09T18:00:00.000Z",
    });
    const result = resolveWorktreeActiveThread({
      threads: [opened, busier],
      clicked: opened,
      keyOf,
      lastVisitedAtByKey: {
        "env-1:opened": "2026-03-09T13:00:00.000Z",
      },
    });
    expect(result.id).toBe("opened");
  });

  it("ignores archived siblings and siblings in other worktrees", () => {
    const clicked = make("clicked", "/wt/a", "2026-03-09T10:00:00.000Z");
    const archived = make("archived", "/wt/a", "2026-03-09T11:00:00.000Z", {
      archivedAt: "2026-03-09T20:00:00.000Z",
      updatedAt: "2026-03-09T20:00:00.000Z",
    });
    const otherWorktree = make("other", "/wt/b", "2026-03-09T11:00:00.000Z", {
      updatedAt: "2026-03-09T21:00:00.000Z",
    });
    const result = resolveWorktreeActiveThread({
      threads: [clicked, archived, otherWorktree],
      clicked,
      keyOf,
      lastVisitedAtByKey: {
        "env-1:archived": "2026-03-09T22:00:00.000Z",
        "env-1:other": "2026-03-09T23:00:00.000Z",
      },
    });
    expect(result.id).toBe("clicked");
  });

  it("keeps the earliest-created chat when siblings share the same activity", () => {
    const older = make("older", "/wt/a", "2026-03-09T10:00:00.000Z", {
      updatedAt: "2026-03-09T18:00:00.000Z",
    });
    const newer = make("newer", "/wt/a", "2026-03-09T12:00:00.000Z", {
      updatedAt: "2026-03-09T18:00:00.000Z",
    });
    const result = resolveWorktreeActiveThread({
      threads: [newer, older],
      clicked: newer,
      keyOf,
      lastVisitedAtByKey: {},
    });
    expect(result.id).toBe("older");
  });
});

function makeProject(overrides: Partial<Project> = {}): Project {
  const { defaultModelSelection, reviewModelSelection = null, ...rest } = overrides;
  return {
    id: ProjectId.make("project-1"),
    environmentId: localEnvironmentId,
    title: "Project",
    workspaceRoot: "/tmp/project",
    repositoryIdentity: null,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      ...defaultModelSelection,
    },
    reviewModelSelection,
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    scripts: [],
    gitHubAccount: null,
    worktreeBranchPrefix: null,
    defaultWorktreeBranch: null,
    previewPort: null,
    worktreeCopyFiles: [],
    ...rest,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: localEnvironmentId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      ...overrides?.modelSelection,
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    createdAt: "2026-03-09T10:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    updatedAt: "2026-03-09T10:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    checkpoints: [],
    activities: [],
    ...overrides,
  };
}

describe("getFallbackThreadIdAfterDelete", () => {
  it("returns the top remaining thread in the deleted thread's project sidebar order", () => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.make("thread-oldest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:00:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-active"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-newest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-other-project"),
          projectId: ProjectId.make("project-2"),
          createdAt: "2026-03-09T10:20:00.000Z",
          messages: [],
        }),
      ],
      deletedThreadId: ThreadId.make("thread-active"),
      sortOrder: "created_at",
    });

    expect(fallbackThreadId).toBe(ThreadId.make("thread-newest"));
  });

  it("skips other threads being deleted in the same action", () => {
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads: [
        makeThread({
          id: ThreadId.make("thread-active"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-newest"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-next"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:07:00.000Z",
          messages: [],
        }),
      ],
      deletedThreadId: ThreadId.make("thread-active"),
      deletedThreadIds: new Set([ThreadId.make("thread-active"), ThreadId.make("thread-newest")]),
      sortOrder: "created_at",
    });

    expect(fallbackThreadId).toBe(ThreadId.make("thread-next"));
  });
});

describe("getFallbackThreadAfterArchive", () => {
  it("prefers another active thread in the archived thread's project", () => {
    const fallback = getFallbackThreadAfterArchive({
      threads: [
        makeThread({
          id: ThreadId.make("thread-active"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-same-project"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:10:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-other-project"),
          projectId: ProjectId.make("project-2"),
          createdAt: "2026-03-09T10:20:00.000Z",
          messages: [],
        }),
      ],
      archivedThreadId: ThreadId.make("thread-active"),
      archivedThreadEnvironmentId: localEnvironmentId,
      sortOrder: "created_at",
    });

    expect(fallback?.id).toBe(ThreadId.make("thread-same-project"));
  });

  it("falls back across projects instead of creating an empty draft", () => {
    const fallback = getFallbackThreadAfterArchive({
      threads: [
        makeThread({
          id: ThreadId.make("thread-active"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
        makeThread({
          id: ThreadId.make("thread-existing"),
          environmentId: EnvironmentId.make("environment-remote"),
          projectId: ProjectId.make("project-2"),
          createdAt: "2026-03-09T10:20:00.000Z",
          messages: [],
        }),
      ],
      archivedThreadId: ThreadId.make("thread-active"),
      archivedThreadEnvironmentId: localEnvironmentId,
      sortOrder: "created_at",
    });

    expect(fallback?.id).toBe(ThreadId.make("thread-existing"));
  });

  it("returns null when archiving the last active thread", () => {
    const fallback = getFallbackThreadAfterArchive({
      threads: [
        makeThread({
          id: ThreadId.make("thread-active"),
          projectId: ProjectId.make("project-1"),
          createdAt: "2026-03-09T10:05:00.000Z",
          messages: [],
        }),
      ],
      archivedThreadId: ThreadId.make("thread-active"),
      archivedThreadEnvironmentId: localEnvironmentId,
      sortOrder: "created_at",
    });

    expect(fallback).toBeNull();
  });
});
describe("groupSidebarThreadsByProject", () => {
  const resolveProjectKey = (thread: { projectKey: string | null }) => thread.projectKey;

  it("emits sections in projectOrder, preserving thread order within each", () => {
    const threads = [
      { id: "a", projectKey: "p2" },
      { id: "b", projectKey: "p1" },
      { id: "c", projectKey: "p2" },
      { id: "d", projectKey: "p1" },
    ];

    const sections = groupSidebarThreadsByProject({
      threads,
      projectOrder: ["p1", "p2"],
      resolveProjectKey,
    });

    expect(sections).toEqual([
      {
        projectKey: "p1",
        threads: [
          { id: "b", projectKey: "p1" },
          { id: "d", projectKey: "p1" },
        ],
      },
      {
        projectKey: "p2",
        threads: [
          { id: "a", projectKey: "p2" },
          { id: "c", projectKey: "p2" },
        ],
      },
    ]);
  });

  it("omits projects with no threads so no empty header renders", () => {
    const sections = groupSidebarThreadsByProject({
      threads: [{ id: "a", projectKey: "p2" }],
      projectOrder: ["p1", "p2", "p3"],
      resolveProjectKey,
    });

    expect(sections.map((section) => section.projectKey)).toEqual(["p2"]);
  });

  it("collects threads with an unknown or null project into a trailing null section", () => {
    const threads = [
      { id: "a", projectKey: "p1" },
      { id: "b", projectKey: "missing" },
      { id: "c", projectKey: null },
    ];

    const sections = groupSidebarThreadsByProject({
      threads,
      projectOrder: ["p1"],
      resolveProjectKey,
    });

    expect(sections).toEqual([
      { projectKey: "p1", threads: [{ id: "a", projectKey: "p1" }] },
      {
        projectKey: null,
        threads: [
          { id: "b", projectKey: "missing" },
          { id: "c", projectKey: null },
        ],
      },
    ]);
    // No thread is dropped: the flattened order still covers every input.
    expect(sections.flatMap((section) => section.threads)).toHaveLength(threads.length);
  });
});
describe("sortProjectsForSidebar", () => {
  it("sorts projects by the most recent user message across their threads", () => {
    const projects = [
      makeProject({ id: ProjectId.make("project-1"), title: "Older project" }),
      makeProject({ id: ProjectId.make("project-2"), title: "Newer project" }),
    ];
    const threads = [
      makeThread({
        projectId: ProjectId.make("project-1"),
        updatedAt: "2026-03-09T10:20:00.000Z",
        messages: [
          {
            id: "message-1" as never,
            role: "user",
            text: "older project user message",
            turnId: null,
            createdAt: "2026-03-09T10:01:00.000Z",
            updatedAt: "2026-03-09T10:01:00.000Z",
            streaming: false,
          },
        ],
      }),
      makeThread({
        id: ThreadId.make("thread-2"),
        projectId: ProjectId.make("project-2"),
        updatedAt: "2026-03-09T10:05:00.000Z",
        messages: [
          {
            id: "message-2" as never,
            role: "user",
            text: "newer project user message",
            turnId: null,
            createdAt: "2026-03-09T10:05:00.000Z",
            updatedAt: "2026-03-09T10:05:00.000Z",
            streaming: false,
          },
        ],
      }),
    ];

    const sorted = sortProjectsForSidebar(projects, threads, "updated_at");

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("falls back to project timestamps when a project has no threads", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.make("project-1"),
          title: "Older project",
          updatedAt: "2026-03-09T10:01:00.000Z",
        }),
        makeProject({
          id: ProjectId.make("project-2"),
          title: "Newer project",
          updatedAt: "2026-03-09T10:05:00.000Z",
        }),
      ],
      [],
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("falls back to name and id ordering when projects have no sortable timestamps", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.make("project-2"),
          title: "Beta",
          createdAt: "invalid-created-at" as never,
          updatedAt: "invalid-updated-at" as never,
        }),
        makeProject({
          id: ProjectId.make("project-1"),
          title: "Alpha",
          createdAt: "invalid-created-at" as never,
          updatedAt: "invalid-updated-at" as never,
        }),
      ],
      [],
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-1"),
      ProjectId.make("project-2"),
    ]);
  });

  it("preserves manual project ordering", () => {
    const projects = [
      makeProject({ id: ProjectId.make("project-2"), title: "Second" }),
      makeProject({ id: ProjectId.make("project-1"), title: "First" }),
    ];

    const sorted = sortProjectsForSidebar(projects, [], "manual");

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("keeps a project's position when its most recent thread is archived", () => {
    const sorted = sortProjectsForSidebar(
      [
        makeProject({
          id: ProjectId.make("project-1"),
          title: "Visible project",
          updatedAt: "2026-03-09T10:01:00.000Z",
        }),
        makeProject({
          id: ProjectId.make("project-2"),
          title: "Recently archived project",
          updatedAt: "2026-03-09T10:00:00.000Z",
        }),
      ],
      [
        makeThread({
          id: ThreadId.make("thread-visible"),
          projectId: ProjectId.make("project-1"),
          updatedAt: "2026-03-09T10:02:00.000Z",
          archivedAt: null,
        }),
        // Archived, but its activity is still the most recent, so archiving it
        // must not push project-2 below project-1.
        makeThread({
          id: ThreadId.make("thread-archived"),
          projectId: ProjectId.make("project-2"),
          updatedAt: "2026-03-09T10:10:00.000Z",
          archivedAt: "2026-03-09T10:11:00.000Z",
        }),
      ],
      "updated_at",
    );

    expect(sorted.map((project) => project.id)).toEqual([
      ProjectId.make("project-2"),
      ProjectId.make("project-1"),
    ]);
  });

  it("returns the project timestamp when no threads are present", () => {
    const timestamp = getProjectSortTimestamp(
      makeProject({ updatedAt: "2026-03-09T10:10:00.000Z" }),
      [],
      "updated_at",
    );

    expect(timestamp).toBe(Date.parse("2026-03-09T10:10:00.000Z"));
  });
});

describe("sortScopedProjectsForSidebar", () => {
  it("keeps identical project ids in different environments separate", () => {
    const remoteEnvironmentId = EnvironmentId.make("environment-remote");
    const sharedProjectId = ProjectId.make("shared-project");
    const projects = [
      makeProject({
        environmentId: localEnvironmentId,
        id: sharedProjectId,
        title: "Local project",
      }),
      makeProject({
        environmentId: remoteEnvironmentId,
        id: sharedProjectId,
        title: "Remote project",
      }),
    ];
    const threads = [
      makeThread({
        environmentId: localEnvironmentId,
        projectId: sharedProjectId,
        updatedAt: "2026-03-09T10:02:00.000Z",
      }),
      makeThread({
        environmentId: remoteEnvironmentId,
        projectId: sharedProjectId,
        updatedAt: "2026-03-09T10:10:00.000Z",
      }),
    ];

    const sorted = sortScopedProjectsForSidebar(projects, threads, "updated_at");

    expect(sorted.map((project) => project.title)).toEqual(["Remote project", "Local project"]);
  });

  it("keeps a project's position when its most recent thread is archived", () => {
    const projects = [
      makeProject({
        id: ProjectId.make("project-visible"),
        title: "Visible project",
        updatedAt: "2026-03-09T10:01:00.000Z",
      }),
      makeProject({
        id: ProjectId.make("project-archived"),
        title: "Recently archived project",
        updatedAt: "2026-03-09T10:00:00.000Z",
      }),
    ];
    const threads = [
      makeThread({
        id: ThreadId.make("thread-visible"),
        projectId: ProjectId.make("project-visible"),
        updatedAt: "2026-03-09T10:02:00.000Z",
      }),
      // Archiving this thread must not reorder the projects: its activity is
      // still the most recent, so its project stays on top.
      makeThread({
        id: ThreadId.make("thread-archived"),
        projectId: ProjectId.make("project-archived"),
        updatedAt: "2026-03-09T10:10:00.000Z",
        archivedAt: "2026-03-09T10:11:00.000Z",
      }),
    ];

    const sorted = sortScopedProjectsForSidebar(projects, threads, "updated_at");

    expect(sorted.map((project) => project.title)).toEqual([
      "Recently archived project",
      "Visible project",
    ]);
  });
});

describe("sortLogicalProjectsForSidebar", () => {
  it("uses saved order only in manual mode and activity order otherwise", () => {
    const olderProjectId = ProjectId.make("project-older");
    const newerProjectId = ProjectId.make("project-newer");
    const projects = [
      {
        ...makeProject({ id: olderProjectId, title: "Older project" }),
        projectKey: "logical-older",
        memberProjectRefs: [{ environmentId: localEnvironmentId, projectId: olderProjectId }],
      },
      {
        ...makeProject({ id: newerProjectId, title: "Newer project" }),
        projectKey: "logical-newer",
        memberProjectRefs: [{ environmentId: localEnvironmentId, projectId: newerProjectId }],
      },
    ];
    const threads = [
      makeThread({
        projectId: olderProjectId,
        updatedAt: "2026-03-09T10:01:00.000Z",
      }),
      makeThread({
        id: ThreadId.make("thread-newer"),
        projectId: newerProjectId,
        updatedAt: "2026-03-09T10:05:00.000Z",
      }),
    ];

    expect(sortLogicalProjectsForSidebar(projects, threads, "manual")).toEqual(projects);
    expect(
      sortLogicalProjectsForSidebar(projects, threads, "updated_at").map(
        (project) => project.projectKey,
      ),
    ).toEqual(["logical-newer", "logical-older"]);
  });
});
