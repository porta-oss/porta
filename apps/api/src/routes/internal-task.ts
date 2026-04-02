// Internal-task route handlers.
// Create a task from the latest insight's action and list tasks for a startup.
// All operations require an authenticated session with an active workspace
// and validate that the startup belongs to that workspace.
//
// Create is idempotent: the same startup + insight + actionIndex
// combination returns the existing task instead of creating a duplicate.

import { randomUUID } from "node:crypto";
import type {
  InternalTaskPayload,
  TaskSyncStatus,
} from "@shared/internal-task";
import { isTaskSyncStatus } from "@shared/internal-task";
import type {
  EvidencePacket,
  InsightAction,
  InsightExplanation,
} from "@shared/startup-insight";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal DB interface — works with any Drizzle instance. */
interface TaskDb {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
}

interface TaskRuntime {
  db: { db: TaskDb };
  env: { authContextTimeoutMs: number };
}

interface TaskWorkspaceContext {
  workspace: { id: string };
}

interface CreateTaskBody {
  actionIndex: number;
  startupId: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface InsightRow {
  evidence: unknown;
  explanation: unknown;
  id: string;
}

async function loadLatestInsightForTask(
  db: TaskDb,
  startupId: string
): Promise<InsightRow | null> {
  const result = await db.execute(
    sql`SELECT id, explanation, evidence
        FROM startup_insight
        WHERE startup_id = ${startupId}
        LIMIT 1`
  );
  const row = result.rows[0] as InsightRow | undefined;
  return row ?? null;
}

async function verifyStartupOwnership(
  db: TaskDb,
  startupId: string,
  workspaceId: string
): Promise<{ exists: boolean; owned: boolean }> {
  const result = await db.execute(
    sql`SELECT id, workspace_id FROM startup WHERE id = ${startupId}`
  );
  const row = result.rows[0] as
    | { id: string; workspace_id: string }
    | undefined;
  if (!row) {
    return { exists: false, owned: false };
  }
  return { exists: true, owned: row.workspace_id === workspaceId };
}

function toIsoString(value: string | Date | null): string | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

interface TaskRow {
  created_at: string | Date;
  description: string;
  id: string;
  last_sync_attempt_at: string | Date | null;
  last_sync_error: string | null;
  linear_issue_id: string | null;
  linked_metric_keys: unknown;
  source_action_index: number;
  source_insight_id: string;
  startup_id: string;
  sync_status: string;
  title: string;
}

function serializeTaskRow(row: TaskRow): InternalTaskPayload {
  const syncStatus: TaskSyncStatus = isTaskSyncStatus(row.sync_status)
    ? row.sync_status
    : "not_synced";

  const linkedMetricKeys = Array.isArray(row.linked_metric_keys)
    ? (row.linked_metric_keys as string[])
    : [];

  return {
    id: row.id,
    startupId: row.startup_id,
    sourceInsightId: row.source_insight_id,
    sourceActionIndex: row.source_action_index,
    title: row.title,
    description: row.description,
    linkedMetricKeys,
    syncStatus,
    linearIssueId: row.linear_issue_id,
    lastSyncError: row.last_sync_error,
    lastSyncAttemptAt: toIsoString(row.last_sync_attempt_at),
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Create task handler
// ---------------------------------------------------------------------------

export async function handleCreateTask(
  runtime: TaskRuntime,
  ctx: TaskWorkspaceContext,
  body: CreateTaskBody,
  set: { status?: number | string }
): Promise<unknown> {
  const { startupId, actionIndex } = body;

  // Validate actionIndex is a non-negative integer
  if (
    typeof actionIndex !== "number" ||
    !Number.isInteger(actionIndex) ||
    actionIndex < 0
  ) {
    set.status = 400;
    console.warn("[internal-task] invalid actionIndex", {
      startupId,
      actionIndex,
    });
    return {
      error: {
        code: "INVALID_ACTION_INDEX",
        message: "actionIndex must be a non-negative integer.",
      },
    };
  }

  // Validate startupId is a non-empty string
  if (typeof startupId !== "string" || startupId.trim().length === 0) {
    set.status = 400;
    return {
      error: {
        code: "INVALID_STARTUP_ID",
        message: "startupId must be a non-empty string.",
      },
    };
  }

  const db = runtime.db.db;

  // Verify startup existence + workspace ownership
  const ownership = await verifyStartupOwnership(
    db,
    startupId,
    ctx.workspace.id
  );

  if (!ownership.exists) {
    set.status = 404;
    console.warn("[internal-task] startup not found", { startupId });
    return {
      error: {
        code: "STARTUP_NOT_FOUND",
        message: "Startup not found.",
      },
    };
  }

  if (!ownership.owned) {
    set.status = 403;
    console.warn("[internal-task] startup scope invalid", {
      startupId,
      workspaceId: ctx.workspace.id,
    });
    return {
      error: {
        code: "STARTUP_SCOPE_INVALID",
        message: "The startup does not belong to the active workspace.",
      },
    };
  }

  // Load latest insight for the startup
  const insightRow = await loadLatestInsightForTask(db, startupId);

  if (!insightRow) {
    set.status = 422;
    console.warn("[internal-task] no insight available", { startupId });
    return {
      error: {
        code: "NO_INSIGHT_AVAILABLE",
        message:
          "No insight has been generated for this startup yet. Generate an insight first.",
      },
    };
  }

  // Validate explanation exists and has actions
  const explanation = insightRow.explanation as InsightExplanation | null;

  if (!(explanation && Array.isArray(explanation.actions))) {
    set.status = 422;
    console.warn("[internal-task] insight has no explanation or actions", {
      startupId,
      insightId: insightRow.id,
    });
    return {
      error: {
        code: "INSIGHT_NO_ACTIONS",
        message:
          "The latest insight has no explanation or actions. A successful insight generation is required.",
      },
    };
  }

  // Validate actionIndex is within bounds
  if (actionIndex >= explanation.actions.length) {
    set.status = 400;
    console.warn("[internal-task] actionIndex out of bounds", {
      startupId,
      actionIndex,
      available: explanation.actions.length,
    });
    return {
      error: {
        code: "ACTION_INDEX_OUT_OF_BOUNDS",
        message: `actionIndex ${actionIndex} is out of bounds. The insight has ${explanation.actions.length} action(s) (0-indexed).`,
      },
    };
  }

  const action = explanation.actions[actionIndex] as InsightAction;
  const evidence = insightRow.evidence as EvidencePacket | null;
  const linkedMetricKeys = evidence?.items?.map((item) => item.metricKey) ?? [];

  const taskId = randomUUID();

  // Insert with ON CONFLICT for idempotency on (startup_id, source_insight_id, source_action_index)
  const result = await db.execute(
    sql`INSERT INTO internal_task (
          id, startup_id, source_insight_id, source_action_index,
          title, description, linked_metric_keys,
          sync_status, created_at, updated_at
        )
        VALUES (
          ${taskId}, ${startupId}, ${insightRow.id}, ${actionIndex},
          ${action.label}, ${action.rationale}, ${JSON.stringify(linkedMetricKeys)}::jsonb,
          'not_synced', NOW(), NOW()
        )
        ON CONFLICT (startup_id, source_insight_id, source_action_index)
        DO UPDATE SET updated_at = NOW()
        RETURNING id, startup_id, source_insight_id, source_action_index,
                  title, description, linked_metric_keys,
                  sync_status, linear_issue_id, last_sync_error,
                  last_sync_attempt_at, created_at`
  );

  const createdRow = result.rows[0] as TaskRow | undefined;

  if (!createdRow) {
    set.status = 502;
    console.error("[internal-task] create returned no rows", {
      startupId,
      actionIndex,
    });
    return {
      error: {
        code: "TASK_CREATE_MALFORMED",
        message: "Task creation returned an unexpected payload.",
      },
    };
  }

  // Determine if this was a new insert or an idempotent return
  const isNewTask = createdRow.id === taskId;

  set.status = isNewTask ? 201 : 200;
  console.info("[internal-task] task created", {
    taskId: createdRow.id,
    startupId,
    sourceInsightId: insightRow.id,
    sourceActionIndex: actionIndex,
    isNew: isNewTask,
  });

  return {
    task: serializeTaskRow(createdRow),
    created: isNewTask,
  };
}

// ---------------------------------------------------------------------------
// List tasks handler
// ---------------------------------------------------------------------------

export async function handleListTasks(
  runtime: TaskRuntime,
  ctx: TaskWorkspaceContext,
  startupId: string,
  set: { status?: number | string }
): Promise<unknown> {
  if (typeof startupId !== "string" || startupId.trim().length === 0) {
    set.status = 400;
    return {
      error: {
        code: "INVALID_STARTUP_ID",
        message: "startupId query parameter is required.",
      },
    };
  }

  const db = runtime.db.db;

  // Verify startup existence + workspace ownership
  const ownership = await verifyStartupOwnership(
    db,
    startupId,
    ctx.workspace.id
  );

  if (!ownership.exists) {
    set.status = 404;
    return {
      error: {
        code: "STARTUP_NOT_FOUND",
        message: "Startup not found.",
      },
    };
  }

  if (!ownership.owned) {
    set.status = 403;
    return {
      error: {
        code: "STARTUP_SCOPE_INVALID",
        message: "The startup does not belong to the active workspace.",
      },
    };
  }

  const result = await db.execute(
    sql`SELECT id, startup_id, source_insight_id, source_action_index,
               title, description, linked_metric_keys,
               sync_status, linear_issue_id, last_sync_error,
               last_sync_attempt_at, created_at
        FROM internal_task
        WHERE startup_id = ${startupId}
        ORDER BY created_at ASC`
  );

  const tasks = (result.rows as TaskRow[]).map(serializeTaskRow);

  return {
    tasks,
    startupId,
    count: tasks.length,
  };
}

// Re-export runtime type for use in app.ts
export type { TaskRuntime, TaskWorkspaceContext };
