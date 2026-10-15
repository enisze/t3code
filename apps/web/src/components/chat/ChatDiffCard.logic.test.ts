import { describe, expect, it } from "vite-plus/test";

import { filterChatDiffFiles } from "./ChatDiffCard.logic";

const files = ["src/app.ts", "src/lib/util.ts", "src/library.ts", "README.md"];
const identity = (path: string) => path;

describe("filterChatDiffFiles", () => {
  it("keeps every file without a filter", () => {
    expect(filterChatDiffFiles(files, identity, undefined)).toEqual(files);
    expect(filterChatDiffFiles(files, identity, [" "])).toEqual(files);
  });

  it("matches exact files and whole directories, not name prefixes", () => {
    expect(filterChatDiffFiles(files, identity, ["src/lib"])).toEqual(["src/lib/util.ts"]);
    expect(filterChatDiffFiles(files, identity, ["./README.md", "src/lib/"])).toEqual([
      "src/lib/util.ts",
      "README.md",
    ]);
  });
});
