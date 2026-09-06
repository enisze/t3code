import type { WorkspaceContentTabView } from "../workspaceContentTabsStore";
import { Toggle, ToggleGroup } from "./ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * Segmented toggle for the single file viewer: "Diff" shows the file's diff,
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
      className="shrink-0 gap-0 rounded-lg border border-border/70 bg-muted/35 p-0.5"
      variant="ghost"
      size="xs"
      value={[view === "file" ? "edit" : "diff"]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "diff") onChange("diff");
        else if (next === "edit") onChange("file");
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              aria-label="View diff"
              className="h-6 min-w-0 rounded-md px-2.5 text-xs data-pressed:bg-background/80"
              value="diff"
            >
              Diff
            </Toggle>
          }
        />
        <TooltipPopup side="top">Show the file's diff</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              aria-label="Edit file"
              className="h-6 min-w-0 rounded-md px-2.5 text-xs data-pressed:bg-background/80"
              value="edit"
            >
              Edit
            </Toggle>
          }
        />
        <TooltipPopup side="top">Edit the file contents</TooltipPopup>
      </Tooltip>
    </ToggleGroup>
  );
}
