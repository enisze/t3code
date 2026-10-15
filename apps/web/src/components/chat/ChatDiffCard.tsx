import type { ChatDiffScope, EnvironmentId } from "@t3tools/contracts";
import { FileDiff } from "@pierre/diffs/react";
import { ChevronRightIcon, FileDiffIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { useDiffThemeName } from "~/hooks/useDiffThemeName";
import { getDiffLineStat, getRenderablePatch, resolveFileDiffPath } from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { reviewEnvironment } from "~/state/review";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  CHAT_DIFF_AUTO_EXPAND_MAX_FILES,
  CHAT_DIFF_SCOPE_LABELS,
  CHAT_DIFF_SCOPE_SOURCE_KIND,
  filterChatDiffFiles,
} from "./ChatDiffCard.logic";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";

/**
 * An agent's `show_diff` call, rendered inline. Reads the same live git diff
 * preview the diff panel uses, so it reflects the workspace now rather than a
 * snapshot from when the agent called the tool.
 */
export const ChatDiffCard = memo(function ChatDiffCard(props: {
  environmentId: EnvironmentId;
  cwd: string;
  scope: ChatDiffScope;
  paths: ReadonlyArray<string> | undefined;
  onOpenGitDiff: (scope: ChatDiffScope, filePath?: string) => void;
}) {
  const { environmentId, cwd, scope, paths, onOpenGitDiff } = props;
  const diffThemeName = useDiffThemeName();
  const preview = useEnvironmentQuery(
    reviewEnvironment.diffPreview({ environmentId, input: { cwd } }),
  );
  const source = preview.data?.sources.find(
    (candidate) => candidate.kind === CHAT_DIFF_SCOPE_SOURCE_KIND[scope],
  );
  const renderablePatch = useMemo(
    () => getRenderablePatch(source?.diff, "chat-diff"),
    [source?.diff],
  );
  const files = useMemo(
    () =>
      renderablePatch?.kind === "files"
        ? filterChatDiffFiles(renderablePatch.files, resolveFileDiffPath, paths)
        : [],
    [paths, renderablePatch],
  );
  const stat = useMemo(() => getDiffLineStat(files), [files]);
  // Explicit toggles override the size-based default, per file path.
  const [toggledPaths, setToggledPaths] = useState<ReadonlyMap<string, boolean>>(new Map());
  const expandedByDefault = files.length <= CHAT_DIFF_AUTO_EXPAND_MAX_FILES;
  const toggleFile = (filePath: string, expanded: boolean) =>
    setToggledPaths((current) => new Map(current).set(filePath, !expanded));

  const scopeLabel = CHAT_DIFF_SCOPE_LABELS[scope];
  const status = preview.error
    ? preview.error
    : !preview.data && preview.isPending
      ? "Loading diff…"
      : renderablePatch?.kind === "raw"
        ? renderablePatch.reason
        : files.length === 0
          ? paths && paths.length > 0
            ? "No changes in the requested files."
            : "No changes."
          : null;

  return (
    <div className="rounded-2xl border border-border/70 bg-secondary p-2 dark:border-transparent dark:bg-input/32">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="flex min-w-0 items-center gap-1.5 py-1.5 text-xs font-medium leading-4">
          <FileDiffIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{scopeLabel}</span>
          {files.length > 0 ? (
            <span className="whitespace-nowrap text-muted-foreground">
              {files.length} file{files.length === 1 ? "" : "s"}
            </span>
          ) : null}
          {hasNonZeroStat(stat) ? (
            <DiffStatLabel
              additions={stat.additions}
              deletions={stat.deletions}
              className="text-xs leading-4"
              layout="inline"
            />
          ) : null}
        </span>
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant="outline"
                  className="!size-[22px]"
                  aria-label="Refresh diff"
                  data-scroll-anchor-ignore
                  onClick={preview.refresh}
                />
              }
            >
              <RefreshIcon refreshing={preview.isPending} className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">Refresh diff</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  aria-label="Open in diff panel"
                  onClick={() => onOpenGitDiff(scope)}
                />
              }
            >
              <span className="hidden sm:inline">Open in panel</span>
              <span className="sm:hidden">Open</span>
            </TooltipTrigger>
            <TooltipPopup side="top">Open the full diff panel</TooltipPopup>
          </Tooltip>
        </div>
      </div>
      {status ? (
        <p className="px-2 pb-1.5 pt-1 text-[11px] text-muted-foreground">{status}</p>
      ) : null}
      {source?.truncated ? (
        <p className="px-2 pb-1.5 text-[11px] text-muted-foreground">
          This diff is too large to show completely. Open it in the panel to review every file.
        </p>
      ) : null}
      {files.length > 0 ? (
        <div className="mt-1 space-y-1.5">
          {files.map((fileDiff) => {
            const filePath = resolveFileDiffPath(fileDiff);
            const expanded = toggledPaths.get(filePath) ?? expandedByDefault;
            const fileStat = getDiffLineStat([fileDiff]);
            return (
              <div key={filePath} className="overflow-hidden rounded-xl bg-background/60">
                <div className="flex items-center gap-1 px-1">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={expanded ? `Collapse ${filePath}` : `Expand ${filePath}`}
                    data-scroll-anchor-ignore
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => toggleFile(filePath, expanded)}
                  >
                    <ChevronRightIcon
                      aria-hidden="true"
                      className={cn(
                        "size-3.5 shrink-0 text-muted-foreground transition-transform",
                        expanded && "rotate-90",
                      )}
                    />
                    <span className="truncate font-mono text-[11px] text-foreground/85">
                      {filePath}
                    </span>
                    {hasNonZeroStat(fileStat) ? (
                      <DiffStatLabel
                        additions={fileStat.additions}
                        deletions={fileStat.deletions}
                        className="text-[11px]"
                        layout="inline"
                      />
                    ) : null}
                  </button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="text-[11px] text-muted-foreground"
                    onClick={() => onOpenGitDiff(scope, filePath)}
                  >
                    Open
                  </Button>
                </div>
                {expanded ? (
                  <FileDiff
                    fileDiff={fileDiff}
                    options={{
                      collapsed: false,
                      diffStyle: "unified",
                      disableFileHeader: true,
                      theme: diffThemeName,
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
