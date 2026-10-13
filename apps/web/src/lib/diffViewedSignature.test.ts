import { parseDiffFromFile } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import { buildDiffViewedSignature, buildDiffViewedSignatures } from "./diffViewedSignature";

/** Git's patch removing two imports and the blank line between them. */
const gitImportRemovalPatch = (trailingContextLines: number) => {
  const tail = Array.from(
    { length: trailingContextLines },
    (_, index) => ` export const v${index + 1} = ${index + 1};`,
  );
  return [
    "diff --git a/example.ts b/example.ts",
    "index fdc83b1..28ef9f7 100644",
    "--- a/example.ts",
    "+++ b/example.ts",
    `@@ -1,${6 + tail.length} +1,${3 + tail.length} @@`,
    ' import { a } from "a";',
    '-import { b } from "b";',
    "-",
    '-import { c } from "c";',
    " ",
    " export const value = 1;",
    ...tail,
  ].join("\n");
};

const fileVersions = (changedLine: string) => {
  const beforeLines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
  const afterLines = beforeLines.with(6, changedLine);
  return {
    before: `${beforeLines.join("\n")}\n`,
    after: `${afterLines.join("\n")}\n`,
  };
};

describe("buildDiffViewedSignature", () => {
  it("stays stable when the same change switches between compact and full context", () => {
    const { before, after } = fileVersions("line seven changed");
    const compact = parseDiffFromFile(
      { name: "a.ts", contents: before },
      { name: "a.ts", contents: after },
      { context: 3 },
    );
    const full = parseDiffFromFile(
      { name: "a.ts", contents: before },
      { name: "a.ts", contents: after },
      { context: Infinity },
    );

    expect(buildDiffViewedSignature(full)).toBe(buildDiffViewedSignature(compact));
  });

  it("changes when the file is edited again", () => {
    const first = fileVersions("line seven changed");
    const second = fileVersions("line seven changed again");
    const firstDiff = parseDiffFromFile(
      { name: "a.ts", contents: first.before },
      { name: "a.ts", contents: first.after },
      { context: 3 },
    );
    const secondDiff = parseDiffFromFile(
      { name: "a.ts", contents: second.before },
      { name: "a.ts", contents: second.after },
      { context: 3 },
    );

    expect(buildDiffViewedSignature(secondDiff)).not.toBe(buildDiffViewedSignature(firstDiff));
  });
});

describe("buildDiffViewedSignatures", () => {
  it("signs a file the same from Git's compact and full-context patches", () => {
    // The navigator gets the compact patch and the file view the full-context
    // one. Re-diffing this full file client-side keeps a different blank line
    // than Git did, so both views must sign Git's patches to agree.
    const compact = buildDiffViewedSignatures(gitImportRemovalPatch(1));
    const fullContext = buildDiffViewedSignatures(gitImportRemovalPatch(8));

    expect(compact.get("example.ts")).toBeDefined();
    expect(fullContext).toEqual(compact);
  });
});
