import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { type PluggableList, unified } from "unified";

import {
  CHAT_MARKDOWN_REHYPE_PLUGINS,
  CHAT_MARKDOWN_REMARK_PLUGINS,
  CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS,
  CHAT_MATH_REMARK_PLUGINS,
} from "./chatMarkdownPipeline.ts";
import {
  formatProviderSkillDisplayName,
  matchInlineSkills,
  type InlineSkill,
} from "./inlineSkills.ts";
import {
  buildFileLinkParentSuffixByPath,
  extractChatMarkdownLinkHrefs,
  extractInlineCodeSpans,
  type FilePathPosition,
  fileLinkLabel,
  inlineCodeFilePathCandidate,
  normalizeMarkdownLinkHrefKey,
  resolveMarkdownFileLinkTarget,
  rewriteMarkdownFileUriHref,
  splitFilePathPosition,
} from "./markdownLinks.ts";
import { mathKind } from "./markdownMath.ts";
import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "./proposedPlanText.ts";
import { parseReviewCommentMessageSegments } from "./reviewCommentMessage.ts";
import { THREAD_FIND_BLOCK_TAGS } from "./threadSearch.ts";
import {
  deriveDisplayedUserMessageState,
  extractTrailingElementContexts,
  extractTrailingPreviewAnnotation,
  formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from "./userMessageContexts.ts";

// Thread find counts matches on the server in the text the chat timeline
// shows, so its counts agree with the highlights the client paints. These
// mirror what the timeline renders for messages and plans. Chips and cards for
// attached context, images, code block chrome, rendered math, and diagrams are
// not searched.

export interface ThreadFindTextOptions {
  /** The workspace the chat resolves relative file links against. */
  readonly cwd?: string | undefined;
  /** Skills whose `$name` tokens render as chips with their display names. */
  readonly skills?: ReadonlyArray<InlineSkill> | undefined;
  /** Whether the client renders math, which then is not searched. */
  readonly math?: boolean | undefined;
}

interface HastNode {
  readonly type: string;
  readonly tagName?: string;
  readonly value?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly children?: ReadonlyArray<HastNode>;
}

// `react-markdown` parses chat Markdown with these plugins in this order; the
// math plugins come last when the client renders math.
const chatMarkdownProcessor = (remarkPlugins: PluggableList) =>
  unified()
    .use(remarkParse)
    .use(remarkPlugins)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(CHAT_MARKDOWN_REHYPE_PLUGINS);
const chatMarkdownProcessors = {
  plain: chatMarkdownProcessor(CHAT_MARKDOWN_REMARK_PLUGINS),
  breaks: chatMarkdownProcessor(CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS),
  math: chatMarkdownProcessor([...CHAT_MARKDOWN_REMARK_PLUGINS, ...CHAT_MATH_REMARK_PLUGINS]),
  breaksMath: chatMarkdownProcessor([
    ...CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS,
    ...CHAT_MATH_REMARK_PLUGINS,
  ]),
};

function classNameOf(node: HastNode | undefined): string | undefined {
  const className = node?.properties?.className;
  return Array.isArray(className) ? className.join(" ") : undefined;
}

/** The language chat Markdown reads from a code block's `language-*` class. */
function fenceLanguage(className: string | undefined): string | undefined {
  return className?.match(/(?:^|\s)language-([^\s]+)/)?.[1];
}

// `react-markdown`'s default URL transform, which chat Markdown applies to hrefs.
const SAFE_URL_PROTOCOL = /^(https?|ircs?|mailto|xmpp)$/i;
function transformHref(href: string): string {
  const rewritten = rewriteMarkdownFileUriHref(href);
  if (rewritten !== null) return rewritten;
  const colon = href.indexOf(":");
  const questionMark = href.indexOf("?");
  const numberSign = href.indexOf("#");
  const slash = href.indexOf("/");
  return colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    SAFE_URL_PROTOCOL.test(href.slice(0, colon))
    ? href
    : "";
}

function inlineCodeFileTarget(codeText: string, cwd: string | undefined): FilePathPosition | null {
  const candidate = inlineCodeFilePathCandidate(codeText);
  if (candidate === null) return null;
  const target = resolveMarkdownFileLinkTarget(candidate, cwd);
  return target ? splitFilePathPosition(target) : null;
}

function plainText(node: HastNode): string {
  return node.value ?? (node.children ?? []).map(plainText).join("");
}

/** The runs of text one chat Markdown block shows, without mounting it. */
function chatMarkdownSegments(
  markdown: string,
  options: {
    readonly lineBreaks: boolean;
    readonly cwd: string | undefined;
    readonly math: boolean;
    readonly streaming: boolean;
  },
  skills: ReadonlyArray<InlineSkill>,
): string[] {
  const { cwd } = options;
  const processor = options.math
    ? options.lineBreaks
      ? chatMarkdownProcessors.breaksMath
      : chatMarkdownProcessors.math
    : options.lineBreaks
      ? chatMarkdownProcessors.breaks
      : chatMarkdownProcessors.plain;
  const tree = processor.runSync(processor.parse(markdown)) as HastNode;

  // Chat Markdown resolves file chips from the source text before rendering.
  const fileLinksByHref = new Map<string, FilePathPosition>();
  for (const href of extractChatMarkdownLinkHrefs(markdown)) {
    const key = normalizeMarkdownLinkHrefKey(href);
    if (fileLinksByHref.has(key)) continue;
    const target = resolveMarkdownFileLinkTarget(key, cwd);
    if (target) fileLinksByHref.set(key, splitFilePathPosition(target));
  }
  const fileLinksByCodeSpan = new Map<string, FilePathPosition>();
  for (const span of extractInlineCodeSpans(markdown)) {
    if (fileLinksByCodeSpan.has(span)) continue;
    const target = inlineCodeFileTarget(span, cwd);
    if (target) fileLinksByCodeSpan.set(span, target);
  }
  const parentSuffixByPath = buildFileLinkParentSuffixByPath(
    [...fileLinksByHref.values(), ...fileLinksByCodeSpan.values()].map(({ path }) => path),
  );

  const withSkills = (value: string) => {
    let rendered = "";
    let cursor = 0;
    for (const { start, end, skill } of matchInlineSkills(value, skills)) {
      rendered += value.slice(cursor, start) + formatProviderSkillDisplayName(skill);
      cursor = end;
    }
    return rendered + value.slice(cursor);
  };

  const segments: string[] = [];
  let text = "";
  const flush = () => {
    if (text.trim()) segments.push(text);
    text = "";
  };
  const visit = (node: HastNode, inPre: boolean, inSkillText: boolean) => {
    if (node.type === "text") {
      const value = inSkillText ? withSkills(node.value ?? "") : (node.value ?? "");
      text += inPre ? value : value.replace(/\r?\n/g, " ");
      return;
    }
    if (node.type !== "element" && node.type !== "root") return;
    const tagName = node.tagName ?? "";
    if (tagName === "img" || tagName === "input") return;
    if (tagName === "code" && !inPre && options.math && mathKind(classNameOf(node)) === "inline") {
      return;
    }
    if (tagName === "pre") {
      const code = node.children?.find((child) => child.tagName === "code");
      const className = classNameOf(code);
      const language = fenceLanguage(className);
      // Diagrams are not searched, whether drawn or shown as source.
      if (language === "mermaid") return;
      // Math blocks render as math, except a ```math fence still streaming.
      if (
        options.math &&
        language === "math" &&
        (!options.streaming || mathKind(className) === "display")
      ) {
        return;
      }
    }
    if (tagName === "a" && typeof node.properties?.href === "string") {
      const target = fileLinksByHref.get(
        normalizeMarkdownLinkHrefKey(transformHref(node.properties.href)),
      );
      if (target) {
        // The chip replaces the link text.
        text += fileLinkLabel(target, parentSuffixByPath);
        return;
      }
    }
    if (tagName === "code" && !inPre && node.properties?.dataInlineCode !== undefined) {
      const codeText = plainText(node);
      const target =
        fileLinksByCodeSpan.get(codeText.trim()) ?? inlineCodeFileTarget(codeText, cwd);
      if (target) {
        text += fileLinkLabel(target, parentSuffixByPath);
        return;
      }
    }
    const block = THREAD_FIND_BLOCK_TAGS.has(tagName);
    if (block) flush();
    // Skill chips render inside paragraphs and list items, never in code or links.
    const childSkillText =
      tagName === "code" || tagName === "a"
        ? false
        : inSkillText || tagName === "p" || tagName === "li";
    for (const child of node.children ?? []) {
      visit(child, inPre || tagName === "pre", childSkillText);
    }
    if (block) flush();
  };
  visit(tree, false, false);
  flush();
  return segments;
}

/** Splits the prompt around inline terminal context labels, which render as chips. */
function promptAroundTerminalLabels(
  prompt: string,
  contexts: ReadonlyArray<{ readonly header: string }>,
): string[] {
  const pieces: string[] = [];
  let cursor = 0;
  for (const context of contexts) {
    const label = formatInlineTerminalContextLabel(context.header);
    const matchIndex = prompt.indexOf(label, cursor);
    pieces.push(prompt.slice(cursor, matchIndex));
    cursor = matchIndex + label.length;
  }
  pieces.push(prompt.slice(cursor));
  return pieces.map((piece) => piece.trim()).filter((piece) => piece.length > 0);
}

/** A user message bubble: the prompt without its context blocks, which render as chips and cards. */
export function searchableUserMessageSegments(
  text: string,
  options: ThreadFindTextOptions = {},
): string[] {
  const displayed = deriveDisplayedUserMessageState(text);
  let visibleText = displayed.visibleText;
  while (true) {
    const extracted = extractTrailingPreviewAnnotation(visibleText);
    if (!extracted.annotation) break;
    visibleText = extracted.promptText;
  }
  const prompt = extractTrailingElementContexts(visibleText).promptText;
  const skills = options.skills ?? [];
  const markdown = (piece: string) =>
    chatMarkdownSegments(
      piece,
      { lineBreaks: true, cwd: options.cwd, math: options.math === true, streaming: false },
      skills,
    );

  const reviewSegments = parseReviewCommentMessageSegments(prompt);
  if (reviewSegments.some((segment) => segment.kind === "review-comment")) {
    return reviewSegments.flatMap((segment) =>
      segment.kind === "text" && segment.text.trim().length > 0
        ? markdown(segment.text.trim())
        : [],
    );
  }
  if (
    displayed.contexts.length > 0 &&
    textContainsInlineTerminalContextLabels(prompt, displayed.contexts)
  ) {
    return promptAroundTerminalLabels(prompt, displayed.contexts).flatMap(markdown);
  }
  return prompt.length > 0 ? markdown(prompt) : [];
}

export function searchableAssistantMessageSegments(
  text: string,
  streaming: boolean,
  options: ThreadFindTextOptions = {},
): string[] {
  return chatMarkdownSegments(
    text || (streaming ? "" : "(empty response)"),
    { lineBreaks: false, cwd: options.cwd, math: options.math === true, streaming },
    options.skills ?? [],
  );
}

/** A plan card's title, then its body. Plans show `$skill` tokens as written. */
export function searchablePlanSegments(
  planMarkdown: string,
  options: Pick<ThreadFindTextOptions, "cwd" | "math"> = {},
): string[] {
  return [
    proposedPlanTitle(planMarkdown) ?? "Proposed plan",
    ...chatMarkdownSegments(
      stripDisplayedPlanMarkdown(planMarkdown),
      { lineBreaks: false, cwd: options.cwd, math: options.math === true, streaming: false },
      [],
    ),
  ];
}
