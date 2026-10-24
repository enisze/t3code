import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

const WORKSPACE_SNAPSHOT_RETRY_COOLDOWN_MS = 10_000;

/**
 * Asks the server once per environment, provider instance, and cwd to scan the
 * cwd for the provider's skills and native slash commands. The composer reads
 * the result through `resolveProviderSkillsForCwd` and
 * `resolveProviderSlashCommandsForCwd`. A failed scan is retried on the next
 * `activity` change after a cooldown, and a snapshot the server drops is
 * requested again.
 */
export function useProviderWorkspaceSnapshot(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly provider: ServerProvider | null;
  readonly activity: unknown;
}): void {
  const { environmentId, cwd, provider, activity } = input;
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const instanceId = provider?.instanceId;
  const hasWorkspaceSnapshot = Boolean(
    cwd && provider?.workspaceSnapshots?.some((snapshot) => snapshot.cwd === cwd),
  );
  const requestedKeyRef = useRef<string | null>(null);
  const retryRef = useRef<{ key: string; notBefore: number } | null>(null);
  const hadWorkspaceSnapshotRef = useRef(false);

  useEffect(() => {
    if (hadWorkspaceSnapshotRef.current && !hasWorkspaceSnapshot) {
      requestedKeyRef.current = null;
      retryRef.current = null;
    }
    hadWorkspaceSnapshotRef.current = hasWorkspaceSnapshot;
  }, [hasWorkspaceSnapshot]);

  // `activity` is a dependency on purpose: it re-runs this effect so a failed
  // scan retries while the user types.
  useEffect(() => {
    if (!cwd || !instanceId) return;
    const key = `${environmentId}:${instanceId}:${cwd}`;
    if (requestedKeyRef.current === key) return;
    if (hasWorkspaceSnapshot) {
      requestedKeyRef.current = key;
      retryRef.current = null;
      return;
    }
    const retry = retryRef.current;
    if (retry?.key === key && Date.now() < retry.notBefore) return;
    requestedKeyRef.current = key;
    const retryLater = () => {
      if (requestedKeyRef.current !== key) return;
      requestedKeyRef.current = null;
      retryRef.current = { key, notBefore: Date.now() + WORKSPACE_SNAPSHOT_RETRY_COOLDOWN_MS };
    };
    void refreshProviders({ environmentId, input: { instanceId, cwd } }).then((result) => {
      const scanned =
        result._tag === "Success" &&
        result.value.providers
          .find((candidate) => candidate.instanceId === instanceId)
          ?.workspaceSnapshots?.some((snapshot) => snapshot.cwd === cwd);
      if (!scanned) retryLater();
    }, retryLater);
  }, [activity, cwd, environmentId, hasWorkspaceSnapshot, instanceId, refreshProviders]);
}
