// Startup-insight contract shared across API, worker, and UI.
// Defines the deterministic condition codes, evidence packet shape,
// AI explanation labels, and bounded founder-action contract.
//
// Deterministic evidence is computed from health snapshots and connector
// freshness — it is never AI-generated. The AI explanation is produced by
// the worker's explainer boundary and carries labeled observation,
// hypothesis, and 1–3 actions.
//
// Never persist raw connector configs, provider payload bodies, or
// unredacted prompt content in insight data.

// ---------------------------------------------------------------------------
// Condition codes — deterministic v1 conditions detected from synced data
// ---------------------------------------------------------------------------

export const INSIGHT_CONDITION_CODES = [
  "mrr_declining",
  "churn_spike",
  "trial_conversion_drop",
  "funnel_bottleneck",
  "no_condition_detected",
] as const;
export type InsightConditionCode = (typeof INSIGHT_CONDITION_CODES)[number];

export function isInsightConditionCode(
  value: string
): value is InsightConditionCode {
  return INSIGHT_CONDITION_CODES.includes(value as InsightConditionCode);
}

/** Human-readable labels for each condition code. */
export const INSIGHT_CONDITION_LABELS: Record<InsightConditionCode, string> = {
  mrr_declining: "MRR Declining",
  churn_spike: "Churn Spike",
  trial_conversion_drop: "Trial Conversion Drop",
  funnel_bottleneck: "Funnel Bottleneck",
  no_condition_detected: "No Condition Detected",
} as const;

// ---------------------------------------------------------------------------
// Generation status — tracks what happened during the last attempt
// ---------------------------------------------------------------------------

export const INSIGHT_GENERATION_STATUSES = [
  "success",
  "skipped_blocked",
  "skipped_stale",
  "skipped_no_condition",
  "failed_explainer",
  "failed_persistence",
] as const;
export type InsightGenerationStatus =
  (typeof INSIGHT_GENERATION_STATUSES)[number];

export function isInsightGenerationStatus(
  value: string
): value is InsightGenerationStatus {
  return INSIGHT_GENERATION_STATUSES.includes(value as InsightGenerationStatus);
}

// ---------------------------------------------------------------------------
// Evidence packet — deterministic, never AI-generated
// ---------------------------------------------------------------------------

/** A single evidence item referencing a specific metric or data point. */
export interface EvidenceItem {
  /** Current value. */
  currentValue: number;
  /** Direction of change. */
  direction: "up" | "down" | "flat";
  /** Human-readable label for the metric. */
  label: string;
  /** Which metric or signal produced this evidence. */
  metricKey: string;
  /** Previous value for comparison, null if unavailable. */
  previousValue: number | null;
}

/** The complete evidence packet attached to an insight. */
export interface EvidencePacket {
  conditionCode: InsightConditionCode;
  items: EvidenceItem[];
  /** ISO timestamp when the source health snapshot was computed. */
  snapshotComputedAt: string;
  /** The sync job that triggered the snapshot, if any. */
  syncJobId: string | null;
}

// ---------------------------------------------------------------------------
// AI explanation — produced by the explainer boundary
// ---------------------------------------------------------------------------

/** A single recommended action for the founder. */
export interface InsightAction {
  /** Short imperative label, e.g. "Review churn cohorts". */
  label: string;
  /** One-sentence rationale. */
  rationale: string;
}

/** The AI-authored explanation attached to an insight. */
export interface InsightExplanation {
  /** 1–3 concrete actions for the founder. */
  actions: InsightAction[];
  /** Labeled hypothesis: why this might be happening. */
  hypothesis: string;
  /** Latency in milliseconds for the explainer call. */
  latencyMs: number;
  /** Which model produced the explanation (e.g. "claude-sonnet-4-20250514"). */
  model: string;
  /** Labeled observation: what the data shows. */
  observation: string;
}

// ---------------------------------------------------------------------------
// Latest insight — the persisted read model
// ---------------------------------------------------------------------------

/** The full insight payload returned by the API and consumed by the UI. */
export interface LatestInsightPayload {
  /** Current condition code. */
  conditionCode: InsightConditionCode;
  /** Deterministic evidence packet. */
  evidence: EvidencePacket;
  /** AI-authored explanation, null if generation was skipped or failed. */
  explanation: InsightExplanation | null;
  /** Timestamp when this insight was generated. */
  generatedAt: string;
  /** Status of the last generation attempt. */
  generationStatus: InsightGenerationStatus;
  /** Last error message from a failed generation attempt, null on success. */
  lastError: string | null;
  startupId: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Minimum number of actions per insight. */
export const MIN_INSIGHT_ACTIONS = 1;
/** Maximum number of actions per insight. */
export const MAX_INSIGHT_ACTIONS = 3;
const VALID_EVIDENCE_DIRECTIONS = new Set(["up", "down", "flat"]);

/**
 * Validate that an actions array has 1–3 entries with non-empty labels.
 * Returns an error string or null if valid.
 */
export function validateInsightActions(actions: unknown): string | null {
  if (!Array.isArray(actions)) {
    return "Insight actions must be an array.";
  }

  if (
    actions.length < MIN_INSIGHT_ACTIONS ||
    actions.length > MAX_INSIGHT_ACTIONS
  ) {
    return `Insight must have ${MIN_INSIGHT_ACTIONS}–${MAX_INSIGHT_ACTIONS} actions, got ${actions.length}.`;
  }

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i] as unknown;
    if (typeof action !== "object" || action === null) {
      return `Action at index ${i} must be a non-null object.`;
    }

    const a = action as Record<string, unknown>;
    if (typeof a.label !== "string" || a.label.trim().length === 0) {
      return `Action at index ${i} must have a non-empty label.`;
    }

    if (typeof a.rationale !== "string" || a.rationale.trim().length === 0) {
      return `Action at index ${i} must have a non-empty rationale.`;
    }
  }

  return null;
}

function validateEvidenceItem(item: unknown, index: number): string | null {
  if (typeof item !== "object" || item === null) {
    return `Evidence item at index ${index} must be a non-null object.`;
  }

  const evidenceItem = item as Record<string, unknown>;

  if (
    typeof evidenceItem.metricKey !== "string" ||
    evidenceItem.metricKey.trim().length === 0
  ) {
    return `Evidence item at index ${index} must have a non-empty metricKey.`;
  }
  if (
    typeof evidenceItem.label !== "string" ||
    evidenceItem.label.trim().length === 0
  ) {
    return `Evidence item at index ${index} must have a non-empty label.`;
  }
  if (
    typeof evidenceItem.currentValue !== "number" ||
    !Number.isFinite(evidenceItem.currentValue)
  ) {
    return `Evidence item at index ${index} must have a finite currentValue.`;
  }
  if (
    evidenceItem.previousValue !== null &&
    (typeof evidenceItem.previousValue !== "number" ||
      !Number.isFinite(evidenceItem.previousValue))
  ) {
    return `Evidence item at index ${index} previousValue must be a finite number or null.`;
  }
  if (
    typeof evidenceItem.direction !== "string" ||
    !VALID_EVIDENCE_DIRECTIONS.has(evidenceItem.direction)
  ) {
    return `Evidence item at index ${index} direction must be "up", "down", or "flat".`;
  }

  return null;
}

/**
 * Validate an evidence packet shape.
 * Returns an error string or null if valid.
 */
export function validateEvidencePacket(packet: unknown): string | null {
  if (typeof packet !== "object" || packet === null) {
    return "Evidence packet must be a non-null object.";
  }

  const p = packet as Record<string, unknown>;

  if (
    typeof p.conditionCode !== "string" ||
    !isInsightConditionCode(p.conditionCode)
  ) {
    return `Invalid condition code: ${String(p.conditionCode)}. Expected one of: ${INSIGHT_CONDITION_CODES.join(", ")}`;
  }

  if (!Array.isArray(p.items)) {
    return "Evidence packet items must be an array.";
  }

  for (let i = 0; i < p.items.length; i++) {
    const itemError = validateEvidenceItem(p.items[i], i);
    if (itemError) {
      return itemError;
    }
  }

  if (
    typeof p.snapshotComputedAt !== "string" ||
    p.snapshotComputedAt.trim().length === 0
  ) {
    return "Evidence packet must have a non-empty snapshotComputedAt.";
  }

  if (p.syncJobId !== null && typeof p.syncJobId !== "string") {
    return "Evidence packet syncJobId must be a string or null.";
  }

  return null;
}

/**
 * Validate a full InsightExplanation shape.
 * Returns an error string or null if valid.
 */
export function validateInsightExplanation(
  explanation: unknown
): string | null {
  if (typeof explanation !== "object" || explanation === null) {
    return "Insight explanation must be a non-null object.";
  }

  const e = explanation as Record<string, unknown>;

  if (typeof e.observation !== "string" || e.observation.trim().length === 0) {
    return "Insight explanation must have a non-empty observation.";
  }

  if (typeof e.hypothesis !== "string" || e.hypothesis.trim().length === 0) {
    return "Insight explanation must have a non-empty hypothesis.";
  }

  const actionsErr = validateInsightActions(e.actions);
  if (actionsErr !== null) {
    return actionsErr;
  }

  if (typeof e.model !== "string" || e.model.trim().length === 0) {
    return "Insight explanation must have a non-empty model identifier.";
  }

  if (
    typeof e.latencyMs !== "number" ||
    !Number.isFinite(e.latencyMs) ||
    e.latencyMs < 0
  ) {
    return "Insight explanation latencyMs must be a non-negative finite number.";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Build an evidence direction from current and previous values.
 */
export function computeDirection(
  current: number,
  previous: number | null
): "up" | "down" | "flat" {
  if (previous === null) {
    return "flat";
  }
  if (current > previous) {
    return "up";
  }
  if (current < previous) {
    return "down";
  }
  return "flat";
}
