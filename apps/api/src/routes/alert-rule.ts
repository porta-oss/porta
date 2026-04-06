// Alert rule CRUD routes.
// All routes require an authenticated session with an active workspace.
// Provides create, list, update, and delete for alert rules scoped to a startup.

import type {
  AlertCondition,
  AlertRuleSummary,
  AlertSeverity,
} from "@shared/alert-rule";
import { alertRuleSchema } from "@shared/alert-rule";
import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/node-postgres";

import { alertRule } from "../db/schema/alert-rule";

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
