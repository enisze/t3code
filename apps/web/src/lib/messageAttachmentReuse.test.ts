import { describe, expect, it } from "vite-plus/test";

import type { ChatAttachment } from "../types";
import {
  buildUnavailableAttachmentsToastCopy,
  reuseMessageAttachments,
} from "./messageAttachmentReuse";

function imageAttachment(name: string, previewUrl?: string): ChatAttachment {
  return {
    type: "image",
    id: `attachment-${name}`,
    name,
    mimeType: "image/png",
    sizeBytes: 12,
    ...(previewUrl ? { previewUrl } : {}),
  } as ChatAttachment;
}

function documentAttachment(name: string, previewUrl?: string): ChatAttachment {
  return {
    type: "document",
    id: `attachment-${name}`,
    name,
    mimeType: "application/pdf",
    sizeBytes: 34,
    ...(previewUrl ? { previewUrl } : {}),
  } as ChatAttachment;
}

const loadFile = async (attachment: ChatAttachment) =>
  attachment.previewUrl
    ? new File([`bytes-of-${attachment.name}`], attachment.name, { type: attachment.mimeType })
    : null;

describe("reuseMessageAttachments", () => {
  it("splits images and documents, keeping each kind's order", async () => {
    const reused = await reuseMessageAttachments(
      [
        imageAttachment("first.png", "blob:first"),
        documentAttachment("spec.pdf", "/api/assets/token/spec.pdf"),
        imageAttachment("second.png", "blob:second"),
      ],
      loadFile,
    );

    expect(reused.images.map((image) => image.name)).toEqual(["first.png", "second.png"]);
    expect(reused.documents.map((document) => document.name)).toEqual(["spec.pdf"]);
    expect(reused.unavailableNames).toEqual([]);
    expect(reused.images[0]?.mimeType).toBe("image/png");
    expect(reused.images[0]?.sizeBytes).toBe(reused.images[0]?.file.size);
  });

  it("mints fresh ids so reusing the same message twice never collides", async () => {
    const attachments = [imageAttachment("shot.png", "blob:shot")];
    const first = await reuseMessageAttachments(attachments, loadFile);
    const second = await reuseMessageAttachments(attachments, loadFile);

    expect(first.images[0]?.id).not.toBe(second.images[0]?.id);
    expect(first.images[0]?.id).not.toBe("attachment-shot.png");
  });

  it("reports attachments whose bytes could not be read back", async () => {
    const reused = await reuseMessageAttachments(
      [imageAttachment("gone.png"), imageAttachment("here.png", "blob:here")],
      loadFile,
    );

    expect(reused.images.map((image) => image.name)).toEqual(["here.png"]);
    expect(reused.unavailableNames).toEqual(["gone.png"]);
  });

  it("does no work for a message without attachments", async () => {
    const reused = await reuseMessageAttachments([], loadFile);

    expect(reused).toEqual({ images: [], documents: [], unavailableNames: [] });
  });
});

describe("buildUnavailableAttachmentsToastCopy", () => {
  it("names the dropped attachments", () => {
    expect(buildUnavailableAttachmentsToastCopy(["a.png"]).title).toBe(
      "1 attachment couldn't be carried over",
    );
    const many = buildUnavailableAttachmentsToastCopy(["a.png", "b.pdf"]);
    expect(many.title).toBe("2 attachments couldn't be carried over");
    expect(many.description).toContain("a.png, b.pdf");
  });
});
