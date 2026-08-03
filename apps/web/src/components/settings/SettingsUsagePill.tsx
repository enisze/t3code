import { useAtomValue } from "@effect/atom-react";
import type { ProviderUsage, ServerProvider } from "@t3tools/contracts";
import { ChevronDownIcon, GaugeIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { usePrimaryEnvironment } from "../../state/environments";
import { primaryServerProvidersAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { ProviderUsageMeters } from "./ProviderUsageSection";

type ProviderWithUsage = ServerProvider & { readonly usage: ProviderUsage };

function summaryColor(usedPercent: number): string {
  if (usedPercent >= 90) return "var(--color-red-500)";
  if (usedPercent >= 70) return "var(--color-amber-500)";
  return "var(--color-muted-foreground)";
}

/**
 * Bottom-pinned, collapsible "Usage limits" widget for the main sidebar
 * footer. Surfaces the current 5-hour / weekly / monthly limits for every
 * authenticated provider account that reported usage (Claude, Codex, …), so
 * the state is visible alongside the chats list without opening each provider
 * card. Self-hides when no account reports usage.
 */
export function SettingsUsagePill() {
  const providers = useAtomValue(primaryServerProvidersAtom);
  const primaryEnvironment = usePrimaryEnvironment();
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

  const worstPercent = withUsage.reduce((worst, provider) => {
    const localWorst = provider.usage.windows.reduce(
      (max, window) => Math.max(max, window.usedPercent),
      0,
    );
    return Math.max(worst, localWorst);
  }, 0);

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
            style={{ color: summaryColor(worstPercent) }}
          >
            {Math.round(worstPercent)}%
          </span>
          <ChevronDownIcon
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
