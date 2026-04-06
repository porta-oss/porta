// Alert evaluation engine — evaluates enabled alert rules for a startup,
// applies z-score anomaly detection, handles dedup, and emits events.

import type { AlertCondition, AlertSeverity } from "@shared/alert-rule";
import { isAlertCondition } from "@shared/alert-rule";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { alert, alertRule } from "../../db/schema/alert-rule";
import { eventLog } from "../../db/schema/event-log";
import { startup } from "../../db/schema/startup";
import {
  healthSnapshot,
  healthSnapshotHistory,
} from "../../db/schema/startup-health";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const Z_SCORE_THRESHOLD = 2.5;
const HISTORY_WINDOW_DAYS = 30;

// Conditions that require z-score guard
const Z_GUARDED_CONDITIONS: ReadonlySet<AlertCondition> = new Set([
  "drop_wow_pct",
  "spike_vs_avg",
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface HistoryStats {
  mean: number;
  previousValue: number;
  stddev: number;
  values: number[];
}

function computeStats(values: number[]): HistoryStats {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  // Values are ordered most-recent first, so [0] is the most recent history entry
  const previousValue = values[0];
  return { mean, previousValue, stddev, values };
}

function computeZScore(current: number, mean: number, stddev: number): number {
  if (stddev === 0) {
    return Number.NaN;
  }
  return Math.abs(current - mean) / stddev;
}

/**
 * Evaluate a single condition against the current value and history stats.
 * Returns true if the condition fires.
 */
function evaluateCondition(
  condition: AlertCondition,
  current: number,
  threshold: number,
  stats: HistoryStats
): boolean {
  switch (condition) {
    case "drop_wow_pct": {
      const prev = stats.previousValue;
      if (prev === 0) {
        return false; // skip division by zero
      }
      const dropPct = ((prev - current) / prev) * 100;
      return dropPct >= threshold;
    }
    case "spike_vs_avg": {
      if (stats.mean === 0) {
        return false;
      }
      const ratio = current / stats.mean;
      return ratio >= threshold;
    }
    case "below_threshold":
      return current < threshold;
    case "above_threshold":
      return current > threshold;
    default:
      return false;
  }
}

/**
 * Check if the z-score guard passes. For z-guarded conditions, the z-score
 * must be >= 2.5 unless stddev is 0 (constant values bypass the guard).
 */
function passesZScoreGuard(
  condition: AlertCondition,
  current: number,
  stats: HistoryStats
): boolean {
  if (!Z_GUARDED_CONDITIONS.has(condition)) {
    return true;
  }
  const z = computeZScore(current, stats.mean, stats.stddev);
  // SD=0 → z is NaN → bypass guard (fire based on condition alone)
  if (Number.isNaN(z)) {
    return true;
  }
  return z >= Z_SCORE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Main evaluation function
// ---------------------------------------------------------------------------

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
  startupId: string,
  db: EvaluatorDb
): Promise<EvaluationResult[]> {
  const drizzle = db as unknown as NodePgDatabase;

  // 0. Fetch startup for workspaceId (needed for event emission)
  const [startupRow] = await drizzle
    .select({ workspaceId: startup.workspaceId })
    .from(startup)
    .where(eq(startup.id, startupId))
    .limit(1);

  if (!startupRow) {
    return [];
  }

  // 1. Load all enabled alert rules for this startup
  const rules = await drizzle
    .select()
    .from(alertRule)
    .where(
      and(eq(alertRule.startupId, startupId), eq(alertRule.enabled, true))
    );

  if (rules.length === 0) {
    return [];
  }

  // 2. Load current health snapshot for metric values
  const [snapshot] = await drizzle
    .select({
      northStarKey: healthSnapshot.northStarKey,
      northStarValue: healthSnapshot.northStarValue,
      supportingMetrics: healthSnapshot.supportingMetrics,
    })
    .from(healthSnapshot)
    .where(eq(healthSnapshot.startupId, startupId))
    .limit(1);

  if (!snapshot) {
    return [];
  }

  const supportingMetrics = (snapshot.supportingMetrics ?? {}) as Record<
    string,
    number
  >;

  // 3. Evaluate each rule
  const results: EvaluationResult[] = [];
  const cutoff = new Date(
    Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  for (const rule of rules) {
    const condition = rule.condition as string;
    if (!isAlertCondition(condition)) {
      continue;
    }

    // Look up current metric value
    const currentValue = lookupMetric(
      rule.metricKey,
      snapshot.northStarKey,
      snapshot.northStarValue,
      supportingMetrics
    );
    if (currentValue === undefined) {
      continue;
    }

    // Load history for this metric (30-day window, most recent first)
    const historyRows = await drizzle
      .select({ value: healthSnapshotHistory.value })
      .from(healthSnapshotHistory)
      .where(
        and(
          eq(healthSnapshotHistory.startupId, startupId),
          eq(healthSnapshotHistory.metricKey, rule.metricKey),
          gte(healthSnapshotHistory.capturedAt, cutoff)
        )
      )
      .orderBy(desc(healthSnapshotHistory.capturedAt));

    const historyValues = historyRows.map((r) => Number(r.value));

    // Skip if insufficient data points
    if (historyValues.length < rule.minDataPoints) {
      continue;
    }

    const stats = computeStats(historyValues);

    // Evaluate condition
    if (
      !evaluateCondition(condition, currentValue, Number(rule.threshold), stats)
    ) {
      continue;
    }

    // Apply z-score guard
    if (!passesZScoreGuard(condition, currentValue, stats)) {
      continue;
    }

    // Dedup: check for existing active/snoozed alert for same rule+startup
    const existingAlerts = await drizzle
      .select({ id: alert.id, occurrenceCount: alert.occurrenceCount })
      .from(alert)
      .where(
        and(
          eq(alert.ruleId, rule.id),
          eq(alert.startupId, startupId),
          inArray(alert.status, ["active", "snoozed"])
        )
      )
      .limit(1);

    const now = new Date();

    if (existingAlerts.length > 0) {
      // Update existing alert: increment occurrence_count, update last_fired_at and value
      const existing = existingAlerts[0];
      await drizzle
        .update(alert)
        .set({
          occurrenceCount: sql`${alert.occurrenceCount} + 1`,
          lastFiredAt: now,
          value: String(currentValue),
        })
        .where(eq(alert.id, existing.id));

      results.push({
        alertId: existing.id,
        isNew: false,
        metricKey: rule.metricKey,
        ruleId: rule.id,
        severity: rule.severity as AlertSeverity,
        value: currentValue,
      });
    } else {
      // Insert new alert
      const alertId = crypto.randomUUID();
      await drizzle.insert(alert).values({
        id: alertId,
        startupId,
        ruleId: rule.id,
        metricKey: rule.metricKey,
        severity: rule.severity,
        value: String(currentValue),
        threshold: rule.threshold,
        status: "active",
        occurrenceCount: 1,
        firedAt: now,
        lastFiredAt: now,
      });

      results.push({
        alertId,
        isNew: true,
        metricKey: rule.metricKey,
        ruleId: rule.id,
        severity: rule.severity as AlertSeverity,
        value: currentValue,
      });
    }

    // Emit alert.fired event (fire-and-forget)
    drizzle
      .insert(eventLog)
      .values({
        workspaceId: startupRow.workspaceId,
        startupId,
        eventType: "alert.fired",
        actorType: "system",
        actorId: null,
        payload: {
          ruleId: rule.id,
          metricKey: rule.metricKey,
          severity: rule.severity,
          value: currentValue,
          threshold: Number(rule.threshold),
        },
      })
      .catch(() => {
        // Silent — event log failures must not block alert evaluation
      });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lookupMetric(
  metricKey: string,
  northStarKey: string,
  northStarValue: string | null,
  supportingMetrics: Record<string, number>
): number | undefined {
  // Check supporting metrics first (always present as JSONB)
  if (metricKey in supportingMetrics) {
    return supportingMetrics[metricKey];
  }
  // Fall back to north star if key matches
  if (metricKey === northStarKey && northStarValue != null) {
    return Number(northStarValue);
  }
  return undefined;
}
