import { ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { resolveWorktreeWorkspaceRepresentative } from "../components/Sidebar.logic";
import { useComposerDraftStore } from "../composerDraftStore";
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
 *
 * A brand-new chat is a client-side draft until its first message is sent, so
 * it has no server shell yet. When the draft targets an existing worktree we
 * read its worktree from the composer draft store, so the shared workspace binds
 * the moment the chat opens instead of only after submit promotes it to a
 * server thread.
 */
export function useWorkspaceThreadRef(
  ref: ScopedThreadRef | null | undefined,
): ScopedThreadRef | null {
  const shells = useThreadShells();
  const draftWorktreePath = useComposerDraftStore((state) =>
    ref ? (state.getDraftSessionByRef(ref)?.worktreePath ?? null) : null,
  );
  return useMemo(() => {
    if (!ref) return null;
    const own = shells.find(
      (shell) => shell.environmentId === ref.environmentId && shell.id === ref.threadId,
    );
    // Prefer the server shell's worktree; for a not-yet-sent draft (no shell)
    // fall back to the worktree the draft will join. Either way a null worktree
    // means the chat keeps its own per-chat workspace.
    const worktreePath = own ? own.worktreePath : draftWorktreePath;
    if (worktreePath === null) return ref;
    const representative = resolveWorktreeWorkspaceRepresentative({
      threads: shells,
      target: { environmentId: ref.environmentId, worktreePath },
    });
    if (!representative || representative.id === ref.threadId) return ref;
    return { environmentId: ref.environmentId, threadId: ThreadId.make(representative.id) };
  }, [ref, shells, draftWorktreePath]);
}
