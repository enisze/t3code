import type { ResizableWidthHandlers } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

interface Props {
  handlers: ResizableWidthHandlers;
  className?: string;
}

/**
 * Hit target for resizing a right-anchored panel via its left edge.
 *
 * - Sits on the panel's border and extends only inward. Overlapping the
 *   content to the left would steal clicks from its scrollbar (e.g. the diff
 *   view's vertical scrollbar sits flush against this edge).
 * - Visual indicator is a 1px line that lights up on hover/active to mirror
 *   VS Code / Cursor.
 */
export function RightPanelResizeHandle({ handlers, className }: Props) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={cn(
        "group absolute inset-y-0 -left-px z-30 w-2 cursor-col-resize touch-none select-none",
        className,
      )}
      {...handlers}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-px bg-border/40 transition-colors duration-150 group-hover:bg-border group-active:bg-primary/60"
      />
    </div>
  );
}
