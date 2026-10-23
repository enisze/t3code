// @effect-diagnostics nodeBuiltinImport:off -- the SDK takes a Node ChildProcess for the CLI.
import * as NodeChildProcess from "node:child_process";

import type { SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";

// Runs `$@` (the CLI) after starting a watcher in its group. The watcher ignores the TERM it
// sends, and the CLI runs without the watched pipe.
const CLAUDE_GROUP_WATCH_SCRIPT = [
  "{ trap '' TERM; read -r _ <&3; kill -TERM 0; sleep 5; kill -KILL 0; } </dev/null >/dev/null 2>&1 &",
  'exec "$@" 3<&-',
].join("\n");

/** `kill(0)` signals this server's own group and `kill(-1)` every process the user owns. */
function killProcessGroup(pid: number | undefined): void {
  if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 1) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is already empty.
  }
}

/**
 * Starts the Claude CLI as the leader of its own process group, for the SDK's
 * `spawnClaudeCodeProcess`. Windows has no process groups, so callers leave the
 * spawn to the SDK there.
 *
 * When the CLI exits it stops the MCP servers it started, but not their children:
 * a plugin's `bun run start` wrapper dies and its `bun server.ts` keeps running,
 * writing to a pipe nobody reads. Those stay in the CLI's group, so the rest of
 * the group gets SIGKILL once the CLI exits for any reason. Commands the agent
 * runs through its Bash tool start their own groups; archiving the thread stops
 * those (see `threadProcesses.ts`).
 *
 * That cleanup needs this server alive, and the CLI finishes its turn after its
 * pipes close. A server that crashes or is killed would leave the CLI working next
 * to the session it resumes, so a watcher in the group reads a pipe only this
 * server holds and stops the group at its end-of-file.
 *
 * The SDK reads stderr only from its own spawn, where it redacts credentials
 * before adding the tail to exit errors. Here stderr is dropped instead, so exit
 * errors carry only the code or signal.
 */
export function spawnClaudeProcessGroup(options: SpawnOptions): SpawnedProcess {
  const child = NodeChildProcess.spawn(
    "/bin/sh",
    ["-c", CLAUDE_GROUP_WATCH_SCRIPT, "t3-claude", options.command, ...options.args],
    {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      stdio: ["pipe", "pipe", "ignore", "pipe"],
      detached: true,
    },
  );
  child.once("exit", () => killProcessGroup(child.pid));
  // Node's typings make stdin and stdout nullable once stdio has a fourth entry; both are pipes.
  return child as SpawnedProcess;
}
