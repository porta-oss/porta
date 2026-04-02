import type { CustomMetricSummary } from "@shared/custom-metric";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface CustomMetricPanelProps {
  /** The custom metric, or null if not configured. */
  customMetric: CustomMetricSummary | null;
  /** Whether the health payload is in an error state. */
  healthError?: boolean;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function formatMetricValue(value: number | null, unit: string): string {
  if (value === null) {
    return "—";
  }

  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);

  // Prefix currency-like units, suffix others
  if (unit === "$" || unit === "€" || unit === "£") {
    return `${unit}${formatted}`;
  }
  if (unit === "%") {
    return `${formatted}%`;
  }
  return `${formatted} ${unit}`;
}

function computeDelta(
  current: number | null,
  previous: number | null
): string | null {
  if (current === null || previous === null || previous === 0) {
    return null;
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export function CustomMetricPanel({
  customMetric,
  healthError = false,
}: CustomMetricPanelProps) {
  // Not configured — show optional guidance
  if (!customMetric) {
    return (
      <section
        aria-label="custom metric"
        data-testid="custom-metric-panel"
        style={{
          display: "grid",
          gap: "0.5rem",
          padding: "1rem",
          border: "1px solid #e5e7eb",
          borderRadius: "0.75rem",
          background: "#f9fafb",
        }}
      >
        <p style={{ margin: 0, fontSize: "0.85rem", color: "#6b7280" }}>
          No custom metric configured. Add a Postgres-backed metric below to
          track additional KPIs.
        </p>
      </section>
    );
  }

  // Error state — show failure guidance
  if (customMetric.status === "error") {
    return (
      <section
        aria-label="custom metric"
        data-testid="custom-metric-panel"
        style={{
          display: "grid",
          gap: "0.5rem",
          padding: "1rem",
          border: "1px solid #fecaca",
          borderRadius: "0.75rem",
          background: "#fef2f2",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>{customMetric.label}</p>
          <span
            role="status"
            style={{ fontSize: "0.8rem", fontWeight: 500, color: "#991b1b" }}
          >
            Sync failed
          </span>
        </div>
        {customMetric.metricValue === null ? (
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#991b1b" }}>
            No data has been synced yet. Check the Postgres connector
            configuration.
          </p>
        ) : (
          <div data-testid="custom-metric-value">
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#92400e" }}>
              Last known:{" "}
              {formatMetricValue(customMetric.metricValue, customMetric.unit)}
            </p>
          </div>
        )}
      </section>
    );
  }

  // Pending state
  if (customMetric.status === "pending") {
    return (
      <section
        aria-label="custom metric"
        data-testid="custom-metric-panel"
        style={{
          display: "grid",
          gap: "0.5rem",
          padding: "1rem",
          border: "1px solid #fef3c7",
          borderRadius: "0.75rem",
          background: "#fffbeb",
        }}
      >
        <p style={{ margin: 0, fontWeight: 600 }}>{customMetric.label}</p>
        <p
          role="status"
          style={{ margin: 0, fontSize: "0.85rem", color: "#92400e" }}
        >
          Waiting for the first sync to complete…
        </p>
      </section>
    );
  }

  // Active state — show the metric
  const delta = computeDelta(
    customMetric.metricValue,
    customMetric.previousValue
  );

  return (
    <section
      aria-label="custom metric"
      data-testid="custom-metric-panel"
      style={{
        display: "grid",
        gap: "0.5rem",
        padding: "1rem",
        border: "1px solid #d1fae5",
        borderRadius: "0.75rem",
        background: "#ecfdf5",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <p style={{ margin: 0, fontWeight: 600 }}>{customMetric.label}</p>
        <span
          role="status"
          style={{ fontSize: "0.8rem", fontWeight: 500, color: "#065f46" }}
        >
          Active
        </span>
      </div>
      <div
        data-testid="custom-metric-value"
        style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}
      >
        <span style={{ fontSize: "1.5rem", fontWeight: 700 }}>
          {formatMetricValue(customMetric.metricValue, customMetric.unit)}
        </span>
        {delta ? (
          <span
            data-testid="custom-metric-delta"
            style={{
              fontSize: "0.85rem",
              fontWeight: 500,
              color: delta.startsWith("+") ? "#065f46" : "#991b1b",
            }}
          >
            {delta}
          </span>
        ) : null}
      </div>
      {customMetric.capturedAt ? (
        <p style={{ margin: 0, fontSize: "0.75rem", color: "#6b7280" }}>
          Last captured: {new Date(customMetric.capturedAt).toLocaleString()}
        </p>
      ) : null}
    </section>
  );
}
