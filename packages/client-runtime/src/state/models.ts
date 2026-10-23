import type {
  EnvironmentId,
  OrchestrationMessage,
  OrchestrationProjectShell,
  OrchestrationThread,
  OrchestrationThreadShell,
} from "@t3tools/contracts";

export interface EnvironmentProject extends OrchestrationProjectShell {
  readonly environmentId: EnvironmentId;
}

export interface EnvironmentThreadShell extends OrchestrationThreadShell {
  readonly environmentId: EnvironmentId;
}

export type EnvironmentMessage = OrchestrationMessage;

export interface EnvironmentThread extends OrchestrationThread {
  readonly environmentId: EnvironmentId;
}

/**
 * A message as a {@link ThreadStructure} carries it. Assistant messages have no
 * `text` or `updatedAt`, the fields a streamed reply rewrites, so a reader of
 * the structure cannot show text that went stale while the reply streams.
 */
export type ThreadStructureMessage =
  | (Omit<OrchestrationMessage, "role" | "text" | "updatedAt"> & { readonly role: "assistant" })
  | (OrchestrationMessage & { readonly role: Exclude<OrchestrationMessage["role"], "assistant"> });

/**
 * A thread without what changes while a reply streams: assistant text and the
 * thread's `updatedAt`. It stays the same object through those changes and
 * follows every other one, so views that only need the thread's shape (runs,
 * requests, plans, user messages) do not re-render once per streamed delta.
 */
export interface ThreadStructure extends Omit<EnvironmentThread, "messages" | "updatedAt"> {
  readonly messages: ReadonlyArray<ThreadStructureMessage>;
}

/** A thread shell without the `updatedAt` every thread event restamps. */
export type ThreadShellStructure = Omit<EnvironmentThreadShell, "updatedAt">;

export function scopeProject(
  environmentId: EnvironmentId,
  project: OrchestrationProjectShell,
): EnvironmentProject {
  return { ...project, environmentId };
}

export function scopeThreadShell(
  environmentId: EnvironmentId,
  thread: OrchestrationThreadShell,
): EnvironmentThreadShell {
  return { ...thread, environmentId };
}

export function scopeThread(
  environmentId: EnvironmentId,
  thread: OrchestrationThread,
): EnvironmentThread {
  return { ...thread, environmentId };
}
