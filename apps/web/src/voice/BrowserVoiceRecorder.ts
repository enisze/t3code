import type { VoiceRecorder, VoiceRecorderStatus } from "@t3tools/client-runtime/voice-input";

import { putRecording } from "./recordingStore.ts";
import { DICTATION_SAMPLE_RATE, encodeWav } from "./wavEncoding.ts";

/** Big enough that the callback is rare (~4/s at 16 kHz), small enough to stay responsive. */
const CAPTURE_BUFFER_SIZE = 4096;

/**
 * Records the microphone for the shared `VoiceInputController`.
 *
 * Captures raw PCM through Web Audio rather than `MediaRecorder`. The engine
 * wants 16 kHz mono WAV, and an `AudioContext` fixed at that rate resamples the
 * input device for us, so this needs no audio encoder, no container, and no
 * decode step — all of which are ways the Electron renderer can differ from
 * desktop Chrome. The finished bytes go to the recording store under the `uri`
 * the controller carries to the transcriber.
 */
export class BrowserVoiceRecorder implements VoiceRecorder {
  uri: string | null = null;
  /**
   * The specific reason the last attempt failed. The shared controller reports
   * anything thrown in here as "Could not start voice recording", which is
   * useless for telling a missing device apart from a blocked context, so the
   * step that actually broke is recorded for the UI to show.
   */
  lastFailure: string | null = null;

  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private capturing = false;
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
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.stream.getAudioTracks().length === 0) {
        this.lastFailure = "The microphone returned no audio track.";
        return { granted: false, canAskAgain: false };
      }
      return { granted: true, canAskAgain: true };
    } catch (error) {
      this.lastFailure = `Microphone unavailable: ${describeError(error)}`;
      // Chromium reports a denied prompt and a blocked site with the same
      // name; only the latter cannot be asked again, which we cannot tell
      // apart here, so offer the settings route for both.
      const canAskAgain = !(error instanceof DOMException && error.name === "NotAllowedError");
      return { granted: false, canAskAgain };
    }
  }

  async prepareToRecordAsync(): Promise<void> {
    try {
      if (!this.stream) {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      this.chunks = [];
      this.uri = null;
      this.capturing = false;

      const context = new AudioContext({ sampleRate: DICTATION_SAMPLE_RATE });
      // Autoplay policy can hand back a suspended context even for capture.
      if (context.state === "suspended") await context.resume();

      const source = context.createMediaStreamSource(this.stream);
      const processor = context.createScriptProcessor(CAPTURE_BUFFER_SIZE, 1, 1);
      processor.onaudioprocess = (event) => {
        if (!this.capturing) return;
        // The event buffer is reused between callbacks, so copy it.
        this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };

      // A ScriptProcessor only runs while it reaches the destination, so route
      // it through a silent gain node — connecting it directly would play the
      // microphone back through the speakers.
      const silence = context.createGain();
      silence.gain.value = 0;
      source.connect(processor);
      processor.connect(silence);
      silence.connect(context.destination);

      this.context = context;
      this.source = source;
      this.processor = processor;
    } catch (error) {
      this.lastFailure = `Could not open the audio pipeline: ${describeError(error)}`;
      throw error;
    }
  }

  record({ forDuration }: { readonly forDuration: number }): void {
    this.capturing = true;
    // Nothing here can fail, but mirror the controller's cap so a forgotten
    // recording cannot grow without bound.
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
    this.capturing = false;

    if (this.processor) this.processor.onaudioprocess = null;
    this.source?.disconnect();
    this.processor?.disconnect();
    this.source = null;
    this.processor = null;
    const context = this.context;
    this.context = null;
    if (context) await context.close().catch(() => undefined);
    this.releaseStream();

    const captured = this.chunks;
    this.chunks = [];
    const total = captured.reduce((sum, chunk) => sum + chunk.length, 0);
    if (total === 0) {
      this.lastFailure = "The recording was empty.";
      return;
    }

    const samples = new Float32Array(total);
    let offset = 0;
    for (const chunk of captured) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.uri = putRecording(encodeWav(samples, DICTATION_SAMPLE_RATE));
  }

  /** Release the mic so the OS recording indicator clears promptly. */
  private releaseStream(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
