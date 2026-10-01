import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";

import { isThreadSyncFailure, threadSyncLabel, type ThreadSyncPhase } from "../../threadSync";

export function ThreadSyncStatusPill({
  phase,
  onRetry,
}: {
  readonly phase: ThreadSyncPhase;
  readonly onRetry: () => void;
}) {
  const label = threadSyncLabel(phase);
  const failed = isThreadSyncFailure(phase);

  return (
    <div
      aria-label={label}
      // The pill floats over the timeline, so only its action takes clicks.
      className="pointer-events-none mx-auto mb-2 flex w-fit max-w-full items-center gap-2 rounded-full border border-border/60 bg-card/95 px-3 py-1.5 text-foreground text-xs font-medium shadow-sm"
      role="status"
    >
      {failed ? (
        <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0 text-destructive" />
      ) : (
        <LoaderCircleIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{label}</span>
      {failed ? (
        <button
          className="pointer-events-auto shrink-0 rounded-full px-1.5 py-0.5 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={onRetry}
          type="button"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
