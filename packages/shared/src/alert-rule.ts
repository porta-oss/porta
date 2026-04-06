// Alert rule and alert contracts shared across API, worker, and UI.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ALERT_CONDITIONS = [
  "drop_wow_pct",
  "spike_vs_avg",
  "below_threshold",
  "above_threshold",
] as const;
export type AlertCondition = (typeof ALERT_CONDITIONS)[number];

export const ALERT_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = [
  "active",
  "acknowledged",
  "snoozed",
  "dismissed",
  "resolved",
] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const alertRuleSchema = z.object({
  condition: z.enum(ALERT_CONDITIONS),
  enabled: z.boolean().default(true),
  metricKey: z.string().min(1).max(100),
  minDataPoints: z.number().int().min(1).max(365).default(7),
  severity: z.enum(ALERT_SEVERITIES).default("medium"),
  threshold: z.number().gt(0).lte(10_000),
});

export type AlertRuleInput = z.infer<typeof alertRuleSchema>;

// ---------------------------------------------------------------------------
// Summary interfaces — returned to the UI, never includes raw DB internals
// ---------------------------------------------------------------------------

export interface AlertRuleSummary {
  condition: AlertCondition;
  createdAt: string;
  enabled: boolean;
  id: string;
  metricKey: string;
  minDataPoints: number;
  severity: AlertSeverity;
  startupId: string;
  threshold: number;
  updatedAt: string;
}

export interface AlertSummary {
  firedAt: string;
  id: string;
  lastFiredAt: string;
  metricKey: string;
  occurrenceCount: number;
  resolvedAt: string | null;
  ruleId: string;
  severity: AlertSeverity;
  snoozedUntil: string | null;
  startupId: string;
  status: AlertStatus;
  threshold: number;
  value: number;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isAlertCondition(value: string): value is AlertCondition {
  return ALERT_CONDITIONS.includes(value as AlertCondition);
}

export function isAlertSeverity(value: string): value is AlertSeverity {
  return ALERT_SEVERITIES.includes(value as AlertSeverity);
}

export function isAlertStatus(value: string): value is AlertStatus {
  return ALERT_STATUSES.includes(value as AlertStatus);
}
