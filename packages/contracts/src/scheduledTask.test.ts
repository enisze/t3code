import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ThreadId } from "./baseSchemas.ts";
import {
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRun,
  isWebhookKeyTemplate,
} from "./scheduledTask.ts";

const decodeInput = Schema.decodeUnknownOption(ScheduledTaskInput);
const decodeTask = Schema.decodeUnknownSync(ScheduledTask);
const encodeTask = Schema.encodeSync(ScheduledTask);
const { dueAt: _dueAt, ...legacyRunFields } = ScheduledTaskRun.fields;
// A client from before the rules: its webhook schedule and run have no such fields.
const decodeLegacyTask = Schema.decodeUnknownSync(
  Schema.Struct({
    ...ScheduledTask.fields,
    schedule: Schema.Struct({ type: Schema.Literal("webhook") }),
    lastRun: Schema.NullOr(Schema.Struct(legacyRunFields)),
  }),
);
const input = (schedule: unknown) => ({
  name: "Review",
  prompt: "Review the diff",
  threadId: ThreadId.make("thread"),
  enabled: true,
  schedule,
});

describe("webhook schedules", () => {
  it("accepts filters and a coalesce key", () => {
    expect(
      decodeInput(
        input({
          type: "webhook",
          filters: [
            { path: "headers.x-github-event", op: "equals", value: "pull_request" },
            { path: "body.action", op: "in", value: ["opened", "reopened"] },
            { path: "body.pull_request.title", op: "startsWith", value: "fix" },
            { path: "query.source", op: "notEquals", value: "" },
            { path: "body", op: "exists" },
          ],
          coalesce: { key: "pr-{{ body.pull_request.number }}", windowSeconds: 10 },
        }),
      )._tag,
    ).toBe("Some");
    expect(decodeInput(input({ type: "webhook", coalesce: null }))._tag).toBe("Some");
  });

  it("rejects filters and keys a form or matcher cannot use", () => {
    for (const schedule of [
      { type: "webhook", filters: [{ path: "payload.action", op: "exists" }] },
      { type: "webhook", filters: [{ path: "headers", op: "exists" }] },
      { type: "webhook", filters: [{ path: "body..action", op: "exists" }] },
      { type: "webhook", filters: [{ path: "body.action", op: "matches", value: ".*" }] },
      { type: "webhook", filters: [{ path: "body.action", op: "equals" }] },
      { type: "webhook", filters: [{ path: "body.action", op: "in", value: [] }] },
      { type: "webhook", filters: [{ path: "body.action", op: "in", value: ["a, b"] }] },
      { type: "webhook", filters: [{ path: "body.action", op: "in", value: [" a"] }] },
      {
        type: "webhook",
        filters: Array.from({ length: 17 }, () => ({ path: "body", op: "exists" })),
      },
      { type: "webhook", coalesce: { key: "static" } },
      { type: "webhook", coalesce: { key: "{{payload}}" } },
      { type: "webhook", coalesce: { key: "{{body.number}} }}" } },
      { type: "webhook", coalesce: { key: "{{body.number}}", windowSeconds: 9 } },
      { type: "webhook", coalesce: { key: "{{body.number}}", windowSeconds: 3601 } },
    ]) {
      expect(decodeInput(input(schedule))._tag).toBe("None");
    }
  });

  it("checks key templates in linear time", () => {
    expect(isWebhookKeyTemplate("{{headers.x-github-delivery}}")).toBe(true);
    expect(isWebhookKeyTemplate("{{body.a}}:{{query.b}}")).toBe(true);
    const started = performance.now();
    expect(isWebhookKeyTemplate(`{{body.${"a.".repeat(5_000)}x`)).toBe(false);
    expect(isWebhookKeyTemplate(`{{body${".a".repeat(5_000)} {`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("lets clients that predate the rules decode tasks that carry them", () => {
    const task = decodeTask({
      ...input({
        type: "webhook",
        filters: [{ path: "body.action", op: "exists" }],
        coalesce: { key: "{{body.number}}" },
      }),
      id: "task",
      createdAt: "2026-10-23T08:00:00.000Z",
      updatedAt: "2026-10-23T08:00:00.000Z",
      nextRunAt: null,
      lastRun: {
        id: "run",
        taskId: "task",
        trigger: "webhook",
        status: "pending",
        createdAt: "2026-10-23T08:00:00.000Z",
        finishedAt: null,
        error: null,
        dueAt: "2026-10-23T08:02:00.000Z",
      },
    });
    const decoded = decodeLegacyTask(encodeTask(task));
    expect(decoded.schedule).toEqual({ type: "webhook" });
    expect(decoded.lastRun).not.toHaveProperty("dueAt");
  });
});
