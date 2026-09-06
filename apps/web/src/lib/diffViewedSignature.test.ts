import { parseDiffFromFile } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import { buildDiffViewedSignature } from "./diffViewedSignature";

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
