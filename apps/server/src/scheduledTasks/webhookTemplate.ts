import * as NodeCrypto from "node:crypto";

import type { ScheduledTaskWebhookFilter } from "@t3tools/contracts";

/** What a webhook delivery exposes to prompt placeholders, keys, and filters. */
export interface WebhookRequest {
  /** The parsed JSON body. */
  readonly body: unknown;
  /** Lowercased header names. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The query string without its leading `?`. */
  readonly query?: string;
}

export const MAX_WEBHOOK_PROMPT_BYTES = 131_072;

/** Text inside braces that is not one of the placeholders below stays as written. */
const NOT_A_PLACEHOLDER = Symbol("NotAPlaceholder");
const PLACEHOLDER = /\{\{\s*([a-z]+(?:\.[^{}.\s]+)*)\s*\}\}/g;

function lookup(root: unknown, segments: ReadonlyArray<string>): unknown {
  let current = root;
  for (const segment of segments) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Resolves `body`, `body.a.b`, `headers.name`, and `query.name` against a
 * delivery. Placeholders and filters share it, so both read the same value.
 */
function webhookExpressionResolver(request: WebhookRequest) {
  let query: URLSearchParams | undefined;
  return (expression: string): unknown => {
    const [root, ...segments] = expression.split(".");
    switch (root) {
      case "body":
        return segments.length === 0 ? request.body : lookup(request.body, segments);
      case "headers": {
        if (segments.length === 0) return NOT_A_PLACEHOLDER;
        const name = segments.join(".").toLowerCase();
        const headers = request.headers ?? {};
        return Object.hasOwn(headers, name) ? headers[name] : undefined;
      }
      case "query":
        if (segments.length === 0) return NOT_A_PLACEHOLDER;
        query ??= new URLSearchParams(request.query ?? "");
        return query.get(segments.join(".")) ?? undefined;
      default:
        return NOT_A_PLACEHOLDER;
    }
  };
}

/** Strings as written, numbers and booleans as text, objects as JSON, null or missing as nothing. */
function placeholderText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

/**
 * Expands `{{payload}}` (the JSON body) and field placeholders in one pass, so
 * request text is never expanded again. A prompt without placeholders gets the
 * payload appended. Throws once the result passes the 128 KiB cap.
 */
export function renderWebhookPrompt(template: string, request: WebhookRequest): string {
  const resolve = webhookExpressionResolver(request);
  let payload: string | undefined;
  const parts: Array<string> = [];
  let bytes = 0;
  const push = (text: string) => {
    bytes += Buffer.byteLength(text);
    if (bytes > MAX_WEBHOOK_PROMPT_BYTES) {
      throw new Error("The expanded webhook prompt exceeds 128 KiB.");
    }
    parts.push(text);
  };
  let placeholders = 0;
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    const expression = match[1]!;
    let text: string;
    if (expression === "payload") {
      text = payload ??= JSON.stringify(request.body, null, 2);
    } else {
      const value = resolve(expression);
      if (value === NOT_A_PLACEHOLDER) continue;
      text = placeholderText(value) ?? "";
    }
    placeholders += 1;
    push(template.slice(last, match.index));
    push(text);
    last = match.index + match[0].length;
  }
  push(template.slice(last));
  if (placeholders === 0) {
    push(`\n\nWebhook payload:\n${JSON.stringify(request.body, null, 2)}`);
  }
  return parts.join("");
}

/**
 * The digest of a rendered key template, or "" when any placeholder is missing
 * or the key renders empty, so such a delivery does not coalesce.
 */
export function renderWebhookKey(template: string, request: WebhookRequest): string {
  const resolve = webhookExpressionResolver(request);
  let missing = false;
  const rendered = template.replace(PLACEHOLDER, (match, expression: string) => {
    const value = resolve(expression);
    if (value === NOT_A_PLACEHOLDER) return match;
    const text = placeholderText(value);
    if (text === undefined || text === "") missing = true;
    return text ?? "";
  });
  if (missing || rendered.trim() === "") return "";
  return NodeCrypto.createHash("sha256").update(rendered).digest("hex");
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function matchesWebhookFilter(filter: ScheduledTaskWebhookFilter, value: unknown): boolean {
  if (filter.op === "exists") return value !== undefined && value !== null;
  const text = scalarText(value);
  if (text === undefined) return false;
  switch (filter.op) {
    case "equals":
      return text === filter.value;
    case "notEquals":
      return text !== filter.value;
    case "in":
      return filter.value.includes(text);
    case "startsWith":
      return text.startsWith(filter.value);
  }
}

/** Why the delivery fails its filters, numbered from 1 as the form lists them, or null when all match. */
export function failedWebhookFilter(
  filters: ReadonlyArray<ScheduledTaskWebhookFilter>,
  request: WebhookRequest,
): string | null {
  const resolve = webhookExpressionResolver(request);
  for (const [index, filter] of filters.entries()) {
    const value = resolve(filter.path);
    if (!matchesWebhookFilter(filter, value === NOT_A_PLACEHOLDER ? undefined : value)) {
      return `Filter ${index + 1} (${filter.path}) did not match.`;
    }
  }
  return null;
}
