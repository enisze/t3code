import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
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

  it("opens a browser preview tab and activates it", () => {
    useWorkspaceContentTabsStore.getState().openPreview(KEY, "tab_1");
    expect(tabs().tabs).toEqual([
      { id: "tab_1", filePath: "", view: "preview", previewTabId: "tab_1" },
    ]);
    expect(tabs().activeTabId).toBe("tab_1");
  });

  it("accumulates multiple preview tabs and re-focuses an existing one", () => {
    useWorkspaceContentTabsStore.getState().openPreview(KEY, "tab_1");
    useWorkspaceContentTabsStore.getState().openPreview(KEY, "tab_2");
    expect(tabs().tabs.map((tab) => tab.id)).toEqual(["tab_1", "tab_2"]);
    expect(tabs().activeTabId).toBe("tab_2");
    // Re-opening an existing preview just re-focuses it, no duplicate tab.
    useWorkspaceContentTabsStore.getState().openPreview(KEY, "tab_1");
    expect(tabs().tabs.map((tab) => tab.id)).toEqual(["tab_1", "tab_2"]);
    expect(tabs().activeTabId).toBe("tab_1");
  });

  it("keeps preview tabs when the file viewer is replaced", () => {
    useWorkspaceContentTabsStore.getState().openPreview(KEY, "tab_1");
    useWorkspaceContentTabsStore.getState().openFile(KEY, "a.ts");
    // The file viewer sits ahead of the preview tabs, which stay open.
    expect(tabs().tabs.map((tab) => tab.id)).toEqual(["a.ts", "tab_1"]);
    useWorkspaceContentTabsStore.getState().openFileDiff(KEY, "b.ts");
    expect(tabs().tabs.map((tab) => tab.id)).toEqual(["b.ts", "tab_1"]);
    expect(tabs().activeTabId).toBe("b.ts");
  });

  it("setTabView flips the file viewer without touching preview tabs", () => {
    useWorkspaceContentTabsStore.getState().openPreview(KEY, "tab_1");
    useWorkspaceContentTabsStore.getState().openFileDiff(KEY, "a.ts");
    useWorkspaceContentTabsStore.getState().setTabView(KEY, "file");
    expect(tabs().tabs).toEqual([
      { id: "a.ts", filePath: "a.ts", view: "file" },
      { id: "tab_1", filePath: "", view: "preview", previewTabId: "tab_1" },
    ]);
  });

  it("setTabView cannot corrupt a preview tab", () => {
    useWorkspaceContentTabsStore.getState().openPreview(KEY, "tab_1");
    useWorkspaceContentTabsStore.getState().setTabView(KEY, "file");
    expect(tabs().tabs).toEqual([
      { id: "tab_1", filePath: "", view: "preview", previewTabId: "tab_1" },
    ]);
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
