import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, TurnId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export type DiffPanelSelection =
  | { kind: "branch"; baseRef: string | null }
  | { kind: "unstaged" }
  | { kind: "turn"; turnId: TurnId; filePath: string | null; revealRequestId: number };

/** The working-tree / branch view — shared across a worktree's chats. */
type GitScopeSelection = Extract<DiffPanelSelection, { kind: "branch" | "unstaged" }>;
/** A checkpoint (turn) view — belongs to a single conversation. */
type TurnSelection = Extract<DiffPanelSelection, { kind: "turn" }>;

const DEFAULT_SELECTION: DiffPanelSelection = { kind: "unstaged" };

interface DiffPanelStoreState {
  // Working-tree / branch selection is part of the shared per-worktree
  // workspace, so it keys off the worktree's representative thread and every
  // sibling chat sees the same full diff.
  gitScopeByThreadKey: Record<string, GitScopeSelection>;
  branchBaseRefByThreadKey: Record<string, string | null>;
  // Turn selection is per chat: a turn belongs to one conversation, so a
  // sibling chat must neither inherit it nor clobber it. Keyed by the chat's
  // own ref (not the worktree representative).
  turnByThreadKey: Record<string, TurnSelection>;
  // `sharedRef` owns the shared git-scope; `chatRef` is the current chat whose
  // per-chat turn selection is dropped when it switches back to a git scope.
  selectGitScope: (
    sharedRef: ScopedThreadRef,
    chatRef: ScopedThreadRef,
    scope: "branch" | "unstaged",
  ) => void;
  selectBranchBaseRef: (
    sharedRef: ScopedThreadRef,
    chatRef: ScopedThreadRef,
    baseRef: string | null,
  ) => void;
  selectTurn: (chatRef: ScopedThreadRef, turnId: TurnId, filePath?: string) => void;
  reconcileTurnSelection: (
    chatRef: ScopedThreadRef,
    availableTurnIds: ReadonlyArray<TurnId>,
  ) => void;
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
      selectGitScope: (sharedRef, chatRef, scope) =>
        set((state) => {
          const sharedKey = scopedThreadKey(sharedRef);
          const chatKey = scopedThreadKey(chatRef);
          const previousBaseRef = state.branchBaseRefByThreadKey[sharedKey] ?? null;
          return {
            gitScopeByThreadKey: {
              ...state.gitScopeByThreadKey,
              [sharedKey]:
                scope === "branch"
                  ? { kind: "branch", baseRef: previousBaseRef }
                  : { kind: "unstaged" },
            },
            // Picking a git scope leaves the turn view for this chat.
            turnByThreadKey: withoutKey(state.turnByThreadKey, chatKey),
          };
        }),
      selectBranchBaseRef: (sharedRef, chatRef, baseRef) =>
        set((state) => {
          const sharedKey = scopedThreadKey(sharedRef);
          const chatKey = scopedThreadKey(chatRef);
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
            turnByThreadKey: withoutKey(state.turnByThreadKey, chatKey),
          };
        }),
      selectTurn: (chatRef, turnId, filePath) =>
        set((state) => {
          const chatKey = scopedThreadKey(chatRef);
          const previous = state.turnByThreadKey[chatKey];
          return {
            turnByThreadKey: {
              ...state.turnByThreadKey,
              [chatKey]: {
                kind: "turn",
                turnId,
                filePath: filePath?.trim() || null,
                revealRequestId: previous ? previous.revealRequestId + 1 : 1,
              },
            },
          };
        }),
      reconcileTurnSelection: (chatRef, availableTurnIds) =>
        set((state) => {
          const chatKey = scopedThreadKey(chatRef);
          const previous = state.turnByThreadKey[chatKey];
          const latestTurnId = availableTurnIds[0];
          if (
            previous === undefined ||
            latestTurnId === undefined ||
            availableTurnIds.includes(previous.turnId)
          ) {
            return state;
          }
          return {
            turnByThreadKey: {
              ...state.turnByThreadKey,
              [chatKey]: { ...previous, turnId: latestTurnId },
            },
          };
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
      version: 2,
      migrate: (persisted, version) => {
        if (version >= 2) return persisted as Partial<DiffPanelStoreState>;
        // v1 kept a single `byThreadKey` union keyed by the shared ref. Keep
        // its git-scope entries (still shared) and drop turn entries: those
        // were mis-keyed by the worktree representative and are per-chat now.
        const legacy = (persisted ?? {}) as {
          byThreadKey?: Record<string, DiffPanelSelection>;
          branchBaseRefByThreadKey?: Record<string, string | null>;
        };
        const gitScopeByThreadKey: Record<string, GitScopeSelection> = {};
        for (const [key, selection] of Object.entries(legacy.byThreadKey ?? {})) {
          if (selection.kind === "branch" || selection.kind === "unstaged") {
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
 * Resolve the diff view for a chat. A per-chat turn selection wins over the
 * shared working-tree/branch view; absent both, fall back to the working tree.
 */
export function selectThreadDiffPanelSelection(
  state: Pick<DiffPanelStoreState, "gitScopeByThreadKey" | "turnByThreadKey">,
  chatRef: ScopedThreadRef | null | undefined,
  sharedRef: ScopedThreadRef | null | undefined,
): DiffPanelSelection {
  const turn = chatRef ? state.turnByThreadKey[scopedThreadKey(chatRef)] : undefined;
  if (turn) return turn;
  const gitScope = sharedRef ? state.gitScopeByThreadKey[scopedThreadKey(sharedRef)] : undefined;
  return gitScope ?? DEFAULT_SELECTION;
}
