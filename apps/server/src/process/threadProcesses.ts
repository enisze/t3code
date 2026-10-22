/**
 * ThreadProcesses - stops what an archived thread left running.
 *
 * Every process T3 starts for a thread (its provider session, its terminals, and
 * the scripts they run) carries the thread's id and this server's environment id
 * in its environment. Children inherit both, so a dev server, build worker, or
 * headless browser stays traceable after its parent exits and the OS re-parents it.
 *
 * @module ThreadProcesses
 */
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";

export const THREAD_PROCESS_ENV = "T3CODE_THREAD_ID";
export const ENVIRONMENT_PROCESS_ENV = "T3CODE_ENVIRONMENT_ID";

let taggingEnvironmentId: string | undefined;

/**
 * Names this server on the processes it tags, so a second server whose state was
 * copied from this one (same thread ids) never stops them. Startup calls this
 * before any session or terminal starts; processes tagged without it are never
 * stopped.
 */
export function setThreadProcessEnvironment(environmentId: string): void {
  taggingEnvironmentId = environmentId;
}

/** The environment entries for every process started on behalf of `threadId`. */
export function threadProcessEnv(threadId: string): Record<string, string> {
  return {
    [THREAD_PROCESS_ENV]: threadId,
    ...(taggingEnvironmentId === undefined
      ? {}
      : { [ENVIRONMENT_PROCESS_ENV]: taggingEnvironmentId }),
  };
}

export interface ThreadProcessEntry {
  readonly pid: number;
  readonly ppid: number;
  readonly threadId: string | null;
  readonly environmentId: string | null;
}

/**
 * The processes to stop for an archived thread: everything this server tagged
 * for it. The server, its ancestors, and its direct children are left alone;
 * the session and terminal managers stop the processes they own.
 */
export function selectThreadProcesses(
  table: ReadonlyArray<ThreadProcessEntry>,
  tag: { readonly threadId: string; readonly environmentId: string },
  serverPid: number,
): number[] {
  const byPid = new Map(table.map((entry) => [entry.pid, entry]));
  const serverLine = new Set([serverPid]);
  let ancestor = byPid.get(serverPid);
  while (ancestor && !serverLine.has(ancestor.ppid)) {
    serverLine.add(ancestor.ppid);
    ancestor = byPid.get(ancestor.ppid);
  }
  return table
    .filter(
      (entry) =>
        entry.threadId === tag.threadId &&
        entry.environmentId === tag.environmentId &&
        !serverLine.has(entry.pid) &&
        entry.ppid !== serverPid,
    )
    .map((entry) => entry.pid);
}

const PS_LINE = /^\s*(\d+)\s+(\d+)\s(.*)$/;
const psTagPattern = (name: string) => new RegExp(`(?:^|\\s)${name}=(\\S+)`);
const PS_THREAD_TAG = psTagPattern(THREAD_PROCESS_ENV);
const PS_ENVIRONMENT_TAG = psTagPattern(ENVIRONMENT_PROCESS_ENV);

/**
 * Parses `ps -AwwEo pid=,ppid=,command=`, which appends each process's
 * environment. macOS hides the environment of system binaries such as
 * `/bin/sh`, so those read as untagged; the processes they run do not.
 */
export function parsePsEnvironmentTable(stdout: string): ThreadProcessEntry[] {
  const entries: ThreadProcessEntry[] = [];
  for (const line of stdout.split("\n")) {
    const match = PS_LINE.exec(line);
    if (!match) continue;
    const command = match[3] ?? "";
    entries.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      threadId: PS_THREAD_TAG.exec(command)?.[1] ?? null,
      environmentId: PS_ENVIRONMENT_TAG.exec(command)?.[1] ?? null,
    });
  }
  return entries;
}

/** Reads the parent pid from `/proc/<pid>/stat`, whose command name may hold spaces. */
export function parseProcStatParentPid(stat: string): number | null {
  // Fields after the parenthesized name: state, then ppid.
  const fields = stat
    .slice(stat.lastIndexOf(")") + 1)
    .trim()
    .split(/\s+/);
  const ppid = Number(fields[1]);
  return Number.isInteger(ppid) ? ppid : null;
}

/** Reads a variable from a NUL-separated `/proc/<pid>/environ`. */
export function parseProcEnvironValue(environ: string, name: string): string | null {
  const prefix = `${name}=`;
  const entry = environ.split("\0").find((variable) => variable.startsWith(prefix));
  return entry === undefined || entry.length === prefix.length ? null : entry.slice(prefix.length);
}

class ThreadProcessTableError extends Schema.TaggedErrorClass<ThreadProcessTableError>()(
  "ThreadProcessTableError",
  {
    exitCode: Schema.NullOr(Schema.Number),
    timedOut: Schema.Boolean,
    stdoutTruncated: Schema.Boolean,
  },
) {}

class ThreadProcessSignalError extends Schema.TaggedErrorClass<ThreadProcessSignalError>()(
  "ThreadProcessSignalError",
  { pid: Schema.Number, cause: Schema.Defect() },
) {}

const readPsEnvironmentTable = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const result = yield* processRunner.run({
    command: "/bin/ps",
    args: ["-AwwEo", "pid=,ppid=,command="],
    timeout: "30 seconds",
    maxOutputBytes: 64 * 1024 * 1024,
    outputMode: "truncate",
    timeoutBehavior: "timedOutResult",
  });
  // A partial table could hide a process that should stop.
  if (result.code !== 0 || result.timedOut || result.stdoutTruncated) {
    return yield* new ThreadProcessTableError({
      exitCode: result.code,
      timedOut: result.timedOut,
      stdoutTruncated: result.stdoutTruncated,
    });
  }
  return parsePsEnvironmentTable(result.stdout);
});

const readProcTable = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const pids = (yield* fileSystem.readDirectory("/proc")).filter((name) => /^\d+$/.test(name));
  const entries = yield* Effect.forEach(
    pids,
    (pid) =>
      Effect.gen(function* () {
        const ppid = parseProcStatParentPid(yield* fileSystem.readFileString(`/proc/${pid}/stat`));
        if (ppid === null) return null;
        // Another user's environment is unreadable, and so untagged.
        const environ = yield* fileSystem
          .readFileString(`/proc/${pid}/environ`)
          .pipe(Effect.orElseSucceed(() => ""));
        return {
          pid: Number(pid),
          ppid,
          threadId: parseProcEnvironValue(environ, THREAD_PROCESS_ENV),
          environmentId: parseProcEnvironValue(environ, ENVIRONMENT_PROCESS_ENV),
        } satisfies ThreadProcessEntry;
      }).pipe(Effect.orElseSucceed(() => null)),
    { concurrency: 32 },
  );
  return entries.filter((entry) => entry !== null);
});

/** Windows does not expose other processes' environments, so nothing is tagged there. */
const readThreadProcessTable = Effect.gen(function* () {
  const platform = yield* HostProcessPlatform;
  if (platform === "darwin") return yield* readPsEnvironmentTable;
  if (platform === "linux") return yield* readProcTable;
  return [];
});

const signalAll = (pids: ReadonlyArray<number>, signal: NodeJS.Signals) =>
  Effect.forEach(
    pids,
    (pid) =>
      // A process that already exited is the goal, not a failure.
      Effect.try({
        try: () => process.kill(pid, signal),
        catch: (cause) => new ThreadProcessSignalError({ pid, cause }),
      }).pipe(Effect.ignore),
    { discard: true },
  );

/**
 * Stops the processes an archived thread left running: SIGTERM first, then
 * SIGKILL for any still alive after `killGrace`. Returns the pids it stopped.
 */
export const stopThreadProcesses = Effect.fn("ThreadProcesses.stop")(function* (
  threadId: string,
  options?: {
    readonly killGrace?: Duration.Input;
    readonly environmentId?: string;
  },
) {
  const environmentId = options?.environmentId ?? taggingEnvironmentId;
  if (environmentId === undefined) return [];
  const tag = { threadId, environmentId };
  const targets = selectThreadProcesses(yield* readThreadProcessTable, tag, process.pid);
  if (targets.length === 0) return targets;
  yield* signalAll(targets, "SIGTERM");
  yield* Effect.sleep(options?.killGrace ?? Duration.seconds(3));
  // Read again so a pid reused since the first read is never killed.
  const survivors = selectThreadProcesses(yield* readThreadProcessTable, tag, process.pid);
  yield* signalAll(survivors, "SIGKILL");
  return targets;
});
