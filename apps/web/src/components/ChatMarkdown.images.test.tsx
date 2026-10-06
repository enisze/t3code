import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
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
vi.mock("./media/MediaActions", () => ({
  MediaActions: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../assets/assetUrls", () => ({
  useAssetUrlState: (_environmentId: unknown, resource: { path: string }) => ({
    _tag: "Success",
    url: `https://environment.example/api/assets/${encodeURIComponent(resource.path)}`,
  }),
  useAssetUrlRefresh: () => vi.fn(),
}));

import ChatMarkdown from "./ChatMarkdown";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

async function renderImage(
  source: string,
  options?: { text?: string; imageBaseDir?: string; noThread?: boolean },
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(async () => {
    renderer = create(
      <ChatMarkdown
        text={options?.text ?? `![Result](${source})`}
        imageBaseDir={options?.imageBaseDir}
        cwd="/workspace/project"
        threadRef={
          options?.noThread
            ? undefined
            : {
                environmentId: EnvironmentId.make("environment-1"),
                threadId: ThreadId.make("thread-1"),
              }
        }
      />,
    );
  });
  return renderer!;
}

describe("chat markdown images", () => {
  it.each([
    ["images/result.png", "/workspace/project/images/result.png"],
    ["/tmp/result.png", "/tmp/result.png"],
    ["file:///tmp/result%20one.png", "/tmp/result one.png"],
    ["C:/images/result.png", "C:/images/result.png"],
  ])("loads %s through the environment and displays it after decoding", async (source, path) => {
    const view = await renderImage(source);
    const image = view.root.findByType("img");
    expect(image.props.src).toBe(
      `https://environment.example/api/assets/${encodeURIComponent(path)}`,
    );
    expect(image.props.className).toContain("invisible");
    await act(async () => image.props.onLoad());
    expect(view.root.findByType("img").props.className).not.toContain("invisible");
  });

  it.each([
    "https://example.com/result.png",
    "data:image/png;base64,AAAA",
    "blob:https://example.com/id",
  ])("loads direct image %s", async (source) => {
    const view = await renderImage(source);
    expect(view.root.findByType("img").props.src).toBe(source);
    await act(async () => view.root.findByType("img").props.onLoad());
    expect(view.root.findByType("img").props.className).not.toContain("invisible");
  });

  it("resolves raw HTML images and honors the image base directory", async () => {
    const view = await renderImage("", {
      text: '<img src="file:///tmp/result%20one.png" alt="Result" />',
    });
    expect(view.root.findByType("img").props.src).toContain(
      encodeURIComponent("/tmp/result one.png"),
    );
    await act(async () => {
      view.update(
        <ChatMarkdown
          text="![Result](result.png)"
          cwd="/workspace/project"
          imageBaseDir="/workspace/docs"
          threadRef={{
            environmentId: EnvironmentId.make("environment-1"),
            threadId: ThreadId.make("thread-1"),
          }}
        />,
      );
    });
    expect(view.root.findByType("img").props.src).toContain(
      encodeURIComponent("/workspace/docs/result.png"),
    );
  });

  it("does not send host filesystem paths to the browser when thread context is absent", async () => {
    const view = await renderImage("/tmp/result.png", { noThread: true });
    expect(view.root.findAllByType("img")).toHaveLength(0);
  });

  it("opens and closes a decoded image preview", async () => {
    vi.stubGlobal("document", { body: {} });
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const view = await renderImage("/tmp/result.png");
    await act(async () => view.root.findByType("img").props.onLoad());
    await act(async () =>
      view.root.findByType("img").props.onClick({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { closest: () => null },
      }),
    );
    expect(view.root.findByProps({ role: "dialog" })).toBeDefined();
    await act(async () =>
      view.root.findAllByProps({ "aria-label": "Close image preview" })[0]!.props.onClick(),
    );
    expect(view.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
  });

  it("replaces failed requests with an unavailable message", async () => {
    const view = await renderImage("/tmp/missing.png");
    await act(async () => view.root.findByType("img").props.onError());
    expect(view.root.findAllByType("img")).toHaveLength(0);
    expect(view.root.findByProps({ role: "alert" })).toBeDefined();
  });

  it("blocks unsupported source schemes", async () => {
    const view = await renderImage("javascript:alert%281%29");
    expect(view.root.findAllByType("img")).toHaveLength(0);
  });
});
