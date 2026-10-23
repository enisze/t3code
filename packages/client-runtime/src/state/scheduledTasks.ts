import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createScheduledTaskEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:scheduled-tasks:list",
    tag: WS_METHODS.scheduledTasksList,
    refreshIntervalMs: 15_000,
    idleTtlMs: 0,
  });
  const history = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:scheduled-tasks:history",
    tag: WS_METHODS.scheduledTasksHistory,
    refreshIntervalMs: 15_000,
    idleTtlMs: 0,
  });
  const refresh = (
    { environmentId }: { readonly environmentId: EnvironmentId },
    registry: AtomRegistry.AtomRegistry,
  ) => Effect.sync(() => registry.refresh(list({ environmentId, input: {} })));
  return {
    list,
    history,
    save: createEnvironmentRpcCommand(runtime, {
      label: "scheduled-tasks:save",
      tag: WS_METHODS.scheduledTasksSave,
      onSuccess: refresh,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "scheduled-tasks:delete",
      tag: WS_METHODS.scheduledTasksDelete,
      onSuccess: refresh,
    }),
    setEnabled: createEnvironmentRpcCommand(runtime, {
      label: "scheduled-tasks:set-enabled",
      tag: WS_METHODS.scheduledTasksSetEnabled,
      onSuccess: refresh,
    }),
    runNow: createEnvironmentRpcCommand(runtime, {
      label: "scheduled-tasks:run-now",
      tag: WS_METHODS.scheduledTasksRunNow,
      onSuccess: (target, registry) =>
        Effect.sync(() => {
          registry.refresh(list({ environmentId: target.environmentId, input: {} }));
          registry.refresh(history(target));
        }),
    }),
    rotateWebhook: createEnvironmentRpcCommand(runtime, {
      label: "scheduled-tasks:rotate-webhook",
      tag: WS_METHODS.scheduledTasksRotateWebhook,
      onSuccess: refresh,
    }),
  };
}
