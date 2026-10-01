import { assert, describe, it } from "@effect/vitest";
import {
  DesktopDictationProbeResultSchema,
  DesktopDictationResultSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const decodeProbe = Schema.decodeUnknownEffect(
  Schema.fromJsonString(DesktopDictationProbeResultSchema),
);
const decodeTranscribe = Schema.decodeUnknownEffect(
  Schema.fromJsonString(DesktopDictationResultSchema),
);

/**
 * Verbatim lines from `native/speech-transcriber`. A probe reports no
 * transcript, so decoding one against the transcribe schema fails — which is
 * exactly the bug these cover: the probe was decoded with the wrong shape,
 * turned into "unreadable result", and surfaced as a generic preparation
 * failure with the real cause nowhere in sight.
 */
const HELPER_PROBE_LINE = '{"locale":"de-DE","ok":true}';
const HELPER_TRANSCRIBE_LINE = '{"locale":"en-US","ok":true,"text":"Hello, world."}';
const HELPER_FAILURE_LINE =
  '{"code":"unsupported-locale","message":"Dictation does not support xx-XX.","ok":false}';

describe("dictation helper wire format", () => {
  it.effect("decodes what the helper prints for a probe", () =>
    Effect.gen(function* () {
      const result = yield* decodeProbe(HELPER_PROBE_LINE);

      assert.isTrue(result.ok);
      assert.strictEqual(result.ok ? result.locale : null, "de-DE");
    }),
  );

  it.effect("decodes what the helper prints for a transcription", () =>
    Effect.gen(function* () {
      const result = yield* decodeTranscribe(HELPER_TRANSCRIBE_LINE);

      assert.isTrue(result.ok);
      assert.strictEqual(result.ok ? result.text : null, "Hello, world.");
    }),
  );

  it.effect("decodes a helper failure through either shape", () =>
    Effect.gen(function* () {
      const probe = yield* decodeProbe(HELPER_FAILURE_LINE);
      const transcribe = yield* decodeTranscribe(HELPER_FAILURE_LINE);

      assert.strictEqual(probe.ok ? null : probe.code, "unsupported-locale");
      assert.strictEqual(transcribe.ok ? null : transcribe.code, "unsupported-locale");
    }),
  );

  it.effect("refuses a probe line decoded as a transcription", () =>
    Effect.gen(function* () {
      // The regression itself: a probe carries no `text`, so this must fail
      // loudly rather than be silently reinterpreted as an error result.
      const error = yield* decodeTranscribe(HELPER_PROBE_LINE).pipe(Effect.flip);

      assert.strictEqual(error._tag, "SchemaError");
    }),
  );
});
