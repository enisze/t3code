import { useMemo } from "react";

import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";

import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  getDefaultProviderInstanceModel,
  isProviderInstancePickerVisible,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../providerInstances";
import { useProject } from "../state/entities";
import { environmentServerConfigsAtom } from "../state/server";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";

// Sentinel routing value for "no pinned account": the composer falls back to
// the first available provider instance for the environment. Kept out of the
// `ProviderInstanceId` space so it can never collide with a real instance id.
const USE_DEFAULT_VALUE = "__t3_project_default__";

/**
 * Per-project "default agent" control. Picks which configured provider
 * instance (i.e. which account/subscription — e.g. two separate Claude
 * logins) new threads in a project start on, plus that instance's model.
 *
 * The selection is written to the project's `defaultModelSelection`; the chat
 * composer already resolves a new thread's provider from the project default
 * when the draft doesn't override it, so pinning an account here routes every
 * fresh thread in the project to that account's credentials.
 *
 * Provider instances are read per-environment: a project's account choices are
 * exactly the accounts configured on the server that hosts it.
 */
export function ProjectDefaultAgentField(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  onChange: (selection: ModelSelection | null) => void;
  kind?: "chat" | "review";
  disabled?: boolean;
  idPrefix: string;
}) {
  const { environmentId, projectId, onChange, kind = "chat", disabled, idPrefix } = props;
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  // Read the selection live so the control reflects the persisted value even
  // when the enclosing dialog renders from a captured project snapshot.
  const project = useProject(projectRef);
  const value =
    kind === "review"
      ? (project?.reviewModelSelection ?? null)
      : (project?.defaultModelSelection ?? null);
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const config = serverConfigs.get(environmentId) ?? null;

  const entries = useMemo(() => {
    const providers = config?.providers ?? [];
    const settings = config?.settings;
    const derived = deriveProviderInstanceEntries(providers);
    const withSettings = settings ? applyProviderInstanceSettings(derived, settings) : derived;
    return sortProviderInstanceEntries(withSettings).filter(isProviderInstancePickerVisible);
  }, [config?.providers, config?.settings]);

  const providers = config?.providers ?? [];

  const selectedInstanceId = value?.instanceId ?? null;
  const selectedEntry: ProviderInstanceEntry | undefined = selectedInstanceId
    ? entries.find((entry) => entry.instanceId === selectedInstanceId)
    : undefined;

  // A pinned instance that has since been removed/disabled still shows so the
  // user can see (and clear) the stale pin instead of it silently vanishing.
  const showStalePin = selectedInstanceId !== null && selectedEntry === undefined;

  const handleAccountChange = (next: string | null) => {
    if (next === null || next === USE_DEFAULT_VALUE) {
      onChange(null);
      return;
    }
    const instanceId = next as ProviderInstanceId;
    // Keep the model when re-selecting the same instance; otherwise reset to
    // that instance's default so we never persist a cross-account model pair.
    const model =
      value?.instanceId === instanceId
        ? value.model
        : getDefaultProviderInstanceModel(providers, instanceId);
    if (!model) {
      // Instance reports no models yet (probe pending); pinning it now would
      // produce an invalid selection, so leave the project on its default.
      onChange(null);
      return;
    }
    onChange({ instanceId, model });
  };

  const handleModelChange = (slug: string | null) => {
    if (!selectedInstanceId || slug === null) return;
    onChange({ instanceId: selectedInstanceId, model: slug });
  };

  const models = selectedEntry?.models ?? [];
  const accountSelectValue = selectedInstanceId ?? USE_DEFAULT_VALUE;
  const defaultAccountLabel = kind === "review" ? "Use chat model" : "Use default account";
  const fieldLabel = kind === "review" ? "Review" : "Chat";

  return (
    <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
      <label className="grid min-w-0 gap-1.5" htmlFor={`${idPrefix}-account`}>
        <span className="font-medium text-foreground">{fieldLabel} agent</span>
        <Select value={accountSelectValue} onValueChange={handleAccountChange} disabled={disabled}>
          <SelectTrigger id={`${idPrefix}-account`} className="w-full sm:min-h-7.5">
            <SelectValue>
              {selectedEntry ? (
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderInstanceIcon
                    driverKind={selectedEntry.driverKind}
                    displayName={selectedEntry.displayName}
                    accentColor={selectedEntry.accentColor}
                    className="size-4"
                    iconClassName="size-4"
                  />
                  <span className="min-w-0 truncate">{selectedEntry.displayName}</span>
                </span>
              ) : showStalePin ? (
                <span className="min-w-0 truncate text-muted-foreground">
                  {selectedInstanceId} (unavailable)
                </span>
              ) : (
                defaultAccountLabel
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value={USE_DEFAULT_VALUE}>
              {defaultAccountLabel}
            </SelectItem>
            {entries.map((entry) => (
              <SelectItem hideIndicator key={entry.instanceId} value={entry.instanceId}>
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderInstanceIcon
                    driverKind={entry.driverKind}
                    displayName={entry.displayName}
                    accentColor={entry.accentColor}
                    className="size-4"
                    iconClassName="size-4"
                  />
                  <span className="min-w-0 truncate">{entry.displayName}</span>
                </span>
              </SelectItem>
            ))}
            {showStalePin ? (
              <SelectItem hideIndicator value={selectedInstanceId}>
                <span className="min-w-0 truncate text-muted-foreground">
                  {selectedInstanceId} (unavailable)
                </span>
              </SelectItem>
            ) : null}
          </SelectPopup>
        </Select>
      </label>
      <label className="grid min-w-0 gap-1.5" htmlFor={`${idPrefix}-model`}>
        <span className="font-medium text-foreground">{fieldLabel} model</span>
        <Select
          value={value?.model ?? ""}
          onValueChange={handleModelChange}
          disabled={disabled || !selectedEntry || models.length === 0}
        >
          <SelectTrigger id={`${idPrefix}-model`} className="w-full sm:min-h-7.5">
            <SelectValue>
              {selectedEntry
                ? (models.find((model) => model.slug === value?.model)?.name ??
                  value?.model ??
                  "Default model")
                : "—"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            {models.map((model) => (
              <SelectItem hideIndicator key={model.slug} value={model.slug}>
                {model.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </label>
    </div>
  );
}
