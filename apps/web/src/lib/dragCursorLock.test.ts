import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { lockDragCursor } from "./dragCursorLock";

/**
 * The lock only touches `document.body.style` and the root element's drag
 * attribute, so a style bag plus an attribute set is enough to observe every
 * unwind path.
 */
function stubDocument() {
  const style = {
    cursor: "",
    userSelect: "",
    removeProperty(property: string) {
      if (property === "cursor") style.cursor = "";
      if (property === "user-select") style.userSelect = "";
    },
  };
  const attributes = new Set<string>();
  const documentElement = {
    setAttribute: (name: string) => attributes.add(name),
    removeAttribute: (name: string) => attributes.delete(name),
  };
  vi.stubGlobal("document", { body: { style }, documentElement });
  return { style, attributes };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("drag cursor lock", () => {
  it("applies the cursor and clears it on release", () => {
    const { style, attributes } = stubDocument();
    const release = lockDragCursor("col-resize");
    expect(style.cursor).toBe("col-resize");
    expect(style.userSelect).toBe("none");
    expect(attributes.has("data-drag-active")).toBe(true);

    release();
    expect(style.cursor).toBe("");
    expect(style.userSelect).toBe("");
    expect(attributes.has("data-drag-active")).toBe(false);
  });

  it("ignores repeat releases so every unwind path can call it", () => {
    const { style } = stubDocument();
    const release = lockDragCursor("col-resize");
    release();
    const other = lockDragCursor("row-resize");
    // A stale release must not steal the cursor from the drag that came after.
    release();
    expect(style.cursor).toBe("row-resize");

    other();
    expect(style.cursor).toBe("");
  });

  it("keeps the cursor until the last overlapping drag releases", () => {
    const { style, attributes } = stubDocument();
    const first = lockDragCursor("col-resize");
    const second = lockDragCursor("col-resize");

    first();
    expect(style.cursor).toBe("col-resize");
    expect(attributes.has("data-drag-active")).toBe(true);

    second();
    expect(style.cursor).toBe("");
    expect(attributes.has("data-drag-active")).toBe(false);
  });

  it("restores a cursor the page had set before the drag", () => {
    const { style } = stubDocument();
    style.cursor = "progress";
    style.userSelect = "text";

    const release = lockDragCursor("col-resize");
    expect(style.cursor).toBe("col-resize");

    release();
    expect(style.cursor).toBe("progress");
    expect(style.userSelect).toBe("text");
  });
});
