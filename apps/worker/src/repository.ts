// Sync repository implementation using Drizzle ORM.
// Provides the DB operations the sync processor needs.
// Uses Drizzle's sql tagged template for parameterized queries
// to avoid importing schema tables from the API package.

import type { FunnelStageRow, HealthState } from "@shared/startup-health";
import type {
  EvidencePacket,
  InsightConditionCode,
  InsightExplanation,
  InsightGenerationStatus,
} from "@shared/startup-insight";
import type { UniversalMetrics } from "@shared/universal-metrics";
import { sql } from "drizzle-orm";
import type { ConnectorRow, SyncRepository } from "./processors/sync";

/** Drizzle-compatible db handle — accepts the output of drizzle(). */
interface DrizzleHandle {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
}

/** Row shape for a persisted health snapshot (read-back). */
export interface HealthSnapshotRow {
  blockedReason: string | null;
  computedAt: Date;
  healthState: string;
  id: string;
  northStarKey: string;
  northStarPreviousValue: number | null;
  northStarValue: number | null;
  startupId: string;
  supportingMetrics: unknown;
  syncJobId: string | null;
}

/** Input for an atomic snapshot replacement. */
export interface ReplaceSnapshotInput {
  blockedReason: string | null;
  computedAt: Date;
  funnel: Array<{
    id: string;
    key: string;
    label: string;
    value: number;
    position: number;
  }>;
  healthState: HealthState;
  northStarKey: string;
  northStarPreviousValue: number | null;
  northStarValue: number;
  snapshotId: string;
  startupId: string;
  supportingMetrics: UniversalMetrics;
  syncJobId: string | null;
}

/** Input for recording metric history entries after a snapshot recompute. */
export interface RecordHistoryInput {
  capturedAt: Date;
  northStarKey: string;
  northStarValue: number;
  snapshotId: string;
  startupId: string;
  supportingMetrics: Record<string, number>;
}

/** Health snapshot read/write operations for the worker and API. */
export interface HealthSnapshotRepository {
  /** Check whether the health tables exist in the database. */
  checkHealthTablesExist(): Promise<{
    snapshotReady: boolean;
    funnelReady: boolean;
  }>;

  /** Load funnel stage rows for a startup's current snapshot. */
  findFunnelStages(startupId: string): Promise<FunnelStageRow[]>;

  /** Load the latest health snapshot for a startup. Returns undefined if none exists. */
  findSnapshot(startupId: string): Promise<HealthSnapshotRow | undefined>;

  /**
   * Record metric values into health_snapshot_history for trend tracking.
   * Inserts one row per metric (north star + supporting metrics).
   */
  recordHistory(input: RecordHistoryInput): Promise<void>;
  /**
   * Atomically replace the health snapshot + funnel stages for a startup.
   * Deletes existing rows and inserts the new set within a single transaction.
   * Preserves health_snapshot_history rows by re-parenting them to the new snapshot.
   */
  replaceSnapshot(input: ReplaceSnapshotInput): Promise<void>;
}

/**
 * Create a sync repository backed by a Drizzle db instance.
 * Uses parameterized SQL to interact with connector/sync_job tables.
 */
export function createSyncRepository(db: DrizzleHandle): SyncRepository {
  return {
    async findConnector(
      connectorId: string
    ): Promise<ConnectorRow | undefined> {
      const result = await db.execute(
        sql`SELECT id, provider, encrypted_config, encryption_iv, encryption_auth_tag
            FROM connector WHERE id = ${connectorId} LIMIT 1`
      );
      const row = result.rows[0] as
        | {
            id: string;
            provider: string;
            encrypted_config: string;
            encryption_iv: string;
            encryption_auth_tag: string;
          }
        | undefined;

      if (!row) {
        return undefined;
      }

      return {
        id: row.id,
        provider: row.provider,
        encryptedConfig: row.encrypted_config,
        encryptionIv: row.encryption_iv,
        encryptionAuthTag: row.encryption_auth_tag,
      };
    },

    async markSyncJobRunning(
      syncJobId: string,
      startedAt: Date,
      attempt: number
    ): Promise<void> {
      await db.execute(
        sql`UPDATE sync_job SET status = 'running', started_at = ${startedAt}, attempt = ${attempt}
            WHERE id = ${syncJobId}`
      );
    },

    async markSyncJobCompleted(
      syncJobId: string,
      connectorId: string,
      completedAt: Date,
      durationMs: number
    ): Promise<void> {
      await db.execute(
        sql`UPDATE sync_job SET status = 'completed', completed_at = ${completedAt}, duration_ms = ${durationMs}
            WHERE id = ${syncJobId}`
      );
      await db.execute(
        sql`UPDATE connector SET status = 'connected', last_sync_at = ${completedAt},
            last_sync_duration_ms = ${durationMs}, last_sync_error = NULL
            WHERE id = ${connectorId}`
      );
    },

    async markSyncJobFailed(
      syncJobId: string,
      connectorId: string,
      error: string,
      completedAt: Date,
      durationMs: number
    ): Promise<void> {
      await db.execute(
        sql`UPDATE sync_job SET status = 'failed', completed_at = ${completedAt},
            duration_ms = ${durationMs}, error = ${error}
            WHERE id = ${syncJobId}`
      );
      await db.execute(
        sql`UPDATE connector SET status = 'error', last_sync_error = ${error},
            last_sync_duration_ms = ${durationMs}
            WHERE id = ${connectorId}`
      );
    },
  };
}

/**
 * Create a health snapshot repository backed by a Drizzle db instance.
 * Uses parameterized SQL to interact with health_snapshot/health_funnel_stage tables.
 * Snapshot replacement is atomic: old rows are deleted and new rows inserted
 * within the same "transaction" boundary (Postgres serial execution for a single connection).
 */
export function createHealthSnapshotRepository(
  db: DrizzleHandle
): HealthSnapshotRepository {
  return {
    async replaceSnapshot(input: ReplaceSnapshotInput): Promise<void> {
      const metricsJson = JSON.stringify(input.supportingMetrics);

      // Preserve health_snapshot_history rows (30-day window) before cascade delete.
      // The FK on snapshot_id has ON DELETE CASCADE, so deleting the old snapshot
      // would wipe all history. We read, delete, recreate with the new snapshot_id.
      const cutoff30d = new Date(
        Date.now() - 30 * 24 * 60 * 60 * 1000
      ).toISOString();
      const savedHistory = await db.execute(
        sql`SELECT startup_id, metric_key, value, captured_at
            FROM health_snapshot_history
            WHERE startup_id = ${input.startupId}
              AND captured_at >= ${cutoff30d}`
      );

      // Delete existing funnel stages for this startup first (FK cascade would handle it,
      // but explicit deletion keeps intent clear and works even without cascade).
      await db.execute(
        sql`DELETE FROM health_funnel_stage WHERE startup_id = ${input.startupId}`
      );

      // Delete existing snapshot for this startup (cascades history rows).
      await db.execute(
        sql`DELETE FROM health_snapshot WHERE startup_id = ${input.startupId}`
      );

      // Insert new snapshot.
      await db.execute(
        sql`INSERT INTO health_snapshot (id, startup_id, health_state, blocked_reason, north_star_key, north_star_value, north_star_previous_value, supporting_metrics, sync_job_id, computed_at)
            VALUES (${input.snapshotId}, ${input.startupId}, ${input.healthState}, ${input.blockedReason}, ${input.northStarKey}, ${input.northStarValue}, ${input.northStarPreviousValue}, ${metricsJson}::jsonb, ${input.syncJobId}, ${input.computedAt})`
      );

      // Re-insert preserved history rows referencing the new snapshot.
      const historyRows = savedHistory.rows as Array<{
        startup_id: string;
        metric_key: string;
        value: string;
        captured_at: Date;
      }>;
      for (const row of historyRows) {
        await db.execute(
          sql`INSERT INTO health_snapshot_history (id, startup_id, metric_key, value, snapshot_id, captured_at)
              VALUES (gen_random_uuid(), ${row.startup_id}, ${row.metric_key}, ${row.value}, ${input.snapshotId}, ${row.captured_at})`
        );
      }

      // Insert funnel stage rows.
      for (const stage of input.funnel) {
        await db.execute(
          sql`INSERT INTO health_funnel_stage (id, startup_id, key, label, value, position, snapshot_id)
              VALUES (${stage.id}, ${input.startupId}, ${stage.key}, ${stage.label}, ${stage.value}, ${stage.position}, ${input.snapshotId})`
        );
      }
    },

    async findSnapshot(
      startupId: string
    ): Promise<HealthSnapshotRow | undefined> {
      const result = await db.execute(
        sql`SELECT id, startup_id, health_state, blocked_reason, north_star_key, north_star_value, north_star_previous_value, supporting_metrics, sync_job_id, computed_at
            FROM health_snapshot WHERE startup_id = ${startupId} LIMIT 1`
      );

      const row = result.rows[0] as
        | {
            id: string;
            startup_id: string;
            health_state: string;
            blocked_reason: string | null;
            north_star_key: string;
            north_star_value: string | null;
            north_star_previous_value: string | null;
            supporting_metrics: unknown;
            sync_job_id: string | null;
            computed_at: Date;
          }
        | undefined;

      if (!row) {
        return undefined;
      }

      return {
        id: row.id,
        startupId: row.startup_id,
        healthState: row.health_state,
        blockedReason: row.blocked_reason,
        northStarKey: row.north_star_key,
        northStarValue:
          row.north_star_value == null ? 0 : Number(row.north_star_value),
        northStarPreviousValue:
          row.north_star_previous_value == null
            ? null
            : Number(row.north_star_previous_value),
        supportingMetrics: row.supporting_metrics,
        syncJobId: row.sync_job_id,
        computedAt: row.computed_at,
      };
    },

    async findFunnelStages(startupId: string): Promise<FunnelStageRow[]> {
      const result = await db.execute(
        sql`SELECT key, label, value, position
            FROM health_funnel_stage WHERE startup_id = ${startupId}
            ORDER BY position ASC`
      );

      return (
        result.rows as Array<{
          key: string;
          label: string;
          value: number;
          position: number;
        }>
      ).map((row) => ({
        key: row.key,
        label: row.label,
        value: row.value,
        position: row.position,
      }));
    },

    async recordHistory(input: RecordHistoryInput): Promise<void> {
      // Record north star metric
      const northStarStr = String(input.northStarValue);
      await db.execute(
        sql`INSERT INTO health_snapshot_history (id, startup_id, metric_key, value, snapshot_id, captured_at)
            VALUES (gen_random_uuid(), ${input.startupId}, ${input.northStarKey}, ${northStarStr}, ${input.snapshotId}, ${input.capturedAt})`
      );

      // Record each supporting metric
      for (const [key, val] of Object.entries(input.supportingMetrics)) {
        if (val == null || !Number.isFinite(val)) {
          continue;
        }
        const valStr = String(val);
        await db.execute(
          sql`INSERT INTO health_snapshot_history (id, startup_id, metric_key, value, snapshot_id, captured_at)
              VALUES (gen_random_uuid(), ${input.startupId}, ${key}, ${valStr}, ${input.snapshotId}, ${input.capturedAt})`
        );
      }
    },

    async checkHealthTablesExist(): Promise<{
      snapshotReady: boolean;
      funnelReady: boolean;
    }> {
      const result = await db.execute(
        sql`SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name IN ('health_snapshot', 'health_funnel_stage')`
      );

      const tables = new Set(
        (result.rows as Array<{ table_name: string }>).map((r) => r.table_name)
      );

      return {
        snapshotReady: tables.has("health_snapshot"),
        funnelReady: tables.has("health_funnel_stage"),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Startup Insight Repository
// ---------------------------------------------------------------------------

/** Row shape for a persisted startup insight (read-back). */
export interface InsightRow {
  conditionCode: string;
  evidence: unknown;
  explainerLatencyMs: number | null;
  explanation: unknown;
  generatedAt: Date;
  generationStatus: string;
  id: string;
  lastError: string | null;
  model: string | null;
  startupId: string;
  updatedAt: Date;
}

/** Input for replacing the latest insight for a startup. */
export interface ReplaceInsightInput {
  conditionCode: InsightConditionCode;
  evidence: EvidencePacket;
  explainerLatencyMs: number | null;
  explanation: InsightExplanation | null;
  generatedAt: Date;
  generationStatus: InsightGenerationStatus;
  insightId: string;
  lastError: string | null;
  model: string | null;
  startupId: string;
}

/** Input for updating only the diagnostics on an existing insight row. */
export interface UpdateInsightDiagnosticsInput {
  generationStatus: InsightGenerationStatus;
  lastError: string | null;
  startupId: string;
  updatedAt: Date;
}

/** Startup insight read/write operations for the worker. */
export interface InsightRepository {
  /** Check whether the startup_insight table exists in the database. */
  checkInsightTableExists(): Promise<boolean>;

  /** Load the latest insight for a startup. Returns undefined if none exists. */
  findInsight(startupId: string): Promise<InsightRow | undefined>;
  /**
   * Atomically replace the latest insight for a startup.
   * Deletes the existing row and inserts a new one.
   */
  replaceInsight(input: ReplaceInsightInput): Promise<void>;

  /**
   * Update only the diagnostics (generation status + last error) on an existing insight.
   * Does NOT replace the evidence or explanation — preserves the last good insight data.
   * Returns false if no insight row exists for this startup.
   */
  updateInsightDiagnostics(
    input: UpdateInsightDiagnosticsInput
  ): Promise<boolean>;
}

/**
 * Create an insight repository backed by a Drizzle db instance.
 * Uses parameterized SQL to interact with the startup_insight table.
 * Insight replacement is atomic: old row is deleted and new row inserted
 * within the same serial connection.
 */
export function createInsightRepository(db: DrizzleHandle): InsightRepository {
  return {
    async replaceInsight(input: ReplaceInsightInput): Promise<void> {
      const evidenceJson = JSON.stringify(input.evidence);
      const explanationJson =
        input.explanation === null ? null : JSON.stringify(input.explanation);

      // Delete existing insight for this startup.
      await db.execute(
        sql`DELETE FROM startup_insight WHERE startup_id = ${input.startupId}`
      );

      // Insert new insight.
      if (explanationJson === null) {
        await db.execute(
          sql`INSERT INTO startup_insight (id, startup_id, condition_code, evidence, explanation, generation_status, last_error, model, explainer_latency_ms, generated_at, updated_at)
              VALUES (${input.insightId}, ${input.startupId}, ${input.conditionCode}, ${evidenceJson}::jsonb, NULL, ${input.generationStatus}, ${input.lastError}, ${input.model}, ${input.explainerLatencyMs}, ${input.generatedAt}, ${input.generatedAt})`
        );
      } else {
        await db.execute(
          sql`INSERT INTO startup_insight (id, startup_id, condition_code, evidence, explanation, generation_status, last_error, model, explainer_latency_ms, generated_at, updated_at)
              VALUES (${input.insightId}, ${input.startupId}, ${input.conditionCode}, ${evidenceJson}::jsonb, ${explanationJson}::jsonb, ${input.generationStatus}, ${input.lastError}, ${input.model}, ${input.explainerLatencyMs}, ${input.generatedAt}, ${input.generatedAt})`
        );
      }
    },

    async findInsight(startupId: string): Promise<InsightRow | undefined> {
      const result = await db.execute(
        sql`SELECT id, startup_id, condition_code, evidence, explanation, generation_status, last_error, model, explainer_latency_ms, generated_at, updated_at
            FROM startup_insight WHERE startup_id = ${startupId} LIMIT 1`
      );

      const row = result.rows[0] as
        | {
            id: string;
            startup_id: string;
            condition_code: string;
            evidence: unknown;
            explanation: unknown;
            generation_status: string;
            last_error: string | null;
            model: string | null;
            explainer_latency_ms: number | null;
            generated_at: Date;
            updated_at: Date;
          }
        | undefined;

      if (!row) {
        return undefined;
      }

      return {
        id: row.id,
        startupId: row.startup_id,
        conditionCode: row.condition_code,
        evidence: row.evidence,
        explanation: row.explanation,
        generationStatus: row.generation_status,
        lastError: row.last_error,
        model: row.model,
        explainerLatencyMs: row.explainer_latency_ms,
        generatedAt: row.generated_at,
        updatedAt: row.updated_at,
      };
    },

    async updateInsightDiagnostics(
      input: UpdateInsightDiagnosticsInput
    ): Promise<boolean> {
      const result = await db.execute(
        sql`UPDATE startup_insight
            SET generation_status = ${input.generationStatus},
                last_error = ${input.lastError},
                updated_at = ${input.updatedAt}
            WHERE startup_id = ${input.startupId}`
      );

      // Check if any row was actually updated.
      // Drizzle's execute result shape varies, but rowCount is standard for pg.
      const affected =
        (result as unknown as { rowCount?: number }).rowCount ?? 0;
      return affected > 0;
    },

    async checkInsightTableExists(): Promise<boolean> {
      const result = await db.execute(
        sql`SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'startup_insight'`
      );

      return result.rows.length > 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Internal Task Sync Repository
// ---------------------------------------------------------------------------

/** Row shape for a persisted internal task needed by the sync processor. */
export interface InternalTaskRow {
  description: string;
  id: string;
  linearIssueId: string | null;
  linkedMetricKeys: string[];
  sourceActionIndex: number;
  sourceInsightId: string;
  startupId: string;
  syncStatus: string;
  title: string;
}

/** Input for marking a task as synced with external issue data. */
export interface MarkTaskSyncedInput {
  linearIssueId: string;
  linearIssueUrl: string;
  syncedAt: Date;
  taskId: string;
}

/** Input for marking a task sync as failed. */
export interface MarkTaskSyncFailedInput {
  attemptAt: Date;
  error: string;
  taskId: string;
}

/** Internal task read/write operations for the worker sync processor. */
export interface InternalTaskRepository {
  /** Load an internal task by ID. Returns undefined if not found. */
  findTask(taskId: string): Promise<InternalTaskRow | undefined>;

  /** Mark a task as synced with the external Linear issue reference. */
  markTaskSynced(input: MarkTaskSyncedInput): Promise<void>;

  /** Mark a task sync as failed and record the error. */
  markTaskSyncFailed(input: MarkTaskSyncFailedInput): Promise<void>;

  /** Update sync status to 'syncing' to indicate an attempt in progress. */
  markTaskSyncing(taskId: string, attemptAt: Date): Promise<void>;
}

/**
 * Create an internal task repository backed by a Drizzle db instance.
 * Uses parameterized SQL to interact with the internal_task table.
 */
export function createInternalTaskRepository(
  db: DrizzleHandle
): InternalTaskRepository {
  return {
    async findTask(taskId: string): Promise<InternalTaskRow | undefined> {
      const result = await db.execute(
        sql`SELECT id, startup_id, title, description, linked_metric_keys,
                   sync_status, linear_issue_id, source_insight_id, source_action_index
            FROM internal_task WHERE id = ${taskId} LIMIT 1`
      );

      const row = result.rows[0] as
        | {
            id: string;
            startup_id: string;
            title: string;
            description: string;
            linked_metric_keys: unknown;
            sync_status: string;
            linear_issue_id: string | null;
            source_insight_id: string;
            source_action_index: number;
          }
        | undefined;

      if (!row) {
        return undefined;
      }

      return {
        id: row.id,
        startupId: row.startup_id,
        title: row.title,
        description: row.description,
        linkedMetricKeys: Array.isArray(row.linked_metric_keys)
          ? (row.linked_metric_keys as string[])
          : [],
        syncStatus: row.sync_status,
        linearIssueId: row.linear_issue_id,
        sourceInsightId: row.source_insight_id,
        sourceActionIndex: row.source_action_index,
      };
    },

    async markTaskSyncing(taskId: string, attemptAt: Date): Promise<void> {
      await db.execute(
        sql`UPDATE internal_task
            SET sync_status = 'syncing',
                last_sync_attempt_at = ${attemptAt},
                updated_at = ${attemptAt}
            WHERE id = ${taskId}`
      );
    },

    async markTaskSynced(input: MarkTaskSyncedInput): Promise<void> {
      await db.execute(
        sql`UPDATE internal_task
            SET sync_status = 'synced',
                linear_issue_id = ${input.linearIssueId},
                last_sync_error = NULL,
                last_sync_attempt_at = ${input.syncedAt},
                updated_at = ${input.syncedAt}
            WHERE id = ${input.taskId}`
      );
    },

    async markTaskSyncFailed(input: MarkTaskSyncFailedInput): Promise<void> {
      await db.execute(
        sql`UPDATE internal_task
            SET sync_status = 'failed',
                last_sync_error = ${input.error},
                last_sync_attempt_at = ${input.attemptAt},
                updated_at = ${input.attemptAt}
            WHERE id = ${input.taskId}`
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Custom Metric Repository
// ---------------------------------------------------------------------------

/** Row shape for a persisted custom metric (read-back). */
export interface CustomMetricRow {
  capturedAt: Date | null;
  category: string;
  connectorId: string;
  createdAt: Date;
  delta: number | null;
  id: string;
  key: string;
  label: string;
  metricValue: number | null;
  previousValue: number | null;
  startupId: string;
  unit: string;
  updatedAt: Date;
}

/** A single metric to upsert during a successful Postgres sync. */
export interface UpsertMetricInput {
  category: string;
  key: string;
  label: string;
  unit: string;
  value: number;
}

/** Input for upserting multiple custom metrics after a successful sync. */
export interface UpsertCustomMetricsInput {
  connectorId: string;
  metrics: UpsertMetricInput[];
  startupId: string;
}

/** Input for marking a custom metric sync as failed (preserves last-good data). */
export interface UpdateCustomMetricFailureInput {
  startupId: string;
  status: "error";
}

/** Custom metric read/write operations for the worker sync processor. */
export interface CustomMetricRepository {
  /** Find all custom metric rows for a startup. */
  findAllByStartupId(startupId: string): Promise<CustomMetricRow[]>;
  /** Find the custom metric row linked to a specific connector. */
  findByConnectorId(connectorId: string): Promise<CustomMetricRow | undefined>;

  /**
   * Mark all custom metrics for a startup as 'error' without wiping last-good data.
   */
  updateOnSyncFailure(input: UpdateCustomMetricFailureInput): Promise<void>;

  /**
   * Upsert multiple custom metrics for a startup.
   * For each metric: if (startupId, key) exists, update metricValue (moving old to
   * previousValue) and compute delta. If not, insert a new row.
   */
  upsertMetrics(input: UpsertCustomMetricsInput): Promise<void>;
}

/**
 * Create a custom metric repository backed by a Drizzle db instance.
 * Uses parameterized SQL to interact with the custom_metric table.
 */
export function createCustomMetricRepository(
  db: DrizzleHandle
): CustomMetricRepository {
  interface RawRow {
    captured_at: Date | null;
    category: string;
    connector_id: string;
    created_at: Date;
    delta: string | null;
    id: string;
    key: string;
    label: string;
    metric_value: string | null;
    previous_value: string | null;
    startup_id: string;
    unit: string;
    updated_at: Date;
  }

  function mapRow(row: RawRow): CustomMetricRow {
    return {
      id: row.id,
      startupId: row.startup_id,
      connectorId: row.connector_id,
      key: row.key,
      label: row.label,
      unit: row.unit,
      category: row.category,
      metricValue:
        row.metric_value === null ? null : Number.parseFloat(row.metric_value),
      previousValue:
        row.previous_value === null
          ? null
          : Number.parseFloat(row.previous_value),
      delta: row.delta === null ? null : Number.parseFloat(row.delta),
      capturedAt: row.captured_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return {
    async findAllByStartupId(startupId: string): Promise<CustomMetricRow[]> {
      const result = await db.execute(
        sql`SELECT id, startup_id, connector_id, key, label, unit, category,
                   metric_value, previous_value, delta, captured_at, created_at, updated_at
            FROM custom_metric WHERE startup_id = ${startupId}`
      );

      return (result.rows as RawRow[]).map(mapRow);
    },

    async findByConnectorId(
      connectorId: string
    ): Promise<CustomMetricRow | undefined> {
      const result = await db.execute(
        sql`SELECT id, startup_id, connector_id, key, label, unit, category,
                   metric_value, previous_value, delta, captured_at, created_at, updated_at
            FROM custom_metric WHERE connector_id = ${connectorId} LIMIT 1`
      );

      const row = result.rows[0] as RawRow | undefined;
      return row ? mapRow(row) : undefined;
    },

    async upsertMetrics(input: UpsertCustomMetricsInput): Promise<void> {
      const now = new Date();

      // Load existing metrics for delta computation
      const existing = await db.execute(
        sql`SELECT key, metric_value
            FROM custom_metric
            WHERE startup_id = ${input.startupId}`
      );
      const existingByKey = new Map<string, number | null>();
      for (const row of existing.rows as Array<{
        key: string;
        metric_value: string | null;
      }>) {
        existingByKey.set(
          row.key,
          row.metric_value === null ? null : Number.parseFloat(row.metric_value)
        );
      }

      for (const metric of input.metrics) {
        const prevValue = existingByKey.get(metric.key) ?? null;
        const delta = prevValue === null ? null : metric.value - prevValue;
        const metricValueStr = metric.value.toString();
        const prevValueStr = prevValue === null ? null : prevValue.toString();
        const deltaStr = delta === null ? null : delta.toString();

        // Upsert by (startup_id, key) unique constraint
        await db.execute(
          sql`INSERT INTO custom_metric (id, startup_id, connector_id, key, label, unit, category,
                                         metric_value, previous_value, delta, captured_at, created_at, updated_at)
              VALUES (gen_random_uuid(), ${input.startupId}, ${input.connectorId}, ${metric.key},
                      ${metric.label}, ${metric.unit}, ${metric.category},
                      ${metricValueStr}, ${prevValueStr}, ${deltaStr}, ${now}, ${now}, ${now})
              ON CONFLICT (startup_id, key)
              DO UPDATE SET metric_value = ${metricValueStr},
                            previous_value = ${prevValueStr},
                            delta = ${deltaStr},
                            label = ${metric.label},
                            unit = ${metric.unit},
                            category = ${metric.category},
                            connector_id = ${input.connectorId},
                            captured_at = ${now},
                            updated_at = ${now}`
        );
      }
    },

    async updateOnSyncFailure(
      input: UpdateCustomMetricFailureInput
    ): Promise<void> {
      const now = new Date();
      await db.execute(
        sql`UPDATE custom_metric
            SET updated_at = ${now}
            WHERE startup_id = ${input.startupId}`
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Alert Repository — z-score evaluation, seeding, and streak tracking
// ---------------------------------------------------------------------------

/** Result of evaluating a single alert rule. */
export interface AlertEvaluationResult {
  alertId: string;
  isNew: boolean;
  metricKey: string;
  ruleId: string;
  severity: string;
  value: number;
}

/** Alert evaluation, seeding, and streak operations for the worker. */
export interface AlertRepository {
  /** Count active alerts for a startup. */
  countActiveAlerts(startupId: string): Promise<number>;
  /** Evaluate all enabled alert rules for a startup using z-score anomaly detection. */
  evaluateAlerts(startupId: string): Promise<AlertEvaluationResult[]>;
  /** Seed default alert rules if startup has none. Returns count of rules seeded. */
  seedDefaultAlerts(startupId: string, metricKeys: string[]): Promise<number>;
  /** Update the health streak for a startup based on active alert count. */
  updateStreak(startupId: string, hasActiveAlerts: boolean): Promise<void>;
}

// ---------------------------------------------------------------------------
// Z-score evaluation helpers (pure computation)
// ---------------------------------------------------------------------------

const Z_SCORE_THRESHOLD = 2.5;
const HISTORY_WINDOW_DAYS = 30;
const Z_GUARDED_CONDITIONS = new Set(["drop_wow_pct", "spike_vs_avg"]);

interface HistoryStats {
  mean: number;
  previousValue: number;
  stddev: number;
}

function computeStats(values: number[]): HistoryStats {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  return { mean, previousValue: values[0], stddev };
}

function evaluateCondition(
  condition: string,
  current: number,
  threshold: number,
  stats: HistoryStats
): boolean {
  switch (condition) {
    case "drop_wow_pct": {
      const prev = stats.previousValue;
      if (prev === 0) {
        return false;
      }
      const dropPct = ((prev - current) / prev) * 100;
      return dropPct >= threshold;
    }
    case "spike_vs_avg": {
      if (stats.mean === 0) {
        return false;
      }
      return current / stats.mean >= threshold;
    }
    case "below_threshold":
      return current < threshold;
    case "above_threshold":
      return current > threshold;
    default:
      return false;
  }
}

function passesZScoreGuard(
  condition: string,
  current: number,
  stats: HistoryStats
): boolean {
  if (!Z_GUARDED_CONDITIONS.has(condition)) {
    return true;
  }
  if (stats.stddev === 0) {
    return true; // SD=0 → bypass guard
  }
  const z = Math.abs(current - stats.mean) / stats.stddev;
  return z >= Z_SCORE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Default alert rules for seeding
// ---------------------------------------------------------------------------

const DEFAULT_ALERT_RULES: ReadonlyArray<{
  condition: string;
  metricKey: string;
  severity: string;
  threshold: number;
}> = [
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
];

// ---------------------------------------------------------------------------
// Alert Repository implementation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Alert rule evaluation — extracted to reduce cognitive complexity
// ---------------------------------------------------------------------------

interface AlertRuleRow {
  condition: string;
  id: string;
  metric_key: string;
  min_data_points: number;
  severity: string;
  threshold: string;
}

interface SnapshotMetrics {
  northStarKey: string;
  northStarValue: string | null;
  supportingMetrics: Record<string, number>;
}

function lookupMetricValue(
  metricKey: string,
  snap: SnapshotMetrics
): number | undefined {
  if (metricKey in snap.supportingMetrics) {
    return snap.supportingMetrics[metricKey];
  }
  if (metricKey === snap.northStarKey && snap.northStarValue != null) {
    return Number(snap.northStarValue);
  }
  return undefined;
}

async function evaluateSingleRule(
  db: DrizzleHandle,
  rule: AlertRuleRow,
  startupId: string,
  workspaceId: string,
  snap: SnapshotMetrics,
  cutoff: Date
): Promise<AlertEvaluationResult | null> {
  const currentValue = lookupMetricValue(rule.metric_key, snap);
  if (currentValue === undefined) {
    return null;
  }

  // Load 30-day history (most recent first)
  const histResult = await db.execute(
    sql`SELECT value FROM health_snapshot_history
        WHERE startup_id = ${startupId}
          AND metric_key = ${rule.metric_key}
          AND captured_at >= ${cutoff}
        ORDER BY captured_at DESC`
  );
  const historyValues = (histResult.rows as Array<{ value: string }>).map((r) =>
    Number(r.value)
  );

  if (historyValues.length < rule.min_data_points) {
    return null;
  }

  const stats = computeStats(historyValues);
  const threshold = Number(rule.threshold);

  if (!evaluateCondition(rule.condition, currentValue, threshold, stats)) {
    return null;
  }
  if (!passesZScoreGuard(rule.condition, currentValue, stats)) {
    return null;
  }

  // Dedup: check for existing active/snoozed alert
  const dedupResult = await db.execute(
    sql`SELECT id, occurrence_count FROM alert
        WHERE rule_id = ${rule.id}
          AND startup_id = ${startupId}
          AND status IN ('active', 'snoozed')
        LIMIT 1`
  );
  const existing = dedupResult.rows[0] as
    | { id: string; occurrence_count: number }
    | undefined;

  const now = new Date();
  const valueStr = String(currentValue);
  let result: AlertEvaluationResult;

  if (existing) {
    await db.execute(
      sql`UPDATE alert
          SET occurrence_count = occurrence_count + 1,
              last_fired_at = ${now},
              value = ${valueStr}
          WHERE id = ${existing.id}`
    );
    result = {
      alertId: existing.id,
      isNew: false,
      metricKey: rule.metric_key,
      ruleId: rule.id,
      severity: rule.severity,
      value: currentValue,
    };
  } else {
    const alertId = crypto.randomUUID();
    await db.execute(
      sql`INSERT INTO alert (id, startup_id, rule_id, metric_key, severity, value, threshold, status, occurrence_count, fired_at, last_fired_at, created_at)
          VALUES (${alertId}, ${startupId}, ${rule.id}, ${rule.metric_key}, ${rule.severity}, ${valueStr}, ${rule.threshold}, 'active', 1, ${now}, ${now}, ${now})`
    );
    result = {
      alertId,
      isNew: true,
      metricKey: rule.metric_key,
      ruleId: rule.id,
      severity: rule.severity,
      value: currentValue,
    };
  }

  // Emit alert.fired event (fire-and-forget)
  const payloadJson = JSON.stringify({
    ruleId: rule.id,
    metricKey: rule.metric_key,
    severity: rule.severity,
    value: currentValue,
    threshold,
  });
  db.execute(
    sql`INSERT INTO event_log (id, workspace_id, startup_id, event_type, actor_type, actor_id, payload, created_at)
        VALUES (gen_random_uuid(), ${workspaceId}, ${startupId}, 'alert.fired', 'system', NULL, ${payloadJson}::jsonb, ${now})`
  ).catch(() => {
    // Silent — event log failures must not block alert evaluation
  });

  return result;
}

/**
 * Create an alert repository backed by a Drizzle db instance.
 * Uses parameterized SQL and mirrors the z-score algorithm from the API evaluator.
 */
export function createAlertRepository(db: DrizzleHandle): AlertRepository {
  return {
    async countActiveAlerts(startupId: string): Promise<number> {
      const result = await db.execute(
        sql`SELECT COUNT(*)::int AS cnt FROM alert
            WHERE startup_id = ${startupId} AND status = 'active'`
      );
      const row = result.rows[0] as { cnt: number } | undefined;
      return row?.cnt ?? 0;
    },

    async evaluateAlerts(startupId: string): Promise<AlertEvaluationResult[]> {
      // 0. Fetch workspace_id for event emission
      const startupResult = await db.execute(
        sql`SELECT workspace_id FROM startup WHERE id = ${startupId} LIMIT 1`
      );
      const startupRow = startupResult.rows[0] as
        | { workspace_id: string }
        | undefined;
      if (!startupRow) {
        return [];
      }

      // 1. Load enabled alert rules
      const rulesResult = await db.execute(
        sql`SELECT id, metric_key, condition, threshold, severity, min_data_points
            FROM alert_rule
            WHERE startup_id = ${startupId} AND enabled = true`
      );
      const rules = rulesResult.rows as AlertRuleRow[];
      if (rules.length === 0) {
        return [];
      }

      // 2. Load current health snapshot metrics
      const snapResult = await db.execute(
        sql`SELECT north_star_key, north_star_value, supporting_metrics
            FROM health_snapshot
            WHERE startup_id = ${startupId} LIMIT 1`
      );
      const snapRow = snapResult.rows[0] as
        | {
            north_star_key: string;
            north_star_value: string | null;
            supporting_metrics: Record<string, number>;
          }
        | undefined;
      if (!snapRow) {
        return [];
      }

      const snap: SnapshotMetrics = {
        northStarKey: snapRow.north_star_key,
        northStarValue: snapRow.north_star_value,
        supportingMetrics: (snapRow.supporting_metrics ?? {}) as Record<
          string,
          number
        >,
      };

      const cutoff = new Date(
        Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000
      );
      const results: AlertEvaluationResult[] = [];

      // 3. Evaluate each rule
      for (const rule of rules) {
        const result = await evaluateSingleRule(
          db,
          rule,
          startupId,
          startupRow.workspace_id,
          snap,
          cutoff
        );
        if (result) {
          results.push(result);
        }
      }

      return results;
    },

    async seedDefaultAlerts(
      startupId: string,
      metricKeys: string[]
    ): Promise<number> {
      // Check if startup already has any alert rules
      const existingResult = await db.execute(
        sql`SELECT id FROM alert_rule WHERE startup_id = ${startupId} LIMIT 1`
      );
      if ((existingResult.rows as unknown[]).length > 0) {
        return 0;
      }

      const metricSet = new Set(metricKeys);
      const toSeed = DEFAULT_ALERT_RULES.filter((r) =>
        metricSet.has(r.metricKey)
      );
      if (toSeed.length === 0) {
        return 0;
      }

      const now = new Date();
      for (const rule of toSeed) {
        const thresholdStr = String(rule.threshold);
        await db.execute(
          sql`INSERT INTO alert_rule (id, startup_id, metric_key, condition, threshold, severity, enabled, min_data_points, created_at, updated_at)
              VALUES (gen_random_uuid(), ${startupId}, ${rule.metricKey}, ${rule.condition}, ${thresholdStr}, ${rule.severity}, true, 7, ${now}, ${now})`
        );
      }

      return toSeed.length;
    },

    async updateStreak(
      startupId: string,
      hasActiveAlerts: boolean
    ): Promise<void> {
      const now = new Date();

      if (hasActiveAlerts) {
        // Reset streak: set current_days to 0, record broken_at
        await db.execute(
          sql`INSERT INTO streak (id, startup_id, current_days, longest_days, started_at, broken_at, updated_at)
              VALUES (gen_random_uuid(), ${startupId}, 0, 0, NULL, ${now}, ${now})
              ON CONFLICT (startup_id) DO UPDATE
                SET current_days = 0,
                    broken_at = ${now},
                    updated_at = ${now}`
        );
      } else {
        // Increment streak: current_days + 1, update longest if needed, set started_at if new streak
        await db.execute(
          sql`INSERT INTO streak (id, startup_id, current_days, longest_days, started_at, updated_at)
              VALUES (gen_random_uuid(), ${startupId}, 1, 1, ${now}, ${now})
              ON CONFLICT (startup_id) DO UPDATE
                SET current_days = streak.current_days + 1,
                    longest_days = GREATEST(streak.longest_days, streak.current_days + 1),
                    started_at = COALESCE(streak.started_at, ${now}),
                    updated_at = ${now}`
        );
      }
    },
  };
}
