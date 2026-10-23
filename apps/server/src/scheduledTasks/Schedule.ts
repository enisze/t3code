import type { ScheduledTaskSchedule } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** Advances from now, coalescing missed intervals instead of replaying a backlog. */
export function nextScheduledRunAt(
  schedule: ScheduledTaskSchedule,
  from: DateTime.Utc,
): string | null {
  if (schedule.type === "webhook") return null;
  if (schedule.type === "interval") {
    return DateTime.formatIso(DateTime.addDuration(from, schedule.everyMs));
  }
  const zoned = DateTime.setZone(from, DateTime.zoneMakeNamedUnsafe(schedule.timeZone));
  const hour = Number(schedule.timeOfDay.slice(0, 2));
  const minute = Number(schedule.timeOfDay.slice(3));
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = DateTime.setParts(DateTime.add(zoned, { days: offset }), {
      hour,
      minute,
      second: 0,
      millisecond: 0,
    });
    if (DateTime.toEpochMillis(candidate) <= DateTime.toEpochMillis(from)) continue;
    if (
      schedule.weekdays.length > 0 &&
      !schedule.weekdays.includes(DateTime.toParts(candidate).weekDay)
    )
      continue;
    return DateTime.formatIso(candidate);
  }
  return null;
}

/** Formatting or reordering weekdays must not move the pending run. */
export function isSameSchedule(a: ScheduledTaskSchedule, b: ScheduledTaskSchedule): boolean {
  if (a.type === "webhook") return b.type === "webhook";
  if (a.type === "interval") return b.type === "interval" && a.everyMs === b.everyMs;
  if (b.type !== "fixed_time") return false;
  const days = (value: ReadonlyArray<number>) =>
    value.length === 0 || new Set(value).size === 7
      ? "daily"
      : [...new Set(value)].sort().join(",");
  return (
    a.timeOfDay === b.timeOfDay &&
    a.timeZone === b.timeZone &&
    days(a.weekdays) === days(b.weekdays)
  );
}

type WebhookSchedule = Extract<ScheduledTaskSchedule, { type: "webhook" }>;

/**
 * The webhook rules to store. An omitted field keeps the stored rules, so a
 * client that predates them cannot clear them; [] or null clears them.
 */
export function mergeWebhookSchedule(
  next: WebhookSchedule,
  previous: ScheduledTaskSchedule | null,
): WebhookSchedule {
  const stored = previous?.type === "webhook" ? previous : undefined;
  const filters = next.filters ?? stored?.filters ?? [];
  const coalesce = next.coalesce === undefined ? stored?.coalesce : next.coalesce;
  return {
    type: "webhook",
    ...(filters.length > 0 ? { filters } : {}),
    ...(coalesce ? { coalesce } : {}),
  };
}
