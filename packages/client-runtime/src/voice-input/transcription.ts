/** Cancellation is cooperative: settle only after the underlying work has stopped. */
export type VoiceTranscriptionOptions = {
  readonly signal: AbortSignal;
};

/** Binds a recording to its selected implementation and resolved locale. */
export type PreparedVoiceTranscription = {
  readonly locale: string;
  readonly transcribe: (uri: string, options: VoiceTranscriptionOptions) => Promise<string>;
  /**
   * Present only where the platform can stream. The controller prefers this
   * over `transcribe` so the draft fills in as the speaker talks; clients
   * without it keep the record-then-transcribe behaviour unchanged.
   */
  readonly startLive?: (
    onPartial: (transcript: string) => void,
    options: VoiceTranscriptionOptions,
  ) => Promise<VoiceLiveSession>;
};

/**
 * A transcription that reports text while the speaker is still talking.
 *
 * The engine emits a run of provisional lines and then a final one that
 * supersedes them, so `onPartial` always receives the full transcript so far
 * rather than a delta.
 */
export type VoiceLiveSession = {
  /** Feed captured audio in the encoding the session advertised. */
  readonly push: (chunk: Uint8Array) => void;
  /** Close the input and resolve with the finished transcript. */
  readonly finish: () => Promise<string>;
  readonly cancel: () => void;
};

export type VoiceTranscriber = {
  readonly prepare: (options: VoiceTranscriptionOptions) => Promise<PreparedVoiceTranscription>;
};

export type VoiceTranscriptionErrorCode =
  | "unavailable"
  | "unsupported-locale"
  | "preparation-failed"
  | "transcription-failed"
  | "cancelled";

export class VoiceTranscriptionError extends Error {
  readonly code: VoiceTranscriptionErrorCode;

  constructor(code: VoiceTranscriptionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VoiceTranscriptionError";
    this.code = code;
  }
}

export function throwIfVoiceTranscriptionAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new VoiceTranscriptionError("cancelled", "Voice transcription was cancelled.");
  }
}
