/**
 * GitHubAccountResolver - resolves the per-project GitHub account (if any)
 * that a `gh`/`git` command running in a given `cwd` should act as.
 *
 * Projects can attach one of the accounts already authenticated in the `gh`
 * CLI (see `gh auth status`). This service maps a working directory back to
 * its project — either directly by workspace root or via a thread worktree —
 * reads the attached account, and materializes the token for that account with
 * `gh auth token --user <login> --hostname <host>`. The token is fetched on
 * demand (never persisted by T3) and cached briefly so back-to-back commands
 * don't re-shell for every invocation.
 *
 * Callers merge {@link gitHubAccountGhEnv} into their `gh` process env. Because
 * this is resolved through {@link Effect.serviceOption}, `gh` commands work
 * unchanged when the resolver is not provided (tests, minimal layers) — they
 * simply fall back to the machine-global active account.
 *
 * @module GitHubAccountResolver
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import type { GitHubAccountRef } from "@t3tools/contracts";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

const TOKEN_TTL_MS = 5 * 60_000;
const GH_AUTH_TOKEN_TIMEOUT_MS = 10_000;

export interface ResolvedGitHubAccount {
  readonly account: GitHubAccountRef;
  readonly token: string;
}

export class GitHubAccountResolver extends Context.Service<
  GitHubAccountResolver,
  {
    /**
     * Resolve the GitHub account a command running in `cwd` should act as,
     * along with a freshly materialized token. Returns null when the owning
     * project has no account attached, when the token cannot be resolved, or
     * when `cwd` maps to no known project — the caller then falls back to the
     * machine-global active account.
     */
    readonly resolveForCwd: (cwd: string) => Effect.Effect<ResolvedGitHubAccount | null>;
  }
>()("t3/sourceControl/GitHubAccountResolver") {}

/**
 * Environment overrides that make a `gh` invocation act as `resolved`'s
 * account. `github.com` uses `GH_TOKEN`; any other host is treated as a GitHub
 * Enterprise host and uses `GH_ENTERPRISE_TOKEN`. Merged onto the parent env by
 * the process runner, so only the delta is returned.
 */
export function gitHubAccountGhEnv(resolved: ResolvedGitHubAccount): NodeJS.ProcessEnv {
  const host = resolved.account.host;
  const tokenVar = host === "github.com" ? "GH_TOKEN" : "GH_ENTERPRISE_TOKEN";
  return {
    GH_HOST: host,
    [tokenVar]: resolved.token,
  };
}

/**
 * Environment that makes BOTH `gh` and plain `git` (push/fetch over HTTPS) act
 * as `resolved`'s account, for a single process (e.g. an interactive terminal
 * or a one-off git command) — without touching global config or running
 * `gh auth switch`.
 *
 * On top of {@link gitHubAccountGhEnv} (which points `gh` at the account via
 * `GH_TOKEN`/`GH_ENTERPRISE_TOKEN` + `GH_HOST`), this wires git's credential
 * helper to GitHub CLI via `GIT_CONFIG_*` env keys — equivalent to
 * `gh auth setup-git` but scoped to this process only. The leading empty helper
 * resets any inherited helper (OS keychain, global config) so the selected
 * account wins; `!gh auth git-credential` then returns the `GH_TOKEN` above.
 * This is the same mechanism CI uses (`GH_TOKEN` + gh credential helper).
 */
export function gitHubAccountAuthEnv(resolved: ResolvedGitHubAccount): NodeJS.ProcessEnv {
  const baseUrl = `https://${resolved.account.host}`;
  return {
    ...gitHubAccountGhEnv(resolved),
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: `credential.${baseUrl}.helper`,
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: `credential.${baseUrl}.helper`,
    GIT_CONFIG_VALUE_1: "!gh auth git-credential",
  };
}

/**
 * True when `cwd` is `base` itself or lives beneath it. Compares normalized,
 * separator-terminated paths so `/a/repo` does not match `/a/repo-2`.
 */
function isWithin(cwd: string, base: string): boolean {
  if (base.length === 0) return false;
  const normalizedBase = base.replace(/[/\\]+$/, "");
  if (cwd === normalizedBase) return true;
  return cwd.startsWith(`${normalizedBase}/`) || cwd.startsWith(`${normalizedBase}\\`);
}

interface CachedToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

function cacheKey(account: GitHubAccountRef): string {
  return `${account.host}\n${account.login}`;
}

export const make = Effect.gen(function* () {
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const process = yield* VcsProcess.VcsProcess;
  const tokenCache = yield* Ref.make(new Map<string, CachedToken>());

  /**
   * Find the account attached to the project owning `cwd`. Matches the longest
   * project workspace root or thread worktree path that contains `cwd`, so a
   * worktree checked out outside the project root still resolves.
   */
  const findAccountForCwd = (cwd: string): Effect.Effect<GitHubAccountRef | null> =>
    snapshotQuery.getShellSnapshot().pipe(
      Effect.map((snapshot) => {
        const accountByProjectId = new Map(
          snapshot.projects
            .filter((project) => project.gitHubAccount !== null)
            .map((project) => [project.id, project.gitHubAccount] as const),
        );

        let bestPathLength = -1;
        let bestAccount: GitHubAccountRef | null = null;
        const consider = (basePath: string, account: GitHubAccountRef | null) => {
          if (account === null) return;
          if (!isWithin(cwd, basePath)) return;
          if (basePath.length > bestPathLength) {
            bestPathLength = basePath.length;
            bestAccount = account;
          }
        };

        for (const project of snapshot.projects) {
          consider(project.workspaceRoot, project.gitHubAccount);
        }
        for (const thread of snapshot.threads) {
          if (thread.worktreePath === null) continue;
          consider(thread.worktreePath, accountByProjectId.get(thread.projectId) ?? null);
        }

        return bestAccount;
      }),
      // A projection read failure must not break the underlying git/gh command;
      // fall back to the ambient account.
      Effect.catch(() => Effect.succeed(null)),
    );

  const resolveToken = (cwd: string, account: GitHubAccountRef): Effect.Effect<string | null> =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const cache = yield* Ref.get(tokenCache);
      const cached = cache.get(cacheKey(account));
      if (cached !== undefined && cached.expiresAtMs > now) {
        return cached.token;
      }

      const result = yield* process
        .run({
          operation: "GitHubAccountResolver.resolveToken",
          command: "gh",
          args: ["auth", "token", "--user", account.login, "--hostname", account.host],
          cwd,
          timeoutMs: GH_AUTH_TOKEN_TIMEOUT_MS,
        })
        .pipe(Effect.option);

      if (result._tag === "None") {
        return null;
      }
      const token = result.value.stdout.trim();
      if (token.length === 0) {
        return null;
      }

      yield* Ref.update(tokenCache, (current) => {
        const next = new Map(current);
        next.set(cacheKey(account), { token, expiresAtMs: now + TOKEN_TTL_MS });
        return next;
      });
      return token;
    });

  const resolveForCwd: GitHubAccountResolver["Service"]["resolveForCwd"] = (cwd) =>
    Effect.gen(function* () {
      const account = yield* findAccountForCwd(cwd);
      if (account === null) {
        return null;
      }
      const token = yield* resolveToken(cwd, account);
      if (token === null) {
        return null;
      }
      return { account, token } satisfies ResolvedGitHubAccount;
    });

  return GitHubAccountResolver.of({ resolveForCwd });
});

export const layer = Layer.effect(GitHubAccountResolver, make);
