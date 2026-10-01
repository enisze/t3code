import { describe, expect, it } from "vite-plus/test";

import { resolveThreadSyncPhase } from "./threadSync";

describe("resolveThreadSyncPhase", () => {
  it("loads when only shell data is available", () => {
    expect(
      resolveThreadSyncPhase({
        detailExists: false,
        shellExists: true,
        status: "synchronizing",
        failed: false,
      }),
    ).toBe("loading");
  });

  it("syncs when cached detail is already visible", () => {
    expect(
      resolveThreadSyncPhase({
        detailExists: true,
        shellExists: true,
        status: "cached",
        failed: false,
      }),
    ).toBe("syncing");
  });

  it("reports a failure instead of progress once the load has terminated", () => {
    for (const status of ["empty", "cached", "synchronizing"] as const) {
      expect(
        resolveThreadSyncPhase({
          detailExists: false,
          shellExists: true,
          status,
          failed: true,
        }),
      ).toBe("failed");
    }
  });

  it("keeps reporting a sync while loaded messages stay on screen", () => {
    expect(
      resolveThreadSyncPhase({
        detailExists: true,
        shellExists: true,
        status: "synchronizing",
        failed: true,
      }),
    ).toBe("syncing");
  });

  it("does not report a sync phase without a shell or after going live", () => {
    expect(
      resolveThreadSyncPhase({
        detailExists: false,
        shellExists: false,
        status: "empty",
        failed: true,
      }),
    ).toBeNull();
    expect(
      resolveThreadSyncPhase({
        detailExists: true,
        shellExists: true,
        status: "live",
        failed: false,
      }),
    ).toBeNull();
  });
});
