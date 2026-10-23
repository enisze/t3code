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

export function webhookPrompt(prompt: string, payload: unknown): string {
  const body = JSON.stringify(payload, null, 2);
  const count = prompt.split("{{payload}}").length - 1;
  if (Buffer.byteLength(prompt) + Buffer.byteLength(body) * Math.max(1, count) > 131_072) {
    throw new Error("The expanded webhook prompt exceeds 128 KiB.");
  }
  return prompt.includes("{{payload}}")
    ? prompt.replaceAll("{{payload}}", () => body)
    : `${prompt}\n\nWebhook payload:\n${body}`;
}
