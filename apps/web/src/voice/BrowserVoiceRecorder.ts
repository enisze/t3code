import type { VoiceRecorder, VoiceRecorderStatus } from "@t3tools/client-runtime/voice-input";

import { DICTATION_SAMPLE_RATE, encodeWav, mixDownToMono } from "./wavEncoding.ts";

/**
 * Records the microphone for the shared `VoiceInputController`.
 *
 * `MediaRecorder` gives us efficient native capture but only Opus-in-WebM,
 * which Apple's engine cannot read. The recording is therefore decoded and
 * re-encoded to 16 kHz mono WAV on stop, and handed on as a blob URL that the
 * transcriber fetches — the same `uri` shape the mobile recorder produces.
 */
export class BrowserVoiceRecorder implements VoiceRecorder {
  uri: string | null = null;

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
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return { granted: true, canAskAgain: true };
    } catch (error) {
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
    const recorder = new MediaRecorder(this.stream);
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
    this.recorder?.start();
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
    if (recorded.size === 0) return;
    this.uri = URL.createObjectURL(await this.toWav(recorded));
  }

  /** Release the mic so the OS recording indicator clears promptly. */
  private releaseStream(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }

  private async toWav(recorded: Blob): Promise<Blob> {
    // Decoding on a 16 kHz context resamples for us, so no hand-written
    // downsampling (and no aliasing from a naive one).
    const context = new OfflineAudioContext(1, 1, DICTATION_SAMPLE_RATE);
    const decoded = await context.decodeAudioData(await recorded.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) =>
      decoded.getChannelData(index),
    );
    const mono = mixDownToMono(channels, decoded.length);
    const wav = encodeWav(mono, decoded.sampleRate);
    return new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" });
  }
}
