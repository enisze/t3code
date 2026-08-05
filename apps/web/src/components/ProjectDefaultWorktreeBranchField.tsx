import { useMemo } from "react";

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { useProject } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { vcsEnvironment } from "../state/vcs";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";

// Sentinel for "no pinned branch": new worktrees fall back to the repository
// default branch (origin/HEAD), then the current checkout. Kept distinct from
// any real branch name.
const USE_REPO_DEFAULT_VALUE = "__t3_repo_default__";

/**
 * Per-project "default worktree branch" control. Picks which branch new
 * worktrees for a project are created from. The selection is written to the
 * project's `defaultWorktreeBranch`; the composer's branch toolbar seeds the
 * worktree base from this value before falling back to the repository default.
 *
 * Branches are read per-environment from the project's own repository.
 */
export function ProjectDefaultWorktreeBranchField(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  onChange: (branch: string | null) => void;
  idPrefix: string;
}) {
  const { environmentId, projectId, onChange, idPrefix } = props;
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  // Read live so the control reflects the persisted value even when the
  // enclosing panel renders from a captured project snapshot.
  const project = useProject(projectRef);
  const value = project?.defaultWorktreeBranch ?? null;
  const cwd = project?.workspaceRoot ?? null;

  const refsQuery = useEnvironmentQuery(
    cwd !== null
      ? vcsEnvironment.listRefs({
          environmentId,
          input: { cwd, refKind: "all", limit: 200 },
        })
      : null,
  );

  // Dedupe by branch name (a branch can appear as both a local and remote ref),
  // keeping the repo default first, then alphabetical.
  const branchNames = useMemo(() => {
    const refs = refsQuery.data?.refs ?? [];
    const names = new Set<string>();
    for (const ref of refs) names.add(ref.name);
    // Always include the persisted value so a stale/renamed branch still shows
    // (and can be cleared) instead of silently vanishing.
    if (value !== null) names.add(value);
    const defaultName = refs.find((ref) => ref.isDefault)?.name ?? null;
    return Array.from(names).sort((a, b) => {
      if (a === defaultName) return -1;
      if (b === defaultName) return 1;
      return a.localeCompare(b);
    });
  }, [refsQuery.data?.refs, value]);

  const selectValue = value ?? USE_REPO_DEFAULT_VALUE;

  return (
    <label className="grid min-w-0 gap-1.5" htmlFor={`${idPrefix}-branch`}>
      <span className="font-medium text-foreground">Default worktree branch</span>
      <Select
        value={selectValue}
        onValueChange={(next: string | null) =>
          onChange(next === null || next === USE_REPO_DEFAULT_VALUE ? null : next)
        }
      >
        <SelectTrigger id={`${idPrefix}-branch`} className="w-full sm:min-h-7.5">
          <SelectValue>
            {value ? (
              <span className="min-w-0 truncate font-mono text-xs">{value}</span>
            ) : (
              "Repository default"
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          <SelectItem hideIndicator value={USE_REPO_DEFAULT_VALUE}>
            Repository default
          </SelectItem>
          {branchNames.map((name) => (
            <SelectItem hideIndicator key={name} value={name}>
              <span className="min-w-0 truncate font-mono text-xs">{name}</span>
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <span className="text-[11px] text-muted-foreground">
        New worktrees branch from {value ? <code>{value}</code> : "the repository default branch"}.
      </span>
    </label>
  );
}
