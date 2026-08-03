import type { DraftId } from "./composerDraftStore";

const pendingDraftIds = new Set<DraftId>();

export function markDraftForAutoSubmit(draftId: DraftId): void {
  pendingDraftIds.add(draftId);
}

export function hasPendingDraftAutoSubmit(draftId: DraftId): boolean {
  return pendingDraftIds.has(draftId);
}

export function consumePendingDraftAutoSubmit(draftId: DraftId): boolean {
  if (!pendingDraftIds.has(draftId)) return false;
  pendingDraftIds.delete(draftId);
  return true;
}
