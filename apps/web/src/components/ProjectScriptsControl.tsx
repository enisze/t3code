import type {
  ProjectScript,
  ResolvedKeybindingsConfig,
  T3ProjectFileScript,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ChevronDownIcon, DownloadIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { commandForProjectScript, primaryProjectScript } from "~/projectScripts";
import { shortcutLabelForCommand } from "~/keybindings";
import {
  ProjectScriptDialog,
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
  type ProjectScriptDraft,
} from "./ProjectScriptDialog";
import { ScriptIcon } from "./projectScriptIcons";
import { Button } from "./ui/button";
import { Group, GroupSeparator } from "./ui/group";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export type { NewProjectScriptInput, ProjectScriptActionResult } from "./ProjectScriptDialog";

const NO_FILE_SCRIPTS: ReadonlyArray<T3ProjectFileScript> = [];

interface ProjectScriptsControlProps {
  scripts: ReadonlyArray<ProjectScript>;
  /** Scripts declared in the project's checked-in t3.json, offered for import. */
  fileScripts?: ReadonlyArray<T3ProjectFileScript>;
  keybindings: ResolvedKeybindingsConfig;
  preferredScriptId?: string | null;
  onRunScript: (script: ProjectScript) => void;
  onAddScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

export default function ProjectScriptsControl({
  scripts,
  fileScripts = NO_FILE_SCRIPTS,
  keybindings,
  preferredScriptId = null,
  onRunScript,
  onAddScript,
  onUpdateScript,
  onDeleteScript,
}: ProjectScriptsControlProps) {
  const [actionsMenuOpen, setActionsMenuOpen] = useState({
    scripts: false,
    imports: false,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingScript, setEditingScript] = useState<ProjectScript | null>(null);
  const [importDraft, setImportDraft] = useState<ProjectScriptDraft | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const primaryScript = useMemo(() => {
    if (preferredScriptId) {
      const preferred = scripts.find((script) => script.id === preferredScriptId);
      if (preferred) return preferred;
    }
    return primaryProjectScript(scripts);
  }, [preferredScriptId, scripts]);
  const importableScripts = useMemo(
    () =>
      fileScripts.filter(
        (fileScript) =>
          !scripts.some(
            (script) =>
              script.command === fileScript.command ||
              script.name.toLowerCase() === fileScript.name.toLowerCase(),
          ),
      ),
    [fileScripts, scripts],
  );
  const dropdownItemClassName =
    "data-highlighted:bg-transparent data-highlighted:text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground data-highlighted:hover:bg-accent data-highlighted:hover:text-accent-foreground data-highlighted:focus-visible:bg-accent data-highlighted:focus-visible:text-accent-foreground";

  const openAddDialog = () => {
    setEditingScript(null);
    setImportDraft(null);
    setImportError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (script: ProjectScript) => {
    setActionsMenuOpen({ scripts: false, imports: false });
    setEditingScript(script);
    setImportDraft(null);
    setImportError(null);
    setDialogOpen(true);
  };

  const importFileScript = async (fileScript: T3ProjectFileScript) => {
    const payload: NewProjectScriptInput = {
      name: fileScript.name,
      command: fileScript.command,
      icon: fileScript.icon ?? "play",
      runOnWorktreeCreate: fileScript.runOnWorktreeCreate ?? false,
      keybinding: null,
      previewUrl: fileScript.previewUrl ?? null,
      autoOpenPreview: fileScript.previewUrl ? (fileScript.autoOpenPreview ?? false) : false,
    };
    const result = await onAddScript(payload);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      // Surface the failure through the regular add dialog, prefilled so the
      // user can adjust and retry.
      const error = squashAtomCommandFailure(result);
      setEditingScript(null);
      setImportDraft({
        name: payload.name,
        command: payload.command,
        icon: payload.icon,
        runOnWorktreeCreate: payload.runOnWorktreeCreate,
        previewUrl: payload.previewUrl ?? "",
        autoOpenPreview: payload.autoOpenPreview,
      });
      setImportError(error instanceof Error ? error.message : "Failed to import action.");
      setDialogOpen(true);
    }
  };

  const importMenuItems = importableScripts.length > 0 && (
    <>
      {primaryScript && <MenuSeparator />}
      <MenuGroup>
        <MenuGroupLabel>From t3.json</MenuGroupLabel>
        {importableScripts.map((fileScript) => (
          <MenuItem
            key={`${fileScript.name} ${fileScript.command}`}
            className={dropdownItemClassName}
            onClick={() => void importFileScript(fileScript)}
          >
            <ScriptIcon icon={fileScript.icon ?? "play"} className="size-4" />
            <span className="truncate">{fileScript.name}</span>
            <MenuShortcut className="ms-auto">
              <DownloadIcon className="size-3.5" aria-label="Import" />
            </MenuShortcut>
          </MenuItem>
        ))}
      </MenuGroup>
    </>
  );

  return (
    <>
      {primaryScript ? (
        <Group aria-label="Project scripts">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant="outline"
                  aria-label={`Run ${primaryScript.name}`}
                  onClick={() => onRunScript(primaryScript)}
                />
              }
            >
              <ScriptIcon icon={primaryScript.icon} />
              <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
                {primaryScript.name}
              </span>
            </TooltipTrigger>
            <TooltipPopup side="top">Run {primaryScript.name}</TooltipPopup>
          </Tooltip>
          <GroupSeparator className="hidden @3xl/header-actions:block" />
          <Menu
            highlightItemOnHover={false}
            open={actionsMenuOpen.scripts}
            onOpenChange={(open) => setActionsMenuOpen({ scripts: open, imports: false })}
          >
            <MenuTrigger
              render={<Button size="icon-xs" variant="outline" aria-label="Script actions" />}
            >
              <ChevronDownIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              {scripts.map((script) => {
                const shortcutLabel = shortcutLabelForCommand(
                  keybindings,
                  commandForProjectScript(script.id),
                );
                return (
                  <MenuItem
                    key={script.id}
                    className={`group ${dropdownItemClassName}`}
                    onClick={() => onRunScript(script)}
                  >
                    <ScriptIcon icon={script.icon} className="size-4" />
                    <span className="truncate">
                      {script.runOnWorktreeCreate ? `${script.name} (setup)` : script.name}
                    </span>
                    <span className="relative ms-auto flex h-6 min-w-6 items-center justify-end">
                      {shortcutLabel && (
                        <MenuShortcut className="ms-0 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                          {shortcutLabel}
                        </MenuShortcut>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute right-0 top-1/2 size-6 -translate-y-1/2 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-visible:opacity-100 group-focus-visible:pointer-events-auto"
                        aria-label={`Edit ${script.name}`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openEditDialog(script);
                        }}
                      >
                        <SettingsIcon className="size-3.5" />
                      </Button>
                    </span>
                  </MenuItem>
                );
              })}
              {importMenuItems}
              <MenuItem className={dropdownItemClassName} onClick={openAddDialog}>
                <PlusIcon className="size-4" />
                Add action
              </MenuItem>
            </MenuPopup>
          </Menu>
        </Group>
      ) : importableScripts.length > 0 ? (
        <Menu
          highlightItemOnHover={false}
          open={actionsMenuOpen.imports}
          onOpenChange={(open) => setActionsMenuOpen({ scripts: false, imports: open })}
        >
          <MenuTrigger render={<Button size="xs" variant="outline" aria-label="Project actions" />}>
            <PlusIcon className="size-3.5" />
            <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
              Add action
            </span>
            <ChevronDownIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end">
            {importMenuItems}
            <MenuItem className={dropdownItemClassName} onClick={openAddDialog}>
              <PlusIcon className="size-4" />
              Add action
            </MenuItem>
          </MenuPopup>
        </Menu>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button size="xs" variant="outline" aria-label="Add action" onClick={openAddDialog} />
            }
          >
            <PlusIcon className="size-3.5" />
            <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
              Add action
            </span>
          </TooltipTrigger>
          <TooltipPopup side="top">Add action</TooltipPopup>
        </Tooltip>
      )}

      <ProjectScriptDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingScript={editingScript}
        existingScriptIds={scripts.map((script) => script.id)}
        keybindings={keybindings}
        initialDraft={importDraft}
        initialError={importError}
        onAddScript={onAddScript}
        onUpdateScript={onUpdateScript}
        onDeleteScript={onDeleteScript}
      />
    </>
  );
}
