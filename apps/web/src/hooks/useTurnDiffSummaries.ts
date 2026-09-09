import { useMemo } from "react";
import { inferCheckpointTurnCountByTurnId } from "../session-logic";
import type { Thread, TurnDiffSummary } from "../types";

export function useTurnDiffSummaries(activeThread: Thread | null | undefined) {
  const turnDiffSummaries = useMemo<ReadonlyArray<TurnDiffSummary>>(() => {
    if (!activeThread) {
      return [];
    }
    return activeThread.checkpoints;
  }, [activeThread]);

  const inferredCheckpointTurnCountByTurnId = useMemo(
    () => inferCheckpointTurnCountByTurnId(turnDiffSummaries),
    [turnDiffSummaries],
  );

  /** Newest turn first, so `[0]` is the thread's latest checkpoint. */
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightTurnCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );

  return { turnDiffSummaries, orderedTurnDiffSummaries, inferredCheckpointTurnCountByTurnId };
}
