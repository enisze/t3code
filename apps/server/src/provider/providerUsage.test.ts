import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { parseClaudeUsageResponse } from "./providerUsage.ts";

const FETCHED_AT = "2026-08-03T15:00:00.000Z";

describe("parseClaudeUsageResponse", () => {
  // Regression: the live endpoint returns `null` for numeric fields it isn't
  // currently metering (here `extra_usage.utilization`). A schema that only
  // accepted `number | undefined` failed the whole decode, silently dropping
  // every Claude usage window while Codex kept showing.
  it.effect("keeps windows when a numeric field is null", () =>
    Effect.gen(function* () {
      const usage = yield* parseClaudeUsageResponse(
        {
          five_hour: { utilization: 28, resets_at: "2026-08-03T17:40:00Z", limit_dollars: null },
          seven_day: { utilization: 12, resets_at: "2026-08-10T06:00:00Z" },
          seven_day_opus: null,
          seven_day_sonnet: null,
          extra_usage: {
            is_enabled: true,
            monthly_limit: null,
            used_credits: 6914,
            utilization: null,
          },
          // Unknown forward-compatible fields must be ignored, not rejected.
          nimbus_quill: null,
          spend: { amount_minor: 6914 },
        },
        FETCHED_AT,
      );

      expect(usage).toBeDefined();
      expect(usage?.source).toBe("claude");
      const kinds = usage?.windows.map((window) => window.kind);
      expect(kinds).toContain("five_hour");
      expect(kinds).toContain("seven_day");
      expect(usage?.windows.find((window) => window.kind === "five_hour")?.usedPercent).toBe(28);
      expect(usage?.credits?.used).toBe(6914);
    }),
  );

  it.effect("returns undefined for an undecodable body", () =>
    Effect.gen(function* () {
      const usage = yield* parseClaudeUsageResponse("not an object", FETCHED_AT);
      expect(usage).toBeUndefined();
    }),
  );

  it.effect("returns undefined when no windows or credits are reported", () =>
    Effect.gen(function* () {
      const usage = yield* parseClaudeUsageResponse({}, FETCHED_AT);
      expect(usage).toBeUndefined();
    }),
  );
});
