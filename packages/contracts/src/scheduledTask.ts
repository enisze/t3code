import * as Schema from "effect/Schema";

import { IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const MIN_SCHEDULED_TASK_INTERVAL_MS = 60_000;
export const ScheduledTaskId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
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
  Schema.Struct({ type: Schema.Literal("webhook") }),
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
});
export type ScheduledTaskRun = typeof ScheduledTaskRun.Type;

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
