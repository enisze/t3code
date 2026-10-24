import * as Schema from "effect/Schema";

import { IsoDateTime, MessageId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const MIN_SCHEDULED_TASK_INTERVAL_MS = 60_000;
export const ScheduledTaskId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));

export const MAX_WEBHOOK_FILTERS = 16;
export const MIN_WEBHOOK_COALESCE_SECONDS = 10;
export const MAX_WEBHOOK_COALESCE_SECONDS = 3600;
export const DEFAULT_WEBHOOK_COALESCE_SECONDS = 120;

/**
 * A request value in placeholder syntax without braces: `body`, `body.action`,
 * `headers.x-github-event`, or `query.source`. A body segment ending in `[]`
 * fans out over an array, so `body.issue.labels[].name` names every label's
 * name. Segments exclude dots, so matching stays linear on malformed input.
 */
const WEBHOOK_PATH = /^(?:body(?:\.[^{}.\s]+)*|(?:headers|query)(?:\.[^{}.\s]+)+)$/;
const WEBHOOK_PLACEHOLDER =
  /\{\{\s*(?:body(?:\.[^{}.\s]+)*|(?:headers|query)(?:\.[^{}.\s]+)+)\s*\}\}/g;

export const isWebhookPath = (path: string): boolean => WEBHOOK_PATH.test(path);

/** A key template needs a request placeholder and no other braces. */
export function isWebhookKeyTemplate(template: string): boolean {
  const matches = template.match(WEBHOOK_PLACEHOLDER);
  const remainder = template.replace(WEBHOOK_PLACEHOLDER, "");
  return matches !== null && !remainder.includes("{{") && !remainder.includes("}}");
}

const WebhookFilterPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(256),
  Schema.makeFilter(isWebhookPath),
);

/**
 * Forms edit an `in` list as comma-separated text, so a value without commas or
 * surrounding whitespace survives that round trip unchanged.
 */
const WebhookFilterListValue = Schema.String.check(
  Schema.isMaxLength(1_000),
  Schema.isPattern(/^[^,\s](?:[^,]*[^,\s])?$/),
);

/**
 * Scalars compare as strings. Objects and arrays only satisfy `exists`, and a
 * missing or null value fails every op, including `notEquals`. A `[]` wildcard
 * path yields a list: `equals`, `in`, and `startsWith` match when any element
 * does, `notEquals` when no element equals the value, and `exists` when the
 * list has an element.
 */
export const ScheduledTaskWebhookFilter = Schema.Union([
  Schema.Struct({
    path: WebhookFilterPath,
    op: Schema.Literals(["equals", "notEquals", "startsWith"]),
    value: Schema.String.check(Schema.isMaxLength(1_000)),
  }),
  Schema.Struct({
    path: WebhookFilterPath,
    op: Schema.Literal("in"),
    value: Schema.Array(WebhookFilterListValue).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(64),
    ),
  }),
  Schema.Struct({ path: WebhookFilterPath, op: Schema.Literal("exists") }),
]);
export type ScheduledTaskWebhookFilter = typeof ScheduledTaskWebhookFilter.Type;
export type ScheduledTaskWebhookFilterOp = ScheduledTaskWebhookFilter["op"];

/** Deliveries whose key renders the same within the window start one run. */
export const ScheduledTaskWebhookCoalesce = Schema.Struct({
  key: TrimmedNonEmptyString.check(
    Schema.isMaxLength(256),
    Schema.makeFilter(isWebhookKeyTemplate),
  ),
  windowSeconds: Schema.optional(
    Schema.Int.check(
      Schema.isBetween({
        minimum: MIN_WEBHOOK_COALESCE_SECONDS,
        maximum: MAX_WEBHOOK_COALESCE_SECONDS,
      }),
    ),
  ),
});
export type ScheduledTaskWebhookCoalesce = typeof ScheduledTaskWebhookCoalesce.Type;

export const ScheduledTaskSchedule = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("interval"),
    everyMs: Schema.Int.check(
      Schema.isBetween({ minimum: MIN_SCHEDULED_TASK_INTERVAL_MS, maximum: 365 * 86_400_000 }),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("fixed_time"),
    timeOfDay: Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)),
    timeZone: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
    weekdays: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 6 }))).check(
      Schema.isMaxLength(7),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("webhook"),
    // On save, an omitted field keeps the stored rules; [] or null clears them.
    filters: Schema.optional(
      Schema.Array(ScheduledTaskWebhookFilter).check(Schema.isMaxLength(MAX_WEBHOOK_FILTERS)),
    ),
    coalesce: Schema.optional(Schema.NullOr(ScheduledTaskWebhookCoalesce)),
  }),
]);
export type ScheduledTaskSchedule = typeof ScheduledTaskSchedule.Type;

export const ScheduledTaskInput = Schema.Struct({
  id: Schema.optional(ScheduledTaskId),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  threadId: ThreadId,
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(32_768)),
  schedule: ScheduledTaskSchedule,
  enabled: Schema.Boolean,
});
export type ScheduledTaskInput = typeof ScheduledTaskInput.Type;

export const ScheduledTaskRun = Schema.Struct({
  id: ScheduledTaskId,
  taskId: ScheduledTaskId,
  trigger: Schema.Literals(["schedule", "manual", "webhook"]),
  status: Schema.Literals(["pending", "started", "failed", "skipped"]),
  createdAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
  error: Schema.NullOr(Schema.String),
  /** Set while a pending run waits for its webhook window to close. */
  dueAt: Schema.optional(IsoDateTime),
});
export type ScheduledTaskRun = typeof ScheduledTaskRun.Type;

const AUTOMATION_MESSAGE_ID_PREFIX = "automation:";

/** The user message a run sends its prompt as. */
export const automationMessageId = (runId: string) =>
  MessageId.make(`${AUTOMATION_MESSAGE_ID_PREFIX}${runId}`);

/** Automation prompts carry no other marker; clients fold them into compact rows by this. */
export const isAutomationMessageId = (messageId: string): boolean =>
  messageId.startsWith(AUTOMATION_MESSAGE_ID_PREFIX);

export const ScheduledTask = Schema.Struct({
  ...ScheduledTaskInput.fields,
  id: ScheduledTaskId,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  nextRunAt: Schema.NullOr(IsoDateTime),
  lastRun: Schema.NullOr(ScheduledTaskRun),
});
export type ScheduledTask = typeof ScheduledTask.Type;

export const ScheduledTaskSaveResult = Schema.Struct({
  task: ScheduledTask,
  // A secret URL is returned only when creating or rotating a webhook.
  webhookPath: Schema.optional(Schema.String),
});

export class ScheduledTaskError extends Schema.TaggedErrorClass<ScheduledTaskError>()(
  "ScheduledTaskError",
  {
    reason: Schema.Literals([
      "invalid",
      "not_found",
      "disabled",
      "unauthorized",
      "rate_limited",
      "internal",
    ]),
    message: Schema.String,
  },
) {}
