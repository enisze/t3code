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

// Live follow is "armed" whenever the timeline should chase the live edge. It
// is armed on send, thread open and the scroll-to-end pill, and disarmed by the
// first user scroll gesture — so an armed report that the edge left the
// viewport is the content growing, not the user walking away from it.
export interface TimelineLiveFollowInput {
  readonly armed: boolean;
  readonly isAtEnd: boolean;
  readonly wasAtEnd: boolean;
}

export interface TimelineLiveFollowOutcome {
  // null leaves the current mode alone.
  readonly mode: TimelineScrollMode | null;
  readonly pill: "hide" | "show" | "keep";
}

export function resolveTimelineLiveFollow({
  armed,
  isAtEnd,
  wasAtEnd,
}: TimelineLiveFollowInput): TimelineLiveFollowOutcome {
  // Re-follow on every at-end report, not just the transition: a gesture that
  // disarmed follow without ever leaving the edge has to be picked back up.
  if (isAtEnd) {
    return { mode: "following-end", pill: "hide" };
  }
  if (armed) {
    return { mode: null, pill: "hide" };
  }
  return wasAtEnd ? { mode: "free-scrolling", pill: "show" } : { mode: null, pill: "keep" };
}
