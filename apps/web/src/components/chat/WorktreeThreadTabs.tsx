import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { MessageSquarePlusIcon } from "lucide-react";
import { memo, useEffect, useMemo, useRef } from "react";
import { useRouter } from "@tanstack/react-router";

import { useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { cn } from "~/lib/utils";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

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

export const WorktreeThreadTabs = memo(function WorktreeThreadTabs({
  activeEnvironmentId,
  activeThreadId,
  worktreePath,
  onNewChatInWorktree,
}: WorktreeThreadTabsProps) {
  const router = useRouter();
  const shells = useThreadShells();
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

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
            return (
              <Tooltip key={shell.id}>
                <TooltipTrigger
                  render={
                    <button
                      ref={active ? activeTabRef : undefined}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-7 min-w-24 max-w-44 shrink-0 items-center rounded-md px-2.5 text-sm transition-colors",
                        active
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
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
                      <span className="truncate">{shell.title}</span>
                    </button>
                  }
                />
                <TooltipPopup side="bottom">{shell.title}</TooltipPopup>
              </Tooltip>
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
