// MCP tool input/output schemas shared across API and MCP clients.
// All 8 tools: 5 read (get_metrics, get_alerts, get_at_risk_customers,
// get_activity_log, get_portfolio_summary) and 3 write (create_task,
// snooze_alert, trigger_sync).

import type { z } from "zod";
import { z as zod } from "zod";

import { ALERT_SEVERITIES, ALERT_STATUSES } from "./alert-rule";
import { EVENT_TYPES } from "./event-log";
import { HEALTH_STATES } from "./startup-health";

// ---------------------------------------------------------------------------
// Common response wrappers
// ---------------------------------------------------------------------------

const paginationSchema = zod.object({
  cursor: zod.string().nullable(),
  hasMore: zod.boolean(),
  limit: zod.number().int().positive(),
});

export type McpPagination = z.infer<typeof paginationSchema>;

/**
 * Factory that wraps a data schema in the standard MCP response envelope.
 * Use: `mcpResponse(z.array(metricValueSchema))` etc.
 */
export function mcpResponse<T extends z.ZodTypeAny>(dataSchema: T) {
  return zod.object({
    dashboardUrl: zod.string(),
    data: dataSchema,
    dataAsOf: zod.string(),
    pagination: paginationSchema.optional(),
  });
}

export const mcpErrorResponseSchema = zod.object({
  code: zod.enum(["NOT_FOUND", "FORBIDDEN", "RATE_LIMITED", "INTERNAL"]),
  error: zod.string(),
  retryAfter: zod.number().int().positive().optional(),
});

export type McpErrorResponse = z.infer<typeof mcpErrorResponseSchema>;

export const MCP_ERROR_CODES = [
  "NOT_FOUND",
  "FORBIDDEN",
  "RATE_LIMITED",
  "INTERNAL",
] as const;
export type McpErrorCode = (typeof MCP_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Metric categories (shared between custom-metric and MCP)
// ---------------------------------------------------------------------------

export const METRIC_CATEGORIES = [
  "engagement",
  "revenue",
  "health",
  "growth",
  "custom",
] as const;
export type MetricCategory = (typeof METRIC_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Tool 1: get_metrics
// ---------------------------------------------------------------------------

export const getMetricsInputSchema = zod.object({
  category: zod.enum(METRIC_CATEGORIES).optional(),
  dateRange: zod
    .object({
      from: zod.string(),
      to: zod.string(),
    })
    .optional(),
  metricKeys: zod.array(zod.string()).optional(),
  startupId: zod.string().min(1),
});

export type GetMetricsInput = z.infer<typeof getMetricsInputSchema>;

export const mcpMetricValueSchema = zod.object({
  category: zod.enum(METRIC_CATEGORIES),
  delta: zod.number().nullable(),
  isUniversal: zod.boolean(),
  key: zod.string(),
  label: zod.string(),
  previousValue: zod.number().nullable(),
  source: zod.string(),
  unit: zod.string(),
  value: zod.number(),
});

export type McpMetricValue = z.infer<typeof mcpMetricValueSchema>;

export const getMetricsOutputSchema = mcpResponse(
  zod.array(mcpMetricValueSchema)
);

export type GetMetricsOutput = z.infer<typeof getMetricsOutputSchema>;

// ---------------------------------------------------------------------------
// Tool 2: get_alerts
// ---------------------------------------------------------------------------

export const getAlertsInputSchema = zod.object({
  startupId: zod.string().min(1).optional(),
  status: zod.enum(ALERT_STATUSES).optional(),
});

export type GetAlertsInput = z.infer<typeof getAlertsInputSchema>;

export const mcpAlertSchema = zod.object({
  firedAt: zod.string(),
  id: zod.string(),
  metricKey: zod.string(),
  occurrenceCount: zod.number().int(),
  ruleId: zod.string(),
  severity: zod.enum(ALERT_SEVERITIES),
  startupId: zod.string(),
  status: zod.enum(ALERT_STATUSES),
  threshold: zod.number(),
  value: zod.number(),
});

export type McpAlert = z.infer<typeof mcpAlertSchema>;

export const getAlertsOutputSchema = mcpResponse(zod.array(mcpAlertSchema));

export type GetAlertsOutput = z.infer<typeof getAlertsOutputSchema>;

// ---------------------------------------------------------------------------
// Tool 3: get_at_risk_customers
// ---------------------------------------------------------------------------

export const getAtRiskCustomersInputSchema = zod.object({
  startupId: zod.string().min(1),
});

export type GetAtRiskCustomersInput = z.infer<
  typeof getAtRiskCustomersInputSchema
>;

export const mcpAtRiskCustomerSchema = zod.object({
  evaluableCriteria: zod.array(zod.string()),
  identifier: zod.string(),
  lastActivityDate: zod.string().nullable(),
  lastPaymentDate: zod.string().nullable(),
  riskReasons: zod.array(zod.string()),
});

export type McpAtRiskCustomer = z.infer<typeof mcpAtRiskCustomerSchema>;

export const getAtRiskCustomersOutputSchema = mcpResponse(
  zod.array(mcpAtRiskCustomerSchema)
);

export type GetAtRiskCustomersOutput = z.infer<
  typeof getAtRiskCustomersOutputSchema
>;

// ---------------------------------------------------------------------------
// Tool 4: get_activity_log
// ---------------------------------------------------------------------------

export const getActivityLogInputSchema = zod.object({
  cursor: zod.string().optional(),
  dateRange: zod
    .object({
      from: zod.string(),
      to: zod.string(),
    })
    .optional(),
  eventTypes: zod.array(zod.enum(EVENT_TYPES)).optional(),
  limit: zod.number().int().min(1).max(200).default(50).optional(),
  startupId: zod.string().min(1).optional(),
});

export type GetActivityLogInput = z.infer<typeof getActivityLogInputSchema>;

export const mcpActivityLogEntrySchema = zod.object({
  actorId: zod.string().nullable(),
  actorType: zod.string(),
  createdAt: zod.string(),
  eventType: zod.enum(EVENT_TYPES),
  id: zod.string(),
  payload: zod.record(zod.string(), zod.unknown()),
  startupId: zod.string().nullable(),
  workspaceId: zod.string(),
});

export type McpActivityLogEntry = z.infer<typeof mcpActivityLogEntrySchema>;

export const getActivityLogOutputSchema = mcpResponse(
  zod.array(mcpActivityLogEntrySchema)
);

export type GetActivityLogOutput = z.infer<typeof getActivityLogOutputSchema>;

// ---------------------------------------------------------------------------
// Tool 5: get_portfolio_summary
// ---------------------------------------------------------------------------

export const getPortfolioSummaryInputSchema = zod.object({});

export type GetPortfolioSummaryInput = z.infer<
  typeof getPortfolioSummaryInputSchema
>;

export const mcpStartupSummarySchema = zod.object({
  activeAlerts: zod.number().int(),
  currency: zod.string(),
  customMetricCount: zod.number().int(),
  healthState: zod.enum(HEALTH_STATES),
  id: zod.string(),
  lastSyncAt: zod.string().nullable(),
  name: zod.string(),
  northStarDelta: zod.number().nullable(),
  northStarKey: zod.string(),
  northStarValue: zod.number().nullable(),
  type: zod.string(),
  universalMetrics: zod.record(zod.string(), zod.number().nullable()),
});

export type McpStartupSummary = z.infer<typeof mcpStartupSummarySchema>;

export const mcpPortfolioSummarySchema = zod.object({
  aiSynthesis: zod.string().optional(),
  startups: zod.array(mcpStartupSummarySchema),
  synthesizedAt: zod.string().optional(),
});

export type McpPortfolioSummary = z.infer<typeof mcpPortfolioSummarySchema>;

export const getPortfolioSummaryOutputSchema = mcpResponse(
  mcpPortfolioSummarySchema
);

export type GetPortfolioSummaryOutput = z.infer<
  typeof getPortfolioSummaryOutputSchema
>;

// ---------------------------------------------------------------------------
// Tool 6: create_task
// ---------------------------------------------------------------------------

export const TASK_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const createTaskInputSchema = zod.object({
  description: zod.string().max(2000).optional(),
  priority: zod.enum(TASK_PRIORITIES).default("medium").optional(),
  startupId: zod.string().min(1),
  title: zod.string().min(1).max(200),
});

export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

export const mcpTaskSchema = zod.object({
  createdAt: zod.string(),
  description: zod.string().nullable(),
  id: zod.string(),
  priority: zod.string(),
  startupId: zod.string(),
  syncStatus: zod.string(),
  title: zod.string(),
});

export type McpTask = z.infer<typeof mcpTaskSchema>;

export const createTaskOutputSchema = mcpResponse(
  zod.object({ task: mcpTaskSchema })
);

export type CreateTaskOutput = z.infer<typeof createTaskOutputSchema>;

// ---------------------------------------------------------------------------
// Tool 7: snooze_alert
// ---------------------------------------------------------------------------

export const snoozeAlertInputSchema = zod.object({
  alertId: zod.string().min(1),
  duration: zod.number().int().min(1).max(168).default(24).optional(),
});

export type SnoozeAlertInput = z.infer<typeof snoozeAlertInputSchema>;

export const snoozeAlertOutputSchema = mcpResponse(
  zod.object({ alert: mcpAlertSchema })
);

export type SnoozeAlertOutput = z.infer<typeof snoozeAlertOutputSchema>;

// ---------------------------------------------------------------------------
// Tool 8: trigger_sync
// ---------------------------------------------------------------------------

export const triggerSyncInputSchema = zod.object({
  connectorId: zod.string().min(1).optional(),
  startupId: zod.string().min(1),
});

export type TriggerSyncInput = z.infer<typeof triggerSyncInputSchema>;

export const mcpSyncJobSchema = zod.object({
  connectorId: zod.string(),
  createdAt: zod.string(),
  id: zod.string(),
  provider: zod.string(),
  status: zod.literal("queued"),
  trigger: zod.literal("manual"),
});

export type McpSyncJob = z.infer<typeof mcpSyncJobSchema>;

export const triggerSyncOutputSchema = mcpResponse(
  zod.object({ syncJobs: zod.array(mcpSyncJobSchema) })
);

export type TriggerSyncOutput = z.infer<typeof triggerSyncOutputSchema>;
