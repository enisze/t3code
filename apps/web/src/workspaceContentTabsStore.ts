/**
 * Worktree-scoped "content viewer" for the chat column.
 *
 * The chat-column tab strip lists the worktree's chats plus at most ONE
 * ephemeral file-viewer tab. Opening a file — its diff (from the Diff
 * navigator) or its contents (from the Files explorer) — replaces that single
 * viewer instead of accumulating tabs. The viewer can flip between the diff and
 * the editable file contents via `setTabView` (the edit/view toggle). Keyed by
 * worktree so it stays visible while switching between chats in the same
 * worktree. `activeTabId === null` means the chat conversation is shown.
 */
import { create } from "zustand";

/** Which view the content viewer renders. */
export type WorkspaceContentTabView = "diff" | "file" | "preview";

/** Stable id of the single browser-preview viewer tab. */
export const PREVIEW_CONTENT_TAB_ID = "preview";

export interface WorkspaceContentTab {
  /**
   * Stable id — the repo-relative file path for file/diff viewers, or
   * {@link PREVIEW_CONTENT_TAB_ID} for the browser preview (a single viewer at
   * a time).
   */
  id: string;
  /** Empty for the preview viewer, which is not backed by a file. */
  filePath: string;
  view: WorkspaceContentTabView;
}

/**
 * The content-tab strip is scoped to a worktree, so a chat with no on-disk
 * worktree has no strip. Returns null in that case.
 */
export function worktreeContentTabsKey(
  environmentId: string,
  worktreePath: string | null,
): string | null {
  return worktreePath ? `${environmentId}:${worktreePath}` : null;
}

interface WorktreeContentTabsState {
  /** At most one viewer tab. */
  tabs: WorkspaceContentTab[];
  activeTabId: string | null;
}

interface WorkspaceContentTabsStore {
  byWorktree: Record<string, WorktreeContentTabsState>;
  /** Open (replacing the single viewer) showing `filePath`'s diff. */
  openFileDiff: (worktreeKey: string, filePath: string) => void;
  /** Open (replacing the single viewer) showing `filePath`'s contents. */
  openFile: (worktreeKey: string, filePath: string) => void;
  /** Open (replacing the single viewer) showing the browser preview. */
  openPreview: (worktreeKey: string) => void;
  /** Flip the current viewer between the diff and the editable file contents. */
  setTabView: (worktreeKey: string, view: WorkspaceContentTabView) => void;
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

const openContentTab = (
  set: (partial: (state: WorkspaceContentTabsStore) => Partial<WorkspaceContentTabsStore>) => void,
  worktreeKey: string,
  filePath: string,
  view: WorkspaceContentTabView,
): void => {
  set((state) => ({
    // A single viewer: opening any file replaces whatever it was showing.
    byWorktree: updateWorktree(state.byWorktree, worktreeKey, () => ({
      tabs: [{ id: filePath, filePath, view }],
      activeTabId: filePath,
    })),
  }));
};

export const useWorkspaceContentTabsStore = create<WorkspaceContentTabsStore>()((set) => ({
  byWorktree: {},
  openFileDiff: (worktreeKey, filePath) => openContentTab(set, worktreeKey, filePath, "diff"),
  openFile: (worktreeKey, filePath) => openContentTab(set, worktreeKey, filePath, "file"),
  openPreview: (worktreeKey) =>
    set((state) => ({
      // A single viewer: opening the preview replaces whatever it was showing.
      byWorktree: updateWorktree(state.byWorktree, worktreeKey, () => ({
        tabs: [{ id: PREVIEW_CONTENT_TAB_ID, filePath: "", view: "preview" }],
        activeTabId: PREVIEW_CONTENT_TAB_ID,
      })),
    })),
  setTabView: (worktreeKey, view) =>
    set((state) => ({
      byWorktree: updateWorktree(state.byWorktree, worktreeKey, (current) => {
        const tab = current.tabs[0];
        // The edit/view toggle only applies to the file/diff viewer; the
        // preview viewer has no file to flip.
        if (!tab || tab.view === "preview" || view === "preview" || tab.view === view) {
          return current;
        }
        return { ...current, tabs: [{ ...tab, view }] };
      }),
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
        // Closing the active viewer falls back to a neighbour, else the chat.
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
