import type { OrchestrationMessage } from "@t3tools/contracts";

import type { TimelineEntry } from "../../session-logic";
import type { ChatMessageStructure } from "../../types";

type StructureEntry = TimelineEntry<ChatMessageStructure>;

// Assistant replies and reasoning traces stream their text; the structure
// carries neither, so their text comes from the live messages.
const streamsText = (role: OrchestrationMessage["role"]) =>
  role === "assistant" || role === "reasoning";

export function indexLiveAssistantMessages(
  messages: ReadonlyArray<OrchestrationMessage>,
): ReadonlyMap<string, OrchestrationMessage> {
  const byId = new Map<string, OrchestrationMessage>();
  for (const message of messages) {
    if (streamsText(message.role)) byId.set(message.id, message);
  }
  return byId;
}

// The rendered entry for each structure entry, rebuilt only when the live
// message it shows changes, so unchanged rows keep their identity per delta.
const renderedEntries = new WeakMap<
  StructureEntry,
  { readonly live: OrchestrationMessage | undefined; readonly entry: TimelineEntry }
>();

function renderedEntry(
  entry: StructureEntry,
  liveAssistantMessages: ReadonlyMap<string, OrchestrationMessage>,
): TimelineEntry {
  if (entry.kind !== "message") return entry;
  const { message } = entry;
  const live = streamsText(message.role) ? liveAssistantMessages.get(message.id) : undefined;
  const cached = renderedEntries.get(entry);
  if (cached !== undefined && cached.live === live) return cached.entry;
  const rendered: TimelineEntry = {
    ...entry,
    message:
      message.role === "assistant" || message.role === "reasoning"
        ? {
            ...message,
            text: live?.text ?? "",
            updatedAt: live?.updatedAt ?? message.createdAt,
          }
        : message,
  };
  renderedEntries.set(entry, { live, entry: rendered });
  return rendered;
}

/**
 * Timeline entries built from a thread structure, with each assistant message's
 * text taken from its live message. Entries whose live message did not change
 * come back as the same objects.
 */
export function withLiveAssistantText(
  entries: ReadonlyArray<StructureEntry>,
  liveAssistantMessages: ReadonlyMap<string, OrchestrationMessage>,
): TimelineEntry[] {
  return entries.map((entry) => renderedEntry(entry, liveAssistantMessages));
}
