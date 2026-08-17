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
  const draftThreadsByThreadKey = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  return useMemo(() => {
    if (!ref) return null;
    const own = shells.find(
      (shell) => shell.environmentId === ref.environmentId && shell.id === ref.threadId,
    );
    // Prefer the server shell's worktree; for a not-yet-sent draft (no shell)
    // fall back to the worktree the draft will join. Either way a null worktree
    // means the chat keeps its own per-chat workspace.
    const currentDraft = Object.values(draftThreadsByThreadKey).find(
      (draft) => draft.environmentId === ref.environmentId && draft.threadId === ref.threadId,
    );
    const worktreePath = own ? own.worktreePath : (currentDraft?.worktreePath ?? null);
    if (worktreePath === null) return ref;
    const representative = resolveWorktreeWorkspaceRepresentative({
      threads: shells,
      target: { environmentId: ref.environmentId, worktreePath },
    });
    if (representative) {
      if (representative.id === ref.threadId) return ref;
      return { environmentId: ref.environmentId, threadId: ThreadId.make(representative.id) };
    }
    // A worktree can temporarily contain only client-side drafts. Give those
    // drafts one stable workspace owner as well, rather than remounting every
    // right-panel surface whenever the selected draft changes.
    const draftRepresentative = Object.values(draftThreadsByThreadKey)
      .filter(
        (draft) =>
          draft.environmentId === ref.environmentId &&
          draft.worktreePath === worktreePath &&
          !draft.promotedTo,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!draftRepresentative || draftRepresentative.threadId === ref.threadId) return ref;
    return { environmentId: ref.environmentId, threadId: draftRepresentative.threadId };
  }, [ref, shells, draftThreadsByThreadKey]);
}

/**
 * The worktree-scoped key that the chat-column content tabs (file/diff viewers)
 * are stored under, resolved from the thread's server shell — or, for a
 * not-yet-sent draft, the worktree it will join. Keying off the shell/draft
 * rather than the volatile `activeThread` union (server detail ↔ shell ↔ draft,
 * whose `worktreePath` can transiently disagree or blank out while those async
 * sources settle) keeps the key stable, so the open file view stays mounted
 * instead of flickering as the thread's data loads. Pass a route-derived ref so
 * the input identity itself never blinks.
 */
export function useWorkspaceWorktreeKey(ref: ScopedThreadRef | null | undefined): string | null {
  const shells = useThreadShells();
  const draftThreadsByThreadKey = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  return useMemo(() => {
    if (!ref) return null;
    const own = shells.find(
      (shell) => shell.environmentId === ref.environmentId && shell.id === ref.threadId,
    );
    const currentDraft = Object.values(draftThreadsByThreadKey).find(
      (draft) => draft.environmentId === ref.environmentId && draft.threadId === ref.threadId,
    );
    const worktreePath = own ? own.worktreePath : (currentDraft?.worktreePath ?? null);
    return worktreePath === null ? null : `${ref.environmentId}:${worktreePath}`;
  }, [ref, shells, draftThreadsByThreadKey]);
}
