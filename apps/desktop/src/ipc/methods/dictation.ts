import {
  DesktopDictationProbeResultSchema,
  DesktopDictationRequestSchema,
  DesktopDictationResultSchema,
  type DesktopDictationResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

const SPEECH_TRANSCRIBER_BINARY_NAME = "t3-speech-transcriber";
/**
 * Generous next to the ~0.4s a warm five-minute recording takes, because the
 * first run for a language downloads an on-device model.
 */
const TRANSCRIBE_TIMEOUT_MS = 120_000;

const unavailable = (message: string): DesktopDictationResult => ({
  ok: false,
  code: "unavailable",
  message,
});

/**
 * Only macOS ships the helper. Everywhere else dictation is absent rather than
 * broken, and the composer hides its mic button.
 */
const resolveHelperPath = Effect.fn("desktop.ipc.dictation.resolveHelperPath")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  if (environment.platform !== "darwin") return Option.none<string>();

  const fileSystem = yield* FileSystem.FileSystem;
  const candidates = environment.isDevelopment
    ? [
        environment.path.join(
          environment.rootDir,
          "native/speech-transcriber/.build/release",
          SPEECH_TRANSCRIBER_BINARY_NAME,
        ),
        environment.path.join(
          environment.rootDir,
          "native/speech-transcriber/.build/arm64-apple-macosx/release",
          SPEECH_TRANSCRIBER_BINARY_NAME,
        ),
      ]
    : environment.isPackaged
      ? [
          environment.path.join(
            environment.resourcesPath,
            "speech-transcriber",
            SPEECH_TRANSCRIBER_BINARY_NAME,
          ),
        ]
      : environment.resolveResourcePathCandidates(
          environment.path.join("speech-transcriber", SPEECH_TRANSCRIBER_BINARY_NAME),
        );

  for (const candidate of candidates) {
    if (yield* fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false))) {
      return Option.some(candidate);
    }
  }
  return Option.none<string>();
});

const decodeProbeResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(DesktopDictationProbeResultSchema),
);
const decodeTranscribeResult = Schema.decodeUnknownEffect(
  Schema.fromJsonString(DesktopDictationResultSchema),
);

/**
 * The helper prints exactly one JSON line on both success and failure, so the
 * last non-empty stdout line is the result regardless of exit code.
 */
const runHelper = Effect.fn("desktop.ipc.dictation.runHelper")(function* <A>(
  helperPath: string,
  args: ReadonlyArray<string>,
  decode: (line: string) => Effect.Effect<A, Schema.SchemaError>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const handle = yield* spawner.spawn(
    ChildProcess.make(helperPath, [...args], { stdout: "pipe", stderr: "pipe" }),
  );
  const [stdoutBytes] = yield* Effect.all(
    [Stream.runCollect(handle.stdout), Stream.runCollect(handle.stderr), handle.exitCode],
    { concurrency: "unbounded" },
  );

  const stdout = new TextDecoder().decode(
    Uint8Array.from(stdoutBytes.flatMap((chunk) => Array.from(chunk))),
  );
  const lastLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .findLast((line) => line.length > 0);
  if (!lastLine) {
    return unavailable("The dictation helper produced no output.");
  }

  return yield* decode(lastLine).pipe(
    Effect.orElseSucceed(() =>
      unavailable(`The dictation helper returned an unreadable result: ${lastLine}`),
    ),
  );
});

export const probeDictation = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PROBE_DICTATION_CHANNEL,
  payload: Schema.String,
  result: DesktopDictationProbeResultSchema,
  handler: Effect.fn("desktop.ipc.dictation.probe")(function* (locale) {
    const helperPath = yield* resolveHelperPath();
    if (Option.isNone(helperPath)) {
      return unavailable("Dictation is only available in the macOS desktop app.");
    }
    return yield* runHelper(helperPath.value, ["probe", "--locale", locale], decodeProbeResult);
  }),
});

export const transcribeAudio = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.TRANSCRIBE_AUDIO_CHANNEL,
  payload: DesktopDictationRequestSchema,
  result: DesktopDictationResultSchema,
  handler: Effect.fn("desktop.ipc.dictation.transcribe")(function* (request) {
    const helperPath = yield* resolveHelperPath();
    if (Option.isNone(helperPath)) {
      return unavailable("Dictation is only available in the macOS desktop app.");
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // The helper reads a file rather than stdin so AVAudioFile can parse the
    // WAV header; the recording never leaves this machine, and the scoped temp
    // directory is removed even when transcription fails.
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-dictation-" });
        const audioPath = path.join(directory, "recording.wav");
        yield* fileSystem.writeFile(audioPath, request.audio);

        return yield* runHelper(
          helperPath.value,
          ["transcribe", "--input", audioPath, "--locale", request.locale],
          decodeTranscribeResult,
        ).pipe(
          Effect.timeoutOption(TRANSCRIBE_TIMEOUT_MS),
          Effect.map(
            Option.getOrElse((): DesktopDictationResult => ({
              ok: false,
              code: "transcription-failed",
              message: "Dictation timed out.",
            })),
          ),
        );
      }),
    );
  }),
});
