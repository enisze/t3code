import type { DesktopDictationResult } from "@t3tools/contracts";
import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type PreparedVoiceTranscription,
  type VoiceLiveSession,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";

import { readRecording } from "./recordingStore.ts";

function toTranscriptionError(result: Extract<DesktopDictationResult, { ok: false }>) {
  return new VoiceTranscriptionError(result.code, result.message);
}

/**
 * Dictation through the desktop app's bundled macOS speech helper.
 *
 * `preferredLocale` is the language chosen in Settings; empty or omitted
 * follows the OS language.
 *
 * Returns null in a plain browser and on desktop builds without the helper
 * (everything but macOS), which is what hides the composer's mic button.
 */
export function getLocalVoiceTranscriber(preferredLocale?: string): VoiceTranscriber | null {
  const bridge = globalThis.window?.desktopBridge;
  if (!bridge?.transcribeAudio || !bridge.probeDictation) return null;
  const transcribeAudio = bridge.transcribeAudio;
  const probeDictation = bridge.probeDictation;

  return {
    prepare: async ({ signal }): Promise<PreparedVoiceTranscription> => {
      throwIfVoiceTranscriptionAborted(signal);
      // An explicit choice in Settings wins; otherwise follow the OS.
      const requestedLocale =
        preferredLocale?.trim() || bridge.getSystemLocale?.() || navigator.language;
      // The probe resolves the locale the engine will really use and installs
      // the on-device model, so the first recording is not also the download.
      const probed = await probeDictation(requestedLocale);
      throwIfVoiceTranscriptionAborted(signal);
      if (!probed.ok) throw toTranscriptionError(probed);

      const startLive =
        bridge.startDictationStream && bridge.pushDictationAudio && bridge.finishDictationStream
          ? async (
              onPartial: (transcript: string) => void,
              liveOptions: { signal: AbortSignal },
            ): Promise<VoiceLiveSession> => {
              throwIfVoiceTranscriptionAborted(liveOptions.signal);
              const started = await bridge.startDictationStream!(probed.locale);
              if (!started.ok) throw toTranscriptionError(started);
              const streamId = started.streamId;

              // Audio is pushed continuously and the transcript so far rides
              // back on the same response, so partial text needs no separate
              // channel from the main process.
              let inFlight: Promise<unknown> = Promise.resolve();
              return {
                push: (chunk) => {
                  inFlight = inFlight
                    .then(() => bridge.pushDictationAudio!({ streamId, chunk }))
                    .then((update) => {
                      if (update.ok) onPartial(update.transcript);
                    })
                    .catch(() => undefined);
                },
                finish: async () => {
                  await inFlight;
                  const result = await bridge.finishDictationStream!(streamId);
                  if (!result.ok) throw toTranscriptionError(result);
                  return result.text;
                },
                cancel: () => {
                  void bridge.cancelDictationStream?.(streamId);
                },
              };
            }
          : undefined;

      return {
        locale: probed.locale,
        ...(startLive ? { startLive } : {}),
        transcribe: async (uri, options) => {
          throwIfVoiceTranscriptionAborted(options.signal);
          const audio = readRecording(uri);
          if (!audio) {
            throw new VoiceTranscriptionError(
              "transcription-failed",
              "The recording was no longer available.",
            );
          }
          const result = await transcribeAudio({ audio, locale: probed.locale });
          throwIfVoiceTranscriptionAborted(options.signal);
          if (!result.ok) throw toTranscriptionError(result);
          return result.text;
        },
      };
    },
  };
}
