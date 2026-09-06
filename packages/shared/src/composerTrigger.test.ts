import { describe, expect, it } from "vite-plus/test";

import {
  detectComposerTrigger,
  serializeComposerFileLink,
  serializeComposerMentionPath,
} from "./composerTrigger.ts";

describe("serializeComposerMentionPath", () => {
  it("keeps simple mention paths unquoted", () => {
    expect(serializeComposerMentionPath("src/index.ts")).toBe("src/index.ts");
  });

  it("quotes mention paths containing whitespace", () => {
    expect(serializeComposerMentionPath("docs/My File.md")).toBe('"docs/My File.md"');
  });

  it("escapes quoted mention path content", () => {
    expect(serializeComposerMentionPath('docs/My "File".md')).toBe('"docs/My \\"File\\".md"');
  });
});

describe("serializeComposerFileLink", () => {
  it("uses the basename as the markdown label", () => {
    expect(serializeComposerFileLink("path/to/package.json")).toBe(
      "[package.json](path/to/package.json)",
    );
  });

  it("encodes markdown-sensitive destination characters", () => {
    expect(serializeComposerFileLink("docs/My File (draft).md")).toBe(
      "[My File (draft).md](docs/My%20File%20%28draft%29.md)",
    );
  });

  it("supports windows paths", () => {
    expect(serializeComposerFileLink("C:\\repo\\src\\index.ts")).toBe(
      "[index.ts](C:%5Crepo%5Csrc%5Cindex.ts)",
    );
  });

  it("preserves paths that legitimately start with an at sign", () => {
    expect(serializeComposerFileLink("@scope/package.json")).toBe(
      "[package.json](@scope/package.json)",
    );
  });
});

describe("detectComposerTrigger slash commands", () => {
  const atEnd = (text: string) => detectComposerTrigger(text, text.length);

  it("opens the command menu for a slash starting the line", () => {
    expect(atEnd("/rev")).toEqual({
      kind: "slash-command",
      query: "rev",
      rangeStart: 0,
      rangeEnd: 4,
    });
  });

  it("opens the same menu for a slash mid-sentence", () => {
    const text = "please run /rev";
    expect(atEnd(text)).toEqual({
      kind: "slash-command",
      query: "rev",
      rangeStart: "please run ".length,
      rangeEnd: text.length,
    });
  });

  it("opens the menu for a bare slash mid-sentence", () => {
    const text = "now do /";
    expect(atEnd(text)).toEqual({
      kind: "slash-command",
      query: "",
      rangeStart: "now do ".length,
      rangeEnd: text.length,
    });
  });

  it("opens the menu after a newline inside a longer draft", () => {
    const text = "first line\nsecond /co";
    expect(atEnd(text)).toEqual({
      kind: "slash-command",
      query: "co",
      rangeStart: "first line\nsecond ".length,
      rangeEnd: text.length,
    });
  });

  it("ignores a slash inside a token so typing paths stays quiet", () => {
    expect(atEnd("src/mai")).toBeNull();
    expect(atEnd("see packages/shared/src")).toBeNull();
    expect(atEnd("https://example.com/do")).toBeNull();
  });

  it("treats /model as the model picker wherever it opens a token", () => {
    expect(atEnd("/model")).toEqual({
      kind: "slash-model",
      query: "",
      rangeStart: 0,
      rangeEnd: 6,
    });

    const text = "switch /model";
    expect(atEnd(text)).toEqual({
      kind: "slash-model",
      query: "",
      rangeStart: "switch ".length,
      rangeEnd: text.length,
    });
  });

  it("keeps /model arguments line-anchored", () => {
    const text = "/model spark";
    expect(atEnd(text)).toEqual({
      kind: "slash-model",
      query: "spark",
      rangeStart: 0,
      rangeEnd: text.length,
    });

    // Mid-sentence the argument would swallow prose, so it stays inert.
    expect(atEnd("use /model spark")).toBeNull();
  });

  it("still detects $skill and @path tokens", () => {
    expect(atEnd("Use $gh-fi")).toEqual({
      kind: "skill",
      query: "gh-fi",
      rangeStart: "Use ".length,
      rangeEnd: "Use $gh-fi".length,
    });
    expect(atEnd("check @src/co")).toEqual({
      kind: "path",
      query: "src/co",
      rangeStart: "check ".length,
      rangeEnd: "check @src/co".length,
    });
  });
});
