import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
  ThreadShellStructure,
  ThreadStructure,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentThreadStatus } from "@t3tools/client-runtime/state/threads";
import type { ScopedProjectRef, ScopedThreadRef, ServerConfig } from "@t3tools/contracts";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentProjects } from "./projects";
import { environmentServerConfigsAtom } from "./server";
import {
  allEnvironmentProjectSnapshotsReadyAtom,
  allEnvironmentShellsBootstrappedAtom,
} from "./shell";
import {
  environmentThreadDetails,
  environmentThreadShells,
  environmentThreadStructures,
} from "./threads";

import type { OrchestrationMessage, OrchestrationProposedPlan } from "@t3tools/contracts";

const EMPTY_PROPOSED_PLANS: ReadonlyArray<OrchestrationProposedPlan> = Object.freeze([]);
const EMPTY_MESSAGES: ReadonlyArray<OrchestrationMessage> = Object.freeze([]);
const EMPTY_THREAD_REFS: ReadonlyArray<ScopedThreadRef> = Object.freeze([]);

const EMPTY_PROJECT_ATOM = Atom.make<EnvironmentProject | null>(null).pipe(
  Atom.withLabel("web-project:empty"),
);
const EMPTY_THREAD_REFS_ATOM = Atom.make(EMPTY_THREAD_REFS).pipe(
  Atom.withLabel("web-thread-refs:empty"),
);
const EMPTY_THREAD_SHELL_ATOM = Atom.make<EnvironmentThreadShell | null>(null).pipe(
  Atom.withLabel("web-thread-shell:empty"),
);
const EMPTY_THREAD_MESSAGES_ATOM = Atom.make(EMPTY_MESSAGES).pipe(
  Atom.withLabel("web-thread-messages:empty"),
);
const EMPTY_THREAD_STRUCTURE_ATOM = Atom.make<ThreadStructure | null>(null).pipe(
  Atom.withLabel("web-thread-structure:empty"),
);
const EMPTY_THREAD_SHELL_STRUCTURE_ATOM = Atom.make<ThreadShellStructure | null>(null).pipe(
  Atom.withLabel("web-thread-shell-structure:empty"),
);
const EMPTY_THREAD_UPDATED_AT_ATOM = Atom.make<string | null>(null).pipe(
  Atom.withLabel("web-thread-updated-at:empty"),
);
const EMPTY_THREAD_STATUS_ATOM = Atom.make<EnvironmentThreadStatus>("empty").pipe(
  Atom.withLabel("web-thread-status:empty"),
);
const EMPTY_THREAD_ERROR_ATOM = Atom.make<string | null>(null).pipe(
  Atom.withLabel("web-thread-error:empty"),
);

const activeEnvironmentIdAtom = Atom.make<EnvironmentId | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-active-environment-id"),
);

export function useActiveEnvironmentId(): EnvironmentId | null {
  return useAtomValue(activeEnvironmentIdAtom);
}

export function setActiveEnvironmentId(environmentId: EnvironmentId | null): void {
  appAtomRegistry.set(activeEnvironmentIdAtom, environmentId);
}

export function useThreadRefs(): ReadonlyArray<ScopedThreadRef> {
  return useAtomValue(environmentThreadShells.threadRefsAtom);
}

export function useEnvironmentThreadRefs(
  environmentId: EnvironmentId | null,
): ReadonlyArray<ScopedThreadRef> {
  return useAtomValue(
    environmentId === null
      ? EMPTY_THREAD_REFS_ATOM
      : environmentThreadShells.environmentThreadRefsAtom(environmentId),
  );
}

export function useProjects(): ReadonlyArray<EnvironmentProject> {
  return useAtomValue(environmentProjects.projectsAtom);
}

export function useServerConfigs(): ReadonlyMap<EnvironmentId, ServerConfig> {
  return useAtomValue(environmentServerConfigsAtom);
}

export function useThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  return useAtomValue(environmentThreadShells.threadShellsAtom);
}

export function useAllEnvironmentShellsBootstrapped(): boolean {
  return useAtomValue(allEnvironmentShellsBootstrappedAtom);
}

export function useAllEnvironmentProjectSnapshotsReady(): boolean {
  return useAtomValue(allEnvironmentProjectSnapshotsReadyAtom);
}

export function useThreadShellsForProjectRefs(
  refs: ReadonlyArray<ScopedProjectRef>,
): ReadonlyArray<EnvironmentThreadShell> {
  return useAtomValue(environmentThreadShells.threadShellsForProjectRefsAtom(refs));
}

export function useProject(ref: ScopedProjectRef | null): EnvironmentProject | null {
  return useAtomValue(ref === null ? EMPTY_PROJECT_ATOM : environmentProjects.projectAtom(ref));
}

export function useThreadShell(ref: ScopedThreadRef | null): EnvironmentThreadShell | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_SHELL_ATOM : environmentThreadShells.threadShellAtom(ref),
  );
}

export function useThreadStatus(ref: ScopedThreadRef | null): EnvironmentThreadStatus {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_STATUS_ATOM : environmentThreadDetails.statusAtom(ref),
  );
}

/**
 * The thread subscription's retained load diagnostic. Non-null means the load
 * terminated: the status alone cannot distinguish that from a load still in
 * flight, so consumers rendering progress must read this too.
 */
export function useThreadError(ref: ScopedThreadRef | null): string | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_ERROR_ATOM : environmentThreadDetails.errorAtom(ref),
  );
}

/**
 * A thread's detail merged with its shell's metadata, without assistant text
 * and `updatedAt` (see `ThreadStructure`), so its readers do not re-render
 * while a reply streams. `waitForShell` leaves a reserved draft thread's
 * detail unsubscribed until the thread enters the shell index.
 */
export function useThreadStructure(
  ref: ScopedThreadRef | null,
  options?: { waitForShell?: boolean },
): ThreadStructure | null {
  return useAtomValue(
    ref === null
      ? EMPTY_THREAD_STRUCTURE_ATOM
      : environmentThreadStructures.structureAtom(ref, options),
  );
}

/** A thread's live messages. Assistant text changes with every streamed delta. */
export function useThreadMessages(
  ref: ScopedThreadRef | null,
): ReadonlyArray<OrchestrationMessage> {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_MESSAGES_ATOM : environmentThreadDetails.messagesAtom(ref),
  );
}

/** `useThreadShell` without the `updatedAt` every thread event restamps. */
export function useThreadShellStructure(ref: ScopedThreadRef | null): ThreadShellStructure | null {
  return useAtomValue(
    ref === null
      ? EMPTY_THREAD_SHELL_STRUCTURE_ATOM
      : environmentThreadStructures.shellStructureAtom(ref),
  );
}

/** The `updatedAt` of the thread `useThreadStructure` reads. It changes with every thread event. */
export function useThreadUpdatedAt(
  ref: ScopedThreadRef | null,
  options?: { waitForShell?: boolean },
): string | null {
  return useAtomValue(
    ref === null
      ? EMPTY_THREAD_UPDATED_AT_ATOM
      : environmentThreadStructures.updatedAtAtom(ref, options),
  );
}

export function readProject(ref: ScopedProjectRef): EnvironmentProject | null {
  return appAtomRegistry.get(environmentProjects.projectAtom(ref));
}

export function readProjects(): ReadonlyArray<EnvironmentProject> {
  return appAtomRegistry.get(environmentProjects.projectsAtom);
}

/** Resolves when the project event reaches the live client store. */
export function waitForProject(
  ref: ScopedProjectRef,
  timeoutMs = 10_000,
): Promise<EnvironmentProject> {
  const current = readProject(ref);
  if (current !== null) return Promise.resolve(current);

  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    const timeout = setTimeout(() => {
      unsubscribe?.();
      reject(new Error("The project did not appear in the desktop app."));
    }, timeoutMs);
    const finish = (project: EnvironmentProject | null) => {
      if (project === null) return;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(project);
    };
    unsubscribe = appAtomRegistry.subscribe(environmentProjects.projectAtom(ref), finish);
    finish(readProject(ref));
  });
}

export function readThreadShellsForProjectRefs(
  refs: ReadonlyArray<ScopedProjectRef>,
): ReadonlyArray<EnvironmentThreadShell> {
  return appAtomRegistry.get(environmentThreadShells.threadShellsForProjectRefsAtom(refs));
}

/** The thread `useThreadStructure` reads, read outside React. */
export function readThreadStructure(ref: ScopedThreadRef): ThreadStructure | null {
  return appAtomRegistry.get(environmentThreadStructures.structureAtom(ref));
}

export function readThreadShell(ref: ScopedThreadRef): EnvironmentThreadShell | null {
  return appAtomRegistry.get(environmentThreadShells.threadShellAtom(ref));
}

/**
 * Resolves when the thread is active in the live client store. An archived
 * thread is absent from it, and only returns once the shell stream delivers
 * its unarchive, so wait for this before routing to a just-unarchived thread.
 */
export function waitForThreadShell(
  ref: ScopedThreadRef,
  timeoutMs = 10_000,
): Promise<EnvironmentThreadShell> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    const timeout = setTimeout(() => {
      unsubscribe?.();
      reject(new Error("The chat did not load."));
    }, timeoutMs);
    const finish = (shell: EnvironmentThreadShell | null) => {
      if (shell === null || shell.archivedAt !== null) return;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(shell);
    };
    unsubscribe = appAtomRegistry.subscribe(environmentThreadShells.threadShellAtom(ref), finish);
    finish(readThreadShell(ref));
  });
}

/** Whether the environment's server understands thread.settle/unsettle.
    False for pre-settlement servers (capability defaults false on decode),
    so clients under version skew fall back instead of erroring. */
export function readEnvironmentSupportsSettlement(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadSettlement === true
  );
}

/** Whether the environment's server understands thread.snooze/unsnooze.
    Same version-skew contract as settlement. */
export function readEnvironmentSupportsSnooze(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadSnooze === true
  );
}

/** Whether the environment's server understands thread.pin/unpin.
    Same version-skew contract as settlement. */
export function readEnvironmentSupportsPinning(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadPinning === true
  );
}

/** Whether the environment's server understands thread title regeneration.
    Same version-skew contract as settlement. */
export function readEnvironmentSupportsTitleRegeneration(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadTitleRegeneration === true
  );
}

/** Whether the environment's server understands thread.pin.reorder (and
    orderKey on thread.pin). Same version-skew contract as settlement. */
export function readEnvironmentSupportsPinReorder(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadPinReorder === true
  );
}

export function readEnvironmentThreadRefs(
  environmentId: EnvironmentId,
): ReadonlyArray<ScopedThreadRef> {
  return appAtomRegistry.get(environmentThreadShells.environmentThreadRefsAtom(environmentId));
}

export function readThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  return appAtomRegistry.get(environmentThreadShells.threadShellsAtom);
}

export function readThreadRefs(): ReadonlyArray<ScopedThreadRef> {
  return appAtomRegistry.get(environmentThreadShells.threadRefsAtom);
}

export function useThreadProposedPlans(
  ref: ScopedThreadRef | null,
): ReadonlyArray<OrchestrationProposedPlan> {
  return useAtomValue(
    ref === null ? EMPTY_PROPOSED_PLANS_ATOM : environmentThreadDetails.proposedPlansAtom(ref),
  );
}

const EMPTY_PROPOSED_PLANS_ATOM = Atom.make(EMPTY_PROPOSED_PLANS).pipe(
  Atom.withLabel("web-thread-proposed-plans:empty"),
);
