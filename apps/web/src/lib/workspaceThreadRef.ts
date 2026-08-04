import { ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { resolveWorktreeWorkspaceRepresentative } from "../components/Sidebar.logic";
import { useThreadShells } from "../state/entities";

/**
 * Map a thread ref to the ref that owns its worktree's shared workspace state
 * (open files, diff, terminals, preview). Chats sharing an on-disk worktree
 * route their workspace panels through a single representative sibling (the
 * earliest-created live chat — the same row the sidebar collapses to), so every
 * chat in the worktree shows the same open files, diff, and live terminals.
 *
 * Because the representative is a real thread, its panel stores and terminal
 * sessions key off an ordinary thread key: no synthetic keys, no persistence
 * migration, and its existing panel state simply becomes the shared state.
 * Threads with no worktree, or worktrees we can't resolve yet (shells still
 * loading), fall back to the thread's own ref so nothing is shared.
 */
export function useWorkspaceThreadRef(
  ref: ScopedThreadRef | null | undefined,
): ScopedThreadRef | null {
  const shells = useThreadShells();
  return useMemo(() => {
    if (!ref) return null;
    const own = shells.find(
      (shell) => shell.environmentId === ref.environmentId && shell.id === ref.threadId,
    );
    if (!own || own.worktreePath === null) return ref;
    const representative = resolveWorktreeWorkspaceRepresentative({
      threads: shells,
      target: { environmentId: ref.environmentId, worktreePath: own.worktreePath },
    });
    if (!representative || representative.id === ref.threadId) return ref;
    return { environmentId: ref.environmentId, threadId: ThreadId.make(representative.id) };
  }, [ref, shells]);
}
