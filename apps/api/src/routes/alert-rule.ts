// Alert rule CRUD + triage routes.
// All routes require an authenticated session with an active workspace.
// Provides create, list, update, and delete for alert rules scoped to a startup,
// plus alert listing, single triage, and bulk triage.

import type {
  AlertCondition,
  AlertRuleSummary,
  AlertSeverity,
  AlertStatus,
  AlertSummary,
} from "@shared/alert-rule";
import { ALERT_STATUSES, alertRuleSchema } from "@shared/alert-rule";
import type { EventType } from "@shared/event-log";
import { and, eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/node-postgres";

import { alert, alertRule } from "../db/schema/alert-rule";
import { eventLog } from "../db/schema/event-log";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface AlertRuleRuntime {
  db: {
    db: ReturnType<typeof drizzle>;
  };
}

interface WorkspaceContext {
  workspace: { id: string };
}

interface AlertRuleRouteError {
  error: {
    code: string;
    message: string;
    retryable?: boolean;
  };
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getPgErrorCode(error: unknown): string | undefined {
  if (isRecord(error) && typeof error.code === "string") {
    return error.code;
  }
  if (isRecord(error) && "cause" in error) {
    return getPgErrorCode(error.cause);
  }
  return undefined;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function requireIsoTimestamp(
  value: Date | string | null | undefined,
  fieldName: string
): string {
  const iso = toIso(value);
  if (!iso) {
    throw new Error(`Expected ${fieldName} to be present.`);
  }
  return iso;
}

function createErrorResponse(
  set: { status?: number | string },
  status: number,
  error: AlertRuleRouteError["error"]
): AlertRuleRouteError {
  set.status = status;
  return { error };
}

interface AlertRuleRow {
  condition: string;
  createdAt: Date | string;
  enabled: boolean;
  id: string;
  metricKey: string;
  minDataPoints: number;
  severity: string;
  startupId: string;
  threshold: string;
  updatedAt: Date | string;
}

function serializeAlertRule(row: AlertRuleRow): AlertRuleSummary {
  return {
    condition: row.condition as AlertCondition,
    createdAt: requireIsoTimestamp(row.createdAt, "alertRule.createdAt"),
    enabled: row.enabled,
    id: row.id,
    metricKey: row.metricKey,
    minDataPoints: row.minDataPoints,
    severity: row.severity as AlertSeverity,
    startupId: row.startupId,
    threshold: Number(row.threshold),
    updatedAt: requireIsoTimestamp(row.updatedAt, "alertRule.updatedAt"),
  };
}

// ------------------------------------------------------------------
// Handlers
// ------------------------------------------------------------------

export async function handleCreateAlertRule(
  runtime: AlertRuleRuntime,
  _wsCtx: WorkspaceContext,
  startupId: string,
  body: unknown,
  set: { status?: number | string }
): Promise<{ rule: AlertRuleSummary } | AlertRuleRouteError> {
  if (!startupId) {
    return createErrorResponse(set, 400, {
      code: "STARTUP_ID_REQUIRED",
      message: "startupId is required.",
    });
  }

  const parsed = alertRuleSchema.safeParse(body);
  if (!parsed.success) {
    return createErrorResponse(set, 400, {
      code: "VALIDATION_FAILED",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }

  const input = parsed.data;

  try {
    const rows = await runtime.db.db
      .insert(alertRule)
      .values({
        startupId,
        metricKey: input.metricKey,
        condition: input.condition,
        threshold: String(input.threshold),
        severity: input.severity,
        enabled: input.enabled,
        minDataPoints: input.minDataPoints,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      return createErrorResponse(set, 500, {
        code: "ALERT_RULE_CREATE_FAILED",
        message: "Failed to create alert rule.",
      });
    }

    set.status = 201;
    return { rule: serializeAlertRule(row as AlertRuleRow) };
  } catch (error) {
    const pgCode = getPgErrorCode(error);

    if (pgCode === "23505") {
      return createErrorResponse(set, 409, {
        code: "ALERT_RULE_DUPLICATE",
        message:
          "An alert rule with the same metric and condition already exists for this startup.",
      });
    }

    console.error("[alert-rule] create failed", {
      startupId,
      error: error instanceof Error ? error.message : String(error),
    });

    return createErrorResponse(set, 500, {
      code: "ALERT_RULE_CREATE_FAILED",
      message: "Failed to create alert rule. Please retry.",
      retryable: true,
    });
  }
}

export async function handleListAlertRules(
  runtime: AlertRuleRuntime,
  _wsCtx: WorkspaceContext,
  startupId: string,
  set: { status?: number | string }
): Promise<{ rules: AlertRuleSummary[] } | AlertRuleRouteError> {
  if (!startupId) {
    return createErrorResponse(set, 400, {
      code: "STARTUP_ID_REQUIRED",
      message: "startupId is required.",
    });
  }

  try {
    const rows = await runtime.db.db
      .select()
      .from(alertRule)
      .where(eq(alertRule.startupId, startupId));

    return {
      rules: rows.map((r) => serializeAlertRule(r as AlertRuleRow)),
    };
  } catch (error) {
    console.error("[alert-rule] list failed", {
      startupId,
      error: error instanceof Error ? error.message : String(error),
    });

    return createErrorResponse(set, 500, {
      code: "ALERT_RULE_LIST_FAILED",
      message: "Failed to list alert rules. Please retry.",
      retryable: true,
    });
  }
}

export async function handleUpdateAlertRule(
  runtime: AlertRuleRuntime,
  _wsCtx: WorkspaceContext,
  startupId: string,
  ruleId: string,
  body: unknown,
  set: { status?: number | string }
): Promise<{ rule: AlertRuleSummary } | AlertRuleRouteError> {
  if (!(startupId && ruleId)) {
    return createErrorResponse(set, 400, {
      code: "PARAMS_REQUIRED",
      message: "startupId and ruleId are required.",
    });
  }

  const updateSchema = alertRuleSchema.partial();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return createErrorResponse(set, 400, {
      code: "VALIDATION_FAILED",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }

  const input = parsed.data;

  // Build update payload — only include fields that were provided
  const updates: Record<string, unknown> = {};
  if (input.threshold !== undefined) {
    updates.threshold = String(input.threshold);
  }
  if (input.severity !== undefined) {
    updates.severity = input.severity;
  }
  if (input.enabled !== undefined) {
    updates.enabled = input.enabled;
  }
  if (input.minDataPoints !== undefined) {
    updates.minDataPoints = input.minDataPoints;
  }
  if (input.condition !== undefined) {
    updates.condition = input.condition;
  }
  if (input.metricKey !== undefined) {
    updates.metricKey = input.metricKey;
  }

  if (Object.keys(updates).length === 0) {
    return createErrorResponse(set, 400, {
      code: "NO_UPDATES",
      message: "No valid fields to update.",
    });
  }

  try {
    const rows = await runtime.db.db
      .update(alertRule)
      .set(updates)
      .where(and(eq(alertRule.id, ruleId), eq(alertRule.startupId, startupId)))
      .returning();

    const row = rows[0];
    if (!row) {
      return createErrorResponse(set, 404, {
        code: "ALERT_RULE_NOT_FOUND",
        message: "Alert rule not found.",
      });
    }

    return { rule: serializeAlertRule(row as AlertRuleRow) };
  } catch (error) {
    console.error("[alert-rule] update failed", {
      startupId,
      ruleId,
      error: error instanceof Error ? error.message : String(error),
    });

    return createErrorResponse(set, 500, {
      code: "ALERT_RULE_UPDATE_FAILED",
      message: "Failed to update alert rule. Please retry.",
      retryable: true,
    });
  }
}

export async function handleDeleteAlertRule(
  runtime: AlertRuleRuntime,
  _wsCtx: WorkspaceContext,
  startupId: string,
  ruleId: string,
  set: { status?: number | string }
): Promise<{ deleted: boolean; ruleId: string } | AlertRuleRouteError> {
  if (!(startupId && ruleId)) {
    return createErrorResponse(set, 400, {
      code: "PARAMS_REQUIRED",
      message: "startupId and ruleId are required.",
    });
  }

  try {
    const rows = await runtime.db.db
      .delete(alertRule)
      .where(and(eq(alertRule.id, ruleId), eq(alertRule.startupId, startupId)))
      .returning({ id: alertRule.id });

    if (rows.length === 0) {
      return createErrorResponse(set, 404, {
        code: "ALERT_RULE_NOT_FOUND",
        message: "Alert rule not found.",
      });
    }

    return { deleted: true, ruleId };
  } catch (error) {
    console.error("[alert-rule] delete failed", {
      startupId,
      ruleId,
      error: error instanceof Error ? error.message : String(error),
    });

    return createErrorResponse(set, 500, {
      code: "ALERT_RULE_DELETE_FAILED",
      message: "Failed to delete alert rule. Please retry.",
      retryable: true,
    });
  }
}

// ------------------------------------------------------------------
// Alert serialization
// ------------------------------------------------------------------

interface AlertRow {
  firedAt: Date | string;
  id: string;
  lastFiredAt: Date | string;
  metricKey: string;
  occurrenceCount: number;
  resolvedAt: Date | string | null;
  ruleId: string;
  severity: string;
  snoozedUntil: Date | string | null;
  startupId: string;
  status: string;
  threshold: string;
  value: string;
}

function serializeAlert(row: AlertRow): AlertSummary {
  return {
    firedAt: requireIsoTimestamp(row.firedAt, "alert.firedAt"),
    id: row.id,
    lastFiredAt: requireIsoTimestamp(row.lastFiredAt, "alert.lastFiredAt"),
    metricKey: row.metricKey,
    occurrenceCount: row.occurrenceCount,
    resolvedAt: toIso(row.resolvedAt),
    ruleId: row.ruleId,
    severity: row.severity as AlertSeverity,
    snoozedUntil: toIso(row.snoozedUntil),
    startupId: row.startupId,
    status: row.status as AlertStatus,
    threshold: Number(row.threshold),
    value: Number(row.value),
  };
}

// ------------------------------------------------------------------
// Triage helpers
// ------------------------------------------------------------------

const TRIAGE_ACTIONS = ["ack", "snooze", "dismiss"] as const;
type TriageAction = (typeof TRIAGE_ACTIONS)[number];

const MAX_SNOOZE_HOURS = 168; // 7 days
const DEFAULT_SNOOZE_HOURS = 24;

function isTriageAction(value: unknown): value is TriageAction {
  return (
    typeof value === "string" && TRIAGE_ACTIONS.includes(value as TriageAction)
  );
}

function triageEventType(action: TriageAction): EventType {
  switch (action) {
    case "ack":
      return "alert.ack";
    case "snooze":
      return "alert.snoozed";
    case "dismiss":
      return "alert.dismissed";
    default:
      return "alert.dismissed";
  }
}

async function emitTriageEvent(
  db: ReturnType<typeof drizzle>,
  alertRow: AlertRow,
  action: TriageAction
): Promise<void> {
  try {
    await db.insert(eventLog).values({
      workspaceId: "",
      startupId: alertRow.startupId,
      eventType: triageEventType(action),
      actorType: "user",
      actorId: null,
      payload: {
        alertId: alertRow.id,
        ruleId: alertRow.ruleId,
        metricKey: alertRow.metricKey,
        action,
      },
    });
  } catch {
    // Fire-and-forget — log but don't fail the triage operation
  }
}

// ------------------------------------------------------------------
// Triage handlers
// ------------------------------------------------------------------

export async function handleListAlerts(
  runtime: AlertRuleRuntime,
  _wsCtx: WorkspaceContext,
  startupId: string,
  status: string | undefined,
  set: { status?: number | string }
): Promise<{ alerts: AlertSummary[] } | AlertRuleRouteError> {
  if (!startupId) {
    return createErrorResponse(set, 400, {
      code: "STARTUP_ID_REQUIRED",
      message: "startupId is required.",
    });
  }

  if (status && !ALERT_STATUSES.includes(status as AlertStatus)) {
    return createErrorResponse(set, 400, {
      code: "INVALID_STATUS",
      message: `Invalid status filter. Allowed: ${ALERT_STATUSES.join(", ")}`,
    });
  }

  try {
    const conditions = [eq(alert.startupId, startupId)];
    if (status) {
      conditions.push(eq(alert.status, status));
    }

    const rows = await runtime.db.db
      .select()
      .from(alert)
      .where(and(...conditions));

    return {
      alerts: rows.map((r) => serializeAlert(r as AlertRow)),
    };
  } catch (error) {
    console.error("[alert] list failed", {
      startupId,
      error: error instanceof Error ? error.message : String(error),
    });

    return createErrorResponse(set, 500, {
      code: "ALERT_LIST_FAILED",
      message: "Failed to list alerts. Please retry.",
      retryable: true,
    });
  }
}

export async function handleTriageAlert(
  runtime: AlertRuleRuntime,
  _wsCtx: WorkspaceContext,
  alertId: string,
  body: unknown,
  set: { status?: number | string }
): Promise<{ alert: AlertSummary } | AlertRuleRouteError> {
  if (!alertId) {
    return createErrorResponse(set, 400, {
      code: "ALERT_ID_REQUIRED",
      message: "alertId is required.",
    });
  }

  if (!isRecord(body)) {
    return createErrorResponse(set, 400, {
      code: "VALIDATION_FAILED",
      message: "Request body is required.",
    });
  }

  const action = body.action;
  if (!isTriageAction(action)) {
    return createErrorResponse(set, 400, {
      code: "INVALID_ACTION",
      message: `Invalid triage action. Allowed: ${TRIAGE_ACTIONS.join(", ")}`,
    });
  }

  try {
    const updates: Record<string, unknown> = {};

    switch (action) {
      case "ack":
        updates.status = "acknowledged";
        break;
      case "snooze": {
        const hours =
          typeof body.snoozeDurationHours === "number"
            ? Math.min(body.snoozeDurationHours, MAX_SNOOZE_HOURS)
            : DEFAULT_SNOOZE_HOURS;
        updates.status = "snoozed";
        updates.snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
        break;
      }
      case "dismiss":
        updates.status = "dismissed";
        break;
      default:
        break;
    }

    const rows = await runtime.db.db
      .update(alert)
      .set(updates)
      .where(eq(alert.id, alertId))
      .returning();

    const row = rows[0];
    if (!row) {
      return createErrorResponse(set, 404, {
        code: "ALERT_NOT_FOUND",
        message: "Alert not found.",
      });
    }

    await emitTriageEvent(runtime.db.db, row as AlertRow, action);

    return { alert: serializeAlert(row as AlertRow) };
  } catch (error) {
    console.error("[alert] triage failed", {
      alertId,
      error: error instanceof Error ? error.message : String(error),
    });

    return createErrorResponse(set, 500, {
      code: "ALERT_TRIAGE_FAILED",
      message: "Failed to triage alert. Please retry.",
      retryable: true,
    });
  }
}

export async function handleBulkTriageAlerts(
  runtime: AlertRuleRuntime,
  _wsCtx: WorkspaceContext,
  startupId: string,
  body: unknown,
  set: { status?: number | string }
): Promise<{ updated: number } | AlertRuleRouteError> {
  if (!startupId) {
    return createErrorResponse(set, 400, {
      code: "STARTUP_ID_REQUIRED",
      message: "startupId is required.",
    });
  }

  if (!isRecord(body)) {
    return createErrorResponse(set, 400, {
      code: "VALIDATION_FAILED",
      message: "Request body is required.",
    });
  }

  const action = body.action;
  if (!isTriageAction(action)) {
    return createErrorResponse(set, 400, {
      code: "INVALID_ACTION",
      message: `Invalid triage action. Allowed: ${TRIAGE_ACTIONS.join(", ")}`,
    });
  }

  try {
    const updates: Record<string, unknown> = {};

    switch (action) {
      case "ack":
        updates.status = "acknowledged";
        break;
      case "snooze": {
        const hours =
          typeof body.snoozeDurationHours === "number"
            ? Math.min(body.snoozeDurationHours, MAX_SNOOZE_HOURS)
            : DEFAULT_SNOOZE_HOURS;
        updates.status = "snoozed";
        updates.snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
        break;
      }
      case "dismiss":
        updates.status = "dismissed";
        break;
      default:
        break;
    }

    const alertIds = Array.isArray(body.alertIds)
      ? (body.alertIds as string[])
      : null;

    const conditions = [eq(alert.startupId, startupId)];
    if (alertIds) {
      conditions.push(inArray(alert.id, alertIds));
    } else {
      conditions.push(eq(alert.status, "active"));
    }

    const rows = await runtime.db.db
      .update(alert)
      .set(updates)
      .where(and(...conditions))
      .returning();

    // Emit events for each triaged alert (fire-and-forget)
    for (const row of rows) {
      emitTriageEvent(runtime.db.db, row as AlertRow, action);
    }

    return { updated: rows.length };
  } catch (error) {
    console.error("[alert] bulk-triage failed", {
      startupId,
      error: error instanceof Error ? error.message : String(error),
    });

    return createErrorResponse(set, 500, {
      code: "ALERT_BULK_TRIAGE_FAILED",
      message: "Failed to bulk-triage alerts. Please retry.",
      retryable: true,
    });
  }
}
