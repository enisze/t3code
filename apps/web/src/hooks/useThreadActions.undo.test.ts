import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { toastManager } from "../components/ui/toast";
import { threadEnvironment } from "../state/threads";
import { activateWorkspaceChat } from "../workspaceContentTabsStore";
import { useThreadActions } from "./useThreadActions";

const commands = vi.hoisted(() => ({
  archive: vi.fn(),
  unarchive: vi.fn(),
  snooze: vi.fn(),
  unsnooze: vi.fn(),
}));
const router = vi.hoisted(() => ({
  navigate: vi.fn(async () => {}),
  state: { matches: [{ params: {} as Record<string, string> }] },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
  useMemo: (create: () => unknown) => create(),
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => router }));
vi.mock("./useSettings", () => ({
  useClientSettings: (select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    select(DEFAULT_CLIENT_SETTINGS),
}));
vi.mock("../composerDraftStore", () => ({ useComposerDraftStore: () => vi.fn() }));
vi.mock("../terminalUiStateStore", () => ({ useTerminalUiStateStore: () => vi.fn() }));
vi.mock("../lib/archivedThreadsState", () => ({ refreshArchivedThreadsForEnvironment: vi.fn() }));
vi.mock("../workspaceContentTabsStore", () => ({ activateWorkspaceChat: vi.fn() }));
const threadShell = vi.hoisted(() => ({
  id: "thread",
  title: "Thread",
  environmentId: "undo-env",
  projectId: "project",
  worktreePath: null,
  archivedAt: null,
  session: null,
  latestTurn: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
}));
vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  readEnvironmentSupportsSnooze: () => true,
  readThreadShell: () => threadShell,
  readThreadRefs: () => [],
  waitForThreadShell: async () => threadShell,
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => {
    switch (command) {
      case threadEnvironment.archive:
        return commands.archive;
      case threadEnvironment.unarchive:
        return commands.unarchive;
      case threadEnvironment.snooze:
        return commands.snooze;
      case threadEnvironment.unsnooze:
        return commands.unsnooze;
      default:
        return vi.fn();
    }
  },
}));

const target = {
  environmentId: EnvironmentId.make("undo-env"),
  threadId: ThreadId.make("thread"),
};
const event = {} as Parameters<NonNullable<React.ComponentProps<"button">["onClick"]>>[0];

function undoOf(
  add: { mock: { calls: Array<[Parameters<typeof toastManager.add>[0]]> } },
  index: number,
) {
  const onClick = add.mock.calls[index]?.[0].actionProps?.onClick;
  expect(onClick).toBeTypeOf("function");
  return () => onClick?.(event);
}

function spyOnToasts() {
  const add = vi.spyOn(toastManager, "add").mockReturnValue("toast");
  vi.spyOn(toastManager, "close").mockImplementation(() => {});
  return add;
}

beforeEach(() => {
  for (const command of Object.values(commands)) {
    command.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  }
  router.navigate.mockClear();
  router.state.matches[0]!.params = {};
  vi.mocked(activateWorkspaceChat).mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("archive Undo", () => {
  it("unarchives and reopens the thread once it is back when archiving left it", async () => {
    const add = spyOnToasts();
    router.state.matches[0]!.params = {
      environmentId: target.environmentId,
      threadId: target.threadId,
    };
    const actions = useThreadActions();
    await actions.archiveThread(target);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ title: "Thread archived" }));
    await undoOf(add, 0)();
    expect(commands.unarchive).toHaveBeenCalledExactlyOnceWith({
      environmentId: target.environmentId,
      input: { threadId: target.threadId },
    });
    expect(activateWorkspaceChat).toHaveBeenCalledWith(threadShell);
    expect(router.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: "/$environmentId/$threadId",
        params: { environmentId: target.environmentId, threadId: target.threadId },
      }),
    );
  });

  it("stays put when the archived thread was not open", async () => {
    const add = spyOnToasts();
    await useThreadActions().archiveThread(target);
    await undoOf(add, 0)();
    expect(commands.unarchive).toHaveBeenCalledOnce();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("expires the Undo once the thread is restored another way", async () => {
    const add = spyOnToasts();
    const actions = useThreadActions();
    await actions.archiveThread(target);
    const undo = undoOf(add, 0);
    await actions.unarchiveThread(target);
    await undo();
    expect(commands.unarchive).toHaveBeenCalledOnce();
  });

  it("shows no Undo when the archive failed or for a closed chat tab", async () => {
    const add = spyOnToasts();
    const actions = useThreadActions();
    await actions.archiveThread(target, { undoToast: false });
    commands.archive.mockResolvedValue({ _tag: "Failure", cause: new Error("nope") });
    await actions.archiveThread(target);
    expect(add).not.toHaveBeenCalled();
  });
});

describe("snooze Undo", () => {
  it("wakes the thread from the notice", async () => {
    const add = spyOnToasts();
    const actions = useThreadActions();
    await actions.snoozeThread(target, new Date(Date.now() + 60_000).toISOString());
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/^Snoozed until /) }),
    );
    await undoOf(add, 0)();
    expect(commands.unsnooze).toHaveBeenCalledExactlyOnceWith({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, reason: "user" },
    });
  });

  it("expires the Undo after a manual wake", async () => {
    const add = spyOnToasts();
    const actions = useThreadActions();
    await actions.snoozeThread(target, new Date(Date.now() + 60_000).toISOString());
    const undo = undoOf(add, 0);
    await actions.unsnoozeThread(target);
    await undo();
    expect(commands.unsnooze).toHaveBeenCalledOnce();
  });
});
