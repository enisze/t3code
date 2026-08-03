import type {
  EnvironmentId,
  ProjectScript,
  ResolvedKeybindingsConfig,
  ScopedThreadRef,
  T3ProjectFileScript,
  ThreadId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import {
  ChevronDown,
  Eraser,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Square,
  TerminalSquare,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
} from "~/components/ProjectScriptDialog";
import { ScriptIcon } from "~/components/projectScriptIcons";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

/** Sentinel tab id for the plain shell tab (not backed by a project script). */
const SHELL_TAB_ID = "__shell__";

const DEFAULT_TASK_COLS = 120;
const DEFAULT_TASK_ROWS = 30;

const runShortcutLabel = () =>
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac")
    ? "⌘R"
    : "Ctrl+R";

interface TasksPanelProps {
  threadRef: ScopedThreadRef;
  threadId: ThreadId;
  environmentId: EnvironmentId;
  scripts: ReadonlyArray<ProjectScript>;
  fileScripts?: ReadonlyArray<T3ProjectFileScript>;
  /** Absolute workspace root of the active project (used to build the run env). */
  workspaceRoot: string;
  /** Where task terminals launch — thread worktree if present, else the project root. */
  launchContext: { readonly cwd: string; readonly worktreePath?: string | null } | null;
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

export default function TasksPanel({
  threadRef,
  threadId,
  environmentId,
  scripts,
  keybindings,
  workspaceRoot,
  launchContext,
  focusRequestId,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
  onAddTerminalContext,
}: TasksPanelProps) {
  const [activeTabId, setActiveTabId] = useState<string>(() => scripts[0]?.id ?? SHELL_TAB_ID);
  // Terminal ids we've started this mount — lets the viewport render optimistically
  // the moment we launch, before the metadata subscription reflects the session.
  const [startedTerminalIds, setStartedTerminalIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [runError, setRunError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingScript, setEditingScript] = useState<ProjectScript | null>(null);
  const [resizeEpoch, setResizeEpoch] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

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
    () =>
      projectScriptRuntimeEnv({
        project: { cwd: workspaceRoot },
        worktreePath,
      }),
    [workspaceRoot, worktreePath],
  );

  const openTerminal = useAtomCommand(terminalEnvironment.open, "tasks terminal open");
  const writeTerminal = useAtomCommand(terminalEnvironment.write, "tasks terminal write");
  const restartTerminal = useAtomCommand(terminalEnvironment.restart, "tasks terminal restart");
  const clearTerminal = useAtomCommand(terminalEnvironment.clear, "tasks terminal clear");

  // Keep the active tab valid as scripts change (rename keeps id; delete falls back).
  useEffect(() => {
    if (activeTabId === SHELL_TAB_ID) return;
    if (scripts.some((script) => script.id === activeTabId)) return;
    setActiveTabId(scripts[0]?.id ?? SHELL_TAB_ID);
  }, [activeTabId, scripts]);

  // Refit the terminal whenever the panel body resizes.
  useEffect(() => {
    const node = bodyRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setResizeEpoch((value) => value + 1));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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

  const runScript = useCallback(
    async (script: ProjectScript, options?: { restart?: boolean }) => {
      const terminalId = taskTerminalId(script.id);
      markStarted(terminalId);
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

  const activeScript = useMemo(
    () =>
      activeTabId === SHELL_TAB_ID ? null : (scripts.find((s) => s.id === activeTabId) ?? null),
    [activeTabId, scripts],
  );
  const activeTerminalId =
    activeTabId === SHELL_TAB_ID
      ? TASK_SHELL_TERMINAL_ID
      : activeScript
        ? taskTerminalId(activeScript.id)
        : null;

  // The plain shell auto-opens when its tab is active (a shell runs nothing on
  // its own). Task tabs stay idle until the user presses Run.
  useEffect(() => {
    if (activeTabId !== SHELL_TAB_ID) return;
    if (knownTerminalIds.has(TASK_SHELL_TERMINAL_ID)) return;
    if (startedTerminalIds.has(TASK_SHELL_TERMINAL_ID)) return;
    void openShell(TASK_SHELL_TERMINAL_ID);
  }, [activeTabId, knownTerminalIds, openShell, startedTerminalIds]);

  // ⌘R / Ctrl+R runs the active task while the Run panel is mounted.
  useEffect(() => {
    if (!activeScript) return;
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "r") return;
      event.preventDefault();
      void runScript(activeScript);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [activeScript, runScript]);

  const openEditDialog = (script: ProjectScript) => {
    setEditingScript(script);
    setDialogOpen(true);
  };
  const openAddDialog = () => {
    setEditingScript(null);
    setDialogOpen(true);
  };

  const shortcut = runShortcutLabel();
  const activeTerminalStarted =
    activeTerminalId !== null &&
    (knownTerminalIds.has(activeTerminalId) || startedTerminalIds.has(activeTerminalId));

  const tabButton = (tabId: string, label: string, icon: ReactNode, terminalId: string) => {
    const active = tabId === activeTabId;
    const running = runningSet.has(terminalId);
    return (
      <button
        key={tabId}
        type="button"
        data-active-tab={active}
        onClick={() => setActiveTabId(tabId)}
        className={cn(
          "group flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm",
          active
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        {icon}
        <span className="max-w-32 truncate">{label}</span>
        {running && (
          <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-label="Running" />
        )}
      </button>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="surface-subheader flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {scripts.map((script) =>
            tabButton(
              script.id,
              script.name,
              <ScriptIcon icon={script.icon} className="size-3.5 shrink-0" />,
              taskTerminalId(script.id),
            ),
          )}
          {tabButton(
            SHELL_TAB_ID,
            "Terminal",
            <TerminalSquare className="size-3.5 shrink-0" />,
            TASK_SHELL_TERMINAL_ID,
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={openAddDialog}
                  aria-label="Add task"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                />
              }
            >
              <Plus className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Add task</TooltipPopup>
          </Tooltip>
        </div>

        {activeScript ? (
          <div className="flex shrink-0 items-center">
            <Button
              size="xs"
              variant="outline"
              className="rounded-e-none"
              onClick={() => void runScript(activeScript)}
              aria-label={`Run ${activeScript.name}`}
            >
              <Play className="size-3.5" />
              <span>Run</span>
              <kbd className="ml-1 text-[10px] text-muted-foreground">{shortcut}</kbd>
            </Button>
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
                <ChevronDown className="size-4" />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem onClick={() => void runScript(activeScript, { restart: true })}>
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
                <MenuItem onClick={() => openEditDialog(activeScript)}>
                  <Pencil className="size-4" />
                  Edit task
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        ) : null}
      </div>

      {runError && (
        <p className="border-b border-border/60 px-3 py-1.5 text-xs text-destructive">{runError}</p>
      )}

      <div ref={bodyRef} className="relative min-h-0 flex-1 bg-background p-1.5">
        {activeTerminalId === null ? null : activeTerminalStarted ? (
          <TerminalViewport
            key={activeTerminalId}
            threadRef={threadRef}
            threadId={threadId}
            terminalId={activeTerminalId}
            terminalLabel={activeScript?.name ?? "Terminal"}
            cwd={cwd}
            worktreePath={worktreePath}
            runtimeEnv={runtimeEnv}
            onSessionExited={() => undefined}
            onAddTerminalContext={onAddTerminalContext}
            focusRequestId={focusRequestId}
            autoFocus
            resizeEpoch={resizeEpoch}
            drawerHeight={bodyRef.current?.clientHeight ?? 0}
            keybindings={keybindings}
          />
        ) : (
          <TaskIdleState
            script={activeScript}
            shortcut={shortcut}
            onRun={() => activeScript && void runScript(activeScript)}
            onAdd={openAddDialog}
          />
        )}
      </div>

      <ProjectScriptDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingScript={editingScript}
        existingScriptIds={scripts.map((script) => script.id)}
        keybindings={keybindings}
        onAddScript={onAddScript}
        onUpdateScript={onUpdateScript}
        onDeleteScript={onDeleteScript}
      />
    </div>
  );
}

function TaskIdleState({
  script,
  shortcut,
  onRun,
  onAdd,
}: {
  script: ProjectScript | null;
  shortcut: string;
  onRun: () => void;
  onAdd: () => void;
}) {
  if (!script) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <TerminalSquare className="size-6 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">No tasks yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a setup script (e.g. <code>pnpm install</code>) and a run script (e.g.{" "}
            <code>pnpm dev</code>) for this project.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="size-4" />
          Add task
        </Button>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <ScriptIcon icon={script.icon} className="size-6 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium text-foreground">{script.name}</p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{script.command}</p>
      </div>
      <Button size="sm" onClick={onRun}>
        <Play className="size-4" />
        Run
        <kbd className="ml-1 text-[10px] opacity-80">{shortcut}</kbd>
      </Button>
    </div>
  );
}
