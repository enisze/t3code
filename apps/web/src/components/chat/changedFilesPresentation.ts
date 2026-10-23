import { type TurnDiffFileChange } from "../../types";
import { summarizeTurnDiffStats, type TurnDiffTreeNode } from "../../lib/turnDiffTree";

export const CHANGED_FILES_AUTO_EXPAND_FILE_LIMIT = 5;
export const CHANGED_FILES_AUTO_EXPAND_LINE_LIMIT = 200;
export const CHANGED_FILES_PREVIEW_FILE_LIMIT = 3;
export const CHANGED_FILES_PREVIEW_SCOPE_LIMIT = 4;
/** Above this many visible files, the changed-file tree mounts only the rows in view. */
export const CHANGED_FILES_VIRTUALIZE_AFTER_FILES = 250;

export interface ChangedFileRow {
  readonly node: TurnDiffTreeNode;
  readonly depth: number;
}

/** The tree's visible rows in render order: each node whose ancestors are all expanded. */
export function collectExpandedRows(
  nodes: ReadonlyArray<TurnDiffTreeNode>,
  overrides: Readonly<Record<string, boolean>>,
  allDirectoriesExpanded: boolean,
): ChangedFileRow[] {
  const rows: ChangedFileRow[] = [];
  const visit = (level: ReadonlyArray<TurnDiffTreeNode>, depth: number) => {
    for (const node of level) {
      rows.push({ node, depth });
      if (node.kind === "directory" && (overrides[node.path] ?? allDirectoriesExpanded)) {
        visit(node.children, depth + 1);
      }
    }
  };
  visit(nodes, 0);
  return rows;
}

export function shouldVirtualizeChangedFileRows(rows: ReadonlyArray<ChangedFileRow>): boolean {
  let fileCount = 0;
  for (const row of rows) {
    if (row.node.kind === "file") fileCount += 1;
    if (fileCount > CHANGED_FILES_VIRTUALIZE_AFTER_FILES) return true;
  }
  return false;
}

/**
 * The rows to mount from a list of equal-height rows, padded by `overscan` rows on
 * each side. `listTop` and `viewportTop` are measured in the same coordinates.
 */
export function visibleRowRange(input: {
  readonly listTop: number;
  readonly viewportTop: number;
  readonly viewportHeight: number;
  readonly rowHeight: number;
  readonly rowCount: number;
  readonly overscan: number;
}): { readonly start: number; readonly end: number } {
  const offset = input.viewportTop - input.listTop;
  const start = Math.max(
    0,
    Math.min(input.rowCount, Math.floor(offset / input.rowHeight) - input.overscan),
  );
  const end = Math.max(
    start,
    Math.min(
      input.rowCount,
      Math.ceil((offset + input.viewportHeight) / input.rowHeight) + input.overscan,
    ),
  );
  return { start, end };
}

export interface ChangedFilesScopeSummary {
  readonly label: string;
  readonly fileCount: number;
}

function pathSegments(pathValue: string): string[] {
  return pathValue
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0);
}

export function changedFileName(pathValue: string): string {
  return pathSegments(pathValue).at(-1) ?? pathValue;
}

function changedFileScope(pathValue: string): string {
  const segments = pathSegments(pathValue);
  return segments.length > 1 ? (segments[0] ?? "root") : "root";
}

export function shouldAutoExpandChangedFiles(
  files: ReadonlyArray<TurnDiffFileChange>,
  isLatestTurn: boolean,
): boolean {
  if (!isLatestTurn || files.length > CHANGED_FILES_AUTO_EXPAND_FILE_LIMIT) {
    return false;
  }
  const stat = summarizeTurnDiffStats(files);
  return stat.additions + stat.deletions <= CHANGED_FILES_AUTO_EXPAND_LINE_LIMIT;
}

export function summarizeChangedFileScopes(
  files: ReadonlyArray<TurnDiffFileChange>,
  limit = CHANGED_FILES_PREVIEW_SCOPE_LIMIT,
): ChangedFilesScopeSummary[] {
  const scopes = new Map<string, { fileCount: number; firstIndex: number }>();
  files.forEach((file, index) => {
    const label = changedFileScope(file.path);
    const current = scopes.get(label);
    scopes.set(label, {
      fileCount: (current?.fileCount ?? 0) + 1,
      firstIndex: current?.firstIndex ?? index,
    });
  });

  return Array.from(scopes, ([label, scope]) => ({
    label,
    fileCount: scope.fileCount,
    firstIndex: scope.firstIndex,
  }))
    .toSorted(
      (left, right) =>
        right.fileCount - left.fileCount ||
        left.firstIndex - right.firstIndex ||
        left.label.localeCompare(right.label),
    )
    .slice(0, limit)
    .map(({ label, fileCount }) => ({ label, fileCount }));
}

export function selectChangedFilePreview(
  files: ReadonlyArray<TurnDiffFileChange>,
  limit = CHANGED_FILES_PREVIEW_FILE_LIMIT,
): TurnDiffFileChange[] {
  const selected: TurnDiffFileChange[] = [];
  const selectedPaths = new Set<string>();
  const selectedScopes = new Set<string>();

  for (const file of files) {
    const scope = changedFileScope(file.path);
    if (selectedScopes.has(scope)) {
      continue;
    }
    selected.push(file);
    selectedPaths.add(file.path);
    selectedScopes.add(scope);
    if (selected.length === limit) {
      return selected;
    }
  }

  for (const file of files) {
    if (selectedPaths.has(file.path)) {
      continue;
    }
    selected.push(file);
    if (selected.length === limit) {
      break;
    }
  }

  return selected;
}
