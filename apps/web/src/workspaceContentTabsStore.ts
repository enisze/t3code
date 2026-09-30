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
import {
  isWorkspaceImagePreviewPath,
  isWorkspacePdfPreviewPath,
} from "@t3tools/shared/filePreview";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
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
 * The minimum needed to reopen a closed content tab (the browser-style
 * "reopen last closed tab"). Preview sessions are torn down on close, so a
 * closed preview is reopened by re-navigating a fresh session to `previewUrl`
 * rather than reviving its old `previewTabId`.
 */
export type ClosedWorkspaceContentTab =
  | {
      view: WorkspaceContentTabView;
      /** Repo-relative path for the file/diff viewer; empty for previews. */
      filePath: string;
      /** The URL a closed preview was showing, so a new session can reopen it. */
      previewUrl?: string;
    }
  /** A chat closed from the tab strip (archived); reopened by unarchiving it. */
  | { view: "chat"; environmentId: EnvironmentId; threadId: ThreadId };

/** How many closed tabs to remember for reopening, window-wide. */
const MAX_CLOSED_TABS = 20;

/** A closed tab plus the worktree strip it was closed from (null for chats). */
interface ClosedTabEntry {
  worktreeKey: string | null;
  tab: ClosedWorkspaceContentTab;
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
  /**
   * Window-wide LIFO stack of recently closed tabs, like a browser's. Chats
   * reopen from anywhere, since closing one usually navigates away from its
   * strip; content tabs only reopen inside the worktree they belong to.
   */
  closedTabs: ClosedTabEntry[];
  /**
   * Open (replacing the single file viewer) showing `filePath`'s diff. The
   * replaced file counts as closed, so it can be reopened, unless
   * `rememberReplaced` is false (reopening must not refill the stack it pops).
   */
  openFileDiff: (worktreeKey: string, filePath: string, rememberReplaced?: boolean) => void;
  /** Like `openFileDiff`, showing `filePath`'s contents. */
  openFile: (worktreeKey: string, filePath: string, rememberReplaced?: boolean) => void;
  /**
   * Add (or re-focus) a browser-preview tab backed by `previewTabId`. Preview
   * tabs accumulate — they do not replace one another or the file viewer.
   */
  openPreview: (worktreeKey: string, previewTabId: string) => void;
  /** Flip the file viewer between the diff and the editable file contents. */
  setTabView: (worktreeKey: string, view: WorkspaceContentTabView) => void;
  activateTab: (worktreeKey: string, tabId: string) => void;
  activateChat: (worktreeKey: string) => void;
  /**
   * Close a tab. When `closed` is supplied and a tab was actually removed, it
   * is pushed onto the closed-tab stack so it can be reopened.
   */
  closeTab: (worktreeKey: string, tabId: string, closed?: ClosedWorkspaceContentTab) => void;
  /** Remember a chat closed from a tab strip so it can be reopened. */
  pushClosedChat: (closed: Extract<ClosedWorkspaceContentTab, { view: "chat" }>) => void;
  /**
   * Pop and return the most recently closed tab reopenable from `worktreeKey`
   * (any chat, or a content tab of that worktree), or null when there is none.
   */
  popClosedTab: (worktreeKey: string | null) => ClosedWorkspaceContentTab | null;
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
  rememberReplaced: boolean,
): void => {
  set((state) => {
    // A single file viewer: opening any file replaces whatever it was showing,
    // while the preview tabs stay put.
    const replaced = (state.byWorktree[worktreeKey]?.tabs ?? []).find(
      (tab) => tab.view !== "preview",
    );
    const byWorktree = updateWorktree(state.byWorktree, worktreeKey, (current) => {
      const previews = current.tabs.filter((tab) => tab.view === "preview");
      return {
        tabs: [{ id: filePath, filePath, view }, ...previews],
        activeTabId: filePath,
      };
    });
    if (!rememberReplaced || !replaced || replaced.filePath === filePath) return { byWorktree };
    return {
      byWorktree,
      closedTabs: pushClosed(state.closedTabs, {
        worktreeKey,
        tab: { view: replaced.view, filePath: replaced.filePath },
      }),
    };
  });
};

const pushClosed = (closedTabs: ClosedTabEntry[], entry: ClosedTabEntry): ClosedTabEntry[] =>
  [...closedTabs, entry].slice(-MAX_CLOSED_TABS);

export const useWorkspaceContentTabsStore = create<WorkspaceContentTabsStore>()((set) => ({
  byWorktree: {},
  closedTabs: [],
  // PDFs and images have no textual diff; land on the file view so the inline
  // viewer renders instead of a raw-bytes patch.
  openFileDiff: (worktreeKey, filePath, rememberReplaced = true) =>
    openFileViewer(
      set,
      worktreeKey,
      filePath,
      isWorkspacePdfPreviewPath(filePath) || isWorkspaceImagePreviewPath(filePath)
        ? "file"
        : "diff",
      rememberReplaced,
    ),
  openFile: (worktreeKey, filePath, rememberReplaced = true) =>
    openFileViewer(set, worktreeKey, filePath, "file", rememberReplaced),
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
  closeTab: (worktreeKey, tabId, closed) =>
    set((state) => {
      const current = state.byWorktree[worktreeKey] ?? EMPTY_STATE;
      // Nothing removed → leave both the tab map and the closed stack untouched.
      if (!current.tabs.some((tab) => tab.id === tabId)) return {};
      const byWorktree = updateWorktree(state.byWorktree, worktreeKey, (curr) => {
        const index = curr.tabs.findIndex((tab) => tab.id === tabId);
        const tabs = curr.tabs.filter((tab) => tab.id !== tabId);
        if (curr.activeTabId !== tabId) return { ...curr, tabs };
        // Closing the active viewer falls back to a neighbour, else the chat.
        const fallback = tabs[index] ?? tabs[index - 1] ?? null;
        return { tabs, activeTabId: fallback?.id ?? null };
      });
      if (!closed) return { byWorktree };
      return {
        byWorktree,
        closedTabs: pushClosed(state.closedTabs, { worktreeKey, tab: closed }),
      };
    }),
  pushClosedChat: (closed) =>
    set((state) => ({
      closedTabs: pushClosed(state.closedTabs, { worktreeKey: null, tab: closed }),
    })),
  popClosedTab: (worktreeKey) => {
    let popped: ClosedWorkspaceContentTab | null = null;
    set((state) => {
      const index = state.closedTabs.findLastIndex(
        (entry) => entry.tab.view === "chat" || entry.worktreeKey === worktreeKey,
      );
      if (index === -1) return {};
      popped = state.closedTabs[index]?.tab ?? null;
      return { closedTabs: state.closedTabs.toSpliced(index, 1) };
    });
    return popped;
  },
}));

export function selectWorktreeContentTabs(
  byWorktree: Record<string, WorktreeContentTabsState>,
  worktreeKey: string | null,
): WorktreeContentTabsState {
  if (!worktreeKey) return EMPTY_STATE;
  return byWorktree[worktreeKey] ?? EMPTY_STATE;
}
