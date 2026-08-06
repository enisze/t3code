import type { PreviewSessionSnapshot, ProjectScript } from "@t3tools/contracts";

export function shouldShowPreviewEmptyState(snapshot: PreviewSessionSnapshot | null): boolean {
  return snapshot === null || snapshot.navStatus._tag === "Idle";
}

export function getConfiguredPreviewUrls(
  scripts: ReadonlyArray<ProjectScript> | undefined,
): ReadonlyArray<string> {
  return scripts?.flatMap((script) => (script.previewUrl ? [script.previewUrl] : [])) ?? [];
}

/**
 * Short label for a browser-preview tab in the content-tab strip. Uses the
 * URL's host (including port, e.g. `localhost:5173`) so several localhost
 * previews are distinguishable; falls back to "Preview" before a URL loads.
 */
export function previewTabLabel(url: string): string {
  if (!url) return "Preview";
  try {
    return new URL(url).host || "Preview";
  } catch {
    return "Preview";
  }
}
