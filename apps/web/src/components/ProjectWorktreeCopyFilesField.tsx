import { useMemo } from "react";

import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { PROJECT_WORKTREE_COPY_FILES_MAX_ENTRIES } from "@t3tools/contracts";

import { useProject } from "../state/entities";
import { Textarea } from "./ui/textarea";

/** Split editor text into the contract's path list: one entry per non-empty line. */
export function parseWorktreeCopyFiles(value: string): ReadonlyArray<string> {
  const seen = new Set<string>();
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    seen.add(trimmed);
    if (seen.size >= PROJECT_WORKTREE_COPY_FILES_MAX_ENTRIES) break;
  }
  return Array.from(seen);
}

/** True when two path lists are equivalent, so a no-op blur skips the write. */
export function worktreeCopyFilesEqual(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

/**
 * Per-project "copy into new worktrees" control. Paths are workspace-relative
 * and copied from the project root into each new worktree, so untracked local
 * files (`.env.local`, service-account JSON, …) are available without writing a
 * setup script. Each worktree gets an independent copy rather than a symlink, so
 * editing the file in one worktree never changes it in another.
 */
export function ProjectWorktreeCopyFilesField(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  onChange: (paths: ReadonlyArray<string>) => void;
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
  const paths = project?.worktreeCopyFiles ?? [];
  const text = paths.join("\n");

  return (
    <label className="grid min-w-0 gap-1.5" htmlFor={`${idPrefix}-copy-files`}>
      <span className="font-medium text-foreground">Files to copy into new worktrees</span>
      <Textarea
        id={`${idPrefix}-copy-files`}
        // Remount when the persisted value changes so the uncontrolled textarea
        // picks it up, while typing stays local until blur.
        key={`copy-files:${projectId}:${text}`}
        aria-label="Files to copy into new worktrees"
        defaultValue={text}
        rows={4}
        spellCheck={false}
        placeholder={".env.local\nconfig/local.json"}
        className="font-mono text-xs"
        onBlur={(event) => {
          const next = parseWorktreeCopyFiles(event.currentTarget.value);
          if (worktreeCopyFilesEqual(paths, next)) return;
          onChange(next);
        }}
      />
      <span className="text-[11px] text-muted-foreground">
        One workspace-relative path per line, copied from the project root when a worktree is
        created — before the setup script runs. Each worktree gets its own copy, so edits stay local
        to that worktree. Missing files are skipped.
      </span>
    </label>
  );
}
