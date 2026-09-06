export interface GitHubAuthStatusAccount {
  readonly host: string;
  readonly account: string;
  readonly authenticated: boolean;
  readonly active: boolean;
  readonly error: string | null;
}

export interface GitHubAuthStatus {
  readonly parsed: boolean;
  readonly accounts: ReadonlyArray<GitHubAuthStatusAccount>;
}

interface MutableGitHubAuthStatusAccount {
  host: string;
  account: string;
  authenticated: boolean;
  active: boolean;
  error: string | null;
}

function nonEmptyString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// `gh auth status` has no `--json` flag; it only prints a human-readable
// report. Each account is introduced by a header line and followed by
// indented `- key: value` detail lines, e.g.:
//
//   github.com
//     ✓ Logged in to github.com account octocat (keyring)
//     - Active account: true
//     - Git operations protocol: https
//     - Token: gho_************************************
//     - Token scopes: 'gist', 'read:org', 'repo'
//
//   X Failed to log in to github.com account stale-user (keyring)
//     - The token in keyring is invalid.
//     - To re-authenticate, run: gh auth login -h github.com
//
// We match on the stable "Logged in to" / "Failed to log in to" phrases
// rather than the colored status glyph, which varies by terminal/version.
const LOGGED_IN_PATTERN = /Logged in to (\S+) account (\S+)/;
const FAILED_PATTERN = /Failed to log in to (\S+) account (\S+)/;
const ACTIVE_ACCOUNT_PATTERN = /^-\s*Active account:\s*(true|false)/i;
const KNOWN_DETAIL_PATTERN =
  /^(?:Active account:|Git operations protocol:|Token(?:\s+scopes)?:|To (?:re-authenticate|forget))/i;

export function parseGitHubAuthStatus(text: string): GitHubAuthStatus {
  const accounts: MutableGitHubAuthStatusAccount[] = [];
  let current: MutableGitHubAuthStatusAccount | null = null;
  let sawAccountHeader = false;

  const finalize = () => {
    if (current !== null) {
      accounts.push(current);
      current = null;
    }
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const loggedIn = LOGGED_IN_PATTERN.exec(line);
    const failed = loggedIn ? null : FAILED_PATTERN.exec(line);
    const header = loggedIn ?? failed;
    if (header) {
      finalize();
      sawAccountHeader = true;
      const host = nonEmptyString(header[1] ?? "");
      const login = nonEmptyString(header[2] ?? "");
      current =
        host === null || login === null
          ? null
          : {
              host: host.toLowerCase(),
              account: login,
              authenticated: loggedIn !== null,
              active: false,
              error: null,
            };
      continue;
    }

    if (current === null) continue;

    const activeMatch = ACTIVE_ACCOUNT_PATTERN.exec(line);
    if (activeMatch) {
      current.active = activeMatch[1]?.toLowerCase() === "true";
      continue;
    }

    // The first descriptive detail line under a failed account is its reason.
    if (!current.authenticated && current.error === null && line.startsWith("-")) {
      const detail = line.replace(/^-\s*/, "").trim();
      if (detail.length > 0 && !KNOWN_DETAIL_PATTERN.test(detail)) {
        current.error = detail;
      }
    }
  }
  finalize();

  return {
    parsed: sawAccountHeader,
    accounts: accounts.map((account) => ({ ...account })),
  };
}

export function findAuthenticatedGitHubAccount(
  accounts: ReadonlyArray<GitHubAuthStatusAccount>,
): GitHubAuthStatusAccount | undefined {
  return (
    accounts.find((account) => account.authenticated && account.active) ??
    accounts.find((account) => account.authenticated)
  );
}
