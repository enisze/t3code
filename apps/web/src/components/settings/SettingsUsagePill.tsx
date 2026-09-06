import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ProviderUsage, ProviderUsageWindow, ServerProvider } from "@t3tools/contracts";
import { useParams } from "@tanstack/react-router";
import { ChevronUpIcon, GaugeIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { useProject, useThreadShell } from "../../state/entities";
import { usePrimaryEnvironment } from "../../state/environments";
import { primaryServerProvidersAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { resolveThreadRouteRef } from "../../threadRoutes";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { ProviderUsageMeters } from "./ProviderUsageSection";

type ProviderWithUsage = ServerProvider & { readonly usage: ProviderUsage };

function summaryColor(usedPercent: number): string {
  if (usedPercent >= 90) return "var(--color-red-500)";
  if (usedPercent >= 70) return "var(--color-amber-500)";
  return "var(--color-muted-foreground)";
}

/**
 * Picks the window the collapsed pill summarizes: the shortest-duration
 * ("hourly") rate-limit window — Claude's 5-hour, Codex's `primary`. That is
 * the limit users actually hit during a session, so the collapsed number
 * tracks it rather than the slow-moving weekly/monthly max. Falls back to the
 * first reported window when none carry a `windowMinutes`.
 */
function summaryWindow(usage: ProviderUsage): ProviderUsageWindow | null {
  const windows = usage.windows;
  if (windows.length === 0) return null;
  return windows.reduce((shortest, window) =>
    (window.windowMinutes ?? Number.POSITIVE_INFINITY) <
    (shortest.windowMinutes ?? Number.POSITIVE_INFINITY)
      ? window
      : shortest,
  );
}

/**
 * Bottom-pinned, collapsible "Usage limits" widget for the main sidebar
 * footer. Surfaces the current 5-hour / weekly / monthly limits for every
 * authenticated provider account that reported usage (Claude, Codex, …), so
 * the state is visible alongside the chats list without opening each provider
 * card. Self-hides when no account reports usage.
 *
 * The collapsed summary percentage is scoped to the provider instance backing
 * the chat the user currently has open — its thread `modelSelection`, falling
 * back to the owning project's `defaultModelSelection` — rather than the worst
 * percent across every account. Within that account it reflects the hourly
 * (shortest) window (see `summaryWindow`) so the number tracks the limit users
 * hit mid-session, not the slow weekly/monthly max; the tooltip lists every
 * window. Off a chat route (or when the active provider reports no usage) the
 * summary shows a dash.
 */
export function SettingsUsagePill() {
  const providers = useAtomValue(primaryServerProvidersAtom);
  const primaryEnvironment = usePrimaryEnvironment();
  const activeThreadRef = useParams({ strict: false, select: resolveThreadRouteRef });
  const activeThreadShell = useThreadShell(activeThreadRef);
  const activeProjectRef =
    activeThreadShell !== null
      ? scopeProjectRef(activeThreadShell.environmentId, activeThreadShell.projectId)
      : null;
  const activeProject = useProject(activeProjectRef);
  const refreshServerProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [open, setOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  const refreshProviders = useCallback(() => {
    if (refreshingRef.current || !primaryEnvironment) return;
    refreshingRef.current = true;
    setIsRefreshing(true);
    void (async () => {
      const result = await refreshServerProviders({
        environmentId: primaryEnvironment.environmentId,
        input: {},
      });
      refreshingRef.current = false;
      setIsRefreshing(false);
      if (result._tag === "Failure") {
        console.warn("Failed to refresh provider usage", result);
      }
    })();
  }, [primaryEnvironment, refreshServerProviders]);

  const withUsage = providers.filter(
    (provider): provider is ProviderWithUsage =>
      provider.usage !== undefined && provider.usage.windows.length > 0,
  );
  if (withUsage.length === 0) return null;

  // Summary reflects only the active chat's provider instance (its own model
  // selection, else the project default), so the number matches the account
  // that chat actually spends against — not whichever account is most maxed.
  const activeInstanceId =
    activeThreadShell?.modelSelection.instanceId ??
    activeProject?.defaultModelSelection?.instanceId ??
    null;
  const activeProvider =
    activeInstanceId !== null
      ? providers.find((provider) => provider.instanceId === activeInstanceId)
      : undefined;
  // Summarize the hourly window, not the max across windows, so the collapsed
  // number reflects the short-term limit users hit mid-session. Every window
  // is still listed in the tooltip and the expanded meters below.
  const activeWindow = activeProvider?.usage ? summaryWindow(activeProvider.usage) : null;
  const activePercent = activeWindow?.usedPercent ?? null;
  const summaryTitle = activeProvider?.usage
    ? activeProvider.usage.windows
        .map((w) => `${w.label}: ${Math.round(w.usedPercent)}%`)
        .join(" · ")
    : undefined;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-lg border border-border/60 bg-muted/20"
    >
      <div className="flex items-center">
        <CollapsibleTrigger
          className={cn(
            "flex flex-1 items-center gap-2 px-2.5 py-2 text-left outline-none",
            "transition-colors hover:bg-muted/40 focus-visible:bg-muted/40",
          )}
          aria-label="Toggle usage limits"
        >
          <GaugeIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-[13px] font-medium text-foreground">
            Usage limits
          </span>
          <span
            className="shrink-0 text-xs font-medium tabular-nums"
            title={summaryTitle}
            style={{
              color:
                activePercent === null
                  ? "var(--color-muted-foreground)"
                  : summaryColor(activePercent),
            }}
          >
            {activePercent === null ? "—" : `${Math.round(activePercent)}%`}
          </span>
          <ChevronUpIcon
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </CollapsibleTrigger>
        <button
          type="button"
          onClick={refreshProviders}
          disabled={isRefreshing}
          aria-label="Refresh usage limits"
          title="Refresh usage limits"
          className={cn(
            "mr-1 shrink-0 rounded-md p-1.5 text-muted-foreground outline-none",
            "transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:bg-muted/40",
            "disabled:cursor-default disabled:opacity-60",
          )}
        >
          <RefreshCwIcon className={cn("size-3.5", isRefreshing && "animate-spin")} />
        </button>
      </div>
      <CollapsibleContent>
        <div className="max-h-[min(45vh,22rem)] space-y-3.5 overflow-y-auto px-2.5 pb-2.5 pt-1">
          {withUsage.map((provider) => (
            <div key={provider.instanceId} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {provider.displayName ?? provider.driver}
                </span>
                {provider.usage.planLabel ? (
                  <span className="shrink-0 truncate text-[10px] text-muted-foreground/50">
                    {provider.usage.planLabel}
                  </span>
                ) : null}
              </div>
              <ProviderUsageMeters usage={provider.usage} showFooter={false} />
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
