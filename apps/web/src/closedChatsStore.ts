/**
 * History of chats closed from a tab strip, newest last, so Cmd/Ctrl+Shift+T
 * can walk back through them like a browser's closed tabs. Each entry
 * remembers its tab group (project + worktree), so the shortcut only brings
 * back chats of the strip it is pressed in. Only chats are remembered; file,
 * diff, and preview tabs are not. Persists across reloads.
 */
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

/** A chat tab strip: a worktree's chats, or a project's local chats. */
export interface ClosedChatScope {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  worktreePath: string | null;
}

export interface ClosedChat extends ClosedChatScope {
  threadId: ThreadId;
}

/** How many closed chats to remember for reopening, across all tab strips. */
const MAX_CLOSED_CHATS = 50;

interface ClosedChatsStore {
  closedChats: ClosedChat[];
  /** Remember a closed chat. Closing it again moves it to the top. */
  pushClosedChat: (closed: ClosedChat) => void;
  /**
   * Pop and return the most recently closed chat of `scope` (of any strip when
   * null), or null when there is none.
   */
  popClosedChat: (scope: ClosedChatScope | null) => ClosedChat | null;
}

const isSameChat = (a: ClosedChat, b: ClosedChat) =>
  a.environmentId === b.environmentId && a.threadId === b.threadId;

const isInScope = (chat: ClosedChat, scope: ClosedChatScope) =>
  chat.environmentId === scope.environmentId &&
  chat.projectId === scope.projectId &&
  chat.worktreePath === scope.worktreePath;

export const useClosedChatsStore = create<ClosedChatsStore>()(
  persist(
    (set, get) => ({
      closedChats: [],
      pushClosedChat: (closed) =>
        set((state) => ({
          closedChats: [
            ...state.closedChats.filter((entry) => !isSameChat(entry, closed)),
            closed,
          ].slice(-MAX_CLOSED_CHATS),
        })),
      popClosedChat: (scope) => {
        const { closedChats } = get();
        const index = closedChats.findLastIndex((entry) => !scope || isInScope(entry, scope));
        if (index === -1) return null;
        set({ closedChats: closedChats.filter((_, entryIndex) => entryIndex !== index) });
        return closedChats[index] ?? null;
      },
    }),
    {
      name: "t3code:closed-chats:v1",
      version: 2,
      // v1 entries carry no tab group, so they cannot be scoped to a strip.
      migrate: () => ({ closedChats: [] }),
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ closedChats: state.closedChats }),
      merge: (persisted, current) => {
        const closedChats = (persisted as { closedChats?: unknown } | undefined)?.closedChats;
        return {
          ...current,
          closedChats: Array.isArray(closedChats)
            ? (closedChats as ClosedChat[]).slice(-MAX_CLOSED_CHATS)
            : [],
        };
      },
    },
  ),
);
