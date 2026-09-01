/**
 * Global cursor/selection lock held for the duration of a pointer drag.
 *
 * A resize drag has to override the cursor for the whole document, otherwise
 * the cursor flickers to whatever the pointer happens to fly over. Writing
 * `document.body.style.cursor` directly makes releasing it fragile: the last
 * drag to end wins, so an interleaved drag (or a release path that never runs)
 * leaves the page stuck showing a resize cursor.
 *
 * `lockDragCursor` hands back a release function instead. Releases are
 * ref-counted and idempotent, so callers can call them from every unwind path
 * — pointerup, pointercancel, lost capture, unmount — without stomping a lock
 * another drag still holds.
 *
 * The lock also marks the document with `data-drag-active`, which index.css
 * uses to stop nested renderers (Electron `<webview>`, iframes) from eating
 * the pointerup that ends the drag.
 */

const DRAG_ACTIVE_ATTRIBUTE = "data-drag-active";

interface ActiveLock {
  count: number;
  previousCursor: string;
  previousUserSelect: string;
}

let activeLock: ActiveLock | null = null;

export function lockDragCursor(cursor: string): () => void {
  if (typeof document === "undefined") return () => {};

  const body = document.body;
  if (activeLock === null) {
    activeLock = {
      count: 0,
      previousCursor: body.style.cursor,
      previousUserSelect: body.style.userSelect,
    };
  }
  activeLock.count += 1;
  body.style.cursor = cursor;
  body.style.userSelect = "none";
  document.documentElement.setAttribute(DRAG_ACTIVE_ATTRIBUTE, "");

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const lock = activeLock;
    if (!lock) return;
    lock.count -= 1;
    if (lock.count > 0) return;
    activeLock = null;
    document.documentElement.removeAttribute(DRAG_ACTIVE_ATTRIBUTE);
    // Restoring the pre-drag inline values (usually empty) keeps the lock
    // transparent to anything else that styled the body.
    if (lock.previousCursor) {
      body.style.cursor = lock.previousCursor;
    } else {
      body.style.removeProperty("cursor");
    }
    if (lock.previousUserSelect) {
      body.style.userSelect = lock.previousUserSelect;
    } else {
      body.style.removeProperty("user-select");
    }
  };
}
