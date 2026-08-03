import { describe, expect, it } from "vite-plus/test";

import { DraftId } from "./composerDraftStore";
import {
  consumePendingDraftAutoSubmit,
  hasPendingDraftAutoSubmit,
  markDraftForAutoSubmit,
} from "./draftAutoSubmit";

describe("draft auto-submit", () => {
  it("consumes a pending submission exactly once", () => {
    const draftId = DraftId.make("review-draft");

    markDraftForAutoSubmit(draftId);

    expect(hasPendingDraftAutoSubmit(draftId)).toBe(true);
    expect(consumePendingDraftAutoSubmit(draftId)).toBe(true);
    expect(hasPendingDraftAutoSubmit(draftId)).toBe(false);
    expect(consumePendingDraftAutoSubmit(draftId)).toBe(false);
  });
});
