/**
 * Worktree-scoped "content viewer" for the chat column.
 *
 * The chat-column tab strip lists the worktree's chats plus content-viewer
 * tabs. Browsing files (explorer, diff navigator, file picker) reuses ONE
 * browsing tab, so clicking through files never piles up tabs — like VS Code's
 * preview tab. A kept tab (see `keepTab`) is not replaced by browsing. Opening
 * a preview adds a new tab (each backed by its own preview session). A file
 * tab can flip between the diff and the editable contents via `setTabView`
 * (the edit/view toggle).
 * Keyed by worktree so the strip stays visible while switching between chats
 * in the same worktree. `activeTabId === null` means the chat is shown.
 */
import {
  isWorkspaceImagePreviewPath,
  isWorkspacePdfPreviewPath,
} from "@t3tools/shared/filePreview";
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
  /**
   * A file tab that browsing does not replace. Unset on the worktree's single
   * browsing tab and on preview tabs.
   */
  kept?: boolean;
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
  /** File/diff tabs (at most one of them the browsing tab), then previews. */
  tabs: WorkspaceContentTab[];
  activeTabId: string | null;
}

interface WorkspaceContentTabsStore {
  byWorktree: Record<string, WorktreeContentTabsState>;
  /**
   * Show `filePath`'s diff: focus its tab if open, else load it into the
   * browsing tab.
   */
  openFileDiff: (worktreeKey: string, filePath: string) => void;
  /** Like `openFileDiff`, showing `filePath`'s contents. */
  openFile: (worktreeKey: string, filePath: string) => void;
  /** Turn the browsing tab into a kept tab, so browsing opens a new one. */
  keepTab: (worktreeKey: string, tabId: string) => void;
  /**
   * Add (or re-focus) a browser-preview tab backed by `previewTabId`. Preview
   * tabs accumulate — they do not replace one another or the file viewer.
   */
  openPreview: (worktreeKey: string, previewTabId: string) => void;
  /** Flip the active file tab between the diff and the editable contents. */
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

// Where a new file tab goes: after the other file tabs, before the previews.
const fileTabInsertIndex = (tabs: WorkspaceContentTab[]): number => {
  const firstPreview = tabs.findIndex((tab) => tab.view === "preview");
  return firstPreview === -1 ? tabs.length : firstPreview;
};

// Focus `filePath`'s tab (switching it to `view`) if it is already open.
const focusOpenFileTab = (
  current: WorktreeContentTabsState,
  filePath: string,
  view: WorkspaceContentTabView,
): WorktreeContentTabsState | null => {
  const index = current.tabs.findIndex((tab) => tab.view !== "preview" && tab.id === filePath);
  const tab = current.tabs[index];
  if (!tab) return null;
  if (tab.view === view && current.activeTabId === tab.id) return current;
  const tabs = tab.view === view ? current.tabs : current.tabs.with(index, { ...tab, view });
  return { tabs, activeTabId: tab.id };
};

const openFileViewer = (
  set: (partial: (state: WorkspaceContentTabsStore) => Partial<WorkspaceContentTabsStore>) => void,
  worktreeKey: string,
  filePath: string,
  view: WorkspaceContentTabView,
): void => {
  set((state) => {
    const current = state.byWorktree[worktreeKey] ?? EMPTY_STATE;
    const focused = focusOpenFileTab(current, filePath, view);
    if (focused) {
      return { byWorktree: updateWorktree(state.byWorktree, worktreeKey, () => focused) };
    }
    const tab: WorkspaceContentTab = { id: filePath, filePath, view };
    const browsingIndex = current.tabs.findIndex(
      (entry) => entry.view !== "preview" && !entry.kept,
    );
    const tabs =
      browsingIndex === -1
        ? current.tabs.toSpliced(fileTabInsertIndex(current.tabs), 0, tab)
        : current.tabs.with(browsingIndex, tab);
    return {
      byWorktree: updateWorktree(state.byWorktree, worktreeKey, () => ({
        tabs,
        activeTabId: filePath,
      })),
    };
  });
};

export const useWorkspaceContentTabsStore = create<WorkspaceContentTabsStore>()((set) => ({
  byWorktree: {},
  // PDFs and images have no textual diff; land on the file view so the inline
  // viewer renders instead of a raw-bytes patch.
  openFileDiff: (worktreeKey, filePath) =>
    openFileViewer(
      set,
      worktreeKey,
      filePath,
      isWorkspacePdfPreviewPath(filePath) || isWorkspaceImagePreviewPath(filePath)
        ? "file"
        : "diff",
    ),
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
  keepTab: (worktreeKey, tabId) =>
    set((state) => ({
      byWorktree: updateWorktree(state.byWorktree, worktreeKey, (current) => {
        const index = current.tabs.findIndex(
          (tab) => tab.id === tabId && tab.view !== "preview" && !tab.kept,
        );
        const tab = current.tabs[index];
        if (!tab) return current;
        return { ...current, tabs: current.tabs.with(index, { ...tab, kept: true }) };
      }),
    })),
  setTabView: (worktreeKey, view) =>
    set((state) => ({
      byWorktree: updateWorktree(state.byWorktree, worktreeKey, (current) => {
        // The edit/view toggle only applies to the file viewer; preview tabs
        // have no file to flip.
        if (view === "preview") return current;
        const activeIndex = current.tabs.findIndex(
          (tab) => tab.id === current.activeTabId && tab.view !== "preview",
        );
        const index =
          activeIndex === -1
            ? current.tabs.findIndex((tab) => tab.view !== "preview")
            : activeIndex;
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
        if (index === -1) return current;
        const tabs = current.tabs.toSpliced(index, 1);
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
