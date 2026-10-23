// @effect-diagnostics nodeBuiltinImport:off -- the fake CLI and its leftover child are real processes.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, it } from "@effect/vitest";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";

import { spawnClaudeProcessGroup } from "./claudeProcessGroup.ts";

/** Writes an executable stand-in for the Claude CLI into a fresh directory with an `alive` FIFO. */
function fakeClaudeCli(script: string) {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-claude-cli-"));
  const cli = NodePath.join(dir, "claude");
  NodeFS.writeFileSync(cli, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  NodeChildProcess.execFileSync("mkfifo", [NodePath.join(dir, "alive")]);
  return { dir, cli };
}

/**
 * The fake CLI's long-running process holds `alive` open for writing, so its start
 * and its death read as open and end-of-file here, with no polling.
 */
function watchAlive(dir: string) {
  const alive = NodeFS.createReadStream(NodePath.join(dir, "alive"));
  const started = new Promise<void>((resolve) => alive.once("open", () => resolve()));
  const stopped = new Promise<void>((resolve) => alive.once("close", () => resolve()));
  alive.resume();
  return { started, stopped };
}

// Sends no message, so the CLI only ever sees an open stdin.
// oxlint-disable-next-line require-yield
async function* silentPrompt(): AsyncGenerator<SDKUserMessage> {
  await new Promise(() => {});
}

describe.skipIf(HostProcessPlatform.defaultValue() === "win32")("spawnClaudeProcessGroup", () => {
  // The CLI stops the MCP servers it started, but not their children: a plugin's
  // `bun server.ts` outlives its `bun run` wrapper. The fake CLI leaves a child
  // running the same way.
  it.effect("stops what the CLI left running when the session closes", () =>
    Effect.gen(function* () {
      const { dir, cli } = fakeClaudeCli(
        [
          'dir=$(dirname "$0")',
          'sleep 600 > "$dir/alive" &',
          'echo $! > "$dir/leftover.pid"',
          "cat > /dev/null",
        ].join("\n"),
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          // Only does anything when the test fails: do not leak its child.
          try {
            process.kill(Number(NodeFS.readFileSync(NodePath.join(dir, "leftover.pid"), "utf8")));
          } catch {}
          NodeFS.rmSync(dir, { recursive: true, force: true });
        }),
      );
      const leftover = watchAlive(dir);
      const session = query({
        prompt: silentPrompt(),
        options: {
          pathToClaudeCodeExecutable: cli,
          spawnClaudeCodeProcess: spawnClaudeProcessGroup,
        },
      });
      yield* Effect.promise(() => leftover.started);

      session.close();
      yield* Effect.promise(() => leftover.stopped);
    }),
  );

  // The CLI keeps running its turn after its pipes close, so a server that
  // crashed would leave it working next to the session it resumes.
  it.effect("stops the CLI when the server that started it goes away", () =>
    Effect.gen(function* () {
      const { dir, cli } = fakeClaudeCli(
        ['dir=$(dirname "$0")', 'sleep 600 > "$dir/alive"'].join("\n"),
      );
      const child = spawnClaudeProcessGroup({
        command: cli,
        args: [],
        cwd: dir,
        env: process.env,
        signal: new AbortController().signal,
      }) as NodeChildProcess.ChildProcess;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          try {
            if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
          } catch {}
          NodeFS.rmSync(dir, { recursive: true, force: true });
        }),
      );
      const turn = watchAlive(dir);
      yield* Effect.promise(() => turn.started);

      // A dying server's descriptors close; the kernel would do this for it.
      for (const pipe of child.stdio) pipe?.destroy();
      yield* Effect.promise(() => turn.stopped);
    }),
  );
});
