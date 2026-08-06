import { useAtomValue } from "@effect/atom-react";
import { useParams } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import type { ScopedThreadRef, TurnId } from "@t3tools/contracts";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Columns2Icon,
  PilcrowIcon,
  Rows3Icon,
  SearchIcon,
  TextWrapIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOpenInPreferredEditor } from "../editorPreferences";
import { type DraftId } from "../composerDraftStore";
import { openDiffFilePrimaryAction } from "../diffFileActions";
import { useCheckpointDiff } from "~/lib/checkpointDiffState";
import { cn } from "~/lib/utils";
import { selectThreadDiffPanelSelection, useDiffPanelStore } from "../diffPanelStore";
import { selectViewedSignatures, useDiffViewedStore } from "../diffViewedStore";
import { useTheme } from "../hooks/useTheme";
import {
  buildFileDiffContentSignature,
  buildFileDiffRenderKey,
  getDiffCollapseIconClassName,
  getDiffLineStat,
  getRenderablePatch,
  resolveFileDiffPath,
} from "../lib/diffRendering";
import { useDiffThemeName } from "../hooks/useDiffThemeName";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { useProject, useThread } from "../state/entities";
import { resolveThreadRouteRef } from "../threadRoutes";
import { useWorkspaceThreadRef } from "../lib/workspaceThreadRef";
import { useClientSettings } from "../hooks/useSettings";
import { formatShortTimestamp } from "../timestampFormat";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { DiffNavigatorFileList, type DiffNavigatorFile } from "./chat/ChangedFilesTree";
import { AnnotatableCodeView, type AnnotatableCodeViewHandle } from "./diffs/AnnotatableCodeView";
import { Button } from "./ui/button";
import { ToggleGroup, Toggle } from "./ui/toggle-group";
import { Switch } from "./ui/switch";
import { Checkbox } from "./ui/checkbox";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "./ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";
import { reviewEnvironment } from "../state/review";
import { vcsEnvironment } from "../state/vcs";
import { buildBaseRefChoices, filterBaseRefChoices } from "../lib/baseRefChoices";

type DiffRenderMode = "stacked" | "split";
type DiffThemeType = "light" | "dark";
const AUTOMATIC_BASE_REF = "__automatic_base_ref__";

/**
 * Tracks which files the user has explicitly expanded, keyed by file path so
 * expansion survives edits to other files. Files default to collapsed, so an
 * empty set (a fresh scope, or returning after navigating away) shows every
 * file collapsed.
 */
interface ExpandedDiffFilesState {
  readonly scopeKey: string | null;
  readonly filePaths: ReadonlySet<string>;
}

const EMPTY_EXPANDED_DIFF_FILE_PATHS: ReadonlySet<string> = new Set();

const DIFF_PANEL_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-header-font-family: var(--font-sans) !important;
  --diffs-font-family: var(--font-mono) !important;
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 90%, var(--foreground));

  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 92%, var(--success));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 88%, var(--success));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--background) 85%, var(--success));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 80%, var(--success));

  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 92%, var(--destructive));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 88%, var(--destructive));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--background) 85%, var(--destructive));
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--background) 80%,
    var(--destructive)
  );

  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-bottom: 1px solid var(--border) !important;
  align-items: center !important;
  font-family: var(--font-sans) !important;
  font-size: 12px !important;
  line-height: 1 !important;
  min-height: 32px !important;
  padding-block: 6px !important;
}

[data-diffs-header] [data-header-content] {
  align-items: center !important;
  line-height: 1 !important;
}

[data-diffs-header] [data-metadata] {
  align-items: center !important;
  line-height: 1 !important;
  font-variant-numeric: tabular-nums;
}

[data-diffs-header] [data-additions-count],
[data-diffs-header] [data-deletions-count] {
  font-family: var(--font-mono) !important;
  font-size: 11px !important;
  font-variant-numeric: tabular-nums;
  line-height: 1 !important;
}

[data-diffs-header] [data-change-icon],
[data-diffs-header] [data-rename-icon] {
  display: block;
  flex-shrink: 0;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
  font-family: var(--font-sans) !important;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}
`;

interface DiffPanelProps {
  mode?: DiffPanelMode;
  composerDraftTarget: ScopedThreadRef | DraftId;
  initialGitScope: "branch" | "unstaged";
  /**
   * The chat this panel belongs to. Passed explicitly because a brand-new chat
   * is a draft with no thread route params yet; when omitted the panel falls
   * back to the route params (server chats).
   */
  threadRef?: ScopedThreadRef | null;
  /**
   * `navigator` (default) renders only the changed-file tree; clicking a file
   * opens its diff in a dedicated tab via `onOpenFileDiff`. `file` renders a
   * single file's diff — the per-file tab opened from the navigator.
   */
  variant?: "navigator" | "file";
  /** The file whose diff to show when `variant === "file"`. */
  fileDiffPath?: string;
  /**
   * The file whose diff is currently open in a dedicated tab — highlighted in
   * the `navigator` variant's file list so the active row stands out.
   */
  navigatorActiveFilePath?: string | null;
  /** Invoked when a file is chosen in the navigator tree. */
  onOpenFileDiff?: (filePath: string) => void;
  /**
   * Optional control rendered at the leading edge of the `file` variant
   * toolbar — used to host the shared edit/view toggle for the file viewer.
   */
  fileViewToggle?: ReactNode;
}

export { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

export default function DiffPanel({
  mode = "inline",
  composerDraftTarget,
  initialGitScope: initialGitScopeProp,
  threadRef: threadRefProp,
  variant = "navigator",
  fileDiffPath,
  navigatorActiveFilePath,
  onOpenFileDiff,
  fileViewToggle,
}: DiffPanelProps) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = useDiffThemeName();
  const settings = useClientSettings();
  const [initialGitScope] = useState(initialGitScopeProp);
  const [diffRenderMode, setDiffRenderMode] = useState<DiffRenderMode>("split");
  const [wordWrap, setWordWrap] = useState(settings.wordWrap);
  const [diffIgnoreWhitespace, setDiffIgnoreWhitespace] = useState(settings.diffIgnoreWhitespace);
  const [baseRefQuery, setBaseRefQuery] = useState("");
  const [expandedDiffFiles, setExpandedDiffFiles] = useState<ExpandedDiffFilesState>(() => ({
    scopeKey: null,
    filePaths: EMPTY_EXPANDED_DIFF_FILE_PATHS,
  }));
  // The `file` variant focuses a single file's diff; the navigator never shows
  // an inline diff (clicking a file opens a dedicated per-file tab instead).
  const focusedFilePath = variant === "file" ? (fileDiffPath ?? null) : null;
  // Whether the navigator tree shows folders expanded (defaults to open so the
  // full folder structure is visible, matching the changed-files list).
  const codeViewRef = useRef<AnnotatableCodeViewHandle>(null);

  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  // A brand-new chat is a client-side draft with no thread route params, so the
  // host passes its pre-allocated ref explicitly; server chats fall back to the
  // route params.
  const currentThreadRef = threadRefProp ?? routeThreadRef;
  const activeThreadId = currentThreadRef?.threadId ?? null;
  // The diff view is part of the shared per-worktree workspace: chats in one
  // worktree key their diff selection and reviewed-file state off the worktree's
  // representative thread. Turn summaries still come from the current chat
  // (turns are per-chat), but the worktree's working-tree/branch diff, its git
  // status, and the diff store keying resolve through the representative — so a
  // not-yet-sent draft shows the shared diff immediately instead of only after
  // its first message promotes it to a server thread.
  const workspaceThreadRef = useWorkspaceThreadRef(currentThreadRef);
  const activeThread = useThread(currentThreadRef);
  // The worktree's data source. For a draft the current chat has no server
  // thread yet, so this resolves to the representative sibling that owns the
  // worktree; for an ordinary chat it's the same worktree either way.
  const workspaceThread = useThread(workspaceThreadRef) ?? activeThread;
  const activeProjectId = workspaceThread?.projectId ?? null;
  const activeProject = useProject(
    workspaceThread && activeProjectId
      ? {
          environmentId: workspaceThread.environmentId,
          projectId: activeProjectId,
        }
      : null,
  );
  const activeCwd = workspaceThread?.worktreePath ?? activeProject?.workspaceRoot;
  const serverConfig = useAtomValue(
    serverEnvironment.configValueAtom(workspaceThread?.environmentId ?? null),
  );
  const openInPreferredEditor = useOpenInPreferredEditor(
    workspaceThread?.environmentId ?? null,
    serverConfig?.availableEditors ?? [],
  );
  const gitStatusQuery = useEnvironmentQuery(
    workspaceThread != null && activeCwd != null
      ? vcsEnvironment.status({
          environmentId: workspaceThread.environmentId,
          input: { cwd: activeCwd },
        })
      : null,
  );
  const diffSelection = useDiffPanelStore((state) =>
    selectThreadDiffPanelSelection(
      state,
      // Turn selection is per chat; the working-tree/branch view is shared
      // across the worktree via the representative thread.
      currentThreadRef,
      workspaceThreadRef,
      initialGitScope === "unstaged",
    ),
  );
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightTurnCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );

  useEffect(() => {
    if (!currentThreadRef || diffSelection.kind !== "turn") return;
    useDiffPanelStore.getState().reconcileTurnSelection(
      currentThreadRef,
      orderedTurnDiffSummaries.map((summary) => summary.turnId),
    );
  }, [currentThreadRef, diffSelection, orderedTurnDiffSummaries]);

  const selectedTurnId = diffSelection.kind === "turn" ? diffSelection.turnId : null;
  const selectedGitScope = diffSelection.kind === "unstaged" ? "unstaged" : "branch";
  const selectedBaseRef = diffSelection.kind === "branch" ? diffSelection.baseRef : null;
  const selectedFilePath = diffSelection.kind === "turn" ? diffSelection.filePath : null;
  const selectedFileRevealRequestId =
    diffSelection.kind === "turn" ? diffSelection.revealRequestId : 0;
  const selectedTurn =
    selectedTurnId === null
      ? undefined
      : (orderedTurnDiffSummaries.find((summary) => summary.turnId === selectedTurnId) ??
        orderedTurnDiffSummaries[0]);
  const selectedCheckpointTurnCount =
    selectedTurn &&
    (selectedTurn.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[selectedTurn.turnId]);
  const latestTurn = orderedTurnDiffSummaries[0];
  const selectedScopeLabel =
    selectedTurnId === null
      ? selectedGitScope === "unstaged"
        ? "Working tree"
        : "Branch changes"
      : selectedTurn?.turnId === latestTurn?.turnId
        ? "Latest turn"
        : `Turn ${selectedCheckpointTurnCount ?? "?"}`;
  const reviewSectionId = selectedTurn ? `turn:${selectedTurn.turnId}` : selectedGitScope;
  const collapseScopeKey = workspaceThreadRef
    ? `${workspaceThreadRef.environmentId}:${workspaceThreadRef.threadId}:${reviewSectionId}`
    : null;
  const expandedDiffFilePaths =
    expandedDiffFiles.scopeKey === collapseScopeKey
      ? expandedDiffFiles.filePaths
      : EMPTY_EXPANDED_DIFF_FILE_PATHS;
  const viewedSignatures = useDiffViewedStore((state) =>
    selectViewedSignatures(state.viewedByScope, collapseScopeKey),
  );
  const reviewSectionTitle = selectedTurn
    ? `Turn ${selectedCheckpointTurnCount ?? "?"}`
    : selectedGitScope === "unstaged"
      ? "Working tree"
      : "Branch changes";
  const selectedCheckpointRange = useMemo(
    () =>
      typeof selectedCheckpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
            toTurnCount: selectedCheckpointTurnCount,
          }
        : null,
    [selectedCheckpointTurnCount],
  );
  const activeCheckpointDiff = useCheckpointDiff(
    {
      environmentId: activeThread?.environmentId ?? null,
      threadId: activeThreadId,
      fromTurnCount: selectedCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: selectedCheckpointRange?.toTurnCount ?? null,
      ignoreWhitespace: diffIgnoreWhitespace,
      cacheScope: selectedTurn ? `turn:${selectedTurn.turnId}` : null,
    },
    { enabled: isGitRepo && selectedTurn !== undefined },
  );
  const primaryBranchDiffPreview = useEnvironmentQuery(
    selectedTurnId === null && workspaceThread && activeCwd
      ? reviewEnvironment.diffPreview({
          environmentId: workspaceThread.environmentId,
          input: {
            cwd: activeCwd,
            ...(selectedBaseRef ? { baseRef: selectedBaseRef } : {}),
            ignoreWhitespace: diffIgnoreWhitespace,
          },
        })
      : null,
  );
  const shouldRetryBranchDiffAtEnvironmentCwd =
    selectedTurnId === null &&
    primaryBranchDiffPreview.error?.includes("configured workspace root") === true &&
    serverConfig?.cwd !== undefined &&
    serverConfig.cwd !== activeCwd;
  const fallbackBranchDiffPreview = useEnvironmentQuery(
    shouldRetryBranchDiffAtEnvironmentCwd && workspaceThread && serverConfig
      ? reviewEnvironment.diffPreview({
          environmentId: workspaceThread.environmentId,
          input: {
            cwd: serverConfig.cwd,
            ...(selectedBaseRef ? { baseRef: selectedBaseRef } : {}),
            ignoreWhitespace: diffIgnoreWhitespace,
          },
        })
      : null,
  );
  const branchDiffPreview = shouldRetryBranchDiffAtEnvironmentCwd
    ? fallbackBranchDiffPreview
    : primaryBranchDiffPreview;
  const selectedGitSource = branchDiffPreview.data?.sources.find(
    (source) => source.kind === (selectedGitScope === "unstaged" ? "working-tree" : "branch-range"),
  );
  const localBranchRefs = useEnvironmentQuery(
    selectedTurnId === null &&
      selectedGitScope === "branch" &&
      workspaceThread &&
      branchDiffPreview.data?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: workspaceThread.environmentId,
          input: {
            cwd: branchDiffPreview.data.cwd,
            includeMatchingRemoteRefs: true,
            refKind: "local",
            ...(baseRefQuery.trim().length > 0 ? { query: baseRefQuery.trim() } : {}),
            limit: 100,
          },
        })
      : null,
  );
  const remoteBranchRefs = useEnvironmentQuery(
    selectedTurnId === null &&
      selectedGitScope === "branch" &&
      workspaceThread &&
      branchDiffPreview.data?.cwd
      ? vcsEnvironment.listRefs({
          environmentId: workspaceThread.environmentId,
          input: {
            cwd: branchDiffPreview.data.cwd,
            includeMatchingRemoteRefs: true,
            refKind: "remote",
            ...(baseRefQuery.trim().length > 0 ? { query: baseRefQuery.trim() } : {}),
            limit: 100,
          },
        })
      : null,
  );
  const baseRefChoices = buildBaseRefChoices(
    localBranchRefs.data?.refs.filter((ref) => ref.name !== selectedGitSource?.headRef) ?? [],
    remoteBranchRefs.data?.refs ?? [],
  );
  const matchingBaseRefChoices = filterBaseRefChoices(baseRefChoices, baseRefQuery);
  const valueForBaseRefChoice = (choice: (typeof baseRefChoices)[number]) =>
    selectedBaseRef && selectedBaseRef === choice.remote?.name
      ? selectedBaseRef
      : (choice.local?.name ?? choice.remote?.name ?? choice.id);
  const baseRefItems = [AUTOMATIC_BASE_REF, ...baseRefChoices.map(valueForBaseRefChoice)];
  const filteredBaseRefItems = [
    ...(baseRefQuery.trim().length === 0 ? [AUTOMATIC_BASE_REF] : []),
    ...matchingBaseRefChoices.map(valueForBaseRefChoice),
  ];
  const gitDiff = selectedGitSource?.diff;

  const selectedPatch = selectedTurn ? activeCheckpointDiff.data?.diff : gitDiff;
  const isSelectedPatchTruncated = !selectedTurn && selectedGitSource?.truncated === true;
  const isLoadingSelectedPatch = selectedTurn
    ? activeCheckpointDiff.isPending
    : branchDiffPreview.isPending;
  const selectedPatchError = selectedTurn ? activeCheckpointDiff.error : branchDiffPreview.error;
  const hasResolvedPatch = typeof selectedPatch === "string";
  const hasNoNetChanges = hasResolvedPatch && selectedPatch.trim().length === 0;
  const renderablePatch = useMemo(
    () =>
      getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`, {
        compactPartialHunkOffsets: selectedTurnId === null,
      }),
    [resolvedTheme, selectedPatch, selectedTurnId],
  );
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") {
      return [];
    }
    return renderablePatch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [renderablePatch]);
  const codeViewFiles = useMemo(
    () =>
      renderableFiles.map((fileDiff) => {
        const fileKey = buildFileDiffRenderKey(fileDiff);
        const filePath = resolveFileDiffPath(fileDiff);
        const signature = buildFileDiffContentSignature(fileDiff);
        return {
          fileDiff,
          filePath,
          fileKey,
          signature,
          // Viewed only counts while the file's content is unchanged since it
          // was marked; an edit clears the mark ("the check is gone").
          viewed: viewedSignatures[filePath] === signature,
          // Files default to collapsed; only explicit expansion opens them.
          collapsed: !expandedDiffFilePaths.has(filePath),
        };
      }),
    [expandedDiffFilePaths, renderableFiles, viewedSignatures],
  );
  const viewedFileKeySet = useMemo(
    () => new Set(codeViewFiles.filter((file) => file.viewed).map((file) => file.fileKey)),
    [codeViewFiles],
  );
  const signatureByFilePath = useMemo(
    () => new Map(codeViewFiles.map((file) => [file.filePath, file.signature])),
    [codeViewFiles],
  );
  const focusedFile = useMemo(
    () =>
      focusedFilePath
        ? (codeViewFiles.find((file) => file.filePath === focusedFilePath) ?? null)
        : null,
    [codeViewFiles, focusedFilePath],
  );
  // The focused file is always expanded; otherwise show the whole change set.
  const displayedCodeViewFiles = useMemo(
    () => (focusedFile ? [{ ...focusedFile, collapsed: false }] : codeViewFiles),
    [codeViewFiles, focusedFile],
  );
  // The navigator renders a flat list of the changed files (no folder nesting).
  // Per-file stats come from each file's own hunks so the list matches the diff
  // exactly; `viewed` drives the dim + move-to-bottom treatment.
  const navigatorFiles = useMemo<DiffNavigatorFile[]>(() => {
    const conflictedPaths = new Set(
      selectedTurnId === null
        ? (gitStatusQuery.data?.workingTree.files
            .filter((file) => file.conflicted === true)
            .map((file) => file.path) ?? [])
        : [],
    );
    return codeViewFiles.map(({ fileDiff, filePath, viewed }) => {
      const stat = getDiffLineStat([fileDiff]);
      return {
        path: filePath,
        additions: stat.additions,
        deletions: stat.deletions,
        viewed,
        conflicted: conflictedPaths.has(filePath),
      };
    });
  }, [codeViewFiles, gitStatusQuery.data?.workingTree.files, selectedTurnId]);

  useEffect(() => {
    if (!selectedFilePath) return;
    const file = codeViewFiles.find((candidate) => candidate.filePath === selectedFilePath);
    if (!file) return;
    codeViewRef.current?.scrollTo({ type: "item", id: file.fileKey, align: "start" });
  }, [codeViewFiles, selectedFilePath, selectedFileRevealRequestId]);

  const openDiffFile = useCallback(
    (filePath: string) => {
      openDiffFilePrimaryAction({
        threadRef: workspaceThreadRef,
        filePath,
        activeCwd,
        openInEditor: (targetPath) => {
          void (async () => {
            const result = await openInPreferredEditor(targetPath);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              console.warn("Failed to open diff file in editor.", {
                operation: "open-diff-file",
                ...(currentThreadRef
                  ? {
                      environmentId: currentThreadRef.environmentId,
                      threadId: currentThreadRef.threadId,
                    }
                  : {}),
                ...safeErrorLogAttributes(squashAtomCommandFailure(result)),
              });
            }
          })();
        },
      });
    },
    [activeCwd, openInPreferredEditor, currentThreadRef, workspaceThreadRef],
  );
  const setDiffFileExpanded = useCallback(
    (filePath: string, expanded: boolean) => {
      setExpandedDiffFiles((current) => {
        const next = new Set(current.scopeKey === collapseScopeKey ? current.filePaths : []);
        if (expanded) {
          next.add(filePath);
        } else {
          next.delete(filePath);
        }
        return { scopeKey: collapseScopeKey, filePaths: next };
      });
    },
    [collapseScopeKey],
  );

  const toggleDiffFileCollapsed = useCallback(
    (filePath: string) => {
      setExpandedDiffFiles((current) => {
        const next = new Set(current.scopeKey === collapseScopeKey ? current.filePaths : []);
        if (next.has(filePath)) {
          next.delete(filePath);
        } else {
          next.add(filePath);
        }
        return { scopeKey: collapseScopeKey, filePaths: next };
      });
    },
    [collapseScopeKey],
  );

  const toggleFileViewed = useCallback(
    (filePath: string) => {
      if (!collapseScopeKey) return;
      const signature = signatureByFilePath.get(filePath);
      if (signature === undefined) return;
      const nowViewed = viewedSignatures[filePath] !== signature;
      useDiffViewedStore.getState().setFileViewed(collapseScopeKey, filePath, signature, nowViewed);
      // Collapse a file when it is marked viewed, and expand it when unmarked.
      setDiffFileExpanded(filePath, !nowViewed);
      // After marking a file viewed, jump to the next still-unviewed file so a
      // review flows file-to-file without hunting the list. Wraps around, and
      // stops (stays put) once everything is viewed.
      if (nowViewed && onOpenFileDiff) {
        const order = codeViewFiles.map((file) => file.filePath);
        const currentIndex = order.indexOf(filePath);
        if (currentIndex >= 0) {
          const isViewed = (candidate: string) => {
            if (candidate === filePath) return true;
            const candidateSignature = signatureByFilePath.get(candidate);
            return (
              candidateSignature !== undefined && viewedSignatures[candidate] === candidateSignature
            );
          };
          const rotated = [...order.slice(currentIndex + 1), ...order.slice(0, currentIndex)];
          const nextFilePath = rotated.find((candidate) => !isViewed(candidate));
          if (nextFilePath) onOpenFileDiff(nextFilePath);
        }
      }
    },
    [
      codeViewFiles,
      collapseScopeKey,
      onOpenFileDiff,
      setDiffFileExpanded,
      signatureByFilePath,
      viewedSignatures,
    ],
  );

  const selectTurn = (turnId: TurnId) => {
    // Turns belong to this conversation, so the selection keys off the chat's
    // own ref rather than the shared worktree representative.
    if (!currentThreadRef) return;
    useDiffPanelStore.getState().selectTurn(currentThreadRef, turnId);
  };
  const selectGitScope = (scope: "branch" | "unstaged") => {
    if (!workspaceThreadRef || !currentThreadRef) return;
    useDiffPanelStore.getState().selectGitScope(workspaceThreadRef, currentThreadRef, scope);
  };
  const selectBranchBaseRef = (baseRef: string | null) => {
    if (!workspaceThreadRef || !currentThreadRef) return;
    useDiffPanelStore.getState().selectBranchBaseRef(workspaceThreadRef, currentThreadRef, baseRef);
  };

  const headerRow = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-3 [-webkit-app-region:no-drag]">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-muted/70 px-2 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Diff scope: ${selectedScopeLabel}`}
          >
            <span className="truncate">{selectedScopeLabel}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuItem
              className={
                selectedTurnId === null && selectedGitScope === "unstaged"
                  ? "bg-foreground/[0.08]"
                  : undefined
              }
              onClick={() => selectGitScope("unstaged")}
            >
              <span>Working tree</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={
                selectedTurnId === null && selectedGitScope === "branch"
                  ? "bg-foreground/[0.08]"
                  : undefined
              }
              onClick={() => selectGitScope("branch")}
            >
              <span>Branch changes</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={
                selectedTurnId !== null && selectedTurn?.turnId === latestTurn?.turnId
                  ? "bg-foreground/[0.08]"
                  : undefined
              }
              onClick={() => {
                if (latestTurn) selectTurn(latestTurn.turnId);
              }}
            >
              <span>Latest turn</span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Turn</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                {orderedTurnDiffSummaries.map((summary) => {
                  const turnCount =
                    summary.checkpointTurnCount ??
                    inferredCheckpointTurnCountByTurnId[summary.turnId] ??
                    "?";
                  return (
                    <DropdownMenuItem
                      key={summary.turnId}
                      className={
                        summary.turnId === selectedTurn?.turnId ? "bg-foreground/[0.08]" : undefined
                      }
                      onClick={() => selectTurn(summary.turnId)}
                    >
                      <span>Turn {turnCount}</span>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                        {formatShortTimestamp(summary.completedAt, settings.timestampFormat)}
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        {selectedTurnId === null && selectedGitScope === "branch" && selectedGitSource?.baseRef && (
          <div
            className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden text-xs text-muted-foreground"
            title={`${selectedGitSource.headRef ?? "HEAD"} → ${selectedGitSource.baseRef}`}
            aria-label={`Comparing ${selectedGitSource.headRef ?? "HEAD"} against ${selectedGitSource.baseRef}`}
          >
            <span className="min-w-0 max-w-48 truncate">{selectedGitSource.headRef ?? "HEAD"}</span>
            <ArrowRightIcon className="size-3.5 shrink-0 opacity-70" />
            <Combobox
              items={baseRefItems}
              filteredItems={filteredBaseRefItems}
              value={selectedBaseRef ?? AUTOMATIC_BASE_REF}
              onOpenChange={(open) => {
                if (!open) setBaseRefQuery("");
              }}
              onValueChange={(value) => {
                if (!value) return;
                selectBranchBaseRef(value === AUTOMATIC_BASE_REF ? null : value);
              }}
            >
              <ComboboxTrigger
                className="inline-flex min-w-0 max-w-48 items-center gap-1 overflow-hidden rounded-md px-1.5 py-1 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Change comparison target. Currently ${selectedGitSource.baseRef}`}
              >
                <span className="min-w-0 truncate">{selectedGitSource.baseRef}</span>
                <ChevronDownIcon className="size-3.5 shrink-0 opacity-70" />
              </ComboboxTrigger>
              <ComboboxPopup
                align="start"
                className="w-72 min-w-0 max-w-[calc(100vw-1rem)] overflow-hidden [&>[data-slot=combobox-popup]]:min-w-0 [&>[data-slot=combobox-popup]]:overflow-hidden"
              >
                <div className="min-w-0 shrink-0 px-3 pt-2.5">
                  <div className="relative -translate-y-px border-b border-border/70 pb-1.5 transition-colors focus-within:border-ring">
                    <SearchIcon
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1.5 left-0 size-4 shrink-0 text-muted-foreground/55"
                    />
                    <ComboboxInput
                      className="[&_input]:h-6.5 [&_input]:ps-5 [&_input]:font-sans [&_input]:leading-6.5"
                      inputClassName="rounded-none bg-transparent text-sm"
                      placeholder="Search refs..."
                      showTrigger={false}
                      size="sm"
                      unstyled
                      value={baseRefQuery}
                      onChange={(event) => setBaseRefQuery(event.target.value)}
                    />
                  </div>
                </div>
                <div className="grid shrink-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 border-b border-border/70 ps-3 pe-6.5 pt-2 pb-1.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                  <span aria-hidden="true" />
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center">
                    <span>Branch</span>
                    <span className="text-right">Remote</span>
                  </div>
                </div>
                <ComboboxEmpty>No matching refs.</ComboboxEmpty>
                <ComboboxList className="max-h-64 min-w-0 overflow-x-hidden">
                  <ComboboxItem
                    className="h-8 w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)] py-0"
                    contentClassName="w-full min-w-0 overflow-hidden"
                    value={AUTOMATIC_BASE_REF}
                  >
                    <span className="block min-w-0 truncate">Automatic</span>
                  </ComboboxItem>
                  {baseRefChoices.map((choice) => {
                    const item = valueForBaseRefChoice(choice);
                    const hasBoth = choice.local !== null && choice.remote !== null;
                    const useRemote = choice.remote?.name === item;
                    return (
                      <ComboboxItem
                        key={choice.id}
                        className="h-8 w-full min-w-0 grid-cols-[1rem_minmax(0,1fr)] py-0"
                        contentClassName="w-full min-w-0 overflow-hidden"
                        value={item}
                      >
                        <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center overflow-hidden">
                          <span className="block min-w-0 truncate pe-2">{choice.label}</span>
                          {hasBoth ? (
                            <div
                              className="flex justify-end"
                              onClick={(event) => event.stopPropagation()}
                              onPointerDown={(event) => event.stopPropagation()}
                            >
                              <Switch
                                aria-label={`Use remote version of ${choice.label}`}
                                checked={useRemote}
                                className="[--thumb-size:--spacing(3)]"
                                onCheckedChange={(checked) => {
                                  const nextRef = checked
                                    ? choice.remote?.name
                                    : choice.local?.name;
                                  if (nextRef) selectBranchBaseRef(nextRef);
                                }}
                              />
                            </div>
                          ) : choice.remote ? (
                            <span
                              className="flex justify-end text-muted-foreground"
                              title="Remote only"
                            >
                              <CheckIcon aria-hidden="true" className="size-3" />
                            </span>
                          ) : null}
                        </div>
                      </ComboboxItem>
                    );
                  })}
                </ComboboxList>
              </ComboboxPopup>
            </Combobox>
          </div>
        )}
      </div>
      {variant === "file" ? (
        <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
          {fileViewToggle ?? null}
          {focusedFile ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <label className="mr-1 flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
                    <Checkbox
                      checked={focusedFile.viewed}
                      className="size-3.5"
                      aria-label={focusedFile.viewed ? "Mark as not viewed" : "Mark as viewed"}
                      onCheckedChange={() => toggleFileViewed(focusedFile.filePath)}
                    />
                    Viewed
                  </label>
                }
              />
              <TooltipPopup side="top">
                {focusedFile.viewed
                  ? "Marked viewed — unchecks automatically if the file changes"
                  : "Mark as viewed"}
              </TooltipPopup>
            </Tooltip>
          ) : null}
          <ToggleGroup
            className="shrink-0"
            variant="outline"
            size="xs"
            value={[diffRenderMode]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "stacked" || next === "split") {
                setDiffRenderMode(next);
              }
            }}
          >
            <Toggle aria-label="Stacked diff view" value="stacked">
              <Rows3Icon className="size-3" />
            </Toggle>
            <Toggle aria-label="Split diff view" value="split">
              <Columns2Icon className="size-3" />
            </Toggle>
          </ToggleGroup>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  aria-label={wordWrap ? "Disable diff line wrapping" : "Enable diff line wrapping"}
                  variant="outline"
                  size="xs"
                  pressed={wordWrap}
                  onPressedChange={(pressed) => {
                    setWordWrap(Boolean(pressed));
                  }}
                />
              }
            >
              <TextWrapIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {wordWrap ? "Disable line wrapping" : "Enable line wrapping"}
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  aria-label={
                    diffIgnoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"
                  }
                  variant="outline"
                  size="xs"
                  pressed={diffIgnoreWhitespace}
                  onPressedChange={(pressed) => {
                    setDiffIgnoreWhitespace(Boolean(pressed));
                  }}
                />
              }
            >
              <PilcrowIcon className="size-3" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {diffIgnoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"}
            </TooltipPopup>
          </Tooltip>
        </div>
      ) : null}
    </>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {!workspaceThread ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Select a thread to inspect turn diffs.
        </div>
      ) : !isGitRepo ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Turn diffs are unavailable because this project is not a git repository.
        </div>
      ) : selectedTurnId !== null && orderedTurnDiffSummaries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No completed turns yet.
        </div>
      ) : (
        <div className="diff-panel-viewport flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {isSelectedPatchTruncated && (
            <p className="shrink-0 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
              This diff was truncated because it exceeded the preview limit. The changes shown are
              incomplete.
            </p>
          )}
          {selectedPatchError && !renderablePatch && (
            <div className="px-3">
              <p className="mb-2 text-[11px] text-red-500/80">{selectedPatchError}</p>
            </div>
          )}
          {!renderablePatch ? (
            isLoadingSelectedPatch ? (
              <DiffPanelLoadingState
                label={
                  selectedTurn
                    ? "Loading checkpoint diff..."
                    : selectedGitScope === "unstaged"
                      ? "Loading working tree diff..."
                      : "Loading branch diff..."
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                <p>
                  {hasNoNetChanges
                    ? "No net changes in this selection."
                    : "No patch available for this selection."}
                </p>
              </div>
            )
          ) : variant === "navigator" ? (
            navigatorFiles.length > 0 ? (
              <div className="min-h-0 flex-1 overflow-auto p-2">
                <DiffNavigatorFileList
                  files={navigatorFiles}
                  resolvedTheme={resolvedTheme}
                  activeFilePath={navigatorActiveFilePath}
                  onOpenFile={(filePath) => onOpenFileDiff?.(filePath)}
                  onToggleViewed={toggleFileViewed}
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                <p>
                  {renderablePatch.kind === "raw"
                    ? renderablePatch.reason
                    : "No changes in this selection."}
                </p>
              </div>
            )
          ) : renderablePatch.kind === "files" ? (
            focusedFile ? (
              <>
                <div className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-card/80 px-3 py-2 text-xs">
                  <span
                    className="min-w-0 flex-1 truncate font-medium text-foreground"
                    title={focusedFile.filePath}
                  >
                    {focusedFile.filePath}
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="h-6 shrink-0 px-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => openDiffFile(focusedFile.filePath)}
                  >
                    Open file
                  </Button>
                </div>
                <div className="min-h-0 flex-1">
                  <AnnotatableCodeView
                    viewerRef={codeViewRef}
                    key={`${collapseScopeKey ?? reviewSectionId}:${focusedFilePath ?? "all"}`}
                    className="diff-render-surface h-full min-h-0 overflow-auto"
                    files={displayedCodeViewFiles}
                    sectionId={reviewSectionId}
                    sectionTitle={reviewSectionTitle}
                    composerDraftTarget={composerDraftTarget}
                    viewedFileKeys={viewedFileKeySet}
                    renderHeaderPrefix={(fileDiff, fileKey, collapsed) => {
                      const filePath = resolveFileDiffPath(fileDiff);
                      const viewed = viewedFileKeySet.has(fileKey);
                      return (
                        <>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <button
                                  type="button"
                                  className={cn(
                                    "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 transition-colors hover:bg-foreground/10 focus-visible:outline-hidden",
                                    getDiffCollapseIconClassName(fileDiff),
                                  )}
                                  aria-label={
                                    collapsed ? `Expand ${filePath}` : `Collapse ${filePath}`
                                  }
                                  aria-expanded={!collapsed}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleDiffFileCollapsed(filePath);
                                  }}
                                />
                              }
                            >
                              {collapsed ? (
                                <ChevronRightIcon className="size-4" />
                              ) : (
                                <ChevronDownIcon className="size-4" />
                              )}
                            </TooltipTrigger>
                            <TooltipPopup side="top">
                              {collapsed ? "Expand diff" : "Collapse diff"}
                            </TooltipPopup>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Checkbox
                                  checked={viewed}
                                  className="shrink-0"
                                  aria-label={
                                    viewed
                                      ? `Mark ${filePath} as not viewed`
                                      : `Mark ${filePath} as viewed`
                                  }
                                  onClick={(event) => event.stopPropagation()}
                                  onCheckedChange={() => toggleFileViewed(filePath)}
                                />
                              }
                            />
                            <TooltipPopup side="top">
                              {viewed ? "Mark as not viewed" : "Mark as viewed"}
                            </TooltipPopup>
                          </Tooltip>
                        </>
                      );
                    }}
                    options={{
                      diffStyle: diffRenderMode === "split" ? "split" : "unified",
                      lineDiffType: "none",
                      overflow: wordWrap ? "wrap" : "scroll",
                      theme: diffThemeName,
                      themeType: resolvedTheme as DiffThemeType,
                      unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                      stickyHeaders: true,
                      // Wrapped rows cannot be estimated from source-line count. Render a
                      // bounded chunk around the viewport so Pierre can measure their real
                      // heights and extend the scroll range through the final file. Merely
                      // inflating lineHeight still cuts off lines that wrap more than the
                      // guessed average. Scroll mode keeps CodeView's minimal chunk size.
                      itemMetrics: {
                        diffHeaderHeight: 33,
                        hunkLineCount: wordWrap ? 50 : 1,
                        lineHeight: 20,
                      },
                      layout: { paddingTop: 0, paddingBottom: 8, gap: 8 },
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                <p>This file has no changes in the current selection.</p>
              </div>
            )
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-2">
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
                <pre
                  className={cn(
                    "max-h-[72vh] rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90",
                    wordWrap
                      ? "overflow-auto whitespace-pre-wrap wrap-break-word"
                      : "overflow-auto",
                  )}
                >
                  {renderablePatch.text}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </DiffPanelShell>
  );
}
