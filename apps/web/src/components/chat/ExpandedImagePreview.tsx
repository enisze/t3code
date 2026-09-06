
import type { ComposerFileAttachment } from "../../composerDraftStore";
import { type ChatImageAttachment, isVideoAttachment } from "../../types";
import { videoMimeType } from "@t3tools/shared/video";
import { resolveMediaSource } from "@t3tools/client-runtime/media-source";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { resolveExternalWebLinkHost } from "./externalLinkContextMenu";
import type { MediaActionSource } from "../media/MediaActions";
import { resolveProtocolRelativeMediaUrl } from "../media/mediaContent";
import type { AssetCreateUrlResult, AssetResource, ChatFileAttachment, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
export interface ExpandedImageItem {
  src: string;
  name: string;
}

export interface ExpandedImagePreview {
  images: ExpandedImageItem[];
  index: number;
}

export function buildExpandedImagePreview(
  images: ReadonlyArray<{ id: string; name: string; previewUrl?: string }>,
  selectedImageId: string,
): ExpandedImagePreview | null {
  const previewableImages = images.flatMap((image) =>
    image.previewUrl ? [{ id: image.id, src: image.previewUrl, name: image.name }] : [],
  );
  if (previewableImages.length === 0) {
    return null;
  }
  const selectedIndex = previewableImages.findIndex((image) => image.id === selectedImageId);
  if (selectedIndex < 0) {
    return null;
  }
  return {
    images: previewableImages.map((image) => ({
      src: image.src,
      name: image.name,
    })),
    index: selectedIndex,
  };
}

/** Resolves a chat media reference on its owning environment, without downloading its bytes. */
export async function resolveMarkdownMediaPreview(input: {
  source: string;
  resolvedFilePath?: string | undefined;
  cwd?: string | undefined;
  threadRef?: ScopedThreadRef | undefined;
  httpBaseUrl?: string | undefined;
  onOpenFile?: ((relativePath: string) => void) | undefined;
  createAssetUrl: (input: {
    environmentId: EnvironmentId;
    input: { resource: AssetResource };
  }) => Promise<AtomCommandResult<AssetCreateUrlResult, unknown>>;
}): Promise<ExpandedImagePreview | null> {
  const media = resolveMediaSource(input.source, {
    threadId: input.threadRef?.threadId,
    workspaceRoot: input.cwd,
    resolvedFilePath: input.resolvedFilePath,
  });
  if (media === null) return null;
  const { kind, name, reference } = media;
  const relativePath = reference?.kind === "file" ? reference.relativePath : undefined;

  let src: string;
  let asset: MediaActionSource["asset"];
  if (media.access === "direct") {
    src = resolveProtocolRelativeMediaUrl(media.uri);
  } else {
    if (media.access === "unavailable" || !input.threadRef || !input.httpBaseUrl) {
      throw new Error("Reconnect to this environment and open the media again.");
    }
    asset = { environmentId: input.threadRef.environmentId, resource: media.resource };
    const result = await input.createAssetUrl({
      environmentId: asset.environmentId,
      input: { resource: asset.resource },
    });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    const assetUrl = resolveAssetUrl(input.httpBaseUrl, result.value.relativeUrl);
    if (assetUrl === null) throw new Error("The environment returned an invalid media URL.");
    src = assetUrl + media.srcFragment;
  }
  return {
    images: [
      {
        src,
        name,
        ...(kind === "video" ? { type: "video", autoPlay: false } : {}),
        ...(media.access === "direct" && resolveExternalWebLinkHost(media.uri) !== null
          ? { originalUrl: media.uri }
          : {}),
        ...(media.srcFragment ? { srcFragment: media.srcFragment } : {}),
        actionsSource: {
          kind,
          name,
          src,
          ...(reference ? { reference } : {}),
          ...(asset ? { asset } : {}),
          ...(relativePath && input.onOpenFile
            ? { onOpenFile: () => input.onOpenFile?.(relativePath) }
            : {}),
        },
      },
    ],
    index: 0,
  };
}

export function buildAttachmentVideoAsset(
  environmentId: EnvironmentId,
  attachment: ChatFileAttachment,
): NonNullable<MediaActionSource["asset"]> {
  return {
    environmentId,
    resource: {
      _tag: "attachment" as const,
      attachmentId: attachment.id,
      fileName: attachment.name,
      mimeType: videoMimeType(attachment) ?? attachment.mimeType,
    },
  };
}

export function expandedImageKey(preview: ExpandedImagePreview): string {
  const item = preview.images[preview.index];
  const asset = item?.actionsSource?.asset;
  return `${item?.src ?? (asset ? JSON.stringify([asset.environmentId, asset.resource]) : "image")}:${preview.index}`;
}

export function attachVideoThumbnail(video: HTMLVideoElement, file: File): () => void {
  const url = URL.createObjectURL(file);
  video.src = url;
  return () => URL.revokeObjectURL(url);
}
