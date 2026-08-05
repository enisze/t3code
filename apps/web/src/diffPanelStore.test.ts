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

function selectFor(chatRef = THREAD_REF, sharedRef = THREAD_REF, hasWorkingTreeChanges = false) {
  return selectThreadDiffPanelSelection(
    useDiffPanelStore.getState(),
    chatRef,
    sharedRef,
    hasWorkingTreeChanges,
  );
}

describe("diffPanelStore", () => {
  beforeEach(() =>
    useDiffPanelStore.setState({
      gitScopeByThreadKey: {},
      branchBaseRefByThreadKey: {},
      turnByThreadKey: {},
    }),
  );

  it("defaults each thread to branch changes when the working tree is clean", () => {
    expect(selectFor()).toEqual({ kind: "branch", baseRef: null });
  });

  it("defaults each thread to working changes when the working tree is dirty", () => {
    expect(selectFor(THREAD_REF, THREAD_REF, true)).toEqual({ kind: "unstaged" });
  });

  it("preserves an explicit scope selection when the working tree state changes", () => {
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, THREAD_REF, "branch");

    expect(selectFor(THREAD_REF, THREAD_REF, true)).toEqual({ kind: "branch", baseRef: null });
  });

  it("clears incompatible selection fields when changing scopes", () => {
    const store = useDiffPanelStore.getState();
    store.selectTurn(THREAD_REF, TurnId.make("turn-1"), "src/app.ts");
    store.selectGitScope(THREAD_REF, THREAD_REF, "unstaged");

    expect(selectFor()).toEqual({ kind: "unstaged" });

    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, THREAD_REF, " origin/main ");
    expect(selectFor()).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("increments the reveal request when opening the same turn file again", () => {
    const turnId = TurnId.make("turn-1");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, turnId, "src/app.ts");

    expect(selectFor()).toEqual({
      kind: "turn",
      turnId,
      filePath: "src/app.ts",
      revealRequestId: 2,
    });
  });

  it("restores the selected branch base after visiting another scope", () => {
    useDiffPanelStore.getState().selectBranchBaseRef(THREAD_REF, THREAD_REF, "origin/main");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, THREAD_REF, "unstaged");
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, THREAD_REF, "branch");

    expect(selectFor()).toEqual({ kind: "branch", baseRef: "origin/main" });
  });

  it("reconciles a missing turn selection to the latest available turn", () => {
    const missingTurnId = TurnId.make("turn-missing");
    const latestTurnId = TurnId.make("turn-latest");
    useDiffPanelStore.getState().selectTurn(THREAD_REF, missingTurnId, "src/app.ts");
    useDiffPanelStore.getState().reconcileTurnSelection(THREAD_REF, [latestTurnId]);

    expect(selectFor()).toEqual({
      kind: "turn",
      turnId: latestTurnId,
      filePath: "src/app.ts",
      revealRequestId: 1,
    });
  });

  it("keeps turn selection per chat while sharing the working-tree/branch view", () => {
    // Sibling chats share the worktree representative for their git scope but
    // each own their turn selection.
    useDiffPanelStore.getState().selectGitScope(REP_REF, CHAT_A, "unstaged");
    useDiffPanelStore.getState().selectTurn(CHAT_A, TurnId.make("turn-a"));
    useDiffPanelStore.getState().selectTurn(CHAT_B, TurnId.make("turn-b"));

    // Each chat sees its own turn; neither clobbers the other.
    expect(selectFor(CHAT_A, REP_REF)).toEqual({
      kind: "turn",
      turnId: TurnId.make("turn-a"),
      filePath: null,
      revealRequestId: 1,
    });
    expect(selectFor(CHAT_B, REP_REF)).toEqual({
      kind: "turn",
      turnId: TurnId.make("turn-b"),
      filePath: null,
      revealRequestId: 1,
    });

    // Switching chat A back to a git scope drops only chat A's turn and leaves
    // chat B's intact; the shared scope stays working-tree for both.
    useDiffPanelStore.getState().selectGitScope(REP_REF, CHAT_A, "unstaged");
    expect(selectFor(CHAT_A, REP_REF)).toEqual({ kind: "unstaged" });
    expect(selectFor(CHAT_B, REP_REF)).toEqual({
      kind: "turn",
      turnId: TurnId.make("turn-b"),
      filePath: null,
      revealRequestId: 1,
    });
  });

  it("does not let one chat's missing turn reconcile against a sibling's turns", () => {
    useDiffPanelStore.getState().selectTurn(CHAT_A, TurnId.make("turn-a"), "src/app.ts");
    // Chat B's available turns must not rewrite chat A's selection.
    useDiffPanelStore.getState().reconcileTurnSelection(CHAT_B, [TurnId.make("turn-b")]);

    expect(selectFor(CHAT_A, REP_REF)).toEqual({
      kind: "turn",
      turnId: TurnId.make("turn-a"),
      filePath: "src/app.ts",
      revealRequestId: 1,
    });
  });
});
