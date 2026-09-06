import type { FileDiffMetadata } from "@pierre/diffs/types";

import { fnv1a32 } from "./diffRendering";

const SECONDARY_HASH_SEED = 0x9e3779b9;
const SECONDARY_HASH_MULTIPLIER = 0x85ebca6b;

/**
 * Identifies the actual edits in one file without including unchanged context.
 * This keeps viewed state stable when the diff switches between compact and
 * full-context rendering while still invalidating it after a real file edit.
 */
export function buildDiffViewedSignature(fileDiff: FileDiffMetadata): string {
  const changes = fileDiff.hunks.flatMap((hunk) => {
    let deletionLine = hunk.deletionStart;
    let additionLine = hunk.additionStart;
    return hunk.hunkContent.flatMap((content) => {
      if (content.type === "context") {
        deletionLine += content.lines;
        additionLine += content.lines;
        return [];
      }
      const change = [
        deletionLine,
        additionLine,
        fileDiff.deletionLines
          .slice(content.deletionLineIndex, content.deletionLineIndex + content.deletions)
          .join("\n"),
        fileDiff.additionLines
          .slice(content.additionLineIndex, content.additionLineIndex + content.additions)
          .join("\n"),
      ].join("\0");
      deletionLine += content.deletions;
      additionLine += content.additions;
      return [change];
    });
  });
  const body = [
    fileDiff.type,
    fileDiff.prevName ?? "",
    fileDiff.name,
    fileDiff.prevMode ?? "",
    fileDiff.mode ?? "",
    ...changes,
  ].join("\0");
  const primary = fnv1a32(body).toString(36);
  const secondary = fnv1a32(body, SECONDARY_HASH_SEED, SECONDARY_HASH_MULTIPLIER).toString(36);
  return `${body.length.toString(36)}:${primary}:${secondary}`;
}
