import type { OrchestrationMessage, ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { parseThreadKey, threadKey } from "./entities.ts";
import type {
  EnvironmentThread,
  EnvironmentThreadShell,
  ThreadShellStructure,
  ThreadStructure,
  ThreadStructureMessage,
} from "./models.ts";
import { mergeEnvironmentThread } from "./threadDetail.ts";

type Fields = { readonly [key: string]: unknown };

// A streamed reply rewrites these on its assistant message with every delta.
// The comparison skips them and the structure drops them, from this one list.
const STREAMED_MESSAGE_FIELDS: ReadonlySet<string> = new Set(["text", "updatedAt"]);
// Every thread event restamps the thread's and the shell's `updatedAt`.
const STAMP_FIELDS: ReadonlySet<string> = new Set(["updatedAt"]);
const THREAD_FIELDS_COMPARED_APART: ReadonlySet<string> = new Set(["updatedAt", "messages"]);
const NO_FIELDS: ReadonlySet<string> = new Set();

/** Equality over decoded wire values: primitives, arrays, and plain objects. */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!sameValue(left[index], right[index])) return false;
    }
    return true;
  }
  return sameFields(left, right, NO_FIELDS);
}

function sameFields(left: object, right: object, ignored: ReadonlySet<string>): boolean {
  const leftFields = left as Fields;
  const rightFields = right as Fields;
  let leftCount = 0;
  for (const key in leftFields) {
    if (!Object.hasOwn(leftFields, key) || ignored.has(key)) continue;
    leftCount += 1;
    if (!Object.hasOwn(rightFields, key) || !sameValue(leftFields[key], rightFields[key])) {
      return false;
    }
  }
  let rightCount = 0;
  for (const key in rightFields) {
    if (Object.hasOwn(rightFields, key) && !ignored.has(key)) rightCount += 1;
  }
  return leftCount === rightCount;
}

function streamedFields(message: OrchestrationMessage): ReadonlySet<string> {
  return message.role === "assistant" ? STREAMED_MESSAGE_FIELDS : NO_FIELDS;
}

function sameMessageStructures(
  left: ReadonlyArray<OrchestrationMessage>,
  right: ReadonlyArray<OrchestrationMessage>,
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const previous = left[index]!;
    const next = right[index]!;
    if (previous === next) continue;
    if (previous.role !== next.role || !sameFields(previous, next, streamedFields(next))) {
      return false;
    }
  }
  return true;
}

function withoutFields(value: object, fields: ReadonlySet<string>): Fields {
  const source = value as Fields;
  const result: Record<string, unknown> = {};
  for (const key in source) {
    if (Object.hasOwn(source, key) && !fields.has(key)) result[key] = source[key];
  }
  return result;
}

// Each message is stripped once, so a rebuilt structure reuses the stripped
// objects of messages that did not change.
const messageStructures = new WeakMap<OrchestrationMessage, ThreadStructureMessage>();

function toMessageStructure(message: OrchestrationMessage): ThreadStructureMessage {
  if (message.role !== "assistant") return message;
  let structure = messageStructures.get(message);
  if (structure === undefined) {
    structure = withoutFields(message, STREAMED_MESSAGE_FIELDS) as ThreadStructureMessage;
    messageStructures.set(message, structure);
  }
  return structure;
}

/**
 * Follows a live thread, returning the previous {@link ThreadStructure} while
 * the thread only differs in streamed assistant text or its `updatedAt`. A new
 * structure is built only when something else changes, and it keeps the
 * previous `messages` array when the messages themselves did not change.
 */
export function createThreadStructureSelector(): (
  thread: EnvironmentThread | null,
) => ThreadStructure | null {
  let previousThread: EnvironmentThread | null = null;
  let previousStructure: ThreadStructure | null = null;
  return (thread) => {
    if (thread === null) {
      previousThread = null;
      previousStructure = null;
      return null;
    }
    const previous = previousThread;
    previousThread = thread;
    if (previous === thread && previousStructure !== null) return previousStructure;
    const sameMessages =
      previous !== null && sameMessageStructures(previous.messages, thread.messages);
    if (
      previous !== null &&
      previousStructure !== null &&
      sameMessages &&
      sameFields(previous, thread, THREAD_FIELDS_COMPARED_APART)
    ) {
      return previousStructure;
    }
    const { updatedAt: _updatedAt, messages, ...fields } = thread;
    previousStructure = {
      ...fields,
      messages:
        sameMessages && previousStructure !== null
          ? previousStructure.messages
          : messages.map(toMessageStructure),
    };
    return previousStructure;
  };
}

/** Follows a live thread shell, returning the previous structure while only `updatedAt` moves. */
export function createThreadShellStructureSelector(): (
  shell: EnvironmentThreadShell | null,
) => ThreadShellStructure | null {
  let previousShell: EnvironmentThreadShell | null = null;
  let previousStructure: ThreadShellStructure | null = null;
  return (shell) => {
    if (shell === null) {
      previousShell = null;
      previousStructure = null;
      return null;
    }
    const previous = previousShell;
    previousShell = shell;
    if (
      previous !== null &&
      previousStructure !== null &&
      (previous === shell || sameFields(previous, shell, STAMP_FIELDS))
    ) {
      return previousStructure;
    }
    const { updatedAt: _updatedAt, ...structure } = shell;
    previousStructure = structure;
    return structure;
  };
}

interface ThreadReadOptions {
  /**
   * Client-reserved draft thread ids do not exist on the server until the
   * first send, so the detail is not subscribed until the shell appears.
   */
  readonly waitForShell?: boolean;
}

/**
 * Atoms for views that must not re-render per streamed delta. The structure
 * atoms hold still through streamed text and `updatedAt` stamps; `updatedAt`
 * is read on its own, by whatever needs it, through `updatedAtAtom`.
 */
export function createEnvironmentThreadStructureAtoms(input: {
  readonly detailAtom: (ref: ScopedThreadRef) => Atom.Atom<EnvironmentThread | null>;
  readonly threadShellAtom: (ref: ScopedThreadRef) => Atom.Atom<EnvironmentThreadShell | null>;
}) {
  const readThread = (
    get: Atom.AtomContext,
    ref: ScopedThreadRef,
    waitForShell: boolean,
  ): EnvironmentThread | null => {
    const shell = get(input.threadShellAtom(ref));
    if (waitForShell && shell === null) return null;
    return mergeEnvironmentThread(get(input.detailAtom(ref)), shell);
  };
  // Keys are the thread key behind one flag character for `waitForShell`.
  const optionsKey = (ref: ScopedThreadRef, options: ThreadReadOptions | undefined) =>
    `${options?.waitForShell === true ? "w" : "-"}${threadKey(ref)}`;

  const structureFamily = Atom.family((key: string) => {
    const ref = parseThreadKey(key.slice(1));
    const waitForShell = key.startsWith("w");
    const select = createThreadStructureSelector();
    return Atom.make((get) => select(readThread(get, ref, waitForShell))).pipe(
      Atom.setIdleTTL(0),
      Atom.withLabel(`environment-thread-structure:${key}`),
    );
  });

  const updatedAtFamily = Atom.family((key: string) => {
    const ref = parseThreadKey(key.slice(1));
    const waitForShell = key.startsWith("w");
    return Atom.make((get) => readThread(get, ref, waitForShell)?.updatedAt ?? null).pipe(
      Atom.setIdleTTL(0),
      Atom.withLabel(`environment-thread-updated-at:${key}`),
    );
  });

  const shellStructureFamily = Atom.family((key: string) => {
    const ref = parseThreadKey(key);
    const select = createThreadShellStructureSelector();
    return Atom.make((get) => select(get(input.threadShellAtom(ref)))).pipe(
      Atom.setIdleTTL(0),
      Atom.withLabel(`environment-thread-shell-structure:${key}`),
    );
  });

  return {
    structureAtom: (ref: ScopedThreadRef, options?: ThreadReadOptions) =>
      structureFamily(optionsKey(ref, options)),
    updatedAtAtom: (ref: ScopedThreadRef, options?: ThreadReadOptions) =>
      updatedAtFamily(optionsKey(ref, options)),
    shellStructureAtom: (ref: ScopedThreadRef) => shellStructureFamily(threadKey(ref)),
  };
}
