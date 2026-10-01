import { MicIcon, MicOffIcon, SquareIcon } from "lucide-react";
import type { VoiceInputState } from "@t3tools/client-runtime/voice-input";

import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface ComposerDictationButtonProps {
  state: VoiceInputState;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
}

function describe(state: VoiceInputState): string {
  switch (state.phase) {
    case "preparing":
      return "Preparing dictation...";
    case "recording":
      return "Stop dictation";
    case "transcribing":
      return "Transcribing...";
    case "error":
      return state.error ?? "Dictation failed";
    case "idle":
      return "Dictate a message";
  }
}

/**
 * Mic toggle for the composer footer. Only rendered where the OS speech engine
 * is reachable, so it never appears as a dead control.
 */
export function ComposerDictationButton({
  state,
  disabled,
  onStart,
  onStop,
}: ComposerDictationButtonProps) {
  const isRecording = state.phase === "recording";
  const isPending = state.phase === "preparing" || state.phase === "transcribing";
  const isError = state.phase === "error";
  const label = describe(state);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            data-composer-dictation-state={state.phase}
            aria-pressed={isRecording}
            disabled={disabled || isPending}
            onClick={isRecording ? onStop : onStart}
            className={
              isRecording || isError
                ? "shrink-0 text-destructive hover:text-destructive"
                : "shrink-0 text-muted-foreground/80 hover:text-foreground"
            }
          />
        }
      >
        {isPending ? (
          <Spinner className="size-4" />
        ) : isRecording ? (
          <SquareIcon className="size-4 fill-current" />
        ) : isError ? (
          <MicOffIcon className="size-4" />
        ) : (
          <MicIcon className="size-4" />
        )}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
