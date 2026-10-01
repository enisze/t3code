import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";

export type ThreadSyncPhase = "loading" | "syncing" | "failed";

export function resolveThreadSyncPhase(input: {
  readonly detailExists: boolean;
  readonly shellExists: boolean;
  readonly status: EnvironmentThreadStatus;
  /** A retained load diagnostic from the thread subscription, if any. */
  readonly failed: boolean;
}): ThreadSyncPhase | null {
  if (!input.shellExists) {
    return null;
  }

  switch (input.status) {
    case "empty":
    case "cached":
    case "synchronizing":
      if (input.detailExists) {
        return "syncing";
      }
      // A retained diagnostic means the subscription stopped and nothing is in
      // flight: only a reconnect, an app foreground, or an explicit retry
      // restarts it. Reporting progress here is a spinner that never resolves.
      return input.failed ? "failed" : "loading";
    case "deleted":
    case "live":
      return null;
  }
}

export function threadSyncLabel(phase: ThreadSyncPhase): string {
  switch (phase) {
    case "loading":
      return "Loading messages...";
    case "syncing":
      return "Syncing messages...";
    case "failed":
      return "Could not load messages";
  }
}

/** Whether the phase is a stopped load rather than work still in progress. */
export function isThreadSyncFailure(phase: ThreadSyncPhase): boolean {
  return phase === "failed";
}
