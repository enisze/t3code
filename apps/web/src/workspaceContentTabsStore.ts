/**
 * Worktree-scoped "content tabs" for the chat column.
 *
 * The chat-column tab strip lists the worktree's chats; opening a file diff
 * from the Diff navigator adds an ephemeral content tab here instead of the
 * right-panel surface. Tabs are keyed by worktree so they stay visible while
 * switching between chats in the same worktree. `activeTabId === null` means
 * the chat conversation is shown; a non-null id shows that file's diff.
 */
import { create } from "zustand";

export interface WorkspaceContentTab {
  /** Stable id — the repo-relative file path. */
  id: string;
  filePath: string;
}

interface WorktreeContentTabsState {
  tabs: WorkspaceContentTab[];
  activeTabId: string | null;
}

interface WorkspaceContentTabsStore {
  byWorktree: Record<string, WorktreeContentTabsState>;
  openFileDiff: (worktreeKey: string, filePath: string) => void;
  activateTab: (worktreeKey: string, tabId: string) => void;
  activateChat: (worktreeKey: string) => void;
  closeTab: (worktreeKey: string, tabId: string) => void;
}

const EMPTY_STATE: WorktreeContentTabsState = { tabs: [], activeTabId: null };

const updateWorktree = (
  byWorktree: Record<string, WorktreeContentTabsState>,
  worktreeKey: string,
  updater: (current: WorktreeContentTabsState) => WorktreeContentTabsState,
): Record<string, WorktreeContentTabsState> => {
  const current = byWorktree[worktreeKey] ?? EMPTY_STATE;
  const next = updater(current);
  if (next === current) return byWorktree;
  if (next.tabs.length === 0 && next.activeTabId === null) {
    if (!(worktreeKey in byWorktree)) return byWorktree;
    const { [worktreeKey]: _removed, ...rest } = byWorktree;
    return rest;
  }
  return { ...byWorktree, [worktreeKey]: next };
};

export const useWorkspaceContentTabsStore = create<WorkspaceContentTabsStore>()((set) => ({
  byWorktree: {},
  openFileDiff: (worktreeKey, filePath) =>
    set((state) => ({
      byWorktree: updateWorktree(state.byWorktree, worktreeKey, (current) => ({
        tabs: current.tabs.some((tab) => tab.id === filePath)
          ? current.tabs
          : [...current.tabs, { id: filePath, filePath }],
        activeTabId: filePath,
      })),
    })),
  activateTab: (worktreeKey, tabId) =>
    set((state) => ({
      byWorktree: updateWorktree(state.byWorktree, worktreeKey, (current) =>
        current.tabs.some((tab) => tab.id === tabId) ? { ...current, activeTabId: tabId } : current,
      ),
    })),
  activateChat: (worktreeKey) =>
    set((state) => ({
      byWorktree: updateWorktree(state.byWorktree, worktreeKey, (current) =>
        current.activeTabId === null ? current : { ...current, activeTabId: null },
      ),
    })),
  closeTab: (worktreeKey, tabId) =>
    set((state) => ({
      byWorktree: updateWorktree(state.byWorktree, worktreeKey, (current) => {
        const index = current.tabs.findIndex((tab) => tab.id === tabId);
        if (index < 0) return current;
        const tabs = current.tabs.filter((tab) => tab.id !== tabId);
        if (current.activeTabId !== tabId) return { ...current, tabs };
        // Closing the active diff tab falls back to a neighbour, else the chat.
        const fallback = tabs[index] ?? tabs[index - 1] ?? null;
        return { tabs, activeTabId: fallback?.id ?? null };
      }),
    })),
}));

export function selectWorktreeContentTabs(
  byWorktree: Record<string, WorktreeContentTabsState>,
  worktreeKey: string | null,
): WorktreeContentTabsState {
  if (!worktreeKey) return EMPTY_STATE;
  return byWorktree[worktreeKey] ?? EMPTY_STATE;
}
