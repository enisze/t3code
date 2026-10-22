// @effect-diagnostics nodeBuiltinImport:off - spawns real processes to stop.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";
import {
  ENVIRONMENT_PROCESS_ENV,
  parseProcEnvironValue,
  parseProcStatParentPid,
  parsePsEnvironmentTable,
  selectThreadProcesses,
  stopThreadProcesses,
  THREAD_PROCESS_ENV,
  type ThreadProcessEntry,
} from "./threadProcesses.ts";

const SERVER = 500;
const TAG = { threadId: "thread-1", environmentId: "environment-1" };
const entry = (
  pid: number,
  ppid: number,
  tag: { readonly threadId: string; readonly environmentId: string } | null = null,
): ThreadProcessEntry => ({
  pid,
  ppid,
  threadId: tag?.threadId ?? null,
  environmentId: tag?.environmentId ?? null,
});

describe("selectThreadProcesses", () => {
  it("stops what the thread left running, orphaned or not", () => {
    const table = [
      entry(1, 0),
      entry(400, 1),
      entry(SERVER, 400),
      // The thread's agent session, which its manager stops, and a dev server it started.
      entry(600, SERVER, TAG),
      entry(601, 600, TAG),
      // A build worker orphaned to launchd, and its own child.
      entry(700, 1, TAG),
      entry(701, 700, TAG),
      // Another thread's leftover.
      entry(800, 1, { ...TAG, threadId: "thread-2" }),
    ];

    expect(selectThreadProcesses(table, TAG, SERVER).toSorted()).toEqual([601, 700, 701]);
  });

  it("leaves another server's processes alone, even for the same thread", () => {
    // A dev server started from a terminal of the thread it archives, from a
    // state copy that shares the thread id.
    const table = [
      entry(1, 0),
      entry(100, 1),
      entry(200, 100, { ...TAG, environmentId: "main" }),
      entry(300, 200, { ...TAG, environmentId: "main" }),
      entry(SERVER, 200, { ...TAG, environmentId: "main" }),
      entry(600, SERVER, TAG),
      entry(601, 600, TAG),
    ];

    expect(selectThreadProcesses(table, TAG, SERVER)).toEqual([601]);
  });

  it("never stops this server or what it started from", () => {
    const table = [entry(1, 0), entry(200, 1, TAG), entry(SERVER, 200, TAG)];

    expect(selectThreadProcesses(table, TAG, SERVER)).toEqual([]);
  });
});

describe("process table parsing", () => {
  it("reads each process's tags from ps output with environments", () => {
    const stdout = [
      "    1     0 /sbin/launchd",
      "  700     1 /usr/bin/node worker.js PATH=/bin T3CODE_THREAD_ID=thread-1 T3CODE_ENVIRONMENT_ID=environment-1",
      "  701   700 /bin/sh -c sleep 60",
      "",
    ].join("\n");

    expect(parsePsEnvironmentTable(stdout)).toEqual([
      entry(1, 0),
      entry(700, 1, TAG),
      entry(701, 700),
    ]);
  });

  it("reads the parent pid past a command name with spaces and parentheses", () => {
    expect(parseProcStatParentPid("1234 (my (odd) cmd) S 99 1234 1234 0 -1")).toBe(99);
  });

  it("reads a variable from a NUL-separated environment", () => {
    const environ = "PATH=/bin\0T3CODE_THREAD_ID=thread-1\0HOME=/x\0";
    expect(parseProcEnvironValue(environ, THREAD_PROCESS_ENV)).toBe("thread-1");
    expect(parseProcEnvironValue(environ, ENVIRONMENT_PROCESS_ENV)).toBeNull();
  });
});

const TestLayer = ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer));

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("stopThreadProcesses", () => {
  it.live.skipIf(HostProcessPlatform.defaultValue() === "win32")(
    "stops a process the thread left running below its session",
    () =>
      Effect.gen(function* () {
        const tag = { threadId: `thread-${NodeCrypto.randomUUID()}`, environmentId: "test" };
        // The shell stands in for a session process, which its manager stops;
        // the node process it starts is what the thread leaves running.
        const leftoverCommand = `"${process.execPath}" -e "setTimeout(() => {}, 60000)"`;
        const shell = NodeChildProcess.spawn(
          "/bin/sh",
          ["-c", `${leftoverCommand} & echo $!; wait`],
          {
            env: {
              ...process.env,
              [THREAD_PROCESS_ENV]: tag.threadId,
              [ENVIRONMENT_PROCESS_ENV]: tag.environmentId,
            },
            stdio: ["ignore", "pipe", "ignore"],
          },
        );
        const exited = new Promise((resolve) => shell.once("exit", resolve));
        const leftover = yield* Effect.promise(
          () =>
            new Promise<number>((resolve) =>
              shell.stdout.once("data", (chunk: Buffer) => resolve(Number(String(chunk).trim()))),
            ),
        );

        yield* Effect.gen(function* () {
          const stopped = yield* stopThreadProcesses(tag.threadId, {
            environmentId: tag.environmentId,
            killGrace: "100 millis",
          });

          assert.deepStrictEqual(stopped, [leftover]);
          // The shell's `wait` returns once the leftover is gone.
          yield* Effect.promise(() => exited);
          assert.isFalse(isAlive(leftover));
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              for (const pid of [leftover, shell.pid]) {
                if (pid !== undefined && isAlive(pid)) process.kill(pid, "SIGKILL");
              }
            }),
          ),
        );
      }).pipe(Effect.provide(TestLayer)),
  );
});
