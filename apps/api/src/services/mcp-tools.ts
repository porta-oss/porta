// MCP tool service layer — business logic for all 8 MCP tools.
// 5 read tools: getMetrics, getAlerts, getAtRiskCustomers, getActivityLog, getPortfolioSummary
// 3 write tools: createTask, snoozeAlert, triggerSync
//
// Each function accepts a DB handle and workspace/startup context,
// queries the database, and returns typed results matching the shared MCP schemas.
// Route handlers (Task 7) wrap these in McpResponse envelopes.

import { randomUUID } from "node:crypto";

import type {
  McpActivityLogEntry,
  McpAlert,
  McpAtRiskCustomer,
  McpMetricValue,
  McpPagination,
  McpPortfolioSummary,
  McpSyncJob,
  McpTask,
  MetricCategory,
} from "@shared/mcp";
import type { UniversalMetrics } from "@shared/universal-metrics";
import {
  METRIC_LABELS,
  METRIC_UNITS,
  UNIVERSAL_METRIC_KEYS,
} from "@shared/universal-metrics";
import { sql } from "drizzle-orm";

import type { SyncQueueProducer } from "../lib/connectors/queue";
import type { TaskSyncQueueProducer } from "../lib/tasks/queue";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface McpDb {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toIso(value: string | Date | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function toNum(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

// Map universal metric keys to display categories
const METRIC_CATEGORY_MAP: Record<string, MetricCategory> = {
  mrr: "revenue",
  arpu: "revenue",
  active_users: "engagement",
  churn_rate: "health",
  error_rate: "health",
  growth_rate: "growth",
};

// ---------------------------------------------------------------------------
// Tool 1: getMetrics
// ---------------------------------------------------------------------------

interface GetMetricsParams {
  category?: string;
  metricKeys?: string[];
  startupId: string;
}

interface HealthSnapshotRow {
  computed_at: string | Date;
  supporting_metrics: unknown;
}

interface CustomMetricRow {
  captured_at: string | Date | null;
  category: string;
  delta: string | null;
  key: string;
  label: string;
  metric_value: string | null;
  previous_value: string | null;
  unit: string;
}

export async function getMetrics(
  db: McpDb,
  params: GetMetricsParams
): Promise<McpMetricValue[]> {
  const { startupId, metricKeys, category } = params;
  const metrics: McpMetricValue[] = [];

  // 1. Universal metrics from health_snapshot
  const snapshotResult = await db.execute(
    sql`SELECT supporting_metrics, computed_at
        FROM health_snapshot
        WHERE startup_id = ${startupId}
        LIMIT 1`
  );

  const snapshot = snapshotResult.rows[0] as HealthSnapshotRow | undefined;
  if (snapshot) {
    const universalMetrics = snapshot.supporting_metrics as UniversalMetrics;

    for (const key of UNIVERSAL_METRIC_KEYS) {
      const value = universalMetrics[key];
      if (value == null) {
        continue;
      }

      const metricCategory = METRIC_CATEGORY_MAP[key] ?? "custom";

      if (category && metricCategory !== category) {
        continue;
      }
      if (metricKeys && metricKeys.length > 0 && !metricKeys.includes(key)) {
        continue;
      }

      metrics.push({
        key,
        label: METRIC_LABELS[key],
        value,
        previousValue: null,
        delta: null,
        unit: METRIC_UNITS[key],
        category: metricCategory,
        source: "health_snapshot",
        isUniversal: true,
      });
    }
  }

  // 2. Custom metrics
  const customResult = await db.execute(
    sql`SELECT key, label, unit, category, metric_value, previous_value, delta, captured_at
        FROM custom_metric
        WHERE startup_id = ${startupId}
        ORDER BY key ASC`
  );

  for (const row of customResult.rows as CustomMetricRow[]) {
    const metricCategory = (row.category || "custom") as MetricCategory;

    if (category && metricCategory !== category) {
      continue;
    }
    if (metricKeys && metricKeys.length > 0 && !metricKeys.includes(row.key)) {
      continue;
    }

    const val = toNum(row.metric_value);
    if (val == null) {
      continue;
    }

    metrics.push({
      key: row.key,
      label: row.label,
      value: val,
      previousValue: toNum(row.previous_value),
      delta: toNum(row.delta),
      unit: row.unit,
      category: metricCategory,
      source: "custom_metric",
      isUniversal: false,
    });
  }

  return metrics;
}

// ---------------------------------------------------------------------------
// Tool 2: getAlerts
// ---------------------------------------------------------------------------

interface GetAlertsParams {
  startupId?: string;
  status?: string;
  workspaceId: string;
}

interface AlertRow {
  fired_at: string | Date;
  id: string;
  metric_key: string;
  occurrence_count: number;
  rule_id: string;
  severity: string;
  startup_id: string;
  status: string;
  threshold: string;
  value: string;
}

export async function getAlerts(
  db: McpDb,
  params: GetAlertsParams
): Promise<McpAlert[]> {
  const conditions = [
    sql`a.startup_id IN (SELECT id FROM startup WHERE workspace_id = ${params.workspaceId})`,
  ];

  if (params.startupId) {
    conditions.push(sql`a.startup_id = ${params.startupId}`);
  }
  if (params.status) {
    conditions.push(sql`a.status = ${params.status}`);
  }

  const whereClause = sql.join(conditions, sql` AND `);

  const result = await db.execute(
    sql`SELECT a.id, a.startup_id, a.rule_id, a.metric_key, a.severity,
               a.value, a.threshold, a.status, a.occurrence_count, a.fired_at
        FROM alert a
        WHERE ${whereClause}
        ORDER BY
          CASE a.severity
            WHEN 'critical' THEN 0
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 3
          END ASC,
          a.fired_at DESC`
  );

  return (result.rows as AlertRow[]).map((row) => ({
    id: row.id,
    startupId: row.startup_id,
    ruleId: row.rule_id,
    metricKey: row.metric_key,
    severity: row.severity as McpAlert["severity"],
    value: Number(row.value),
    threshold: Number(row.threshold),
    status: row.status as McpAlert["status"],
    occurrenceCount: row.occurrence_count,
    firedAt: toIso(row.fired_at)!,
  }));
}

// ---------------------------------------------------------------------------
// Tool 3: getAtRiskCustomers
// ---------------------------------------------------------------------------

export async function getAtRiskCustomers(
  db: McpDb,
  startupId: string
): Promise<McpAtRiskCustomer[]> {
  // At-risk customer data is derived from insight evidence.
  // If no insight exists or evidence has no at-risk data, return empty array.
  const result = await db.execute(
    sql`SELECT evidence FROM startup_insight
        WHERE startup_id = ${startupId}
        LIMIT 1`
  );

  const row = result.rows[0] as { evidence: unknown } | undefined;
  if (!row?.evidence) {
    return [];
  }

  const evidence = row.evidence as {
    atRiskCustomers?: Array<{
      evaluableCriteria?: string[];
      identifier?: string;
      lastActivityDate?: string | null;
      lastPaymentDate?: string | null;
      riskReasons?: string[];
    }>;
  };

  if (!Array.isArray(evidence.atRiskCustomers)) {
    return [];
  }

  return evidence.atRiskCustomers.map((c) => ({
    identifier: c.identifier ?? "unknown",
    riskReasons: Array.isArray(c.riskReasons) ? c.riskReasons : [],
    evaluableCriteria: Array.isArray(c.evaluableCriteria)
      ? c.evaluableCriteria
      : [],
    lastActivityDate: c.lastActivityDate ?? null,
    lastPaymentDate: c.lastPaymentDate ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Tool 4: getActivityLog
// ---------------------------------------------------------------------------

interface GetActivityLogParams {
  cursor?: string;
  eventTypes?: string[];
  limit?: number;
  startupId?: string;
  workspaceId: string;
}

interface EventLogRow {
  actor_id: string | null;
  actor_type: string;
  created_at: string | Date;
  event_type: string;
  id: string;
  payload: Record<string, unknown>;
  startup_id: string | null;
  workspace_id: string;
}

interface CursorPayload {
  createdAt: string;
  id: string;
}

function decodeCursor(encoded: string): CursorPayload | null {
  try {
    const json = Buffer.from(encoded, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (typeof parsed.createdAt === "string" && typeof parsed.id === "string") {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString("base64");
}

export async function getActivityLog(
  db: McpDb,
  params: GetActivityLogParams
): Promise<{ entries: McpActivityLogEntry[]; pagination: McpPagination }> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const fetchLimit = limit + 1;

  const conditions = [sql`workspace_id = ${params.workspaceId}`];

  if (params.startupId) {
    conditions.push(sql`startup_id = ${params.startupId}`);
  }

  if (params.eventTypes && params.eventTypes.length > 0) {
    const list = params.eventTypes.map((et) => sql`${et}`);
    conditions.push(sql`event_type IN (${sql.join(list, sql`, `)})`);
  }

  if (params.cursor) {
    const cursor = decodeCursor(params.cursor);
    if (cursor) {
      conditions.push(
        sql`(created_at < ${cursor.createdAt}::timestamptz OR (created_at = ${cursor.createdAt}::timestamptz AND id < ${cursor.id}))`
      );
    }
  }

  const whereClause = sql.join(conditions, sql` AND `);

  const result = await db.execute(
    sql`SELECT id, workspace_id, startup_id, event_type, actor_type, actor_id, payload, created_at
        FROM event_log
        WHERE ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT ${fetchLimit}`
  );

  const rows = result.rows as EventLogRow[];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const entries: McpActivityLogEntry[] = pageRows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    startupId: row.startup_id,
    eventType: row.event_type as McpActivityLogEntry["eventType"],
    actorType: row.actor_type,
    actorId: row.actor_id,
    payload: row.payload,
    createdAt: toIso(row.created_at)!,
  }));

  const lastRow = pageRows.at(-1);
  const nextCursor =
    hasMore && lastRow
      ? encodeCursor(toIso(lastRow.created_at)!, lastRow.id)
      : null;

  return {
    entries,
    pagination: {
      cursor: nextCursor,
      hasMore,
      limit,
    },
  };
}

// ---------------------------------------------------------------------------
// Tool 5: getPortfolioSummary
// ---------------------------------------------------------------------------

interface StartupRow {
  currency: string;
  id: string;
  name: string;
  north_star_key: string;
  type: string;
}

interface PortfolioSnapshotRow {
  health_state: string;
  north_star_previous_value: string | null;
  north_star_value: string | null;
  startup_id: string;
  supporting_metrics: unknown;
}

interface ConnectorSyncRow {
  last_sync_at: string | Date | null;
  startup_id: string;
}

export async function getPortfolioSummary(
  db: McpDb,
  workspaceId: string
): Promise<McpPortfolioSummary> {
  // Load all startups for workspace
  const startupsResult = await db.execute(
    sql`SELECT id, name, type, currency, north_star_key
        FROM startup
        WHERE workspace_id = ${workspaceId}
        ORDER BY name ASC`
  );

  const startups = startupsResult.rows as StartupRow[];
  if (startups.length === 0) {
    return { startups: [], aiSynthesis: undefined, synthesizedAt: undefined };
  }

  const startupIds = startups.map((s) => s.id);

  // Load health snapshots for all startups
  const snapshotResult = await db.execute(
    sql`SELECT startup_id, health_state, north_star_value, north_star_previous_value, supporting_metrics
        FROM health_snapshot
        WHERE startup_id IN (${sql.join(
          startupIds.map((id) => sql`${id}`),
          sql`, `
        )})`
  );

  const snapshotMap = new Map<string, PortfolioSnapshotRow>();
  for (const row of snapshotResult.rows as PortfolioSnapshotRow[]) {
    snapshotMap.set(row.startup_id, row);
  }

  // Load active alert counts per startup
  const alertResult = await db.execute(
    sql`SELECT startup_id, COUNT(*)::int AS count
        FROM alert
        WHERE startup_id IN (${sql.join(
          startupIds.map((id) => sql`${id}`),
          sql`, `
        )})
          AND status = 'active'
        GROUP BY startup_id`
  );

  const alertCountMap = new Map<string, number>();
  for (const row of alertResult.rows as Array<{
    count: number;
    startup_id: string;
  }>) {
    alertCountMap.set(row.startup_id, row.count);
  }

  // Load custom metric counts per startup
  const customMetricResult = await db.execute(
    sql`SELECT startup_id, COUNT(*)::int AS count
        FROM custom_metric
        WHERE startup_id IN (${sql.join(
          startupIds.map((id) => sql`${id}`),
          sql`, `
        )})
        GROUP BY startup_id`
  );

  const customMetricCountMap = new Map<string, number>();
  for (const row of customMetricResult.rows as Array<{
    count: number;
    startup_id: string;
  }>) {
    customMetricCountMap.set(row.startup_id, row.count);
  }

  // Load latest sync time per startup (from connector)
  const syncResult = await db.execute(
    sql`SELECT startup_id, MAX(last_sync_at) AS last_sync_at
        FROM connector
        WHERE startup_id IN (${sql.join(
          startupIds.map((id) => sql`${id}`),
          sql`, `
        )})
        GROUP BY startup_id`
  );

  const lastSyncMap = new Map<string, string | null>();
  for (const row of syncResult.rows as ConnectorSyncRow[]) {
    lastSyncMap.set(row.startup_id, toIso(row.last_sync_at));
  }

  // Build startup summaries
  const summaries = startups.map((s) => {
    const snap = snapshotMap.get(s.id);
    const universalMetrics: Record<string, number | null> = {};

    if (snap?.supporting_metrics) {
      const um = snap.supporting_metrics as UniversalMetrics;
      for (const key of UNIVERSAL_METRIC_KEYS) {
        universalMetrics[key] = um[key] ?? null;
      }
    }

    const northStarValue = toNum(snap?.north_star_value);
    const northStarPrevious = toNum(snap?.north_star_previous_value);
    const northStarDelta =
      northStarValue != null && northStarPrevious != null
        ? northStarValue - northStarPrevious
        : null;

    return {
      id: s.id,
      name: s.name,
      type: s.type,
      currency: s.currency,
      healthState: (snap?.health_state ?? "syncing") as
        | "blocked"
        | "syncing"
        | "ready"
        | "stale"
        | "error",
      northStarKey: s.north_star_key,
      northStarValue,
      northStarDelta,
      universalMetrics,
      activeAlerts: alertCountMap.get(s.id) ?? 0,
      customMetricCount: customMetricCountMap.get(s.id) ?? 0,
      lastSyncAt: lastSyncMap.get(s.id) ?? null,
    };
  });

  // Load latest AI synthesis if available
  // We look for the most recent insight with a successful explanation
  const synthesisResult = await db.execute(
    sql`SELECT explanation, generated_at
        FROM startup_insight
        WHERE startup_id IN (${sql.join(
          startupIds.map((id) => sql`${id}`),
          sql`, `
        )})
          AND generation_status = 'completed'
        ORDER BY generated_at DESC
        LIMIT 1`
  );

  const synthesisRow = synthesisResult.rows[0] as
    | {
        explanation: { observation?: string } | null;
        generated_at: string | Date;
      }
    | undefined;

  const aiSynthesis = synthesisRow?.explanation?.observation;
  const synthesizedAt = synthesisRow
    ? toIso(synthesisRow.generated_at)
    : undefined;

  return {
    startups: summaries,
    aiSynthesis: aiSynthesis ?? undefined,
    synthesizedAt: synthesizedAt ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Tool 6: createTask
// ---------------------------------------------------------------------------

interface CreateTaskParams {
  description?: string;
  priority?: string;
  startupId: string;
  title: string;
  workspaceId: string;
}

interface CreateTaskResult {
  task: McpTask;
}

export async function createTask(
  db: McpDb,
  params: CreateTaskParams,
  taskSyncQueue?: TaskSyncQueueProducer
): Promise<CreateTaskResult> {
  const taskId = randomUUID();
  const priority = params.priority ?? "medium";
  const description = params.description ?? "";

  // Insert task. For MCP-created tasks, use "mcp" as source insight ID
  // and 0 as action index (these are direct-creation, not insight-derived).
  const result = await db.execute(
    sql`INSERT INTO internal_task (
          id, startup_id, source_insight_id, source_action_index,
          title, description, linked_metric_keys,
          sync_status, created_at, updated_at
        )
        VALUES (
          ${taskId}, ${params.startupId}, ${"mcp-direct"}, ${0},
          ${params.title}, ${description}, ${JSON.stringify([])}::jsonb,
          'queued', NOW(), NOW()
        )
        ON CONFLICT (startup_id, source_insight_id, source_action_index)
        DO UPDATE SET
          title = ${params.title},
          description = ${description},
          updated_at = NOW()
        RETURNING id, startup_id, title, description, sync_status, created_at`
  );

  const row = result.rows[0] as {
    created_at: string | Date;
    description: string | null;
    id: string;
    startup_id: string;
    sync_status: string;
    title: string;
  };

  // Enqueue Linear sync if queue producer is available
  if (taskSyncQueue) {
    void taskSyncQueue.enqueue({ taskId: row.id });
  }

  return {
    task: {
      id: row.id,
      startupId: row.startup_id,
      title: row.title,
      description: row.description,
      priority,
      syncStatus: row.sync_status,
      createdAt: toIso(row.created_at)!,
    },
  };
}

// ---------------------------------------------------------------------------
// Tool 7: snoozeAlert
// ---------------------------------------------------------------------------

interface SnoozeAlertParams {
  alertId: string;
  durationHours?: number;
  workspaceId: string;
}

export async function snoozeAlert(
  db: McpDb,
  params: SnoozeAlertParams
): Promise<McpAlert | null> {
  const durationHours = params.durationHours ?? 24;

  // Verify alert exists and belongs to workspace
  const checkResult = await db.execute(
    sql`SELECT a.id, a.startup_id
        FROM alert a
        JOIN startup s ON s.id = a.startup_id
        WHERE a.id = ${params.alertId}
          AND s.workspace_id = ${params.workspaceId}
        LIMIT 1`
  );

  if (checkResult.rows.length === 0) {
    return null;
  }

  // Update alert to snoozed
  const snoozedUntil = new Date(
    Date.now() + durationHours * 60 * 60 * 1000
  ).toISOString();

  const result = await db.execute(
    sql`UPDATE alert
        SET status = 'snoozed',
            snoozed_until = ${snoozedUntil}::timestamptz
        WHERE id = ${params.alertId}
        RETURNING id, startup_id, rule_id, metric_key, severity,
                  value, threshold, status, occurrence_count, fired_at`
  );

  const row = result.rows[0] as AlertRow | undefined;
  if (!row) {
    return null;
  }

  // Fire-and-forget event log
  void db.execute(
    sql`INSERT INTO event_log (id, workspace_id, startup_id, event_type, actor_type, payload, created_at)
        VALUES (${randomUUID()}, ${params.workspaceId}, ${row.startup_id}, 'alert.snoozed', 'mcp',
                ${JSON.stringify({ alertId: row.id, durationHours, snoozedUntil })}::jsonb, NOW())`
  );

  return {
    id: row.id,
    startupId: row.startup_id,
    ruleId: row.rule_id,
    metricKey: row.metric_key,
    severity: row.severity as McpAlert["severity"],
    value: Number(row.value),
    threshold: Number(row.threshold),
    status: row.status as McpAlert["status"],
    occurrenceCount: row.occurrence_count,
    firedAt: toIso(row.fired_at)!,
  };
}

// ---------------------------------------------------------------------------
// Tool 8: triggerSync
// ---------------------------------------------------------------------------

interface TriggerSyncParams {
  connectorId?: string;
  startupId: string;
  workspaceId: string;
}

interface ConnectorRow {
  id: string;
  provider: string;
  startup_id: string;
}

export async function triggerSync(
  db: McpDb,
  params: TriggerSyncParams,
  queueProducer: SyncQueueProducer
): Promise<{ syncJobs: McpSyncJob[] }> {
  // Find connectors for the startup
  const conditions = [sql`startup_id = ${params.startupId}`];

  if (params.connectorId) {
    conditions.push(sql`id = ${params.connectorId}`);
  }

  // Only sync connected connectors
  conditions.push(sql`status = 'connected'`);

  const whereClause = sql.join(conditions, sql` AND `);

  const result = await db.execute(
    sql`SELECT id, startup_id, provider
        FROM connector
        WHERE ${whereClause}`
  );

  const connectors = result.rows as ConnectorRow[];
  const syncJobs: McpSyncJob[] = [];

  for (const conn of connectors) {
    const syncJobId = randomUUID();
    const now = new Date().toISOString();

    // Insert sync_job row
    await db.execute(
      sql`INSERT INTO sync_job (id, connector_id, status, trigger, created_at)
          VALUES (${syncJobId}, ${conn.id}, 'queued', 'manual', NOW())`
    );

    // Enqueue via BullMQ
    await queueProducer.enqueue({
      connectorId: conn.id,
      startupId: conn.startup_id,
      provider: conn.provider as Parameters<
        SyncQueueProducer["enqueue"]
      >[0]["provider"],
      trigger: "manual",
      syncJobId,
    });

    syncJobs.push({
      id: syncJobId,
      connectorId: conn.id,
      provider: conn.provider,
      status: "queued",
      trigger: "manual",
      createdAt: now,
    });
  }

  // Fire-and-forget event log
  if (syncJobs.length > 0) {
    void db.execute(
      sql`INSERT INTO event_log (id, workspace_id, startup_id, event_type, actor_type, payload, created_at)
          VALUES (${randomUUID()}, ${params.workspaceId}, ${params.startupId}, 'mcp.action', 'mcp',
                  ${JSON.stringify({ tool: "trigger_sync", connectorCount: syncJobs.length })}::jsonb, NOW())`
    );
  }

  return { syncJobs };
}
