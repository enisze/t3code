import type { ScopedThreadRef } from "@t3tools/contracts";
import { type ComponentProps, memo, useEffect, useMemo } from "react";

import type { TimelineEntry } from "../../session-logic";
import { useThreadMessages } from "../../state/entities";
import type { ChatMessageStructure } from "../../types";
import { MessagesTimeline } from "./MessagesTimeline";
import { indexLiveAssistantMessages, withLiveAssistantText } from "./ThreadTimeline.logic";

/**
 * The thread timeline with live assistant text. ChatView reads the thread
 * without streamed text, so it does not re-render once per delta; this reads
 * the live messages and puts their text into ChatView's entries.
 */
export const ThreadTimeline = memo(function ThreadTimeline({
  liveMessagesRef,
  timelineEntries,
  onRenderedEntriesChange,
  ...props
}: Omit<ComponentProps<typeof MessagesTimeline>, "timelineEntries"> & {
  /** The server thread whose live messages fill in assistant text; null for a local draft. */
  readonly liveMessagesRef: ScopedThreadRef | null;
  readonly timelineEntries: ReadonlyArray<TimelineEntry<ChatMessageStructure>>;
  /** Runs after the rendered entries change, streamed text included. Returns its cleanup. */
  readonly onRenderedEntriesChange: () => (() => void) | undefined;
}) {
  const liveMessages = useThreadMessages(liveMessagesRef);
  const liveAssistantMessages = useMemo(
    () => indexLiveAssistantMessages(liveMessages),
    [liveMessages],
  );
  const entries = useMemo(
    () => withLiveAssistantText(timelineEntries, liveAssistantMessages),
    [liveAssistantMessages, timelineEntries],
  );
  useEffect(
    () => onRenderedEntriesChange(),
    [
      // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Every change to the rendered entries, streamed text included, can move the end of the list.
      entries,
      onRenderedEntriesChange,
    ],
  );
  return <MessagesTimeline {...props} timelineEntries={entries} />;
});
