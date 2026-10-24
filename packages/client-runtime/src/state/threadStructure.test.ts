import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationMessage,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import type { EnvironmentThread, EnvironmentThreadShell } from "./models.ts";
import {
  createEnvironmentThreadStructureAtoms,
  createThreadShellStructureSelector,
  createThreadStructureSelector,
} from "./threadStructure.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const THREAD_ID = ThreadId.make("thread-1");
const TURN_ID = TurnId.make("turn-1");
const REF = { environmentId: ENVIRONMENT_ID, threadId: THREAD_ID };

const userMessage: OrchestrationMessage = {
  id: MessageId.make("user-1"),
  role: "user",
  text: "Explain the change",
  turnId: TURN_ID,
  streaming: false,
  createdAt: "2026-04-01T00:00:01.000Z",
  updatedAt: "2026-04-01T00:00:01.000Z",
};
const reply: OrchestrationMessage = {
  id: MessageId.make("assistant-1"),
  role: "assistant",
  text: "It",
  turnId: TURN_ID,
  streaming: true,
  createdAt: "2026-04-01T00:00:02.000Z",
  updatedAt: "2026-04-01T00:00:02.000Z",
};

const thread: EnvironmentThread = {
  environmentId: ENVIRONMENT_ID,
  id: THREAD_ID,
  projectId: ProjectId.make("project-1"),
  title: "Streaming thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "ModelA" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "main",
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:02.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [userMessage, reply],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};

// What the reducer does with a streamed delta: the reply gains text, the
// thread gains a new `updatedAt`, every other message keeps its reference.
function streamDelta(source: EnvironmentThread, delta: string, at: string): EnvironmentThread {
  return {
    ...source,
    updatedAt: at,
    messages: source.messages.map((message) =>
      message.id === reply.id ? { ...message, text: `${message.text}${delta}` } : message,
    ),
  };
}

describe("createThreadStructureSelector", () => {
  it("holds the same structure while a reply streams", () => {
    const select = createThreadStructureSelector();
    const structure = select(thread);
    const afterDelta = streamDelta(thread, " changed", "2026-04-01T00:00:03.000Z");

    expect(select(afterDelta)).toBe(structure);
    expect(select(streamDelta(afterDelta, " things", "2026-04-01T00:00:04.000Z"))).toBe(structure);
  });

  it("holds the same structure while a thinking trace streams", () => {
    const trace: OrchestrationMessage = {
      ...reply,
      id: MessageId.make("reasoning:turn-1"),
      role: "reasoning",
      text: "Weighing",
    };
    const withTrace = { ...thread, messages: [userMessage, trace] };
    const select = createThreadStructureSelector();
    const structure = select(withTrace);
    const afterChunk: EnvironmentThread = {
      ...withTrace,
      updatedAt: "2026-04-01T00:00:03.000Z",
      messages: [userMessage, { ...trace, text: "Weighing the options.\n\n" }],
    };

    expect(select(afterChunk)).toBe(structure);
    expect(structure?.messages[1]).not.toHaveProperty("text");
  });

  it("drops streamed text and stamps, and keeps user text", () => {
    const structure = createThreadStructureSelector()(thread)!;
    const [user, assistant] = structure.messages;

    expect(structure).not.toHaveProperty("updatedAt");
    expect(assistant).not.toHaveProperty("text");
    expect(assistant).not.toHaveProperty("updatedAt");
    expect(assistant).toMatchObject({ id: reply.id, streaming: true, turnId: TURN_ID });
    expect(user).toBe(userMessage);
  });

  it("follows every change that is not streamed text", () => {
    const select = createThreadStructureSelector();
    const structure = select(thread)!;

    const finished = select({
      ...thread,
      messages: [userMessage, { ...reply, text: "It works.", streaming: false }],
    })!;
    expect(finished).not.toBe(structure);
    expect(finished.messages[1]).toMatchObject({ streaming: false });

    const nextReply = { ...reply, id: MessageId.make("assistant-2") };
    expect(select({ ...thread, messages: [userMessage, reply, nextReply] })).not.toBe(finished);

    const renamed = select({ ...thread, title: "Renamed" });
    expect(renamed?.title).toBe("Renamed");

    const running = select({
      ...thread,
      title: "Renamed",
      session: {
        threadId: THREAD_ID,
        status: "running",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: TURN_ID,
        lastError: null,
        updatedAt: "2026-04-01T00:00:05.000Z",
      },
    });
    expect(running).not.toBe(renamed);
    expect(running?.session?.status).toBe("running");
  });

  it("keeps the messages array when only other fields change", () => {
    const select = createThreadStructureSelector();
    const structure = select(thread)!;
    const renamed = select(
      streamDelta({ ...thread, title: "Renamed" }, " more", "2026-04-01T00:00:06.000Z"),
    )!;

    expect(renamed).not.toBe(structure);
    expect(renamed.messages).toBe(structure.messages);
  });

  it("reuses unchanged messages when the list changes", () => {
    const select = createThreadStructureSelector();
    const structure = select(thread)!;
    const appended = select({
      ...thread,
      messages: [...thread.messages, { ...userMessage, id: MessageId.make("user-2") }],
    })!;

    expect(appended.messages[0]).toBe(structure.messages[0]);
    expect(appended.messages[1]).toBe(structure.messages[1]);
  });
});

describe("createThreadShellStructureSelector", () => {
  const shell: EnvironmentThreadShell = {
    environmentId: ENVIRONMENT_ID,
    id: THREAD_ID,
    projectId: ProjectId.make("project-1"),
    title: "Streaming thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "ModelA" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:02.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: "2026-04-01T00:00:01.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };

  it("holds through a decoded copy that only moves updatedAt", () => {
    const select = createThreadShellStructureSelector();
    const structure = select(shell);
    const upserted = structuredClone({ ...shell, updatedAt: "2026-04-01T00:00:09.000Z" });

    expect(select(upserted)).toBe(structure);
    expect(structure).not.toHaveProperty("updatedAt");
  });

  it("follows a real change", () => {
    const select = createThreadShellStructureSelector();
    const structure = select(shell);

    expect(select({ ...shell, hasPendingApprovals: true })).not.toBe(structure);
  });
});

describe("createEnvironmentThreadStructureAtoms", () => {
  const setup = (initialShell: EnvironmentThreadShell | null) => {
    const detailAtom = Atom.make<EnvironmentThread | null>(thread);
    const shellAtom = Atom.make<EnvironmentThreadShell | null>(initialShell);
    let detailReads = 0;
    const atoms = createEnvironmentThreadStructureAtoms({
      detailAtom: () => {
        detailReads += 1;
        return detailAtom;
      },
      threadShellAtom: () => shellAtom,
    });
    return { atoms, detailAtom, shellAtom, detailReads: () => detailReads };
  };

  it("does not notify subscribers of a streamed delta", () => {
    const { atoms, detailAtom } = setup(null);
    const registry = AtomRegistry.make();
    const structureAtom = atoms.structureAtom(REF);
    const updatedAtAtom = atoms.updatedAtAtom(REF);
    let structureNotifications = 0;
    let updatedAtNotifications = 0;
    registry.subscribe(structureAtom, () => {
      structureNotifications += 1;
    });
    registry.subscribe(updatedAtAtom, () => {
      updatedAtNotifications += 1;
    });
    const before = registry.get(structureAtom);
    registry.get(updatedAtAtom);
    // Computing the first values notifies; only later changes count.
    structureNotifications = 0;
    updatedAtNotifications = 0;

    registry.set(detailAtom, streamDelta(thread, " changed", "2026-04-01T00:00:03.000Z"));

    expect(registry.get(structureAtom)).toBe(before);
    expect(structureNotifications).toBe(0);
    expect(registry.get(updatedAtAtom)).toBe("2026-04-01T00:00:03.000Z");
    expect(updatedAtNotifications).toBe(1);

    registry.set(detailAtom, {
      ...thread,
      messages: [...thread.messages, { ...userMessage, id: MessageId.make("user-2") }],
    });
    expect(structureNotifications).toBe(1);
    expect(registry.get(structureAtom)?.messages).toHaveLength(3);
  });

  it("leaves the detail unread until the shell exists when waiting for it", () => {
    const { atoms, detailReads } = setup(null);
    const registry = AtomRegistry.make();

    expect(registry.get(atoms.structureAtom(REF, { waitForShell: true }))).toBeNull();
    expect(detailReads()).toBe(0);
  });
});
