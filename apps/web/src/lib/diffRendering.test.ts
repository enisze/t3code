import { describe, expect, it } from "vite-plus/test";
import { parseDiffFromFile } from "@pierre/diffs";
import {
  buildFileDiffContentSignature,
  buildFileDiffRenderKey,
  buildPatchCacheKey,
  getDiffLineStat,
  getRenderablePatch,
  makeFullContextPatchExpandable,
} from "./diffRendering";
import { buildDiffViewedSignature } from "./diffViewedSignature";

describe("buildPatchCacheKey", () => {
  it("returns a stable cache key for identical content", () => {
    const patch = "diff --git a/a.ts b/a.ts\n+console.log('hello')";

    expect(buildPatchCacheKey(patch)).toBe(buildPatchCacheKey(patch));
  });

  it("normalizes outer whitespace before hashing", () => {
    const patch = "diff --git a/a.ts b/a.ts\n+console.log('hello')";

    expect(buildPatchCacheKey(`\n${patch}\n`)).toBe(buildPatchCacheKey(patch));
  });

  it("changes when diff content changes", () => {
    const before = "diff --git a/a.ts b/a.ts\n+console.log('hello')";
    const after = "diff --git a/a.ts b/a.ts\n+console.log('hello world')";

    expect(buildPatchCacheKey(before)).not.toBe(buildPatchCacheKey(after));
  });

  it("changes when cache scope changes", () => {
    const patch = "diff --git a/a.ts b/a.ts\n+console.log('hello')";

    expect(buildPatchCacheKey(patch, "diff-panel:light")).not.toBe(
      buildPatchCacheKey(patch, "diff-panel:dark"),
    );
  });
});

describe("getRenderablePatch", () => {
  it("rebuilds full-context patches with independently expandable gaps", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}\n`);
    const before = lines.join("");
    const afterLines = [...lines];
    afterLines[2] = "changed near top\n";
    afterLines[26] = "changed near bottom\n";
    const full = makeFullContextPatchExpandable(
      parseDiffFromFile(
        { name: "example.ts", contents: before },
        { name: "example.ts", contents: afterLines.join("") },
        { context: Number.MAX_SAFE_INTEGER },
      ),
    );

    expect(full.isPartial).toBe(false);
    expect(full.hunks).toHaveLength(2);
    expect(full.hunks[1]?.collapsedBefore).toBeGreaterThan(0);
  });

  it("preserves viewed identity and line stats across a full-context rebuild", () => {
    const beforeLines = Array.from({ length: 100 }, (_, index) => `line ${index + 1}\n`);
    const afterLines = [...beforeLines];
    afterLines.splice(30, 1);
    afterLines.splice(82, 1, "changed near bottom\n", "added near bottom\n");
    const before = beforeLines.join("");
    const after = afterLines.join("");
    const compact = {
      ...parseDiffFromFile(
        { name: "example.ts", contents: before },
        { name: "example.ts", contents: after },
        { context: 3 },
      ),
      mode: "100644",
    };
    const full = {
      ...parseDiffFromFile(
        { name: "example.ts", contents: before },
        { name: "example.ts", contents: after },
        { context: Number.MAX_SAFE_INTEGER },
      ),
      mode: "100644",
    };
    const rebuilt = makeFullContextPatchExpandable(full);

    expect(rebuilt.mode).toBe("100644");
    expect(buildDiffViewedSignature(rebuilt)).toBe(buildDiffViewedSignature(compact));
    expect(getDiffLineStat([rebuilt])).toEqual(getDiffLineStat([compact]));
    expect(getDiffLineStat([rebuilt])).toEqual({ additions: 2, deletions: 2 });
  });

  it("compacts partial hunk render offsets for virtualized review diffs", () => {
    const patch = [
      "diff --git a/example.ts b/example.ts",
      "index 1111111..2222222 100644",
      "--- a/example.ts",
      "+++ b/example.ts",
      "@@ -48,4 +48,4 @@",
      " context",
      "-before",
      "+after",
      " context",
      " context",
      "@@ -80,3 +80,4 @@",
      " context",
      "+added",
      " context",
      " context",
    ].join("\n");

    const parsed = getRenderablePatch(patch, "review", {
      compactPartialHunkOffsets: true,
    });
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") return;

    const file = parsed.files[0];
    expect(file?.hunks[0]?.collapsedBefore).toBe(47);
    expect(file?.hunks[0]?.unifiedLineStart).toBe(0);
    expect(file?.hunks[1]?.collapsedBefore).toBeGreaterThan(0);
    expect(file?.hunks[1]?.unifiedLineStart).toBe(file?.hunks[0]?.unifiedLineCount);
    expect(file?.unifiedLineCount).toBe(
      file?.hunks.reduce((total, hunk) => total + hunk.unifiedLineCount, 0),
    );
  });

  it("retains source-file offsets for checkpoint diffs", () => {
    const patch = [
      "diff --git a/example.ts b/example.ts",
      "--- a/example.ts",
      "+++ b/example.ts",
      "@@ -48,1 +48,1 @@",
      "-before",
      "+after",
    ].join("\n");

    const parsed = getRenderablePatch(patch, "checkpoint");
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") return;
    expect(parsed.files[0]?.hunks[0]?.unifiedLineStart).toBe(47);
  });
});

describe("buildFileDiffContentSignature", () => {
  const patchWith = (aBody: string[], bBody: string[]) =>
    [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      `@@ -1,${aBody.length} +1,${aBody.length} @@`,
      ...aBody,
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      `@@ -1,${bBody.length} +1,${bBody.length} @@`,
      ...bBody,
    ].join("\n");

  const filesFrom = (patch: string) => {
    const parsed = getRenderablePatch(patch);
    if (parsed?.kind !== "files") throw new Error("expected files");
    return parsed.files;
  };

  it("stays stable for a file when a different file in the patch changes", () => {
    const before = filesFrom(patchWith(["-alpha", "+beta"], ["-one", "+two"]));
    const after = filesFrom(patchWith(["-alpha", "+beta"], ["-one", "+three"]));

    // a.ts is unchanged between the two patches, so both its content signature
    // and virtualized item identity must remain stable.
    expect(buildFileDiffContentSignature(after[0]!)).toBe(
      buildFileDiffContentSignature(before[0]!),
    );
    expect(buildFileDiffRenderKey(after[0]!)).toBe(buildFileDiffRenderKey(before[0]!));

    // b.ts changed, so its signature must move.
    expect(buildFileDiffContentSignature(after[1]!)).not.toBe(
      buildFileDiffContentSignature(before[1]!),
    );
  });

  it("changes when the file's own content changes", () => {
    const before = filesFrom(patchWith(["-alpha", "+beta"], ["-one", "+two"]));
    const after = filesFrom(patchWith(["-alpha", "+gamma"], ["-one", "+two"]));

    expect(buildFileDiffContentSignature(after[0]!)).not.toBe(
      buildFileDiffContentSignature(before[0]!),
    );
    expect(buildFileDiffRenderKey(after[0]!)).toBe(buildFileDiffRenderKey(before[0]!));
  });
});

describe("getDiffLineStat", () => {
  it("totals additions and deletions across every file and hunk", () => {
    const patch = [
      "diff --git a/example.ts b/example.ts",
      "--- a/example.ts",
      "+++ b/example.ts",
      "@@ -1,2 +1,3 @@",
      "-before",
      "+after",
      "+added",
      " context",
      "@@ -10,2 +11,1 @@",
      "-removed",
      " context",
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1,2 @@",
      " title",
      "+description",
    ].join("\n");

    const parsed = getRenderablePatch(patch);
    expect(parsed?.kind).toBe("files");
    if (parsed?.kind !== "files") return;

    expect(getDiffLineStat(parsed.files)).toEqual({ additions: 3, deletions: 2 });
  });
});
