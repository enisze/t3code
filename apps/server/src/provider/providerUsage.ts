import type { ClaudeSettings, ProviderUsage, ProviderUsageWindow } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import * as CodexSchema from "effect-codex-app-server/schema";

import { makeClaudeCredentialsServiceName, resolveClaudeConfigDir } from "./Drivers/ClaudeHome.ts";
import { spawnAndCollect } from "./providerSnapshot.ts";

// ── Shared helpers ──────────────────────────────────────────────────

/**
 * Convert an upstream epoch reset timestamp to an ISO-8601 string. Providers
 * report these in seconds; values that look like milliseconds (>1e12) are
 * handled defensively. Returns `null` for missing/invalid input so the field
 * degrades gracefully rather than throwing.
 */
function epochToIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const millis = value > 1_000_000_000_000 ? value : value * 1_000;
  const dt = DateTime.makeUnsafe(millis);
  return DateTime.formatIso(dt);
}

/** Clamp an arbitrary number into the 0–100 percentage range. */
function clampPercent(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Human-friendly label for a window given its nominal length in minutes.
 * Falls back to the supplied default when the length is unknown.
 */
function labelFromMinutes(minutes: number | null | undefined, fallback: string): string {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) {
    return fallback;
  }
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) {
    const rounded = Number.isInteger(hours) ? `${hours}` : hours.toFixed(1);
    return `${rounded}-hour`;
  }
  const days = hours / 24;
  if (days === 1) return "Daily";
  if (days === 7) return "Weekly";
  if (days >= 28 && days <= 31) return "Monthly";
  const rounded = Number.isInteger(days) ? `${days}` : days.toFixed(1);
  return `${rounded}-day`;
}

// ── Codex normalization ─────────────────────────────────────────────

const CODEX_PLAN_LABELS: Readonly<
  Record<CodexSchema.V2GetAccountRateLimitsResponse["rateLimits"]["planType"] & string, string>
> = {
  free: "ChatGPT Free",
  go: "ChatGPT Go",
  plus: "ChatGPT Plus",
  pro: "ChatGPT Pro 20x",
  prolite: "ChatGPT Pro 5x",
  team: "ChatGPT Team",
  self_serve_business_usage_based: "ChatGPT Business",
  business: "ChatGPT Business",
  enterprise_cbp_usage_based: "ChatGPT Enterprise",
  enterprise: "ChatGPT Enterprise",
  edu: "ChatGPT Edu",
  unknown: "ChatGPT",
};

/**
 * Normalize a Codex `account/rateLimits/read` response into the shared
 * `ProviderUsage` shape. Returns `null` when there is nothing meaningful to
 * show (no windows and no credit info).
 */
export function normalizeCodexRateLimits(
  response: CodexSchema.V2GetAccountRateLimitsResponse,
  fetchedAt: string,
): ProviderUsage | null {
  const rl = response.rateLimits;
  const windows: ProviderUsageWindow[] = [];

  if (rl.primary) {
    windows.push({
      kind: "primary",
      label: labelFromMinutes(rl.primary.windowDurationMins, "Current"),
      usedPercent: clampPercent(rl.primary.usedPercent),
      resetsAt: epochToIso(rl.primary.resetsAt),
      windowMinutes: rl.primary.windowDurationMins ?? null,
    });
  }
  if (rl.secondary) {
    windows.push({
      kind: "secondary",
      label: labelFromMinutes(rl.secondary.windowDurationMins, "Weekly"),
      usedPercent: clampPercent(rl.secondary.usedPercent),
      resetsAt: epochToIso(rl.secondary.resetsAt),
      windowMinutes: rl.secondary.windowDurationMins ?? null,
    });
  }

  const planLabel = rl.limitName ?? (rl.planType ? CODEX_PLAN_LABELS[rl.planType] : null) ?? null;

  const credits = rl.credits
    ? {
        balance: rl.credits.balance ?? null,
        hasCredits: rl.credits.hasCredits,
        unlimited: rl.credits.unlimited,
        monthlyLimit: null,
        used: null,
      }
    : undefined;

  if (windows.length === 0 && !credits) {
    return null;
  }

  return {
    source: "codex",
    fetchedAt,
    planLabel,
    windows,
    ...(credits ? { credits } : {}),
  } satisfies ProviderUsage;
}

// ── Claude normalization + fetch ────────────────────────────────────

// The usage endpoint returns `null` for numeric fields that aren't currently
// populated (e.g. `utilization: null` on `extra_usage` when credit usage isn't
// metered as a percentage). Every number must therefore accept null — a single
// unexpected null previously failed the whole decode, silently dropping all
// Claude usage. `clampPercent` already normalizes null/undefined to 0.
const ClaudeUsageWindow = Schema.Struct({
  utilization: Schema.optional(Schema.NullOr(Schema.Number)),
  resets_at: Schema.optional(Schema.NullOr(Schema.String)),
});

const ClaudeExtraUsage = Schema.Struct({
  is_enabled: Schema.optional(Schema.NullOr(Schema.Boolean)),
  monthly_limit: Schema.optional(Schema.NullOr(Schema.Number)),
  used_credits: Schema.optional(Schema.NullOr(Schema.Number)),
  utilization: Schema.optional(Schema.NullOr(Schema.Number)),
});

const ClaudeOAuthUsageResponse = Schema.Struct({
  five_hour: Schema.optional(Schema.NullOr(ClaudeUsageWindow)),
  seven_day: Schema.optional(Schema.NullOr(ClaudeUsageWindow)),
  seven_day_opus: Schema.optional(Schema.NullOr(ClaudeUsageWindow)),
  seven_day_sonnet: Schema.optional(Schema.NullOr(ClaudeUsageWindow)),
  extra_usage: Schema.optional(Schema.NullOr(ClaudeExtraUsage)),
});
type ClaudeOAuthUsageResponse = typeof ClaudeOAuthUsageResponse.Type;

const ClaudeCredentialsFile = Schema.Struct({
  claudeAiOauth: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        accessToken: Schema.optional(Schema.String),
      }),
    ),
  ),
});
const ClaudeCredentialsFileJson = Schema.fromJsonString(ClaudeCredentialsFile);

/**
 * Normalize an Anthropic `/api/oauth/usage` response into `ProviderUsage`.
 * `utilization` is already on a 0–100 scale and `resets_at` is ISO-8601.
 */
function normalizeClaudeUsage(
  response: ClaudeOAuthUsageResponse,
  fetchedAt: string,
): ProviderUsage | null {
  const windows: ProviderUsageWindow[] = [];

  const push = (
    kind: ProviderUsageWindow["kind"],
    label: string,
    minutes: number,
    window: typeof ClaudeUsageWindow.Type | null | undefined,
  ) => {
    if (!window) return;
    windows.push({
      kind,
      label,
      usedPercent: clampPercent(window.utilization),
      resetsAt: window.resets_at ?? null,
      windowMinutes: minutes,
    });
  };

  push("five_hour", "5-hour", 300, response.five_hour);
  push("seven_day", "Weekly", 10_080, response.seven_day);
  push("seven_day_opus", "Weekly (Opus)", 10_080, response.seven_day_opus);
  push("seven_day_sonnet", "Weekly (Sonnet)", 10_080, response.seven_day_sonnet);

  const extra = response.extra_usage;
  const credits =
    extra && extra.is_enabled
      ? {
          balance: null,
          hasCredits: (extra.used_credits ?? 0) < (extra.monthly_limit ?? 0),
          unlimited: false,
          monthlyLimit: extra.monthly_limit ?? null,
          used: extra.used_credits ?? null,
        }
      : undefined;

  if (windows.length === 0 && !credits) {
    return null;
  }

  return {
    source: "claude",
    fetchedAt,
    planLabel: null,
    windows,
    ...(credits ? { credits } : {}),
  } satisfies ProviderUsage;
}

/**
 * Resolve the Claude OAuth access token for an instance. Prefers the
 * on-disk `.credentials.json` inside the instance's `CLAUDE_CONFIG_DIR`
 * (correct per-instance, used on Linux and by disk-backed instances) and
 * falls back to the macOS login keychain entry, which Claude Code uses by
 * default on macOS. The keychain service name is derived per-instance
 * (`makeClaudeCredentialsServiceName`) so each account reads its own token
 * rather than sharing the default account's. Returns `null` when no token
 * can be recovered.
 */
const resolveClaudeAccessToken = Effect.fn("resolveClaudeAccessToken")(function* (
  claudeSettings: Pick<ClaudeSettings, "homePath">,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configDir = yield* resolveClaudeConfigDir(claudeSettings);
  const credentialsPath = path.join(configDir, ".credentials.json");

  const decodeToken = (raw: string) =>
    Schema.decodeUnknownEffect(ClaudeCredentialsFileJson)(raw).pipe(
      Effect.map((parsed) => parsed.claudeAiOauth?.accessToken?.trim() || null),
      Effect.orElseSucceed(() => null),
    );

  const fromFile = yield* fs.exists(credentialsPath).pipe(
    Effect.flatMap((exists) =>
      exists
        ? fs.readFileString(credentialsPath).pipe(Effect.flatMap(decodeToken))
        : Effect.succeed(null),
    ),
    Effect.orElseSucceed(() => null),
  );
  if (fromFile) return fromFile;

  if (process.platform !== "darwin") return null;

  // Each non-default CLAUDE_CONFIG_DIR gets its own keychain entry
  // (`Claude Code-credentials-<sha256(configDir)[:8]>`); the default account
  // uses the bare service name. Querying the correct per-instance service is
  // what keeps two accounts from reporting the same usage/limits.
  const service = yield* makeClaudeCredentialsServiceName(claudeSettings);
  const keychain = yield* spawnAndCollect(
    "security",
    ChildProcess.make("security", ["find-generic-password", "-s", service, "-w"]),
    // `catchCause` (not `orElseSucceed`) so a spawn defect — e.g. `security`
    // missing, or a stubbed spawner throwing — degrades to "no token" instead
    // of surfacing as a fiber defect.
  ).pipe(Effect.catchCause(() => Effect.succeed(null)));

  if (!keychain || keychain.code !== 0) return null;
  return yield* decodeToken(keychain.stdout);
});

/**
 * Best-effort fetch of Claude subscription usage windows via the Anthropic
 * `/api/oauth/usage` endpoint. Never fails: any error (missing token, network
 * failure, unexpected shape) resolves to `undefined` so it cannot break a
 * provider status probe. Only meaningful for OAuth subscription accounts —
 * callers should skip API-key / Bedrock auth.
 */
export const fetchClaudeAccountUsage = Effect.fn("fetchClaudeAccountUsage")(function* (input: {
  readonly claudeSettings: Pick<ClaudeSettings, "homePath">;
  readonly cliVersion: string | null;
  readonly fetchedAt: string;
}) {
  const token = yield* resolveClaudeAccessToken(input.claudeSettings).pipe(
    Effect.orElseSucceed(() => null),
  );
  if (!token) return undefined;

  const client = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.get("https://api.anthropic.com/api/oauth/usage").pipe(
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.setHeader("anthropic-beta", "oauth-2025-04-20"),
    HttpClientRequest.setHeader("user-agent", `claude-code/${input.cliVersion ?? "2.0.0"}`),
    HttpClientRequest.setHeader("accept", "application/json"),
  );

  const response = yield* client.execute(request).pipe(
    Effect.timeoutOption(8_000),
    Effect.orElseSucceed(() => Option.none()),
  );
  if (Option.isNone(response)) return undefined;

  const httpResponse = response.value;
  if (httpResponse.status < 200 || httpResponse.status >= 300) {
    return undefined;
  }

  const rawJson = yield* httpResponse.json.pipe(Effect.orElseSucceed(() => undefined));
  if (rawJson === undefined) return undefined;

  return yield* parseClaudeUsageResponse(rawJson, input.fetchedAt);
});

/**
 * Decode a raw `/api/oauth/usage` body and normalize it into `ProviderUsage`.
 * Returns `undefined` when the body can't be decoded or carries no usable
 * windows/credits. Extracted from the fetch so the decode contract (which the
 * live endpoint stresses with unexpected `null`s) is unit-testable.
 */
export const parseClaudeUsageResponse = Effect.fn("parseClaudeUsageResponse")(function* (
  raw: unknown,
  fetchedAt: string,
) {
  const payload = yield* Schema.decodeUnknownEffect(ClaudeOAuthUsageResponse)(raw).pipe(
    Effect.orElseSucceed(() => null),
  );
  if (!payload) return undefined;

  return normalizeClaudeUsage(payload, fetchedAt) ?? undefined;
});
