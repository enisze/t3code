import {
  DEFAULT_WEBHOOK_COALESCE_SECONDS,
  MAX_WEBHOOK_COALESCE_SECONDS,
  MAX_WEBHOOK_FILTERS,
  MIN_WEBHOOK_COALESCE_SECONDS,
  ScheduledTaskWebhookCoalesce,
  ScheduledTaskWebhookFilter,
  isWebhookKeyTemplate,
  isWebhookPath,
  type ScheduledTask,
  type ScheduledTaskSchedule,
  type ScheduledTaskWebhookFilterOp,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export { DEFAULT_WEBHOOK_COALESCE_SECONDS, MAX_WEBHOOK_FILTERS };

/** Filter tests in the order both settings forms list them. */
export const WEBHOOK_FILTER_OPS: ReadonlyArray<{
  readonly op: ScheduledTaskWebhookFilterOp;
  readonly label: string;
}> = [
  { op: "equals", label: "equals" },
  { op: "notEquals", label: "does not equal" },
  { op: "in", label: "is one of" },
  { op: "startsWith", label: "starts with" },
  { op: "exists", label: "exists" },
];

/** A filter row as a form edits it; an `in` value is comma-separated text. */
export interface WebhookFilterDraft {
  readonly path: string;
  readonly op: ScheduledTaskWebhookFilterOp;
  readonly value: string;
}

export const EMPTY_WEBHOOK_FILTER_DRAFT: WebhookFilterDraft = {
  path: "",
  op: "equals",
  value: "",
};

type WebhookSchedule = Extract<ScheduledTaskSchedule, { type: "webhook" }>;
type Parsed<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: string };

const webhookSchedule = (task: ScheduledTask | null) =>
  task?.schedule.type === "webhook" ? task.schedule : undefined;

export function webhookFilterDrafts(task: ScheduledTask | null): Array<WebhookFilterDraft> {
  return (webhookSchedule(task)?.filters ?? []).map((filter) => ({
    path: filter.path,
    op: filter.op,
    value:
      filter.op === "exists" ? "" : filter.op === "in" ? filter.value.join(", ") : filter.value,
  }));
}

/** An empty window means the default, which forms show as a placeholder. */
export function webhookCoalesceDraft(task: ScheduledTask | null): {
  readonly key: string;
  readonly windowSeconds: string;
} {
  const coalesce = webhookSchedule(task)?.coalesce;
  return {
    key: coalesce?.key ?? "",
    windowSeconds: coalesce?.windowSeconds === undefined ? "" : String(coalesce.windowSeconds),
  };
}

const decodeFilter = Schema.decodeUnknownOption(ScheduledTaskWebhookFilter);
const decodeCoalesce = Schema.decodeUnknownOption(ScheduledTaskWebhookCoalesce);

/** Validates rows with the server's own schema, naming the first row it rejects. */
export function parseWebhookFilterDrafts(
  drafts: ReadonlyArray<WebhookFilterDraft>,
): Parsed<ReadonlyArray<ScheduledTaskWebhookFilter>> {
  const filters: Array<ScheduledTaskWebhookFilter> = [];
  for (const [index, draft] of drafts.entries()) {
    const path = draft.path.trim();
    const label = `Filter ${index + 1}`;
    if (!isWebhookPath(path)) {
      return {
        ok: false,
        error: `${label}: start the path with body, headers., or query., such as body.action.`,
      };
    }
    const candidate =
      draft.op === "exists"
        ? { path, op: draft.op }
        : draft.op === "in"
          ? {
              path,
              op: draft.op,
              value: draft.value
                .split(",")
                .map((value) => value.trim())
                .filter((value) => value !== ""),
            }
          : { path, op: draft.op, value: draft.value };
    const filter = decodeFilter(candidate);
    if (Option.isNone(filter)) {
      return {
        ok: false,
        error:
          draft.op === "in"
            ? `${label}: list one or more values, separated by commas.`
            : `${label}: the value is too long.`,
      };
    }
    filters.push(filter.value);
  }
  if (filters.length > MAX_WEBHOOK_FILTERS) {
    return { ok: false, error: `Use at most ${MAX_WEBHOOK_FILTERS} filters.` };
  }
  return { ok: true, value: filters };
}

/** An empty key turns coalescing off. */
export function parseWebhookCoalesceDraft(draft: {
  readonly key: string;
  readonly windowSeconds: string;
}): Parsed<ScheduledTaskWebhookCoalesce | null> {
  const key = draft.key.trim();
  if (key === "") return { ok: true, value: null };
  if (!isWebhookKeyTemplate(key)) {
    return {
      ok: false,
      error: "Build the combine key from placeholders such as {{body.pull_request.number}}.",
    };
  }
  const seconds = draft.windowSeconds.trim();
  const coalesce = decodeCoalesce({
    key,
    ...(seconds === "" ? {} : { windowSeconds: Number(seconds) }),
  });
  if (Option.isNone(coalesce)) {
    return {
      ok: false,
      error: `Choose a window of ${MIN_WEBHOOK_COALESCE_SECONDS} to ${MAX_WEBHOOK_COALESCE_SECONDS} whole seconds, and keep the key under 256 characters.`,
    };
  }
  return { ok: true, value: coalesce.value };
}

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/**
 * The webhook schedule to save. Rules this form left unchanged are omitted, and
 * the server keeps its stored copy, so a save from one device does not undo a
 * change another device made meanwhile.
 */
export function webhookScheduleInput(
  task: ScheduledTask | null,
  filters: ReadonlyArray<ScheduledTaskWebhookFilter>,
  coalesce: ScheduledTaskWebhookCoalesce | null,
): WebhookSchedule {
  const stored = webhookSchedule(task);
  return {
    type: "webhook",
    ...(stored !== undefined && sameJson(stored.filters ?? [], filters) ? {} : { filters }),
    ...(stored !== undefined && sameJson(stored.coalesce ?? null, coalesce) ? {} : { coalesce }),
  };
}
