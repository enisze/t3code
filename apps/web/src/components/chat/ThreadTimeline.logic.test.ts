import { MessageId, TurnId, type OrchestrationMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry } from "../../session-logic";
import type { ChatMessageStructure } from "../../types";
import { indexLiveAssistantMessages, withLiveAssistantText } from "./ThreadTimeline.logic";

const TURN_ID = TurnId.make("turn-1");
const user: OrchestrationMessage = {
  id: MessageId.make("user-1"),
  role: "user",
  text: "Explain the change",
  turnId: TURN_ID,
  streaming: false,
  createdAt: "2026-04-01T00:00:01.000Z",
  updatedAt: "2026-04-01T00:00:01.000Z",
};
const reply: OrchestrationMessage = {
  id: MessageId.make("assistant-1"),
  role: "assistant",
  text: "It",
  turnId: TURN_ID,
  streaming: true,
  createdAt: "2026-04-01T00:00:02.000Z",
  updatedAt: "2026-04-01T00:00:02.000Z",
};
const earlierReply: OrchestrationMessage = {
  ...reply,
  id: MessageId.make("assistant-0"),
  text: "Earlier answer",
  streaming: false,
  createdAt: "2026-04-01T00:00:00.500Z",
};

const messageEntry = (message: ChatMessageStructure): TimelineEntry<ChatMessageStructure> => ({
  id: message.id,
  kind: "message",
  createdAt: message.createdAt,
  message,
});
// What a thread structure carries for an assistant message: no text, no stamp.
const structureOf = ({
  text: _text,
  updatedAt: _updatedAt,
  ...message
}: OrchestrationMessage): ChatMessageStructure => ({ ...message, role: "assistant" });

describe("withLiveAssistantText", () => {
  const entries = [
    messageEntry(structureOf(earlierReply)),
    messageEntry(user as ChatMessageStructure),
    messageEntry(structureOf(reply)),
  ];

  it("shows each assistant message's live text", () => {
    const rendered = withLiveAssistantText(
      entries,
      indexLiveAssistantMessages([earlierReply, user, reply]),
    );

    expect(rendered.map((entry) => entry.kind === "message" && entry.message.text)).toEqual([
      "Earlier answer",
      "Explain the change",
      "It",
    ]);
  });

  it("rebuilds only the entry whose message streamed", () => {
    const before = withLiveAssistantText(
      entries,
      indexLiveAssistantMessages([earlierReply, user, reply]),
    );
    const after = withLiveAssistantText(
      entries,
      indexLiveAssistantMessages([earlierReply, user, { ...reply, text: "It works" }]),
    );

    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).not.toBe(before[2]);
    expect(after[2]?.kind === "message" && after[2].message.text).toBe("It works");
  });
});
