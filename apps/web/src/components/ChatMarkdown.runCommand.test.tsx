import { act, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-dom", () => ({ createPortal: (children: ReactNode) => children }));

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../state/server", () => ({ serverEnvironment: { configValueAtom: () => null } }));
vi.mock("../state/assets", () => ({ assetEnvironment: { createUrl: {} } }));
vi.mock("../state/preview", () => ({ previewEnvironment: { open: {} } }));
vi.mock("../state/session", () => ({ usePreparedConnection: () => null }));
vi.mock("../state/entities", () => ({ useActiveEnvironmentId: () => null }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => vi.fn() }));
vi.mock("../lib/workspaceThreadRef", () => ({ useWorkspaceThreadRef: () => null }));
vi.mock("../editorPreferences", () => ({ useOpenInPreferredEditor: () => vi.fn() }));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../hooks/useDiffThemeName", () => ({ useDiffThemeName: () => "dark" }));
vi.mock("./ui/tooltip", async () => {
  const { cloneElement, isValidElement } = await import("react");
  return {
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipTrigger({
      render,
      children,
    }: ComponentProps<typeof import("./ui/tooltip").TooltipTrigger>) {
      if (!isValidElement(render)) return <>{children}</>;
      return children === undefined ? render : cloneElement(render, undefined, children);
    },
    TooltipPopup: () => null,
  };
});

import ChatMarkdown from "./ChatMarkdown";
import { Button } from "./ui/button";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

function runButton(mounted: ReactTestRenderer) {
  return mounted.root
    .findAllByType(Button)
    .find((button) => button.props["aria-label"] === "Run in terminal");
}

async function render(
  text: string,
  options: { isStreaming?: boolean; onRunShellCommand?: (command: string) => void },
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = (
    <ChatMarkdown
      cwd="/workspace/project"
      text={text}
      isStreaming={options.isStreaming ?? false}
      onRunShellCommand={options.onRunShellCommand}
    />
  );
  await act(async () => {
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
  return renderer!;
}

describe("chat markdown shell commands", () => {
  it("runs a finished single-line shell block only when its button is clicked", async () => {
    const onRunShellCommand = vi.fn();
    let view = await render("```bash\necho hello\n```", { isStreaming: true, onRunShellCommand });
    expect(runButton(view)).toBeUndefined();

    view = await render("```bash\necho hello\n```", { onRunShellCommand });
    expect(onRunShellCommand).not.toHaveBeenCalled();
    await act(async () => {
      runButton(view)?.props.onClick?.({} as never);
    });
    expect(onRunShellCommand).toHaveBeenCalledExactlyOnceWith("echo hello");

    for (const text of [
      "~~~bash\necho tilde\n~~~",
      "> ```bash\n> echo quote\n> ```",
      "````bash\necho four\n````",
    ]) {
      view = await render(text, { onRunShellCommand });
      expect(runButton(view)).toBeDefined();
    }
  });

  it("offers no button for blocks that could run something other than what is shown", async () => {
    const onRunShellCommand = vi.fn();
    for (const text of [
      "```bash\necho one\necho two\n```",
      "```typescript\necho hello\n```",
      "```bash\n\n```",
      "```bash\necho hello\n\n```",
      "```bash\necho hello\\\n```",
      "```bash\necho safe \u202e#\n```",
      "```bash\necho incomplete",
      "~~~bash\necho incomplete",
      "````bash\necho incomplete\n```",
    ]) {
      const view = await render(text, { onRunShellCommand });
      expect(runButton(view)).toBeUndefined();
    }
    expect(onRunShellCommand).not.toHaveBeenCalled();
  });

  it("offers no button where the caller gives no way to run", async () => {
    const view = await render("```bash\necho hello\n```", {});
    expect(runButton(view)).toBeUndefined();
  });
});
