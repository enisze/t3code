import { beforeEach, describe, expect, it } from "vite-plus/test";

import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import { type ClosedChatScope, useClosedChatsStore } from "./closedChatsStore";

const worktree: ClosedChatScope = {
  environmentId: EnvironmentId.make("env-1"),
  projectId: ProjectId.make("project-1"),
  worktreePath: "/worktrees/feature",
};
const otherWorktree: ClosedChatScope = { ...worktree, worktreePath: "/worktrees/other" };
const localChats: ClosedChatScope = { ...worktree, worktreePath: null };

const chat = (id: string, scope = worktree) => ({ ...scope, threadId: ThreadId.make(id) });

const pop = (scope: ClosedChatScope | null = worktree) =>
  useClosedChatsStore.getState().popClosedChat(scope);

beforeEach(() => {
  useClosedChatsStore.setState({ closedChats: [] });
});

describe("closedChatsStore", () => {
  it("reopens every closed chat, newest first", () => {
    const store = useClosedChatsStore.getState();
    store.pushClosedChat(chat("a"));
    store.pushClosedChat(chat("b"));
    store.pushClosedChat(chat("c"));
    expect([pop(), pop(), pop(), pop()]).toEqual([chat("c"), chat("b"), chat("a"), null]);
  });

  it("only reopens chats closed from the same tab strip", () => {
    const store = useClosedChatsStore.getState();
    store.pushClosedChat(chat("a"));
    store.pushClosedChat(chat("other", otherWorktree));
    store.pushClosedChat(chat("local", localChats));
    store.pushClosedChat(chat("b"));
    expect([pop(), pop(), pop()]).toEqual([chat("b"), chat("a"), null]);
    expect(pop(otherWorktree)).toEqual(chat("other", otherWorktree));
    expect(pop(localChats)).toEqual(chat("local", localChats));
  });

  it("reopens the latest chat of any strip without a scope", () => {
    const store = useClosedChatsStore.getState();
    store.pushClosedChat(chat("a"));
    store.pushClosedChat(chat("other", otherWorktree));
    expect([pop(null), pop(null), pop(null)]).toEqual([
      chat("other", otherWorktree),
      chat("a"),
      null,
    ]);
  });

  it("moves a chat closed again to the top instead of listing it twice", () => {
    const store = useClosedChatsStore.getState();
    store.pushClosedChat(chat("a"));
    store.pushClosedChat(chat("b"));
    store.pushClosedChat(chat("a"));
    expect([pop(), pop(), pop()]).toEqual([chat("a"), chat("b"), null]);
  });

  it("bounds the history to the last 50 chats", () => {
    const store = useClosedChatsStore.getState();
    for (let index = 0; index < 52; index += 1) store.pushClosedChat(chat(`t-${index}`));
    const popped: string[] = [];
    for (let closed = pop(); closed; closed = pop()) popped.push(closed.threadId);
    expect(popped).toEqual(Array.from({ length: 50 }, (_, index) => `t-${51 - index}`));
  });

  it("persists the history", async () => {
    useClosedChatsStore.getState().pushClosedChat(chat("a"));
    const { name, storage } = useClosedChatsStore.persist.getOptions();
    const saved = await storage?.getItem(name ?? "");
    expect(saved?.state).toEqual({ closedChats: [chat("a")] });
  });
});
