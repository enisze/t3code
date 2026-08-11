import { autoAnimate } from "@formkit/auto-animate";
import { useAtomValue } from "@effect/atom-react";
import {
  canSnooze,
  effectiveSnoozed,
  threadWokeAt,
} from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import type {
  GitHubAccountRef,
  ModelSelection,
  ScopedThreadRef,
  SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import { sanitizeWorktreeBranchPrefix, WORKTREE_BRANCH_PREFIX } from "@t3tools/shared/git";
import {
  AlarmClockIcon,
  AlarmClockOffIcon,
  ArchiveIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ClockIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  FilePenIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  GlobeIcon,
  EllipsisIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2Icon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useNavigate, useParams, useRouter } from "@tanstack/react-router";

import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { isElectron } from "../env";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHintsForModifiers,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { useShortcutModifierState } from "../shortcutModifierState";
import { isTerminalFocused } from "../lib/terminalFocus";
import { useWorkspaceThreadRef } from "../lib/workspaceThreadRef";
import { useThreadPreviewState } from "~/previewStateStore";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { isMacPlatform } from "~/lib/utils";
import { useOpenPrLink } from "../lib/openPullRequestLink";
import { readLocalApi } from "../localApi";
import {
  deriveProjectGroupingOverrideKey,
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "../logicalProject";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectGroupMember,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import {
  legacyProjectCwdPreferenceKey,
  resolveProjectExpanded,
  resolveProjectHidden,
  useUiStateStore,
} from "../uiStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useThreadActions } from "../hooks/useThreadActions";
import { useStaleArchivedWorktreeCleanup } from "../hooks/useStaleArchivedWorktreeCleanup";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { openCommandPalette } from "../commandPaletteBus";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { useClientSettings, useUpdateClientSettings } from "../hooks/useSettings";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects, useThreadShells } from "../state/entities";
import {
  environmentServerConfigsAtom,
  primaryServerKeybindingsAtom,
  primaryServerSettingsAtom,
} from "../state/server";
import { vcsEnvironment } from "../state/vcs";
import { threadEnvironment } from "../state/threads";
import { projectEnvironment } from "../state/projects";
import { orchestrationEnvironment } from "../state/orchestration";
import { sourceControlEnvironment } from "../state/sourceControl";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { formatRelativeTimeLabel, parseTimestampDate } from "../timestampFormat";
import type { SidebarThreadSummary } from "../types";
import { cn } from "~/lib/utils";
import {
  archiveSelectedThreadEntries,
  collapseWorktreeSiblings,
  collectWorktreeSiblingThreads,
  formatWorkingDurationLabel,
  firstValidTimestampMs,
  groupSidebarThreadsByProject,
  hasUnseenCompletion,
  isTrailingDoubleClick,
  mergeWorktreeSiblingRunningStatus,
  orderItemsByPreferredIds,
  resolveAdjacentThreadId,
  resolveSidebarThreadBranch,
  resolveSidebarV2Status,
  resolveWorkingStartedAt,
  resolveWorktreeActiveThread,
  shouldNavigateAfterProjectRemoval,
  sortLogicalProjectsForSidebar,
  sortThreadsForSidebarV2,
} from "./Sidebar.logic";
import { resolveLocalCheckoutBranchMismatch } from "./BranchToolbar.logic";
import { prStatusIndicator, resolveThreadPr } from "./ThreadStatusIndicators";
import {
  resolveSnoozePresets,
  snoozeWakeDescription,
  snoozeWakeLabel,
  type SnoozePreset,
} from "./Sidebar.snooze";
import { GitHubIcon } from "./Icons";
import { ProjectDefaultAgentField } from "./ProjectDefaultAgentField";
import { ProjectDefaultWorktreeBranchField } from "./ProjectDefaultWorktreeBranchField";
import { ProjectScriptsField } from "./ProjectScriptsField";
import { ProjectFavicon } from "./ProjectFavicon";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { getTriggerDisplayModelLabel } from "./chat/providerIconUtils";
import { deriveProviderInstanceEntries, type ProviderInstanceEntry } from "../providerInstances";
import { primaryServerProvidersAtom } from "../state/server";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { CommandDialogTrigger } from "./ui/command";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Kbd } from "./ui/kbd";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { SidebarContent, SidebarGroup, SidebarMenuButton, useSidebar } from "./ui/sidebar";
import { SidebarChromeFooter, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { useComposerDraftStore } from "../composerDraftStore";

const PROJECT_GROUPING_MODE_LABELS: Record<SidebarProjectGroupingMode, string> = {
  repository: "Group by repository",
  repository_path: "Group by repository path",
  separate: "Keep separate",
};

function compactSidebarTimeLabel(label: string): string {
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

function threadTimeLabel(thread: SidebarThreadSummary): string {
  const timestamp = thread.latestUserMessageAt ?? thread.updatedAt;
  return compactSidebarTimeLabel(formatRelativeTimeLabel(timestamp));
}

// Floats at the row's right edge, vertically centered, while the jump
// modifier is held. An overlay pill instead of an inline slot: the hint
// must neither displace the status/time label (holding ⌘ used to blank
// out "Working") nor shift any layout when it appears. pointer-events-none
// so it never swallows clicks meant for the archive/wake buttons it
// can overlap.
function JumpHintBadge(props: { label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-1.5 top-1/2 z-10 inline-flex h-5 -translate-y-1/2 items-center rounded-full border border-border/80 bg-background/95 px-1.5 font-mono text-[10px] font-medium tracking-tight text-foreground shadow-sm"
    >
      {props.label}
    </span>
  );
}

// Self-ticking so only this span re-renders each second, not the whole row.
function WorkingDuration(props: { startedAt: string | null }) {
  const startedMs = props.startedAt !== null ? Date.parse(props.startedAt) : Number.NaN;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (Number.isNaN(startedMs)) return;
    const id = window.setInterval(() => setTick((tick) => tick + 1), 1_000);
    return () => window.clearInterval(id);
  }, [startedMs]);
  if (Number.isNaN(startedMs)) return null;
  return (
    <span className="font-mono tabular-nums">
      {formatWorkingDurationLabel(Date.now() - startedMs)}
    </span>
  );
}

function SidebarV2ThreadTooltip({
  thread,
  displayedBranch,
  projectTitle,
  projectCwd,
  environmentLabel,
  driverKind,
  modelInstanceId,
  modelLabel,
  branchMismatch,
}: {
  thread: SidebarThreadSummary;
  displayedBranch: string | null;
  projectTitle: string | null;
  projectCwd: string | null;
  environmentLabel: string | null;
  driverKind: ProviderInstanceEntry["driverKind"] | null;
  modelInstanceId: string;
  modelLabel: string;
  branchMismatch: {
    threadBranch: string;
    currentBranch: string;
  } | null;
}) {
  return (
    <TooltipPopup
      side="right"
      align="start"
      sideOffset={4}
      variant="glass"
      className="max-w-80 text-left whitespace-normal"
    >
      <div className="flex min-w-0 max-w-80 flex-col gap-2 px-0.5 py-1.5">
        <div className="min-w-0 truncate text-xs leading-none font-medium text-foreground">
          {thread.title}
        </div>
        <div className="grid gap-1.5 pl-0.5 text-xs text-muted-foreground">
          {projectTitle ? (
            <div className="flex min-w-0 items-center gap-2">
              <ProjectFavicon
                environmentId={thread.environmentId}
                cwd={projectCwd ?? ""}
                className="size-3 shrink-0 stroke-muted-foreground"
              />
              <div className="min-w-0 truncate text-foreground/75">{projectTitle}</div>
            </div>
          ) : null}
          {environmentLabel ? (
            <div className="flex min-w-0 items-center gap-2">
              <ServerIcon className="size-3 shrink-0 stroke-muted-foreground" />
              <div className="min-w-0 truncate text-foreground/75">{environmentLabel}</div>
            </div>
          ) : null}
          {displayedBranch ? (
            <div className="flex min-w-0 items-center gap-2">
              <GitBranchIcon className="size-3 shrink-0 stroke-muted-foreground" />
              <div className="min-w-0 truncate text-foreground/75">{displayedBranch}</div>
            </div>
          ) : null}
          {branchMismatch ? (
            <div className="flex min-w-0 items-start gap-2 text-warning">
              <CircleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0 stroke-current" />
              <div className="min-w-0 flex-1 wrap-break-word leading-5">
                You're currently checked out on another branch.
              </div>
            </div>
          ) : null}
          {driverKind ? (
            <div className="flex min-w-0 items-center gap-2">
              <ProviderInstanceIcon
                driverKind={driverKind}
                displayName={thread.session?.providerName ?? modelInstanceId}
                iconClassName="size-3 shrink-0 grayscale opacity-60"
              />
              <div className="min-w-0 truncate text-foreground/75">{modelLabel}</div>
            </div>
          ) : null}
          {thread.session?.lastError ? (
            <div className="flex min-w-0 items-center gap-2 text-red-600 dark:text-red-400">
              <CircleAlertIcon className="size-3 shrink-0 stroke-current" />
              <div className="min-w-0 truncate">Error occurred</div>
            </div>
          ) : null}
        </div>
      </div>
    </TooltipPopup>
  );
}

/**
 * Hover entry point for snooze: a clock button opening the preset menu.
 * Controlled by the row (which also uses the open state to pin its hover
 * actions while the menu is up).
 */
function SnoozePopoverButton(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (preset: SnoozePreset) => void;
}) {
  const { open, onOpenChange, onSnooze } = props;
  // Presets resolve at open time so "In 1 hour" is relative to the click,
  // not to when the row mounted.
  const presets = useMemo(() => (open ? resolveSnoozePresets(new Date()) : []), [open]);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Snooze thread"
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            className="inline-flex h-full cursor-pointer items-center gap-0.5 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
          />
        }
      >
        <ClockIcon className="size-3" />
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" className="w-56" viewportClassName="p-1">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenChange(false);
              onSnooze(preset);
            }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/90 hover:bg-accent hover:text-foreground"
          >
            <span className="flex-1">{preset.label}</span>
            <span className="font-mono text-[10px] text-muted-foreground/60 tabular-nums">
              {preset.whenLabel}
            </span>
          </button>
        ))}
      </PopoverPopup>
    </Popover>
  );
}

const SidebarV2Row = memo(function SidebarV2Row(props: {
  thread: SidebarThreadSummary;
  // Cards are active inbox threads; slim rows are the snoozed shelf. Archived
  // threads leave the sidebar entirely, so there is no third row variant.
  variant: "card" | "slim";
  // False on environments whose server predates thread.snooze/unsnooze:
  // the snooze affordance hides entirely rather than fail on click.
  snoozeSupported: boolean;
  // Compact wake countdown ("2h") for rows in the snoozed shelf.
  snoozeWakeLabelText: string | null;
  // When a snooze ended (timer or early wake); drives the Woke pill until
  // the user visits the thread.
  wokeAt: string | null;
  isActive: boolean;
  jumpLabel: string | null;
  currentEnvironmentId: string | null;
  environmentLabel: string | null;
  projectCwd: string | null;
  projectTitle: string | null;
  // When the inbox is grouped by project, a project header already names the
  // section, so the card's own project favicon + label are suppressed to avoid
  // repeating it on every row. The tooltip still carries the project name.
  showProjectLabel: boolean;
  providerEntryByInstanceId: ReadonlyMap<string, ProviderInstanceEntry>;
  onThreadClick: (event: ReactMouseEvent, threadRef: ScopedThreadRef) => void;
  onThreadActivate: (threadRef: ScopedThreadRef) => void;
  onStartRename: (threadRef: ScopedThreadRef, title: string) => void;
  onRenameTitleChange: (title: string) => void;
  onCommitRename: (threadRef: ScopedThreadRef, title: string, originalTitle: string) => void;
  onCancelRename: () => void;
  isRenaming: boolean;
  renamingTitle: string;
  onContextMenu: (threadRef: ScopedThreadRef, position: { x: number; y: number }) => void;
  onArchive: (threadRef: ScopedThreadRef) => void;
  onSnooze: (threadRef: ScopedThreadRef, preset: SnoozePreset) => void;
  onUnsnooze: (threadRef: ScopedThreadRef) => void;
  onChangeRequestState: (threadKey: string, state: "open" | "closed" | "merged" | null) => void;
}) {
  const {
    isRenaming,
    onArchive,
    onChangeRequestState,
    onCancelRename,
    onCommitRename,
    onContextMenu,
    onRenameTitleChange,
    onSnooze,
    onStartRename,
    onThreadActivate,
    onThreadClick,
    onUnsnooze,
    renamingTitle,
    thread,
    variant,
  } = props;
  const threadRef = useMemo(
    () => scopeThreadRef(thread.environmentId, thread.id),
    [thread.environmentId, thread.id],
  );
  const threadKey = scopedThreadKey(threadRef);
  // The browser preview shares the worktree's workspace panel, so its live
  // state is keyed by the representative thread ref (same as diff/files/
  // terminals), not the raw per-row ref. A non-empty session map means a
  // browser is currently running for this row's workspace.
  const workspaceThreadRef = useWorkspaceThreadRef(threadRef) ?? threadRef;
  const previewRunning = Object.keys(useThreadPreviewState(workspaceThreadRef).sessions).length > 0;
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const openPrLink = useOpenPrLink();

  // Same semantics as v1 (never-visited counts as read): flipping the beta
  // flag must not light up every historical thread as unread.
  const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
  const status = resolveSidebarV2Status(thread);
  // A woken thread reappears at its original position (the sort is
  // deliberately static), so the pill has to carry the weight. Snoozing is
  // an explicit act, so unlike Done, a never-visited woke thread still
  // shows the pill; visiting clears it. An unparseable visit timestamp
  // counts as never-visited — corrupt local data must not eat the wake
  // signal.
  const lastVisitedDate = lastVisitedAt === undefined ? null : parseTimestampDate(lastVisitedAt);
  const wokeAtDate = props.wokeAt === null ? null : parseTimestampDate(props.wokeAt);
  const isWoke = wokeAtDate !== null && (lastVisitedDate === null || lastVisitedDate < wokeAtDate);
  // Rows waiting on a human (approval/input) fade as a whole: there is nothing
  // to do yet, so prominence is reserved for rows that need action — done
  // (unread), read-but-unhandled, failed, and freshly woken. Their colored
  // status label keeps its hue so they stay findable. Working rows do NOT
  // recede: an actively-running thread should read as live (full prominence +
  // its animated status circle), not dimmed like a snoozed row.
  const isWaiting = status === "approval" || status === "input";
  const shouldRecede =
    (status === "ready" || isWaiting) && !isUnread && !isWoke && !props.isActive && !isSelected;
  // Status hues follow the system-wide convention set by sidebar v1 and the
  // mobile Live Activity/widgets (amber approval, indigo input, sky working)
  // so a thread reads the same color everywhere it surfaces.
  const topStatus =
    status === "working"
      ? {
          label: "Working",
          icon: "working" as const,
          className:
            "animate-sidebar-working-text text-sky-600 motion-reduce:animate-none dark:text-sky-400",
        }
      : status === "approval"
        ? {
            label: "Approval",
            icon: null,
            className: "text-amber-700 dark:text-amber-300",
          }
        : status === "input"
          ? {
              label: "Input",
              icon: null,
              className: "text-indigo-600 dark:text-indigo-300",
            }
          : status === "failed"
            ? {
                label: "Failed",
                icon: null,
                className: "text-red-700 dark:text-red-300",
              }
            : isWoke
              ? {
                  label: "Woke",
                  icon: "woke" as const,
                  className: "text-amber-700 dark:text-amber-300",
                }
              : isUnread
                ? {
                    label: "Done",
                    icon: "done" as const,
                    className: "text-emerald-700 dark:text-emerald-300",
                  }
                : null;

  const gitCwd = thread.worktreePath ?? props.projectCwd;
  const gitStatus = useEnvironmentQuery(
    (thread.branch != null || thread.worktreePath !== null) && gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: { cwd: gitCwd },
        })
      : null,
  );
  const branchMismatch = resolveLocalCheckoutBranchMismatch({
    effectiveEnvMode: thread.worktreePath === null ? "local" : "worktree",
    activeWorktreePath: thread.worktreePath,
    activeThreadBranch: thread.branch,
    currentGitBranch: gitStatus.data?.refName ?? null,
  });
  const displayedBranch = resolveSidebarThreadBranch({
    worktreePath: thread.worktreePath,
    threadBranch: thread.branch,
    currentGitBranch: gitStatus.data?.refName ?? null,
  });
  const pr = resolveThreadPr({
    threadBranch: displayedBranch,
    gitStatus: gitStatus.data,
  });
  const prStatus = prStatusIndicator(pr, gitStatus.data?.sourceControlProvider);
  // Report the PR state up: the context menu offers "Continue in new worktree"
  // only on merged PRs, and only rows own the VCS subscription that knows it.
  const prState = pr?.state ?? null;
  useEffect(() => {
    onChangeRequestState(threadKey, prState);
  }, [onChangeRequestState, prState, threadKey]);

  const modelInstanceId = thread.session?.providerInstanceId ?? thread.modelSelection.instanceId;
  const providerEntry = props.providerEntryByInstanceId.get(modelInstanceId) ?? null;
  const driverKind = providerEntry?.driverKind ?? null;
  const selectedModel = providerEntry?.models.find(
    (model) => model.slug === thread.modelSelection.model,
  );
  const modelLabel = selectedModel
    ? getTriggerDisplayModelLabel(selectedModel)
    : thread.modelSelection.model;

  const isRemote =
    props.currentEnvironmentId !== null && thread.environmentId !== props.currentEnvironmentId;

  const detailsTooltip = (
    <SidebarV2ThreadTooltip
      thread={thread}
      displayedBranch={displayedBranch}
      projectTitle={props.projectTitle}
      projectCwd={props.projectCwd}
      environmentLabel={props.environmentLabel}
      driverKind={driverKind}
      modelInstanceId={modelInstanceId}
      modelLabel={modelLabel}
      branchMismatch={branchMismatch}
    />
  );

  const handleClick = useCallback(
    (event: ReactMouseEvent) => {
      onThreadClick(event, threadRef);
    },
    [onThreadClick, threadRef],
  );
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      onContextMenu(threadRef, { x: event.clientX, y: event.clientY });
    },
    [onContextMenu, threadRef],
  );
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onThreadActivate(threadRef);
    },
    [onThreadActivate, threadRef],
  );
  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (isRenaming || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      if ((event.target as HTMLElement).closest("button, a, input")) return;
      event.preventDefault();
      onStartRename(threadRef, thread.title);
    },
    [isRenaming, onStartRename, thread.title, threadRef],
  );
  const renameCommittedRef = useRef(false);
  useEffect(() => {
    if (isRenaming) renameCommittedRef.current = false;
  }, [isRenaming]);
  const handleRenameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        renameCommittedRef.current = true;
        onCommitRename(threadRef, renamingTitle, thread.title);
      } else if (event.key === "Escape") {
        event.preventDefault();
        renameCommittedRef.current = true;
        onCancelRename();
      }
    },
    [onCancelRename, onCommitRename, renamingTitle, thread.title, threadRef],
  );
  const handleRenameBlur = useCallback(() => {
    if (!renameCommittedRef.current) {
      onCommitRename(threadRef, renamingTitle, thread.title);
    }
  }, [onCommitRename, renamingTitle, thread.title, threadRef]);
  const handleArchiveClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onArchive(threadRef);
    },
    [onArchive, threadRef],
  );
  const handleUnsnoozeClick = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onUnsnooze(threadRef);
    },
    [onUnsnooze, threadRef],
  );
  const handleSnoozePreset = useCallback(
    (preset: SnoozePreset) => {
      onSnooze(threadRef, preset);
    },
    [onSnooze, threadRef],
  );
  // While the snooze popover is open the pointer leaves the row, which
  // would fade the hover actions out from under the open menu; pin them.
  const [snoozeMenuOpenRaw, setSnoozeMenuOpen] = useState(false);
  // Snooze is offered only where it can succeed: capability-gated and never
  // on blocked-on-you work or queued turns (the server rejects both).
  const showSnoozeButton =
    props.snoozeSupported && canSnooze(thread, { now: new Date().toISOString() });
  // If the thread becomes blocked while the popover is open, the button
  // unmounts without firing onOpenChange(false). Deriving the flag keeps a
  // stale true from permanently hiding the status label / pinning the
  // hover actions, and the effect clears the raw state so the popover
  // doesn't resurrect if the button later remounts.
  const snoozeMenuOpen = snoozeMenuOpenRaw && showSnoozeButton;
  useEffect(() => {
    if (!showSnoozeButton) setSnoozeMenuOpen(false);
  }, [showSnoozeButton]);
  const handlePrClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (pr?.url) openPrLink(event, pr.url);
    },
    [openPrLink, pr],
  );

  // All Sidebar V2 rows share one surface model. Live threads used to look
  // like elevated cards while quiet threads were plain rows, leaving neither
  // a useful hierarchy nor a reliable hover cue. Status now lives in the row
  // content; surface is reserved for interaction (hover, multi-select, route).
  const rowSurfaceClassName = cn(
    "group/v2-row relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none",
    props.isActive
      ? "bg-sidebar-row-active text-sidebar-foreground"
      : isSelected
        ? "bg-sidebar-row-selected text-sidebar-foreground"
        : shouldRecede
          ? "text-sidebar-muted-foreground/75 hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
          : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
    isWaiting &&
      !props.isActive &&
      !isSelected &&
      "opacity-70 transition-opacity hover:opacity-100",
  );

  const title = isRenaming ? (
    <input
      autoFocus
      value={renamingTitle}
      aria-label="Thread title"
      onChange={(event) => onRenameTitleChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={handleRenameKeyDown}
      onBlur={handleRenameBlur}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm font-medium text-card-foreground outline-none focus:border-foreground"
    />
  ) : (
    <span
      className={cn(
        "min-w-0 flex-1 text-sm",
        shouldRecede ? "font-normal" : "font-medium",
        variant === "card"
          ? cn(
              "truncate",
              isUnread || isWoke
                ? "text-foreground"
                : shouldRecede
                  ? "text-muted-foreground/80"
                  : status === "failed"
                    ? "text-foreground/95"
                    : "text-foreground/90",
            )
          : cn(
              "truncate group-hover/v2-row:text-foreground",
              props.isActive || isWoke
                ? "text-foreground"
                : isUnread
                  ? "text-muted-foreground"
                  : "text-muted-foreground/70",
            ),
      )}
    >
      {thread.title}
    </span>
  );

  const prBadge =
    prStatus && pr ? (
      <button
        type="button"
        onClick={handlePrClick}
        className={cn("shrink-0 font-mono text-xs hover:underline", prStatus.colorClass)}
        aria-label={prStatus.tooltip}
      >
        #{pr.number}
      </button>
    ) : null;

  if (variant === "slim") {
    return (
      <li
        data-thread-item
        className="list-none [content-visibility:auto] [contain-intrinsic-size:auto_34px]"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <div
                role="button"
                tabIndex={0}
                data-testid="sidebar-v2-row-slim"
                className={cn(rowSurfaceClassName, "flex h-9 items-center gap-2.5 px-2.5")}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onKeyDown={handleKeyDown}
                onContextMenu={handleContextMenu}
              />
            }
          >
            {/* Snoozed history recedes: dimmed favicon at rest, restored on
              hover so the shelf stays scannable when you're hunting. */}
            <span
              className={cn(
                "shrink-0 transition-opacity",
                !props.isActive &&
                  "opacity-40 grayscale group-hover/v2-row:opacity-100 group-hover/v2-row:grayscale-0",
              )}
            >
              <ProjectFavicon
                environmentId={thread.environmentId}
                cwd={props.projectCwd ?? ""}
                className="size-4"
                fallbackIcon={MessageSquareIcon}
              />
            </span>
            {title}
            {previewRunning ? (
              <span className="inline-flex shrink-0 items-center text-sidebar-muted-foreground/70">
                <GlobeIcon aria-hidden className="size-3.5" />
              </span>
            ) : null}
            {/* The PR badge stays outside the hover-fading slot: it must
              remain visible AND clickable while the row is hovered. Only
              the time/jump label yields to the wake affordance. */}
            {prBadge}
            <span className="relative ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end">
              <span className="inline-flex justify-end tabular-nums text-muted-foreground/55 transition-opacity group-hover/v2-row:opacity-0">
                {props.snoozeWakeLabelText !== null ? (
                  // Snoozed rows show when they come BACK, not when they were
                  // last touched — the return ticket is the row's whole story.
                  <span className="text-xs text-blue-600 tabular-nums dark:text-blue-400">
                    {props.snoozeWakeLabelText}
                  </span>
                ) : isWoke ? (
                  <span
                    role="status"
                    aria-label="Woke from snooze"
                    className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300"
                  >
                    <AlarmClockIcon aria-hidden className="size-3" />
                    Woke
                  </span>
                ) : (
                  <span className="text-xs">{threadTimeLabel(thread)}</span>
                )}
              </span>
              {props.snoozeSupported ? (
                <button
                  type="button"
                  aria-label="Wake thread now"
                  onClick={handleUnsnoozeClick}
                  className="absolute inset-y-0 right-0 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-2 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/v2-row:opacity-100"
                >
                  <AlarmClockOffIcon className="size-3" />
                </button>
              ) : null}
            </span>
            {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
          </TooltipTrigger>
          {detailsTooltip}
        </Tooltip>
      </li>
    );
  }

  const diff = latestTurnDiff(thread);

  return (
    <li
      data-thread-item
      className="list-none py-0.5 [content-visibility:auto] [contain-intrinsic-size:auto_96px]"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              role="button"
              tabIndex={0}
              data-testid="sidebar-v2-row-card"
              className={rowSurfaceClassName}
              onClick={handleClick}
              onDoubleClick={handleDoubleClick}
              onKeyDown={handleKeyDown}
              onContextMenu={handleContextMenu}
            />
          }
        >
          <div className="relative z-10 h-[4.875rem] px-2.5 py-2">
            <div className="flex h-5 min-w-0 items-center gap-1.5">
              {props.showProjectLabel ? (
                <>
                  <ProjectFavicon
                    environmentId={thread.environmentId}
                    cwd={props.projectCwd ?? ""}
                    className="size-4 shrink-0"
                  />
                  {props.projectTitle ? (
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-xs text-muted-foreground/85",
                        shouldRecede ? "font-normal" : "font-medium",
                      )}
                    >
                      {props.projectTitle}
                    </span>
                  ) : (
                    <span className="flex-1" />
                  )}
                </>
              ) : (
                <span className="flex-1" />
              )}
              {/* The visible state owns this slot's width: status at rest,
                  actions on hover/focus or while the popover is open. Keeping
                  the hidden state out of flow lets the project label reclaim
                  space without either state overlapping it. */}
              <span className="group/v2-status-slot relative ml-auto flex h-5 min-w-8 shrink-0 items-stretch justify-end text-xs">
                <span
                  className={cn(
                    "self-center justify-self-end tabular-nums text-muted-foreground/65 transition-opacity group-focus-within/v2-status-slot:absolute group-focus-within/v2-status-slot:right-0 group-hover/v2-row:absolute group-hover/v2-row:right-0 group-hover/v2-row:opacity-0",
                    snoozeMenuOpen && "absolute right-0 opacity-0",
                  )}
                >
                  {topStatus ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 font-medium",
                        topStatus.className,
                      )}
                    >
                      {topStatus.icon === "working" ? (
                        <CircleDashedIcon
                          aria-hidden
                          className="size-4 shrink-0 animate-spin [animation-duration:2s] motion-reduce:animate-none"
                        />
                      ) : topStatus.icon === "done" ? (
                        <CircleCheckIcon aria-hidden className="size-4 shrink-0" />
                      ) : topStatus.icon === "woke" ? (
                        <AlarmClockIcon aria-hidden className="size-4 shrink-0" />
                      ) : null}
                      {/* The label alone is the live region: a role="status"
                          wrapper around the ticking duration would make
                          screen readers announce every second. */}
                      <span role="status">{topStatus.label}</span>
                      {status === "working" ? (
                        <span aria-hidden>
                          <WorkingDuration startedAt={resolveWorkingStartedAt(thread)} />
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    threadTimeLabel(thread)
                  )}
                </span>
                <span
                  className={cn(
                    "absolute inset-y-0 right-0 flex items-stretch opacity-0 transition-opacity focus-within:static focus-within:opacity-100 group-hover/v2-row:static group-hover/v2-row:opacity-100",
                    snoozeMenuOpen && "static opacity-100",
                  )}
                >
                  {showSnoozeButton ? (
                    <SnoozePopoverButton
                      open={snoozeMenuOpen}
                      onOpenChange={setSnoozeMenuOpen}
                      onSnooze={handleSnoozePreset}
                    />
                  ) : null}
                  <button
                    type="button"
                    aria-label="Archive thread"
                    onClick={handleArchiveClick}
                    className="-mr-1 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ArchiveIcon className="size-3.5" />
                    Archive
                  </button>
                </span>
              </span>
            </div>
            <div className="mt-1 flex min-w-0">{title}</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground/75">
              {displayedBranch ? (
                <span className="min-w-0 flex-1 truncate whitespace-nowrap">{displayedBranch}</span>
              ) : (
                <span className="flex-1" />
              )}
              {prBadge}
              {gitStatus.data?.hasWorkingTreeChanges ? (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 font-mono text-amber-600 dark:text-amber-400"
                  title={`${gitStatus.data.workingTree.files.length} modified file${
                    gitStatus.data.workingTree.files.length === 1 ? "" : "s"
                  } in the working tree`}
                >
                  <FilePenIcon aria-hidden className="size-3" />
                  {gitStatus.data.workingTree.files.length}
                </span>
              ) : null}
              {diff ? (
                <span className="shrink-0 font-mono">
                  <span className="text-emerald-600 dark:text-emerald-400">+{diff.insertions}</span>{" "}
                  <span className="text-red-600 dark:text-red-400">−{diff.deletions}</span>
                </span>
              ) : null}
              <span
                aria-hidden
                className="pointer-events-none ml-auto inline-flex shrink-0 items-center gap-1"
              >
                {previewRunning ? (
                  <span className="inline-flex shrink-0 items-center text-sidebar-muted-foreground/70">
                    <GlobeIcon aria-hidden className="size-3.5" />
                  </span>
                ) : null}
                {isRemote ? (
                  <span className="inline-flex shrink-0 items-center text-sidebar-muted-foreground/70">
                    <ServerIcon aria-hidden className="size-3.5" />
                  </span>
                ) : null}
                {driverKind ? (
                  <span className="inline-flex shrink-0 items-center opacity-60">
                    <ProviderInstanceIcon
                      driverKind={driverKind}
                      displayName={thread.session?.providerName ?? modelInstanceId}
                      iconClassName="size-3.5"
                    />
                  </span>
                ) : null}
              </span>
            </div>
          </div>
          {props.jumpLabel ? <JumpHintBadge label={props.jumpLabel} /> : null}
        </TooltipTrigger>
        {detailsTooltip}
      </Tooltip>
    </li>
  );
});

function latestTurnDiff(
  thread: SidebarThreadSummary,
): { insertions: number; deletions: number } | null {
  // Shells don't carry checkpoint summaries; diff stats render only when the
  // shell projection grows them. Kept as a seam so the row layout is ready.
  void thread;
  return null;
}

// Preference keys a project group's expand/collapse state is stored under.
// Mirrors the legacy sidebar so grouped chats collapse consistently across both.
function projectExpansionPreferenceKeys(group: SidebarProjectSnapshot): string[] {
  return [
    group.projectKey,
    ...group.memberProjects.map((member) => member.physicalProjectKey),
    ...group.memberProjects.map((member) => legacyProjectCwdPreferenceKey(member.workspaceRoot)),
  ];
}

// Sentinel Select value for "attach nothing, use the machine-global default
// gh account". Real accounts encode host+login into an opaque key so the
// Select can round-trip a value back to a GitHubAccountRef.
const GITHUB_DEFAULT_ACCOUNT_VALUE = "__default__";

function githubAccountValue(account: { readonly host: string; readonly login: string }): string {
  return `${account.host}\u0000${account.login}`;
}

// github.com is the overwhelmingly common host, so hide it to keep the label
// short; surface the host only for GitHub Enterprise / self-hosted accounts.
function githubAccountLabel(account: { readonly host: string; readonly login: string }): string {
  return account.host === "github.com" ? account.login : `${account.login} · ${account.host}`;
}

// Per-project GitHub account selector. Reads the same source-control discovery
// query the settings panel uses (scoped to the member's environment) and only
// offers authenticated accounts. Selecting an option attaches that account to
// the project; "Use default account" clears it back to the machine default.
function ProjectGitHubAccountField({
  member,
  onSelect,
}: {
  readonly member: SidebarProjectGroupMember;
  readonly onSelect: (member: SidebarProjectGroupMember, account: GitHubAccountRef | null) => void;
}) {
  const discovery = useEnvironmentQuery(
    sourceControlEnvironment.discovery({ environmentId: member.environmentId, input: {} }),
  );
  const allAccounts = useMemo(
    () =>
      discovery.data?.sourceControlProviders.find((provider) => provider.kind === "github")
        ?.accounts ?? [],
    [discovery.data],
  );
  const accounts = useMemo(
    () => allAccounts.filter((account) => account.authenticated),
    [allAccounts],
  );
  const accountByValue = useMemo(
    () => new Map(accounts.map((account) => [githubAccountValue(account), account] as const)),
    [accounts],
  );
  const current = member.gitHubAccount;
  const isLoading = discovery.isPending && discovery.data === null;

  // The selected account is unusable when `gh` no longer lists it as
  // authenticated (token expired/revoked) or doesn't know it at all. Git then
  // silently falls back to the machine default account, so flag it here — the
  // one place where the selection can be changed or re-authenticated.
  const currentHealth =
    current === null
      ? undefined
      : allAccounts.find(
          (account) => account.host === current.host && account.login === current.login,
        );
  const currentAuthError =
    current !== null &&
    discovery.data !== null &&
    (currentHealth === undefined || !currentHealth.authenticated)
      ? (currentHealth?.authError ?? "it is not signed in to the GitHub CLI")
      : null;

  const label = <span className="font-medium text-foreground">GitHub account</span>;

  if (accounts.length === 0) {
    return (
      <label className="grid min-w-0 gap-1.5 sm:col-span-2">
        {label}
        <p className="text-sm text-muted-foreground">
          {isLoading ? (
            "Loading accounts…"
          ) : (
            <>
              No GitHub accounts — run{" "}
              <code className="rounded bg-muted px-1 py-px text-[11px]">gh auth login</code>
            </>
          )}
        </p>
      </label>
    );
  }

  const currentValue = current ? githubAccountValue(current) : GITHUB_DEFAULT_ACCOUNT_VALUE;

  return (
    <label className="grid min-w-0 gap-1.5">
      {label}
      <Select
        value={currentValue}
        onValueChange={(value) => {
          if (value === null || value === GITHUB_DEFAULT_ACCOUNT_VALUE) {
            onSelect(member, null);
            return;
          }
          const account = accountByValue.get(value);
          if (account) {
            onSelect(member, { host: account.host, login: account.login });
          }
        }}
      >
        <SelectTrigger
          className="w-full sm:min-h-7.5"
          aria-label={`GitHub account for ${member.environmentLabel ?? "current environment"}`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <GitHubIcon className="size-3.5 shrink-0 opacity-70" aria-hidden />
            <SelectValue>{current ? githubAccountLabel(current) : "Default account"}</SelectValue>
          </span>
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          <SelectItem hideIndicator value={GITHUB_DEFAULT_ACCOUNT_VALUE}>
            Use default account
          </SelectItem>
          {accounts.map((account) => (
            <SelectItem
              key={githubAccountValue(account)}
              hideIndicator
              value={githubAccountValue(account)}
            >
              {githubAccountLabel(account)}
              {account.active ? " (default)" : ""}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {current !== null && currentAuthError !== null ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {githubAccountLabel(current)} can’t be used because {currentAuthError}. Git runs as your
          default account until you re-authenticate with{" "}
          <code className="rounded bg-muted px-1 py-px text-[11px]">gh auth login</code>.
        </p>
      ) : null}
    </label>
  );
}

export default function SidebarV2() {
  const projects = useProjects();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const threads = useThreadShells();
  const router = useRouter();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const confirmThreadDelete = useClientSettings((s) => s.confirmThreadDelete);
  const sidebarProjectSortOrder = useClientSettings((s) => s.sidebarProjectSortOrder);
  const groupByProject = useClientSettings((s) => s.sidebarV2GroupByProject);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const { archiveThread, snoozeThread, unsnoozeThread, deleteThread } = useThreadActions();
  // Housekeeping for the archive lifecycle: once per session, offer to delete
  // worktrees whose chats are all archived and untouched for 5+ weeks.
  useStaleArchivedWorktreeCleanup();
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const deleteProject = useAtomCommand(projectEnvironment.delete, {
    reportFailure: false,
  });
  const updateProject = useAtomCommand(projectEnvironment.update, {
    reportFailure: false,
  });
  const generateContinuationSummary = useAtomCommand(orchestrationEnvironment.continuationSummary, {
    reportFailure: false,
  });
  const updateSettings = useUpdateClientSettings();
  const { copyToClipboard: copyProjectPath } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: path,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const [projectActionsTarget, setProjectActionsTarget] = useState<SidebarProjectSnapshot | null>(
    null,
  );
  const [projectScopeMenuOpen, setProjectScopeMenuOpen] = useState(false);
  const newThreadContext = useHandleNewThread();
  const openAddProjectCommandPalette = useCallback(
    () => openCommandPalette({ open: "add-project" }),
    [],
  );
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const markThreadUnread = useUiStateStore((s) => s.markThreadUnread);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const routeThreadRef = useMemo(
    () => resolveActiveThreadRouteRef(routeTarget, routeDraftThread),
    [routeDraftThread, routeTarget],
  );
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;
  const routeTargetRef = useRef(routeTarget);
  routeTargetRef.current = routeTarget;
  // Post-park navigation validates against the CURRENT route, not the one
  // captured when the snooze started: if the user navigated elsewhere while
  // the command was in flight, completing it must not yank them away.
  const routeThreadKeyRef = useRef(routeThreadKey);
  routeThreadKeyRef.current = routeThreadKey;

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
        getPreferenceIds: (project) => [
          getProjectOrderKey(project),
          legacyProjectCwdPreferenceKey(project.workspaceRoot),
        ],
      }),
    [projectOrder, projects],
  );
  const unsortedProjectGroups = useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects: sidebarProjectSortOrder === "manual" ? orderedProjects : projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
      }),
    [
      environmentLabelById,
      orderedProjects,
      primaryEnvironmentId,
      projectGroupingSettings,
      projects,
      sidebarProjectSortOrder,
    ],
  );
  const projectGroups = useMemo(
    () => sortLogicalProjectsForSidebar(unsortedProjectGroups, threads, sidebarProjectSortOrder),
    [sidebarProjectSortOrder, threads, unsortedProjectGroups],
  );
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const globalWorktreeBranchPrefix = useAtomValue(primaryServerSettingsAtom).worktreeBranchPrefix;
  const providerEntryByInstanceId = useMemo(
    () =>
      new Map(
        deriveProviderInstanceEntries(serverProviders).map(
          (entry) => [entry.instanceId as string, entry] as const,
        ),
      ),
    [serverProviders],
  );
  const projectCwdByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          `${project.environmentId}:${project.id}`,
          project.workspaceRoot,
        ]),
      ),
    [projects],
  );
  const projectDisplayNameByKey = useMemo(
    () =>
      new Map(
        projectGroups.flatMap((group) =>
          group.memberProjects.map(
            (project) => [`${project.environmentId}:${project.id}`, group.displayName] as const,
          ),
        ),
      ),
    [projectGroups],
  );
  // Maps for the group-by-project inbox: member project ref → its group key
  // (so a thread resolves to the section it belongs to), and group key → the
  // snapshot that renders the section header (favicon, display name).
  const projectKeyByMemberKey = useMemo(
    () =>
      new Map(
        projectGroups.flatMap((group) =>
          group.memberProjectRefs.map(
            (projectRef) =>
              [`${projectRef.environmentId}:${projectRef.projectId}`, group.projectKey] as const,
          ),
        ),
      ),
    [projectGroups],
  );
  const projectGroupByKey = useMemo(
    () => new Map(projectGroups.map((group) => [group.projectKey, group] as const)),
    [projectGroups],
  );

  // Snooze wake times are second-precise. The tick is a plain counter bumped
  // exactly at the next wake boundary (armed below, after the partition knows
  // the boundary); the partition reads a fresh clock whenever it recomputes.
  const [snoozeWakeTick, bumpSnoozeWakeTick] = useState(0);

  // PR states stream in per-row (rows own the VCS subscriptions); the context
  // menu offers "Continue in new worktree" only when a thread's PR has merged.
  const [changeRequestStateByKey, setChangeRequestStateByKey] = useState<
    ReadonlyMap<string, "open" | "closed" | "merged">
  >(() => new Map());
  const handleChangeRequestState = useCallback(
    (threadKey: string, state: "open" | "closed" | "merged" | null) => {
      setChangeRequestStateByKey((current) => {
        if ((current.get(threadKey) ?? null) === state) return current;
        const next = new Map(current);
        if (state === null) {
          next.delete(threadKey);
        } else {
          next.set(threadKey, state);
        }
        return next;
      });
    },
    [],
  );

  // Project scope: one menu above the list. Scoping filters the list without
  // making the header width depend on the number or length of project names.
  const [projectScopeKey, setProjectScopeKey] = useState<string | null>(null);
  const scopedProjectGroup = useMemo(
    () =>
      projectScopeKey === null
        ? null
        : (projectGroups.find((project) => project.projectKey === projectScopeKey) ?? null),
    [projectGroups, projectScopeKey],
  );
  const scopedProjectKeys = useMemo(
    () =>
      scopedProjectGroup === null
        ? null
        : new Set(
            scopedProjectGroup.memberProjectRefs.map(
              (projectRef) => `${projectRef.environmentId}:${projectRef.projectId}`,
            ),
          ),
    [scopedProjectGroup],
  );
  useEffect(() => {
    if (projectScopeKey !== null && scopedProjectGroup === null) {
      setProjectScopeKey(null);
    }
  }, [projectScopeKey, scopedProjectGroup]);
  // Scope flips drop the selection: rows selected under the old scope may be
  // hidden now, and bulk actions must never count or touch invisible rows.
  useEffect(() => {
    clearSelection();
  }, [clearSelection, projectScopeKey]);

  const handleRemoveProjectMembers = useCallback(
    async (projectGroup: SidebarProjectSnapshot, members: readonly SidebarProjectGroupMember[]) => {
      const api = readLocalApi();
      if (!api) return;

      const memberKeys = new Set(members.map((member) => `${member.environmentId}:${member.id}`));
      const projectThreads = threads.filter((thread) =>
        memberKeys.has(`${thread.environmentId}:${thread.projectId}`),
      );
      const isWholeGroup = members.length === projectGroup.memberProjects.length;
      const singleMember = members.length === 1 ? members[0]! : null;
      const targetLabel = singleMember?.title ?? projectGroup.displayName;
      const confirmed = await settlePromise(() =>
        api.dialogs.confirm(
          projectThreads.length > 0
            ? [
                `Remove project "${targetLabel}" and delete its ${projectThreads.length} thread${projectThreads.length === 1 ? "" : "s"}?`,
                ...(singleMember
                  ? [
                      `Path: ${singleMember.workspaceRoot}`,
                      ...(singleMember.environmentLabel
                        ? [`Environment: ${singleMember.environmentLabel}`]
                        : []),
                    ]
                  : [`This removes ${members.length} grouped project entries.`]),
                "This permanently clears conversation history for those threads.",
                isWholeGroup
                  ? "This removes only the project entries, not the files on disk."
                  : "Other entries in this grouped project are unaffected.",
                "This action cannot be undone.",
              ].join("\n")
            : [
                `Remove project "${targetLabel}"?`,
                ...(singleMember
                  ? [
                      `Path: ${singleMember.workspaceRoot}`,
                      ...(singleMember.environmentLabel
                        ? [`Environment: ${singleMember.environmentLabel}`]
                        : []),
                    ]
                  : [`This removes ${members.length} grouped project entries.`]),
                isWholeGroup
                  ? "This removes only the project entries, not the files on disk."
                  : "Other entries in this grouped project are unaffected.",
              ].join("\n"),
        ),
      );
      if (confirmed._tag === "Failure" || !confirmed.value) return;

      const draftStore = useComposerDraftStore.getState();
      let shouldNavigate = false;
      for (const project of members) {
        const memberThreads = projectThreads.filter(
          (thread) =>
            thread.environmentId === project.environmentId && thread.projectId === project.id,
        );
        const projectRef = scopeProjectRef(project.environmentId, project.id);
        const projectDraftThread = draftStore.getDraftThreadByProjectRef(projectRef);
        const memberRemovalNeedsNavigation = shouldNavigateAfterProjectRemoval({
          routeTarget: routeTargetRef.current,
          projectThreads: memberThreads,
          projectDraftId: projectDraftThread?.draftId ?? null,
        });

        const result = await deleteProject({
          environmentId: project.environmentId,
          input: {
            projectId: project.id,
            ...(memberThreads.length > 0 ? { force: true } : {}),
          },
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: `Failed to remove "${project.title}"`,
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          if (shouldNavigate) {
            void router.navigate({ to: "/" });
          }
          return;
        }

        shouldNavigate ||= memberRemovalNeedsNavigation;
        if (projectDraftThread) {
          draftStore.clearDraftThread(projectDraftThread.draftId);
        }
        draftStore.clearProjectDraftThreadId(projectRef);
      }

      if (shouldNavigate) {
        void router.navigate({ to: "/" });
      }
    },
    [deleteProject, router, threads],
  );

  const renameProjectMember = useCallback(
    async (member: SidebarProjectGroupMember, nextTitle: string) => {
      const title = nextTitle.trim();
      if (!title) {
        toastManager.add({ type: "warning", title: "Project title cannot be empty" });
        return;
      }
      if (title === member.title) return;
      const result = await updateProject({
        environmentId: member.environmentId,
        input: { projectId: member.id, title },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to rename project",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [updateProject],
  );

  const updateProjectDefaultModelSelection = useCallback(
    async (member: SidebarProjectGroupMember, selection: ModelSelection | null) => {
      const result = await updateProject({
        environmentId: member.environmentId,
        input: { projectId: member.id, defaultModelSelection: selection },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to update project agent",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [updateProject],
  );

  const updateProjectReviewModelSelection = useCallback(
    async (member: SidebarProjectGroupMember, selection: ModelSelection | null) => {
      const result = await updateProject({
        environmentId: member.environmentId,
        input: { projectId: member.id, reviewModelSelection: selection },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to update project review model",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [updateProject],
  );

  const updateProjectGitHubAccount = useCallback(
    async (member: SidebarProjectGroupMember, account: GitHubAccountRef | null) => {
      const current = member.gitHubAccount;
      const unchanged =
        account === null
          ? current === null
          : current !== null && current.host === account.host && current.login === account.login;
      if (unchanged) return;
      const result = await updateProject({
        environmentId: member.environmentId,
        input: { projectId: member.id, gitHubAccount: account },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to update GitHub account",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [updateProject],
  );

  const updateProjectWorktreeBranchPrefix = useCallback(
    async (member: SidebarProjectGroupMember, rawValue: string) => {
      const trimmed = rawValue.trim();
      const nextPrefix = trimmed.length === 0 ? null : sanitizeWorktreeBranchPrefix(trimmed);
      if ((member.worktreeBranchPrefix ?? null) === nextPrefix) return;
      const result = await updateProject({
        environmentId: member.environmentId,
        input: { projectId: member.id, worktreeBranchPrefix: nextPrefix },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to update branch prefix",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [updateProject],
  );

  const updateProjectPreviewPort = useCallback(
    async (member: SidebarProjectGroupMember, rawValue: string) => {
      const trimmed = rawValue.trim();
      let nextPort: number | null;
      if (trimmed.length === 0) {
        nextPort = null;
      } else {
        const parsed = Number(trimmed);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Invalid preview port",
              description: "Enter a port between 1 and 65535.",
            }),
          );
          return;
        }
        nextPort = parsed;
      }
      if ((member.previewPort ?? null) === nextPort) return;
      const result = await updateProject({
        environmentId: member.environmentId,
        input: { projectId: member.id, previewPort: nextPort },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to update preview port",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [updateProject],
  );

  const updateProjectDefaultWorktreeBranch = useCallback(
    async (member: SidebarProjectGroupMember, nextBranch: string | null) => {
      if ((member.defaultWorktreeBranch ?? null) === nextBranch) return;
      const result = await updateProject({
        environmentId: member.environmentId,
        input: { projectId: member.id, defaultWorktreeBranch: nextBranch },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to update default worktree branch",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [updateProject],
  );

  const updateProjectGroupingPreference = useCallback(
    (member: SidebarProjectGroupMember, selection: SidebarProjectGroupingMode | "inherit") => {
      const overrideKey = deriveProjectGroupingOverrideKey(member);
      const nextOverrides = { ...projectGroupingSettings.sidebarProjectGroupingOverrides };
      if (selection === "inherit") {
        delete nextOverrides[overrideKey];
      } else {
        nextOverrides[overrideKey] = selection;
      }
      updateSettings({ sidebarProjectGroupingOverrides: nextOverrides });
    },
    [projectGroupingSettings.sidebarProjectGroupingOverrides, updateSettings],
  );

  const handleProjectActions = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, projectGroup: SidebarProjectSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      setProjectScopeMenuOpen(false);
      window.requestAnimationFrame(() => setProjectActionsTarget(projectGroup));
    },
    [],
  );

  // The gear on a project row opens the full per-project settings page. The
  // quick-actions dialog (grouping rule, remove/hide) stays reachable from the
  // project scope menu and the thread context menu.
  const handleOpenProjectSettings = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, projectGroup: SidebarProjectSnapshot) => {
      event.preventDefault();
      event.stopPropagation();
      const target = projectGroup.memberProjects[0] ?? null;
      if (!target) return;
      void navigate({
        to: "/settings/projects/$environmentId/$projectId",
        params: { environmentId: target.environmentId, projectId: target.id },
      });
    },
    [navigate],
  );

  // Archived threads leave the live shell stream entirely, so the sidebar only
  // ever partitions live shells into the inbox (cards) and the snoozed shelf.
  // Parking a thread = archiving it, which removes it from `threads` here.
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const { activeThreads, snoozedThreads, snoozeNow, representativeKeyByThreadKey } = useMemo(() => {
    // Snooze wake times are second-precise, so classify against a real clock;
    // snoozeWakeTick re-runs this memo exactly at the next wake boundary.
    void snoozeWakeTick;
    const preciseNow = new Date().toISOString();
    const visibleBeforeCollapse = sortThreadsForSidebarV2(
      threads.filter(
        (thread) =>
          thread.archivedAt === null &&
          (scopedProjectKeys === null ||
            scopedProjectKeys.has(`${thread.environmentId}:${thread.projectId}`)),
      ),
    );
    // Chats sharing one worktree collapse to a single row (the earliest chat),
    // classified and shown by that representative; the rest live only in the
    // chat's worktree tab strip.
    const { threads: visible, representativeKeyByThreadKey } = collapseWorktreeSiblings(
      visibleBeforeCollapse,
      (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      mergeWorktreeSiblingRunningStatus,
    );
    const active: EnvironmentThreadShell[] = [];
    const snoozed: EnvironmentThreadShell[] = [];
    for (const thread of visible) {
      const supportsSnooze =
        serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true;
      if (supportsSnooze && effectiveSnoozed(thread, { now: preciseNow })) {
        snoozed.push(thread);
      } else {
        active.push(thread);
      }
    }
    return {
      // visibleBeforeCollapse is activity-sorted and collapsing keeps each
      // worktree at its newest sibling's position. Re-sorting representatives
      // here would use the oldest chat's timestamp and undo that group order.
      activeThreads: active,
      // Soonest wake first: "what comes back next" is the shelf's question.
      snoozedThreads: snoozed.toSorted(
        (left, right) =>
          firstValidTimestampMs(left.snoozedUntil ?? null) -
          firstValidTimestampMs(right.snoozedUntil ?? null),
      ),
      snoozeNow: preciseNow,
      representativeKeyByThreadKey,
    };
  }, [scopedProjectKeys, serverConfigs, snoozeWakeTick, threads]);
  // When the active route is a collapsed worktree sibling, its row is folded
  // into the earliest chat's; highlight and keep that representative visible.
  const effectiveRouteThreadKey =
    routeThreadKey === null
      ? null
      : (representativeKeyByThreadKey.get(routeThreadKey) ?? routeThreadKey);

  // Arm a timeout for the earliest upcoming wake so the shelf empties the
  // moment a snooze expires instead of on the next minute tick. Sorted
  // soonest-first, so entry 0 is the boundary.
  useEffect(() => {
    const nextWakeAtMs =
      snoozedThreads.length > 0 && snoozedThreads[0]?.snoozedUntil != null
        ? Date.parse(snoozedThreads[0].snoozedUntil)
        : Number.NaN;
    if (Number.isNaN(nextWakeAtMs)) return;
    // setTimeout delays are signed 32-bit: anything larger overflows and
    // fires immediately, turning a far-future wake (event-condition snoozes
    // synced from elsewhere) into a tight re-arm loop. Clamped, the timer
    // just re-arms every ~24.8 days until the wake is in range.
    const delayMs = Math.min(Math.max(0, nextWakeAtMs - Date.now()) + 50, 2_147_483_647);
    const id = window.setTimeout(() => bumpSnoozeWakeTick((tick) => tick + 1), delayMs);
    return () => window.clearTimeout(id);
  }, [snoozedThreads]);

  // The snoozed shelf is collapsed by default: out of the way, never gone.
  // Collapsed threads don't render (and so don't participate in jump
  // shortcuts or multi-select).
  const [snoozedShelfExpanded, setSnoozedShelfExpanded] = useState(false);
  const toggleSnoozedShelf = useCallback(() => setSnoozedShelfExpanded((value) => !value), []);
  const visibleSnoozedThreads = useMemo(() => {
    if (snoozedShelfExpanded) return snoozedThreads;
    // The open thread must never vanish behind the collapsed shelf: a
    // snoozed thread reached by route (deep link, open before snoozing
    // elsewhere) keeps its row — with highlight and wake affordance.
    if (effectiveRouteThreadKey === null) return [];
    const routeThread = snoozedThreads.find(
      (thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) ===
        effectiveRouteThreadKey,
    );
    return routeThread === undefined ? [] : [routeThread];
  }, [effectiveRouteThreadKey, snoozedShelfExpanded, snoozedThreads]);

  // Group-by-project splits the flat inbox into per-project sections. Scoping
  // to a single project already narrows the list to one project, so grouping
  // there would only add a redundant lone header — keep it flat. When grouping
  // is off (or scoped) a single null-keyed section holds every active thread,
  // so the render path and the flattened jump/selection order are identical to
  // the ungrouped list.
  const activeThreadSections = useMemo(() => {
    if (!groupByProject || scopedProjectGroup !== null) {
      return [{ projectKey: null as string | null, threads: activeThreads }];
    }
    const grouped = groupSidebarThreadsByProject({
      threads: activeThreads,
      projectOrder: projectGroups.map((group) => group.projectKey),
      resolveProjectKey: (thread) =>
        projectKeyByMemberKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null,
    });
    // Keep every project visible even when it holds no active threads, so an
    // empty project still renders a header you can start a new chat from. The
    // grouping helper drops empty sections, so rebuild the list from the full
    // project order and reattach any ungrouped threads at the end.
    const threadsByProjectKey = new Map(
      grouped.map((section) => [section.projectKey, section.threads] as const),
    );
    const ungrouped = grouped.find((section) => section.projectKey === null)?.threads ?? [];
    const sections = projectGroups.map((group) => ({
      projectKey: group.projectKey as string | null,
      threads: threadsByProjectKey.get(group.projectKey) ?? [],
    }));
    if (ungrouped.length > 0) {
      sections.push({ projectKey: null, threads: ungrouped });
    }
    return sections;
  }, [activeThreads, groupByProject, projectGroups, projectKeyByMemberKey, scopedProjectGroup]);
  const projectExpandedById = useUiStateStore((state) => state.projectExpandedById);
  const setProjectExpanded = useUiStateStore((state) => state.setProjectExpanded);
  const preferenceKeysByProjectKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const group of projectGroups) {
      map.set(group.projectKey, projectExpansionPreferenceKeys(group));
    }
    return map;
  }, [projectGroups]);
  const isProjectExpanded = useCallback(
    (projectKey: string) => {
      const keys = preferenceKeysByProjectKey.get(projectKey);
      return keys ? resolveProjectExpanded(projectExpandedById, keys) : true;
    },
    [preferenceKeysByProjectKey, projectExpandedById],
  );
  const toggleProjectExpanded = useCallback(
    (projectKey: string) => {
      const keys = preferenceKeysByProjectKey.get(projectKey);
      if (!keys) return;
      setProjectExpanded(keys, !resolveProjectExpanded(projectExpandedById, keys));
    },
    [preferenceKeysByProjectKey, projectExpandedById, setProjectExpanded],
  );
  const projectHiddenById = useUiStateStore((state) => state.projectHiddenById);
  const setProjectHidden = useUiStateStore((state) => state.setProjectHidden);
  const showHiddenProjects = useUiStateStore((state) => state.showHiddenProjects);
  const setShowHiddenProjects = useUiStateStore((state) => state.setShowHiddenProjects);
  const isProjectHidden = useCallback(
    (projectKey: string) => {
      const keys = preferenceKeysByProjectKey.get(projectKey);
      return keys ? resolveProjectHidden(projectHiddenById, keys) : false;
    },
    [preferenceKeysByProjectKey, projectHiddenById],
  );
  const setProjectHiddenByKey = useCallback(
    (projectKey: string, hidden: boolean) => {
      const keys = preferenceKeysByProjectKey.get(projectKey);
      if (!keys) return;
      setProjectHidden(keys, hidden);
    },
    [preferenceKeysByProjectKey, setProjectHidden],
  );
  // Groups the user has hidden. Grouping-only feature: without per-project
  // sections there are no headers to hide from or reveal into.
  const hiddenProjectGroups = useMemo(
    () =>
      groupByProject && scopedProjectGroup === null
        ? projectGroups.filter((group) => isProjectHidden(group.projectKey))
        : [],
    [groupByProject, isProjectHidden, projectGroups, scopedProjectGroup],
  );
  const hiddenProjectKeySet = useMemo(
    () => new Set(hiddenProjectGroups.map((group) => group.projectKey)),
    [hiddenProjectGroups],
  );
  // Reveal state only means anything while something is hidden; drop it back to
  // false the moment the last project is un-hidden so the toggle can't strand
  // itself "on" with nothing to show.
  useEffect(() => {
    if (hiddenProjectGroups.length === 0 && showHiddenProjects) {
      setShowHiddenProjects(false);
    }
  }, [hiddenProjectGroups.length, setShowHiddenProjects, showHiddenProjects]);
  const activeThreadCountByProjectKey = useMemo(
    () =>
      new Map(activeThreadSections.map((section) => [section.projectKey, section.threads.length])),
    [activeThreadSections],
  );
  // Collapsed project groups drop their rows from render and keyboard nav, but a
  // collapsed group holding the open thread keeps that one row visible (the same
  // exception the snoozed shelf makes) so the active chat never hides.
  const visibleActiveThreadSections = useMemo(() => {
    const sections = activeThreadSections
      // Hidden groups drop out entirely (header + rows) unless the reveal
      // toggle is on; the null section (ungrouped) is never hidden.
      .filter(
        (section) =>
          section.projectKey === null ||
          !hiddenProjectKeySet.has(section.projectKey) ||
          showHiddenProjects,
      )
      .map((section) => {
        if (section.projectKey === null || isProjectExpanded(section.projectKey)) return section;
        const routeThread =
          effectiveRouteThreadKey === null
            ? undefined
            : section.threads.find(
                (thread) =>
                  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) ===
                  effectiveRouteThreadKey,
              );
        return { ...section, threads: routeThread ? [routeThread] : [] };
      });
    // Revealing hidden projects must surface every hidden group, even ones with
    // no active threads — otherwise a hidden, empty project has no header and no
    // way to un-hide it.
    if (showHiddenProjects) {
      const present = new Set(sections.map((section) => section.projectKey));
      for (const group of hiddenProjectGroups) {
        if (!present.has(group.projectKey)) {
          sections.push({ projectKey: group.projectKey as string | null, threads: [] });
        }
      }
    }
    return sections;
  }, [
    activeThreadSections,
    effectiveRouteThreadKey,
    hiddenProjectGroups,
    hiddenProjectKeySet,
    isProjectExpanded,
    showHiddenProjects,
  ]);
  const orderedActiveThreads = useMemo(
    () => visibleActiveThreadSections.flatMap((section) => section.threads),
    [visibleActiveThreadSections],
  );
  const orderedThreads = useMemo(
    () => [...orderedActiveThreads, ...visibleSnoozedThreads],
    [orderedActiveThreads, visibleSnoozedThreads],
  );
  const orderedThreadKeys = useMemo(
    () =>
      orderedThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    [orderedThreads],
  );
  // Rows call back into the click handler without carrying the ordered list as
  // a prop — a fresh array identity per shell update would defeat every row's
  // memoization. The ref keeps shift-range-select working against the list as
  // rendered at click time.
  const orderedThreadKeysRef = useRef(orderedThreadKeys);
  orderedThreadKeysRef.current = orderedThreadKeys;
  const threadByKey = useMemo(
    () =>
      new Map(
        orderedThreads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [orderedThreads],
  );
  // Handlers read these through refs: depending on per-update Map/Set
  // identities would give every row a fresh callback prop on each shell
  // event and defeat row memoization during streaming.
  const threadByKeyRef = useRef(threadByKey);
  threadByKeyRef.current = threadByKey;
  // The FULL, uncollapsed shell list. threadByKey only holds the visible
  // representative of each collapsed worktree group, so archiving a workspace
  // must read siblings from here — otherwise only the representative archives
  // and its hidden siblings resurface one row at a time.
  const allThreadsRef = useRef(threads);
  allThreadsRef.current = threads;
  // handleNewThread is inherently unstable (depends on the projects list);
  // a ref keeps it out of attemptArchive's dependency array.
  const handleNewThreadRef = useRef(newThreadContext.handleNewThread);
  handleNewThreadRef.current = newThreadContext.handleNewThread;
  const createThreadForProjectGroup = useCallback(
    (group: SidebarProjectSnapshot) => {
      if (isMobile) setOpenMobile(false);
      // The snapshot spreads its representative member, so (environmentId, id)
      // already points at the preferred member (local over remote) — the same
      // default the command palette's "New thread in…" resolves to.
      void handleNewThreadRef.current(scopeProjectRef(group.environmentId, group.id));
    },
    [isMobile, setOpenMobile],
  );
  // Live PR state per row, reported up from each row's git status. The context
  // menu reads it through a ref so "Continue in new worktree" only appears for
  // threads whose PR has merged.
  const changeRequestStateByKeyRef = useRef(changeRequestStateByKey);
  changeRequestStateByKeyRef.current = changeRequestStateByKey;
  const snoozedThreadKeys = useMemo(
    () =>
      new Set(
        snoozedThreads.map((thread) =>
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
        ),
      ),
    [snoozedThreads],
  );
  const snoozedThreadKeysRef = useRef(snoozedThreadKeys);
  snoozedThreadKeysRef.current = snoozedThreadKeys;

  const jumpLabelByKey = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const [index, threadKey] of orderedThreadKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(index);
      if (!jumpCommand) break;
      const label = shortcutLabelForCommand(keybindings, jumpCommand);
      if (label) mapping.set(threadKey, label);
    }
    return mapping;
  }, [keybindings, orderedThreadKeys]);
  const [showJumpHints, setShowJumpHints] = useState(false);

  // Snoozed threads are live shells, so opening one is plain navigation.
  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      // A worktree row collapses to its earliest-created chat, but clicking it
      // should reopen whichever sibling was last active, not always the oldest.
      const clicked = threads.find(
        (thread) =>
          thread.environmentId === threadRef.environmentId && thread.id === threadRef.threadId,
      );
      const target = clicked
        ? resolveWorktreeActiveThread({
            threads,
            clicked,
            keyOf: (thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
            lastVisitedAtByKey: useUiStateStore.getState().threadLastVisitedAtById,
          })
        : null;
      const resolvedRef = target ? scopeThreadRef(target.environmentId, target.id) : threadRef;
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(resolvedRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(resolvedRef),
      });
    },
    [clearSelection, isMobile, router, setOpenMobile, setSelectionAnchor, threads],
  );

  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const startThreadRename = useCallback((threadRef: ScopedThreadRef, title: string) => {
    setRenamingThreadKey(scopedThreadKey(threadRef));
    setRenamingTitle(title);
  }, []);
  const cancelThreadRename = useCallback(() => setRenamingThreadKey(null), []);
  const commitThreadRename = useCallback(
    (threadRef: ScopedThreadRef, title: string, originalTitle: string) => {
      void (async () => {
        const trimmed = title.trim();
        setRenamingThreadKey(null);
        if (trimmed.length === 0) {
          toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
          return;
        }
        if (trimmed === originalTitle) return;
        const result = await updateThreadMetadata({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, title: trimmed },
        });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to rename thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [updateThreadMetadata],
  );

  const handleThreadClick = useCallback(
    (event: ReactMouseEvent, threadRef: ScopedThreadRef) => {
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const threadKey = scopedThreadKey(threadRef);
      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadKey);
        return;
      }
      if (event.shiftKey) {
        event.preventDefault();
        rangeSelectTo(threadKey, orderedThreadKeysRef.current);
        return;
      }
      if (isTrailingDoubleClick(event.detail)) {
        return;
      }
      navigateToThread(threadRef);
    },
    [navigateToThread, rangeSelectTo, toggleThreadSelection],
  );

  // One archive per thread at a time: double clicks and repeated menu picks
  // must not dispatch a second archive that fails and toasts a false error.
  const archivingThreadKeysRef = useRef(new Set<string>());
  // Snoozing the thread you're looking at moves you forward: the next remaining
  // card (never a snoozed row, never one leaving in the same batch), or a fresh
  // draft in this project when it was the last active one. Callers snapshot the
  // plan BEFORE the command mutates the partition; background parks never
  // navigate (null plan). Archive routes through the hook's own navigation.
  const planForwardNavigation = useCallback(
    (threadKey: string, coParkingKeys?: ReadonlySet<string>): (() => void) | null => {
      if (routeThreadKeyRef.current !== threadKey) return null;
      const shell = threadByKeyRef.current.get(threadKey);
      const orderedKeys = orderedThreadKeysRef.current;
      const snoozedKeys = snoozedThreadKeysRef.current;
      const currentIndex = orderedKeys.indexOf(threadKey);
      const nextCardKey =
        currentIndex === -1
          ? null
          : ([...orderedKeys.slice(currentIndex + 1), ...orderedKeys.slice(0, currentIndex)].find(
              (key) => !snoozedKeys.has(key) && !coParkingKeys?.has(key),
            ) ?? null);
      const nextThread = nextCardKey ? threadByKeyRef.current.get(nextCardKey) : null;
      return nextThread
        ? () => navigateToThread(scopeThreadRef(nextThread.environmentId, nextThread.id))
        : shell
          ? () =>
              void handleNewThreadRef.current(scopeProjectRef(shell.environmentId, shell.projectId))
          : () => void router.navigate({ to: "/" });
    },
    [navigateToThread, router],
  );

  const attemptArchive = useCallback(
    (threadRef: ScopedThreadRef) => {
      void (async () => {
        const threadKey = scopedThreadKey(threadRef);
        if (archivingThreadKeysRef.current.has(threadKey)) return;
        archivingThreadKeysRef.current.add(threadKey);
        try {
          // A worktree row collapses every chat sharing one on-disk worktree
          // into a single representative, so archiving it archives the whole
          // workspace at once — collected from the full shell list, since the
          // hidden siblings are absent from the collapsed row map.
          const target = allThreadsRef.current.find(
            (thread) =>
              thread.environmentId === threadRef.environmentId && thread.id === threadRef.threadId,
          );
          const groupThreads = target
            ? collectWorktreeSiblingThreads({
                threads: allThreadsRef.current,
                target,
              })
            : [];
          const entries =
            groupThreads.length > 1
              ? groupThreads.map((thread) => {
                  const ref = scopeThreadRef(thread.environmentId, thread.id);
                  return { threadKey: scopedThreadKey(ref), threadRef: ref };
                })
              : [{ threadKey, threadRef }];
          const outcome = await archiveSelectedThreadEntries({
            entries,
            // Stop + remove: halt a live session before it disappears from the
            // inbox. Navigation off the archived thread is the hook's job.
            archive: ({ threadRef: ref }, onArchived) =>
              archiveThread(ref, { onArchived, stopRunningSession: true }),
          });
          const failure = outcome.mutationFailure ?? outcome.followupFailures[0] ?? null;
          if (failure && !isAtomCommandInterrupted(failure)) {
            const error = squashAtomCommandFailure(failure);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title:
                  entries.length > 1
                    ? "Failed to archive worktree chats"
                    : "Failed to archive thread",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
        } finally {
          archivingThreadKeysRef.current.delete(threadKey);
        }
      })();
    },
    [archiveThread],
  );
  const attemptUnsnooze = useCallback(
    (threadRef: ScopedThreadRef) => {
      void (async () => {
        const result = await unsnoozeThread(threadRef);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to wake thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [unsnoozeThread],
  );
  // One snooze per thread at a time — same double-dispatch guard as archive.
  const snoozingThreadKeysRef = useRef(new Set<string>());
  const attemptSnooze = useCallback(
    (
      threadRef: ScopedThreadRef,
      preset: SnoozePreset,
      opts: { coSnoozingKeys?: ReadonlySet<string> } = {},
    ) => {
      void (async () => {
        const threadKey = scopedThreadKey(threadRef);
        if (snoozingThreadKeysRef.current.has(threadKey)) return;
        snoozingThreadKeysRef.current.add(threadKey);
        try {
          // Snoozing the open thread moves you forward to the next card —
          // parking the thread you're done with for now.
          const navigateAfterSnooze = planForwardNavigation(threadKey, opts.coSnoozingKeys);
          const result = await snoozeThread(threadRef, preset.snoozedUntil);
          if (result._tag === "Failure") {
            // Never navigate away from a thread that did not snooze.
            if (!isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to snooze thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          // Snooze hides the row, so the toast is the only confirmation —
          // and the Undo is the escape hatch for a mis-click.
          toastManager.add(
            stackedThreadToast({
              type: "success",
              title: `Snoozed until ${snoozeWakeDescription(preset.snoozedUntil, new Date())}`,
              timeout: 5_000,
              actionProps: {
                children: "Undo",
                onClick: () => attemptUnsnooze(threadRef),
              },
            }),
          );
          // Only move forward if the user is still on the snoozed thread —
          // a navigation made during the await wins over ours.
          if (routeThreadKeyRef.current === threadKey) {
            navigateAfterSnooze?.();
          }
        } finally {
          snoozingThreadKeysRef.current.delete(threadKey);
        }
      })();
    },
    [attemptUnsnooze, planForwardNavigation, snoozeThread],
  );

  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      // One exact actionable set: keys whose rows are actually rendered
      // right now. Selections can outlive their rows (snoozed-shelf collapse,
      // thread deletion elsewhere) and the menu labels must count only what
      // the actions will touch.
      const threadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys].filter(
        (threadKey) => threadByKeyRef.current.has(threadKey),
      );
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;
      // Snooze (N) is offered when every selected thread can actually take
      // it — a mixed selection with blocked-on-you work would half-apply.
      const selectionNow = new Date().toISOString();
      const snoozableThreads = threadKeys.flatMap((threadKey) => {
        const thread = threadByKeyRef.current.get(threadKey);
        return thread ? [thread] : [];
      });
      const canSnoozeSelection = snoozableThreads.every(
        (thread) =>
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true &&
          canSnooze(thread, { now: selectionNow }),
      );
      const snoozePresets = resolveSnoozePresets(new Date());
      const clicked = await settlePromise(() =>
        api.contextMenu.show(
          [
            { id: "archive", label: `Archive (${count})` },
            ...(canSnoozeSelection
              ? [
                  {
                    id: "snooze",
                    label: `Snooze (${count})`,
                    children: snoozePresets.map((preset) => ({
                      id: `snooze:${preset.id}`,
                      label: `${preset.label} (${preset.whenLabel})`,
                    })),
                  },
                ]
              : []),
            { id: "mark-unread", label: `Mark unread (${count})` },
            { id: "delete", label: `Delete (${count})`, destructive: true },
          ],
          position,
        ),
      );
      if (clicked._tag === "Failure") return;
      if (clicked.value?.startsWith("snooze:")) {
        const preset = snoozePresets.find(
          (candidate) => `snooze:${candidate.id}` === clicked.value,
        );
        if (preset) {
          // Post-snooze navigation must skip threads snoozing in this same
          // batch — they are all leaving the card block together.
          const coSnoozingKeys = new Set(threadKeys);
          for (const thread of snoozableThreads) {
            attemptSnooze(scopeThreadRef(thread.environmentId, thread.id), preset, {
              coSnoozingKeys,
            });
          }
          clearSelection();
        }
        return;
      }
      if (clicked.value === "archive") {
        // Archive the exact selection (not worktree-expanded) so a mixed
        // selection can't archive siblings the user didn't pick; stop + remove
        // each so no session keeps running behind an archived row.
        const entries = threadKeys.flatMap((threadKey) => {
          const thread = threadByKeyRef.current.get(threadKey);
          if (!thread) return [];
          const ref = scopeThreadRef(thread.environmentId, thread.id);
          return [{ threadKey, threadRef: ref }];
        });
        const outcome = await archiveSelectedThreadEntries({
          entries,
          archive: ({ threadRef: ref }, onArchived) =>
            archiveThread(ref, { onArchived, stopRunningSession: true }),
        });
        const failure = outcome.mutationFailure ?? outcome.followupFailures[0] ?? null;
        if (failure && !isAtomCommandInterrupted(failure)) {
          const error = squashAtomCommandFailure(failure);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to archive threads",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        clearSelection();
        return;
      }
      if (clicked.value === "mark-unread") {
        for (const threadKey of threadKeys) {
          const thread = threadByKeyRef.current.get(threadKey);
          markThreadUnread(threadKey, thread?.latestTurn?.completedAt);
        }
        clearSelection();
        return;
      }
      if (clicked.value !== "delete") return;
      if (confirmThreadDelete) {
        const confirmed = await settlePromise(() =>
          api.dialogs.confirm(
            [
              `Delete ${count} thread${count === 1 ? "" : "s"}?`,
              "This permanently clears conversation history for these threads.",
            ].join("\n"),
          ),
        );
        if (confirmed._tag === "Failure" || !confirmed.value) return;
      }
      // Grown as deletions actually land, never seeded with the whole batch:
      // orphaned-worktree detection must only discount threads that are
      // really gone, or the first delete would treat still-alive batch mates
      // as deleted and remove a worktree they still point at.
      const deletedThreadKeys = new Set<string>();
      for (const threadKey of threadKeys) {
        const thread = threadByKeyRef.current.get(threadKey);
        if (!thread) continue;
        const result = await deleteThread(scopeThreadRef(thread.environmentId, thread.id), {
          deletedThreadKeys,
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to delete threads",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          return;
        }
        deletedThreadKeys.add(threadKey);
      }
      removeFromSelection(threadKeys);
    },
    [
      archiveThread,
      attemptSnooze,
      clearSelection,
      confirmThreadDelete,
      deleteThread,
      markThreadUnread,
      removeFromSelection,
      serverConfigs,
    ],
  );

  const handleThreadContextMenu = useCallback(
    (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const threadKey = scopedThreadKey(threadRef);
        const selectionState = useThreadSelectionStore.getState();
        if (selectionState.hasSelection() && selectionState.selectedThreadKeys.has(threadKey)) {
          await handleMultiSelectContextMenu(position);
          return;
        }
        const thread = threadByKeyRef.current.get(threadKey);
        if (!thread) return;
        const projectGroup =
          projectGroups.find((group) =>
            group.memberProjects.some(
              (member) =>
                member.environmentId === thread.environmentId && member.id === thread.projectId,
            ),
          ) ?? null;
        const supportsSnooze =
          serverConfigs.get(thread.environmentId)?.environment.capabilities.threadSnooze === true;
        const isSnoozed = snoozedThreadKeysRef.current.has(threadKey);
        // Presets resolve at menu-open time (same as the popover).
        const snoozePresets = resolveSnoozePresets(new Date());
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            [
              ...(thread.branch
                ? [
                    {
                      id: "new-thread-on-branch",
                      label: `New thread on ${thread.branch}`,
                    },
                  ]
                : []),
              ...(changeRequestStateByKeyRef.current.get(threadKey) === "merged"
                ? [
                    {
                      id: "continue-in-new-worktree",
                      label: "Continue in new worktree",
                    },
                  ]
                : []),
              { id: "archive", label: "Archive thread" },
              ...(supportsSnooze
                ? [
                    isSnoozed
                      ? { id: "unsnooze", label: "Wake thread" }
                      : {
                          id: "snooze",
                          label: "Snooze",
                          disabled: !canSnooze(thread, { now: new Date().toISOString() }),
                          children: snoozePresets.map((preset) => ({
                            id: `snooze:${preset.id}`,
                            label: `${preset.label} (${preset.whenLabel})`,
                          })),
                        },
                  ]
                : []),
              { id: "rename", label: "Rename thread" },
              { id: "mark-unread", label: "Mark unread" },
              ...(projectGroup ? [{ id: "project-settings", label: "Project settings…" }] : []),
              { id: "delete", label: "Delete", destructive: true, icon: "trash" },
            ],
            position,
          ),
        );
        if (clicked._tag === "Failure") return;
        if (clicked.value?.startsWith("snooze:")) {
          const preset = snoozePresets.find(
            (candidate) => `snooze:${candidate.id}` === clicked.value,
          );
          if (preset) attemptSnooze(threadRef, preset);
          return;
        }
        switch (clicked.value) {
          case "new-thread-on-branch": {
            // Explicit branch carry-over: reuse the thread's worktree when it
            // has one, otherwise its branch on the local checkout.
            const result = await settlePromise(() =>
              handleNewThreadRef.current(scopeProjectRef(thread.environmentId, thread.projectId), {
                branch: thread.branch,
                worktreePath: thread.worktreePath,
                envMode: thread.worktreePath ? "worktree" : "local",
                startFromOrigin: false,
              }),
            );
            if (result._tag === "Failure") {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Could not create thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "continue-in-new-worktree": {
            // The PR is merged, so the finished chat's context can't be
            // resumed in place. Summarize it into a compact handoff brief and
            // seed a brand-new chat on a fresh worktree (branched off origin)
            // so the user can carry the context onto something new.
            const summaryResult = await generateContinuationSummary({
              environmentId: thread.environmentId,
              input: { threadId: thread.id },
            });
            if (summaryResult._tag === "Failure") {
              if (isAtomCommandInterrupted(summaryResult)) return;
              const error = squashAtomCommandFailure(summaryResult);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Could not prepare continuation",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
              return;
            }
            const { summary, sourceTitle } = summaryResult.value;
            const initialPrompt = [
              `Continuing from the merged chat "${sourceTitle}". Context handoff:`,
              "",
              summary,
              "",
              "New task: ",
            ].join("\n");
            const createResult = await settlePromise(() =>
              handleNewThreadRef.current(scopeProjectRef(thread.environmentId, thread.projectId), {
                branch: null,
                worktreePath: null,
                envMode: "worktree",
                startFromOrigin: true,
                forceNew: true,
                modelSelection: thread.modelSelection,
                initialPrompt,
              }),
            );
            if (createResult._tag === "Failure") {
              const error = squashAtomCommandFailure(createResult);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Could not create thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "archive":
            attemptArchive(threadRef);
            return;
          case "unsnooze":
            attemptUnsnooze(threadRef);
            return;
          case "rename":
            startThreadRename(threadRef, thread.title);
            return;
          case "mark-unread":
            markThreadUnread(threadKey, thread.latestTurn?.completedAt);
            return;
          case "project-settings":
            if (projectGroup) setProjectActionsTarget(projectGroup);
            return;
          case "delete": {
            if (confirmThreadDelete) {
              const confirmed = await settlePromise(() =>
                api.dialogs.confirm(
                  [
                    `Delete thread "${thread.title}"?`,
                    "This permanently clears conversation history for this thread.",
                  ].join("\n"),
                ),
              );
              if (confirmed._tag === "Failure" || !confirmed.value) return;
            }
            const result = await deleteThread(threadRef);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to delete thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
              return;
            }
            return;
          }
          default:
            return;
        }
      })();
    },
    [
      attemptArchive,
      attemptSnooze,
      attemptUnsnooze,
      confirmThreadDelete,
      deleteThread,
      generateContinuationSummary,
      handleMultiSelectContextMenu,
      markThreadUnread,
      projectGroups,
      serverConfigs,
      startThreadRename,
    ],
  );

  // Thread jump (cmd+1..9) and prev/next traversal reuse the same commands as
  // v1 — the keybinding layer is shared, only the ordered list differs.
  const routeWorkspaceThreadRef = useWorkspaceThreadRef(routeThreadRef);
  const routeTerminalOpen = useTerminalUiStateStore((state) =>
    routeWorkspaceThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeWorkspaceThreadRef)
          .terminalOpen
      : false,
  );
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: routeTerminalOpen,
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      const navigateToThreadKey = (targetThreadKey: string | null) => {
        if (!targetThreadKey) return false;
        const targetThread = threadByKey.get(targetThreadKey);
        if (!targetThread) return false;
        event.preventDefault();
        event.stopPropagation();
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
        return true;
      };
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        navigateToThreadKey(
          resolveAdjacentThreadId({
            threadIds: orderedThreadKeys,
            // A collapsed sibling isn't in the ordered rows; step relative to
            // the representative row that stands in for it.
            currentThreadId: effectiveRouteThreadKey,
            direction: traversalDirection,
          }),
        );
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) return;
      navigateToThreadKey(orderedThreadKeys[jumpIndex] ?? null);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [
    effectiveRouteThreadKey,
    keybindings,
    navigateToThread,
    orderedThreadKeys,
    routeTerminalOpen,
    routeThreadKey,
    threadByKey,
  ]);

  // Same predicate as v1: hints show only while the held modifiers exactly
  // match a thread-jump binding. Adding Shift (screenshots) or Alt no
  // longer matches ⌘1..9, so the overlay hides for chords like ⌘⇧4.
  const shortcutModifiers = useShortcutModifierState();
  const shouldShowJumpHintsNow = shouldShowThreadJumpHintsForModifiers(
    shortcutModifiers,
    keybindings,
    { platform: navigator.platform },
  );
  useEffect(() => {
    setShowJumpHints(shouldShowJumpHintsNow);
  }, [shouldShowJumpHintsNow]);

  const attachListAutoAnimateRef = useCallback((node: HTMLUListElement | null) => {
    if (!node) return;
    autoAnimate(node, { duration: 150, easing: "ease-out" });
  }, []);

  // New thread defaults to the project you're in (active thread's project,
  // falling back to the top project) — same resolution the command palette
  // uses. The command palette already offers a "New thread in..." submenu
  // for multi-project setups.
  const handleNewThreadClick = useCallback(() => {
    // One project: nothing to pick, create immediately.
    if (projectGroups.length <= 1) {
      if (isMobile) setOpenMobile(false);
      void startNewThreadFromContext({
        activeDraftThread: newThreadContext.activeDraftThread,
        activeThread: newThreadContext.activeThread ?? undefined,
        defaultProjectRef: newThreadContext.defaultProjectRef,
        handleNewThread: newThreadContext.handleNewThread,
      });
      return;
    }
    if (isMobile) setOpenMobile(false);
    openCommandPalette({ open: "new-thread-in" });
  }, [isMobile, newThreadContext, projectGroups.length, setOpenMobile]);

  const commandPaletteShortcutLabel = shortcutLabelForCommand(keybindings, "commandPalette.toggle");
  // Same resolution as v1: prefer the local-thread binding, fall back to
  // chat.new, no platform gating — web users have working shortcuts too.
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newLocal") ??
    shortcutLabelForCommand(keybindings, "chat.new");
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="gap-0"
        fixedHeader={
          <SidebarGroup className="gap-1 p-2">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <CommandDialogTrigger
                  render={
                    <SidebarMenuButton
                      type="button"
                      aria-label="Search threads and commands"
                      className="focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                      data-testid="command-palette-trigger"
                    />
                  }
                >
                  <SearchIcon />
                  <div className="flex-1 truncate text-left">Search</div>
                  {commandPaletteShortcutLabel ? (
                    <Kbd className="mr-px h-4 min-w-0 rounded-sm bg-sidebar-control-surface px-1.5 text-[10px] text-sidebar-muted-foreground ring-1 ring-sidebar-border">
                      {commandPaletteShortcutLabel}
                    </Kbd>
                  ) : null}
                </CommandDialogTrigger>
              </div>
              <div className="shrink-0">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <SidebarMenuButton
                        size="icon"
                        type="button"
                        className="relative focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                        onClick={handleNewThreadClick}
                        disabled={projects.length === 0}
                        aria-label="New thread"
                      />
                    }
                  >
                    <SquarePenIcon />
                    <span
                      className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                      aria-hidden="true"
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="right">
                    {newThreadShortcutLabel
                      ? `New thread (${newThreadShortcutLabel})`
                      : "New thread"}
                  </TooltipPopup>
                </Tooltip>
              </div>
            </div>
            {projectGroups.length > 0 ? (
              <div className="flex items-center gap-1">
                <Menu open={projectScopeMenuOpen} onOpenChange={setProjectScopeMenuOpen}>
                  <MenuTrigger
                    render={
                      <SidebarMenuButton
                        aria-label="Filter threads by project"
                        className="min-w-0 flex-1 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                      />
                    }
                  >
                    {scopedProjectGroup ? (
                      <ProjectFavicon
                        environmentId={scopedProjectGroup.environmentId}
                        cwd={scopedProjectGroup.workspaceRoot}
                        className="size-4 shrink-0"
                      />
                    ) : (
                      <FolderIcon className="size-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {scopedProjectGroup?.displayName ?? "All projects"}
                    </span>
                    <ChevronDownIcon className="-mr-px size-4 shrink-0" />
                  </MenuTrigger>
                  <MenuPopup align="start" className="w-(--anchor-width)">
                    <MenuRadioGroup
                      value={projectScopeKey ?? "all"}
                      onValueChange={(value) =>
                        setProjectScopeKey(value === "all" ? null : (value as string))
                      }
                    >
                      <MenuRadioItem
                        value="all"
                        closeOnClick
                        className="h-8 min-h-8 px-1 py-0 text-sm font-medium [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
                      >
                        <FolderIcon className="size-4 shrink-0" />
                        <span className="min-w-0 truncate text-sm">All projects</span>
                      </MenuRadioItem>
                      {projectGroups.map((project) => {
                        const scopeKey = project.projectKey;
                        return (
                          <MenuRadioItem
                            key={scopeKey}
                            value={scopeKey}
                            closeOnClick
                            className="h-8 min-h-8 px-1 py-0 text-sm font-medium [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
                          >
                            <ProjectFavicon
                              environmentId={project.environmentId}
                              cwd={project.workspaceRoot}
                              className="size-4 shrink-0"
                            />
                            <span className="min-w-0 truncate text-sm">{project.displayName}</span>
                            <button
                              type="button"
                              aria-label={`Project actions for ${project.displayName}`}
                              title={`Project actions for ${project.displayName}`}
                              className="ml-auto inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/55 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                void handleProjectActions(event, project);
                              }}
                            >
                              <EllipsisIcon className="size-3.5" />
                            </button>
                          </MenuRadioItem>
                        );
                      })}
                    </MenuRadioGroup>
                  </MenuPopup>
                </Menu>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <SidebarMenuButton
                        size="icon"
                        className="relative shrink-0 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                        onClick={openAddProjectCommandPalette}
                        type="button"
                        aria-label="New project"
                      />
                    }
                  >
                    <FolderPlusIcon />
                    <span
                      className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                      aria-hidden="true"
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="right">New project</TooltipPopup>
                </Tooltip>
              </div>
            ) : null}
          </SidebarGroup>
        }
      >
        <SidebarGroup className="px-2 pb-1 pt-0">
          <TooltipProvider
            key="sidebar-thread-tooltips-150"
            delay={150}
            closeDelay={0}
            timeout={400}
          >
            <ul ref={attachListAutoAnimateRef} role="list" className="flex flex-col gap-px">
              {(() => {
                const renderThreadRow = (
                  thread: EnvironmentThreadShell,
                  section: "active" | "snoozed",
                  options?: { showProjectLabel?: boolean },
                ) => {
                  const threadKey = scopedThreadKey(
                    scopeThreadRef(thread.environmentId, thread.id),
                  );
                  // Snoozed threads collapse to a slim shelf row; everything
                  // else is a full inbox card. Archived threads leave the list.
                  const isCard = section === "active";
                  const rowVariant = isCard ? "card" : "slim";
                  return (
                    <SidebarV2Row
                      // Keyed per variant on purpose: when a thread snoozes,
                      // the card fades out in place and the slim row fades in
                      // at its shelf position instead of one element
                      // FLIP-sliding through every row in between (rows here
                      // are translucent, so a crossing row reads as text
                      // painted over text).
                      key={`${threadKey}:${rowVariant}`}
                      thread={thread}
                      variant={rowVariant}
                      snoozeSupported={
                        serverConfigs.get(thread.environmentId)?.environment.capabilities
                          .threadSnooze === true
                      }
                      snoozeWakeLabelText={
                        section === "snoozed" && thread.snoozedUntil != null
                          ? snoozeWakeLabel(thread.snoozedUntil, new Date())
                          : null
                      }
                      // A woken thread's wake signal must survive until visited;
                      // still-snoozed rows resolve to null on their own.
                      wokeAt={threadWokeAt(thread, { now: snoozeNow })}
                      isActive={effectiveRouteThreadKey === threadKey}
                      jumpLabel={showJumpHints ? (jumpLabelByKey.get(threadKey) ?? null) : null}
                      currentEnvironmentId={primaryEnvironmentId}
                      environmentLabel={environmentLabelById.get(thread.environmentId) ?? null}
                      projectCwd={
                        projectCwdByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null
                      }
                      projectTitle={
                        projectDisplayNameByKey.get(
                          `${thread.environmentId}:${thread.projectId}`,
                        ) ?? null
                      }
                      showProjectLabel={options?.showProjectLabel ?? true}
                      providerEntryByInstanceId={providerEntryByInstanceId}
                      onThreadClick={handleThreadClick}
                      onThreadActivate={navigateToThread}
                      onStartRename={startThreadRename}
                      onRenameTitleChange={setRenamingTitle}
                      onCommitRename={commitThreadRename}
                      onCancelRename={cancelThreadRename}
                      isRenaming={renamingThreadKey === threadKey}
                      renamingTitle={renamingThreadKey === threadKey ? renamingTitle : ""}
                      onContextMenu={handleThreadContextMenu}
                      onArchive={attemptArchive}
                      onSnooze={attemptSnooze}
                      onUnsnooze={attemptUnsnooze}
                      onChangeRequestState={handleChangeRequestState}
                    />
                  );
                };
                const items: ReactNode[] = [];
                for (const [sectionIndex, section] of visibleActiveThreadSections.entries()) {
                  if (section.projectKey !== null) {
                    const group = projectGroupByKey.get(section.projectKey);
                    const projectKey = section.projectKey;
                    const expanded = isProjectExpanded(projectKey);
                    const hidden = isProjectHidden(projectKey);
                    const count = activeThreadCountByProjectKey.get(projectKey) ?? 0;
                    items.push(
                      <li
                        key={`project-header-${projectKey}`}
                        data-thread-selection-safe
                        className={cn(
                          "group/project-header flex list-none items-center gap-1 px-2.5",
                          "mb-1",
                          sectionIndex === 0 ? "mt-1" : "mt-3",
                          // Revealed-but-hidden headers stay dimmed so the reveal
                          // list reads as "these are the ones you tucked away".
                          hidden && "opacity-60",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleProjectExpanded(projectKey)}
                          aria-expanded={expanded}
                          data-testid="sidebar-v2-project-toggle"
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                        >
                          {group ? (
                            <ProjectFavicon
                              environmentId={group.environmentId}
                              cwd={group.workspaceRoot}
                              className="size-3.5 shrink-0"
                            />
                          ) : null}
                          <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
                            {group?.displayName ?? "Project"}
                            {!expanded && count > 0 ? ` (${count})` : ""}
                          </span>
                          <span className="h-px flex-1 bg-sidebar-border/60" />
                        </button>
                        {group ? (
                          <div className="flex shrink-0 items-center gap-0.5">
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <button
                                    type="button"
                                    data-testid="sidebar-v2-project-settings"
                                    aria-label={`Project settings for ${group.displayName}`}
                                    onClick={(event) => handleOpenProjectSettings(event, group)}
                                    className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/55 opacity-0 outline-none transition-[color,background-color,opacity] hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:bg-sidebar-row-hover focus-visible:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100 group-hover/project-header:opacity-100"
                                  />
                                }
                              >
                                <SettingsIcon className="size-3.5" />
                              </TooltipTrigger>
                              <TooltipPopup side="top">Project settings</TooltipPopup>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <button
                                    type="button"
                                    data-testid="sidebar-v2-project-new-thread"
                                    aria-label={`New chat in ${group.displayName}`}
                                    onClick={() => createThreadForProjectGroup(group)}
                                    className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/55 outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:bg-sidebar-row-hover focus-visible:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
                                  />
                                }
                              >
                                <PlusIcon className="size-4" />
                              </TooltipTrigger>
                              <TooltipPopup side="top">New chat</TooltipPopup>
                            </Tooltip>
                          </div>
                        ) : null}
                      </li>,
                    );
                  }
                  for (const thread of section.threads) {
                    items.push(
                      renderThreadRow(thread, "active", {
                        showProjectLabel: section.projectKey === null,
                      }),
                    );
                  }
                }
                // Snoozed shelf: below the inbox — out of the
                // way, never gone. The header always renders while anything
                // is snoozed (the count is the whole footprint when
                // collapsed); rows only when expanded. Vanishes entirely at
                // count 0.
                if (snoozedThreads.length > 0) {
                  items.push(
                    <li key="snoozed-shelf-header" data-thread-selection-safe className="list-none">
                      <button
                        type="button"
                        onClick={toggleSnoozedShelf}
                        aria-expanded={snoozedShelfExpanded}
                        data-testid="sidebar-v2-snoozed-shelf-toggle"
                        className="mb-1 mt-3 flex w-full cursor-pointer items-center gap-2 px-2.5 text-left"
                      >
                        <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                          {snoozedShelfExpanded ? "Snoozed" : `Snoozed (${snoozedThreads.length})`}
                        </span>
                        <span className="h-px flex-1 bg-blue-500/20 dark:bg-blue-400/15" />
                        <ChevronDownIcon
                          aria-hidden
                          className={cn(
                            "size-3 text-blue-600 transition-transform dark:text-blue-400",
                            snoozedShelfExpanded && "rotate-180",
                          )}
                        />
                      </button>
                    </li>,
                  );
                  for (const thread of visibleSnoozedThreads) {
                    items.push(renderThreadRow(thread, "snoozed"));
                  }
                }
                return items;
              })()}
            </ul>
          </TooltipProvider>
          {activeThreads.length + snoozedThreads.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-xs text-muted-foreground/60">
              {projects.length === 0 ? (
                <>
                  <span>No projects yet</span>
                  <button
                    type="button"
                    onClick={openAddProjectCommandPalette}
                    className="inline-flex items-center gap-1.5 rounded-md border border-sidebar-border px-2.5 py-1 text-[11px] font-medium text-sidebar-muted-foreground transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground"
                  >
                    <PlusIcon className="-mx-0.5 size-3" />
                    Add project
                  </button>
                </>
              ) : scopedProjectGroup ? (
                `No threads in ${scopedProjectGroup.displayName} yet`
              ) : (
                "No threads yet"
              )}
            </div>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <Dialog
        open={projectActionsTarget !== null}
        onOpenChange={(open) => {
          if (!open) setProjectActionsTarget(null);
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader className="gap-3 pb-1!">
            <DialogTitle className="text-balance">Project settings</DialogTitle>
            <DialogDescription className="sr-only">
              Manage project names, grouping rules, and environments.
            </DialogDescription>
            <div className="grid gap-1.5 text-base text-muted-foreground">
              {projectActionsTarget?.memberProjects.map((member) => (
                <div key={member.physicalProjectKey} className="flex min-w-0 items-center gap-3">
                  <span className="flex min-w-0 items-center gap-1">
                    <FolderIcon className="size-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0 truncate font-mono">{member.workspaceRoot}</span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="size-4 shrink-0 rounded-sm"
                      aria-label="Copy project path"
                      title="Copy project path"
                      onClick={() =>
                        copyProjectPath(member.workspaceRoot, { path: member.workspaceRoot })
                      }
                    >
                      <CopyIcon className="size-3.5" />
                    </Button>
                  </span>
                  <span className="flex min-w-0 shrink-0 items-center gap-1">
                    <ServerIcon className="size-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0 truncate">
                      {member.environmentLabel ?? "Current environment"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </DialogHeader>
          <DialogPanel className="p-0">
            <div className="divide-y divide-border/60">
              {projectActionsTarget?.memberProjects.map((member) => (
                <section
                  key={member.physicalProjectKey}
                  className="grid min-w-0 gap-5 px-6 pb-5 pt-2 sm:gap-4 sm:pb-4 sm:pt-2"
                >
                  <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
                    <label className="grid min-w-0 gap-1.5">
                      <span className="font-medium text-foreground">Project name</span>
                      <Input
                        key={`${member.physicalProjectKey}:${member.title}`}
                        aria-label={`Project name in ${member.environmentLabel ?? "current environment"}`}
                        defaultValue={member.title}
                        onBlur={(event) => {
                          void renameProjectMember(member, event.currentTarget.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    </label>
                    <label className="grid min-w-0 gap-1.5">
                      <span className="font-medium text-foreground">Grouping rule</span>
                      <Select
                        value={
                          projectGroupingSettings.sidebarProjectGroupingOverrides?.[
                            deriveProjectGroupingOverrideKey(member)
                          ] ?? "inherit"
                        }
                        onValueChange={(value) => {
                          if (
                            value === "inherit" ||
                            value === "repository" ||
                            value === "repository_path" ||
                            value === "separate"
                          ) {
                            updateProjectGroupingPreference(member, value);
                          }
                        }}
                      >
                        <SelectTrigger
                          className="w-full sm:min-h-7.5"
                          aria-label={`Grouping rule for ${member.environmentLabel ?? "current environment"}`}
                        >
                          <SelectValue>
                            {(() => {
                              const selection =
                                projectGroupingSettings.sidebarProjectGroupingOverrides?.[
                                  deriveProjectGroupingOverrideKey(member)
                                ] ?? "inherit";
                              return selection === "inherit"
                                ? `Default (${PROJECT_GROUPING_MODE_LABELS[projectGroupingSettings.sidebarProjectGroupingMode]})`
                                : PROJECT_GROUPING_MODE_LABELS[selection];
                            })()}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup align="start" alignItemWithTrigger={false}>
                          <SelectItem hideIndicator value="inherit">
                            Use global default
                          </SelectItem>
                          <SelectItem hideIndicator value="repository">
                            {PROJECT_GROUPING_MODE_LABELS.repository}
                          </SelectItem>
                          <SelectItem hideIndicator value="repository_path">
                            {PROJECT_GROUPING_MODE_LABELS.repository_path}
                          </SelectItem>
                          <SelectItem hideIndicator value="separate">
                            {PROJECT_GROUPING_MODE_LABELS.separate}
                          </SelectItem>
                        </SelectPopup>
                      </Select>
                    </label>
                    <ProjectGitHubAccountField
                      member={member}
                      onSelect={updateProjectGitHubAccount}
                    />
                    <label className="grid min-w-0 gap-1.5">
                      <span className="font-medium text-foreground">Worktree branch prefix</span>
                      <Input
                        key={`prefix:${member.physicalProjectKey}:${member.worktreeBranchPrefix ?? ""}`}
                        aria-label={`Worktree branch prefix in ${member.environmentLabel ?? "current environment"}`}
                        defaultValue={member.worktreeBranchPrefix ?? ""}
                        placeholder={
                          globalWorktreeBranchPrefix.trim().length > 0
                            ? globalWorktreeBranchPrefix
                            : WORKTREE_BRANCH_PREFIX
                        }
                        onBlur={(event) => {
                          void updateProjectWorktreeBranchPrefix(member, event.currentTarget.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                      <span className="text-[11px] text-muted-foreground">
                        New worktree branches use{" "}
                        <code>
                          {sanitizeWorktreeBranchPrefix(
                            member.worktreeBranchPrefix ?? globalWorktreeBranchPrefix,
                          )}
                          /…
                        </code>
                        {member.worktreeBranchPrefix === null ? " (global default)" : null}
                      </span>
                    </label>
                    <label className="grid min-w-0 gap-1.5">
                      <span className="font-medium text-foreground">Preview port</span>
                      <Input
                        key={`preview-port:${member.physicalProjectKey}:${member.previewPort ?? ""}`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={65535}
                        aria-label={`Localhost preview port in ${member.environmentLabel ?? "current environment"}`}
                        defaultValue={member.previewPort ?? ""}
                        placeholder="5173"
                        onBlur={(event) => {
                          void updateProjectPreviewPort(member, event.currentTarget.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                      <span className="text-[11px] text-muted-foreground">
                        The preview button in the chat header opens{" "}
                        <code>http://localhost:{member.previewPort ?? "…"}</code> in the in-app
                        browser.
                      </span>
                    </label>
                    <ProjectDefaultWorktreeBranchField
                      idPrefix={`project-worktree-branch-${member.physicalProjectKey}`}
                      environmentId={member.environmentId}
                      projectId={member.id}
                      onChange={(branch) => {
                        void updateProjectDefaultWorktreeBranch(member, branch);
                      }}
                    />
                  </div>
                  <ProjectDefaultAgentField
                    idPrefix={`project-agent-${member.physicalProjectKey}`}
                    environmentId={member.environmentId}
                    projectId={member.id}
                    onChange={(selection) => {
                      void updateProjectDefaultModelSelection(member, selection);
                    }}
                  />
                  <ProjectDefaultAgentField
                    kind="review"
                    idPrefix={`project-review-agent-${member.physicalProjectKey}`}
                    environmentId={member.environmentId}
                    projectId={member.id}
                    onChange={(selection) => {
                      void updateProjectReviewModelSelection(member, selection);
                    }}
                  />
                  <ProjectScriptsField
                    environmentId={member.environmentId}
                    projectId={member.id}
                    keybindings={keybindings}
                  />
                  {projectActionsTarget.memberProjects.length > 1 ? (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive-foreground hover:bg-destructive/8 hover:text-destructive-foreground"
                        onClick={() => {
                          const projectGroup = projectActionsTarget;
                          setProjectActionsTarget(null);
                          void handleRemoveProjectMembers(projectGroup, [member]);
                        }}
                      >
                        <Trash2Icon />
                        Remove project
                      </Button>
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
            {projectActionsTarget && projectActionsTarget.memberProjects.length > 1 ? (
              <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/32 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-base font-medium text-foreground sm:text-sm">
                    Remove this project everywhere
                  </p>
                  <p className="text-base text-pretty text-muted-foreground sm:text-sm">
                    Deletes all grouped entries and their conversation history.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="destructive-outline"
                  className="shrink-0"
                  onClick={() => {
                    const projectGroup = projectActionsTarget;
                    setProjectActionsTarget(null);
                    void handleRemoveProjectMembers(projectGroup, projectGroup.memberProjects);
                  }}
                >
                  <Trash2Icon />
                  Remove all entries
                </Button>
              </div>
            ) : null}
          </DialogPanel>
          <DialogFooter variant="bare" className="sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {projectActionsTarget?.memberProjects.length === 1 ? (
                <Button
                  variant="destructive-outline"
                  onClick={() => {
                    const projectGroup = projectActionsTarget;
                    setProjectActionsTarget(null);
                    void handleRemoveProjectMembers(projectGroup, projectGroup.memberProjects);
                  }}
                >
                  <Trash2Icon />
                  Remove project
                </Button>
              ) : null}
              {projectActionsTarget
                ? (() => {
                    const targetKey = projectActionsTarget.projectKey;
                    const targetHidden = isProjectHidden(targetKey);
                    return (
                      <Button
                        variant="ghost"
                        onClick={() => setProjectHiddenByKey(targetKey, !targetHidden)}
                      >
                        {targetHidden ? <EyeIcon /> : <EyeOffIcon />}
                        {targetHidden ? "Show in sidebar" : "Hide from sidebar"}
                      </Button>
                    );
                  })()
                : null}
            </div>
            <Button onClick={() => setProjectActionsTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      {hiddenProjectGroups.length > 0 ? (
        <div className="px-2 pb-1 pt-0.5">
          <button
            type="button"
            data-testid="sidebar-v2-show-hidden-projects"
            aria-pressed={showHiddenProjects}
            onClick={() => setShowHiddenProjects(!showHiddenProjects)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-sidebar-muted-foreground outline-none transition-colors hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:bg-sidebar-row-hover focus-visible:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showHiddenProjects ? (
              <EyeOffIcon className="size-3.5 shrink-0" />
            ) : (
              <EyeIcon className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {showHiddenProjects
                ? "Hide hidden projects"
                : `Show hidden projects (${hiddenProjectGroups.length})`}
            </span>
          </button>
        </div>
      ) : null}
      <SidebarChromeFooter />
    </>
  );
}
