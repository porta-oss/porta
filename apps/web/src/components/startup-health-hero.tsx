import type { HealthState } from "@shared/startup-health";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export interface StartupHealthHeroProps {
  blockedReasons: Array<{ code: string; message: string }>;
  healthState: HealthState;
  lastSnapshotAt: string | null;
  northStarKey: string;
  northStarPreviousValue: number | null;
  northStarValue: number | null;
}

const NORTH_STAR_LABELS: Record<string, string> = {
  mrr: "Monthly Recurring Revenue",
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function computeDelta(
  current: number | null,
  previous: number | null
): { label: string; direction: "up" | "down" | "flat" } | null {
  if (current === null || previous === null || previous === 0) {
    return null;
  }
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.01) {
    return { label: "0%", direction: "flat" };
  }
  const sign = pct > 0 ? "+" : "";
  return {
    label: `${sign}${pct.toFixed(1)}%`,
    direction: pct > 0 ? "up" : "down",
  };
}

function healthBannerConfig(state: HealthState): {
  badgeVariant: "default" | "secondary" | "destructive" | "outline";
  cardClass: string;
  text: string;
} {
  switch (state) {
    case "ready":
      return {
        cardClass: "border-success-border bg-success-bg",
        badgeVariant: "default",
        text: "Healthy",
      };
    case "syncing":
      return {
        cardClass: "border-warning-border bg-warning-bg",
        badgeVariant: "secondary",
        text: "Syncing\u2026",
      };
    case "stale":
      return {
        cardClass: "border-warning-border bg-warning-bg",
        badgeVariant: "secondary",
        text: "Stale data",
      };
    case "blocked":
      return {
        cardClass: "border-danger-border bg-danger-bg",
        badgeVariant: "destructive",
        text: "Blocked",
      };
    case "error":
      return {
        cardClass: "border-danger-border bg-danger-bg",
        badgeVariant: "destructive",
        text: "Error",
      };
    default:
      return {
        cardClass: "",
        badgeVariant: "outline",
        text: String(state),
      };
  }
}

function formatSnapshotAge(iso: string | null): string {
  if (!iso) {
    return "No snapshot yet";
  }
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return "Updated just now";
  }
  if (minutes < 60) {
    return `Updated ${String(minutes)}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Updated ${String(hours)}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `Updated ${String(days)}d ago`;
}

export function StartupHealthHero({
  healthState,
  northStarKey,
  northStarValue,
  northStarPreviousValue,
  lastSnapshotAt,
  blockedReasons,
}: StartupHealthHeroProps) {
  const banner = healthBannerConfig(healthState);
  const delta = computeDelta(northStarValue, northStarPreviousValue);
  const isBlocked = healthState === "blocked" || healthState === "error";

  function deltaColorClass(): string {
    if (delta?.direction === "up") {
      return "text-success";
    }
    if (delta?.direction === "down") {
      return "text-danger";
    }
    return "text-muted-foreground";
  }

  return (
    <Card aria-label="startup health hero" className={banner.cardClass}>
      <CardContent className="grid gap-3 pt-5">
        <div className="flex items-center justify-between">
          <Badge role="status" variant={banner.badgeVariant}>
            {banner.text}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {formatSnapshotAge(lastSnapshotAt)}
          </span>
        </div>

        <div>
          <p className="text-muted-foreground text-sm uppercase tracking-wide">
            {NORTH_STAR_LABELS[northStarKey] ?? northStarKey}
          </p>
          <p
            className={`mt-1 font-bold text-2xl tabular-nums leading-tight tracking-display ${isBlocked ? "text-muted-foreground" : "text-foreground"}`}
            data-testid="north-star-value"
          >
            {formatCurrency(northStarValue ?? 0)}
          </p>
          {delta ? (
            <span
              className={`font-medium text-sm ${deltaColorClass()}`}
              data-testid="north-star-delta"
            >
              {delta.label} from previous
            </span>
          ) : null}
        </div>

        {blockedReasons.length > 0 ? (
          <div aria-label="blocked reasons" className="grid gap-1" role="alert">
            {blockedReasons.map((reason) => (
              <p className="text-danger text-sm" key={reason.code}>
                {reason.message}
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
