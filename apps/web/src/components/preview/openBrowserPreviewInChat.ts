import type { ScopedThreadRef } from "@t3tools/contracts";

import { setActivePreviewTab } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { readThreadShell } from "~/state/entities";
import { useWorkspaceContentTabsStore, worktreeContentTabsKey } from "~/workspaceContentTabsStore";

/**
 * Show a freshly-opened browser preview in the chat column's content-tab strip
 * (beside the file and diff viewers) — the same place the user reads the diff
 * and files for the worktree. The caller must have already created the preview
 * session (so it exists in the preview state store); this only routes which
 * surface displays it.
 *
 * The content-tab strip is worktree-scoped, so a chat with no on-disk worktree
 * has no strip to host the preview. Those threads fall back to the right panel.
 */
export function openBrowserPreviewInChat(threadRef: ScopedThreadRef, tabId: string): void {
  const worktreePath = readThreadShell(threadRef)?.worktreePath ?? null;
  const worktreeKey = worktreeContentTabsKey(threadRef.environmentId, worktreePath);
  if (!worktreeKey) {
    useRightPanelStore.getState().openBrowser(threadRef, tabId);
    return;
  }
  // Focus the just-opened tab, then reveal the preview viewer in the strip.
  setActivePreviewTab(threadRef, tabId);
  useWorkspaceContentTabsStore.getState().openPreview(worktreeKey);
}
