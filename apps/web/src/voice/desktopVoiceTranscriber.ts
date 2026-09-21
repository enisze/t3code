import type { DesktopDictationResult } from "@t3tools/contracts";
import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type PreparedVoiceTranscription,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";

function toTranscriptionError(result: Extract<DesktopDictationResult, { ok: false }>) {
  return new VoiceTranscriptionError(result.code, result.message);
}

/**
 * Dictation through the desktop app's bundled macOS speech helper.
 *
 * Returns null in a plain browser and on desktop builds without the helper
 * (everything but macOS), which is what hides the composer's mic button.
 */
export function getLocalVoiceTranscriber(): VoiceTranscriber | null {
  const bridge = globalThis.window?.desktopBridge;
  if (!bridge?.transcribeAudio || !bridge.probeDictation) return null;
  const transcribeAudio = bridge.transcribeAudio;
  const probeDictation = bridge.probeDictation;

  return {
    prepare: async ({ signal }): Promise<PreparedVoiceTranscription> => {
      throwIfVoiceTranscriptionAborted(signal);
      const requestedLocale = bridge.getSystemLocale?.() ?? navigator.language;
      // The probe resolves the locale the engine will really use and installs
      // the on-device model, so the first recording is not also the download.
      const probed = await probeDictation(requestedLocale);
      throwIfVoiceTranscriptionAborted(signal);
      if (!probed.ok) throw toTranscriptionError(probed);

      return {
        locale: probed.locale,
        transcribe: async (uri, options) => {
          throwIfVoiceTranscriptionAborted(options.signal);
          const audio = new Uint8Array(await (await fetch(uri)).arrayBuffer());
          throwIfVoiceTranscriptionAborted(options.signal);
          const result = await transcribeAudio({ audio, locale: probed.locale });
          throwIfVoiceTranscriptionAborted(options.signal);
          if (!result.ok) throw toTranscriptionError(result);
          return result.text;
        },
      };
    },
  };
}
