// Connector sync processor.
// Loads connector rows, decrypts credentials, calls provider adapters,
// persists queued → running → completed/failed transitions, and
// recomputes the startup health snapshot on successful syncs.
//
// Uses dependency injection for DB operations to avoid cross-package imports.
// The connector/syncJob schema is defined in the API package; we interact
// via typed repository functions injected at startup.

import { randomUUID } from "node:crypto";
import type {
  ConnectorProvider,
  ProviderValidationResult,
  SyncJobPayload,
} from "@shared/connectors";
import { decryptConnectorConfig, parseEncryptionKey } from "@shared/crypto";
import type { SupportingMetricsSnapshot } from "@shared/startup-health";
import type { Job } from "bullmq";
import type { ExplainerFn } from "../insights";
import { generateInsight } from "../insights";
import type { PostgresSyncResult, ProviderSyncResult } from "../providers";
import { mergeFunnel, mergeMetrics } from "../providers";
import type {
  CustomMetricRepository,
  HealthSnapshotRepository,
  InsightRepository,
  ReplaceSnapshotInput,
} from "../repository";

/** Row shape the processor needs from the connector table. */
export interface ConnectorRow {
  encryptedConfig: string;
  encryptionAuthTag: string;
  encryptionIv: string;
  id: string;
  provider: string;
}

/** Repository interface for connector/sync_job DB operations. */
export interface SyncRepository {
  /** Load a connector by ID. Returns undefined if not found. */
  findConnector(connectorId: string): Promise<ConnectorRow | undefined>;
  /** Mark a sync job as completed and update the connector to connected. */
  markSyncJobCompleted(
    syncJobId: string,
    connectorId: string,
    completedAt: Date,
    durationMs: number
  ): Promise<void>;
  /** Mark a sync job as failed and update the connector to error. */
  markSyncJobFailed(
    syncJobId: string,
    connectorId: string,
    error: string,
    completedAt: Date,
    durationMs: number
  ): Promise<void>;
  /** Mark a sync job as running. */
  markSyncJobRunning(
    syncJobId: string,
    startedAt: Date,
    attempt: number
  ): Promise<void>;
}

export type ProviderValidateFn = (
  provider: ConnectorProvider,
  configJson: string
) => Promise<ProviderValidationResult>;

export interface SyncProcessorDeps {
  /** Optional custom metric repository — when provided, the processor
   *  updates custom metric data after successful Postgres syncs. */
  customMetricRepo?: CustomMetricRepository;
  encryptionKey: string;
  /** Optional explainer function for insight generation. */
  explainer?: ExplainerFn;
  /** Optional health snapshot repository — when provided, the processor
   *  recomputes and persists health data after successful syncs. */
  healthRepo?: HealthSnapshotRepository;
  /** Optional insight repository — when provided alongside explainer,
   *  the processor generates an insight after snapshot recompute. */
  insightRepo?: InsightRepository;
  log: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
  repo: SyncRepository;
  validateProvider: ProviderValidateFn;
}

/**
 * Determine health state from the current data and sync outcome.
 */
function computeHealthState(
  _mrr: number | null,
  syncResult: ProviderSyncResult
): "ready" | "syncing" | "error" {
  if (!syncResult.valid) {
    return "error";
  }
  return "ready";
}

/**
 * Attempt to recompute and persist the health snapshot after a successful sync.
 * Failures here are logged but never cause the sync job to fail — the previous
 * snapshot is preserved instead.
 */
async function recomputeSnapshot(
  deps: SyncProcessorDeps,
  startupId: string,
  syncJobId: string,
  syncResult: ProviderSyncResult,
  logCtx: Record<string, unknown>
): Promise<void> {
  if (!deps.healthRepo) {
    return;
  }

  try {
    // Read the previous snapshot for delta computation
    const previous = await deps.healthRepo.findSnapshot(startupId);
    const previousMetrics: SupportingMetricsSnapshot | null =
      previous?.supportingMetrics
        ? (previous.supportingMetrics as SupportingMetricsSnapshot)
        : null;

    const previousMrr = previous?.northStarValue ?? null;

    // Determine which provider produced this data
    const isStripeResult = syncResult.mrr !== null;
    const stripeMetrics = isStripeResult ? syncResult.supportingMetrics : null;
    const posthogMetrics = isStripeResult ? null : syncResult.supportingMetrics;

    // If we have a previous snapshot and this sync only covers one provider,
    // carry forward the other provider's metrics from the previous snapshot
    const mergedMetrics = mergeMetrics(
      stripeMetrics,
      posthogMetrics,
      previousMetrics
    );
    const mergedFunnel = mergeFunnel(syncResult.funnelStages);

    // MRR: use this sync's value if from Stripe, else carry forward
    const mrr = syncResult.mrr ?? previous?.northStarValue ?? 0;
    const healthState = computeHealthState(mrr, syncResult);

    const snapshotId = randomUUID();
    const computedAt = new Date();

    const input: ReplaceSnapshotInput = {
      snapshotId,
      startupId,
      healthState,
      blockedReason: null,
      northStarKey: "mrr",
      northStarValue: mrr,
      northStarPreviousValue: previousMrr,
      supportingMetrics: mergedMetrics,
      syncJobId,
      computedAt,
      funnel: mergedFunnel.map((stage) => ({
        id: randomUUID(),
        stage: stage.stage,
        label: stage.label,
        value: stage.value,
        position: stage.position,
      })),
    };

    await deps.healthRepo.replaceSnapshot(input);

    deps.log.info("health snapshot recomputed", {
      ...logCtx,
      snapshotId,
      healthState,
      mrr,
      computedAt: computedAt.toISOString(),
    });
  } catch (err) {
    // Snapshot recompute failure must not fail the sync job.
    // The previous snapshot (if any) stays intact.
    deps.log.error(
      "health snapshot recompute failed — previous snapshot preserved",
      {
        ...logCtx,
        error: err instanceof Error ? err.message : String(err),
      }
    );
  }
}

function getSyncDurationMs(startedAt: Date, completedAt: Date): number {
  return completedAt.getTime() - startedAt.getTime();
}

async function failSyncJob(
  deps: SyncProcessorDeps,
  syncJobId: string,
  connectorId: string,
  startedAt: Date,
  error: string
) {
  const completedAt = new Date();
  await deps.repo.markSyncJobFailed(
    syncJobId,
    connectorId,
    error,
    completedAt,
    getSyncDurationMs(startedAt, completedAt)
  );
}

async function loadConnectorOrFail(
  deps: SyncProcessorDeps,
  connectorId: string,
  syncJobId: string,
  startedAt: Date,
  logCtx: Record<string, unknown>
): Promise<ConnectorRow> {
  const connectorRow = await deps.repo.findConnector(connectorId);
  if (connectorRow) {
    return connectorRow;
  }

  const error = `Connector ${connectorId} not found — may have been deleted.`;
  await failSyncJob(deps, syncJobId, connectorId, startedAt, error);
  deps.log.error("connector not found", { ...logCtx, error });
  throw new Error(error);
}

async function decryptConnectorConfigOrFail(
  deps: SyncProcessorDeps,
  connectorRow: ConnectorRow,
  connectorId: string,
  keyBuffer: Buffer,
  syncJobId: string,
  startedAt: Date,
  logCtx: Record<string, unknown>
) {
  try {
    return decryptConnectorConfig(
      {
        ciphertext: connectorRow.encryptedConfig,
        iv: connectorRow.encryptionIv,
        authTag: connectorRow.encryptionAuthTag,
      },
      keyBuffer
    );
  } catch (decryptError) {
    const error = `Decryption failed for connector ${connectorId}: ${decryptError instanceof Error ? decryptError.message : "unknown"}`;
    await failSyncJob(deps, syncJobId, connectorId, startedAt, error);
    deps.log.error("decryption failed", {
      ...logCtx,
      error:
        decryptError instanceof Error
          ? decryptError.message
          : String(decryptError),
    });
    throw new Error(error);
  }
}

async function validateProviderOrFail(
  deps: SyncProcessorDeps,
  provider: ConnectorProvider,
  decryptedConfig: string,
  syncJobId: string,
  connectorId: string,
  startedAt: Date,
  logCtx: Record<string, unknown>
) {
  try {
    return await deps.validateProvider(provider, decryptedConfig);
  } catch (providerError) {
    const error = `Provider validation threw for ${provider}: ${providerError instanceof Error ? providerError.message : "unknown"}`;
    await failSyncJob(deps, syncJobId, connectorId, startedAt, error);
    deps.log.error("provider validation threw", {
      ...logCtx,
      error:
        providerError instanceof Error
          ? providerError.message
          : String(providerError),
    });
    throw new Error(error);
  }
}

function canGenerateInsight(
  deps: SyncProcessorDeps
): deps is SyncProcessorDeps & {
  explainer: ExplainerFn;
  healthRepo: HealthSnapshotRepository;
  insightRepo: InsightRepository;
} {
  return Boolean(deps.explainer && deps.healthRepo && deps.insightRepo);
}

async function maybeGenerateInsight(
  deps: SyncProcessorDeps,
  startupId: string,
  syncJobId: string,
  logCtx: Record<string, unknown>
) {
  if (!canGenerateInsight(deps)) {
    return;
  }

  try {
    const insightResult = await generateInsight(
      {
        healthRepo: deps.healthRepo,
        insightRepo: deps.insightRepo,
        explainer: deps.explainer,
        log: deps.log,
      },
      startupId,
      syncJobId
    );
    deps.log.info("insight generation result", {
      ...logCtx,
      insightGenerated: insightResult.generated,
      conditionCode: insightResult.conditionCode,
      insightStatus: insightResult.status,
    });
  } catch (err) {
    deps.log.error(
      "insight generation unexpected error — sync job unaffected",
      {
        ...logCtx,
        error: err instanceof Error ? err.message : String(err),
      }
    );
  }
}

async function maybeUpdatePostgresMetricOnSuccess(
  deps: SyncProcessorDeps,
  provider: ConnectorProvider,
  result: ProviderValidationResult,
  startupId: string,
  logCtx: Record<string, unknown>
) {
  if (!(provider === "postgres" && deps.customMetricRepo)) {
    return;
  }

  const pgResult = result as PostgresSyncResult;
  if (!pgResult.customMetric) {
    return;
  }

  try {
    await deps.customMetricRepo.updateOnSyncSuccess({
      startupId,
      metricValue: pgResult.customMetric.metricValue,
      previousValue: pgResult.customMetric.previousValue,
      capturedAt: new Date(pgResult.customMetric.capturedAt),
    });
    deps.log.info("custom metric synced", {
      ...logCtx,
      metricValue: pgResult.customMetric.metricValue,
      capturedAt: pgResult.customMetric.capturedAt,
    });
  } catch (err) {
    deps.log.error("custom metric update failed — previous data preserved", {
      ...logCtx,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function maybeUpdatePostgresMetricOnFailure(
  deps: SyncProcessorDeps,
  provider: ConnectorProvider,
  startupId: string,
  error: string,
  logCtx: Record<string, unknown>
) {
  if (!(provider === "postgres" && deps.customMetricRepo)) {
    return;
  }

  try {
    await deps.customMetricRepo.updateOnSyncFailure({
      startupId,
      status: "error",
    });
    deps.log.warn("custom metric marked error — last-good data preserved", {
      ...logCtx,
      error,
    });
  } catch (err) {
    deps.log.error("custom metric failure update failed", {
      ...logCtx,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Create a BullMQ-compatible processor function for connector-sync jobs.
 *
 * Lifecycle per job:
 *   1. Mark sync_job status → running
 *   2. Load connector row by ID
 *   3. Decrypt config with AES-256-GCM
 *   4. Call provider adapter
 *   5a. On success → sync_job=completed, connector.status=connected, update lastSync fields
 *       → recompute health snapshot
 *   5b. On failure → sync_job=failed, connector.status=error, record lastSyncError
 *       → preserve previous health snapshot
 */
export function createSyncProcessor(deps: SyncProcessorDeps) {
  const keyBuffer = parseEncryptionKey(deps.encryptionKey);

  return async function processSyncJob(
    job: Job<SyncJobPayload>
  ): Promise<void> {
    const { connectorId, syncJobId, provider, trigger } = job.data;
    const attempt = job.attemptsMade + 1;
    const startedAt = new Date();

    const logCtx = {
      syncJobId,
      connectorId,
      provider,
      trigger,
      attempt,
      bullmqJobId: job.id,
    };

    deps.log.info("sync job started", logCtx);

    // 1. Mark sync_job → running
    await deps.repo.markSyncJobRunning(syncJobId, startedAt, attempt);

    // 2. Load connector row
    const connectorRow = await loadConnectorOrFail(
      deps,
      connectorId,
      syncJobId,
      startedAt,
      logCtx
    );

    // 3. Decrypt config
    const decryptedConfig = await decryptConnectorConfigOrFail(
      deps,
      connectorRow,
      connectorId,
      keyBuffer,
      syncJobId,
      startedAt,
      logCtx
    );

    // 4. Call provider adapter
    const result = await validateProviderOrFail(
      deps,
      provider,
      decryptedConfig,
      syncJobId,
      connectorId,
      startedAt,
      logCtx
    );

    // 5. Persist outcome
    const completedAt = new Date();
    const durationMs = getSyncDurationMs(startedAt, completedAt);

    if (result.valid) {
      // 5a. Success
      await deps.repo.markSyncJobCompleted(
        syncJobId,
        connectorId,
        completedAt,
        durationMs
      );
      deps.log.info("sync job completed", { ...logCtx, durationMs });

      // Recompute health snapshot if the result includes sync data
      const syncResult = result as ProviderSyncResult;
      if ("mrr" in syncResult || "supportingMetrics" in syncResult) {
        await recomputeSnapshot(
          deps,
          job.data.startupId,
          syncJobId,
          syncResult,
          logCtx
        );
        await maybeGenerateInsight(deps, job.data.startupId, syncJobId, logCtx);
      }

      await maybeUpdatePostgresMetricOnSuccess(
        deps,
        provider,
        result,
        job.data.startupId,
        logCtx
      );
    } else {
      // 5b. Failure
      const error =
        result.error ?? "Provider validation failed without a message.";
      await deps.repo.markSyncJobFailed(
        syncJobId,
        connectorId,
        error,
        completedAt,
        durationMs
      );

      await maybeUpdatePostgresMetricOnFailure(
        deps,
        provider,
        job.data.startupId,
        error,
        logCtx
      );

      if (result.retryable) {
        deps.log.warn("sync job failed (retryable)", {
          ...logCtx,
          error,
          durationMs,
        });
        throw new Error(error); // BullMQ will retry based on job options
      }

      deps.log.error("sync job failed (non-retryable)", {
        ...logCtx,
        error,
        durationMs,
      });
      // Non-retryable: don't throw, so BullMQ marks it as completed (we already recorded failure)
    }
  };
}
