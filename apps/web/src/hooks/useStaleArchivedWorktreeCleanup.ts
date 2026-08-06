import { threadLastActivityAt } from "@t3tools/client-runtime/state/thread-settled";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useMemo, useRef } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useArchivedThreadSnapshots } from "../lib/archivedThreadsState";
import { readLocalApi } from "../localApi";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../state/entities";
import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import { formatWorktreePathForDisplay } from "../worktreeCleanup";

const FIVE_WEEKS_MS = 5 * 7 * 24 * 60 * 60 * 1_000;
// The longest list the confirm dialog spells out before collapsing to a count,
// so a big backlog doesn't produce an unreadable wall of paths.
const MAX_LISTED_WORKTREES = 12;

// Once per renderer session: a module-level latch survives sidebar remounts so
// the scan (and its one prompt) never re-fires just because the component
// re-mounted. A full reload starts a fresh session, which is the intent.
let cleanupRanThisSession = false;

type StaleWorktree = {
  readonly environmentId: EnvironmentId;
  readonly worktreePath: string;
  workspaceRoot: string | null;
  latestActivityMs: number;
};

/**
 * Client-side housekeeping for the archive lifecycle: once per session, find
 * on-disk worktrees whose chats are ALL archived and whose most recent thread
 * activity is 5+ weeks old, then offer to delete those worktrees in one batched
 * prompt. Archived chats are never touched — only the worktree is removed.
 *
 * Deliberately conservative: a worktree with even one live (non-archived)
 * thread is off-limits, and removal always prompts first because it deletes
 * from disk. Runs where it can prompt (the web app), reusing the same
 * removeWorktree mutation the delete flow uses.
 */
export function useStaleArchivedWorktreeCleanup(): void {
  const projects = useProjects();
  const liveThreads = useThreadShells();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const environmentIds = useMemo(
    () => [...new Set(projects.map((project) => project.environmentId))],
    [projects],
  );
  // Reads the archived snapshot for every environment. Eager, but one cached
  // RPC per environment, and the archived view uses the same feed.
  const { snapshots, isLoading } = useArchivedThreadSnapshots(environmentIds);
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, { reportFailure: false });
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });

  // The scan reads the latest data through a ref so the effect can fire exactly
  // once (on bootstrap) without re-arming every time threads stream in.
  const dataRef = useRef({ projects, liveThreads, snapshots, removeWorktree, refreshVcsStatus });
  dataRef.current = { projects, liveThreads, snapshots, removeWorktree, refreshVcsStatus };

  useEffect(() => {
    if (cleanupRanThisSession) return;
    // Wait until live shells and the archived snapshots have loaded, or a
    // half-loaded scan would treat not-yet-seen live threads as absent and
    // delete a worktree still in use.
    if (!bootstrapped || isLoading) return;
    const localApi = readLocalApi();
    if (!localApi) return;
    cleanupRanThisSession = true;

    void (async () => {
      const data = dataRef.current;
      const now = Date.now();

      // Worktrees still owned by a live (non-archived) thread are off-limits.
      const liveWorktreeKeys = new Set<string>();
      for (const thread of data.liveThreads) {
        if (thread.archivedAt === null && thread.worktreePath !== null) {
          liveWorktreeKeys.add(`${thread.environmentId}:${thread.worktreePath}`);
        }
      }

      const byWorktree = new Map<string, StaleWorktree>();
      for (const { environmentId, snapshot } of data.snapshots) {
        const workspaceRootByProjectId = new Map(
          snapshot.projects.map((project) => [project.id, project.workspaceRoot] as const),
        );
        for (const thread of snapshot.threads) {
          if (thread.worktreePath === null || thread.archivedAt === null) continue;
          const key = `${environmentId}:${thread.worktreePath}`;
          if (liveWorktreeKeys.has(key)) continue;
          // archivedAt is always set on an archived thread, so a thread with no
          // turn/message activity still gets a real staleness timestamp.
          const activityMs = Date.parse(threadLastActivityAt(thread) ?? thread.archivedAt);
          const workspaceRoot =
            data.projects.find(
              (project) =>
                project.environmentId === environmentId && project.id === thread.projectId,
            )?.workspaceRoot ??
            workspaceRootByProjectId.get(thread.projectId) ??
            null;
          const existing = byWorktree.get(key);
          if (existing) {
            if (!Number.isNaN(activityMs)) {
              existing.latestActivityMs = Math.max(existing.latestActivityMs, activityMs);
            }
            if (existing.workspaceRoot === null) existing.workspaceRoot = workspaceRoot;
          } else {
            byWorktree.set(key, {
              environmentId,
              worktreePath: thread.worktreePath,
              workspaceRoot,
              latestActivityMs: Number.isNaN(activityMs) ? 0 : activityMs,
            });
          }
        }
      }

      const stale = [...byWorktree.values()].filter(
        (worktree) =>
          worktree.workspaceRoot !== null && now - worktree.latestActivityMs >= FIVE_WEEKS_MS,
      );
      if (stale.length === 0) return;

      const listed = stale.slice(0, MAX_LISTED_WORKTREES);
      const confirmed = await settlePromise(() =>
        localApi.dialogs.confirm(
          [
            `${stale.length} archived worktree${stale.length === 1 ? "" : "s"} ${
              stale.length === 1 ? "has" : "have"
            } been untouched for over 5 weeks:`,
            "",
            ...listed.map((worktree) => `• ${formatWorktreePathForDisplay(worktree.worktreePath)}`),
            ...(stale.length > listed.length ? [`…and ${stale.length - listed.length} more`] : []),
            "",
            `Remove ${stale.length === 1 ? "it" : "them"} from disk? Archived chats are kept.`,
          ].join("\n"),
        ),
      );
      if (confirmed._tag === "Failure" || !confirmed.value) return;

      const refreshedCwds = new Set<string>();
      let removed = 0;
      let failures = 0;
      for (const worktree of stale) {
        if (worktree.workspaceRoot === null) continue;
        const result = await data.removeWorktree({
          environmentId: worktree.environmentId,
          input: { cwd: worktree.workspaceRoot, path: worktree.worktreePath, force: true },
        });
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            failures += 1;
            const error = squashAtomCommandFailure(result);
            console.error("Failed to remove stale archived worktree", {
              environmentId: worktree.environmentId,
              worktreePath: worktree.worktreePath,
              error,
            });
          }
          continue;
        }
        removed += 1;
        const cwdKey = `${worktree.environmentId}:${worktree.workspaceRoot}`;
        if (!refreshedCwds.has(cwdKey)) {
          refreshedCwds.add(cwdKey);
          await data.refreshVcsStatus({
            environmentId: worktree.environmentId,
            input: { cwd: worktree.workspaceRoot },
          });
        }
      }

      if (failures > 0) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Some worktrees could not be removed",
            description: `Removed ${removed} of ${stale.length}; ${failures} failed.`,
          }),
        );
      } else if (removed > 0) {
        toastManager.add({
          type: "success",
          title: `Removed ${removed} unused worktree${removed === 1 ? "" : "s"}`,
        });
      }
    })();
  }, [bootstrapped, isLoading]);
}
