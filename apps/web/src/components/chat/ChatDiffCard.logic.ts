import type { ChatDiffScope, ReviewDiffPreviewSourceKind } from "@t3tools/contracts";

// "Working tree" is the combined view (every change since the fork point,
// committed *and* uncommitted); "Uncommitted changes" is the local dirty diff;
// "Branch changes" is the committed range. Shared with the diff panel.
export const CHAT_DIFF_SCOPE_LABELS: Record<ChatDiffScope, string> = {
  all: "Working tree",
  unstaged: "Uncommitted changes",
  branch: "Branch changes",
};

export const CHAT_DIFF_SCOPE_SOURCE_KIND: Record<ChatDiffScope, ReviewDiffPreviewSourceKind> = {
  all: "working-tree-all",
  unstaged: "working-tree",
  branch: "branch-range",
};

/** Small diffs open inline; larger ones start collapsed to keep the chat light. */
export const CHAT_DIFF_AUTO_EXPAND_MAX_FILES = 3;

function normalizeDiffPathFilter(path: string): string {
  return path.trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

/**
 * Keeps files the agent asked for. A filter matches the file itself or any
 * directory above it; no filter keeps everything.
 */
export function filterChatDiffFiles<T>(
  files: ReadonlyArray<T>,
  resolvePath: (file: T) => string,
  paths: ReadonlyArray<string> | undefined,
): ReadonlyArray<T> {
  const filters = (paths ?? []).map(normalizeDiffPathFilter).filter((path) => path.length > 0);
  if (filters.length === 0) return files;
  return files.filter((file) => {
    const filePath = resolvePath(file);
    return filters.some((filter) => filePath === filter || filePath.startsWith(`${filter}/`));
  });
}
