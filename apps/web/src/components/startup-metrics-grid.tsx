import type {
  UniversalMetricKey,
  UniversalMetrics,
} from "@shared/universal-metrics";
import {
  METRIC_LABELS,
  METRIC_UNITS,
  UNIVERSAL_METRIC_KEYS,
} from "@shared/universal-metrics";

export interface StartupMetricsGridProps {
  metrics: UniversalMetrics;
  muted?: boolean;
}

function formatMetricValue(key: UniversalMetricKey, value: number): string {
  const unit = METRIC_UNITS[key];
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

export function StartupMetricsGrid({
  metrics,
  muted = false,
}: StartupMetricsGridProps) {
  return (
    <section
      aria-label="supporting metrics"
      className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3"
    >
      {UNIVERSAL_METRIC_KEYS.map((key) => {
        const value = metrics[key];
        if (value === undefined || value === null) {
          return null;
        }

        return (
          <div className="grid gap-1 rounded-lg bg-muted/50 p-3" key={key}>
            <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {METRIC_LABELS[key]}
            </span>
            <span
              className={`font-semibold text-lg tabular-nums leading-snug ${muted ? "text-muted-foreground" : "text-foreground"}`}
              data-testid={`metric-${key}`}
            >
              {formatMetricValue(key, value)}
            </span>
          </div>
        );
      })}
    </section>
  );
}
