// B2B SaaS health snapshot contract shared across API, worker, and UI.
// Defines the fixed KPI template: one north-star metric, supporting metrics,
// funnel stages, and health-state enum for the startup health page.
//
// This is the single source of truth for metric keys, health states,
// and payload shapes. Worker writes, API reads, UI renders — all from
// these types. Never store raw provider payloads or connector credentials
// in health snapshot data.

// ---------------------------------------------------------------------------
// North-star metric
// ---------------------------------------------------------------------------

export const NORTH_STAR_METRICS = ['mrr'] as const;
export type NorthStarMetric = (typeof NORTH_STAR_METRICS)[number];

export function isNorthStarMetric(value: string): value is NorthStarMetric {
  return NORTH_STAR_METRICS.includes(value as NorthStarMetric);
}

// ---------------------------------------------------------------------------
// Supporting metrics
// ---------------------------------------------------------------------------

export const SUPPORTING_METRICS = [
  'active_users',
  'customer_count',
  'churn_rate',
  'arpu',
  'trial_conversion_rate',
] as const;
export type SupportingMetric = (typeof SUPPORTING_METRICS)[number];

export function isSupportingMetric(value: string): value is SupportingMetric {
  return SUPPORTING_METRICS.includes(value as SupportingMetric);
}

/** Labels for display in the UI — maps each key to a human-readable name. */
export const SUPPORTING_METRIC_LABELS: Record<SupportingMetric, string> = {
  active_users: 'Active Users',
  customer_count: 'Customers',
  churn_rate: 'Churn Rate',
  arpu: 'ARPU',
  trial_conversion_rate: 'Trial Conversion',
} as const;

/** Unit type for each supporting metric. */
export const SUPPORTING_METRIC_UNITS: Record<SupportingMetric, 'count' | 'currency' | 'percent'> = {
  active_users: 'count',
  customer_count: 'count',
  churn_rate: 'percent',
  arpu: 'currency',
  trial_conversion_rate: 'percent',
} as const;

// ---------------------------------------------------------------------------
// Funnel stages
// ---------------------------------------------------------------------------

export const FUNNEL_STAGES = [
  'visitor',
  'signup',
  'activation',
  'paying_customer',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export function isFunnelStage(value: string): value is FunnelStage {
  return FUNNEL_STAGES.includes(value as FunnelStage);
}

/** Default labels for each funnel stage. */
export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  visitor: 'Visitors',
  signup: 'Sign-ups',
  activation: 'Activated',
  paying_customer: 'Paying Customers',
} as const;

/** Expected position (0-indexed) for each funnel stage. */
export const FUNNEL_STAGE_POSITIONS: Record<FunnelStage, number> = {
  visitor: 0,
  signup: 1,
  activation: 2,
  paying_customer: 3,
} as const;

// ---------------------------------------------------------------------------
// Health state
// ---------------------------------------------------------------------------

export const HEALTH_STATES = ['blocked', 'syncing', 'ready', 'stale', 'error'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

export function isHealthState(value: string): value is HealthState {
  return HEALTH_STATES.includes(value as HealthState);
}

// ---------------------------------------------------------------------------
// Snapshot payload shapes
// ---------------------------------------------------------------------------

/** One metric value with optional delta from previous snapshot. */
export interface MetricValue {
  value: number;
  previous: number | null;
}

/**
 * Typed map of supporting metric values.
 * Stored as JSONB in the snapshot table.
 * Every key in SUPPORTING_METRICS must be present.
 */
export type SupportingMetricsSnapshot = {
  [K in SupportingMetric]: MetricValue;
};

/** A single funnel stage row for the startup health page. */
export interface FunnelStageRow {
  stage: FunnelStage;
  label: string;
  value: number;
  position: number;
}

/**
 * The complete health snapshot payload — returned by the API and consumed by the UI.
 * Never contains connector credentials, raw PostHog events, or Stripe customer data.
 */
export interface HealthSnapshotSummary {
  startupId: string;
  healthState: HealthState;
  blockedReason: string | null;
  northStarKey: NorthStarMetric;
  northStarValue: number;
  northStarPreviousValue: number | null;
  supportingMetrics: SupportingMetricsSnapshot;
  funnel: FunnelStageRow[];
  computedAt: string;
  syncJobId: string | null;
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Create a zero-valued supporting metrics snapshot (for first-time or reset). */
export function emptySupportingMetrics(): SupportingMetricsSnapshot {
  return {
    active_users: { value: 0, previous: null },
    customer_count: { value: 0, previous: null },
    churn_rate: { value: 0, previous: null },
    arpu: { value: 0, previous: null },
    trial_conversion_rate: { value: 0, previous: null },
  };
}

/** Create the default funnel stage rows with zero values. */
export function emptyFunnelStages(): FunnelStageRow[] {
  return FUNNEL_STAGES.map((stage) => ({
    stage,
    label: FUNNEL_STAGE_LABELS[stage],
    value: 0,
    position: FUNNEL_STAGE_POSITIONS[stage],
  }));
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate that a supporting metrics object has exactly the expected keys
 * and each value conforms to the MetricValue shape.
 * Returns an error string or null if valid.
 */
export function validateSupportingMetrics(metrics: unknown): string | null {
  if (typeof metrics !== 'object' || metrics === null) {
    return 'Supporting metrics must be a non-null object.';
  }

  const obj = metrics as Record<string, unknown>;
  const expectedKeys = new Set<string>(SUPPORTING_METRICS);
  const actualKeys = new Set(Object.keys(obj));

  for (const key of expectedKeys) {
    if (!actualKeys.has(key)) {
      return `Missing supporting metric key: ${key}`;
    }
  }

  for (const key of actualKeys) {
    if (!expectedKeys.has(key)) {
      return `Unknown supporting metric key: ${key}`;
    }
  }

  for (const key of expectedKeys) {
    const entry = obj[key];
    if (typeof entry !== 'object' || entry === null) {
      return `Supporting metric "${key}" must be a non-null object with { value, previous }.`;
    }

    const mv = entry as Record<string, unknown>;
    if (typeof mv.value !== 'number' || !Number.isFinite(mv.value)) {
      return `Supporting metric "${key}.value" must be a finite number.`;
    }

    if (mv.previous !== null && (typeof mv.previous !== 'number' || !Number.isFinite(mv.previous))) {
      return `Supporting metric "${key}.previous" must be a finite number or null.`;
    }
  }

  return null;
}

/**
 * Validate a funnel stage row array.
 * Returns an error string or null if valid.
 */
export function validateFunnelStages(stages: unknown): string | null {
  if (!Array.isArray(stages)) {
    return 'Funnel stages must be an array.';
  }

  const expectedStages = new Set<string>(FUNNEL_STAGES);
  const seenStages = new Set<string>();

  for (const row of stages) {
    if (typeof row !== 'object' || row === null) {
      return 'Each funnel stage must be a non-null object.';
    }

    const r = row as Record<string, unknown>;

    if (typeof r.stage !== 'string' || !isFunnelStage(r.stage)) {
      return `Invalid funnel stage: ${String(r.stage)}. Expected one of: ${FUNNEL_STAGES.join(', ')}`;
    }

    if (seenStages.has(r.stage)) {
      return `Duplicate funnel stage: ${r.stage}`;
    }
    seenStages.add(r.stage);

    if (typeof r.label !== 'string' || r.label.length === 0) {
      return `Funnel stage "${r.stage}" must have a non-empty label.`;
    }

    if (typeof r.value !== 'number' || !Number.isFinite(r.value)) {
      return `Funnel stage "${r.stage}.value" must be a finite number.`;
    }

    if (typeof r.position !== 'number' || !Number.isInteger(r.position)) {
      return `Funnel stage "${r.stage}.position" must be an integer.`;
    }
  }

  for (const expected of expectedStages) {
    if (!seenStages.has(expected)) {
      return `Missing funnel stage: ${expected}`;
    }
  }

  return null;
}
