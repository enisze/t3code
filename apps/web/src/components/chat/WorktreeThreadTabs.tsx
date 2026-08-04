import type { EnvironmentId, PreviewSessionSnapshot, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  CircleAlertIcon,
  ClipboardList,
  FileDiff,
  Files,
  Globe2,
  MessageSquareDotIcon,
  MessageSquarePlusIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { RightPanelSurface } from "~/rightPanelStore";
import { useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { cn } from "~/lib/utils";
import { faviconUrlForOrigin } from "~/lib/favicon";
import { useTheme } from "~/hooks/useTheme";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useThreadActions } from "~/hooks/useThreadActions";
import { useClientSettings } from "~/hooks/useSettings";
import { readLocalApi } from "~/localApi";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { PierreEntryIcon } from "~/components/chat/PierreEntryIcon";

interface WorktreeThreadTabsProps {
  activeEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  // The on-disk worktree the active thread runs in. Tabs group every chat that
  // shares this worktree; when it's null the thread isn't in a worktree and no
  // tab strip is shown.
  worktreePath: string | null;
  // Starts a fresh chat in the same worktree. Only provided for worktree threads.
  onNewChatInWorktree?: () => void;
  // Content tabs (browser / diff / file / plan) opened in the workspace. They sit
  // beside the chat tabs and render in the center when active.
  contentTabs: readonly RightPanelSurface[];
  // The active content tab, or null when the chat timeline is shown.
  activeContentTabId: string | null;
  // Content-tab ids with unsaved edits (file tabs), shown with a dot indicator.
  pendingContentTabIds: ReadonlySet<string>;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  onActivateContentTab: (surface: RightPanelSurface) => void;
  onCloseContentTab: (surface: RightPanelSurface) => void;
  // Return the center to the chat timeline (called when a chat tab is selected).
  onShowChat: () => void;
}

function contentTabTitle(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
): string {
  switch (surface.kind) {
    case "diff":
      return "Diff";
    case "files":
      return "Files";
    case "file":
      return surface.relativePath.slice(surface.relativePath.lastIndexOf("/") + 1);
    case "plan":
      return "Plan";
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      if (!snapshot || snapshot.navStatus._tag === "Idle") return "Browser";
      if (snapshot.navStatus.title.trim().length > 0) return snapshot.navStatus.title;
      try {
        return new URL(snapshot.navStatus.url).host || "Browser";
      } catch {
        return "Browser";
      }
    }
  }
}

function ContentTabFavicon({ url }: { url: string | null }) {
  const faviconUrl = faviconUrlForOrigin(url, 32);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!faviconUrl || failedUrl === faviconUrl) return <Globe2 className="size-3.5 shrink-0" />;
  return (
    <img
      src={faviconUrl}
      alt=""
      aria-hidden
      draggable={false}
      className="size-3.5 shrink-0 rounded-sm"
      onError={() => setFailedUrl(faviconUrl)}
    />
  );
}

function ContentTabIcon({
  surface,
  sessions,
  theme,
}: {
  surface: RightPanelSurface;
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  theme: "light" | "dark";
}) {
  switch (surface.kind) {
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      const url = !snapshot || snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
      return <ContentTabFavicon url={url} />;
    }
    case "diff":
      return <FileDiff className="size-3.5 shrink-0" />;
    case "files":
      return <Files className="size-3.5 shrink-0" />;
    case "file":
      return (
        <PierreEntryIcon
          pathValue={surface.relativePath}
          kind="file"
          theme={theme}
          className="size-3.5"
        />
      );
    case "plan":
      return <ClipboardList className="size-3.5 shrink-0" />;
  }
}

export function getWorktreeTabAfterClose(
  tabs: readonly EnvironmentThreadShell[],
  closingThreadId: ThreadId,
): EnvironmentThreadShell | null {
  const closingIndex = tabs.findIndex((tab) => tab.id === closingThreadId);
  if (closingIndex === -1) return null;
  return tabs[closingIndex + 1] ?? tabs[closingIndex - 1] ?? null;
}

export function isWorktreeThreadInProgress(shell: EnvironmentThreadShell): boolean {
  return shell.session?.status === "running" || shell.session?.status === "starting";
}

// What the tab's trailing slot should convey. A thread that's paused on an
// approval or a user-input prompt is usually still `running`, so it would spin
// like it's busy — surface it as "needs you" instead so the tab strip reads at
// a glance which chat is waiting on the user.
export type WorktreeTabStatus = "approval" | "input" | "working" | "idle";

export function resolveWorktreeTabStatus(shell: EnvironmentThreadShell): WorktreeTabStatus {
  if (shell.hasPendingApprovals) return "approval";
  if (shell.hasPendingUserInput) return "input";
  if (isWorktreeThreadInProgress(shell)) return "working";
  return "idle";
}

// Color language mirrors the sidebar status pills (amber = act now / approval,
// indigo = awaiting input) so the two surfaces read as one system.
const WORKTREE_TAB_ATTENTION: Record<
  "approval" | "input",
  { Icon: LucideIcon; label: string; className: string }
> = {
  approval: {
    Icon: CircleAlertIcon,
    label: "Waiting for your approval",
    className: "text-amber-600 dark:text-amber-400",
  },
  input: {
    Icon: MessageSquareDotIcon,
    label: "Waiting for your input",
    className: "text-indigo-600 dark:text-indigo-400",
  },
};

export const WorktreeThreadTabs = memo(function WorktreeThreadTabs({
  activeEnvironmentId,
  activeThreadId,
  worktreePath,
  onNewChatInWorktree,
  contentTabs,
  activeContentTabId,
  pendingContentTabIds,
  previewSessions,
  onActivateContentTab,
  onCloseContentTab,
  onShowChat,
}: WorktreeThreadTabsProps) {
  const router = useRouter();
  const shells = useThreadShells();
  const { resolvedTheme } = useTheme();
  const { archiveThread } = useThreadActions();
  const confirmThreadArchive = useClientSettings((settings) => settings.confirmThreadArchive);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const [closingThreadId, setClosingThreadId] = useState<ThreadId | null>(null);

  const tabs = useMemo(() => {
    if (!worktreePath) return [];
    return shells
      .filter(
        (shell) =>
          shell.environmentId === activeEnvironmentId &&
          shell.worktreePath === worktreePath &&
          shell.archivedAt === null,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [shells, activeEnvironmentId, worktreePath]);

  const closeTab = useCallback(
    async (shell: EnvironmentThreadShell) => {
      if (closingThreadId !== null) return;
      if (confirmThreadArchive) {
        const confirmed = await readLocalApi()?.dialogs.confirm(
          `Close "${shell.title}"? It will move to Archive.`,
        );
        if (!confirmed) return;
      }

      const fallback =
        shell.id === activeThreadId ? getWorktreeTabAfterClose(tabs, shell.id) : null;
      setClosingThreadId(shell.id);
      try {
        const result = await archiveThread(
          scopeThreadRef(shell.environmentId, shell.id),
          fallback
            ? { navigateToThreadRef: scopeThreadRef(fallback.environmentId, fallback.id) }
            : undefined,
        );
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to close chat",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      } finally {
        setClosingThreadId(null);
      }
    },
    [activeThreadId, archiveThread, closingThreadId, confirmThreadArchive, tabs],
  );

  // Keep the active tab in view as chats are switched or created.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeThreadId]);

  // Nothing worktree-scoped to show, or only the current chat with no way to
  // spawn siblings — a lone tab adds noise without value. Content tabs (browser /
  // diff / file / plan) keep the strip visible on their own, though.
  const hasChatStrip = Boolean(worktreePath) && (tabs.length > 1 || Boolean(onNewChatInWorktree));
  if (!hasChatStrip && contentTabs.length === 0) return null;

  return (
    <div
      data-worktree-thread-tabs
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-2 sm:px-3"
    >
      <ScrollArea hideScrollbars scrollFade className="min-w-0 flex-1 rounded-none">
        <div className="flex h-full w-max min-w-full items-center gap-1">
          {tabs.map((shell) => {
            // A chat tab is only the active tab when no content tab is showing.
            const active = shell.id === activeThreadId && activeContentTabId === null;
            const status = resolveWorktreeTabStatus(shell);
            const attention =
              status === "approval" || status === "input" ? WORKTREE_TAB_ATTENTION[status] : null;
            const isClosing = shell.id === closingThreadId;
            return (
              <div
                key={shell.id}
                className={cn(
                  "group/tab flex h-7 min-w-24 max-w-44 shrink-0 items-center rounded-md text-sm transition-colors",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  isClosing && "pointer-events-none opacity-50",
                )}
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        ref={active ? activeTabRef : undefined}
                        type="button"
                        aria-current={active ? "page" : undefined}
                        className="min-w-0 flex-1 truncate py-1 pl-2.5 text-left"
                        onClick={() => {
                          if (active) return;
                          // Selecting a chat returns the center to its timeline.
                          onShowChat();
                          if (shell.id === activeThreadId) return;
                          void router.navigate({
                            to: "/$environmentId/$threadId",
                            params: buildThreadRouteParams({
                              environmentId: shell.environmentId,
                              threadId: shell.id,
                            }),
                          });
                        }}
                      >
                        {shell.title}
                      </button>
                    }
                  />
                  <TooltipPopup side="bottom">{shell.title}</TooltipPopup>
                </Tooltip>
                {attention ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          role="status"
                          aria-label={`${shell.title}: ${attention.label}`}
                          className={cn(
                            "mr-1 inline-flex size-5 shrink-0 items-center justify-center",
                            attention.className,
                          )}
                        />
                      }
                    >
                      <attention.Icon aria-hidden="true" className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipPopup side="bottom">{attention.label}</TooltipPopup>
                  </Tooltip>
                ) : status === "working" ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          role="status"
                          aria-label={`${shell.title} is in progress`}
                          className="mr-1 inline-flex size-5 shrink-0 items-center justify-center text-sky-600 dark:text-sky-400"
                        />
                      }
                    >
                      <Spinner aria-hidden="true" className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipPopup side="bottom">Chat in progress</TooltipPopup>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={`Close ${shell.title}`}
                          className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-background/70 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring max-sm:opacity-100 group-hover/tab:opacity-100"
                          onClick={() => void closeTab(shell)}
                        />
                      }
                    >
                      <XIcon aria-hidden="true" className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipPopup side="bottom">Close chat (moves to Archive)</TooltipPopup>
                  </Tooltip>
                )}
              </div>
            );
          })}
          {contentTabs.length > 0 && hasChatStrip ? (
            <div aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border/60" />
          ) : null}
          {contentTabs.map((surface) => {
            const active = surface.id === activeContentTabId;
            const pending = pendingContentTabIds.has(surface.id);
            const title = contentTabTitle(surface, previewSessions);
            return (
              <div
                key={surface.id}
                className={cn(
                  "group/tab flex h-7 min-w-24 max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm transition-colors",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-current={active ? "page" : undefined}
                        className="flex min-w-0 flex-1 items-center gap-1.5 truncate py-1 text-left"
                        onClick={() => onActivateContentTab(surface)}
                      >
                        <ContentTabIcon
                          surface={surface}
                          sessions={previewSessions}
                          theme={resolvedTheme}
                        />
                        <span className="truncate">{title}</span>
                      </button>
                    }
                  />
                  <TooltipPopup side="bottom">{title}</TooltipPopup>
                </Tooltip>
                <button
                  type="button"
                  aria-label={`Close ${title}`}
                  className={cn(
                    "relative inline-flex size-5 shrink-0 items-center justify-center rounded-sm transition-opacity hover:bg-background/70 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring max-sm:opacity-100 group-hover/tab:opacity-100",
                    pending ? "opacity-100" : "opacity-0",
                  )}
                  onClick={() => onCloseContentTab(surface)}
                >
                  {pending ? (
                    <>
                      <span
                        aria-hidden
                        className="size-2 rounded-full bg-current group-hover/tab:hidden"
                      />
                      <XIcon aria-hidden="true" className="hidden size-3.5 group-hover/tab:block" />
                    </>
                  ) : (
                    <XIcon aria-hidden="true" className="size-3.5" />
                  )}
                </button>
              </div>
            );
          })}
          {onNewChatInWorktree && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="New chat in this worktree"
                    className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={onNewChatInWorktree}
                  />
                }
              >
                <MessageSquarePlusIcon aria-hidden="true" className="size-4" />
              </TooltipTrigger>
              <TooltipPopup side="bottom">New chat in this worktree</TooltipPopup>
            </Tooltip>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});
