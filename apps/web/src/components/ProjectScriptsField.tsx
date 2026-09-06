import { useMemo, useState } from "react";

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  KeybindingCommand,
  ProjectId,
  ProjectScript,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { PlusIcon, SettingsIcon } from "lucide-react";

import { decodeProjectScriptKeybindingRule } from "~/lib/projectScriptKeybindings";
import {
  appendProjectScript,
  commandForProjectScript,
  replaceProjectScript,
} from "~/projectScripts";
import { isElectron } from "../env";
import { useProject } from "../state/entities";
import { projectEnvironment } from "../state/projects";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import {
  ProjectScriptDialog,
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "./ProjectScriptDialog";
import { ScriptIcon } from "./projectScriptIcons";
import { Button } from "./ui/button";
import { stackedThreadToast, toastManager } from "./ui/toast";

const EMPTY_SCRIPTS: ReadonlyArray<ProjectScript> = [];

/**
 * Per-project "Actions" editor for the Project settings dialog. Lists the
 * project's setup/run scripts and lets you add, edit, or delete them, sharing
 * the same {@link ProjectScriptDialog} used by the top-bar Run control.
 *
 * Scripts are read live via {@link useProject} so the list stays current after
 * a mutation even though the enclosing settings dialog renders from a project
 * snapshot captured when it opened.
 */
export function ProjectScriptsField(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  keybindings: ResolvedKeybindingsConfig;
}) {
  const { environmentId, projectId, keybindings } = props;
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  const project = useProject(projectRef);
  const scripts = project?.scripts ?? EMPTY_SCRIPTS;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingScript, setEditingScript] = useState<ProjectScript | null>(null);

  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const upsertKeybinding = useAtomCommand(serverEnvironment.upsertKeybinding, {
    reportFailure: false,
  });

  const persist = async (input: {
    nextScripts: ReadonlyArray<ProjectScript>;
    keybinding?: string | null;
    keybindingCommand: KeybindingCommand;
  }): Promise<AtomCommandResult<void, unknown>> => {
    const updateResult = mapAtomCommandResult(
      await updateProject({ environmentId, input: { projectId, scripts: input.nextScripts } }),
      () => undefined,
    );
    if (updateResult._tag === "Failure") return updateResult;

    const keybindingRule = decodeProjectScriptKeybindingRule({
      keybinding: input.keybinding,
      command: input.keybindingCommand,
    });
    // Keybindings live on the primary desktop server, so only reconcile them
    // in Electron; remote environments persist the script without a shortcut.
    if (isElectron && keybindingRule) {
      return mapAtomCommandResult(
        await upsertKeybinding({ environmentId, input: keybindingRule }),
        () => undefined,
      );
    }
    return updateResult;
  };

  const handleAddScript = async (
    input: NewProjectScriptInput,
  ): Promise<ProjectScriptActionResult> => {
    const { scripts: nextScripts, script } = appendProjectScript(scripts, input);
    return persist({
      nextScripts,
      keybinding: input.keybinding,
      keybindingCommand: commandForProjectScript(script.id),
    });
  };

  const handleUpdateScript = async (
    scriptId: string,
    input: NewProjectScriptInput,
  ): Promise<ProjectScriptActionResult> => {
    const nextScripts = replaceProjectScript(scripts, scriptId, input);
    if (!nextScripts) {
      return AsyncResult.failure(Cause.fail(new Error("Script not found.")));
    }
    return persist({
      nextScripts,
      keybinding: input.keybinding,
      keybindingCommand: commandForProjectScript(scriptId),
    });
  };

  const handleDeleteScript = async (scriptId: string): Promise<ProjectScriptActionResult> => {
    const deletedName = scripts.find((script) => script.id === scriptId)?.name;
    const nextScripts = scripts.filter((script) => script.id !== scriptId);
    const result = await persist({
      nextScripts,
      keybinding: null,
      keybindingCommand: commandForProjectScript(scriptId),
    });
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: `Deleted action "${deletedName ?? "Unknown"}"` });
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not delete action",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      );
    }
    return result;
  };

  const openAddDialog = () => {
    setEditingScript(null);
    setDialogOpen(true);
  };

  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">Setup &amp; run scripts</span>
        <Button size="xs" variant="outline" onClick={openAddDialog}>
          <PlusIcon className="size-3.5" />
          Add action
        </Button>
      </div>
      {scripts.length > 0 ? (
        <ul className="grid gap-1.5">
          {scripts.map((script) => (
            <li key={script.id}>
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-left text-sm hover:bg-accent/60 dark:border-transparent dark:bg-white/[0.035]"
                aria-label={`Edit ${script.name}`}
                onClick={() => {
                  setEditingScript(script);
                  setDialogOpen(true);
                }}
              >
                <ScriptIcon icon={script.icon} className="size-4 shrink-0 opacity-70" />
                <span className="min-w-0 shrink-0 truncate">{script.name}</span>
                {script.runOnWorktreeCreate ? (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    setup
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-right font-mono text-xs text-muted-foreground">
                  {script.command}
                </span>
                <SettingsIcon className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Add scripts to launch this project. Scripts marked to run on worktree creation act as
          setup scripts; the rest run on demand from the top bar or a keybinding.
        </p>
      )}
      <ProjectScriptDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingScript={editingScript}
        existingScriptIds={scripts.map((script) => script.id)}
        keybindings={keybindings}
        onAddScript={handleAddScript}
        onUpdateScript={handleUpdateScript}
        onDeleteScript={handleDeleteScript}
      />
    </div>
  );
}
