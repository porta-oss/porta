// Universal metric keys and types shared across API, worker, and UI.
// These are the 6 standard KPIs that every startup tracks.

export const UNIVERSAL_METRIC_KEYS = [
  "mrr",
  "active_users",
  "churn_rate",
  "error_rate",
  "growth_rate",
  "arpu",
] as const;

export type UniversalMetricKey = (typeof UNIVERSAL_METRIC_KEYS)[number];

export function isUniversalMetricKey(
  value: string
): value is UniversalMetricKey {
  return UNIVERSAL_METRIC_KEYS.includes(value as UniversalMetricKey);
}

/** All 6 metric values — each optional and nullable for partial snapshots. */
export interface UniversalMetrics {
  active_users?: number | null;
  arpu?: number | null;
  churn_rate?: number | null;
  error_rate?: number | null;
  growth_rate?: number | null;
  mrr?: number | null;
}

/** Human-readable labels for each metric key. */
export const METRIC_LABELS: Record<UniversalMetricKey, string> = {
  mrr: "MRR",
  active_users: "Active Users",
  churn_rate: "Churn Rate",
  error_rate: "Error Rate",
  growth_rate: "Growth Rate",
  arpu: "ARPU",
} as const;

/** Unit type for each metric — drives formatting in the UI. */
export const METRIC_UNITS: Record<
  UniversalMetricKey,
  "count" | "currency" | "percent"
> = {
  mrr: "currency",
  active_users: "count",
  churn_rate: "percent",
  error_rate: "percent",
  growth_rate: "percent",
  arpu: "currency",
} as const;
