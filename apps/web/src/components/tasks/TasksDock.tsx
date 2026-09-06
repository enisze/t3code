import type {
  EnvironmentId,
  ProjectScript,
  ProjectScriptIcon,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import {
  ChevronUp,
  Eraser,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "~/lib/utils";
import type { TerminalContextSelection } from "~/lib/terminalContext";
import { TASK_SHELL_TERMINAL_ID, taskTerminalId } from "~/projectScripts";
import { terminalEnvironment } from "~/state/terminal";
import { useKnownTerminalSessions, useThreadRunningTerminalIds } from "~/state/terminalSessions";
import { useAtomCommand } from "~/state/use-atom-command";
import { TerminalViewport } from "~/components/ThreadTerminalDrawer";
import {
  ProjectScriptDialog,
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
  type ProjectScriptDraft,
} from "~/components/ProjectScriptDialog";
import { ScriptIcon } from "~/components/projectScriptIcons";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

/** Fixed tab ids — Setup/Run are always present regardless of scripts. */
const TAB_SETUP = "__setup__";
const TAB_RUN = "__run__";

const DEFAULT_TASK_COLS = 120;
const DEFAULT_TASK_ROWS = 30;

const COLLAPSED_STORAGE_KEY = "t3code:tasks-dock-collapsed";
const HEIGHT_STORAGE_KEY = "t3code:tasks-dock-height";
const ACTIVE_TAB_STORAGE_KEY = "t3code:tasks-dock-active-tab";
const MIN_BODY_HEIGHT = 140;
const DEFAULT_BODY_HEIGHT = 280;

function maxBodyHeight(): number {
  const viewport = typeof window === "undefined" ? 900 : window.innerHeight;
  return Math.max(MIN_BODY_HEIGHT, Math.floor(viewport * 0.7));
}

function clampBodyHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_BODY_HEIGHT;
  return Math.min(Math.max(Math.round(height), MIN_BODY_HEIGHT), maxBodyHeight());
}

function readStoredHeight(): number {
  if (typeof window === "undefined") return DEFAULT_BODY_HEIGHT;
  const raw = window.localStorage.getItem(HEIGHT_STORAGE_KEY);
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return clampBodyHeight(Number.isNaN(parsed) ? DEFAULT_BODY_HEIGHT : parsed);
}

function readStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
}

// Restore the last-opened tab so the dock resumes where it was left, rather
// than snapping back to Setup on every mount. Defaults to the Run tab.
function readStoredActiveTab(): string {
  if (typeof window === "undefined") return TAB_RUN;
  return window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY) ?? TAB_RUN;
}

const runShortcutLabel = () =>
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac")
    ? "⌘R"
    : "Ctrl+R";

type TabKind = "setup" | "run" | "custom" | "shell";

interface DockTab {
  id: string;
  label: string;
  kind: TabKind;
  icon: ProjectScriptIcon;
  /** Backing project script, or null for an unconfigured Setup/Run slot or the shell. */
  script: ProjectScript | null;
  terminalId: string;
}

interface TasksDockProps {
  threadRef: ScopedThreadRef;
  threadId: ThreadId;
  environmentId: EnvironmentId;
  scripts: ReadonlyArray<ProjectScript>;
  /** Absolute workspace root of the active project (used to build the run env). */
  workspaceRoot: string;
  /** Where task terminals launch — thread worktree if present, else the project root. */
  launchContext: { readonly cwd: string; readonly worktreePath?: string | null } | null;
  /**
   * Whether the thread's worktree is known. Terminals hold off opening until it
   * is, so a new chat's shell isn't stranded in the main repo root (the server
   * never re-roots a running session).
   */
  worktreeReady: boolean;
  keybindings: ResolvedKeybindingsConfig;
  focusRequestId: number;
  onAddScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
}

export default function TasksDock({
  threadRef,
  threadId,
  environmentId,
  scripts,
  keybindings,
  workspaceRoot,
  launchContext,
  worktreeReady,
  focusRequestId,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
  onAddTerminalContext,
}: TasksDockProps) {
  const [activeTabId, setActiveTabId] = useState<string>(readStoredActiveTab);
  // Terminal ids started this mount — lets the viewport render optimistically the
  // moment we launch, before the metadata subscription reflects the session.
  const [startedTerminalIds, setStartedTerminalIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Plain-shell terminal tabs. The first is always the base shell; the "+" adds
  // more, and each can be closed.
  const [shellIds, setShellIds] = useState<string[]>(() => [TASK_SHELL_TERMINAL_ID]);
  const [runError, setRunError] = useState<string | null>(null);
  // When Run is pressed but setup hasn't finished, we run setup first and defer
  // the run script until setup exits. `sawSetupRunningRef` guards against firing
  // the run before we've actually observed setup start.
  const [pendingRunAfterSetup, setPendingRunAfterSetup] = useState(false);
  const sawSetupRunningRef = useRef(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingScript, setEditingScript] = useState<ProjectScript | null>(null);
  const [dialogDraft, setDialogDraft] = useState<ProjectScriptDraft | null>(null);
  const [resizeEpoch, setResizeEpoch] = useState(0);
  const [collapsed, setCollapsed] = useState<boolean>(readStoredCollapsed);
  const [bodyHeight, setBodyHeight] = useState<number>(readStoredHeight);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const knownSessions = useKnownTerminalSessions({ environmentId, threadId });
  const knownTerminalIds = useMemo(
    () => new Set(knownSessions.map((session) => session.target.terminalId)),
    [knownSessions],
  );
  const runningTerminalIds = useThreadRunningTerminalIds({ environmentId, threadId });
  const runningSet = useMemo(() => new Set(runningTerminalIds), [runningTerminalIds]);

  const cwd = launchContext?.cwd ?? workspaceRoot;
  const worktreePath = launchContext?.worktreePath ?? null;
  const runtimeEnv = useMemo(
    () => projectScriptRuntimeEnv({ project: { cwd: workspaceRoot }, worktreePath }),
    [workspaceRoot, worktreePath],
  );

  const openTerminal = useAtomCommand(terminalEnvironment.open, "tasks terminal open");
  const writeTerminal = useAtomCommand(terminalEnvironment.write, "tasks terminal write");
  const restartTerminal = useAtomCommand(terminalEnvironment.restart, "tasks terminal restart");
  const clearTerminal = useAtomCommand(terminalEnvironment.clear, "tasks terminal clear");
  const closeTerminalCmd = useAtomCommand(terminalEnvironment.close, "tasks terminal close");

  // Map scripts onto the fixed Setup/Run slots plus any extra custom scripts.
  const setupScript = useMemo(
    () => scripts.find((script) => script.runOnWorktreeCreate) ?? null,
    [scripts],
  );
  const runScriptEntry = useMemo(
    () => scripts.find((script) => !script.runOnWorktreeCreate) ?? null,
    [scripts],
  );
  const customScripts = useMemo(
    () =>
      scripts.filter((script) => script.id !== setupScript?.id && script.id !== runScriptEntry?.id),
    [scripts, setupScript, runScriptEntry],
  );

  // Setup can run from two places: the dock's own task terminal, or the server's
  // create-time runner (`setup-<id>`). Treat either as the setup terminal so a
  // worktree that already installed on creation doesn't re-run setup on Run.
  const setupTerminalId = setupScript ? taskTerminalId(setupScript.id) : null;
  const serverSetupTerminalId = setupScript ? `setup-${setupScript.id}` : null;
  const setupRunning =
    (setupTerminalId !== null && runningSet.has(setupTerminalId)) ||
    (serverSetupTerminalId !== null && runningSet.has(serverSetupTerminalId));
  const setupEverStarted =
    (setupTerminalId !== null &&
      (knownTerminalIds.has(setupTerminalId) || startedTerminalIds.has(setupTerminalId))) ||
    (serverSetupTerminalId !== null && knownTerminalIds.has(serverSetupTerminalId));
  // Setup is "settled" (no need to run it) when there's no setup script, or it
  // has run before and isn't currently running.
  const setupSettled = setupScript === null || (setupEverStarted && !setupRunning);

  const tabs = useMemo<DockTab[]>(() => {
    const taskTabs: DockTab[] = [
      {
        id: TAB_SETUP,
        label: "Setup",
        kind: "setup",
        icon: setupScript?.icon ?? "configure",
        script: setupScript,
        terminalId: setupScript ? taskTerminalId(setupScript.id) : `${TAB_SETUP}:none`,
      },
      {
        id: TAB_RUN,
        label: "Run",
        kind: "run",
        icon: runScriptEntry?.icon ?? "play",
        script: runScriptEntry,
        terminalId: runScriptEntry ? taskTerminalId(runScriptEntry.id) : `${TAB_RUN}:none`,
      },
      ...customScripts.map<DockTab>((script) => ({
        id: script.id,
        label: script.name,
        kind: "custom",
        icon: script.icon,
        script,
        terminalId: taskTerminalId(script.id),
      })),
      ...shellIds.map<DockTab>((terminalId, index) => ({
        id: terminalId,
        label: index === 0 ? "Terminal" : `Terminal ${index + 1}`,
        kind: "shell",
        icon: "play",
        script: null,
        terminalId,
      })),
    ];
    return taskTabs;
  }, [setupScript, runScriptEntry, customScripts, shellIds]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]!,
    [tabs, activeTabId],
  );
  const activeScript = activeTab.script;
  const activeIsShell = activeTab.kind === "shell";
  const activeTerminalId = activeIsShell
    ? activeTab.terminalId
    : activeScript
      ? taskTerminalId(activeScript.id)
      : null;
  /** Short label used in run-button/empty-state copy: "setup", "run", or the script name. */
  const activeVerb =
    activeTab.kind === "setup" ? "setup" : activeTab.kind === "run" ? "run" : activeTab.label;

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
    }
  }, [collapsed]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTabId);
    }
  }, [activeTabId]);

  // Keep the active tab valid as scripts/terminals change (e.g. a closed
  // terminal tab); fall back to the Run tab when it disappears.
  useEffect(() => {
    if (tabs.some((tab) => tab.id === activeTabId)) return;
    setActiveTabId(TAB_RUN);
  }, [activeTabId, tabs]);

  // Refit the terminal whenever the dock body resizes.
  useEffect(() => {
    const node = bodyRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setResizeEpoch((value) => value + 1));
    observer.observe(node);
    return () => observer.disconnect();
  }, [collapsed]);

  const markStarted = useCallback((terminalId: string) => {
    setStartedTerminalIds((current) => {
      if (current.has(terminalId)) return current;
      const next = new Set(current);
      next.add(terminalId);
      return next;
    });
  }, []);

  const surfaceFailure = useCallback(<A, E>(result: AtomCommandResult<A, E>, fallback: string) => {
    if (result._tag !== "Failure") {
      setRunError(null);
      return true;
    }
    if (isAtomCommandInterrupted(result)) return false;
    const error = squashAtomCommandFailure(result);
    setRunError(error instanceof Error ? error.message : fallback);
    return false;
  }, []);

  const openShell = useCallback(
    async (terminalId: string) => {
      markStarted(terminalId);
      const result = await openTerminal({
        environmentId,
        input: {
          threadId,
          terminalId,
          cwd,
          ...(worktreePath !== null ? { worktreePath } : {}),
          env: runtimeEnv,
        },
      });
      surfaceFailure(result, "Failed to open terminal.");
    },
    [
      cwd,
      environmentId,
      markStarted,
      openTerminal,
      runtimeEnv,
      surfaceFailure,
      threadId,
      worktreePath,
    ],
  );

  const runTask = useCallback(
    async (script: ProjectScript, options?: { restart?: boolean }) => {
      const terminalId = taskTerminalId(script.id);
      markStarted(terminalId);
      setCollapsed(false);
      const opened = options?.restart
        ? await restartTerminal({
            environmentId,
            input: {
              threadId,
              terminalId,
              cwd,
              ...(worktreePath !== null ? { worktreePath } : {}),
              cols: DEFAULT_TASK_COLS,
              rows: DEFAULT_TASK_ROWS,
              env: runtimeEnv,
            },
          })
        : await openTerminal({
            environmentId,
            input: {
              threadId,
              terminalId,
              cwd,
              ...(worktreePath !== null ? { worktreePath } : {}),
              env: runtimeEnv,
            },
          });
      if (!surfaceFailure(opened, `Failed to run "${script.name}".`)) return;
      const written = await writeTerminal({
        environmentId,
        input: { threadId, terminalId, data: `${script.command}\r` },
      });
      surfaceFailure(written, `Failed to run "${script.name}".`);
    },
    [
      cwd,
      environmentId,
      markStarted,
      openTerminal,
      restartTerminal,
      runtimeEnv,
      surfaceFailure,
      threadId,
      worktreePath,
      writeTerminal,
    ],
  );

  // A plain shell auto-opens when its tab is active and the dock is expanded —
  // but only once the worktree is known, so it isn't stranded in the main repo.
  useEffect(() => {
    if (collapsed || !activeIsShell || !worktreeReady) return;
    const terminalId = activeTab.terminalId;
    if (knownTerminalIds.has(terminalId) || startedTerminalIds.has(terminalId)) return;
    void openShell(terminalId);
  }, [
    activeIsShell,
    activeTab,
    collapsed,
    knownTerminalIds,
    openShell,
    startedTerminalIds,
    worktreeReady,
  ]);

  // Open a new plain-shell terminal in its own tab.
  const addTerminalTab = useCallback(() => {
    const used = new Set(shellIds);
    let suffix = 2;
    while (used.has(`${TASK_SHELL_TERMINAL_ID}-${suffix}`)) suffix += 1;
    const terminalId = `${TASK_SHELL_TERMINAL_ID}-${suffix}`;
    setShellIds((current) => [...current, terminalId]);
    setActiveTabId(terminalId);
    setCollapsed(false);
  }, [shellIds]);

  // Close a terminal tab: drop it, move focus to a neighbour, and kill the
  // server session (dropping its scrollback).
  const closeTerminalTab = useCallback(
    (terminalId: string) => {
      setShellIds((current) => current.filter((id) => id !== terminalId));
      setStartedTerminalIds((current) => {
        if (!current.has(terminalId)) return current;
        const next = new Set(current);
        next.delete(terminalId);
        return next;
      });
      setActiveTabId((current) => {
        if (current !== terminalId) return current;
        const remaining = shellIds.filter((id) => id !== terminalId);
        return remaining.at(-1) ?? TAB_RUN;
      });
      void closeTerminalCmd({
        environmentId,
        input: { threadId, terminalId, deleteHistory: true },
      });
    },
    [closeTerminalCmd, environmentId, shellIds, threadId],
  );

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (collapsed) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = { startY: event.clientY, startHeight: bodyHeight };
  };
  const onResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    setBodyHeight(clampBodyHeight(drag.startHeight + (drag.startY - event.clientY)));
  };
  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(bodyHeight));
    }
  };

  // Open the add/edit dialog. Setup/Run slots seed a sensible name + flag so the
  // first save lands in the right slot; a custom script opens in edit mode.
  const openConfigureDialog = useCallback((tab: DockTab) => {
    setCollapsed(false);
    if (tab.script) {
      setEditingScript(tab.script);
      setDialogDraft(null);
    } else if (tab.kind === "setup") {
      setEditingScript(null);
      setDialogDraft({
        name: "Setup",
        command: "",
        icon: "configure",
        runOnWorktreeCreate: true,
        previewUrl: "",
        autoOpenPreview: false,
      });
    } else {
      setEditingScript(null);
      setDialogDraft({
        name: "Run",
        command: "",
        icon: "play",
        runOnWorktreeCreate: false,
        previewUrl: "",
        autoOpenPreview: false,
      });
    }
    setDialogOpen(true);
  }, []);

  // Ctrl-C the script's terminal to stop a running command (e.g. a dev server).
  const stopTask = useCallback(
    async (script: ProjectScript) => {
      const written = await writeTerminal({
        environmentId,
        input: { threadId, terminalId: taskTerminalId(script.id), data: "\x03" },
      });
      surfaceFailure(written, `Failed to stop "${script.name}".`);
    },
    [environmentId, surfaceFailure, threadId, writeTerminal],
  );

  // Run the run script, first running setup if it hasn't run yet. Setup output
  // shows in the Setup tab; once it exits, the run script fires automatically.
  const runRunTab = useCallback(async () => {
    if (!runScriptEntry) return;
    if (setupSettled) {
      await runTask(runScriptEntry);
      return;
    }
    setActiveTabId(TAB_SETUP);
    setCollapsed(false);
    sawSetupRunningRef.current = false;
    setPendingRunAfterSetup(true);
    if (setupScript && !setupRunning) {
      await runTask(setupScript);
    }
  }, [runScriptEntry, runTask, setupRunning, setupScript, setupSettled]);

  // Start the active tab's script — the Run tab routes through setup-then-run.
  const startActive = useCallback(() => {
    if (!activeScript) return;
    if (activeTab.kind === "run") void runRunTab();
    else void runTask(activeScript);
  }, [activeScript, activeTab, runRunTab, runTask]);

  const activeRunning =
    activeScript !== null && activeTerminalId !== null && runningSet.has(activeTerminalId);

  const handlePrimary = useCallback(() => {
    if (activeIsShell) return;
    if (!activeScript) {
      openConfigureDialog(activeTab);
      return;
    }
    if (activeTerminalId !== null && runningSet.has(activeTerminalId)) {
      // Stopping setup cancels the deferred run that would otherwise auto-start.
      if (setupScript && activeScript.id === setupScript.id) {
        setPendingRunAfterSetup(false);
        sawSetupRunningRef.current = false;
      }
      void stopTask(activeScript);
      return;
    }
    startActive();
  }, [
    activeIsShell,
    activeScript,
    activeTab,
    activeTerminalId,
    openConfigureDialog,
    runningSet,
    setupScript,
    startActive,
    stopTask,
  ]);

  // Sequencing: once the deferred setup run finishes, launch the run script.
  useEffect(() => {
    if (!pendingRunAfterSetup) return;
    if (!runScriptEntry) {
      setPendingRunAfterSetup(false);
      return;
    }
    if (setupRunning) {
      sawSetupRunningRef.current = true;
      return;
    }
    // Setup isn't running now — only proceed once we've seen it actually start,
    // so we don't fire before the setup process has spawned.
    if (!sawSetupRunningRef.current) return;
    setPendingRunAfterSetup(false);
    sawSetupRunningRef.current = false;
    setActiveTabId(TAB_RUN);
    void runTask(runScriptEntry);
  }, [pendingRunAfterSetup, runScriptEntry, runTask, setupRunning]);

  // Fallback for setups that finish before we observe them running (e.g. a
  // trivial command): proceed to the run script after a short grace period.
  useEffect(() => {
    if (!pendingRunAfterSetup) return;
    const timer = setTimeout(() => {
      if (sawSetupRunningRef.current || !runScriptEntry) return;
      setPendingRunAfterSetup(false);
      setActiveTabId(TAB_RUN);
      void runTask(runScriptEntry);
    }, 5000);
    return () => clearTimeout(timer);
  }, [pendingRunAfterSetup, runScriptEntry, runTask]);

  // ⌘R / Ctrl+R runs the active task while the dock is mounted and expanded.
  useEffect(() => {
    if (!activeScript || collapsed) return;
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "r") return;
      event.preventDefault();
      startActive();
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [activeScript, collapsed, startActive]);

  const shortcut = runShortcutLabel();
  const activeTerminalStarted =
    activeTerminalId !== null &&
    (knownTerminalIds.has(activeTerminalId) || startedTerminalIds.has(activeTerminalId));

  return (
    <Collapsible
      open={!collapsed}
      onOpenChange={(open) => setCollapsed(!open)}
      className="flex shrink-0 flex-col border-t border-border/60 bg-background"
    >
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          className="group h-1.5 shrink-0 cursor-ns-resize"
        >
          <div className="mx-auto mt-0.5 h-0.5 w-8 rounded-full bg-border/70 group-hover:bg-border" />
        </div>
      )}

      <div className="flex h-9 items-center gap-1 px-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <CollapsibleTrigger
                aria-label={collapsed ? "Expand run panel" : "Collapse run panel"}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              />
            }
          >
            <ChevronUp className={cn("size-4 transition-transform", !collapsed && "rotate-180")} />
          </TooltipTrigger>
          <TooltipPopup side="top">{collapsed ? "Expand" : "Collapse"}</TooltipPopup>
        </Tooltip>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = !collapsed && tab.id === activeTab.id;
            const running = runningSet.has(tab.terminalId);
            const closable = tab.kind === "shell";
            const icon =
              tab.kind === "shell" ? (
                <TerminalSquare className="size-3.5 shrink-0" />
              ) : (
                <ScriptIcon icon={tab.icon} className="size-3.5 shrink-0" />
              );
            return (
              <div
                key={tab.id}
                data-active-tab={active}
                className={cn(
                  "group flex h-7 shrink-0 items-center gap-1.5 rounded-md pl-2 text-sm",
                  closable ? "pr-1" : "pr-2",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveTabId(tab.id);
                    setCollapsed(false);
                  }}
                  className="flex min-w-0 items-center gap-1.5"
                >
                  {icon}
                  <span className="max-w-32 truncate">{tab.label}</span>
                  {running && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-emerald-500"
                      aria-label="Running"
                    />
                  )}
                </button>
                {closable && (
                  <button
                    type="button"
                    aria-label={`Close ${tab.label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTerminalTab(tab.terminalId);
                    }}
                    className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            );
          })}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={addTerminalTab}
                  aria-label="New terminal"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                />
              }
            >
              <Plus className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="top">New terminal</TooltipPopup>
          </Tooltip>
        </div>

        {!activeIsShell && (
          <div className="flex shrink-0 items-center">
            <Button
              size="xs"
              variant="outline"
              className={activeScript ? "rounded-e-none" : undefined}
              onClick={handlePrimary}
              aria-label={
                !activeScript
                  ? `Configure ${activeVerb}`
                  : activeRunning
                    ? `Stop ${activeVerb}`
                    : `Run ${activeVerb}`
              }
            >
              {!activeScript ? (
                <>
                  <Plus className="size-3.5" />
                  <span>Configure</span>
                </>
              ) : activeRunning ? (
                <>
                  <Square className="size-3.5" />
                  <span>Stop</span>
                </>
              ) : (
                <>
                  <Play className="size-3.5" />
                  <span>Run</span>
                  <kbd className="ml-1 text-[10px] text-muted-foreground">{shortcut}</kbd>
                </>
              )}
            </Button>
            {activeScript && (
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="outline"
                      className="rounded-s-none border-s-0"
                      aria-label="Task run options"
                    />
                  }
                >
                  <ChevronUp className="size-4 rotate-180" />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuItem onClick={() => void runTask(activeScript, { restart: true })}>
                    <RotateCcw className="size-4" />
                    Restart
                  </MenuItem>
                  <MenuItem
                    onClick={() =>
                      void writeTerminal({
                        environmentId,
                        input: {
                          threadId,
                          terminalId: taskTerminalId(activeScript.id),
                          // Ctrl-C interrupts the running command.
                          data: "\x03",
                        },
                      })
                    }
                  >
                    <Square className="size-4" />
                    Stop
                  </MenuItem>
                  <MenuItem
                    onClick={() =>
                      void clearTerminal({
                        environmentId,
                        input: { threadId, terminalId: taskTerminalId(activeScript.id) },
                      })
                    }
                  >
                    <Eraser className="size-4" />
                    Clear
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem onClick={() => openConfigureDialog(activeTab)}>
                    <Pencil className="size-4" />
                    Edit task
                  </MenuItem>
                </MenuPopup>
              </Menu>
            )}
          </div>
        )}
      </div>

      <CollapsibleContent>
        {runError && (
          <p className="border-t border-border/60 px-3 py-1.5 text-xs text-destructive">
            {runError}
          </p>
        )}
        <div
          ref={bodyRef}
          className="relative min-h-0 bg-background p-1.5"
          style={{ height: `${bodyHeight}px` }}
        >
          {activeTerminalId !== null && activeTerminalStarted ? (
            <TerminalViewport
              key={activeTerminalId}
              threadRef={threadRef}
              threadId={threadId}
              terminalId={activeTerminalId}
              terminalLabel={activeScript?.name ?? activeTab.label}
              cwd={cwd}
              worktreePath={worktreePath}
              runtimeEnv={runtimeEnv}
              onSessionExited={() => undefined}
              onAddTerminalContext={onAddTerminalContext}
              focusRequestId={focusRequestId}
              autoFocus
              resizeEpoch={resizeEpoch}
              drawerHeight={bodyHeight}
              keybindings={keybindings}
            />
          ) : activeScript ? (
            <TaskEmptyState
              title={`No ${activeVerb} output`}
              description={`${capitalize(activeVerb)} output will appear here after you run it.`}
              actionLabel={`Run ${activeVerb}`}
              actionIcon={<Play className="size-4" />}
              shortcut={shortcut}
              onAction={startActive}
            />
          ) : (
            <TaskEmptyState
              title={`No ${activeVerb} command yet`}
              description={
                activeTab.kind === "setup"
                  ? "Add a command to install dependencies or prepare this project (e.g. pnpm install)."
                  : "Add a command to run this project (e.g. pnpm dev)."
              }
              actionLabel={`Set ${activeVerb} command`}
              actionIcon={<Plus className="size-4" />}
              onAction={() => openConfigureDialog(activeTab)}
            />
          )}
        </div>
      </CollapsibleContent>

      <ProjectScriptDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingScript={editingScript}
        existingScriptIds={scripts.map((script) => script.id)}
        keybindings={keybindings}
        initialDraft={dialogDraft}
        onAddScript={onAddScript}
        onUpdateScript={onUpdateScript}
        onDeleteScript={onDeleteScript}
      />
    </Collapsible>
  );
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

function TaskEmptyState({
  title,
  description,
  actionLabel,
  actionIcon,
  shortcut,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  actionIcon: ReactNode;
  shortcut?: string;
  onAction: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <Button size="sm" onClick={onAction}>
        {actionIcon}
        {actionLabel}
        {shortcut && <kbd className="ml-1 text-[10px] opacity-80">{shortcut}</kbd>}
      </Button>
    </div>
  );
}
