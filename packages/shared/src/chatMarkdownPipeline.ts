import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";

import { remarkNormalizeListItemIndentation } from "./markdownListIndentation.ts";

// Chat Markdown renders with these plugins; thread find parses with the same
// ones so its text matches what the chat shows.

type MarkdownAstNode = {
  type?: string;
  meta?: unknown;
  data?: {
    hProperties?: Record<string, unknown>;
  };
  children?: MarkdownAstNode[];
};

function remarkPreserveCodeMeta() {
  return (tree: MarkdownAstNode) => {
    const visit = (node: MarkdownAstNode) => {
      if (node.type === "code" && typeof node.meta === "string" && node.meta.trim().length > 0) {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            dataCodeMeta: node.meta.trim(),
          },
        };
      }
      node.children?.forEach(visit);
    };

    visit(tree);
  };
}

/**
 * Fenced code also lands on the `code` component, and inline vs block is no
 * longer distinguishable there once both render `<code>` — so inline spans are
 * tagged on the mdast, where the distinction still exists. Code inside a link
 * label stays untagged: linkifying it would nest an anchor inside the link's
 * anchor and steal its clicks.
 */
function remarkTagInlineCode() {
  return (tree: MarkdownAstNode) => {
    const visit = (node: MarkdownAstNode, insideLink: boolean) => {
      if (node.type === "inlineCode" && !insideLink) {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            dataInlineCode: "",
          },
        };
      }
      const childInsideLink = insideLink || node.type === "link" || node.type === "linkReference";
      node.children?.forEach((child) => visit(child, childInsideLink));
    };

    visit(tree, false);
  };
}

const CHAT_MARKDOWN_SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": (defaultSchema.attributes?.["*"] ?? []).filter((attribute) => attribute !== "title"),
    code: [
      ...(defaultSchema.attributes?.code ?? []).filter(
        (attribute) => !Array.isArray(attribute) || attribute[0] !== "className",
      ),
      ["className", /^language-./, "math-inline", "math-display"],
      "dataCodeMeta",
      "dataInlineCode",
    ],
  },
  protocols: {
    // Image sources are classified before rendering; host paths become signed URLs.
    ...Object.fromEntries(
      Object.entries(defaultSchema.protocols ?? {}).filter(([property]) => property !== "src"),
    ),
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
  },
} satisfies Parameters<typeof rehypeSanitize>[0];

export const CHAT_MARKDOWN_REMARK_PLUGINS = [
  remarkGfm,
  remarkNormalizeListItemIndentation,
  remarkPreserveCodeMeta,
  remarkTagInlineCode,
] satisfies PluggableList;

export const CHAT_MARKDOWN_REMARK_PLUGINS_WITH_BREAKS = [
  remarkGfm,
  remarkNormalizeListItemIndentation,
  remarkBreaks,
  remarkPreserveCodeMeta,
  remarkTagInlineCode,
] satisfies PluggableList;

/** Added to the remark plugins when the client renders math. */
export const CHAT_MATH_REMARK_PLUGINS = [
  [remarkMath, { singleDollarTextMath: true }],
] satisfies PluggableList;

export const CHAT_MARKDOWN_REHYPE_PLUGINS = [
  rehypeRaw,
  [rehypeSanitize, CHAT_MARKDOWN_SANITIZE_SCHEMA],
] satisfies PluggableList;
