import { describe, expect, it } from "vitest";

import { encodeWav } from "./wavEncoding.ts";

const readAscii = (view: DataView, offset: number, length: number) =>
  Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join("");

describe("encodeWav", () => {
  it("describes the samples it carries in the RIFF header", () => {
    const wav = encodeWav(new Float32Array([0, 0, 0, 0]), 16_000);
    const view = new DataView(wav.buffer);

    expect(readAscii(view, 0, 4)).toBe("RIFF");
    expect(readAscii(view, 8, 4)).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    // 4 samples at 2 bytes each, and a RIFF size covering everything after it.
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
  });

  it("maps full-scale samples to the endpoints of the 16-bit range", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]), 16_000);
    const view = new DataView(wav.buffer);

    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32_767);
    expect(view.getInt16(48, true)).toBe(-32_768);
  });

  it("clamps samples that overshoot, which decoded audio can do", () => {
    const wav = encodeWav(new Float32Array([1.5, -1.5]), 16_000);
    const view = new DataView(wav.buffer);

    expect(view.getInt16(44, true)).toBe(32_767);
    expect(view.getInt16(46, true)).toBe(-32_768);
  });
});
