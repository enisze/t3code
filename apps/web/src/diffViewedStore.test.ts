import { beforeEach, describe, expect, it } from "vite-plus/test";

import { selectViewedSignatures, useDiffViewedStore } from "./diffViewedStore";

const SCOPE = "env:thread:branch";

describe("diffViewedStore", () => {
  beforeEach(() => {
    useDiffViewedStore.setState({ viewedByScope: {} });
  });

  it("records the content signature a file had when marked viewed", () => {
    useDiffViewedStore.getState().setFileViewed(SCOPE, "a.ts", "sig-1", true);

    expect(selectViewedSignatures(useDiffViewedStore.getState().viewedByScope, SCOPE)).toEqual({
      "a.ts": "sig-1",
    });
  });

  it("treats a file as no longer viewed once its signature changes", () => {
    useDiffViewedStore.getState().setFileViewed(SCOPE, "a.ts", "sig-1", true);

    const stored = selectViewedSignatures(useDiffViewedStore.getState().viewedByScope, SCOPE);
    // Same file, new content signature -> the stored mark no longer matches.
    expect(stored["a.ts"]).toBe("sig-1");
    expect(stored["a.ts"] === "sig-2").toBe(false);
  });

  it("keeps other viewed files untouched when one file is edited/unviewed", () => {
    const store = useDiffViewedStore.getState();
    store.setFileViewed(SCOPE, "a.ts", "sig-a", true);
    store.setFileViewed(SCOPE, "b.ts", "sig-b", true);

    store.setFileViewed(SCOPE, "a.ts", "sig-a", false);

    expect(selectViewedSignatures(useDiffViewedStore.getState().viewedByScope, SCOPE)).toEqual({
      "b.ts": "sig-b",
    });
  });

  it("updates the stored signature when a viewed file is re-marked after a change", () => {
    const store = useDiffViewedStore.getState();
    store.setFileViewed(SCOPE, "a.ts", "sig-1", true);
    store.setFileViewed(SCOPE, "a.ts", "sig-2", true);

    expect(selectViewedSignatures(useDiffViewedStore.getState().viewedByScope, SCOPE)).toEqual({
      "a.ts": "sig-2",
    });
  });

  it("clears a whole scope", () => {
    const store = useDiffViewedStore.getState();
    store.setFileViewed(SCOPE, "a.ts", "sig-a", true);
    store.setFileViewed("other", "z.ts", "sig-z", true);

    store.clearScope(SCOPE);

    expect(selectViewedSignatures(useDiffViewedStore.getState().viewedByScope, SCOPE)).toEqual({});
    expect(selectViewedSignatures(useDiffViewedStore.getState().viewedByScope, "other")).toEqual({
      "z.ts": "sig-z",
    });
  });

  it("returns an empty signature map for a null scope", () => {
    expect(selectViewedSignatures({}, null)).toEqual({});
  });

  it("removes a viewed mark when the file's current signature changes", () => {
    const store = useDiffViewedStore.getState();
    store.setFileViewed(SCOPE, "changed.ts", "sig-before", true);
    store.setFileViewed(SCOPE, "same.ts", "sig-same", true);

    store.reconcileViewedSignatures(
      SCOPE,
      new Map([
        ["changed.ts", "sig-after"],
        ["same.ts", "sig-same"],
      ]),
    );

    expect(selectViewedSignatures(useDiffViewedStore.getState().viewedByScope, SCOPE)).toEqual({
      "same.ts": "sig-same",
    });
  });
});
