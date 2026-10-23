import { describe, expect, it } from "vite-plus/test";

import { countThreadSearchOccurrences, findThreadSearchOccurrences } from "./threadSearch.ts";

describe("thread search occurrences", () => {
  it("matches case-insensitively without overlapping matches", () => {
    expect(findThreadSearchOccurrences("Find FIND find", "find")).toEqual([0, 5, 10]);
    expect(countThreadSearchOccurrences("aaaa", "aa")).toBe(2);
  });

  it("treats Greek final sigma like sigma", () => {
    expect(countThreadSearchOccurrences("ΟΔΟΣ οδος", "οδος")).toBe(2);
  });

  it("keeps offsets in the original text when lowercasing changes a character's length", () => {
    // "İ" lowercases to two code units; it stays as written so the next offset is still exact.
    expect(findThreadSearchOccurrences("İstanbul find", "find")).toEqual([9]);
  });

  it("finds nothing in empty text or for an empty query", () => {
    expect(countThreadSearchOccurrences("", "find")).toBe(0);
    expect(countThreadSearchOccurrences("find", "")).toBe(0);
  });
});
