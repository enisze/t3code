import { EnvironmentId, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const refreshProviders = vi.hoisted(() => vi.fn());
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => refreshProviders }));
vi.mock("../../state/server", () => ({ serverEnvironment: { refreshProviders: {} } }));

import { useProviderWorkspaceSnapshot } from "./useProviderWorkspaceSnapshot";

const environmentId = EnvironmentId.make("environment");
const instanceId = ProviderInstanceId.make("cursor");
const cwd = "/repo";

function provider(scannedCwds: ReadonlyArray<string> = []): ServerProvider {
  return {
    instanceId,
    workspaceSnapshots: scannedCwds.map((scannedCwd) => ({
      cwd: scannedCwd,
      checkedAt: "2026-10-24T00:00:00.000Z",
      skills: [],
      slashCommands: [],
    })),
  } as unknown as ServerProvider;
}

function Probe(props: { provider: ServerProvider; activity: string }) {
  useProviderWorkspaceSnapshot({ environmentId, cwd, ...props });
  return null;
}

let renderer: ReactTestRenderer | undefined;
async function render(props: { provider: ServerProvider; activity: string }) {
  await act(() => {
    if (renderer) renderer.update(<Probe {...props} />);
    else renderer = create(<Probe {...props} />);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  refreshProviders.mockReset();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useProviderWorkspaceSnapshot", () => {
  it("scans a workspace once and not again once its snapshot arrives", async () => {
    refreshProviders.mockResolvedValue({
      _tag: "Success",
      value: { providers: [provider([cwd])] },
    });
    await render({ provider: provider(), activity: "" });
    await render({ provider: provider(), activity: "/" });
    expect(refreshProviders).toHaveBeenCalledTimes(1);
    expect(refreshProviders).toHaveBeenCalledWith({
      environmentId,
      input: { instanceId, cwd },
    });

    await render({ provider: provider([cwd]), activity: "/re" });
    expect(refreshProviders).toHaveBeenCalledTimes(1);
  });

  it("retries a failed scan only after the cooldown, when the user types", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-24T12:00:00.000Z"));
    refreshProviders.mockResolvedValue({ _tag: "Failure", cause: null });
    await render({ provider: provider(), activity: "" });
    expect(refreshProviders).toHaveBeenCalledTimes(1);

    await render({ provider: provider(), activity: "/" });
    expect(refreshProviders).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.parse("2026-10-24T12:00:11.000Z"));
    await render({ provider: provider(), activity: "/r" });
    expect(refreshProviders).toHaveBeenCalledTimes(2);
  });

  it("scans again when the server drops the workspace snapshot", async () => {
    refreshProviders.mockResolvedValue({
      _tag: "Success",
      value: { providers: [provider([cwd])] },
    });
    await render({ provider: provider([cwd]), activity: "" });
    expect(refreshProviders).not.toHaveBeenCalled();

    await render({ provider: provider(), activity: "" });
    expect(refreshProviders).toHaveBeenCalledTimes(1);
  });
});
