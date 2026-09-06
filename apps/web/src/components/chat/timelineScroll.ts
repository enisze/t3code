// The timeline either tracks the live edge (so a streaming response stays
// pinned just above the composer) or is parked wherever the user scrolled to.
export type TimelineScrollMode = "following-end" | "free-scrolling";

// Breathing room kept below the last row when deciding whether the real
// content already overflows the visible viewport.
export const TIMELINE_END_SLACK = 16;

export interface TimelineListMeasurementState {
  readonly data: readonly unknown[];
  readonly scroll: number;
  readonly scrollLength: number;
  readonly positionAtIndex: (index: number) => number | undefined;
  readonly sizeAtIndex: (index: number) => number | undefined;
}

export function getRowBottom(state: TimelineListMeasurementState, index: number): number | null {
  const top = state.positionAtIndex(index);
  const height = state.sizeAtIndex(index);
  if (
    typeof top !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(top) ||
    !Number.isFinite(height)
  ) {
    return null;
  }

  return top + Math.max(1, height);
}

// True when the last measured row already reaches past the visible bottom of
// the list, i.e. following the end actually moves the viewport.
export function timelineContentOverflowsViewport({
  state,
  composerOverlayHeight,
}: {
  readonly state: TimelineListMeasurementState;
  readonly composerOverlayHeight: number;
}): boolean {
  if (state.data.length === 0) {
    return false;
  }

  const contentBottom = getRowBottom(state, state.data.length - 1);
  if (contentBottom === null) {
    return false;
  }

  const visibleScrollLength = Math.max(
    0,
    (state.scrollLength ?? 0) - composerOverlayHeight - TIMELINE_END_SLACK,
  );
  return contentBottom > visibleScrollLength;
}
