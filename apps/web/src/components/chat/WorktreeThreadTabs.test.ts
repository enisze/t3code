import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  getReusableNewChatDraft,
  getWorktreeTabAfterClose,
  isWorktreeThreadInProgress,
  resolveWorktreeTabStatus,
} from "./WorktreeThreadTabs";

function shell(id: string): EnvironmentThreadShell {
  return {
    id: ThreadId.make(id),
    environmentId: EnvironmentId.make("environment-1"),
    projectId: ProjectId.make("project-1"),
  } as EnvironmentThreadShell;
}

describe("getWorktreeTabAfterClose", () => {
  const tabs = [shell("thread-1"), shell("thread-2"), shell("thread-3")];

  it("prefers the next tab", () => {
    expect(getWorktreeTabAfterClose(tabs, ThreadId.make("thread-2"))?.id).toBe("thread-3");
  });

  it("falls back to the previous tab when closing the last one", () => {
    expect(getWorktreeTabAfterClose(tabs, ThreadId.make("thread-3"))?.id).toBe("thread-2");
  });

  it("returns null when no sibling remains", () => {
    expect(getWorktreeTabAfterClose([tabs[0]!], ThreadId.make("thread-1"))).toBeNull();
  });
});

describe("isWorktreeThreadInProgress", () => {
  it.each(["starting", "running"] as const)("reports %s chats as in progress", (status) => {
    expect(
      isWorktreeThreadInProgress({
        ...shell("thread-1"),
        session: { status },
      } as EnvironmentThreadShell),
    ).toBe(true);
  });

  it("does not report an idle chat as in progress", () => {
    expect(
      isWorktreeThreadInProgress({
        ...shell("thread-1"),
        session: { status: "ready" },
      } as EnvironmentThreadShell),
    ).toBe(false);
  });
});

describe("resolveWorktreeTabStatus", () => {
  function statusShell(overrides: Record<string, unknown>): EnvironmentThreadShell {
    return {
      ...shell("thread-1"),
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      session: { status: "running" },
      ...overrides,
    } as EnvironmentThreadShell;
  }

  it("prioritizes pending approvals over a running session", () => {
    expect(resolveWorktreeTabStatus(statusShell({ hasPendingApprovals: true }))).toBe("approval");
  });

  it("surfaces pending user input over a running session", () => {
    expect(resolveWorktreeTabStatus(statusShell({ hasPendingUserInput: true }))).toBe("input");
  });

  it("ranks approval above input when both are pending", () => {
    expect(
      resolveWorktreeTabStatus(
        statusShell({ hasPendingApprovals: true, hasPendingUserInput: true }),
      ),
    ).toBe("approval");
  });

  it.each(["starting", "running"] as const)("reports a %s session as working", (status) => {
    expect(resolveWorktreeTabStatus(statusShell({ session: { status } }))).toBe("working");
  });

  it("reports a settled chat as idle", () => {
    expect(resolveWorktreeTabStatus(statusShell({ session: { status: "ready" } }))).toBe("idle");
  });
});

describe("getReusableNewChatDraft", () => {
  const draft = (draftId: string, threadId: string) => ({
    draftId,
    threadId: ThreadId.make(threadId),
  });
  const drafts = [draft("draft-1", "thread-a"), draft("draft-2", "thread-b")];

  it("starts a new chat when the strip has no unsent draft", () => {
    expect(getReusableNewChatDraft([], [shell("thread-1")], null)).toBeNull();
  });

  it("returns to the newest unsent draft", () => {
    expect(getReusableNewChatDraft(drafts, [], null)?.draftId).toBe("draft-2");
  });

  it("keeps the draft on screen", () => {
    expect(getReusableNewChatDraft(drafts, [], "draft-1")?.draftId).toBe("draft-1");
  });

  it("skips a draft that was just sent", () => {
    expect(getReusableNewChatDraft(drafts, [shell("thread-b")], "draft-2")?.draftId).toBe(
      "draft-1",
    );
    expect(
      getReusableNewChatDraft(drafts, [shell("thread-a"), shell("thread-b")], null),
    ).toBeNull();
  });
});
