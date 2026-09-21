/**
 * Hands a finished recording from the recorder to the transcriber.
 *
 * The two only share the opaque `uri` string the shared VoiceInputController
 * passes between them, so the bytes are parked here under that key. An earlier
 * version used a blob URL and `fetch`, which is one more thing to get wrong in
 * a renderer served from a custom scheme — and buys nothing, since both sides
 * live in the same renderer.
 */
const recordings = new Map<string, Uint8Array>();
let nextRecordingId = 0;

export function putRecording(bytes: Uint8Array): string {
  nextRecordingId += 1;
  const uri = `t3-recording:${nextRecordingId}`;
  recordings.set(uri, bytes);
  return uri;
}

export function readRecording(uri: string): Uint8Array | null {
  return recordings.get(uri) ?? null;
}

/** The controller calls this for every recording it owns, including discarded ones. */
export function deleteRecording(uri: string): void {
  recordings.delete(uri);
}
