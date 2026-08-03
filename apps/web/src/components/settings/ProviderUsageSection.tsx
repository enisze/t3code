import type { ProviderUsage, ProviderUsageWindow } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { formatElapsedDurationLabel, formatRelativeTimeUntilLabel } from "../../timestampFormat";

function meterColor(usedPercent: number): string {
  if (usedPercent >= 90) return "var(--color-red-500)";
  if (usedPercent >= 70) return "var(--color-amber-500)";
  return "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)";
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  if (value > 0 && value < 10) return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(value)}%`;
}

function resetLabel(window: ProviderUsageWindow): string | null {
  if (!window.resetsAt) return null;
  const label = formatRelativeTimeUntilLabel(window.resetsAt);
  if (!label) return null;
  return label === "Expired" ? "resets now" : `resets in ${label.replace(/ left$/, "")}`;
}

function creditsLine(usage: ProviderUsage): string | null {
  const credits = usage.credits;
  if (!credits) return null;
  if (credits.unlimited) return "Extra credits: Unlimited";
  if (credits.monthlyLimit !== null) {
    const used = credits.used ?? 0;
    return `Extra usage: ${used.toLocaleString()} / ${credits.monthlyLimit.toLocaleString()}`;
  }
  if (credits.balance) return `Credits: ${credits.balance}`;
  return credits.hasCredits ? "Extra credits available" : null;
}

function UsageMeterRow({ window }: { readonly window: ProviderUsageWindow }) {
  const pct = Math.max(0, Math.min(100, window.usedPercent));
  const reset = resetLabel(window);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-[13px] leading-tight">
        <span className="font-medium text-foreground">{window.label}</span>
        <span className="tabular-nums text-muted-foreground/80">
          {formatPercent(window.usedPercent)}
          {reset ? <span className="text-muted-foreground/50"> · {reset}</span> : null}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={`${window.label} usage`}
      >
        <div
          className="h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%`, backgroundColor: meterColor(pct) }}
        />
      </div>
    </div>
  );
}

/**
 * Renders normalized provider usage windows (5-hour / weekly / monthly) as
 * labelled meters, with an optional credits line and a "checked N ago" footer.
 * Shared by the provider settings card and the settings-sidebar usage pill.
 */
export function ProviderUsageMeters({
  usage,
  className,
  showFooter = true,
}: {
  readonly usage: ProviderUsage;
  readonly className?: string;
  readonly showFooter?: boolean;
}) {
  const credits = creditsLine(usage);
  return (
    <div className={cn("space-y-3", className)}>
      {usage.windows.length > 0 ? (
        <div className="space-y-2.5">
          {usage.windows.map((window) => (
            <UsageMeterRow key={window.kind} window={window} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/70">
          No rate-limit windows reported for this account.
        </p>
      )}
      {credits ? <p className="text-xs text-muted-foreground/70 tabular-nums">{credits}</p> : null}
      {showFooter ? (
        <p className="text-[11px] text-muted-foreground/50">
          {usage.planLabel ? <span>{usage.planLabel} · </span> : null}
          Updated {formatElapsedDurationLabel(usage.fetchedAt)} ago
        </p>
      ) : null}
    </div>
  );
}
