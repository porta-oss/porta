import type { CustomMetricSummary } from "@shared/custom-metric";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export interface CustomMetricPanelProps {
  customMetric: CustomMetricSummary | null;
  healthError?: boolean;
}

function formatMetricValue(value: number | null, unit: string): string {
  if (value === null) {
    return "\u2014";
  }

  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);

  if (unit === "$" || unit === "\u20ac" || unit === "\u00a3") {
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

export function CustomMetricPanel({
  customMetric,
  healthError: _healthError = false,
}: CustomMetricPanelProps) {
  if (!customMetric) {
    return (
      <Card
        aria-label="custom metric"
        className="bg-muted"
        data-testid="custom-metric-panel"
      >
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm">
            No custom metric configured. Add a Postgres-backed metric below to
            track additional KPIs.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (customMetric.status === "error") {
    return (
      <Card
        aria-label="custom metric"
        className="border-danger-border bg-danger-bg"
        data-testid="custom-metric-panel"
      >
        <CardContent className="grid gap-2 pt-6">
          <div className="flex items-center justify-between">
            <p className="font-semibold">{customMetric.label}</p>
            <Badge variant="destructive">Sync failed</Badge>
          </div>
          {customMetric.metricValue === null ? (
            <p className="text-danger text-sm">
              No data has been synced yet. Check the Postgres connector
              configuration.
            </p>
          ) : (
            <div data-testid="custom-metric-value">
              <p className="text-sm text-warning">
                Last known:{" "}
                {formatMetricValue(customMetric.metricValue, customMetric.unit)}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (customMetric.status === "pending") {
    return (
      <Card
        aria-label="custom metric"
        className="border-warning-border bg-warning-bg"
        data-testid="custom-metric-panel"
      >
        <CardContent className="grid gap-2 pt-6">
          <p className="font-semibold">{customMetric.label}</p>
          <p className="text-sm text-warning" role="status">
            Waiting for the first sync to complete\u2026
          </p>
        </CardContent>
      </Card>
    );
  }

  const delta = computeDelta(
    customMetric.metricValue,
    customMetric.previousValue
  );

  return (
    <Card
      aria-label="custom metric"
      className="border-success-border bg-success-bg"
      data-testid="custom-metric-panel"
    >
      <CardContent className="grid gap-2 pt-6">
        <div className="flex items-center justify-between">
          <p className="font-semibold">{customMetric.label}</p>
          <Badge variant="secondary">Active</Badge>
        </div>
        <div
          className="flex items-baseline gap-2"
          data-testid="custom-metric-value"
        >
          <span className="font-bold text-xl leading-tight">
            {formatMetricValue(customMetric.metricValue, customMetric.unit)}
          </span>
          {delta ? (
            <span
              className={`font-medium text-sm ${delta.startsWith("+") ? "text-success" : "text-danger"}`}
              data-testid="custom-metric-delta"
            >
              {delta}
            </span>
          ) : null}
        </div>
        {customMetric.capturedAt ? (
          <p className="text-muted-foreground text-xs">
            Last captured: {new Date(customMetric.capturedAt).toLocaleString()}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
