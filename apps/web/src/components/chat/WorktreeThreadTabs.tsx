import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { MessageSquarePlusIcon, XIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { cn } from "~/lib/utils";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useThreadActions } from "~/hooks/useThreadActions";
import { useClientSettings } from "~/hooks/useSettings";
import { readLocalApi } from "~/localApi";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";

interface WorktreeThreadTabsProps {
  activeEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  // The on-disk worktree the active thread runs in. Tabs group every chat that
  // shares this worktree; when it's null the thread isn't in a worktree and no
  // tab strip is shown.
  worktreePath: string | null;
  // Starts a fresh chat in the same worktree. Only provided for worktree threads.
  onNewChatInWorktree?: () => void;
}

export function getWorktreeTabAfterClose(
  tabs: readonly EnvironmentThreadShell[],
  closingThreadId: ThreadId,
): EnvironmentThreadShell | null {
  const closingIndex = tabs.findIndex((tab) => tab.id === closingThreadId);
  if (closingIndex === -1) return null;
  return tabs[closingIndex + 1] ?? tabs[closingIndex - 1] ?? null;
}

export const WorktreeThreadTabs = memo(function WorktreeThreadTabs({
  activeEnvironmentId,
  activeThreadId,
  worktreePath,
  onNewChatInWorktree,
}: WorktreeThreadTabsProps) {
  const router = useRouter();
  const shells = useThreadShells();
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
  // spawn siblings — a lone tab adds noise without value.
  if (!worktreePath || (tabs.length <= 1 && !onNewChatInWorktree)) return null;

  return (
    <div
      data-worktree-thread-tabs
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-2 sm:px-3"
    >
      <ScrollArea hideScrollbars scrollFade className="min-w-0 flex-1 rounded-none">
        <div className="flex h-full w-max min-w-full items-center gap-1">
          {tabs.map((shell) => {
            const active = shell.id === activeThreadId;
            const isRunning =
              shell.session?.status === "running" && shell.session.activeTurnId != null;
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
                {!isRunning && (
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
        </div>
      </ScrollArea>
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
  );
});
