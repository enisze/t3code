import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  PREVIEW_CONTENT_TAB_ID,
  selectWorktreeContentTabs,
  useWorkspaceContentTabsStore,
  worktreeContentTabsKey,
} from "./workspaceContentTabsStore";

const KEY = "env-1:/worktree";

beforeEach(() => {
  useWorkspaceContentTabsStore.setState({ byWorktree: {} });
});

const tabs = () =>
  selectWorktreeContentTabs(useWorkspaceContentTabsStore.getState().byWorktree, KEY);

describe("workspaceContentTabsStore", () => {
  it("opens a diff viewer and activates it", () => {
    useWorkspaceContentTabsStore.getState().openFileDiff(KEY, "src/index.ts");
    expect(tabs().tabs).toEqual([{ id: "src/index.ts", filePath: "src/index.ts", view: "diff" }]);
    expect(tabs().activeTabId).toBe("src/index.ts");
  });

  it("opens a file viewer and activates it", () => {
    useWorkspaceContentTabsStore.getState().openFile(KEY, "src/index.ts");
    expect(tabs().tabs).toEqual([{ id: "src/index.ts", filePath: "src/index.ts", view: "file" }]);
    expect(tabs().activeTabId).toBe("src/index.ts");
  });

  it("keeps a single viewer: opening another file replaces it", () => {
    useWorkspaceContentTabsStore.getState().openFileDiff(KEY, "a.ts");
    useWorkspaceContentTabsStore.getState().openFile(KEY, "b.ts");
    expect(tabs().tabs).toEqual([{ id: "b.ts", filePath: "b.ts", view: "file" }]);
    expect(tabs().activeTabId).toBe("b.ts");
  });

  it("setTabView flips the viewer between diff and file for the same path", () => {
    useWorkspaceContentTabsStore.getState().openFileDiff(KEY, "a.ts");
    useWorkspaceContentTabsStore.getState().setTabView(KEY, "file");
    expect(tabs().tabs).toEqual([{ id: "a.ts", filePath: "a.ts", view: "file" }]);
    // The active viewer stays the same tab.
    expect(tabs().activeTabId).toBe("a.ts");
  });

  it("setTabView is a no-op when nothing is open", () => {
    useWorkspaceContentTabsStore.getState().setTabView(KEY, "file");
    expect(tabs().tabs).toEqual([]);
    expect(tabs().activeTabId).toBeNull();
  });

  it("closing the viewer returns to the chat", () => {
    useWorkspaceContentTabsStore.getState().openFile(KEY, "a.ts");
    useWorkspaceContentTabsStore.getState().closeTab(KEY, "a.ts");
    expect(tabs().tabs).toEqual([]);
    expect(tabs().activeTabId).toBeNull();
  });

  it("activateChat clears the active viewer but keeps the tab", () => {
    useWorkspaceContentTabsStore.getState().openFile(KEY, "a.ts");
    useWorkspaceContentTabsStore.getState().activateChat(KEY);
    expect(tabs().activeTabId).toBeNull();
    expect(tabs().tabs).toHaveLength(1);
  });

  it("opens the browser preview as the single viewer", () => {
    useWorkspaceContentTabsStore.getState().openPreview(KEY);
    expect(tabs().tabs).toEqual([{ id: PREVIEW_CONTENT_TAB_ID, filePath: "", view: "preview" }]);
    expect(tabs().activeTabId).toBe(PREVIEW_CONTENT_TAB_ID);
  });

  it("keeps a single viewer: opening the preview replaces a file, and vice versa", () => {
    useWorkspaceContentTabsStore.getState().openFile(KEY, "a.ts");
    useWorkspaceContentTabsStore.getState().openPreview(KEY);
    expect(tabs().tabs).toEqual([{ id: PREVIEW_CONTENT_TAB_ID, filePath: "", view: "preview" }]);
    useWorkspaceContentTabsStore.getState().openFileDiff(KEY, "b.ts");
    expect(tabs().tabs).toEqual([{ id: "b.ts", filePath: "b.ts", view: "diff" }]);
  });

  it("setTabView cannot corrupt the preview viewer", () => {
    useWorkspaceContentTabsStore.getState().openPreview(KEY);
    useWorkspaceContentTabsStore.getState().setTabView(KEY, "file");
    expect(tabs().tabs).toEqual([{ id: PREVIEW_CONTENT_TAB_ID, filePath: "", view: "preview" }]);
  });
});

describe("worktreeContentTabsKey", () => {
  it("keys by environment and worktree path", () => {
    expect(worktreeContentTabsKey("env-1", "/worktree")).toBe("env-1:/worktree");
  });

  it("is null without a worktree (no content-tab strip)", () => {
    expect(worktreeContentTabsKey("env-1", null)).toBeNull();
  });
});
