// Alert evaluation engine — evaluates enabled alert rules for a startup,
// applies z-score anomaly detection, handles dedup, and emits events.
//
// Stub — implementation in Task 3.

import type { AlertSeverity } from "@shared/alert-rule";

/** Result of evaluating a single alert rule. */
export interface EvaluationResult {
  alertId: string;
  isNew: boolean;
  metricKey: string;
  ruleId: string;
  severity: AlertSeverity;
  value: number;
}

/** Minimal DB interface for alert evaluation (satisfied by Drizzle instance). */
export interface EvaluatorDb {
  execute: (query: unknown) => Promise<unknown>;
  insert: (table: unknown) => { values: (v: unknown) => unknown };
  select: (fields?: unknown) => unknown;
  update: (table: unknown) => unknown;
}

/**
 * Evaluate all enabled alert rules for a startup.
 *
 * Algorithm per rule:
 * 1. Look up current metric value (north star or supporting metrics)
 * 2. Load 30-day history from health_snapshot_history
 * 3. Skip if history.length < rule.minDataPoints
 * 4. Evaluate condition (drop_wow_pct, spike_vs_avg, below/above_threshold)
 * 5. Apply z-score guard (>= 2.5) for drop_wow_pct and spike_vs_avg
 * 6. Dedup: increment occurrence if active/snoozed alert exists for same rule
 * 7. Emit alert.fired event
 */
export async function evaluateAlerts(
  _startupId: string,
  _db: EvaluatorDb
): Promise<EvaluationResult[]> {
  // Stub — returns empty, all tests should fail (TDD red phase)
  return [];
}
