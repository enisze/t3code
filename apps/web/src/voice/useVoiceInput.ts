import { useCallback, useEffect, useRef, useState } from "react";
import {
  VoiceInputController,
  voiceInputBlocksSubmission,
  voiceInputFreezesEditor,
  type VoiceDraftSnapshot,
  type VoiceInputState,
} from "@t3tools/client-runtime/voice-input";

import { BrowserVoiceRecorder } from "./BrowserVoiceRecorder.ts";
import { getLocalVoiceTranscriber } from "./desktopVoiceTranscriber.ts";

const INITIAL_STATE: VoiceInputState = { phase: "idle", error: null, errorAction: null };

/**
 * Dictation for the web composer, on top of the same controller mobile uses.
 *
 * The transcriber is desktop-only, so `isAvailable` is false in a browser and
 * the caller renders no mic button at all.
 */
export function useVoiceInput(input: {
  readonly ownerKey: string | null;
  readonly draftMessage: string;
  readonly selection: { readonly start: number; readonly end: number };
  readonly disabled?: boolean;
  readonly onCommitTranscript: (
    text: string,
    selection: { readonly start: number; readonly end: number },
  ) => void;
}) {
  const [state, setState] = useState<VoiceInputState>(INITIAL_STATE);
  const controllerRef = useRef<VoiceInputController | null>(null);
  const recorderRef = useRef<BrowserVoiceRecorder | null>(null);

  // A draft edit between capture and commit invalidates the transcript, which
  // the controller detects by revision rather than by comparing text again.
  const previousDraftRef = useRef({ ownerKey: input.ownerKey, text: input.draftMessage });
  const revisionRef = useRef(0);
  if (
    previousDraftRef.current.ownerKey !== input.ownerKey ||
    previousDraftRef.current.text !== input.draftMessage
  ) {
    previousDraftRef.current = { ownerKey: input.ownerKey, text: input.draftMessage };
    revisionRef.current += 1;
  }
  const latestInputRef = useRef(input);
  latestInputRef.current = input;

  if (!controllerRef.current) {
    const recorder = new BrowserVoiceRecorder((status) =>
      controllerRef.current?.handleRecorderStatus(status),
    );
    recorderRef.current = recorder;
    controllerRef.current = new VoiceInputController({
      recorder,
      getTranscriber: getLocalVoiceTranscriber,
      requestPermission: () => recorder.requestPermission(),
      configureRecording: () => Promise.resolve(),
      releaseRecording: () => Promise.resolve(),
      deleteRecording: (uri) => URL.revokeObjectURL(uri),
      readDraft: (): VoiceDraftSnapshot | null => {
        const current = latestInputRef.current;
        if (!current.ownerKey) return null;
        return {
          ownerKey: current.ownerKey,
          text: current.draftMessage,
          selection: current.selection,
          revision: revisionRef.current,
        };
      },
      commitDraft: (text, selection) => latestInputRef.current.onCommitTranscript(text, selection),
      onStateChange: setState,
    });
  }
  const controller = controllerRef.current;

  const previousOwnerRef = useRef(input.ownerKey);
  useEffect(() => {
    if (previousOwnerRef.current === input.ownerKey) return;
    previousOwnerRef.current = input.ownerKey;
    controller.ownerChanged();
  }, [controller, input.ownerKey]);

  useEffect(() => () => controller.dispose(), [controller]);

  const start = useCallback(() => {
    if (!latestInputRef.current.disabled) void controller.start();
  }, [controller]);
  const stop = useCallback(() => void controller.stop(), [controller]);
  const cancel = useCallback(() => controller.cancel(), [controller]);

  return {
    isAvailable: getLocalVoiceTranscriber() !== null,
    state,
    isBusy: voiceInputBlocksSubmission(state),
    freezesEditor: voiceInputFreezesEditor(state),
    blocksSubmission: voiceInputBlocksSubmission(state),
    start,
    stop,
    cancel,
  };
}
