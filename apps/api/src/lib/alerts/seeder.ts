// Default alert rule seeder — seeds sensible alert rules for a startup
// after its first sync, based on which metrics actually arrived.

import type { AlertCondition, AlertSeverity } from "@shared/alert-rule";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { alertRule } from "../../db/schema/alert-rule";

// ---------------------------------------------------------------------------
// Default rule definitions — seeded when a startup has no rules yet
// ---------------------------------------------------------------------------

interface DefaultRuleConfig {
  condition: AlertCondition;
  metricKey: string;
  severity: AlertSeverity;
  threshold: number;
}

const DEFAULT_RULES: readonly DefaultRuleConfig[] = [
  {
    condition: "drop_wow_pct",
    metricKey: "mrr",
    severity: "critical",
    threshold: 20,
  },
  {
    condition: "drop_wow_pct",
    metricKey: "active_users",
    severity: "high",
    threshold: 25,
  },
  {
    condition: "above_threshold",
    metricKey: "churn_rate",
    severity: "high",
    threshold: 10,
  },
  {
    condition: "spike_vs_avg",
    metricKey: "error_rate",
    severity: "critical",
    threshold: 3,
  },
  {
    condition: "spike_vs_avg",
    metricKey: "yookassa_failed_payments",
    severity: "high",
    threshold: 2,
  },
  {
    condition: "drop_wow_pct",
    metricKey: "active_installs",
    severity: "high",
    threshold: 25,
  },
  {
    condition: "drop_wow_pct",
    metricKey: "active_families",
    severity: "high",
    threshold: 25,
  },
] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Seed default alert rules for a startup after its first sync.
 *
 * - Skips entirely if the startup already has any alert rules.
 * - Only seeds rules for metrics present in `availableMetricKeys`.
 */
export async function seedDefaultAlerts(
  startupId: string,
  availableMetricKeys: readonly string[],
  db: unknown
): Promise<number> {
  const drizzle = db as NodePgDatabase;

  // Check if startup already has alert rules — skip if any exist
  const existing = await drizzle
    .select({ id: alertRule.id })
    .from(alertRule)
    .where(eq(alertRule.startupId, startupId))
    .limit(1);

  if (existing.length > 0) {
    return 0;
  }

  const metricSet = new Set(availableMetricKeys);

  // Filter default rules to only those whose metricKey is available
  const toSeed = DEFAULT_RULES.filter((r) => metricSet.has(r.metricKey));

  if (toSeed.length === 0) {
    return 0;
  }

  // Insert all matching rules
  await drizzle.insert(alertRule).values(
    toSeed.map((r) => ({
      startupId,
      metricKey: r.metricKey,
      condition: r.condition,
      threshold: String(r.threshold),
      severity: r.severity,
      enabled: true,
      minDataPoints: 7,
    }))
  );

  return toSeed.length;
}

/** Exposed for testing. */
export { DEFAULT_RULES };
