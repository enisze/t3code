import type { PreviewAnnotationPayload } from "@t3tools/contracts";
import { buildElementContextBlock, normalizeElementContextSelection } from "./elementContext";

export {
  extractTrailingPreviewAnnotation,
  type ExtractedPreviewAnnotation,
  type ParsedPreviewAnnotation,
} from "@t3tools/shared/userMessageContexts";

export function buildPreviewAnnotationPrompt(annotation: PreviewAnnotationPayload): string {
  const lines = ["Preview annotation:"];
  lines.push(`Id: ${annotation.id}`);
  const title = annotation.pageTitle?.trim() || annotation.pageUrl.trim() || "Preview";
  lines.push(`Page: ${title}`);
  if (annotation.comment.trim()) lines.push(`Comment: ${annotation.comment.trim()}`);
  const targets: string[] = [];
  if (annotation.elements.length > 0) {
    targets.push(
      `${annotation.elements.length} selected element${annotation.elements.length === 1 ? "" : "s"}`,
    );
  }
  if (annotation.regions.length > 0) {
    targets.push(
      `${annotation.regions.length} marked region${annotation.regions.length === 1 ? "" : "s"}`,
    );
  }
  if (annotation.strokes.length > 0) {
    targets.push(
      `${annotation.strokes.length} drawing${annotation.strokes.length === 1 ? "" : "s"}`,
    );
  }
  if (targets.length > 0) lines.push(`Targets: ${targets.join(", ")}.`);
  if (annotation.styleChanges.length > 0) {
    lines.push("Requested visual changes:");
    for (const change of annotation.styleChanges) {
      lines.push(`- ${change.property}: ${change.previousValue || "(unset)"} → ${change.value}`);
    }
  }
  if (annotation.screenshot) {
    lines.push("The attached screenshot is the annotated preview crop.");
  }
  const elementContexts = annotation.elements
    .map((target) => normalizeElementContextSelection(target.element))
    .filter((context) => context !== null);
  const elementBlock = buildElementContextBlock(elementContexts);
  if (elementBlock) lines.push(elementBlock);
  return ["<preview_annotation>", ...lines, "</preview_annotation>"].join("\n");
}

export function appendPreviewAnnotationPrompt(
  prompt: string,
  annotation: PreviewAnnotationPayload,
): string {
  const annotationText = buildPreviewAnnotationPrompt(annotation);
  const trimmed = prompt.trim();
  return trimmed ? `${trimmed}\n\n${annotationText}` : annotationText;
}

async function previewAnnotationScreenshotFile(
  annotation: PreviewAnnotationPayload,
): Promise<File | null> {
  if (!annotation.screenshot) return null;
  const response = await fetch(annotation.screenshot.dataUrl);
  const blob = await response.blob();
  return new File([blob], `preview-annotation-${annotation.id}.png`, {
    type: blob.type || "image/png",
  });
}

/** Upper bound on turning a picked element's crop into a composer attachment. */
const PREVIEW_ANNOTATION_CAPTURE_TIMEOUT_MS = 5_000;

export type PreviewAnnotationCapture =
  /** The crop is ready to attach. */
  | { readonly status: "captured"; readonly file: File }
  /** The pick carried no crop, which is normal for comment-only annotations. */
  | { readonly status: "none" }
  /** The crop stalled or threw. Send the annotation without it. */
  | { readonly status: "failed" };

/**
 * Bounded wrapper around `previewAnnotationScreenshotFile`. The picker holds the
 * composer while this runs, so it must always settle: a stalled crop resolves as
 * `failed` instead of leaving the caller waiting.
 */
export async function capturePreviewAnnotationScreenshot(
  annotation: PreviewAnnotationPayload,
  timeoutMs: number = PREVIEW_ANNOTATION_CAPTURE_TIMEOUT_MS,
): Promise<PreviewAnnotationCapture> {
  if (!annotation.screenshot) return { status: "none" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const file = await Promise.race([
      previewAnnotationScreenshotFile(annotation),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    return file ? { status: "captured", file } : { status: "failed" };
  } catch {
    return { status: "failed" };
  } finally {
    clearTimeout(timer);
  }
}
