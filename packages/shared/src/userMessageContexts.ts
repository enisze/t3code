// A sent user message carries its context blocks after the prompt text. The
// timeline shows them as chips and cards; these split them off the text so
// the bubble, and thread find, see only the prompt.

// Element contexts picked in the preview browser.

const TRAILING_ELEMENT_CONTEXT_BLOCK_PATTERN =
  /\n*<element_context>\n([\s\S]*?)\n<\/element_context>\s*$/;

export interface ParsedElementContextEntry {
  header: string;
  body: string;
}

export interface ExtractedElementContexts {
  promptText: string;
  contextCount: number;
  contexts: ParsedElementContextEntry[];
}

/**
 * Mirror image of `appendElementContextsToPrompt` for transcript display:
 * detects (and strips) a trailing `<element_context>` block so we can render
 * the original prompt body and chips separately in user-message bubbles.
 */
export function extractTrailingElementContexts(prompt: string): ExtractedElementContexts {
  const match = TRAILING_ELEMENT_CONTEXT_BLOCK_PATTERN.exec(prompt);
  if (!match) {
    return { promptText: prompt, contextCount: 0, contexts: [] };
  }
  const promptText = prompt.slice(0, match.index).replace(/\n+$/, "");
  const contexts = parseElementContextEntries(match[1] ?? "");
  return { promptText, contextCount: contexts.length, contexts };
}

function parseElementContextEntries(block: string): ParsedElementContextEntry[] {
  const entries: ParsedElementContextEntry[] = [];
  let current: { header: string; bodyLines: string[] } | null = null;
  const commit = () => {
    if (!current) return;
    entries.push({ header: current.header, body: current.bodyLines.join("\n").trimEnd() });
    current = null;
  };
  for (const line of block.split("\n")) {
    const headerMatch = /^- (.+):$/.exec(line);
    if (headerMatch) {
      commit();
      current = { header: headerMatch[1]!, bodyLines: [] };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("  ")) current.bodyLines.push(line.slice(2));
    else if (line.length === 0) current.bodyLines.push("");
  }
  commit();
  return entries;
}

// Terminal output attached to the prompt.

const TRAILING_TERMINAL_CONTEXT_BLOCK_PATTERN =
  /\n*<terminal_context>\n([\s\S]*?)\n<\/terminal_context>\s*$/;

export interface ParsedTerminalContextEntry {
  header: string;
  body: string;
}

export interface ExtractedTerminalContexts {
  promptText: string;
  contextCount: number;
  previewTitle: string | null;
  contexts: ParsedTerminalContextEntry[];
}

export interface DisplayedUserMessageState {
  visibleText: string;
  copyText: string;
  contextCount: number;
  previewTitle: string | null;
  contexts: ParsedTerminalContextEntry[];
  /**
   * Element-context entries extracted from the trailing `<element_context>`
   * block (if any). Stripped from `visibleText` so the raw block doesn't
   * leak into the user's bubble.
   */
  elementContexts: ParsedElementContextEntry[];
}

export function formatInlineTerminalContextSelectionLabel(selection: {
  terminalLabel: string;
  lineStart: number;
  lineEnd: number;
}): string {
  const terminalLabel = selection.terminalLabel.trim().toLowerCase().replace(/\s+/g, "-");
  const range =
    selection.lineStart === selection.lineEnd
      ? `${selection.lineStart}`
      : `${selection.lineStart}-${selection.lineEnd}`;
  return `@${terminalLabel}:${range}`;
}

export function extractTrailingTerminalContexts(prompt: string): ExtractedTerminalContexts {
  const match = TRAILING_TERMINAL_CONTEXT_BLOCK_PATTERN.exec(prompt);
  if (!match) {
    return {
      promptText: prompt,
      contextCount: 0,
      previewTitle: null,
      contexts: [],
    };
  }
  const promptText = prompt.slice(0, match.index).replace(/\n+$/, "");
  const parsedContexts = parseTerminalContextEntries(match[1] ?? "");
  return {
    promptText,
    contextCount: parsedContexts.length,
    previewTitle:
      parsedContexts.length > 0
        ? parsedContexts
            .map(({ header, body }) => (body.length > 0 ? `${header}\n${body}` : header))
            .join("\n\n")
        : null,
    contexts: parsedContexts,
  };
}

export function deriveDisplayedUserMessageState(prompt: string): DisplayedUserMessageState {
  // Order matters: send-time appends `<terminal_context>` first, then
  // `<element_context>` last. Strip element first so the (now-trailing)
  // terminal block can be matched by `extractTrailingTerminalContexts`.
  const extractedElement = extractTrailingElementContexts(prompt);
  const extractedTerminal = extractTrailingTerminalContexts(extractedElement.promptText);
  return {
    visibleText: extractedTerminal.promptText,
    copyText: prompt,
    contextCount: extractedTerminal.contextCount,
    previewTitle: extractedTerminal.previewTitle,
    contexts: extractedTerminal.contexts,
    elementContexts: extractedElement.contexts,
  };
}

function parseTerminalContextEntries(block: string): ParsedTerminalContextEntry[] {
  const entries: ParsedTerminalContextEntry[] = [];
  let current: { header: string; bodyLines: string[] } | null = null;

  const commitCurrent = () => {
    if (!current) {
      return;
    }
    entries.push({
      header: current.header,
      body: current.bodyLines.join("\n").trimEnd(),
    });
    current = null;
  };

  for (const rawLine of block.split("\n")) {
    const headerMatch = /^- (.+):$/.exec(rawLine);
    if (headerMatch) {
      commitCurrent();
      current = {
        header: headerMatch[1]!,
        bodyLines: [],
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (rawLine.startsWith("  ")) {
      current.bodyLines.push(rawLine.slice(2));
      continue;
    }
    if (rawLine.length === 0) {
      current.bodyLines.push("");
    }
  }

  commitCurrent();
  return entries;
}

const TERMINAL_CONTEXT_HEADER_PATTERN = /^(.*?)\s+line(?:s)?\s+(\d+)(?:-(\d+))?$/i;

export function buildInlineTerminalContextText(
  contexts: ReadonlyArray<{
    header: string;
  }>,
): string {
  const labels: Array<string> = [];
  for (const context of contexts) {
    const header = context.header.trim();
    if (header.length > 0) {
      labels.push(formatInlineTerminalContextLabel(header));
    }
  }
  return labels.join(" ");
}

export function formatInlineTerminalContextLabel(header: string): string {
  const trimmedHeader = header.trim();
  const match = TERMINAL_CONTEXT_HEADER_PATTERN.exec(trimmedHeader);
  if (!match) {
    return `@${trimmedHeader.toLowerCase().replace(/\s+/g, "-")}`;
  }

  const lineStart = Number.parseInt(match[2] ?? "", 10);
  const lineEnd = Number.parseInt(match[3] ?? match[2] ?? "", 10);
  if (!Number.isFinite(lineStart) || !Number.isFinite(lineEnd)) {
    return `@${trimmedHeader.toLowerCase().replace(/\s+/g, "-")}`;
  }

  return formatInlineTerminalContextSelectionLabel({
    terminalLabel: match[1]?.trim() || "terminal",
    lineStart,
    lineEnd,
  });
}

export function textContainsInlineTerminalContextLabels(
  text: string,
  contexts: ReadonlyArray<{
    header: string;
  }>,
): boolean {
  let searchStartIndex = 0;

  for (const context of contexts) {
    const label = formatInlineTerminalContextLabel(context.header);
    const matchIndex = text.indexOf(label, searchStartIndex);
    if (matchIndex === -1) {
      return false;
    }
    searchStartIndex = matchIndex + label.length;
  }

  return true;
}

// Preview annotations.

const TRAILING_PREVIEW_ANNOTATION_BLOCK_PATTERN =
  /\n*<preview_annotation>\n((?:(?!<preview_annotation>)[\s\S])*)\n<\/preview_annotation>\s*$/;

export interface ParsedPreviewAnnotation {
  id: string;
  title: string;
  comment: string;
  targetSummary: string;
  styleChanges: string[];
  hasScreenshot: boolean;
}

export interface ExtractedPreviewAnnotation {
  promptText: string;
  annotation: ParsedPreviewAnnotation | null;
}

export function extractTrailingPreviewAnnotation(prompt: string): ExtractedPreviewAnnotation {
  const match = TRAILING_PREVIEW_ANNOTATION_BLOCK_PATTERN.exec(prompt);
  if (!match) return { promptText: prompt, annotation: null };
  const body = match[1] ?? "";
  const lines = body.split("\n");
  const pageLine = lines.find((line) => line.startsWith("Page: "));
  const idLine = lines.find((line) => line.startsWith("Id: "));
  const commentLine = lines.find((line) => line.startsWith("Comment: "));
  const targetsLine = lines.find((line) => line.startsWith("Targets: "));
  const styleHeadingIndex = lines.indexOf("Requested visual changes:");
  const linesAfterStyleHeading = lines.slice(styleHeadingIndex + 1);
  const elementContextIndex = linesAfterStyleHeading.indexOf("<element_context>");
  const styleChanges =
    styleHeadingIndex < 0
      ? []
      : linesAfterStyleHeading
          .slice(0, elementContextIndex < 0 ? undefined : elementContextIndex)
          .filter((line) => line.startsWith("- "))
          .map((line) => line.slice(2));
  return {
    promptText: prompt.slice(0, match.index).replace(/\n+$/, ""),
    annotation: {
      id: idLine?.slice("Id: ".length).trim() || `${match.index}`,
      title: pageLine?.slice("Page: ".length).trim() || "Preview annotation",
      comment: commentLine?.slice("Comment: ".length).trim() || "",
      targetSummary: targetsLine?.slice("Targets: ".length).trim() || "",
      styleChanges,
      hasScreenshot: body.includes("The attached screenshot is the annotated preview crop."),
    },
  };
}
