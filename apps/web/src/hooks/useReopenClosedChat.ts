import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { type ClosedChat, type ClosedChatScope, useClosedChatsStore } from "../closedChatsStore";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { readThreadShell, waitForThreadShell } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { activateWorkspaceChat } from "../workspaceContentTabsStore";
import { useThreadActions } from "./useThreadActions";

const showReopenError = (error: unknown) =>
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Failed to reopen chat",
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );

/** Archived chats are absent from the shell store; open ones are present. */
const isChatOpen = (closed: ClosedChat) =>
  readThreadShell(scopeThreadRef(closed.environmentId, closed.threadId))?.archivedAt === null;

/**
 * Reopens the most recently closed chat of a tab strip (Cmd/Ctrl+Shift+T), or
 * of any strip when `scope` is null: unarchives it and switches to it.
 * Repeated calls walk back through older closed chats.
 */
export function useReopenClosedChat() {
  const navigate = useNavigate();
  const { unarchiveThread } = useThreadActions();
  return useCallback(
    async (scope: ClosedChatScope | null) => {
      const { popClosedChat } = useClosedChatsStore.getState();
      let closed = popClosedChat(scope);
      // Skip chats already reopened another way (sidebar, archive, palette).
      while (closed && isChatOpen(closed)) closed = popClosedChat(scope);
      if (!closed) return;
      const threadRef = scopeThreadRef(closed.environmentId, closed.threadId);
      const result = await unarchiveThread(threadRef);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) showReopenError(squashAtomCommandFailure(result));
        return;
      }
      // The thread route redirects a thread it doesn't know to a new chat, so
      // wait until the unarchived chat is back in the client store.
      const shell = await waitForThreadShell(threadRef).catch((error: unknown) => {
        showReopenError(error);
        return null;
      });
      if (!shell) return;
      activateWorkspaceChat(shell);
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [navigate, unarchiveThread],
  );
}
