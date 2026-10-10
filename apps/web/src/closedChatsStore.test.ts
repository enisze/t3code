import { beforeEach, describe, expect, it } from "vite-plus/test";

import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useClosedChatsStore } from "./closedChatsStore";

const chat = (id: string) => ({
  environmentId: EnvironmentId.make("env-1"),
  threadId: ThreadId.make(id),
});

const pop = () => useClosedChatsStore.getState().popClosedChat();

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

  it("moves a chat closed again to the top instead of listing it twice", () => {
    const store = useClosedChatsStore.getState();
    store.pushClosedChat(chat("a"));
    store.pushClosedChat(chat("b"));
    store.pushClosedChat(chat("a"));
    expect([pop(), pop(), pop()]).toEqual([chat("a"), chat("b"), null]);
  });

  it("bounds the history to the last 20 chats", () => {
    const store = useClosedChatsStore.getState();
    for (let index = 0; index < 22; index += 1) store.pushClosedChat(chat(`t-${index}`));
    const popped: string[] = [];
    for (let closed = pop(); closed; closed = pop()) popped.push(closed.threadId);
    expect(popped).toEqual(Array.from({ length: 20 }, (_, index) => `t-${21 - index}`));
  });

  it("persists the history", async () => {
    useClosedChatsStore.getState().pushClosedChat(chat("a"));
    const { name, storage } = useClosedChatsStore.persist.getOptions();
    const saved = await storage?.getItem(name ?? "");
    expect(saved?.state).toEqual({ closedChats: [chat("a")] });
  });
});
