import {
  createContext,
  use,
  useEffect,
  useImperativeHandle,
  useMemo,
  type ReactNode,
  type Ref,
} from "react";
import { useThreadMessages, useThreadProposedPlans } from "../../state/entities";
import { useThreadFind, type ThreadFindTimelineProps } from "./useThreadFind";
import { ThreadFindBar } from "./ThreadFindBar";

type Find = ReturnType<typeof useThreadFind>;
export type ThreadFindControls = Pick<Find, "open" | "close">;
export const ThreadFindTimelineContext = createContext<ThreadFindTimelineProps | null>(null);
const ThreadFindBarContext = createContext<Find["barProps"] | null>(null);

/**
 * Owns find updates below the chat view, so stepping through matches does not
 * rerender the composer and panels. Results follow the live messages and plans,
 * which ChatView does not render for; only this provider renders per streamed
 * delta, and its children are ChatView's unchanged elements.
 */
export function ThreadFindProvider({
  controlsRef,
  onOpenChange,
  children,
  ...options
}: Omit<Parameters<typeof useThreadFind>[0], "content"> & {
  controlsRef: Ref<ThreadFindControls>;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const messages = useThreadMessages(options.thread);
  const plans = useThreadProposedPlans(options.thread);
  const content = useMemo(() => [messages, plans], [messages, plans]);
  const find = useThreadFind({ ...options, content });
  useImperativeHandle(controlsRef, () => ({ open: find.open, close: find.close }), [
    find.open,
    find.close,
  ]);
  useEffect(() => onOpenChange(find.isOpen), [find.isOpen, onOpenChange]);
  return (
    <ThreadFindBarContext value={find.barProps}>
      <ThreadFindTimelineContext value={find.timelineProps}>{children}</ThreadFindTimelineContext>
    </ThreadFindBarContext>
  );
}

/** The find bar, floating over the top of the chat column while find is open. */
export function ThreadFind({ onClose }: { onClose: () => void }) {
  const bar = use(ThreadFindBarContext);
  if (!bar) return null;
  return (
    <ThreadFindBar
      {...bar}
      onClose={() => {
        bar.onClose();
        onClose();
      }}
    />
  );
}
