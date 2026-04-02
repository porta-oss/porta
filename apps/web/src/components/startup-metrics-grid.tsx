import type {
  SupportingMetric,
  SupportingMetricsSnapshot,
} from "@shared/startup-health";
import {
  SUPPORTING_METRIC_LABELS,
  SUPPORTING_METRIC_UNITS,
  SUPPORTING_METRICS,
} from "@shared/startup-health";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StartupMetricsGridProps {
  metrics: SupportingMetricsSnapshot;
  muted?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StartupMetricsGrid({
  metrics,
  muted = false,
}: StartupMetricsGridProps) {
  return (
    <section
      aria-label="supporting metrics"
      style={{
        display: "grid",
        gap: "0.75rem",
        gridTemplateColumns: "repeat(auto-fill, minmax(10rem, 1fr))",
      }}
    >
      {SUPPORTING_METRICS.map((key) => {
        const metric = metrics[key];
        const change = computeChange(metric.value, metric.previous);

        return (
          <article
            aria-label={SUPPORTING_METRIC_LABELS[key]}
            key={key}
            style={{
              display: "grid",
              gap: "0.25rem",
              padding: "0.75rem",
              border: "1px solid #e5e7eb",
              borderRadius: "0.5rem",
              background: "#fff",
            }}
          >
            <span
              style={{
                fontSize: "0.7rem",
                fontWeight: 500,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "#6b7280",
              }}
            >
              {SUPPORTING_METRIC_LABELS[key]}
            </span>
            <span
              data-testid={`metric-${key}`}
              style={{
                fontSize: "1.25rem",
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                color: muted ? "#9ca3af" : "#111827",
              }}
            >
              {formatMetricValue(key, metric.value)}
            </span>
            {change ? (
              <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                {change}
              </span>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
