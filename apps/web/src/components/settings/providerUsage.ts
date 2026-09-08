import type {
  ProviderUsage,
  ProviderUsageWindow,
  ProviderUsageWindowKind,
  ServerProvider,
} from "@t3tools/contracts";

const LEGACY_WINDOW_KINDS = new Set<string>([
  "five_hour",
  "seven_day",
  "seven_day_opus",
  "seven_day_sonnet",
  "monthly",
  "primary",
  "secondary",
  "overage",
  "unknown",
]);

/**
 * Adapt the current cross-provider limits onto the meter's legacy shape.
 * Runtime rate-limit events update only `usageLimits`, so it must win whenever
 * it has windows; `usage` remains useful as a fallback and for account metadata.
 */
export function resolveProviderUsage(provider: ServerProvider): ProviderUsage | null {
  const limits = provider.usageLimits;
  if (limits !== undefined && limits.windows.length > 0) {
    return {
      source: provider.usage?.source ?? (provider.driver === "claudeAgent" ? "claude" : "codex"),
      fetchedAt: limits.checkedAt,
      planLabel: provider.usage?.planLabel ?? null,
      windows: limits.windows.map((window): ProviderUsageWindow => ({
        kind: (LEGACY_WINDOW_KINDS.has(window.id)
          ? window.id
          : "unknown") as ProviderUsageWindowKind,
        label: window.label,
        usedPercent: window.usedPercent,
        resetsAt: window.resetsAt ?? null,
        windowMinutes: window.windowDurationMins ?? null,
      })),
      ...(provider.usage?.credits ? { credits: provider.usage.credits } : {}),
    };
  }
  if (provider.usage !== undefined && provider.usage.windows.length > 0) {
    return provider.usage;
  }
  return null;
}
