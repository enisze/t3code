/**
 * Re-staging a sent message's attachments into a fresh composer draft
 * ("start a new chat with this message").
 *
 * A sent attachment only survives as bytes on the server: the composer's
 * `File` is dropped once the turn starts, so the timeline row carries nothing
 * but the attachment record plus the URL it renders from (a signed
 * `/api/assets` URL, or the send-time blob URL while the handoff is still
 * live). Both are fetchable, so the bytes are pulled back and wrapped in a
 * new `File` — which is what the composer and the send path need.
 */
import type { ComposerDocumentAttachment, ComposerImageAttachment } from "../composerDraftStore";
import type { ChatAttachment } from "../types";
import { randomUUID } from "./utils";

export interface ReusedMessageAttachments {
  readonly images: ComposerImageAttachment[];
  readonly documents: ComposerDocumentAttachment[];
  /** Names of attachments whose bytes could not be fetched back. */
  readonly unavailableNames: string[];
}

const EMPTY_REUSED_ATTACHMENTS: ReusedMessageAttachments = {
  images: [],
  documents: [],
  unavailableNames: [],
};

/** Fetches an attachment's bytes back from the URL the timeline renders it from. */
export type MessageAttachmentFileLoader = (attachment: ChatAttachment) => Promise<File | null>;

export async function loadMessageAttachmentFile(attachment: ChatAttachment): Promise<File | null> {
  const url = attachment.previewUrl;
  if (!url) {
    return null;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    return new File([blob], attachment.name, { type: attachment.mimeType });
  } catch {
    return null;
  }
}

/**
 * Rebuilds composer attachments for `attachments`, keeping their order within
 * each kind. Order matters beyond cosmetics: preview-annotation screenshots
 * are matched to their text markers positionally when the new message renders.
 *
 * Fresh ids are minted — the old ones belong to the source thread's server
 * attachments and would collide with the composer's dedupe bookkeeping if the
 * same message were reused twice.
 */
export async function reuseMessageAttachments(
  attachments: ReadonlyArray<ChatAttachment>,
  loadFile: MessageAttachmentFileLoader = loadMessageAttachmentFile,
): Promise<ReusedMessageAttachments> {
  if (attachments.length === 0) {
    return EMPTY_REUSED_ATTACHMENTS;
  }
  const files = await Promise.all(attachments.map((attachment) => loadFile(attachment)));
  const images: ComposerImageAttachment[] = [];
  const documents: ComposerDocumentAttachment[] = [];
  const unavailableNames: string[] = [];
  attachments.forEach((attachment, index) => {
    const file = files[index];
    if (!file) {
      unavailableNames.push(attachment.name);
      return;
    }
    if (attachment.type === "image") {
      images.push({
        type: "image",
        id: randomUUID(),
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: file.size,
        previewUrl: createLocalPreviewUrl(file),
        file,
      });
      return;
    }
    documents.push({
      type: "document",
      id: randomUUID(),
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: file.size,
      file,
    });
  });
  return { images, documents, unavailableNames };
}

export function buildUnavailableAttachmentsToastCopy(unavailableNames: ReadonlyArray<string>): {
  title: string;
  description: string;
} {
  const count = unavailableNames.length;
  return {
    title:
      count === 1
        ? "1 attachment couldn't be carried over"
        : `${count} attachments couldn't be carried over`,
    description: `${unavailableNames.join(", ")} — the message text was copied without them.`,
  };
}

function createLocalPreviewUrl(file: File): string {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return "";
  }
  return URL.createObjectURL(file);
}
