import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import { ScheduledTaskInput, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { isSameSchedule, mergeWebhookSchedule, nextScheduledRunAt } from "./Schedule.ts";

describe("automation schedules", () => {
  it("advances intervals by elapsed time across daylight saving", () => {
    const from = DateTime.makeUnsafe("2026-03-29T00:30:00.000Z");
    expect(nextScheduledRunAt({ type: "interval", everyMs: 3_600_000 }, from)).toBe(
      "2026-03-29T01:30:00.000Z",
    );
  });
  it("keeps daily wall-clock time across daylight saving in the saved zone", () => {
    const schedule = {
      type: "fixed_time",
      timeOfDay: "09:00",
      timeZone: "Europe/Berlin",
      weekdays: [],
    } as const;
    expect(nextScheduledRunAt(schedule, DateTime.makeUnsafe("2026-03-28T08:00:00.000Z"))).toBe(
      "2026-03-29T07:00:00.000Z",
    );
    expect(nextScheduledRunAt(schedule, DateTime.makeUnsafe("2026-10-24T07:00:00.000Z"))).toBe(
      "2026-10-25T08:00:00.000Z",
    );
  });
  it("finds the next selected weekday and uses Sunday as zero", () => {
    const schedule = {
      type: "fixed_time",
      timeOfDay: "09:00",
      timeZone: "UTC",
      weekdays: [0],
    } as const;
    expect(nextScheduledRunAt(schedule, DateTime.makeUnsafe("2026-10-23T10:00:00.000Z"))).toBe(
      "2026-10-25T09:00:00.000Z",
    );
  });
  it("does not shift the next run for equivalent weekday selections", () => {
    const schedule = {
      type: "fixed_time",
      timeOfDay: "09:00",
      timeZone: "UTC",
      weekdays: [1, 2],
    } as const;
    expect(isSameSchedule(schedule, { ...schedule, weekdays: [2, 1, 1] })).toBe(true);
    expect(
      isSameSchedule(
        { ...schedule, weekdays: [] },
        { ...schedule, weekdays: [0, 1, 2, 3, 4, 5, 6] },
      ),
    ).toBe(true);
    expect(isSameSchedule(schedule, { ...schedule, timeZone: "Europe/Berlin" })).toBe(false);
  });
  it("gives webhooks no timer", () => {
    expect(nextScheduledRunAt({ type: "webhook" }, DateTime.makeUnsafe(0))).toBeNull();
  });
  it("keeps stored webhook rules when a save omits them, and clears them with [] or null", () => {
    const stored = {
      type: "webhook",
      filters: [{ path: "body.action", op: "equals", value: "opened" }],
      coalesce: { key: "{{body.number}}", windowSeconds: 30 },
    } as const;
    expect(mergeWebhookSchedule({ type: "webhook" }, stored)).toEqual(stored);
    expect(mergeWebhookSchedule({ type: "webhook", filters: [], coalesce: null }, stored)).toEqual({
      type: "webhook",
    });
    expect(
      mergeWebhookSchedule({ type: "webhook", coalesce: { key: "{{body.id}}" } }, stored),
    ).toEqual({ type: "webhook", filters: stored.filters, coalesce: { key: "{{body.id}}" } });
    expect(
      mergeWebhookSchedule({ type: "webhook" }, { type: "interval", everyMs: 60_000 }),
    ).toEqual({ type: "webhook" });
  });
  it("rejects short intervals and invalid wall-clock times at the wire boundary", () => {
    const input = {
      name: "Review",
      prompt: "Review the diff",
      threadId: ThreadId.make("thread"),
      enabled: true,
    };
    const decode = Schema.decodeUnknownOption(ScheduledTaskInput);
    expect(decode({ ...input, schedule: { type: "interval", everyMs: 1 } })._tag).toBe("None");
    expect(
      decode({
        ...input,
        schedule: { type: "fixed_time", timeOfDay: "25:00", timeZone: "UTC", weekdays: [] },
      })._tag,
    ).toBe("None");
  });
});
