import { createHash } from "node:crypto";
import * as NodeOS from "node:os";

import type { ClaudeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { expandHomePath } from "../../pathExpansion.ts";

export const resolveClaudeHomePath = Effect.fn("resolveClaudeHomePath")(function* (
  config: Pick<ClaudeSettings, "homePath">,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const homePath = config.homePath.trim();
  return path.resolve(homePath.length > 0 ? expandHomePath(homePath) : NodeOS.homedir());
});

/**
 * Resolve the effective `CLAUDE_CONFIG_DIR` for an instance. This is the
 * directory Claude Code reads/writes its `.claude.json`, `.credentials.json`
 * and session state from. A custom `homePath` maps to it directly; an empty
 * `homePath` maps to the CLI default `~/.claude` (note: NOT `resolveClaudeHomePath`,
 * which returns the plain home dir for the empty case).
 */
export const resolveClaudeConfigDir = Effect.fn("resolveClaudeConfigDir")(function* (
  config: Pick<ClaudeSettings, "homePath">,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const homePath = config.homePath.trim();
  return homePath.length > 0
    ? path.resolve(expandHomePath(homePath))
    : path.join(NodeOS.homedir(), ".claude");
});

/** Base macOS keychain service name Claude Code stores OAuth credentials under. */
export const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";

/**
 * The macOS login-keychain service name that holds an instance's OAuth
 * credentials. Claude Code stores the default `~/.claude` account under the
 * bare {@link CLAUDE_KEYCHAIN_SERVICE}, but every non-default `CLAUDE_CONFIG_DIR`
 * gets its own entry suffixed with the first 8 hex chars of `sha256(configDir)`.
 * Without this suffix, every instance whose credentials live only in the
 * keychain (the macOS default — no on-disk `.credentials.json`) would read the
 * default account's token and report identical usage/limits.
 */
export const makeClaudeCredentialsServiceName = Effect.fn("makeClaudeCredentialsServiceName")(
  function* (config: Pick<ClaudeSettings, "homePath">): Effect.fn.Return<string, never, Path.Path> {
    const path = yield* Path.Path;
    const configDir = yield* resolveClaudeConfigDir(config);
    const defaultConfigDir = path.join(NodeOS.homedir(), ".claude");
    if (configDir === defaultConfigDir) return CLAUDE_KEYCHAIN_SERVICE;
    const suffix = createHash("sha256").update(configDir).digest("hex").slice(0, 8);
    return `${CLAUDE_KEYCHAIN_SERVICE}-${suffix}`;
  },
);

export const makeClaudeEnvironment = Effect.fn("makeClaudeEnvironment")(function* (
  config: Pick<ClaudeSettings, "homePath">,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const resolvedBaseEnv = baseEnv ?? process.env;
  const homePath = config.homePath.trim();
  if (homePath.length === 0) return resolvedBaseEnv;
  const resolvedHomePath = yield* resolveClaudeHomePath(config);
  return {
    ...resolvedBaseEnv,
    // Isolate this instance's config via CLAUDE_CONFIG_DIR rather than HOME.
    // Overriding HOME also relocates the macOS login keychain lookup
    // ($HOME/Library/Keychains), so the spawned CLI can't find its stored
    // OAuth credentials and reports "Not logged in". CLAUDE_CONFIG_DIR points
    // Claude Code at its config dir directly while leaving HOME (and the
    // keychain) intact.
    CLAUDE_CONFIG_DIR: resolvedHomePath,
  };
});

export const makeClaudeContinuationGroupKey = Effect.fn("makeClaudeContinuationGroupKey")(
  function* (config: Pick<ClaudeSettings, "homePath">): Effect.fn.Return<string, never, Path.Path> {
    const resolvedHomePath = yield* resolveClaudeHomePath(config);
    return `claude:home:${resolvedHomePath}`;
  },
);

export const makeClaudeCapabilitiesCacheKey = Effect.fn("makeClaudeCapabilitiesCacheKey")(
  function* (
    config: Pick<ClaudeSettings, "binaryPath" | "homePath">,
    cwd?: string,
  ): Effect.fn.Return<string, never, Path.Path> {
    const resolvedHomePath = yield* resolveClaudeHomePath(config);
    return `${config.binaryPath}\0${resolvedHomePath}\0${cwd ?? ""}`;
  },
);
