import { describe, expect, it } from "vite-plus/test";

import { failedWebhookFilter, renderWebhookKey, renderWebhookPrompt } from "./webhookTemplate.ts";

const request = {
  body: {
    action: "opened",
    number: 42,
    draft: false,
    pull_request: { title: "Fix {{payload}}", labels: ["bug"] },
    nothing: null,
  },
  headers: { "x-github-event": "pull_request" },
  query: "source=ci&source=other",
};

describe("renderWebhookPrompt", () => {
  it("substitutes the JSON payload literally and appends it when no placeholder is used", () => {
    expect(renderWebhookPrompt("Review {{payload}}", { body: { text: "$& {{payload}}" } })).toBe(
      'Review {\n  "text": "$& {{payload}}"\n}',
    );
    expect(renderWebhookPrompt("Review this", { body: {} })).toBe(
      "Review this\n\nWebhook payload:\n{}",
    );
  });

  it("renders fields as text, objects as JSON, and missing or null values as nothing", () => {
    expect(
      renderWebhookPrompt(
        "{{ body.action }} #{{body.number}} draft={{body.draft}} {{headers.X-GitHub-Event}} from {{query.source}}: {{body.pull_request.title}} {{body.pull_request.labels}}[{{body.missing}}{{body.nothing}}]",
        request,
      ),
    ).toBe('opened #42 draft=false pull_request from ci: Fix {{payload}} [\n  "bug"\n][]');
  });

  it("leaves other brace text as written and does not append when a field placeholder is used", () => {
    expect(
      renderWebhookPrompt("Explain {{name}} and {{headers}} for {{body.action}}", request),
    ).toBe("Explain {{name}} and {{headers}} for opened");
    expect(renderWebhookPrompt("Explain {{name}}", { body: 1 })).toBe(
      "Explain {{name}}\n\nWebhook payload:\n1",
    );
  });

  it("renders a [] wildcard as the list of matching values", () => {
    expect(
      renderWebhookPrompt(
        "Labels: {{body.pull_request.labels[]}} Names: {{body.reviewers[].login}}",
        {
          body: {
            pull_request: { labels: ["bug", "ui"] },
            reviewers: [{ login: "ada" }, { name: "no login" }, { login: "bob" }],
          },
        },
      ),
    ).toBe('Labels: [\n  "bug",\n  "ui"\n] Names: [\n  "ada",\n  "bob"\n]');
  });

  it("does not read inherited properties", () => {
    expect(renderWebhookPrompt("[{{body.constructor}}][{{body.__proto__}}]", request)).toBe("[][]");
  });

  it("bounds the expanded prompt", () => {
    expect(() =>
      renderWebhookPrompt("{{payload}}".repeat(100), { body: "x".repeat(10_000) }),
    ).toThrow(/128 KiB/);
    expect(() =>
      renderWebhookPrompt("{{body.text}}".repeat(100), { body: { text: "x".repeat(10_000) } }),
    ).toThrow(/128 KiB/);
  });
});

describe("renderWebhookKey", () => {
  it("digests the rendered key and skips coalescing when a value is missing or empty", () => {
    const key = renderWebhookKey("pr-{{body.number}}", request);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(renderWebhookKey("pr-{{body.number}}", { body: { number: 42 } })).toBe(key);
    expect(renderWebhookKey("pr-{{body.number}}", { body: { number: 43 } })).not.toBe(key);
    expect(renderWebhookKey("pr-{{body.missing}}", request)).toBe("");
    expect(renderWebhookKey("pr-{{body.nothing}}", request)).toBe("");
    expect(renderWebhookKey("{{headers.x-empty}}", { body: {}, headers: { "x-empty": "" } })).toBe(
      "",
    );
  });
});

describe("failedWebhookFilter", () => {
  it("passes when every filter matches", () => {
    expect(
      failedWebhookFilter(
        [
          { path: "headers.x-github-event", op: "equals", value: "pull_request" },
          { path: "body.action", op: "in", value: ["opened", "reopened"] },
          { path: "body.number", op: "equals", value: "42" },
          { path: "body.draft", op: "notEquals", value: "true" },
          { path: "body.pull_request.title", op: "startsWith", value: "Fix" },
          { path: "body.pull_request", op: "exists" },
          { path: "query.source", op: "equals", value: "ci" },
        ],
        request,
      ),
    ).toBeNull();
    expect(failedWebhookFilter([], request)).toBeNull();
  });

  it("names the first failing filter, numbered from 1", () => {
    expect(
      failedWebhookFilter(
        [
          { path: "body.action", op: "exists" },
          { path: "headers.x-github-event", op: "equals", value: "push" },
        ],
        request,
      ),
    ).toBe("Filter 2 (headers.x-github-event) did not match.");
  });

  it("fails every op on missing or null values, and compares only scalars", () => {
    for (const path of ["body.missing", "body.nothing"]) {
      expect(failedWebhookFilter([{ path, op: "notEquals", value: "x" }], request)).not.toBeNull();
      expect(failedWebhookFilter([{ path, op: "exists" }], request)).not.toBeNull();
    }
    expect(
      failedWebhookFilter([{ path: "body.pull_request", op: "notEquals", value: "x" }], request),
    ).not.toBeNull();
    // A list without a wildcard in the path only satisfies exists.
    expect(
      failedWebhookFilter(
        [{ path: "body.pull_request.labels", op: "equals", value: "bug" }],
        request,
      ),
    ).not.toBeNull();
  });

  const issueComment = {
    body: {
      action: "created",
      issue: { number: 7, labels: [{ name: "bug" }, { name: "needs more info" }], assignees: [] },
    },
    headers: { "x-github-event": "issue_comment" },
  };

  it("matches a [] wildcard path when any element matches", () => {
    expect(
      failedWebhookFilter(
        [
          { path: "body.issue.labels[].name", op: "equals", value: "needs more info" },
          { path: "body.issue.labels[].name", op: "in", value: ["needs more info", "triage"] },
          { path: "body.issue.labels[].name", op: "startsWith", value: "needs" },
          { path: "body.issue.labels[].name", op: "exists" },
          { path: "body.issue.labels[]", op: "exists" },
        ],
        issueComment,
      ),
    ).toBeNull();
    expect(
      failedWebhookFilter(
        [{ path: "body.issue.labels[].name", op: "equals", value: "wontfix" }],
        issueComment,
      ),
    ).toBe("Filter 1 (body.issue.labels[].name) did not match.");
  });

  it("fails notEquals on a [] wildcard path when any element equals the value", () => {
    expect(
      failedWebhookFilter(
        [{ path: "body.issue.labels[].name", op: "notEquals", value: "bug" }],
        issueComment,
      ),
    ).not.toBeNull();
    expect(
      failedWebhookFilter(
        [{ path: "body.issue.labels[].name", op: "notEquals", value: "wontfix" }],
        issueComment,
      ),
    ).toBeNull();
  });

  it("treats an empty or missing [] wildcard list as nothing to match", () => {
    expect(
      failedWebhookFilter([{ path: "body.issue.assignees[].login", op: "exists" }], issueComment),
    ).not.toBeNull();
    expect(
      failedWebhookFilter(
        [{ path: "body.issue.assignees[].login", op: "notEquals", value: "anyone" }],
        issueComment,
      ),
    ).toBeNull();
    expect(
      failedWebhookFilter([{ path: "body.issue.number[].x", op: "exists" }], issueComment),
    ).not.toBeNull();
  });
});
