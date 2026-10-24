import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { applyClaudePromptEffortPrefix } from "@t3tools/shared/model";

import { newMessageId } from "../../lib/utils";
import { latestCompletedToolActivityId, useQueuedMessageStore } from "../../queuedMessageStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readThreadShell, readThreadStructure } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import {
  buildTurnMessageText,
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  readTurnAttachments,
  resolveThreadMetadataUpdateForNextTurn,
  revokeBlobPreviewUrl,
} from "../ChatView.logic";
import { toastManager } from "../ui/toast";

async function run<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await runAtomCommand(appAtomRegistry, command, input, { reportFailure: false });
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}

/**
 * Sends one queued message as a turn on its thread. `QueuedMessageSender`
 * calls it when the head message is due, and Send now calls it directly. It
 * reads nothing from the composer, so it works for threads that are not on
 * screen. A failed send stays at the head of the queue, held for Send now.
 */
export async function sendQueuedMessage(
  threadRef: ScopedThreadRef,
  messageId: string,
): Promise<void> {
  const { environmentId, threadId } = threadRef;
  const threadKey = scopedThreadKey(threadRef);
  const queue = useQueuedMessageStore.getState();
  const message = queue.beginSend(
    threadKey,
    messageId,
    latestCompletedToolActivityId(readThreadStructure(threadRef)?.activities ?? []),
  );
  if (!message) return;
  const { sendSettings } = message;
  try {
    const { sendableTerminalContexts, hasSendableContent } = deriveComposerSendState({
      prompt: message.prompt,
      imageCount: message.images.length,
      documentCount: message.documents.length,
      terminalContexts: message.terminalContexts,
      elementContextCount:
        message.elementContexts.length +
        message.previewAnnotations.length +
        message.reviewComments.length,
    });
    // Only expired terminal context was left. Retrying would block the queue
    // on every boundary, so drop it and let the queue move on.
    if (!hasSendableContent) {
      queue.finishSend(threadKey, message.id);
      return;
    }
    const text = applyClaudePromptEffortPrefix(
      buildTurnMessageText({
        prompt: message.prompt,
        terminalContexts: sendableTerminalContexts,
        elementContexts: message.elementContexts,
        previewAnnotations: message.previewAnnotations,
        reviewComments: message.reviewComments,
        hasImages: message.images.length > 0,
      }),
      sendSettings.promptEffort,
    );
    const attachments = await readTurnAttachments(message);

    // The server starts the turn with the thread's stored model and modes, so
    // a change made in the composer before queueing is saved first.
    const createdAt = new Date().toISOString();
    const shell = readThreadShell(threadRef);
    const metadataUpdate = shell
      ? resolveThreadMetadataUpdateForNextTurn({
          currentModelSelection: shell.modelSelection,
          nextModelSelection: sendSettings.modelSelection,
          currentBranch: shell.branch,
        })
      : null;
    if (metadataUpdate) {
      await run(threadEnvironment.updateMetadata, {
        environmentId,
        input: { threadId, ...metadataUpdate },
      });
    }
    if (shell && shell.runtimeMode !== sendSettings.runtimeMode) {
      await run(threadEnvironment.setRuntimeMode, {
        environmentId,
        input: { threadId, runtimeMode: sendSettings.runtimeMode, createdAt },
      });
    }
    if (shell && shell.interactionMode !== sendSettings.interactionMode) {
      await run(threadEnvironment.setInteractionMode, {
        environmentId,
        input: { threadId, interactionMode: sendSettings.interactionMode, createdAt },
      });
    }

    // Stop hands a preparing message back to the composer. Past this point
    // the send can no longer be taken back.
    const thread = readThreadStructure(threadRef) ?? undefined;
    if (!queue.markDispatching(threadKey, message.id, createLocalDispatchSnapshot(thread))) return;
    await run(threadEnvironment.startTurn, {
      environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text, attachments },
        modelSelection: sendSettings.modelSelection,
        runtimeMode: sendSettings.runtimeMode,
        interactionMode: sendSettings.interactionMode,
        createdAt,
      },
    });
    queue.finishSend(threadKey, message.id);
    for (const image of message.images) revokeBlobPreviewUrl(image.previewUrl);
  } catch (error) {
    if (!queue.failSend(threadKey, message.id)) return;
    const title = readThreadShell(threadRef)?.title;
    toastManager.add({
      type: "error",
      title: title ? `Queued message not sent in "${title}"` : "Queued message not sent",
      description: error instanceof Error ? error.message : "Use Send now to try again.",
    });
  }
}
