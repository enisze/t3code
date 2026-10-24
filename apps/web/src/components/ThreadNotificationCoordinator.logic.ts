import type { OrchestrationThreadShell } from "@t3tools/contracts";

import { resolveThreadStatusPill } from "./Sidebar.logic";

type AlertThread = Pick<
  OrchestrationThreadShell,
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "interactionMode"
  | "latestTurn"
  | "session"
>;

interface ThreadAlertState {
  /** Changes when the thread newly needs approval or input, or fails. */
  readonly attention: {
    readonly key: string;
    readonly title: string;
    readonly failed: boolean;
  } | null;
  /** The latest turn, once the thread reads as finished in the sidebar. */
  readonly completion: { readonly at: number; readonly title: string } | null;
}

// An alert is always about a turn the user has not seen yet.
const NEVER_VISITED_AT = new Date(0).toISOString();

/**
 * What a thread's state alerts about, read through the sidebar's status pill:
 * a finished alert fires exactly when the green Completed (or Plan Ready) pill
 * would appear for an unseen turn, and waits while the thread still works.
 */
export function resolveThreadAlertState(thread: AlertThread): ThreadAlertState {
  const pill = resolveThreadStatusPill({
    thread: { ...thread, lastVisitedAt: NEVER_VISITED_AT },
  })?.label;
  const turnId = thread.latestTurn?.turnId ?? "";
  if (pill === "Pending Approval") {
    return {
      attention: { key: `${turnId}:approval`, title: "Approval needed", failed: false },
      completion: null,
    };
  }
  if (pill === "Awaiting Input") {
    return {
      attention: { key: `${turnId}:input`, title: "Input needed", failed: false },
      completion: null,
    };
  }
  if (pill === "Working" || pill === "Connecting") {
    return { attention: null, completion: null };
  }
  if (thread.session?.status === "error" || thread.latestTurn?.state === "error") {
    return {
      attention: { key: `${turnId}:failed`, title: "Thread failed", failed: true },
      completion: null,
    };
  }
  const completedAt = Date.parse(thread.latestTurn?.completedAt ?? "");
  if (
    thread.latestTurn?.state === "completed" &&
    Number.isFinite(completedAt) &&
    (pill === "Completed" || pill === "Plan Ready")
  ) {
    return {
      attention: null,
      completion: {
        at: completedAt,
        title: pill === "Plan Ready" ? "Plan ready" : "Thread completed",
      },
    };
  }
  return { attention: null, completion: null };
}
