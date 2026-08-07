import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString } from "@t3tools/contracts";
import { decodeJsonResult, formatSchemaError } from "@t3tools/shared/schemaJson";

export interface NormalizedGitHubPullRequestRecord {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state: "open" | "closed" | "merged";
  readonly mergeability?: "clean" | "conflicting" | "blocked" | "unknown";
  readonly checks?: "passing" | "failing" | "pending" | "unknown";
  readonly updatedAt: Option.Option<DateTime.Utc>;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

const GitHubPullRequestSchema = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  baseRefName: TrimmedNonEmptyString,
  headRefName: TrimmedNonEmptyString,
  state: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.NullOr(Schema.String)),
  mergeable: Schema.optional(Schema.NullOr(Schema.String)),
  mergeStateStatus: Schema.optional(Schema.NullOr(Schema.String)),
  statusCheckRollup: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          status: Schema.optional(Schema.NullOr(Schema.String)),
          conclusion: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      ),
    ),
  ),
  updatedAt: Schema.optional(Schema.OptionFromNullOr(Schema.DateTimeUtcFromString)),
  isCrossRepository: Schema.optional(Schema.Boolean),
  // gh < 2.47 exports headRepository as {id, name} only; nameWithOwner was
  // added later. Both fields stay optional so a version-drifted gh CLI can
  // never fail the decode and silently drop the PR from the list.
  headRepository: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        nameWithOwner: Schema.optional(Schema.NullOr(Schema.String)),
        name: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  headRepositoryOwner: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        login: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
});

function trimOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeGitHubPullRequestState(input: {
  state?: string | null | undefined;
  mergedAt?: string | null | undefined;
}): "open" | "closed" | "merged" {
  const normalizedState = input.state?.trim().toUpperCase();
  if (
    (typeof input.mergedAt === "string" && input.mergedAt.trim().length > 0) ||
    normalizedState === "MERGED"
  ) {
    return "merged";
  }
  if (normalizedState === "CLOSED") {
    return "closed";
  }
  return "open";
}

function normalizeGitHubPullRequestRecord(
  raw: Schema.Schema.Type<typeof GitHubPullRequestSchema>,
): NormalizedGitHubPullRequestRecord {
  const explicitNameWithOwner = trimOptionalString(raw.headRepository?.nameWithOwner);
  const headRepositoryName = trimOptionalString(raw.headRepository?.name);
  const headRepositoryOwnerLogin =
    trimOptionalString(raw.headRepositoryOwner?.login) ??
    (explicitNameWithOwner?.includes("/") ? (explicitNameWithOwner.split("/")[0] ?? null) : null);
  const headRepositoryNameWithOwner =
    explicitNameWithOwner ??
    (headRepositoryOwnerLogin && headRepositoryName
      ? `${headRepositoryOwnerLogin}/${headRepositoryName}`
      : null);
  const mergeable = raw.mergeable?.toUpperCase();
  const mergeStateStatus = raw.mergeStateStatus?.toUpperCase();
  const mergeability =
    mergeable === "CONFLICTING" || mergeStateStatus === "DIRTY"
      ? "conflicting"
      : mergeable === "MERGEABLE" && mergeStateStatus === "CLEAN"
        ? "clean"
        : mergeStateStatus === "BLOCKED" || mergeStateStatus === "UNSTABLE"
          ? "blocked"
          : "unknown";
  const checks =
    raw.statusCheckRollup == null
      ? undefined
      : (() => {
          const rollup = raw.statusCheckRollup ?? [];
          if (rollup.length === 0) return "passing" as const;
          const failing = new Set([
            "FAILURE",
            "CANCELLED",
            "TIMED_OUT",
            "ACTION_REQUIRED",
            "STARTUP_FAILURE",
          ]);
          if (rollup.some((check) => failing.has(check.conclusion?.toUpperCase() ?? ""))) {
            return "failing" as const;
          }
          if (
            rollup.some(
              (check) =>
                check.status?.toUpperCase() !== "COMPLETED" ||
                !check.conclusion ||
                check.conclusion.toUpperCase() === "NEUTRAL",
            )
          ) {
            return "pending" as const;
          }
          return "passing" as const;
        })();

  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    state: normalizeGitHubPullRequestState(raw),
    ...(raw.mergeable != null || raw.mergeStateStatus != null ? { mergeability } : {}),
    ...(checks ? { checks } : {}),
    updatedAt: raw.updatedAt ?? Option.none(),
    ...(typeof raw.isCrossRepository === "boolean"
      ? { isCrossRepository: raw.isCrossRepository }
      : {}),
    ...(headRepositoryNameWithOwner ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin ? { headRepositoryOwnerLogin } : {}),
  };
}

const decodeGitHubPullRequestList = decodeJsonResult(Schema.Array(Schema.Unknown));
const decodeGitHubPullRequest = decodeJsonResult(GitHubPullRequestSchema);
const decodeGitHubPullRequestEntry = Schema.decodeUnknownExit(GitHubPullRequestSchema);

export const formatGitHubJsonDecodeError = formatSchemaError;

export function decodeGitHubPullRequestListJson(
  raw: string,
): Result.Result<
  ReadonlyArray<NormalizedGitHubPullRequestRecord>,
  Cause.Cause<Schema.SchemaError>
> {
  const result = decodeGitHubPullRequestList(raw);
  if (Result.isSuccess(result)) {
    const pullRequests: NormalizedGitHubPullRequestRecord[] = [];
    for (const entry of result.success) {
      const decodedEntry = decodeGitHubPullRequestEntry(entry);
      if (Exit.isFailure(decodedEntry)) {
        continue;
      }
      pullRequests.push(normalizeGitHubPullRequestRecord(decodedEntry.value));
    }
    return Result.succeed(pullRequests);
  }
  return Result.fail(result.failure);
}

export function decodeGitHubPullRequestJson(
  raw: string,
): Result.Result<NormalizedGitHubPullRequestRecord, Cause.Cause<Schema.SchemaError>> {
  const result = decodeGitHubPullRequest(raw);
  if (Result.isSuccess(result)) {
    return Result.succeed(normalizeGitHubPullRequestRecord(result.success));
  }
  return Result.fail(result.failure);
}
