import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { openMarkdownFilePrimaryAction } from "./markdownFileActions";
import { useRightPanelStore } from "./rightPanelStore";

const threadRef = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-1"));

afterEach(() => {
  useRightPanelStore.setState({ byThreadKey: {} });
});

describe("openMarkdownFilePrimaryAction", () => {
  it("opens mentioned workspace files in the thread file viewer", () => {
    const openInEditor = vi.fn();

    openMarkdownFilePrimaryAction({
      threadRef,
      workspaceRelativePath: "docs/preview.html",
      targetPath: "/workspace/docs/preview.html:12",
      line: 12,
      openInEditor,
    });

    expect(openInEditor).not.toHaveBeenCalled();
    expect(useRightPanelStore.getState().byThreadKey["env-1:thread-1"]).toMatchObject({
      isOpen: true,
      activeSurfaceId: "file:docs/preview.html",
      surfaces: [
        {
          kind: "file",
          relativePath: "docs/preview.html",
          revealLine: 12,
        },
      ],
    });
  });

  it("falls back to the preferred editor without thread file context", () => {
    const openInEditor = vi.fn();

    openMarkdownFilePrimaryAction({
      threadRef,
      workspaceRelativePath: null,
      targetPath: "/tmp/report.txt",
      line: undefined,
      openInEditor,
    });

    expect(openInEditor).toHaveBeenCalledWith("/tmp/report.txt");
  });
});
