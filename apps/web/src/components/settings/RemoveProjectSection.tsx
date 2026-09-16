import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import {
  refreshArchivedThreadsForEnvironment,
  useArchivedThreadSnapshots,
} from "../../lib/archivedThreadsState";
import { useThreadShellsForProjectRefs } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Radio, RadioGroup } from "../ui/radio-group";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";

/** What happens to chats the user already archived when the project goes away. */
type ArchivedDisposition = "keep" | "purge";

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * "Danger" section of the per-project settings page: removes the project's
 * entries from T3 Code.
 *
 * Two axes, because the destructive scope differs wildly between them:
 * archived chats are either retained (they stay listed on the Archived page
 * under the removed project) or deleted with everything else; and the git
 * worktrees this project created are left on disk unless explicitly opted in.
 * Removing records never touches the project's own checkout.
 */
export function RemoveProjectSection(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  project: EnvironmentProject;
}) {
  const { environmentId, projectId, project } = props;
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [archivedDisposition, setArchivedDisposition] = useState<ArchivedDisposition>("keep");
  const [removeWorktreesFromDisk, setRemoveWorktreesFromDisk] = useState(false);
  const [removing, setRemoving] = useState(false);

  const deleteProject = useAtomCommand(projectEnvironment.delete, { reportFailure: false });
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, { reportFailure: false });
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });

  const projectRefs = useMemo(
    () => [scopeProjectRef(environmentId, projectId)],
    [environmentId, projectId],
  );
  const liveThreads = useThreadShellsForProjectRefs(projectRefs);
  const environmentIds = useMemo(() => [environmentId], [environmentId]);
  const { snapshots: archivedSnapshots } = useArchivedThreadSnapshots(environmentIds);
  const archivedCount = useMemo(
    () =>
      archivedSnapshots
        .filter((entry) => entry.environmentId === environmentId)
        .reduce(
          (total, entry) =>
            total +
            entry.snapshot.threads.filter((thread) => thread.projectId === projectId).length,
          0,
        ),
    [archivedSnapshots, environmentId, projectId],
  );

  // Captured before the delete lands: once the project record is gone there is
  // nothing left to enumerate its worktrees from.
  const worktreePaths = useMemo(
    () =>
      Array.from(
        new Set(
          liveThreads.flatMap((thread) =>
            thread.worktreePath && thread.worktreePath !== project.workspaceRoot
              ? [thread.worktreePath]
              : [],
          ),
        ),
      ),
    [liveThreads, project.workspaceRoot],
  );

  const confirmRemoval = useCallback(async () => {
    setRemoving(true);
    const retainArchived = archivedDisposition === "keep";
    const result = await deleteProject({
      environmentId,
      input: {
        projectId,
        // The dialog is the confirmation, so never bounce off the server's
        // "project is not empty" guard.
        force: true,
        ...(retainArchived ? { retainArchivedThreads: true } : {}),
      },
    });
    if (result._tag === "Failure") {
      setRemoving(false);
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Failed to remove "${project.title}"`,
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      return;
    }

    const draftStore = useComposerDraftStore.getState();
    const projectRef = scopeProjectRef(environmentId, projectId);
    const projectDraftThread = draftStore.getDraftThreadByProjectRef(projectRef);
    if (projectDraftThread) {
      draftStore.clearDraftThread(projectDraftThread.draftId);
    }
    draftStore.clearProjectDraftThreadId(projectRef);

    let failedWorktrees = 0;
    if (removeWorktreesFromDisk && worktreePaths.length > 0) {
      for (const path of worktreePaths) {
        const removed = await removeWorktree({
          environmentId,
          input: { cwd: project.workspaceRoot, path, force: true },
        });
        if (removed._tag === "Failure") failedWorktrees += 1;
      }
      await refreshVcsStatus({
        environmentId,
        input: { cwd: project.workspaceRoot },
      });
    }

    // The archived list is a separate snapshot, so pull it again: retained
    // chats need to reappear under the now-removed project, purged ones need
    // to disappear.
    refreshArchivedThreadsForEnvironment(environmentId);

    setRemoving(false);
    setOpen(false);
    toastManager.add(
      stackedThreadToast({
        type: failedWorktrees > 0 ? "error" : "success",
        title: `Removed "${project.title}"`,
        description:
          failedWorktrees > 0
            ? `${pluralize(failedWorktrees, "worktree")} could not be deleted from disk.`
            : retainArchived && archivedCount > 0
              ? `${pluralize(archivedCount, "archived chat")} kept in Archived.`
              : undefined,
      }),
    );
    // Back to the projects list; this page is about to render "no longer
    // available" for the project that just went away.
    void navigate({
      to: "/settings/projects",
      search: { project: undefined, machine: undefined },
    });
  }, [
    archivedCount,
    archivedDisposition,
    deleteProject,
    environmentId,
    project.title,
    project.workspaceRoot,
    projectId,
    navigate,
    refreshVcsStatus,
    removeWorktree,
    removeWorktreesFromDisk,
    worktreePaths,
  ]);

  return (
    <>
      <SettingsSection title="Danger">
        <SettingsRow
          title="Remove project"
          description="Removes this project and its chats from T3 Code. Your project checkout is never touched."
          control={
            <Button size="sm" variant="destructive-outline" onClick={() => setOpen(true)}>
              <Trash2Icon className="size-3.5" />
              Remove project
            </Button>
          }
        />
      </SettingsSection>
      <Dialog open={open} onOpenChange={(next) => !removing && setOpen(next)}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Remove “{project.title}”?</DialogTitle>
            <DialogDescription>
              {project.workspaceRoot}
              <br />
              {liveThreads.length > 0
                ? `This permanently clears ${pluralize(liveThreads.length, "chat")} and their history.`
                : "This project has no active chats."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-5">
              {archivedCount > 0 ? (
                <div className="space-y-2.5">
                  <span className="font-medium text-[13px] text-foreground">
                    {pluralize(archivedCount, "archived chat")}
                  </span>
                  <RadioGroup
                    value={archivedDisposition}
                    onValueChange={(value) => setArchivedDisposition(value as ArchivedDisposition)}
                  >
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <Radio value="keep" className="mt-0.5" />
                      <span className="grid gap-0.5">
                        <span className="text-[13px] text-foreground">Keep them</span>
                        <span className="text-[12px] text-muted-foreground">
                          They stay on the Archived page under this project, marked as removed.
                        </span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <Radio value="purge" className="mt-0.5" />
                      <span className="grid gap-0.5">
                        <span className="text-[13px] text-foreground">Remove them too</span>
                        <span className="text-[12px] text-muted-foreground">
                          Deletes the archived chats and their history. This cannot be undone.
                        </span>
                      </span>
                    </label>
                  </RadioGroup>
                </div>
              ) : null}
              {worktreePaths.length > 0 ? (
                <label className="flex cursor-pointer items-start gap-2.5">
                  <Checkbox
                    checked={removeWorktreesFromDisk}
                    onCheckedChange={setRemoveWorktreesFromDisk}
                    className="mt-0.5"
                  />
                  <span className="grid gap-0.5">
                    <span className="text-[13px] text-foreground">
                      Also delete {pluralize(worktreePaths.length, "worktree")} from disk
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      Deletes the worktree folders this project created. Uncommitted work in them is
                      lost. Your project checkout at {project.workspaceRoot} is never touched.
                    </span>
                  </span>
                </label>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={removing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmRemoval()} disabled={removing}>
              {removing ? "Removing…" : "Remove project"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
