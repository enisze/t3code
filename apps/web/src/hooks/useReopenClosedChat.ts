import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { readThreadShell } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { activateWorkspaceChat } from "../workspaceContentTabsStore";
import { useThreadActions } from "./useThreadActions";

/**
 * Reopens a chat closed from a tab strip (Cmd/Ctrl+Shift+T): unarchives it and
 * switches to it, wherever the user has navigated since closing it.
 */
export function useReopenClosedChat() {
  const navigate = useNavigate();
  const { unarchiveThread } = useThreadActions();
  return useCallback(
    async (closed: { environmentId: EnvironmentId; threadId: ThreadId }) => {
      const threadRef = scopeThreadRef(closed.environmentId, closed.threadId);
      // It may have been unarchived elsewhere since; then just switch to it.
      if (readThreadShell(threadRef)?.archivedAt !== null) {
        const result = await unarchiveThread(threadRef);
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Failed to reopen chat",
                description: error instanceof Error ? error.message : "An error occurred.",
              }),
            );
          }
          return;
        }
      }
      activateWorkspaceChat(readThreadShell(threadRef));
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [navigate, unarchiveThread],
  );
}
