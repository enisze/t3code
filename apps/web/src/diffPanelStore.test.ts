import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectThreadDiffPanelSelection, useDiffPanelStore } from "./diffPanelStore";

const ENV = EnvironmentId.make("environment-1");
const THREAD_REF = scopeThreadRef(ENV, ThreadId.make("thread-1"));
// A worktree's representative (shared) thread plus two sibling chats.
const REP_REF = scopeThreadRef(ENV, ThreadId.make("rep"));
const CHAT_A = scopeThreadRef(ENV, ThreadId.make("chat-a"));
const CHAT_B = scopeThreadRef(ENV, ThreadId.make("chat-b"));

function selectFor(sharedRef = THREAD_REF) {
  return selectThreadDiffPanelSelection(useDiffPanelStore.getState(), sharedRef);
}

describe("diffPanelStore", () => {
  beforeEach(() =>
    useDiffPanelStore.setState({
      gitScopeByThreadKey: {},
      branchBaseRefByThreadKey: {},
      turnByThreadKey: {},
    }),
  );

  it("defaults each thread to the combined working tree changes", () => {
    expect(selectFor()).toEqual({ kind: "all" });
  });

  it("selects the combined working tree scope", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "all");

    expect(selectFor()).toEqual({ kind: "all" });
  });

  it("preserves an explicit scope selection when the working tree state changes", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(selectFor()).toEqual({ kind: "branch", baseRef: null });
  });

  it("clears incompatible selection fields when changing scopes", () => {
    const store = useDiffPanelStore.getState();
    store.selectTurn(THREAD_REF, THREAD_REF, TurnId.make("turn-1"), "src/app.ts");
    store.selectGitScope(THREAD_REF, "unstaged");

    expect(selectFor()).toEqual({ kind: "unstaged" });

    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, " origin/main ");
    expect(selectFor()).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("increments the reveal request when opening the same turn file again", () => {
    const turnId = TurnId.make("turn-1");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, THREAD_REF, turnId, "src/app.ts");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, THREAD_REF, turnId, "src/app.ts");

    expect(selectFor()).toEqual({
      kind: "turn",
      turnId,
      threadId: THREAD_REF.threadId,
      filePath: "src/app.ts",
      revealRequestId: 2,
    });
  });

  it("restores the selected branch base after visiting another scope", () => {
    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, "origin/main");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "unstaged");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "branch");

    expect(selectFor()).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("reconciles a missing turn selection to the latest available turn", () => {
    const missingTurnId = TurnId.make("turn-missing");
    const latestTurnId = TurnId.make("turn-latest");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, THREAD_REF, missingTurnId, "src/app.ts");
    useDiffPanelStore.getState().reconcileTurnSelection(THREAD_REF, THREAD_REF, [latestTurnId]);

    expect(selectFor()).toEqual({
      kind: "turn",
      turnId: latestTurnId,
      threadId: THREAD_REF.threadId,
      filePath: "src/app.ts",
      revealRequestId: 1,
    });
  });

  it("keeps one turn selection for the whole worktree, tagged with its chat", () => {
    // Sibling chats share the worktree representative, so a turn picked in one
    // chat is what every chat in that worktree shows.
    useDiffPanelStore.getState().selectTurn(REP_REF, CHAT_A, TurnId.make("turn-a"));

    expect(selectFor(REP_REF)).toEqual({
      kind: "turn",
      turnId: TurnId.make("turn-a"),
      threadId: CHAT_A.threadId,
      filePath: null,
      revealRequestId: 1,
    });

    // Picking a turn from the sibling chat retargets the shared selection.
    useDiffPanelStore.getState().selectTurn(REP_REF, CHAT_B, TurnId.make("turn-b"));
    expect(selectFor(REP_REF)).toEqual({
      kind: "turn",
      turnId: TurnId.make("turn-b"),
      threadId: CHAT_B.threadId,
      filePath: null,
      revealRequestId: 2,
    });

    // Choosing a git scope leaves the turn view for the whole worktree.
    useDiffPanelStore.getState().selectGitScope(REP_REF, "unstaged");
    expect(selectFor(REP_REF)).toEqual({ kind: "unstaged" });
  });

  it("does not let a sibling chat's turns reconcile another chat's selection", () => {
    useDiffPanelStore.getState().selectTurn(REP_REF, CHAT_A, TurnId.make("turn-a"), "src/app.ts");
    // Chat B is open, but the selection belongs to chat A: B's turn list says
    // nothing about whether A's turn still exists.
    useDiffPanelStore.getState().reconcileTurnSelection(REP_REF, CHAT_B, [TurnId.make("turn-b")]);

    expect(selectFor(REP_REF)).toEqual({
      kind: "turn",
      turnId: TurnId.make("turn-a"),
      threadId: CHAT_A.threadId,
      filePath: "src/app.ts",
      revealRequestId: 1,
    });
  });

  it("clears a turn selection back to the worktree's git scope", () => {
    useDiffPanelStore.getState().selectGitScope(REP_REF, "branch");
    useDiffPanelStore.getState().selectTurn(REP_REF, CHAT_A, TurnId.make("turn-a"));
    // The owning chat is gone, so the turn view drops back to the scope the
    // worktree was on before it.
    useDiffPanelStore.getState().clearTurnSelection(REP_REF);

    expect(selectFor(REP_REF)).toEqual({ kind: "branch", baseRef: null });
  });

  it("keeps worktrees independent", () => {
    const OTHER_REP = scopeThreadRef(ENV, ThreadId.make("rep-2"));
    useDiffPanelStore.getState().selectTurn(REP_REF, CHAT_A, TurnId.make("turn-a"));
    useDiffPanelStore.getState().selectGitScope(OTHER_REP, "branch");

    expect(selectFor(REP_REF)).toMatchObject({ kind: "turn", turnId: TurnId.make("turn-a") });
    expect(selectFor(OTHER_REP)).toEqual({ kind: "branch", baseRef: null });
  });
});
