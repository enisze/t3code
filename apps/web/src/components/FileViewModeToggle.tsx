import { EyeIcon, PencilIcon } from "lucide-react";

import type { WorkspaceContentTabView } from "../workspaceContentTabsStore";
import { Toggle, ToggleGroup } from "./ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * Segmented toggle for the single file viewer: "View" shows the file's diff,
 * "Edit" shows its editable contents. Rendered inside each viewer's own header
 * (DiffPanel / FilePreviewPanel) so the control stays in one place regardless
 * of which view is active.
 */
export function FileViewModeToggle(props: {
  view: WorkspaceContentTabView;
  onChange: (view: WorkspaceContentTabView) => void;
}) {
  const { view, onChange } = props;
  return (
    <ToggleGroup
      className="shrink-0"
      variant="outline"
      size="xs"
      value={[view === "file" ? "edit" : "view"]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "view") onChange("diff");
        else if (next === "edit") onChange("file");
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle aria-label="View diff" value="view">
              <EyeIcon className="size-3" />
              View
            </Toggle>
          }
        />
        <TooltipPopup side="top">Show the file's diff</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle aria-label="Edit file" value="edit">
              <PencilIcon className="size-3" />
              Edit
            </Toggle>
          }
        />
        <TooltipPopup side="top">Edit the file contents</TooltipPopup>
      </Tooltip>
    </ToggleGroup>
  );
}
