import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceTranscriptionError } from "@t3tools/client-runtime/voice-input";

import { getLocalVoiceTranscriber } from "./desktopVoiceTranscriber.ts";

/** The unit project runs without a DOM, so the host window is stubbed outright. */
function installBridge(bridge: Record<string, unknown> | undefined) {
  vi.stubGlobal("window", bridge === undefined ? {} : { desktopBridge: bridge });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getLocalVoiceTranscriber", () => {
  it("is absent in a plain browser, which hides the mic button", () => {
    installBridge(undefined);
    expect(getLocalVoiceTranscriber()).toBeNull();
  });

  it("is absent on a desktop build without the speech helper", () => {
    installBridge({ getSystemLocale: () => "en-US" });
    expect(getLocalVoiceTranscriber()).toBeNull();
  });

  it("surfaces an unsupported language as a typed error rather than a silent failure", async () => {
    installBridge({
      getSystemLocale: () => "xx-XX",
      probeDictation: vi.fn(async () => ({
        ok: false as const,
        code: "unsupported-locale" as const,
        message: "Dictation does not support xx-XX.",
      })),
      transcribeAudio: vi.fn(),
    });

    const transcriber = getLocalVoiceTranscriber();
    const error = await transcriber!
      .prepare({ signal: new AbortController().signal })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(VoiceTranscriptionError);
    expect((error as VoiceTranscriptionError).code).toBe("unsupported-locale");
  });

  it("transcribes with the locale the engine resolved, not the one requested", async () => {
    const transcribeAudio = vi.fn(async () => ({
      ok: true as const,
      text: "hello world",
      locale: "en-US",
    }));
    installBridge({
      // The OS reports a region the engine has no model for; the probe
      // resolves it to a supported one and that is what must be used.
      getSystemLocale: () => "en-AU",
      probeDictation: vi.fn(async () => ({ ok: true as const, text: "", locale: "en-US" })),
      transcribeAudio,
    });
    const audio = Uint8Array.from([1, 2, 3]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(audio)),
    );

    const prepared = await getLocalVoiceTranscriber()!.prepare({
      signal: new AbortController().signal,
    });
    const transcript = await prepared.transcribe("blob:recording", {
      signal: new AbortController().signal,
    });

    expect(prepared.locale).toBe("en-US");
    expect(transcript).toBe("hello world");
    expect(transcribeAudio).toHaveBeenCalledWith({ audio, locale: "en-US" });
  });

  it("stops before transcribing when the recording was already cancelled", async () => {
    const transcribeAudio = vi.fn();
    installBridge({
      getSystemLocale: () => "en-US",
      probeDictation: vi.fn(async () => ({ ok: true as const, text: "", locale: "en-US" })),
      transcribeAudio,
    });

    const prepared = await getLocalVoiceTranscriber()!.prepare({
      signal: new AbortController().signal,
    });
    const aborted = AbortSignal.abort();
    await expect(prepared.transcribe("blob:recording", { signal: aborted })).rejects.toThrow(
      VoiceTranscriptionError,
    );
    expect(transcribeAudio).not.toHaveBeenCalled();
  });
});
