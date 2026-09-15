import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { prioritizeActiveProvider, resolveProviderUsage } from "./providerUsage";

const provider = {
  instanceId: ProviderInstanceId.make("claude"),
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-08T10:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
} satisfies ServerProvider;

describe("resolveProviderUsage", () => {
  it("prefers runtime-updated usage limits over a stale legacy snapshot", () => {
    const usage = resolveProviderUsage({
      ...provider,
      usage: {
        source: "claude",
        fetchedAt: "2026-09-08T10:00:00.000Z",
        planLabel: "Max",
        windows: [
          {
            kind: "five_hour",
            label: "5-hour",
            usedPercent: 12,
            resetsAt: null,
            windowMinutes: 300,
          },
        ],
        credits: {
          balance: null,
          hasCredits: true,
          unlimited: false,
          monthlyLimit: 100,
          used: 5,
        },
      },
      usageLimits: {
        checkedAt: "2026-09-08T10:05:00.000Z",
        windows: [
          {
            id: "five_hour",
            kind: "session",
            label: "Session",
            usedPercent: 34,
            resetsAt: "2026-09-08T15:00:00.000Z",
            windowDurationMins: 300,
          },
        ],
      },
    });

    expect(usage).toMatchObject({
      source: "claude",
      fetchedAt: "2026-09-08T10:05:00.000Z",
      planLabel: "Max",
      credits: { used: 5 },
      windows: [
        {
          kind: "five_hour",
          usedPercent: 34,
          resetsAt: "2026-09-08T15:00:00.000Z",
          windowMinutes: 300,
        },
      ],
    });
  });

  it("falls back to legacy usage when current limits have no windows", () => {
    const legacyUsage = {
      source: "claude" as const,
      fetchedAt: "2026-09-08T10:00:00.000Z",
      planLabel: null,
      windows: [
        {
          kind: "five_hour" as const,
          label: "5-hour",
          usedPercent: 12,
          resetsAt: null,
          windowMinutes: 300,
        },
      ],
    };

    expect(
      resolveProviderUsage({
        ...provider,
        usage: legacyUsage,
        usageLimits: {
          checkedAt: "2026-09-08T10:05:00.000Z",
          windows: [],
          unavailable: { reason: "probeFailed" },
        },
      }),
    ).toBe(legacyUsage);
  });
});

describe("prioritizeActiveProvider", () => {
  it("moves the active chat provider first and preserves the order of the rest", () => {
    const claude = { instanceId: ProviderInstanceId.make("claude") };
    const codex = { instanceId: ProviderInstanceId.make("codex") };
    const grok = { instanceId: ProviderInstanceId.make("grok") };

    expect(prioritizeActiveProvider([claude, codex, grok], codex.instanceId)).toEqual([
      codex,
      claude,
      grok,
    ]);
  });

  it("leaves the provider order alone outside a supported active chat", () => {
    const providers = [
      { instanceId: ProviderInstanceId.make("claude") },
      { instanceId: ProviderInstanceId.make("codex") },
    ];

    expect(prioritizeActiveProvider(providers, null)).toBe(providers);
    expect(prioritizeActiveProvider(providers, ProviderInstanceId.make("grok"))).toBe(providers);
  });
});
