/**
 * Worktree-scoped "content viewer" for the chat column.
 *
 * The chat-column tab strip lists the worktree's chats plus content-viewer
 * tabs: at most ONE ephemeral file-viewer tab (showing a file's diff or its
 * editable contents — opening another file replaces it) alongside any number
 * of browser-preview tabs. Opening a preview adds a new tab (each backed by its
 * own preview session), so several localhost previews can be open at once. The
 * file viewer can flip between the diff and the editable contents via
 * `setTabView` (the edit/view toggle). Keyed by worktree so the strip stays
 * visible while switching between chats in the same worktree.
 * `activeTabId === null` means the chat conversation is shown.
 */
import { create } from "zustand";

/** Which view the content viewer renders. */
export type WorkspaceContentTabView = "diff" | "file" | "preview";

export interface WorkspaceContentTab {
  /**
   * Stable id — the repo-relative file path for the file/diff viewer, or the
   * preview session's tab id for a browser-preview tab.
   */
  id: string;
  /** Empty for preview tabs, which are not backed by a file. */
  filePath: string;
  view: WorkspaceContentTabView;
  /**
   * The preview session tab id this tab renders. Present only for preview tabs;
   * lets several previews (each its own session) coexist in the strip.
   */
  previewTabId?: string;
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

export function activateWorkspaceChat(
  input: {
    environmentId: string;
    worktreePath: string | null;
  } | null,
): void {
  if (!input) return;
  const worktreeKey = worktreeContentTabsKey(input.environmentId, input.worktreePath);
  if (worktreeKey) useWorkspaceContentTabsStore.getState().activateChat(worktreeKey);
}

interface WorktreeContentTabsState {
  /** At most one file/diff viewer tab, plus any number of preview tabs. */
  tabs: WorkspaceContentTab[];
  activeTabId: string | null;
}

interface WorkspaceContentTabsStore {
  byWorktree: Record<string, WorktreeContentTabsState>;
  /** Open (replacing the single file viewer) showing `filePath`'s diff. */
  openFileDiff: (worktreeKey: string, filePath: string) => void;
  /** Open (replacing the single file viewer) showing `filePath`'s contents. */
  openFile: (worktreeKey: string, filePath: string) => void;
  /**
   * Add (or re-focus) a browser-preview tab backed by `previewTabId`. Preview
   * tabs accumulate — they do not replace one another or the file viewer.
   */
  openPreview: (worktreeKey: string, previewTabId: string) => void;
  /** Flip the file viewer between the diff and the editable file contents. */
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

const openFileViewer = (
  set: (partial: (state: WorkspaceContentTabsStore) => Partial<WorkspaceContentTabsStore>) => void,
  worktreeKey: string,
  filePath: string,
  view: WorkspaceContentTabView,
): void => {
  set((state) => ({
    // A single file viewer: opening any file replaces whatever it was showing,
    // while the preview tabs stay put.
    byWorktree: updateWorktree(state.byWorktree, worktreeKey, (current) => {
      const previews = current.tabs.filter((tab) => tab.view === "preview");
      return {
        tabs: [{ id: filePath, filePath, view }, ...previews],
        activeTabId: filePath,
      };
    }),
  }));
};

export const useWorkspaceContentTabsStore = create<WorkspaceContentTabsStore>()((set) => ({
  byWorktree: {},
  openFileDiff: (worktreeKey, filePath) => openFileViewer(set, worktreeKey, filePath, "diff"),
  openFile: (worktreeKey, filePath) => openFileViewer(set, worktreeKey, filePath, "file"),
  openPreview: (worktreeKey, previewTabId) =>
    set((state) => ({
      byWorktree: updateWorktree(state.byWorktree, worktreeKey, (current) => {
        const existing = current.tabs.find((tab) => tab.previewTabId === previewTabId);
        if (existing) {
          // Already open — just re-focus it.
          return current.activeTabId === existing.id
            ? current
            : { ...current, activeTabId: existing.id };
        }
        const tab: WorkspaceContentTab = {
          id: previewTabId,
          filePath: "",
          view: "preview",
          previewTabId,
        };
        return { tabs: [...current.tabs, tab], activeTabId: previewTabId };
      }),
    })),
  setTabView: (worktreeKey, view) =>
    set((state) => ({
      byWorktree: updateWorktree(state.byWorktree, worktreeKey, (current) => {
        // The edit/view toggle only applies to the file viewer; preview tabs
        // have no file to flip.
        if (view === "preview") return current;
        const index = current.tabs.findIndex((tab) => tab.view !== "preview");
        const tab = current.tabs[index];
        if (!tab || tab.view === view) return current;
        const tabs = [...current.tabs];
        tabs[index] = { ...tab, view };
        return { ...current, tabs };
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
