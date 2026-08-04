import type { EnvironmentId } from "@t3tools/contracts";
import { ClipboardList, FileDiff, Files } from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import { ScrollArea } from "~/components/ui/scroll-area";
import FileBrowserPanel from "~/components/files/FileBrowserPanel";

interface RightWorkspacePanelProps {
  environmentId: EnvironmentId;
  // Workspace root used for the file tree.
  cwd: string;
  // Git working directory used for the changed-files query (falls back to cwd).
  gitCwd: string | null;
  projectName: string;
  // Whether a diff can be opened (server thread inside a Git repo).
  canDiff: boolean;
  // Opens the working-tree diff (unstaged scope) as a content tab in the center.
  onOpenChanges: () => void;
  // Opens a file as a content tab in the center.
  onOpenFile: (relativePath: string) => void;
  // Whether the plan is currently the active view in this column.
  planActive: boolean;
  // The rendered plan sidebar, or null when there is no plan for this thread.
  planContent: ReactNode;
  // Switch this column to the plan view.
  onSelectPlan: () => void;
  // Leave the plan view (back to Changes / Files).
  onDismissPlan: () => void;
  // Persistent dock rendered at the bottom of the column (the Run/Tasks dock).
  bottomDock: ReactNode;
}

type WorkspaceTab = "changes" | "files";

function ChangesList({
  environmentId,
  cwd,
  canDiff,
  onOpenChanges,
}: {
  environmentId: EnvironmentId;
  cwd: string | null;
  canDiff: boolean;
  onOpenChanges: () => void;
}) {
  const statusQuery = useEnvironmentQuery(
    canDiff && cwd != null ? vcsEnvironment.status({ environmentId, input: { cwd } }) : null,
  );
  const files = statusQuery.data?.workingTree.files ?? [];

  if (!canDiff) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
        Changes are available for server threads in a Git repository.
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
        No working-tree changes.
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <ul className="flex flex-col p-1">
        {files.map((file) => {
          const slash = file.path.lastIndexOf("/");
          const name = file.path.slice(slash + 1);
          const dir = slash > 0 ? file.path.slice(0, slash) : "";
          return (
            <li key={file.path}>
              <button
                type="button"
                onClick={onOpenChanges}
                title={file.path}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                <FileDiff className="size-3.5 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-foreground">{name}</span>
                  {dir ? <span className="ml-1 text-muted-foreground/70">{dir}</span> : null}
                </span>
                <span className="shrink-0 tabular-nums text-[10px]">
                  {file.insertions > 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +{file.insertions}
                    </span>
                  ) : null}
                  {file.deletions > 0 ? (
                    <span className="ml-1 text-rose-600 dark:text-rose-400">-{file.deletions}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}

export function RightWorkspacePanel({
  environmentId,
  cwd,
  gitCwd,
  projectName,
  canDiff,
  onOpenChanges,
  onOpenFile,
  planActive,
  planContent,
  onSelectPlan,
  onDismissPlan,
  bottomDock,
}: RightWorkspacePanelProps) {
  const [tab, setTab] = useState<WorkspaceTab>(canDiff ? "changes" : "files");
  const statusCwd = gitCwd ?? cwd;
  const statusQuery = useEnvironmentQuery(
    canDiff ? vcsEnvironment.status({ environmentId, input: { cwd: statusCwd } }) : null,
  );
  const changeCount = statusQuery.data?.workingTree.files.length ?? 0;

  const selectTab = (next: WorkspaceTab) => {
    setTab(next);
    if (planActive) onDismissPlan();
  };

  const segments: {
    id: WorkspaceTab | "plan";
    label: string;
    icon: typeof Files;
    active: boolean;
    badge?: number;
    onClick: () => void;
  }[] = [
    {
      id: "changes",
      label: "Changes",
      icon: FileDiff,
      active: !planActive && tab === "changes",
      badge: changeCount,
      onClick: () => selectTab("changes"),
    },
    {
      id: "files",
      label: "Files",
      icon: Files,
      active: !planActive && tab === "files",
      onClick: () => selectTab("files"),
    },
  ];
  if (planContent) {
    segments.push({
      id: "plan",
      label: "Plan",
      icon: ClipboardList,
      active: planActive,
      onClick: onSelectPlan,
    });
  }

  return (
    <div
      className={cn(
        "flex min-w-56 shrink-0 flex-col border-l border-border/60 bg-background",
        // Give the plan room to breathe; keep the file/changes view compact.
        planActive ? "w-[28rem]" : "w-72",
      )}
    >
      <div className="workspace-topbar flex shrink-0 items-center gap-1 border-b border-border/60 px-2">
        {segments.map((segment) => {
          const Icon = segment.icon;
          return (
            <button
              key={segment.id}
              type="button"
              onClick={segment.onClick}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
                segment.active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {segment.label}
              {segment.badge ? (
                <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                  {segment.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {planActive ? (
          planContent
        ) : tab === "changes" ? (
          <ChangesList
            environmentId={environmentId}
            cwd={statusCwd}
            canDiff={canDiff}
            onOpenChanges={onOpenChanges}
          />
        ) : (
          <FileBrowserPanel
            key={`${environmentId}:${cwd}`}
            environmentId={environmentId}
            cwd={cwd}
            projectName={projectName}
            onOpenFile={onOpenFile}
          />
        )}
      </div>

      {bottomDock}
    </div>
  );
}
