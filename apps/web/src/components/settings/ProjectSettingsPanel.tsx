import { useCallback, useMemo } from "react";

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ModelSelection, ProjectId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { FilesIcon, FolderGitIcon, GitBranchIcon, PlayIcon, SlidersIcon } from "lucide-react";

import { sanitizeWorktreeBranchPrefix, WORKTREE_BRANCH_PREFIX } from "@t3tools/shared/git";
import { useProject } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectDefaultAgentField } from "../ProjectDefaultAgentField";
import { ProjectDefaultWorktreeBranchField } from "../ProjectDefaultWorktreeBranchField";
import { ProjectScriptsField } from "../ProjectScriptsField";
import { ProjectWorktreeCopyFilesField } from "../ProjectWorktreeCopyFilesField";
import { Input } from "../ui/input";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

/**
 * Per-project settings page. Hosts every project-scoped setting (name, git
 * defaults, files copied into new worktrees, agents, scripts, preview) in the
 * settings area, reachable from the gear on a sidebar project row.
 *
 * Settings are read live via {@link useProject} and written through the
 * `project.meta.update` command, one field at a time.
 */
export function ProjectSettingsPanel(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}) {
  const { environmentId, projectId } = props;
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  const project = useProject(projectRef);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });

  const applyUpdate = useCallback(
    async (
      input: Omit<Parameters<typeof updateProject>[0]["input"], "projectId">,
      failureTitle: string,
    ) => {
      const result = await updateProject({
        environmentId,
        input: { projectId, ...input },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: failureTitle,
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [environmentId, projectId, updateProject],
  );

  if (!project) {
    return (
      <SettingsPageContainer>
        <SettingsSection title="Project" icon={<FolderGitIcon className="size-4" />}>
          <p className="px-3 text-[13px] text-muted-foreground sm:px-4">
            This project is no longer available. It may have been removed, or its environment may be
            disconnected.
          </p>
        </SettingsSection>
      </SettingsPageContainer>
    );
  }

  const idPrefix = `project-settings-${projectId}`;

  return (
    <SettingsPageContainer>
      <SettingsSection title={project.title} icon={<FolderGitIcon className="size-4" />}>
        <div className="grid gap-4 px-3 sm:grid-cols-2 sm:px-4">
          <label className="grid min-w-0 gap-1.5" htmlFor={`${idPrefix}-title`}>
            <span className="font-medium text-foreground">Project name</span>
            <Input
              id={`${idPrefix}-title`}
              key={`title:${projectId}:${project.title}`}
              aria-label="Project name"
              defaultValue={project.title}
              onBlur={(event) => {
                const next = event.currentTarget.value.trim();
                if (next.length === 0 || next === project.title) return;
                void applyUpdate({ title: next }, "Failed to rename project");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <span
              className="truncate text-[11px] text-muted-foreground"
              title={project.workspaceRoot}
            >
              <code>{project.workspaceRoot}</code>
            </span>
          </label>
        </div>
      </SettingsSection>

      <SettingsSection title="Git" icon={<GitBranchIcon className="size-4" />}>
        <div className="grid gap-4 px-3 sm:grid-cols-2 sm:px-4">
          <ProjectDefaultWorktreeBranchField
            idPrefix={idPrefix}
            environmentId={environmentId}
            projectId={projectId}
            onChange={(branch) => {
              if ((project.defaultWorktreeBranch ?? null) === branch) return;
              void applyUpdate(
                { defaultWorktreeBranch: branch },
                "Failed to update default base branch",
              );
            }}
          />
          <label className="grid min-w-0 gap-1.5" htmlFor={`${idPrefix}-prefix`}>
            <span className="font-medium text-foreground">Worktree branch prefix</span>
            <Input
              id={`${idPrefix}-prefix`}
              key={`prefix:${projectId}:${project.worktreeBranchPrefix ?? ""}`}
              aria-label="Worktree branch prefix"
              defaultValue={project.worktreeBranchPrefix ?? ""}
              placeholder={WORKTREE_BRANCH_PREFIX}
              onBlur={(event) => {
                const raw = event.currentTarget.value.trim();
                const next = raw.length === 0 ? null : raw;
                if ((project.worktreeBranchPrefix ?? null) === next) return;
                void applyUpdate(
                  { worktreeBranchPrefix: next },
                  "Failed to update worktree branch prefix",
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <span className="text-[11px] text-muted-foreground">
              New worktree branches use{" "}
              <code>
                {sanitizeWorktreeBranchPrefix(
                  project.worktreeBranchPrefix ?? WORKTREE_BRANCH_PREFIX,
                )}
                /…
              </code>
              {project.worktreeBranchPrefix === null ? " (global default)" : null}
            </span>
          </label>
        </div>
      </SettingsSection>

      <SettingsSection title="Files" icon={<FilesIcon className="size-4" />}>
        <div className="grid gap-4 px-3 sm:px-4">
          <ProjectWorktreeCopyFilesField
            idPrefix={idPrefix}
            environmentId={environmentId}
            projectId={projectId}
            onChange={(paths) => {
              void applyUpdate(
                { worktreeCopyFiles: paths },
                "Failed to update files copied into new worktrees",
              );
            }}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Agents" icon={<SlidersIcon className="size-4" />}>
        <div className="grid gap-4 px-3 sm:px-4">
          <ProjectDefaultAgentField
            idPrefix={`${idPrefix}-agent`}
            environmentId={environmentId}
            projectId={projectId}
            onChange={(selection: ModelSelection | null) => {
              void applyUpdate(
                { defaultModelSelection: selection },
                "Failed to update default agent",
              );
            }}
          />
          <ProjectDefaultAgentField
            kind="review"
            idPrefix={`${idPrefix}-review-agent`}
            environmentId={environmentId}
            projectId={projectId}
            onChange={(selection: ModelSelection | null) => {
              void applyUpdate(
                { reviewModelSelection: selection },
                "Failed to update review agent",
              );
            }}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Scripts" icon={<PlayIcon className="size-4" />}>
        <div className="grid gap-4 px-3 sm:px-4">
          <ProjectScriptsField
            environmentId={environmentId}
            projectId={projectId}
            keybindings={keybindings}
          />
          <label className="grid min-w-0 gap-1.5 sm:max-w-xs" htmlFor={`${idPrefix}-preview-port`}>
            <span className="font-medium text-foreground">Preview port</span>
            <Input
              id={`${idPrefix}-preview-port`}
              key={`preview-port:${projectId}:${project.previewPort ?? ""}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={65535}
              aria-label="Localhost preview port"
              defaultValue={project.previewPort ?? ""}
              placeholder="5173"
              onBlur={(event) => {
                const raw = event.currentTarget.value.trim();
                const parsed = raw.length === 0 ? null : Number.parseInt(raw, 10);
                const next =
                  parsed === null || Number.isNaN(parsed) || parsed < 1 || parsed > 65535
                    ? null
                    : parsed;
                if ((project.previewPort ?? null) === next) return;
                void applyUpdate({ previewPort: next }, "Failed to update preview port");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <span className="text-[11px] text-muted-foreground">
              The preview button in the chat header opens{" "}
              <code>http://localhost:{project.previewPort ?? "…"}</code> in the in-app browser.
            </span>
          </label>
        </div>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
