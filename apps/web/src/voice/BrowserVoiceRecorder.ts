import type { VoiceRecorder, VoiceRecorderStatus } from "@t3tools/client-runtime/voice-input";

import { putRecording } from "./recordingStore.ts";
import { DICTATION_SAMPLE_RATE, encodeWav, mixDownToMono } from "./wavEncoding.ts";

/**
 * Records the microphone for the shared `VoiceInputController`.
 *
 * `MediaRecorder` gives us efficient native capture but only Opus-in-WebM,
 * which Apple's engine cannot read. The recording is therefore decoded and
 * re-encoded to 16 kHz mono WAV on stop and parked in the recording store,
 * whose key is the `uri` the controller carries to the transcriber.
 */
export class BrowserVoiceRecorder implements VoiceRecorder {
  uri: string | null = null;
  /**
   * The specific reason the last attempt failed. The shared controller reports
   * anything thrown in here as "Could not start voice recording", which is
   * useless for telling a missing codec apart from a muted device, so the step
   * that actually broke is recorded for the UI to show.
   */
  lastFailure: string | null = null;

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onStatus: (status: VoiceRecorderStatus) => void;

  constructor(onStatus: (status: VoiceRecorderStatus) => void) {
    this.onStatus = onStatus;
  }

  /**
   * Acquiring the stream *is* the permission prompt on the web, so the granted
   * stream is kept for the recorder rather than opened twice.
   */
  async requestPermission(): Promise<{ granted: boolean; canAskAgain: boolean }> {
    this.lastFailure = null;
    try {
      if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
        this.lastFailure = "This build has no microphone API (navigator.mediaDevices).";
        return { granted: false, canAskAgain: false };
      }
      if (typeof MediaRecorder === "undefined") {
        this.lastFailure = "This build has no MediaRecorder support.";
        return { granted: false, canAskAgain: false };
      }
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tracks = this.stream.getAudioTracks();
      if (tracks.length === 0) {
        this.lastFailure = "The microphone returned no audio track.";
        return { granted: false, canAskAgain: false };
      }
      return { granted: true, canAskAgain: true };
    } catch (error) {
      this.lastFailure = `Microphone unavailable: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
      // Chromium reports a denied prompt and a blocked site with the same
      // name; only the latter cannot be asked again, which we cannot tell
      // apart here, so offer the settings route for both.
      const canAskAgain = !(error instanceof DOMException && error.name === "NotAllowedError");
      return { granted: false, canAskAgain };
    }
  }

  async prepareToRecordAsync(): Promise<void> {
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    this.chunks = [];
    this.uri = null;
    const recorder = this.createRecorder(this.stream);
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    recorder.addEventListener("error", () => {
      this.onStatus({
        isFinished: false,
        hasError: true,
        error: "The microphone stopped unexpectedly.",
        url: null,
      });
    });
    this.recorder = recorder;
  }

  record({ forDuration }: { readonly forDuration: number }): void {
    try {
      this.recorder?.start();
    } catch (error) {
      this.lastFailure = `Could not start the recorder: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
      throw error;
    }
    // MediaRecorder has no built-in limit; mirror the controller's cap so a
    // forgotten recording cannot grow without bound.
    this.stopTimer = setTimeout(() => {
      void this.stop().then(() => {
        this.onStatus({ isFinished: true, hasError: false, error: null, url: this.uri });
      });
    }, forDuration * 1_000);
  }

  async stop(): Promise<void> {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") {
      this.releaseStream();
      return;
    }

    await new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    });
    this.recorder = null;
    this.releaseStream();

    const recorded = new Blob(this.chunks, { type: this.chunks[0]?.type ?? "audio/webm" });
    this.chunks = [];
    if (recorded.size === 0) {
      throw new Error("The recording was empty.");
    }
    this.uri = putRecording(await this.toWav(recorded));
  }

  /**
   * Electron ships a narrower codec set than desktop Chrome, so the container
   * is negotiated rather than assumed; an unsupported default is one of the
   * ways construction throws.
   */
  private createRecorder(stream: MediaStream): MediaRecorder {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""];
    const supported = candidates.find((type) => type === "" || MediaRecorder.isTypeSupported(type));
    try {
      return supported
        ? new MediaRecorder(stream, { mimeType: supported })
        : new MediaRecorder(stream);
    } catch (error) {
      this.lastFailure = `Could not create the recorder (tried ${supported || "default"}): ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
      throw error;
    }
  }

  /** Release the mic so the OS recording indicator clears promptly. */
  private releaseStream(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }

  private async toWav(recorded: Blob): Promise<Uint8Array> {
    // Decoding on a 16 kHz context resamples for us, so no hand-written
    // downsampling (and no aliasing from a naive one).
    const context = new OfflineAudioContext(1, 1, DICTATION_SAMPLE_RATE);
    let decoded: AudioBuffer;
    try {
      decoded = await context.decodeAudioData(await recorded.arrayBuffer());
    } catch (cause) {
      // Name the failing step; the controller's own message for anything
      // thrown here is a generic "could not finish voice recording".
      this.lastFailure = `Could not decode the recording (${recorded.type}): ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`;
      throw new Error(this.lastFailure, { cause });
    }
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) =>
      decoded.getChannelData(index),
    );
    const mono = mixDownToMono(channels, decoded.length);
    return encodeWav(mono, decoded.sampleRate);
  }
}
