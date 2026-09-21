/** What Apple's speech engine wants, and small enough to hand over IPC whole. */
export const DICTATION_SAMPLE_RATE = 16_000;

const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

/**
 * Encode mono float samples as a 16-bit PCM WAV.
 *
 * The helper reads the recording with `AVAudioFile`, which handles WAV but not
 * the Opus-in-WebM that `MediaRecorder` produces, so the renderer decodes and
 * re-encodes before sending anything over IPC.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + samples.length * BYTES_PER_SAMPLE);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let index = 0; index < samples.length; index += 1) {
    // Clamp before scaling; decoded audio can overshoot the nominal range.
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(
      WAV_HEADER_BYTES + index * BYTES_PER_SAMPLE,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    );
  }

  return new Uint8Array(buffer);
}

/** Average the channels so a stereo input device still yields mono. */
export function mixDownToMono(channels: ReadonlyArray<Float32Array>, length: number): Float32Array {
  const first = channels[0];
  if (channels.length === 1 && first) return first;

  const mixed = new Float32Array(length);
  for (const channel of channels) {
    for (let index = 0; index < length; index += 1) {
      mixed[index] = (mixed[index] ?? 0) + (channel[index] ?? 0);
    }
  }
  if (channels.length > 1) {
    for (let index = 0; index < length; index += 1) {
      mixed[index] = (mixed[index] ?? 0) / channels.length;
    }
  }
  return mixed;
}
