import type {
  EditorId,
  EnvironmentId,
  ProjectScript,
  ResolvedKeybindingsConfig,
  T3ProjectFileScript,
} from "@t3tools/contracts";
import { MoreHorizontalIcon } from "lucide-react";
import { memo } from "react";

import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { OpenInPicker } from "./OpenInPicker";

interface HeaderOverflowMenuProps {
  showOpenInPicker: boolean;
  openInPicker: {
    environmentId: EnvironmentId;
    keybindings: ResolvedKeybindingsConfig;
    availableEditors: ReadonlyArray<EditorId>;
    openInCwd: string | null;
  };
  projectScripts: {
    scripts: ReadonlyArray<ProjectScript>;
    fileScripts: ReadonlyArray<T3ProjectFileScript>;
    keybindings: ResolvedKeybindingsConfig;
    preferredScriptId: string | null;
    onRunScript: (script: ProjectScript) => void;
    onAddScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
    onUpdateScript: (
      scriptId: string,
      input: NewProjectScriptInput,
    ) => Promise<ProjectScriptActionResult>;
    onDeleteScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
  } | null;
}

// Collapses the "Open in editor" and project-action ("Add action") controls
// behind a single "…" trigger so the header keeps its horizontal space for the
// project/thread identity. The controls render unchanged inside the panel, so
// their own dropdowns and add/edit dialogs keep working.
export const HeaderOverflowMenu = memo(function HeaderOverflowMenu({
  showOpenInPicker,
  openInPicker,
  projectScripts,
}: HeaderOverflowMenuProps) {
  if (!showOpenInPicker && !projectScripts) return null;
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={<Button aria-label="More actions" size="icon-xs" variant="outline" />}
            >
              <MoreHorizontalIcon aria-hidden="true" className="size-4" />
            </PopoverTrigger>
          }
        />
        <TooltipPopup side="top">More actions</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="end" className="min-w-56" viewportClassName="p-2">
        <div className="flex flex-col gap-3">
          {showOpenInPicker && (
            <div className="flex flex-col gap-1.5">
              <span className="px-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Open in editor
              </span>
              <OpenInPicker
                environmentId={openInPicker.environmentId}
                keybindings={openInPicker.keybindings}
                availableEditors={openInPicker.availableEditors}
                openInCwd={openInPicker.openInCwd}
              />
            </div>
          )}
          {projectScripts && (
            <div className="flex flex-col gap-1.5">
              <span className="px-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Actions
              </span>
              <div className="flex items-center">
                <ProjectScriptsControl
                  scripts={projectScripts.scripts}
                  fileScripts={projectScripts.fileScripts}
                  keybindings={projectScripts.keybindings}
                  preferredScriptId={projectScripts.preferredScriptId}
                  onRunScript={projectScripts.onRunScript}
                  onAddScript={projectScripts.onAddScript}
                  onUpdateScript={projectScripts.onUpdateScript}
                  onDeleteScript={projectScripts.onDeleteScript}
                />
              </div>
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
});
