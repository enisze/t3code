import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const READY_AT = "1969-12-30T00:00:00.000Z";

function makeReadModel(input: {
  readonly readyAt?: string | null;
  readonly archivedAt?: string | null;
}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: input.archivedAt ?? null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        pinOrderKey: null,
        readyAt: input.readyAt ?? null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: NOW,
  };
}

it.layer(NodeServices.layer)("ready-marked thread decider", (it) => {
  it.effect("marks a thread ready, stamping readyAt and updatedAt together", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.mark-ready",
          commandId: CommandId.make("cmd-mark-ready"),
          threadId: ThreadId.make("thread-1"),
        },
        readModel: makeReadModel({}),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("thread.ready-marked");
      if (events[0]?.type === "thread.ready-marked") {
        expect(events[0].payload.readyAt).toBe(events[0].payload.updatedAt);
        expect(events[0].payload.readyAt).not.toBe(NOW);
      }
    }),
  );

  it.effect("re-marking preserves the original readyAt and updatedAt", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.mark-ready",
          commandId: CommandId.make("cmd-mark-ready-again"),
          threadId: ThreadId.make("thread-1"),
        },
        readModel: makeReadModel({ readyAt: READY_AT }),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events[0]?.type).toBe("thread.ready-marked");
      if (events[0]?.type === "thread.ready-marked") {
        expect(events[0].payload.readyAt).toBe(READY_AT);
        expect(events[0].payload.updatedAt).toBe(NOW);
      }
    }),
  );

  it.effect("clearing a marked thread stamps a fresh updatedAt", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.clear-ready",
          commandId: CommandId.make("cmd-clear-ready"),
          threadId: ThreadId.make("thread-1"),
        },
        readModel: makeReadModel({ readyAt: READY_AT }),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events[0]?.type).toBe("thread.ready-cleared");
      if (events[0]?.type === "thread.ready-cleared") {
        expect(events[0].payload.updatedAt).not.toBe(NOW);
      }
    }),
  );

  it.effect("clearing an unmarked thread preserves updatedAt", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.clear-ready",
          commandId: CommandId.make("cmd-clear-ready-noop"),
          threadId: ThreadId.make("thread-1"),
        },
        readModel: makeReadModel({}),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events[0]?.type).toBe("thread.ready-cleared");
      if (events[0]?.type === "thread.ready-cleared") {
        expect(events[0].payload.updatedAt).toBe(NOW);
      }
    }),
  );

  it.effect("rejects marking an archived thread ready", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.mark-ready",
          commandId: CommandId.make("cmd-mark-ready-archived"),
          threadId: ThreadId.make("thread-1"),
        },
        readModel: makeReadModel({ archivedAt: NOW }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("starting a turn leaves the ready mark alone", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: MessageId.make("message-1"),
            role: "user",
            text: "Continue",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: NOW,
        },
        readModel: makeReadModel({ readyAt: READY_AT }),
      });
      const events = Array.isArray(result) ? result : [result];
      // The mark is the user's to clear: only thread.clear-ready removes it.
      expect(events.some((entry) => entry.type === "thread.ready-cleared")).toBe(false);
    }),
  );

  it.effect("starting a turn on an unmarked thread emits no ready event", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start-unmarked"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: MessageId.make("message-2"),
            role: "user",
            text: "Continue",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: NOW,
        },
        readModel: makeReadModel({}),
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events.some((entry) => entry.type === "thread.ready-cleared")).toBe(false);
    }),
  );
});
