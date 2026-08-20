import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  CircleAlertIcon,
  FileDiffIcon,
  FileIcon,
  GlobeIcon,
  MessageSquareDotIcon,
  MessageSquarePlusIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { buildDraftThreadRouteParams } from "~/threadRoutes";
import { cn } from "~/lib/utils";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useThreadActions } from "~/hooks/useThreadActions";
import { useClientSettings } from "~/hooks/useSettings";
import { readLocalApi } from "~/localApi";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { useUiStateStore, worktreeActivityKey } from "~/uiStateStore";

export interface WorktreeContentTabDescriptor {
  id: string;
  title: string;
  /** Which view the tab renders — picks the tab icon. */
  view: "diff" | "file" | "preview";
}

const EMPTY_CONTENT_TABS: ReadonlyArray<WorktreeContentTabDescriptor> = [];

interface WorktreeThreadTabsProps {
  activeEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  activeProjectId: string;
  activeDraftId?: DraftId | null;
  // Worktree chats are grouped by their on-disk tree. Local chats are grouped
  // by project, so the tab strip is available in every environment mode.
  worktreePath: string | null;
  // Starts a fresh chat in the same worktree or local project context.
  onNewChat: () => void;
  // Ephemeral file-diff tabs opened from the Diff navigator (worktree-scoped).
  contentTabs?: ReadonlyArray<WorktreeContentTabDescriptor>;
  // The active content tab, or null when the chat conversation is shown.
  activeContentTabId?: string | null;
  onSelectContentTab?: (tabId: string) => void;
  onCloseContentTab?: (tabId: string) => void;
  // Return to the chat conversation (deactivate any content tab).
  onActivateChat?: () => void;
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
  activeProjectId,
  activeDraftId = null,
  worktreePath,
  onNewChat,
  contentTabs = EMPTY_CONTENT_TABS,
  activeContentTabId = null,
  onSelectContentTab,
  onCloseContentTab,
  onActivateChat,
}: WorktreeThreadTabsProps) {
  const router = useRouter();
  const shells = useThreadShells();
  const { archiveThread } = useThreadActions();
  const confirmThreadArchive = useClientSettings((settings) => settings.confirmThreadArchive);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const [closingThreadId, setClosingThreadId] = useState<ThreadId | null>(null);
  const draftThreadsByThreadKey = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const draftsByThreadKey = useComposerDraftStore((state) => state.draftsByThreadKey);
  const draftTabs = useMemo(
    () =>
      Object.entries(draftThreadsByThreadKey)
        .filter(
          ([, draft]) =>
            draft.environmentId === activeEnvironmentId &&
            draft.projectId === activeProjectId &&
            draft.worktreePath === worktreePath &&
            !draft.promotedTo,
        )
        .map(([draftId, draft]) => {
          const prompt = draftsByThreadKey[draftId]?.prompt.trim() ?? "";
          return {
            draftId: DraftId.make(draftId),
            createdAt: draft.createdAt,
            title: prompt.split(/\r?\n/, 1)[0]?.slice(0, 48) || "New chat",
            threadId: draft.threadId,
            projectId: draft.projectId,
            logicalProjectKey: draft.logicalProjectKey,
            branch: draft.branch,
            envMode: draft.envMode,
            startFromOrigin: draft.startFromOrigin,
            runtimeMode: draft.runtimeMode,
            interactionMode: draft.interactionMode,
          };
        })
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [
      activeEnvironmentId,
      activeProjectId,
      draftThreadsByThreadKey,
      draftsByThreadKey,
      worktreePath,
    ],
  );

  const tabs = useMemo(() => {
    return shells
      .filter(
        (shell) =>
          shell.environmentId === activeEnvironmentId &&
          shell.projectId === activeProjectId &&
          shell.worktreePath === worktreePath &&
          shell.archivedAt === null,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [shells, activeEnvironmentId, activeProjectId, worktreePath]);

  const closeTab = useCallback(
    async (shell: EnvironmentThreadShell) => {
      if (closingThreadId !== null) return;
      if (confirmThreadArchive) {
        const confirmed = await readLocalApi()?.dialogs.confirm(
          `Close "${shell.title}"? It will move to Archive.`,
        );
        if (!confirmed) return;
      }

      // Closing a chat is a fresh interaction with its worktree. Record it so
      // the collapsed sidebar row keeps its position instead of sinking to a
      // surviving sibling's older timestamp. See `sortThreadsForSidebarV2`.
      if (shell.worktreePath !== null) {
        useUiStateStore
          .getState()
          .markWorktreeActive(
            worktreeActivityKey(shell.environmentId, shell.worktreePath),
            new Date().toISOString(),
          );
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

  return (
    <div
      data-worktree-thread-tabs
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-2 sm:px-3"
    >
      <ScrollArea hideScrollbars scrollFade className="min-w-0 flex-1 rounded-none">
        <div className="flex h-full w-max min-w-full items-center gap-1">
          {draftTabs.map((draft) => {
            const active = draft.draftId === activeDraftId && activeContentTabId === null;
            return (
              <div
                key={`draft:${draft.draftId}`}
                className={cn(
                  "group/tab order-1 flex h-7 min-w-24 max-w-44 shrink-0 items-center rounded-md text-sm transition-colors",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
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
                          onActivateChat?.();
                          if (active) return;
                          void router.navigate({
                            to: "/draft/$draftId",
                            params: buildDraftThreadRouteParams(draft.draftId),
                          });
                        }}
                      >
                        {draft.title}
                      </button>
                    }
                  />
                  <TooltipPopup side="bottom">{draft.title}</TooltipPopup>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`Close ${draft.title}`}
                        className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-background/70 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring max-sm:opacity-100 group-hover/tab:opacity-100"
                        onClick={async () => {
                          const draftStore = useComposerDraftStore.getState();
                          if (!active) {
                            draftStore.clearDraftThread(draft.draftId);
                            return;
                          }
                          const fallbackDraft = draftTabs.find(
                            (candidate) => candidate.draftId !== draft.draftId,
                          );
                          if (fallbackDraft) {
                            // Move the project's active-draft pointer before
                            // removing the current draft. This keeps the shared
                            // worktree identity alive throughout the route swap.
                            draftStore.setLogicalProjectDraftThreadId(
                              fallbackDraft.logicalProjectKey,
                              scopeProjectRef(activeEnvironmentId, fallbackDraft.projectId),
                              fallbackDraft.draftId,
                              {
                                threadId: fallbackDraft.threadId,
                                branch: fallbackDraft.branch,
                                worktreePath,
                                envMode: fallbackDraft.envMode,
                                startFromOrigin: fallbackDraft.startFromOrigin,
                                runtimeMode: fallbackDraft.runtimeMode,
                                interactionMode: fallbackDraft.interactionMode,
                                preservePreviousDraft: true,
                              },
                            );
                            await router.navigate({
                              to: "/draft/$draftId",
                              params: buildDraftThreadRouteParams(fallbackDraft.draftId),
                            });
                            draftStore.clearDraftThread(draft.draftId);
                            return;
                          }
                          const fallbackThread = tabs[0];
                          if (fallbackThread) {
                            await router.navigate({
                              to: "/$environmentId/$threadId",
                              params: buildThreadRouteParams({
                                environmentId: fallbackThread.environmentId,
                                threadId: fallbackThread.id,
                              }),
                            });
                          }
                          draftStore.clearDraftThread(draft.draftId);
                        }}
                      />
                    }
                  >
                    <XIcon aria-hidden="true" className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">Close draft</TooltipPopup>
                </Tooltip>
              </div>
            );
          })}
          {tabs.map((shell) => {
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
                          // Return to the conversation view; only navigate when
                          // it's actually a different chat.
                          onActivateChat?.();
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
          {contentTabs.map((tab) => {
            const active = tab.id === activeContentTabId;
            const TabIcon =
              tab.view === "preview" ? GlobeIcon : tab.view === "file" ? FileIcon : FileDiffIcon;
            return (
              <div
                key={`content:${tab.id}`}
                className={cn(
                  "group/tab order-2 flex h-7 min-w-24 max-w-44 shrink-0 items-center rounded-md text-sm transition-colors",
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
                        className="flex min-w-0 flex-1 items-center gap-1.5 truncate py-1 pl-2.5 text-left"
                        onClick={() => onSelectContentTab?.(tab.id)}
                      >
                        <TabIcon aria-hidden="true" className="size-3.5 shrink-0" />
                        <span className="truncate">{tab.title}</span>
                      </button>
                    }
                  />
                  <TooltipPopup side="bottom">{tab.title}</TooltipPopup>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`Close ${tab.title}`}
                        className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-background/70 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring max-sm:opacity-100 group-hover/tab:opacity-100"
                        onClick={() => onCloseContentTab?.(tab.id)}
                      />
                    }
                  >
                    <XIcon aria-hidden="true" className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">
                    {tab.view === "preview"
                      ? "Close preview"
                      : tab.view === "file"
                        ? "Close file"
                        : "Close diff"}
                  </TooltipPopup>
                </Tooltip>
              </div>
            );
          })}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={
                    worktreePath ? "New chat in this worktree" : "New chat in this project"
                  }
                  className="relative order-3 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={onNewChat}
                />
              }
            >
              <MessageSquarePlusIcon aria-hidden="true" className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">
              {worktreePath ? "New chat in this worktree" : "New chat in this project"}
            </TooltipPopup>
          </Tooltip>
        </div>
      </ScrollArea>
    </div>
  );
});
