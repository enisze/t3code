/**
 * Window-wide history of chats closed from a tab strip, newest last, so
 * Cmd/Ctrl+Shift+T can walk back through them like a browser's closed tabs.
 * Only chats are remembered; file, diff, and preview tabs are not. Persists
 * across reloads.
 */
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

export interface ClosedChat {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}

/** How many closed chats to remember for reopening. */
const MAX_CLOSED_CHATS = 20;

interface ClosedChatsStore {
  closedChats: ClosedChat[];
  /** Remember a closed chat. Closing it again moves it to the top. */
  pushClosedChat: (closed: ClosedChat) => void;
  /** Pop and return the most recently closed chat, or null when there is none. */
  popClosedChat: () => ClosedChat | null;
}

const isSameChat = (a: ClosedChat, b: ClosedChat) =>
  a.environmentId === b.environmentId && a.threadId === b.threadId;

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
      popClosedChat: () => {
        const popped = get().closedChats.at(-1) ?? null;
        if (popped) set((state) => ({ closedChats: state.closedChats.slice(0, -1) }));
        return popped;
      },
    }),
    {
      name: "t3code:closed-chats:v1",
      version: 1,
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
