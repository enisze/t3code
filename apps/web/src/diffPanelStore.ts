import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadId, TurnId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export type DiffPanelSelection =
  | { kind: "branch"; baseRef: string | null }
  | { kind: "unstaged" }
  | { kind: "all" }
  | {
      kind: "turn";
      turnId: TurnId;
      /**
       * The chat the turn belongs to. Turn ids and checkpoint ranges are
       * per-chat, so the panel resolves the diff against this thread even while
       * a sibling chat in the same worktree is open.
       */
      threadId: ThreadId;
      filePath: string | null;
      revealRequestId: number;
    };

/** Which git-scope entries can back the shared working-tree/branch view. */
export type GitScope = "all" | "unstaged" | "branch";

/** The working-tree / branch view. */
type GitScopeSelection = Extract<DiffPanelSelection, { kind: "branch" | "unstaged" | "all" }>;
/** A checkpoint (turn) view, tagged with the chat that owns the turn. */
type TurnSelection = Extract<DiffPanelSelection, { kind: "turn" }>;

// The combined working-tree view (every change since the fork point, committed
// and uncommitted) is the default the panel lands on.
const DEFAULT_SELECTION: DiffPanelSelection = { kind: "all" };

interface DiffPanelStoreState {
  // The whole diff selection is part of the shared per-worktree workspace, so
  // every entry keys off the worktree's representative thread: switching
  // between sibling chats leaves the panel exactly where the user put it.
  gitScopeByThreadKey: Record<string, GitScopeSelection>;
  branchBaseRefByThreadKey: Record<string, string | null>;
  // Turn selections are shared the same way, but carry the chat that owns the
  // turn so the panel can still resolve the right checkpoint diff.
  turnByThreadKey: Record<string, TurnSelection>;
  selectGitScope: (sharedRef: ScopedThreadRef, scope: GitScope) => void;
  selectBranchBaseRef: (sharedRef: ScopedThreadRef, baseRef: string | null) => void;
  // `sharedRef` owns the worktree's selection; `chatRef` is the chat whose turn
  // was picked.
  selectTurn: (
    sharedRef: ScopedThreadRef,
    chatRef: ScopedThreadRef,
    turnId: TurnId,
    filePath?: string,
  ) => void;
  reconcileTurnSelection: (
    sharedRef: ScopedThreadRef,
    chatRef: ScopedThreadRef,
    availableTurnIds: ReadonlyArray<TurnId>,
  ) => void;
  /** Drop the turn view, revealing the worktree's git-scope selection again. */
  clearTurnSelection: (sharedRef: ScopedThreadRef) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

function normalizeBaseRef(baseRef: string | null): string | null {
  const normalized = baseRef?.trim();
  return normalized ? normalized : null;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  return rest;
}

export const useDiffPanelStore = create<DiffPanelStoreState>()(
  persist(
    (set) => ({
      gitScopeByThreadKey: {},
      branchBaseRefByThreadKey: {},
      turnByThreadKey: {},
      selectGitScope: (sharedRef, scope) =>
        set((state) => {
          const sharedKey = scopedThreadKey(sharedRef);
          const previousBaseRef = state.branchBaseRefByThreadKey[sharedKey] ?? null;
          return {
            gitScopeByThreadKey: {
              ...state.gitScopeByThreadKey,
              [sharedKey]:
                scope === "branch"
                  ? { kind: "branch", baseRef: previousBaseRef }
                  : scope === "unstaged"
                    ? { kind: "unstaged" }
                    : { kind: "all" },
            },
            // Picking a git scope leaves the turn view for this worktree.
            turnByThreadKey: withoutKey(state.turnByThreadKey, sharedKey),
          };
        }),
      selectBranchBaseRef: (sharedRef, baseRef) =>
        set((state) => {
          const sharedKey = scopedThreadKey(sharedRef);
          const normalizedBaseRef = normalizeBaseRef(baseRef);
          return {
            gitScopeByThreadKey: {
              ...state.gitScopeByThreadKey,
              [sharedKey]: { kind: "branch", baseRef: normalizedBaseRef },
            },
            branchBaseRefByThreadKey: {
              ...state.branchBaseRefByThreadKey,
              [sharedKey]: normalizedBaseRef,
            },
            turnByThreadKey: withoutKey(state.turnByThreadKey, sharedKey),
          };
        }),
      selectTurn: (sharedRef, chatRef, turnId, filePath) =>
        set((state) => {
          const sharedKey = scopedThreadKey(sharedRef);
          const previous = state.turnByThreadKey[sharedKey];
          return {
            turnByThreadKey: {
              ...state.turnByThreadKey,
              [sharedKey]: {
                kind: "turn",
                turnId,
                threadId: chatRef.threadId,
                filePath: filePath?.trim() || null,
                revealRequestId: previous ? previous.revealRequestId + 1 : 1,
              },
            },
          };
        }),
      reconcileTurnSelection: (sharedRef, chatRef, availableTurnIds) =>
        set((state) => {
          const sharedKey = scopedThreadKey(sharedRef);
          const previous = state.turnByThreadKey[sharedKey];
          const latestTurnId = availableTurnIds[0];
          if (
            previous === undefined ||
            // Only the owning chat's turn list can rewrite the selection; a
            // sibling's turns say nothing about whether it is still valid.
            previous.threadId !== chatRef.threadId ||
            latestTurnId === undefined ||
            availableTurnIds.includes(previous.turnId)
          ) {
            return state;
          }
          return {
            turnByThreadKey: {
              ...state.turnByThreadKey,
              [sharedKey]: { ...previous, turnId: latestTurnId },
            },
          };
        }),
      clearTurnSelection: (sharedRef) =>
        set((state) => {
          const sharedKey = scopedThreadKey(sharedRef);
          if (!(sharedKey in state.turnByThreadKey)) return state;
          return { turnByThreadKey: withoutKey(state.turnByThreadKey, sharedKey) };
        }),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (
            !(threadKey in state.gitScopeByThreadKey) &&
            !(threadKey in state.branchBaseRefByThreadKey) &&
            !(threadKey in state.turnByThreadKey)
          ) {
            return state;
          }
          return {
            gitScopeByThreadKey: withoutKey(state.gitScopeByThreadKey, threadKey),
            branchBaseRefByThreadKey: withoutKey(state.branchBaseRefByThreadKey, threadKey),
            turnByThreadKey: withoutKey(state.turnByThreadKey, threadKey),
          };
        }),
    }),
    {
      name: "t3code:diff-panel-state:v1",
      version: 3,
      migrate: (persisted, version) => {
        if (version >= 3) return persisted as Partial<DiffPanelStoreState>;
        // Git scopes were always shared per worktree, so they survive. Turn
        // entries do not: v1 keyed them by the worktree representative without
        // recording the owning chat, v2 keyed them by the chat. Neither can be
        // mapped onto the shared-with-owner shape, so drop them and land on the
        // working-tree default.
        const legacy = (persisted ?? {}) as {
          byThreadKey?: Record<string, DiffPanelSelection>;
          gitScopeByThreadKey?: Record<string, GitScopeSelection>;
          branchBaseRefByThreadKey?: Record<string, string | null>;
        };
        const gitScopeByThreadKey: Record<string, GitScopeSelection> = {
          ...legacy.gitScopeByThreadKey,
        };
        for (const [key, selection] of Object.entries(legacy.byThreadKey ?? {})) {
          if (
            selection.kind === "branch" ||
            selection.kind === "unstaged" ||
            selection.kind === "all"
          ) {
            gitScopeByThreadKey[key] = selection;
          }
        }
        return {
          gitScopeByThreadKey,
          branchBaseRefByThreadKey: legacy.branchBaseRefByThreadKey ?? {},
          turnByThreadKey: {},
        } satisfies Partial<DiffPanelStoreState>;
      },
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        gitScopeByThreadKey: state.gitScopeByThreadKey,
        branchBaseRefByThreadKey: state.branchBaseRefByThreadKey,
        turnByThreadKey: state.turnByThreadKey,
      }),
    },
  ),
);

/**
 * Resolve the diff view for a worktree. A turn selection wins over the
 * working-tree/branch view; absent both, fall back to the working tree.
 */
export function selectThreadDiffPanelSelection(
  state: Pick<DiffPanelStoreState, "gitScopeByThreadKey" | "turnByThreadKey">,
  sharedRef: ScopedThreadRef | null | undefined,
): DiffPanelSelection {
  if (!sharedRef) return DEFAULT_SELECTION;
  const sharedKey = scopedThreadKey(sharedRef);
  return (
    state.turnByThreadKey[sharedKey] ?? state.gitScopeByThreadKey[sharedKey] ?? DEFAULT_SELECTION
  );
}
