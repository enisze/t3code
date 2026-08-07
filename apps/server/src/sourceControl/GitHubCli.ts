import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  TrimmedNonEmptyString,
  type SourceControlRepositoryVisibility,
  type VcsError,
} from "@t3tools/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  GitHubAccountResolver,
  gitHubAccountAuthEnv,
  type GitHubAccountResolution,
} from "./GitHubAccountResolver.ts";
import {
  decodeGitHubPullRequestJson,
  decodeGitHubPullRequestListJson,
} from "./gitHubPullRequests.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

const gitHubCliFailureFields = {
  command: Schema.Literal("gh"),
  cwd: Schema.String,
  cause: Schema.Defect(),
} as const;

export class GitHubCliUnavailableError extends Schema.TaggedErrorClass<GitHubCliUnavailableError>()(
  "GitHubCliUnavailableError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "GitHub CLI (`gh`) is required but not available on PATH.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

export class GitHubCliAuthenticationError extends Schema.TaggedErrorClass<GitHubCliAuthenticationError>()(
  "GitHubCliAuthenticationError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "GitHub CLI is not authenticated. Run `gh auth login` and retry.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

export class GitHubPullRequestNotFoundError extends Schema.TaggedErrorClass<GitHubPullRequestNotFoundError>()(
  "GitHubPullRequestNotFoundError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "Pull request not found. Check the PR number or URL and try again.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

export class GitHubCliCommandError extends Schema.TaggedErrorClass<GitHubCliCommandError>()(
  "GitHubCliCommandError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "GitHub CLI command failed.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

export class GitHubPermissionError extends Schema.TaggedErrorClass<GitHubPermissionError>()(
  "GitHubPermissionError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "The selected GitHub account doesn't have permission for this action. Check the account attached to this project in its settings.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

const gitHubAccountFailureFields = {
  command: Schema.Literal("gh"),
  cwd: Schema.String,
  host: Schema.String,
  login: Schema.String,
  cause: Schema.Defect(),
} as const;

/**
 * The project has a GitHub account attached, but that account isn't logged in
 * to `gh` (so no token could be minted for it). We refuse rather than fall back
 * to the machine's active account, which would run the command as the wrong
 * user.
 */
export class GitHubAccountNotLoggedInError extends Schema.TaggedErrorClass<GitHubAccountNotLoggedInError>()(
  "GitHubAccountNotLoggedInError",
  gitHubAccountFailureFields,
) {
  get detail(): string {
    return `The GitHub account "${this.login}" is selected for this project but isn't logged in to the GitHub CLI on ${this.host}. Run \`gh auth login\` for that account, or change the account in the project's settings.`;
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

export class GitHubMergeBlockedError extends Schema.TaggedErrorClass<GitHubMergeBlockedError>()(
  "GitHubMergeBlockedError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "GitHub wouldn't merge this pull request. It may have merge conflicts, failing required status checks, or branch protection rules that block the merge.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

const gitHubCliDecodeFields = {
  command: Schema.Literal("gh"),
  cwd: Schema.String,
  cause: Schema.Defect(),
} as const;

export class GitHubPullRequestListDecodeError extends Schema.TaggedErrorClass<GitHubPullRequestListDecodeError>()(
  "GitHubPullRequestListDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid PR list JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in listOpenPullRequests: ${this.detail}`;
  }
}

export class GitHubChangeRequestListDecodeError extends Schema.TaggedErrorClass<GitHubChangeRequestListDecodeError>()(
  "GitHubChangeRequestListDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid change request JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in listChangeRequests: ${this.detail}`;
  }
}

export class GitHubPullRequestDecodeError extends Schema.TaggedErrorClass<GitHubPullRequestDecodeError>()(
  "GitHubPullRequestDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid pull request JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in getPullRequest: ${this.detail}`;
  }
}

export class GitHubRepositoryDecodeError extends Schema.TaggedErrorClass<GitHubRepositoryDecodeError>()(
  "GitHubRepositoryDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid repository JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in getRepositoryCloneUrls: ${this.detail}`;
  }
}

export const GitHubCliError = Schema.Union([
  GitHubCliUnavailableError,
  GitHubCliAuthenticationError,
  GitHubAccountNotLoggedInError,
  GitHubPullRequestNotFoundError,
  GitHubPermissionError,
  GitHubMergeBlockedError,
  GitHubCliCommandError,
  GitHubPullRequestListDecodeError,
  GitHubChangeRequestListDecodeError,
  GitHubPullRequestDecodeError,
  GitHubRepositoryDecodeError,
]);
export type GitHubCliError = typeof GitHubCliError.Type;

export const isGitHubCliError = Schema.is(GitHubCliError);

export function fromVcsError(
  context: {
    readonly command: "gh";
    readonly cwd: string;
  },
  error: VcsError,
): GitHubCliError {
  if (
    error._tag === "VcsProcessSpawnError" &&
    error.cause instanceof PlatformError.PlatformError &&
    error.cause.reason._tag === "NotFound" &&
    error.cause.reason.module === "ChildProcess" &&
    error.cause.reason.method === "spawn"
  ) {
    return new GitHubCliUnavailableError({ ...context, cause: error });
  }

  if (error._tag === "VcsProcessExitError") {
    if (error.failureKind === "authentication") {
      return new GitHubCliAuthenticationError({ ...context, cause: error });
    }
    if (error.failureKind === "not-found") {
      return new GitHubPullRequestNotFoundError({ ...context, cause: error });
    }
    if (error.failureKind === "permission-denied") {
      return new GitHubPermissionError({ ...context, cause: error });
    }
    if (error.failureKind === "merge-blocked") {
      return new GitHubMergeBlockedError({ ...context, cause: error });
    }
  }

  return new GitHubCliCommandError({ ...context, cause: error });
}

export interface GitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly mergeability?: "clean" | "conflicting" | "blocked" | "unknown";
  readonly checks?: "passing" | "failing" | "pending" | "unknown";
  readonly failedCheckCount?: number;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export interface GitHubRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

export class GitHubCli extends Context.Service<
  GitHubCli,
  {
    readonly execute: (input: {
      readonly cwd: string;
      readonly args: ReadonlyArray<string>;
      readonly timeoutMs?: number;
    }) => Effect.Effect<VcsProcess.VcsProcessOutput, GitHubCliError>;

    readonly listOpenPullRequests: (input: {
      readonly cwd: string;
      readonly headSelector: string;
      readonly limit?: number;
    }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

    readonly getPullRequest: (input: {
      readonly cwd: string;
      readonly reference: string;
    }) => Effect.Effect<GitHubPullRequestSummary, GitHubCliError>;

    readonly getRepositoryCloneUrls: (input: {
      readonly cwd: string;
      readonly repository: string;
    }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

    readonly createRepository: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly visibility: SourceControlRepositoryVisibility;
    }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

    readonly createPullRequest: (input: {
      readonly cwd: string;
      readonly baseBranch: string;
      readonly headSelector: string;
      readonly title: string;
      readonly bodyFile: string;
    }) => Effect.Effect<void, GitHubCliError>;

    readonly getDefaultBranch: (input: {
      readonly cwd: string;
    }) => Effect.Effect<string | null, GitHubCliError>;

    readonly checkoutPullRequest: (input: {
      readonly cwd: string;
      readonly reference: string;
      readonly force?: boolean;
    }) => Effect.Effect<void, GitHubCliError>;

    readonly mergePullRequest: (input: {
      readonly cwd: string;
      readonly reference: string;
    }) => Effect.Effect<void, GitHubCliError>;
  }
>()("t3/sourceControl/GitHubCli") {}

const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});

const RawGitHubMergeMethodsSchema = Schema.Struct({
  mergeCommitAllowed: Schema.Boolean,
  squashMergeAllowed: Schema.Boolean,
  rebaseMergeAllowed: Schema.Boolean,
});
const decodeRawGitHubMergeMethods = Schema.decodeEffect(
  Schema.fromJsonString(RawGitHubMergeMethodsSchema),
);

const RawGitHubMergeabilitySchema = Schema.Struct({
  mergeable: Schema.String,
  mergeStateStatus: Schema.String,
});
const decodeRawGitHubMergeability = Schema.decodeEffect(
  Schema.fromJsonString(RawGitHubMergeabilitySchema),
);
const UNKNOWN_MERGEABILITY = {
  mergeable: "UNKNOWN",
  mergeStateStatus: "UNKNOWN",
} as const;

/**
 * Right after a pull request is opened (or its branch is pushed), GitHub reports
 * the mergeable state as `UNKNOWN` while it recomputes the merge in the
 * background. A merge attempted inside that window is rejected with a transient
 * "not mergeable" / "base branch was modified" error that our classifier can
 * only see as a hard `merge-blocked` failure. Reading the state forces GitHub to
 * compute it, so we poll (bounded) until it settles before merging.
 */
const MERGEABILITY_POLL_ATTEMPTS = 6;
const MERGEABILITY_POLL_INTERVAL = Duration.seconds(1);

/**
 * Even once mergeability is computed, GitHub can briefly return a transient
 * `merge-blocked` failure. Retry the merge itself a few times; a genuine
 * conflict, permission problem, or protection rule won't clear on retry, so we
 * only retry that one classified kind.
 */
const MERGE_ATTEMPTS = 3;
const MERGE_RETRY_INTERVAL = Duration.seconds(1);

/**
 * `gh pr merge` requires an explicit merge method; without one it drops into an
 * interactive prompt that has no TTY here and fails. Hardcoding `--merge` breaks
 * on the many repositories that disallow merge commits (squash- or rebase-only),
 * so pick a method the repository actually permits, preferring a real merge
 * commit, then squash, then rebase.
 */
function mergeMethodFlag(
  methods: Schema.Schema.Type<typeof RawGitHubMergeMethodsSchema>,
): "--merge" | "--squash" | "--rebase" | null {
  if (methods.mergeCommitAllowed) {
    return "--merge";
  }
  if (methods.squashMergeAllowed) {
    return "--squash";
  }
  if (methods.rebaseMergeAllowed) {
    return "--rebase";
  }
  return null;
}
const decodeRawGitHubRepositoryCloneUrls = Schema.decodeEffect(
  Schema.fromJsonString(RawGitHubRepositoryCloneUrlsSchema),
);

function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGitHubRepositoryCloneUrlsSchema>,
): GitHubRepositoryCloneUrls {
  return {
    nameWithOwner: raw.nameWithOwner,
    url: raw.url,
    sshUrl: raw.sshUrl,
  };
}

/**
 * `gh repo create` prints the canonical URL of the new repository on stdout
 * (e.g. `https://github.com/owner/repo`). Reading it back here avoids a
 * follow-up `gh repo view`, which can race GitHub's GraphQL eventual
 * consistency window and falsely report the just-created repo as missing.
 */
function deriveRepositoryCloneUrlsFromCreateOutput(
  stdout: string,
  repository: string,
): GitHubRepositoryCloneUrls {
  const fallbackHost = "github.com";
  const match = stdout.match(/https?:\/\/[^\s]+/);
  if (match) {
    const cleaned = match[0].replace(/\.git$/, "");
    try {
      const parsed = new URL(cleaned);
      const pathname = parsed.pathname.replace(/^\/+|\/+$/g, "");
      const segments = pathname.split("/").filter(Boolean);
      if (segments.length === 2) {
        const nameWithOwner = `${segments[0]}/${segments[1]}`;
        return {
          nameWithOwner,
          url: `${parsed.origin}/${nameWithOwner}`,
          sshUrl: `git@${parsed.host}:${nameWithOwner}.git`,
        };
      }
    } catch {
      // Fall through to the input-derived defaults below.
    }
  }
  return {
    nameWithOwner: repository,
    url: `https://${fallbackHost}/${repository}`,
    sshUrl: `git@${fallbackHost}:${repository}.git`,
  };
}

export const make = Effect.gen(function* () {
  const process = yield* VcsProcess.VcsProcess;

  const execute: GitHubCli["Service"]["execute"] = (input) =>
    Effect.serviceOption(GitHubAccountResolver).pipe(
      Effect.flatMap(
        (resolverOption): Effect.Effect<GitHubAccountResolution> =>
          Option.isNone(resolverOption)
            ? Effect.succeed({ _tag: "ambient" })
            : resolverOption.value.resolveForCwd(input.cwd),
      ),
      Effect.flatMap((resolution) => {
        // The project selected an account we can't act as. Refuse instead of
        // silently running `gh` as the machine's active (wrong) account.
        if (resolution._tag === "unavailable") {
          return Effect.fail(
            new GitHubAccountNotLoggedInError({
              command: "gh",
              cwd: input.cwd,
              host: resolution.account.host,
              login: resolution.account.login,
              cause: new Error("gh could not mint a token for the selected account"),
            }),
          );
        }
        return process
          .run({
            operation: "GitHubCli.execute",
            command: "gh",
            args: input.args,
            cwd: input.cwd,
            timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            // The full auth env, not the `gh`-only one: `gh` shells out to `git`
            // for the network half of `pr create` (pushing a branch with no
            // upstream) and `pr checkout`, and those children would otherwise
            // fall back to the machine credential helper.
            ...(resolution._tag === "resolved"
              ? { env: gitHubAccountAuthEnv(resolution, globalThis.process.env) }
              : {}),
          })
          .pipe(Effect.mapError((error) => fromVcsError({ command: "gh", cwd: input.cwd }, error)));
      }),
    );

  const resolveMergeMethodFlag = (cwd: string) =>
    execute({
      cwd,
      args: ["repo", "view", "--json", "mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed"],
    }).pipe(
      Effect.flatMap((output) =>
        decodeRawGitHubMergeMethods(output.stdout).pipe(
          // If the settings can't be read, fall back to a plain merge commit
          // and let GitHub surface the real reason if that method is refused.
          Effect.orElseSucceed(() => ({
            mergeCommitAllowed: true,
            squashMergeAllowed: false,
            rebaseMergeAllowed: false,
          })),
        ),
      ),
      Effect.map(mergeMethodFlag),
    );

  const awaitMergeabilityComputed = (cwd: string, reference: string) =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < MERGEABILITY_POLL_ATTEMPTS; attempt++) {
        const state = yield* execute({
          cwd,
          args: ["pr", "view", reference, "--json", "mergeable,mergeStateStatus"],
        }).pipe(
          Effect.flatMap((output) =>
            decodeRawGitHubMergeability(output.stdout).pipe(
              Effect.orElseSucceed(() => UNKNOWN_MERGEABILITY),
            ),
          ),
          // A failed read must not abort the merge; fall through and let the
          // merge itself report any real problem.
          Effect.orElseSucceed(() => UNKNOWN_MERGEABILITY),
        );
        if (state.mergeable !== "UNKNOWN") {
          return;
        }
        if (attempt < MERGEABILITY_POLL_ATTEMPTS - 1) {
          yield* Effect.sleep(MERGEABILITY_POLL_INTERVAL);
        }
      }
    });

  const attemptMerge = (
    cwd: string,
    args: ReadonlyArray<string>,
    attemptsLeft: number,
  ): Effect.Effect<void, GitHubCliError> =>
    execute({ cwd, args }).pipe(
      Effect.asVoid,
      Effect.catchTag("GitHubMergeBlockedError", (error) =>
        attemptsLeft <= 1
          ? Effect.fail(error)
          : Effect.sleep(MERGE_RETRY_INTERVAL).pipe(
              Effect.flatMap(() => attemptMerge(cwd, args, attemptsLeft - 1)),
            ),
      ),
    );

  return GitHubCli.of({
    execute,
    listOpenPullRequests: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "list",
          "--head",
          input.headSelector,
          "--state",
          "open",
          "--limit",
          String(input.limit ?? 1),
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner,mergeable,mergeStateStatus,statusCheckRollup",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => decodeGitHubPullRequestListJson(raw)).pipe(
                Effect.flatMap((decoded) => {
                  if (!Result.isSuccess(decoded)) {
                    return Effect.fail(
                      new GitHubPullRequestListDecodeError({
                        command: "gh",
                        cwd: input.cwd,
                        cause: decoded.failure,
                      }),
                    );
                  }

                  return Effect.succeed(
                    decoded.success.map(({ updatedAt: _updatedAt, ...summary }) => summary),
                  );
                }),
              ),
        ),
      ),
    getPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "view",
          input.reference,
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner,mergeable,mergeStateStatus,statusCheckRollup",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => decodeGitHubPullRequestJson(raw)).pipe(
            Effect.flatMap((decoded) => {
              if (!Result.isSuccess(decoded)) {
                return Effect.fail(
                  new GitHubPullRequestDecodeError({
                    command: "gh",
                    cwd: input.cwd,
                    cause: decoded.failure,
                  }),
                );
              }

              return Effect.succeed(
                (({ updatedAt: _updatedAt, ...summary }) => summary)(decoded.success),
              );
            }),
          ),
        ),
      ),
    getRepositoryCloneUrls: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", input.repository, "--json", "nameWithOwner,url,sshUrl"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeRawGitHubRepositoryCloneUrls(raw).pipe(
            Effect.mapError(
              (cause) =>
                new GitHubRepositoryDecodeError({
                  command: "gh",
                  cwd: input.cwd,
                  cause,
                }),
            ),
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    createRepository: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "create", input.repository, `--${input.visibility}`],
      }).pipe(
        Effect.map((result) =>
          deriveRepositoryCloneUrlsFromCreateOutput(result.stdout, input.repository),
        ),
      ),
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "create",
          "--base",
          input.baseBranch,
          "--head",
          input.headSelector,
          "--title",
          input.title,
          "--body-file",
          input.bodyFile,
        ],
      }).pipe(Effect.asVoid),
    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
    mergePullRequest: (input) =>
      resolveMergeMethodFlag(input.cwd).pipe(
        // Force GitHub to finish computing mergeability before we merge, so a
        // merge fired right after create/push doesn't race a transient
        // "not mergeable" rejection.
        Effect.tap(() => awaitMergeabilityComputed(input.cwd, input.reference)),
        Effect.flatMap((flag) =>
          attemptMerge(
            input.cwd,
            ["pr", "merge", input.reference, ...(flag ? [flag] : ["--merge"])],
            MERGE_ATTEMPTS,
          ),
        ),
      ),
  });
});

export const layer = Layer.effect(GitHubCli, make);
