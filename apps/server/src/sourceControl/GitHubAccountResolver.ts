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
// A GitHub account's profile (numeric id / display name) effectively never
// changes, so the commit identity can be cached far more generously than tokens.
const IDENTITY_TTL_MS = 30 * 60_000;
const GH_API_USER_TIMEOUT_MS = 10_000;

export interface ResolvedGitHubAccount {
  readonly account: GitHubAccountRef;
  readonly token: string;
}

/**
 * The git author/committer identity a commit made "as" a GitHub account should
 * record. `email` is the account's no-reply email so GitHub attributes the
 * commit to that account regardless of the machine's ambient `git config`.
 */
export interface GitHubCommitIdentity {
  readonly name: string;
  readonly email: string;
}

/**
 * Outcome of resolving the commit identity for a `cwd`.
 *
 * - `resolved`: an account is attached — the caller records `identity` as the
 *   commit author/committer so the commit is attributed to it, not the ambient
 *   `git config user.*` (which may belong to a different, active account).
 * - `ambient`: `cwd` maps to no project, or its project has no account attached
 *   — the caller leaves the ambient identity untouched.
 *
 * Unlike {@link GitHubAccountResolution} there is no `unavailable` case: a local
 * commit never touches the network, and the login-based no-reply email still
 * attributes the commit to the right account even when its token can't be
 * minted. A later push is where a logged-out account fails loudly.
 */
export type GitHubCommitIdentityResolution =
  | {
      readonly _tag: "resolved";
      readonly account: GitHubAccountRef;
      readonly identity: GitHubCommitIdentity;
    }
  | { readonly _tag: "ambient" };

/**
 * Outcome of mapping a `cwd` to the GitHub account its commands should act as.
 *
 * - `resolved`: an account is attached and its token was materialized — the
 *   caller injects {@link gitHubAccountAuthEnv} so `gh`/`git` act as it.
 * - `ambient`: `cwd` maps to no project, or the owning project has no account
 *   attached — the caller uses the machine-global active account. This is the
 *   correct behavior for cloning (no project yet) and for projects that never
 *   picked an account.
 * - `unavailable`: the owning project HAS an account attached, but its token
 *   could not be minted (the account isn't logged in to `gh`, or `gh` failed).
 *   Silently falling back to the active account here would run the command as
 *   the WRONG user, so the caller MUST refuse the action with an actionable
 *   "account not logged in" error instead.
 */
export type GitHubAccountResolution =
  | { readonly _tag: "resolved"; readonly account: GitHubAccountRef; readonly token: string }
  | { readonly _tag: "ambient" }
  | { readonly _tag: "unavailable"; readonly account: GitHubAccountRef };

export class GitHubAccountResolver extends Context.Service<
  GitHubAccountResolver,
  {
    /**
     * Resolve the GitHub account a command running in `cwd` should act as.
     * Distinguishes "no account attached / unknown cwd" (fall back to the
     * ambient account) from "account attached but its token can't be minted"
     * (the caller must fail loudly rather than act as the wrong account).
     */
    readonly resolveForCwd: (cwd: string) => Effect.Effect<GitHubAccountResolution>;
    /**
     * Resolve the git author/committer identity a commit running in `cwd`
     * should record, so the commit is attributed to the project's selected
     * GitHub account rather than the machine's ambient `git config user.*`.
     * Never fails: falls back to the login-based no-reply email when the
     * account's profile can't be read (e.g. it isn't logged in, or offline).
     */
    readonly resolveCommitIdentityForCwd: (
      cwd: string,
    ) => Effect.Effect<GitHubCommitIdentityResolution>;
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
 *
 * It also rewrites the account host's SSH remote forms to HTTPS
 * (`url.https://<host>/.insteadOf`), so a repo whose remote is
 * `git@<host>:owner/repo` still authenticates as the selected account. Without
 * it, an SSH remote bypasses the token entirely and uses the machine's SSH key
 * — i.e. account selection would silently do nothing. The rewrite is scoped to
 * this process and never touches the stored remote URL.
 *
 * Pairs are appended after any `GIT_CONFIG_COUNT` already present in `baseEnv`,
 * so a runtime git config the process inherited keeps working instead of being
 * silently overwritten by our pairs claiming indices 0 and 1.
 */
export function gitHubAccountAuthEnv(
  resolved: ResolvedGitHubAccount,
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const host = resolved.account.host;
  const helperKey = `credential.https://${host}.helper`;
  const insteadOfKey = `url.https://${host}/.insteadOf`;
  const offset = parseGitConfigCount(baseEnv.GIT_CONFIG_COUNT);
  return {
    ...gitHubAccountGhEnv(resolved),
    GIT_CONFIG_COUNT: String(offset + 4),
    [`GIT_CONFIG_KEY_${offset}`]: helperKey,
    [`GIT_CONFIG_VALUE_${offset}`]: "",
    [`GIT_CONFIG_KEY_${offset + 1}`]: helperKey,
    [`GIT_CONFIG_VALUE_${offset + 1}`]: "!gh auth git-credential",
    [`GIT_CONFIG_KEY_${offset + 2}`]: insteadOfKey,
    [`GIT_CONFIG_VALUE_${offset + 2}`]: `git@${host}:`,
    [`GIT_CONFIG_KEY_${offset + 3}`]: insteadOfKey,
    [`GIT_CONFIG_VALUE_${offset + 3}`]: `ssh://git@${host}/`,
  };
}

function parseGitConfigCount(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
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

interface CachedIdentity {
  readonly identity: GitHubCommitIdentity;
  readonly expiresAtMs: number;
}

function cacheKey(account: GitHubAccountRef): string {
  return `${account.host}\n${account.login}`;
}

/**
 * The no-reply email domain for a host. `github.com` uses
 * `users.noreply.github.com`; a GitHub Enterprise host `ghe.corp` uses
 * `users.noreply.ghe.corp`. GitHub attributes any commit with a
 * `<login>@<no-reply>` or `<id>+<login>@<no-reply>` email to that account.
 */
function noReplyEmailHost(host: string): string {
  return `users.noreply.${host}`;
}

/**
 * The commit identity derivable from the account ref alone, without touching
 * the network. `<login>@users.noreply.<host>` attributes the commit to the
 * account; used as a fallback when the account's numeric id / display name
 * can't be read (logged out, offline, or `gh` failed).
 */
function loginIdentity(account: GitHubAccountRef): GitHubCommitIdentity {
  return { name: account.login, email: `${account.login}@${noReplyEmailHost(account.host)}` };
}

/**
 * Build the canonical commit identity from a `gh api user` JSON response: the
 * account's display name (falling back to its login) and the id-based no-reply
 * email `<id>+<login>@users.noreply.<host>`. Returns `null` when the payload
 * lacks a usable numeric id, so the caller falls back to {@link loginIdentity}.
 */
function parseCommitIdentity(
  stdout: string,
  account: GitHubAccountRef,
): GitHubCommitIdentity | null {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== "number" && typeof id !== "string") {
    return null;
  }
  const idText = String(id).trim();
  if (idText.length === 0) {
    return null;
  }
  const login =
    typeof record.login === "string" && record.login.trim().length > 0
      ? record.login.trim()
      : account.login;
  const name =
    typeof record.name === "string" && record.name.trim().length > 0 ? record.name.trim() : login;
  return { name, email: `${idText}+${login}@${noReplyEmailHost(account.host)}` };
}

export const make = Effect.gen(function* () {
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const process = yield* VcsProcess.VcsProcess;
  const tokenCache = yield* Ref.make(new Map<string, CachedToken>());
  const identityCache = yield* Ref.make(new Map<string, CachedIdentity>());

  /**
   * Find the account attached to the project owning `cwd`. Matches the longest
   * project workspace root or thread worktree path that contains `cwd`, so a
   * worktree checked out outside the project root — including one belonging to
   * an archived thread — still resolves.
   */
  const findAccountForCwd = (cwd: string): Effect.Effect<GitHubAccountRef | null> =>
    snapshotQuery.listAccountRoutes().pipe(
      Effect.map((routes) => {
        let bestPathLength = -1;
        let bestAccount: GitHubAccountRef | null = null;
        for (const route of routes) {
          if (!isWithin(cwd, route.path)) continue;
          if (route.path.length > bestPathLength) {
            bestPathLength = route.path.length;
            bestAccount = route.account;
          }
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

      // Falling back to the ambient account is the difference between "acts as
      // the wrong user" and "fails loudly", so leave a breadcrumb either way.
      if (result._tag === "None") {
        yield* Effect.logWarning(
          "Could not mint a token for the project's GitHub account; falling back to the active gh account",
          { host: account.host, login: account.login, cwd },
        );
        return null;
      }
      const token = result.value.stdout.trim();
      if (token.length === 0) {
        yield* Effect.logWarning(
          "gh returned an empty token for the project's GitHub account; falling back to the active gh account",
          { host: account.host, login: account.login, cwd },
        );
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
        return { _tag: "ambient" } as const;
      }
      const token = yield* resolveToken(cwd, account);
      if (token === null) {
        // The project explicitly selected this account but we couldn't act as
        // it. Report it so the caller refuses rather than silently using the
        // wrong (ambient) account.
        return { _tag: "unavailable", account } as const;
      }
      return { _tag: "resolved", account, token } as const;
    });

  /**
   * Resolve the commit identity for an attached account. Prefers the canonical
   * id-based no-reply email + display name read from `gh api user` (acting as
   * the account via its minted token), and falls back to the login-based
   * no-reply email whenever the profile can't be read — so a local commit is
   * always attributed to the account and never blocked when it's logged out or
   * offline.
   */
  const resolveIdentity = (
    cwd: string,
    account: GitHubAccountRef,
  ): Effect.Effect<GitHubCommitIdentity> =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const cache = yield* Ref.get(identityCache);
      const cached = cache.get(cacheKey(account));
      if (cached !== undefined && cached.expiresAtMs > now) {
        return cached.identity;
      }

      const fallback = loginIdentity(account);
      // Without the account's token we can't query `gh api user` as it — the
      // ambient (possibly different) account would answer — so skip the call
      // and attribute via the login-based no-reply email instead.
      const token = yield* resolveToken(cwd, account);
      if (token === null) {
        return fallback;
      }

      const result = yield* process
        .run({
          operation: "GitHubAccountResolver.resolveIdentity",
          command: "gh",
          args: ["api", "user", "--hostname", account.host],
          cwd,
          env: gitHubAccountGhEnv({ account, token }),
          timeoutMs: GH_API_USER_TIMEOUT_MS,
        })
        .pipe(Effect.option);
      if (result._tag === "None") {
        yield* Effect.logWarning(
          "Could not read the GitHub account profile for the commit identity; attributing the commit via the login-based no-reply email",
          { host: account.host, login: account.login, cwd },
        );
        return fallback;
      }

      const identity = parseCommitIdentity(result.value.stdout, account);
      if (identity === null) {
        return fallback;
      }

      yield* Ref.update(identityCache, (current) => {
        const next = new Map(current);
        next.set(cacheKey(account), { identity, expiresAtMs: now + IDENTITY_TTL_MS });
        return next;
      });
      return identity;
    });

  const resolveCommitIdentityForCwd: GitHubAccountResolver["Service"]["resolveCommitIdentityForCwd"] =
    (cwd) =>
      Effect.gen(function* () {
        const account = yield* findAccountForCwd(cwd);
        if (account === null) {
          return { _tag: "ambient" } as const;
        }
        const identity = yield* resolveIdentity(cwd, account);
        return { _tag: "resolved", account, identity } as const;
      });

  return GitHubAccountResolver.of({ resolveForCwd, resolveCommitIdentityForCwd });
});

export const layer = Layer.effect(GitHubAccountResolver, make);
