// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalTimersInEffect:off - a dictation session is a long-lived
// child process that outlives the IPC call that opened it and needs incremental
// stdin writes, which the Effect process wrapper does not express.
import * as NodeChildProcess from "node:child_process";

import {
  DesktopDictationChunkSchema,
  DesktopDictationResultSchema,
  DesktopDictationStreamStartSchema,
  DesktopDictationStreamUpdateSchema,
  type DesktopDictationResult,
  type DesktopDictationStreamStart,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";
import { resolveHelperPath } from "./dictation.ts";

/** Long enough for the model to install on the first recording in a language. */
const READY_TIMEOUT_MS = 120_000;
const FINISH_TIMEOUT_MS = 60_000;

interface StreamSession {
  readonly child: NodeChildProcess.ChildProcessWithoutNullStreams;
  /** Finalised text; volatile lines are provisional and replace each other. */
  finals: string;
  volatile: string;
  stderr: string;
  finished: boolean;
  onDone: ((result: DesktopDictationResult) => void) | null;
}

const sessions = new Map<string, StreamSession>();
let nextSessionId = 0;

const transcriptOf = (session: StreamSession) => `${session.finals}${session.volatile}`;

/**
 * The helper prints one JSON object per line: `ready`, then a run of
 * `volatile` lines superseded by each `final`, then `done`.
 */
function handleHelperLine(session: StreamSession, line: string): void {
  let event: {
    type?: string;
    text?: string;
    code?: string;
    message?: string;
    ok?: boolean;
  };
  try {
    event = JSON.parse(line) as typeof event;
  } catch {
    return;
  }
  if (event.type === "volatile") {
    session.volatile = event.text ?? "";
    return;
  }
  if (event.type === "final") {
    session.finals += event.text ?? "";
    session.volatile = "";
    return;
  }
  if (event.type === "done") {
    session.finished = true;
    session.onDone?.({ ok: true, text: transcriptOf(session).trim(), locale: "" });
    return;
  }
  if (event.ok === false || event.code) {
    session.finished = true;
    session.onDone?.({
      ok: false,
      code: "transcription-failed",
      message: event.message ?? "Dictation failed.",
    });
  }
}

function disposeSession(streamId: string): void {
  const session = sessions.get(streamId);
  if (!session) return;
  sessions.delete(streamId);
  session.child.kill("SIGTERM");
}

export const startDictationStream = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.START_DICTATION_STREAM_CHANNEL,
  payload: Schema.String,
  result: DesktopDictationStreamStartSchema,
  handler: Effect.fn("desktop.ipc.dictationStream.start")(function* (locale) {
    const helperPath = yield* resolveHelperPath();
    if (Option.isNone(helperPath)) {
      return {
        ok: false,
        code: "unavailable",
        message: "Dictation is only available in the macOS desktop app.",
      } satisfies DesktopDictationStreamStart;
    }

    nextSessionId += 1;
    const streamId = `dictation-${nextSessionId}`;

    return yield* Effect.callback<DesktopDictationStreamStart>(
      (resume: (effect: Effect.Effect<DesktopDictationStreamStart>) => void) => {
        const child = NodeChildProcess.spawn(helperPath.value, ["stream", "--locale", locale], {
          stdio: ["pipe", "pipe", "pipe"],
        });
        const session: StreamSession = {
          child,
          finals: "",
          volatile: "",
          stderr: "",
          finished: false,
          onDone: null,
        };

        let settled = false;
        let buffered = "";
        const settle = (value: DesktopDictationStreamStart) => {
          if (settled) return;
          settled = true;
          if (!value.ok) disposeSession(streamId);
          resume(Effect.succeed(value));
        };

        const timer = setTimeout(() => {
          settle({
            ok: false,
            code: "preparation-failed",
            message: "Dictation did not start in time.",
          });
        }, READY_TIMEOUT_MS);

        child.stdout.on("data", (data: Buffer) => {
          buffered += data.toString("utf8");
          const lines = buffered.split("\n");
          buffered = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length === 0) continue;
            // The first line reports the format the renderer must send.
            if (!settled) {
              try {
                const ready = JSON.parse(trimmed) as {
                  type?: string;
                  sampleRate?: number;
                  encoding?: string;
                  message?: string;
                };
                if (ready.type === "ready") {
                  clearTimeout(timer);
                  sessions.set(streamId, session);
                  settle({
                    ok: true,
                    streamId,
                    locale,
                    sampleRate: ready.sampleRate ?? 16_000,
                    encoding: ready.encoding === "float32" ? "float32" : "int16",
                  });
                  continue;
                }
                clearTimeout(timer);
                settle({
                  ok: false,
                  code: "preparation-failed",
                  message: ready.message ?? "Dictation could not start.",
                });
                continue;
              } catch {
                continue;
              }
            }
            handleHelperLine(session, trimmed);
          }
        });

        child.stderr.on("data", (data: Buffer) => {
          session.stderr += data.toString("utf8");
        });
        child.on("error", (error) => {
          clearTimeout(timer);
          settle({ ok: false, code: "unavailable", message: error.message });
        });
        child.on("exit", () => {
          session.finished = true;
          session.onDone?.({ ok: true, text: transcriptOf(session).trim(), locale });
          clearTimeout(timer);
          settle({
            ok: false,
            code: "transcription-failed",
            message: session.stderr.trim() || "Dictation stopped unexpectedly.",
          });
        });
      },
    );
  }),
});

export const pushDictationAudio = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PUSH_DICTATION_AUDIO_CHANNEL,
  payload: DesktopDictationChunkSchema,
  result: DesktopDictationStreamUpdateSchema,
  handler: Effect.fn("desktop.ipc.dictationStream.push")(function* (request) {
    const session = sessions.get(request.streamId);
    if (!session || session.finished) return { ok: false, transcript: "" };
    yield* Effect.sync(() => {
      session.child.stdin.write(Buffer.from(request.chunk));
    });
    return { ok: true, transcript: transcriptOf(session) };
  }),
});

export const finishDictationStream = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FINISH_DICTATION_STREAM_CHANNEL,
  payload: Schema.String,
  result: DesktopDictationResultSchema,
  handler: Effect.fn("desktop.ipc.dictationStream.finish")(function* (streamId) {
    const session = sessions.get(streamId);
    if (!session) {
      return {
        ok: false,
        code: "transcription-failed",
        message: "That dictation session is no longer open.",
      } satisfies DesktopDictationResult;
    }

    return yield* Effect.callback<DesktopDictationResult>(
      (resume: (effect: Effect.Effect<DesktopDictationResult>) => void) => {
        let settled = false;
        const settle = (result: DesktopDictationResult) => {
          if (settled) return;
          settled = true;
          disposeSession(streamId);
          resume(Effect.succeed(result));
        };
        session.onDone = settle;
        // Closing stdin is how the helper is told the recording ended; it then
        // flushes a last final result and prints `done`.
        session.child.stdin.end();
        setTimeout(
          () => settle({ ok: true, text: transcriptOf(session).trim(), locale: "" }),
          FINISH_TIMEOUT_MS,
        );
      },
    );
  }),
});

export const cancelDictationStream = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CANCEL_DICTATION_STREAM_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.dictationStream.cancel")(function* (streamId) {
    yield* Effect.sync(() => disposeSession(streamId));
  }),
});
