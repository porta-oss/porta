// Custom metric contract shared across API, worker, and UI.

// ---------------------------------------------------------------------------
// Category enum
// ---------------------------------------------------------------------------

export const CUSTOM_METRIC_CATEGORIES = [
  "engagement",
  "revenue",
  "health",
  "growth",
  "custom",
] as const;
export type CustomMetricCategory = (typeof CUSTOM_METRIC_CATEGORIES)[number];

export function isCustomMetricCategory(
  value: string
): value is CustomMetricCategory {
  return CUSTOM_METRIC_CATEGORIES.includes(value as CustomMetricCategory);
}

// ---------------------------------------------------------------------------
// Custom metric summary — returned to the UI, never includes credentials
// ---------------------------------------------------------------------------

export interface CustomMetricSummary {
  /** ISO timestamp of the last successful metric capture. */
  capturedAt: string | null;
  /** Category of the metric. */
  category: CustomMetricCategory;
  connectorId: string;
  createdAt: string;
  /** Delta between current and previous value. */
  delta: number | null;
  id: string;
  /** Unique key within a startup, e.g. "daily_revenue". */
  key: string;
  label: string;
  /** Numeric value from the last successful sync, if any. */
  metricValue: number | null;
  previousValue: number | null;
  startupId: string;
  unit: string;
  updatedAt: string;
}
