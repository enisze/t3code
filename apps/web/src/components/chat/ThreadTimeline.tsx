import { requestOlderThreadTurns } from "@t3tools/client-runtime/state/threads";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { type ComponentProps, memo, useEffect, useMemo } from "react";

import type { TimelineEntry } from "../../session-logic";
import { useThreadMessages } from "../../state/entities";
import { useEnvironmentThread } from "../../state/threads";
import type { ChatMessageStructure } from "../../types";
import { MessagesTimeline } from "./MessagesTimeline";
import { indexLiveAssistantMessages, withLiveAssistantText } from "./ThreadTimeline.logic";

/**
 * The thread timeline with live assistant text. ChatView reads the thread
 * without streamed text, so it does not re-render once per delta; this reads
 * the live messages and puts their text into ChatView's entries. It also reads
 * the history page for find, since the thread state changes with every delta.
 */
export const ThreadTimeline = memo(function ThreadTimeline({
  liveMessagesRef,
  timelineEntries,
  onRenderedEntriesChange,
  ...props
}: Omit<ComponentProps<typeof MessagesTimeline>, "timelineEntries" | "history"> & {
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
  const page = Option.getOrNull(
    useEnvironmentThread(liveMessagesRef?.environmentId ?? null, liveMessagesRef?.threadId ?? null)
      .page,
  );
  // The page object changes with every delta, so only its fields are compared.
  const hasPage = page !== null;
  const hasMore = page?.hasMore ?? false;
  const loadingOlder = page?.loadingOlder ?? false;
  const history = useMemo(
    () =>
      liveMessagesRef && hasPage
        ? {
            hasMore,
            loading: loadingOlder,
            loadOlder: () =>
              requestOlderThreadTurns(liveMessagesRef.environmentId, liveMessagesRef.threadId),
          }
        : null,
    [liveMessagesRef, hasPage, hasMore, loadingOlder],
  );
  return <MessagesTimeline {...props} timelineEntries={entries} history={history} />;
});
