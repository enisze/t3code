import { ThreadId, type ScheduledTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  parseWebhookCoalesceDraft,
  parseWebhookFilterDrafts,
  webhookCoalesceDraft,
  webhookFilterDrafts,
  webhookScheduleInput,
} from "./scheduledTaskWebhook.ts";

const task = (schedule: ScheduledTask["schedule"]): ScheduledTask => ({
  id: "task",
  name: "Triage",
  threadId: ThreadId.make("thread"),
  prompt: "Triage {{body.action}}",
  enabled: true,
  schedule,
  createdAt: "2026-10-23T08:00:00.000Z",
  updatedAt: "2026-10-23T08:00:00.000Z",
  nextRunAt: null,
  lastRun: null,
});

const stored = task({
  type: "webhook",
  filters: [
    { path: "headers.x-github-event", op: "equals", value: "pull_request" },
    { path: "body.action", op: "in", value: ["opened", "reopened"] },
    { path: "body.pull_request", op: "exists" },
    { path: "body.pull_request.labels[].name", op: "equals", value: "bug" },
  ],
  coalesce: { key: "{{body.number}}" },
});

describe("webhook rule drafts", () => {
  it("round-trips stored rules through the form fields", () => {
    const drafts = webhookFilterDrafts(stored);
    expect(drafts[1]).toEqual({ path: "body.action", op: "in", value: "opened, reopened" });
    const filters = parseWebhookFilterDrafts(drafts);
    const coalesce = parseWebhookCoalesceDraft(webhookCoalesceDraft(stored));
    expect(filters).toEqual({
      ok: true,
      value: stored.schedule.type === "webhook" ? stored.schedule.filters : [],
    });
    expect(coalesce).toEqual({ ok: true, value: { key: "{{body.number}}" } });
    if (!filters.ok || !coalesce.ok) throw new Error("Drafts should parse");
    // An unchanged form omits the rules, so the server keeps its stored copy.
    expect(webhookScheduleInput(stored, filters.value, coalesce.value)).toEqual({
      type: "webhook",
    });
  });

  it("sends only the rules that changed, and always sends them for a new webhook", () => {
    expect(webhookScheduleInput(stored, [], { key: "{{body.number}}" })).toEqual({
      type: "webhook",
      filters: [],
    });
    expect(webhookScheduleInput(null, [], null)).toEqual({
      type: "webhook",
      filters: [],
      coalesce: null,
    });
    expect(webhookScheduleInput(task({ type: "interval", everyMs: 60_000 }), [], null)).toEqual({
      type: "webhook",
      filters: [],
      coalesce: null,
    });
  });

  it("names the first row it rejects", () => {
    expect(
      parseWebhookFilterDrafts([
        { path: "body.action", op: "exists", value: "" },
        { path: "action", op: "equals", value: "opened" },
      ]),
    ).toEqual({
      ok: false,
      error: "Filter 2: start the path with body, headers., or query., such as body.action.",
    });
    expect(parseWebhookFilterDrafts([{ path: "body.action", op: "in", value: " , " }])).toEqual({
      ok: false,
      error: "Filter 1: list one or more values, separated by commas.",
    });
  });

  it("turns coalescing off for an empty key and checks the window", () => {
    expect(parseWebhookCoalesceDraft({ key: " ", windowSeconds: "30" })).toEqual({
      ok: true,
      value: null,
    });
    expect(parseWebhookCoalesceDraft({ key: "{{body.id}}", windowSeconds: "30" })).toEqual({
      ok: true,
      value: { key: "{{body.id}}", windowSeconds: 30 },
    });
    expect(parseWebhookCoalesceDraft({ key: "static", windowSeconds: "" }).ok).toBe(false);
    expect(parseWebhookCoalesceDraft({ key: "{{body.id}}", windowSeconds: "5" }).ok).toBe(false);
    expect(parseWebhookCoalesceDraft({ key: "{{body.id}}", windowSeconds: "1.5" }).ok).toBe(false);
  });
});
