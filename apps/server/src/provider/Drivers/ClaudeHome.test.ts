import { createHash } from "node:crypto";
import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import {
  CLAUDE_KEYCHAIN_SERVICE,
  makeClaudeCapabilitiesCacheKey,
  makeClaudeContinuationGroupKey,
  makeClaudeCredentialsServiceName,
  makeClaudeEnvironment,
  resolveClaudeConfigDir,
  resolveClaudeHomePath,
} from "./ClaudeHome.ts";

it.layer(NodeServices.layer)("ClaudeHome", (it) => {
  describe("Claude home resolution", () => {
    it.effect("uses the process home when no Claude home override is configured", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir());

        expect(yield* resolveClaudeHomePath({ homePath: "" })).toBe(resolved);
        expect(yield* makeClaudeEnvironment({ homePath: "" })).toBe(process.env);
      }),
    );

    it.effect("resolves configured Claude HOME and stamps continuation/cache keys with it", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const homePath = "~/.claude-work";
        const resolved = path.resolve(NodeOS.homedir(), ".claude-work");

        expect(yield* resolveClaudeHomePath({ homePath })).toBe(resolved);
        expect((yield* makeClaudeEnvironment({ homePath })).CLAUDE_CONFIG_DIR).toBe(resolved);
        expect(yield* makeClaudeContinuationGroupKey({ homePath })).toBe(`claude:home:${resolved}`);
        expect(yield* makeClaudeCapabilitiesCacheKey({ binaryPath: "claude", homePath })).toBe(
          `claude\0${resolved}\0`,
        );
      }),
    );

    it.effect("separates capability probes by cwd", () =>
      Effect.gen(function* () {
        const config = { binaryPath: "claude", homePath: "" };
        const first = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-a");
        const second = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-b");
        expect(first).not.toBe(second);
      }),
    );

    it.effect("keeps continuation compatible across instances with the same Claude HOME", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir());

        expect(yield* makeClaudeContinuationGroupKey({ homePath: "" })).toBe(
          `claude:home:${resolved}`,
        );
      }),
    );
  });

  describe("Claude config dir and credentials service", () => {
    it.effect("resolves the default config dir to ~/.claude when no override is set", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        expect(yield* resolveClaudeConfigDir({ homePath: "" })).toBe(
          path.join(NodeOS.homedir(), ".claude"),
        );
      }),
    );

    it.effect("resolves a custom config dir from the configured home path", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        expect(yield* resolveClaudeConfigDir({ homePath: "~/.claude-personal" })).toBe(
          path.resolve(NodeOS.homedir(), ".claude-personal"),
        );
      }),
    );

    it.effect("uses the bare keychain service for the default account", () =>
      Effect.gen(function* () {
        expect(yield* makeClaudeCredentialsServiceName({ homePath: "" })).toBe(
          CLAUDE_KEYCHAIN_SERVICE,
        );
        // An explicit ~/.claude override still counts as the default account.
        expect(yield* makeClaudeCredentialsServiceName({ homePath: "~/.claude" })).toBe(
          CLAUDE_KEYCHAIN_SERVICE,
        );
      }),
    );

    it.effect("suffixes the keychain service with sha256(configDir)[:8] per instance", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const configDir = path.resolve(NodeOS.homedir(), ".claude-personal");
        const suffix = createHash("sha256").update(configDir).digest("hex").slice(0, 8);

        expect(yield* makeClaudeCredentialsServiceName({ homePath: "~/.claude-personal" })).toBe(
          `${CLAUDE_KEYCHAIN_SERVICE}-${suffix}`,
        );
      }),
    );

    it.effect("gives distinct keychain services to distinct instances", () =>
      Effect.gen(function* () {
        const bare = yield* makeClaudeCredentialsServiceName({ homePath: "" });
        const personal = yield* makeClaudeCredentialsServiceName({
          homePath: "~/.claude-personal",
        });
        const work = yield* makeClaudeCredentialsServiceName({ homePath: "~/.claude-work" });

        expect(new Set([bare, personal, work]).size).toBe(3);
      }),
    );
  });
});
