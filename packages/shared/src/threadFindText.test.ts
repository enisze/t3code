import { describe, expect, it } from "vite-plus/test";

import {
  searchableAssistantMessageSegments,
  searchablePlanSegments,
  searchableUserMessageSegments,
} from "./threadFindText.ts";

const cwd = "/repo";

describe("searchableAssistantMessageSegments", () => {
  it("returns the visible text of each block, without Markdown syntax", () => {
    expect(
      searchableAssistantMessageSegments(
        [
          "# Plan",
          "",
          "Fix **re**connect and\nwrap `state` across [the docs](https://example.com/docs).",
          "",
          "- first item",
          "- second item",
          "",
          "```ts",
          "const a = 1;",
          "const b = 2;",
          "```",
        ].join("\n"),
        false,
        { cwd },
      ),
    ).toEqual([
      "Plan",
      // A soft line break shows as a space; emphasis and link syntax do not show.
      "Fix reconnect and wrap state across the docs.",
      "first item",
      "second item",
      "const a = 1;\nconst b = 2;\n",
    ]);
  });

  it("shows file links and file paths in code spans as their chip labels", () => {
    expect(
      searchableAssistantMessageSegments(
        "See [the view](apps/web/ChatView.tsx:12:3), `packages/a/index.ts`, and `packages/b/index.ts`, but not `node.meta`.",
        false,
        { cwd },
      ),
    ).toEqual([
      "See ChatView.tsx · L12:C3, index.ts · packages/a, and index.ts · packages/b, but not node.meta.",
    ]);
  });

  it("leaves relative links as text when there is no workspace to resolve them", () => {
    expect(searchableAssistantMessageSegments("See [the view](src/view.ts).", false)).toEqual([
      "See the view.",
    ]);
  });

  it("shows skill tokens in prose by their display names", () => {
    const skills = [{ name: "code-review", displayName: "Code Review" }];
    expect(
      searchableAssistantMessageSegments("Run $code-review now, not `$code-review`.", false, {
        cwd,
        skills,
      }),
    ).toEqual(["Run Code Review now, not $code-review."]);
  });

  it("indexes no text for images and task checkboxes", () => {
    // The space after the checkbox is part of the item's text in the DOM too.
    expect(
      searchableAssistantMessageSegments("![screenshot](shot.png)\n\n- [x] done", false, { cwd }),
    ).toEqual([" done"]);
  });

  it("leaves out math the client renders, and keeps it as text when it does not", () => {
    const text = "Energy is $E = mc^2$ here.\n\n$$\nx^2\n$$";
    expect(searchableAssistantMessageSegments(text, false, { math: true })).toEqual([
      "Energy is  here.",
    ]);
    expect(searchableAssistantMessageSegments(text, false)).toEqual([
      "Energy is $E = mc^2$ here.",
      "$$ x^2 $$",
    ]);
  });

  it("keeps a ```math fence as code while it streams, as the timeline shows it", () => {
    const text = "```math\nx^2\n```";
    expect(searchableAssistantMessageSegments(text, true, { math: true })).toEqual(["x^2\n"]);
    expect(searchableAssistantMessageSegments(text, false, { math: true })).toEqual([]);
  });

  it("does not search Mermaid diagrams", () => {
    expect(
      searchableAssistantMessageSegments("Flow:\n\n```mermaid\ngraph TD; A-->B\n```", false),
    ).toEqual(["Flow:"]);
  });

  it("reads an empty finished response as the placeholder the timeline shows", () => {
    expect(searchableAssistantMessageSegments("", false)).toEqual(["(empty response)"]);
    expect(searchableAssistantMessageSegments("", true)).toEqual([]);
  });
});

describe("searchableUserMessageSegments", () => {
  it("keeps line breaks as separate runs and drops attached context blocks", () => {
    const text = [
      "Check the login\nredirect",
      "",
      "<terminal_context>",
      "- Terminal 1 lines 3-4:",
      "  secret build output",
      "</terminal_context>",
      "",
      "<element_context>",
      "- button.submit:",
      "  <button>Hidden markup</button>",
      "</element_context>",
    ].join("\n");
    expect(searchableUserMessageSegments(text, { cwd })).toEqual(["Check the login", " redirect"]);
  });

  it("splits the prompt around inline terminal labels, which render as chips", () => {
    const text = [
      "Why does @terminal-1:3-4 fail?",
      "",
      "<terminal_context>",
      "- Terminal 1 lines 3-4:",
      "  error output",
      "</terminal_context>",
    ].join("\n");
    expect(searchableUserMessageSegments(text, { cwd })).toEqual(["Why does", "fail?"]);
  });

  it("searches the prose around review comments, not the comment cards", () => {
    const text = [
      "Please address these.",
      '<review_comment sectionId="s1" sectionTitle="Diff" filePath="src/a.ts" startIndex="1" endIndex="2" rangeLabel="lines 1-2">',
      "Rename this variable.",
      "```ts",
      "const a = 1;",
      "```",
      "</review_comment>",
      "Thanks!",
    ].join("\n");
    expect(searchableUserMessageSegments(text, { cwd })).toEqual([
      "Please address these.",
      "Thanks!",
    ]);
  });
});

describe("searchablePlanSegments", () => {
  it("returns the card title, then the body without its title heading", () => {
    expect(
      searchablePlanSegments("# Ship find\n\n## Summary\n\nRun $code-review first.", { cwd }),
    ).toEqual(["Ship find", "Run $code-review first."]);
  });

  it("falls back to the default card title", () => {
    expect(searchablePlanSegments("Just steps.")).toEqual(["Proposed plan", "Just steps."]);
  });
});
