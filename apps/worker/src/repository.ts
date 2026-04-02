// Sync repository implementation using Drizzle ORM.
// Provides the DB operations the sync processor needs.
// Uses Drizzle's sql tagged template for parameterized queries
// to avoid importing schema tables from the API package.

import type {
  FunnelStageRow,
  HealthState,
  NorthStarMetric,
  SupportingMetricsSnapshot,
} from "@shared/startup-health";
import type {
  EvidencePacket,
  InsightConditionCode,
  InsightExplanation,
  InsightGenerationStatus,
} from "@shared/startup-insight";
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
  northStarValue: number;
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
    stage: string;
    label: string;
    value: number;
    position: number;
  }>;
  healthState: HealthState;
  northStarKey: NorthStarMetric;
  northStarPreviousValue: number | null;
  northStarValue: number;
  snapshotId: string;
  startupId: string;
  supportingMetrics: SupportingMetricsSnapshot;
  syncJobId: string | null;
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
   * Atomically replace the health snapshot + funnel stages for a startup.
   * Deletes existing rows and inserts the new set within a single transaction.
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

      // Delete existing funnel stages for this startup first (FK cascade would handle it,
      // but explicit deletion keeps intent clear and works even without cascade).
      await db.execute(
        sql`DELETE FROM health_funnel_stage WHERE startup_id = ${input.startupId}`
      );

      // Delete existing snapshot for this startup.
      await db.execute(
        sql`DELETE FROM health_snapshot WHERE startup_id = ${input.startupId}`
      );

      // Insert new snapshot.
      await db.execute(
        sql`INSERT INTO health_snapshot (id, startup_id, health_state, blocked_reason, north_star_key, north_star_value, north_star_previous_value, supporting_metrics, sync_job_id, computed_at)
            VALUES (${input.snapshotId}, ${input.startupId}, ${input.healthState}, ${input.blockedReason}, ${input.northStarKey}, ${input.northStarValue}, ${input.northStarPreviousValue}, ${metricsJson}::jsonb, ${input.syncJobId}, ${input.computedAt})`
      );

      // Insert funnel stage rows.
      for (const stage of input.funnel) {
        await db.execute(
          sql`INSERT INTO health_funnel_stage (id, startup_id, stage, label, value, position, snapshot_id)
              VALUES (${stage.id}, ${input.startupId}, ${stage.stage}, ${stage.label}, ${stage.value}, ${stage.position}, ${input.snapshotId})`
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
            north_star_value: number;
            north_star_previous_value: number | null;
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
        northStarValue: row.north_star_value,
        northStarPreviousValue: row.north_star_previous_value,
        supportingMetrics: row.supporting_metrics,
        syncJobId: row.sync_job_id,
        computedAt: row.computed_at,
      };
    },

    async findFunnelStages(startupId: string): Promise<FunnelStageRow[]> {
      const result = await db.execute(
        sql`SELECT stage, label, value, position
            FROM health_funnel_stage WHERE startup_id = ${startupId}
            ORDER BY position ASC`
      );

      return (
        result.rows as Array<{
          stage: string;
          label: string;
          value: number;
          position: number;
        }>
      ).map((row) => ({
        stage: row.stage as FunnelStageRow["stage"],
        label: row.label,
        value: row.value,
        position: row.position,
      }));
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
  connectorId: string;
  createdAt: Date;
  id: string;
  label: string;
  metricValue: number | null;
  previousValue: number | null;
  schema: string;
  startupId: string;
  status: string;
  unit: string;
  updatedAt: Date;
  view: string;
}

/** Input for updating the custom metric after a successful sync. */
export interface UpdateCustomMetricSuccessInput {
  capturedAt: Date;
  metricValue: number;
  previousValue: number | null;
  startupId: string;
}

/** Input for marking a custom metric sync as failed (preserves last-good data). */
export interface UpdateCustomMetricFailureInput {
  startupId: string;
  status: "error";
}

/** Custom metric read/write operations for the worker sync processor. */
export interface CustomMetricRepository {
  /** Find the custom metric row linked to a specific connector. */
  findByConnectorId(connectorId: string): Promise<CustomMetricRow | undefined>;
  /** Find the custom metric row for a startup. Returns undefined if none exists. */
  findByStartupId(startupId: string): Promise<CustomMetricRow | undefined>;

  /**
   * Mark the custom metric status as 'error' without wiping the last-good data.
   * The previous metricValue, previousValue, and capturedAt remain intact.
   */
  updateOnSyncFailure(input: UpdateCustomMetricFailureInput): Promise<void>;

  /**
   * Update the custom metric with new sync data.
   * Moves the current metricValue to previousValue, sets the new value,
   * and marks the status as 'active'.
   */
  updateOnSyncSuccess(input: UpdateCustomMetricSuccessInput): Promise<void>;
}

/**
 * Create a custom metric repository backed by a Drizzle db instance.
 * Uses parameterized SQL to interact with the custom_metric table.
 */
export function createCustomMetricRepository(
  db: DrizzleHandle
): CustomMetricRepository {
  return {
    async findByStartupId(
      startupId: string
    ): Promise<CustomMetricRow | undefined> {
      const result = await db.execute(
        sql`SELECT id, startup_id, connector_id, label, unit, schema, view, status,
                   metric_value, previous_value, captured_at, created_at, updated_at
            FROM custom_metric WHERE startup_id = ${startupId} LIMIT 1`
      );

      const row = result.rows[0] as
        | {
            id: string;
            startup_id: string;
            connector_id: string;
            label: string;
            unit: string;
            schema: string;
            view: string;
            status: string;
            metric_value: string | null;
            previous_value: string | null;
            captured_at: Date | null;
            created_at: Date;
            updated_at: Date;
          }
        | undefined;

      if (!row) {
        return undefined;
      }

      return {
        id: row.id,
        startupId: row.startup_id,
        connectorId: row.connector_id,
        label: row.label,
        unit: row.unit,
        schema: row.schema,
        view: row.view,
        status: row.status,
        metricValue:
          row.metric_value === null
            ? null
            : Number.parseFloat(row.metric_value),
        previousValue:
          row.previous_value === null
            ? null
            : Number.parseFloat(row.previous_value),
        capturedAt: row.captured_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },

    async findByConnectorId(
      connectorId: string
    ): Promise<CustomMetricRow | undefined> {
      const result = await db.execute(
        sql`SELECT id, startup_id, connector_id, label, unit, schema, view, status,
                   metric_value, previous_value, captured_at, created_at, updated_at
            FROM custom_metric WHERE connector_id = ${connectorId} LIMIT 1`
      );

      const row = result.rows[0] as
        | {
            id: string;
            startup_id: string;
            connector_id: string;
            label: string;
            unit: string;
            schema: string;
            view: string;
            status: string;
            metric_value: string | null;
            previous_value: string | null;
            captured_at: Date | null;
            created_at: Date;
            updated_at: Date;
          }
        | undefined;

      if (!row) {
        return undefined;
      }

      return {
        id: row.id,
        startupId: row.startup_id,
        connectorId: row.connector_id,
        label: row.label,
        unit: row.unit,
        schema: row.schema,
        view: row.view,
        status: row.status,
        metricValue:
          row.metric_value === null
            ? null
            : Number.parseFloat(row.metric_value),
        previousValue:
          row.previous_value === null
            ? null
            : Number.parseFloat(row.previous_value),
        capturedAt: row.captured_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    },

    async updateOnSyncSuccess(
      input: UpdateCustomMetricSuccessInput
    ): Promise<void> {
      const now = new Date();
      await db.execute(
        sql`UPDATE custom_metric
            SET status = 'active',
                metric_value = ${input.metricValue.toString()},
                previous_value = ${input.previousValue === null ? null : input.previousValue.toString()},
                captured_at = ${input.capturedAt},
                updated_at = ${now}
            WHERE startup_id = ${input.startupId}`
      );
    },

    async updateOnSyncFailure(
      input: UpdateCustomMetricFailureInput
    ): Promise<void> {
      const now = new Date();
      await db.execute(
        sql`UPDATE custom_metric
            SET status = 'error',
                updated_at = ${now}
            WHERE startup_id = ${input.startupId}`
      );
    },
  };
}
