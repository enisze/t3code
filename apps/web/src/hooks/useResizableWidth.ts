import * as Schema from "effect/Schema";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { lockDragCursor } from "~/lib/dragCursorLock";

import { getLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";

const WidthSchema = Schema.Finite;

export interface UseResizableWidthOptions {
  /** localStorage key the persisted width is stored under. */
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  /**
   * Which edge of the host element carries the drag handle:
   *   - "left"  → panel grows leftward (right-anchored panels)
   *   - "right" → panel grows rightward (left-anchored panels)
   */
  readonly edge: "left" | "right";
}

export interface ResizableWidthHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * Width state for a side-anchored panel resized via a drag handle on the
 * specified edge. Width is read from localStorage on mount and persisted on
 * drag-end (not on every rAF tick — would otherwise be ~60 writes/sec).
 *
 * The hook updates an internal `width` state during drag (so the panel
 * follows the cursor live) and only commits to localStorage when the user
 * lifts the pointer.
 *
 * The drag runs on window listeners rather than on the handle's own pointer
 * events. Pointer capture can be released out from under the handle (the
 * element unmounts, the browser drops the capture), and a handle that never
 * sees its own pointerup would leave the document stuck showing the resize
 * cursor. Window listeners plus the ref-counted cursor lock make every unwind
 * path — pointerup, cancel, lost capture, unmount — restore the cursor.
 */
export function useResizableWidth(options: UseResizableWidthOptions): {
  readonly width: number;
  readonly handlers: ResizableWidthHandlers;
} {
  const { storageKey, defaultWidth, minWidth, maxWidth, edge } = options;

  const clamp = useCallback(
    (value: number): number => {
      if (!Number.isFinite(value)) return defaultWidth;
      return Math.max(minWidth, Math.min(maxWidth, value));
    },
    [defaultWidth, maxWidth, minWidth],
  );

  // No cross-tab subscription: panel width is per-window state.
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return defaultWidth;
    try {
      const stored = getLocalStorageItem(storageKey, WidthSchema);
      return clamp(stored ?? defaultWidth);
    } catch (error) {
      console.error("Could not read persisted panel width.", error);
      return defaultWidth;
    }
  });

  const clampedWidth = clamp(width);

  /** Tears down the in-flight drag (listeners, capture, cursor lock). */
  const endDragRef = useRef<(() => void) | null>(null);

  useEffect(() => () => endDragRef.current?.(), []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      // A previous drag that never got its pointerup would otherwise keep its
      // listeners and cursor lock alive forever.
      endDragRef.current?.();

      const target = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = clampedWidth;
      let pending = startWidth;
      let rafId: number | null = null;

      const releaseCursor = lockDragCursor("col-resize");

      const endDrag = () => {
        if (endDragRef.current !== endDrag) return;
        endDragRef.current = null;
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        target.removeEventListener("lostpointercapture", onLostCapture);
        try {
          if (target.hasPointerCapture(pointerId)) {
            target.releasePointerCapture(pointerId);
          }
        } catch {
          // pointer may already be released; harmless.
        }
        releaseCursor();
      };

      function onMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();
        const delta = edge === "left" ? startX - moveEvent.clientX : moveEvent.clientX - startX;
        pending = clamp(startWidth + delta);
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          setWidth(pending);
        });
      }

      /** Ends the drag and commits the width reached so far. */
      function commit() {
        const finalWidth = clamp(pending);
        endDrag();
        // Commit once at drag-end to avoid 60Hz localStorage writes.
        try {
          setLocalStorageItem(storageKey, finalWidth, WidthSchema);
        } catch (error) {
          console.error("Could not persist panel width.", error);
        }
        setWidth(finalWidth);
      }

      function onUp(upEvent: PointerEvent) {
        if (upEvent.pointerId !== pointerId) return;
        commit();
      }

      function onCancel(cancelEvent: PointerEvent) {
        if (cancelEvent.pointerId !== pointerId) return;
        // Don't persist a cancelled drag; revert to the start width.
        endDrag();
        setWidth(startWidth);
      }

      // Capture loss the drag did not ask for (the handle unmounted, or the
      // browser dropped it) means no further pointer events are guaranteed:
      // settle on the width reached so far rather than holding the cursor
      // hostage waiting for a pointerup that will never arrive.
      function onLostCapture(lostEvent: Event) {
        if ((lostEvent as PointerEvent).pointerId !== pointerId) return;
        commit();
      }

      endDragRef.current = endDrag;
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // Window listeners below keep the drag functional without capture.
      }
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      target.addEventListener("lostpointercapture", onLostCapture);
    },
    [clamp, clampedWidth, edge, storageKey],
  );

  return {
    width: clampedWidth,
    handlers: { onPointerDown },
  };
}
