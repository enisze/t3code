import { FolderGit2Icon, FolderGitIcon, FolderIcon, HistoryIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";

import { useBranches } from "../state/queries";
import { parsePullRequestReference } from "../pullRequestReference";

import {
  resolveCurrentWorkspaceLabel,
  resolveEnvModeLabel,
  resolveLockedWorkspaceLabel,
  type EnvMode,
} from "./BranchToolbar.logic";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Input } from "./ui/input";

export const PREVIOUS_WORKTREE_SELECT_VALUE = "previous-worktree";

interface BranchToolbarEnvModeSelectorProps {
  envLocked: boolean;
  environmentId: EnvironmentId;
  cwd: string | null;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  onEnvModeChange: (mode: EnvMode) => void;
  previousWorktreeLabel?: string | null;
  onUsePreviousWorktree?: () => void;
  checkoutPullRequestLabel?: string;
  onCheckoutPullRequest?: (reference: string) => void;
}

export const BranchToolbarEnvModeSelector = memo(function BranchToolbarEnvModeSelector({
  envLocked,
  environmentId,
  cwd,
  effectiveEnvMode,
  activeWorktreePath,
  onEnvModeChange,
  previousWorktreeLabel,
  onUsePreviousWorktree,
  checkoutPullRequestLabel,
  onCheckoutPullRequest,
}: BranchToolbarEnvModeSelectorProps) {
  const showPreviousWorktree = Boolean(previousWorktreeLabel && onUsePreviousWorktree);
  const showCheckoutPullRequest = Boolean(onCheckoutPullRequest);
  const [checkoutReference, setCheckoutReference] = useState("");
  const branchQuery = useBranches({ environmentId, cwd, query: checkoutReference });
  const branchSuggestions = branchQuery.data?.refs.slice(0, 8) ?? [];
  const pullRequestReference = parsePullRequestReference(checkoutReference.trim());
  const envModeItems = useMemo(
    () => [
      { value: "local", label: resolveCurrentWorkspaceLabel(activeWorktreePath) },
      { value: "worktree", label: resolveEnvModeLabel("worktree") },
      ...(showPreviousWorktree && previousWorktreeLabel
        ? [{ value: PREVIOUS_WORKTREE_SELECT_VALUE, label: previousWorktreeLabel }]
        : []),
    ],
    [activeWorktreePath, previousWorktreeLabel, showPreviousWorktree],
  );

  if (envLocked) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 border border-transparent px-[calc(--spacing(3)-1px)] text-sm font-medium text-muted-foreground/70 sm:text-xs">
        {activeWorktreePath ? (
          <>
            <FolderGitIcon className="size-3" />
            {resolveLockedWorkspaceLabel(activeWorktreePath)}
          </>
        ) : (
          <>
            <FolderIcon className="size-3" />
            {resolveLockedWorkspaceLabel(activeWorktreePath)}
          </>
        )}
      </span>
    );
  }

  return (
    <Select
      modal={false}
      value={effectiveEnvMode}
      onValueChange={(value: string | null) => {
        if (value === PREVIOUS_WORKTREE_SELECT_VALUE) {
          onUsePreviousWorktree?.();
          return;
        }
        onEnvModeChange(value as EnvMode);
      }}
      items={envModeItems}
    >
      <SelectTrigger
        variant="ghost"
        size="xs"
        className="shrink-0 font-medium"
        aria-label="Workspace"
      >
        {effectiveEnvMode === "worktree" ? (
          <FolderGit2Icon className="size-3" />
        ) : activeWorktreePath ? (
          <FolderGitIcon className="size-3" />
        ) : (
          <FolderIcon className="size-3" />
        )}
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {showCheckoutPullRequest ? (
          <div className="px-1.5 pt-1.5 pb-1">
            <Input
              autoFocus
              value={checkoutReference}
              placeholder={checkoutPullRequestLabel ?? "Branch or PR"}
              aria-label="Open branch or pull request"
              onChange={(event) => setCheckoutReference(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key !== "Enter" || !checkoutReference.trim()) return;
                event.preventDefault();
                onCheckoutPullRequest?.(checkoutReference.trim());
                setCheckoutReference("");
              }}
            />
            {pullRequestReference || branchSuggestions.length > 0 ? (
              <div className="mt-1 grid max-h-56 overflow-y-auto">
                {pullRequestReference ? (
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onCheckoutPullRequest?.(pullRequestReference);
                      setCheckoutReference("");
                    }}
                  >
                    <FolderGit2Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">Pull request {pullRequestReference}</span>
                  </button>
                ) : null}
                {branchSuggestions.map((ref) => (
                  <button
                    key={`${ref.remoteName ?? "local"}:${ref.name}`}
                    type="button"
                    className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onCheckoutPullRequest?.(
                        ref.remoteName ? `${ref.remoteName}/${ref.name}` : ref.name,
                      );
                      setCheckoutReference("");
                    }}
                  >
                    <FolderGitIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">
                      {ref.remoteName ? `${ref.remoteName}/${ref.name}` : ref.name}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <SelectGroup>
          <SelectGroupLabel>Workspace</SelectGroupLabel>
          <SelectItem value="local">
            <span className="inline-flex items-center gap-1.5">
              {activeWorktreePath ? (
                <FolderGitIcon className="size-3" />
              ) : (
                <FolderIcon className="size-3" />
              )}
              {resolveCurrentWorkspaceLabel(activeWorktreePath)}
            </span>
          </SelectItem>
          <SelectItem value="worktree">
            <span className="inline-flex items-center gap-1.5">
              <FolderGit2Icon className="size-3" />
              {resolveEnvModeLabel("worktree")}
            </span>
          </SelectItem>
          {showPreviousWorktree && previousWorktreeLabel ? (
            <SelectItem value={PREVIOUS_WORKTREE_SELECT_VALUE}>
              <span className="inline-flex items-center gap-1.5">
                <HistoryIcon className="size-3" />
                {previousWorktreeLabel}
              </span>
            </SelectItem>
          ) : null}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
});
