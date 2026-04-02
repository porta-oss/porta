import type {
  SupportingMetric,
  SupportingMetricsSnapshot,
} from "@shared/startup-health";
import {
  SUPPORTING_METRIC_LABELS,
  SUPPORTING_METRIC_UNITS,
  SUPPORTING_METRICS,
} from "@shared/startup-health";

export interface StartupMetricsGridProps {
  metrics: SupportingMetricsSnapshot;
  muted?: boolean;
}

function formatMetricValue(key: SupportingMetric, value: number): string {
  const unit = SUPPORTING_METRIC_UNITS[key];
  switch (unit) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);
    case "percent":
      return `${value.toFixed(1)}%`;
    case "count":
      return new Intl.NumberFormat("en-US").format(value);
    default:
      return String(value);
  }
}

function computeChange(
  current: number,
  previous: number | null
): string | null {
  if (previous === null || previous === 0) {
    return null;
  }
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.01) {
    return "0%";
  }
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function StartupMetricsGrid({
  metrics,
  muted = false,
}: StartupMetricsGridProps) {
  return (
    <section
      aria-label="supporting metrics"
      className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3"
    >
      {SUPPORTING_METRICS.map((key) => {
        const metric = metrics[key];
        const change = computeChange(metric.value, metric.previous);

        return (
          <div className="grid gap-1 rounded-lg bg-muted/50 p-3" key={key}>
            <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {SUPPORTING_METRIC_LABELS[key]}
            </span>
            <span
              className={`font-semibold text-lg tabular-nums leading-snug ${muted ? "text-muted-foreground" : "text-foreground"}`}
              data-testid={`metric-${key}`}
            >
              {formatMetricValue(key, metric.value)}
            </span>
            {change ? (
              <span className="text-muted-foreground text-xs">{change}</span>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
