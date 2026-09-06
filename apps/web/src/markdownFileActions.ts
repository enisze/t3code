import type { ScopedThreadRef } from "@t3tools/contracts";

import { useRightPanelStore } from "./rightPanelStore";

interface OpenMarkdownFilePrimaryActionInput {
  readonly threadRef: ScopedThreadRef | undefined;
  readonly workspaceRelativePath: string | null;
  readonly targetPath: string;
  readonly line: number | undefined;
  readonly openInEditor: (targetPath: string) => void;
}

export function openMarkdownFilePrimaryAction({
  threadRef,
  workspaceRelativePath,
  targetPath,
  line,
  openInEditor,
}: OpenMarkdownFilePrimaryActionInput): void {
  if (threadRef && workspaceRelativePath) {
    useRightPanelStore.getState().openFile(threadRef, workspaceRelativePath, line);
    return;
  }

  openInEditor(targetPath);
}
