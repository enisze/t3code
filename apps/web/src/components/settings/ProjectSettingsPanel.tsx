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

import { AsyncResult } from "effect/unstable/reactivity";
import * as Equal from "effect/Equal";
import * as Cause from "effect/Cause";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isElectron } from "../../env";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useProjects, useThreadShells } from "../../state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useClientSettings } from "../../hooks/useSettings";
import { selectProjectGroupingSettings } from "../../logicalProject";
import { buildSidebarProjectSnapshots } from "../../sidebarProjectGrouping";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import type { SidebarProjectGroupingMode } from "@t3tools/contracts/settings";
import { mapAtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import {
  decodeProjectScriptKeybindingRule,
  keybindingValueForCommand,
} from "../../lib/projectScriptKeybindings";
import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
} from "../../projectScripts";
import type { ProjectScript, ResolvedKeybindingsConfig, ServerSettings } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { NewProjectScriptInput } from "../ProjectScriptDialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
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
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="truncate text-[11px] text-muted-foreground">
                    <code>{project.workspaceRoot}</code>
                  </span>
                }
              />
              <TooltipPopup>{project.workspaceRoot}</TooltipPopup>
            </Tooltip>
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

export const PROJECT_GROUPING_MODE_LABELS: Record<SidebarProjectGroupingMode, string> = {
  repository: "Group by repository",
  repository_path: "Group by repository path",
  separate: "Keep separate",
};

/** Logical project groups for the settings page, sorted by display name. */
export function useSettingsProjectGroups(): SidebarProjectSnapshot[] {
  const projects = useProjects();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  return useMemo(
    () =>
      buildSidebarProjectSnapshots({
        projects,
        settings: projectGroupingSettings,
        primaryEnvironmentId,
        resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
      }).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [environmentLabelById, primaryEnvironmentId, projectGroupingSettings, projects],
  );
}

export function useProjectScriptSettings(
  targets: readonly {
    environmentId: EnvironmentId;
    settings: ServerSettings;
    keybindings: ResolvedKeybindingsConfig;
    project?: { id: ProjectId; scripts: readonly ProjectScript[] };
  }[],
) {
  const projects = useProjects();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, "project actions update");
  const upsertKeybinding = useAtomCommand(
    serverEnvironment.upsertKeybinding,
    "action shortcut update",
  );
  const removeKeybinding = useAtomCommand(
    serverEnvironment.removeKeybinding,
    "action shortcut removal",
  );

  async function persist(
    transform: (current: readonly ProjectScript[]) => readonly ProjectScript[] | null,
    scriptId?: string,
    keybinding?: string | null,
  ): Promise<AtomCommandResult<void, unknown>> {
    if (savingRef.current || targets.length === 0) {
      const message = "No available machine, or another action change is saving.";
      toastManager.add({ type: "error", title: "Actions not saved", description: message });
      return AsyncResult.failure(Cause.fail(new Error(message)));
    }
    savingRef.current = true;
    setSaving(true);
    try {
      for (const { environmentId, settings, keybindings, project } of targets) {
        const current = project
          ? resolveProjectScripts(settings, project)
          : settings.defaultProjectScripts;
        const nextScripts = transform(current);
        const effectiveScripts = nextScripts ?? settings.defaultProjectScripts;
        const result = await updateSettings({
          environmentId,
          input: {
            patch: project
              ? { projectScriptOverrides: { [project.id]: nextScripts } }
              : { defaultProjectScripts: nextScripts ?? [] },
          },
        });
        if (result._tag === "Failure") return reportScriptFailure(result);
        if (!isElectron) continue;
        const changedIds = scriptId
          ? [scriptId]
          : current
              .filter((script) => !effectiveScripts.some((next) => next.id === script.id))
              .map((script) => script.id);
        for (const id of changedIds) {
          const command = commandForProjectScript(id);
          const previousValue = keybindingValueForCommand(keybindings, command);
          const previous = previousValue
            ? decodeProjectScriptKeybindingRule({ keybinding: previousValue, command })
            : null;
          const next = decodeProjectScriptKeybindingRule({ keybinding, command });
          const retainedElsewhere =
            !nextScripts?.some((script) => script.id === id) &&
            ((project && settings.defaultProjectScripts.some((script) => script.id === id)) ||
              Object.entries(settings.projectScriptOverrides).some(
                ([projectId, scripts]) =>
                  projectId !== project?.id && scripts?.some((script) => script.id === id),
              ) ||
              projects.some(
                (other) =>
                  other.environmentId === environmentId &&
                  other.id !== project?.id &&
                  (project ? resolveProjectScripts(settings, other) : other.scripts).some(
                    (script) => script.id === id,
                  ),
              ));
          const bindingResult = next
            ? await upsertKeybinding({
                environmentId,
                input:
                  previous && previous.key !== next.key ? { ...next, replace: previous } : next,
              })
            : previous && !retainedElsewhere
              ? await removeKeybinding({ environmentId, input: previous })
              : null;
          if (bindingResult?._tag === "Failure") return reportScriptFailure(bindingResult);
        }
      }
      return AsyncResult.success(undefined);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function submit(scriptId: string | null, input: NewProjectScriptInput) {
    const existingIds = [
      ...projects.flatMap((project) => project.scripts.map((script) => script.id)),
      ...targets.flatMap(({ settings, project }) =>
        [
          ...settings.defaultProjectScripts,
          ...Object.values(settings.projectScriptOverrides).flatMap((scripts) => scripts ?? []),
          ...(project?.scripts ?? []),
        ].map((script) => script.id),
      ),
    ];
    const id = scriptId ?? nextProjectScriptId(input.name, existingIds);
    const next = buildProjectScript(id, input);
    return persist(
      (current) => {
        const updated = current.map((script) =>
          script.id === id
            ? next
            : input.runOnWorktreeCreate
              ? { ...script, runOnWorktreeCreate: false }
              : script,
        );
        return scriptId === null ? [...updated, next] : updated;
      },
      id,
      input.keybinding,
    );
  }

  return { saving, persist, submit };
}

function reportScriptFailure(result: AtomCommandResult<unknown, unknown>) {
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: "Failed to save project actions",
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  }
  return mapAtomCommandResult(result, () => undefined);
}
