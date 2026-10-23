import { describe, expect, it } from "vite-plus/test";

import { buildTurnDiffTree } from "../../lib/turnDiffTree";
import {
  type ChangedFileRow,
  CHANGED_FILES_VIRTUALIZE_AFTER_FILES,
  collectExpandedRows,
  shouldVirtualizeChangedFileRows,
  visibleRowRange,
} from "./changedFilesPresentation";

const file = (path: string) => ({ path, kind: "modified", additions: 1, deletions: 0 });
const labels = (rows: ReadonlyArray<ChangedFileRow>) =>
  rows.map(({ node, depth }) => `${"  ".repeat(depth)}${node.name}`);

describe("collectExpandedRows", () => {
  const tree = buildTurnDiffTree([
    file("README.md"),
    file("src/app/main.ts"),
    file("src/app/view.ts"),
    file("src/lib/util.ts"),
  ]);

  it("lists the rows of open folders in render order", () => {
    expect(labels(collectExpandedRows(tree, {}, false))).toEqual(["src", "README.md"]);
    expect(labels(collectExpandedRows(tree, {}, true))).toEqual([
      "src",
      "  app",
      "    main.ts",
      "    view.ts",
      "  lib",
      "    util.ts",
      "README.md",
    ]);
  });

  it("lets a folder's own toggle win over expand-all and collapse-all", () => {
    expect(labels(collectExpandedRows(tree, { "src/app": false }, true))).toEqual([
      "src",
      "  app",
      "  lib",
      "    util.ts",
      "README.md",
    ]);
    expect(labels(collectExpandedRows(tree, { src: true }, false))).toEqual([
      "src",
      "  app",
      "  lib",
      "README.md",
    ]);
  });
});

describe("shouldVirtualizeChangedFileRows", () => {
  const files = (count: number) =>
    Array.from({ length: count }, (_, index) => file(`src/file-${index}.ts`));

  it("virtualizes once more files are visible than the threshold", () => {
    const rows = (count: number) => collectExpandedRows(buildTurnDiffTree(files(count)), {}, true);
    expect(shouldVirtualizeChangedFileRows(rows(CHANGED_FILES_VIRTUALIZE_AFTER_FILES))).toBe(false);
    expect(shouldVirtualizeChangedFileRows(rows(CHANGED_FILES_VIRTUALIZE_AFTER_FILES + 1))).toBe(
      true,
    );
  });

  it("counts only files in open folders", () => {
    const tree = buildTurnDiffTree(files(16_000));
    expect(shouldVirtualizeChangedFileRows(collectExpandedRows(tree, {}, false))).toBe(false);
  });
});

describe("visibleRowRange", () => {
  const range = (listTop: number) =>
    visibleRowRange({
      listTop,
      viewportTop: 0,
      viewportHeight: 280,
      rowHeight: 26,
      rowCount: 16_000,
      overscan: 8,
    });

  it("mounts the rows in view plus the overscan", () => {
    // The list starts 100px into the viewport, so rows 0-6 show.
    expect(range(100)).toEqual({ start: 0, end: 15 });
    // Scrolled so row 8001 sits at the viewport top.
    expect(range(-8_001 * 26)).toEqual({ start: 7_993, end: 8_020 });
  });

  it("mounts nothing for a list entirely above or below the viewport", () => {
    expect(range(1_000)).toEqual({ start: 0, end: 0 });
    expect(range(-16_000 * 26 - 1_000)).toEqual({ start: 16_000, end: 16_000 });
  });
});
