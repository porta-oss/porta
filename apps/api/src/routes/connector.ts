// Connector CRUD, status, and sync-trigger routes.
// All routes require an authenticated session with an active workspace.
// Provider credentials are validated before storage, encrypted at rest,
// and never returned to clients — only redacted summaries.

import { randomUUID } from "node:crypto";
import type {
  ConnectorProvider,
  ConnectorSummary,
  SyncJobSummary,
  SyncTrigger,
} from "@shared/connectors";
import { isConnectorProvider } from "@shared/connectors";
import { encryptConnectorConfig, parseEncryptionKey } from "@shared/crypto";
import type {
  CustomMetricSummary,
  PostgresSetupInput,
} from "@shared/custom-metric";
import { and, asc, desc, eq } from "drizzle-orm";
import { connector, syncJob } from "../db/schema/connector";
import { customMetric } from "../db/schema/custom-metric";
import type { PostgresValidator } from "../lib/connectors/postgres";
import type {
  PostHogConfig,
  PostHogValidator,
  ProviderValidationResult,
} from "../lib/connectors/posthog";
import type { SyncQueueProducer } from "../lib/connectors/queue";
import type { StripeConfig, StripeValidator } from "../lib/connectors/stripe";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface ConnectorRuntime {
  db: {
    db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
  };
  env: {
    connectorEncryptionKey: string;
    authContextTimeoutMs: number;
  };
  postgresValidator: PostgresValidator;
  posthogValidator: PostHogValidator;
  queueProducer: SyncQueueProducer;
  stripeValidator: StripeValidator;
}

interface WorkspaceContext {
  workspace: { id: string };
}

interface ConnectorCreateBody {
  config: Record<string, string>;
  provider: string;
  startupId: string;
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

function serializeConnector(row: {
  id: string;
  startupId: string;
  provider: string;
  status: string;
  lastSyncAt: Date | null;
  lastSyncDurationMs: number | null;
  lastSyncError: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ConnectorSummary {
  return {
    id: row.id,
    startupId: row.startupId,
    provider: row.provider as ConnectorProvider,
    status: row.status as ConnectorSummary["status"],
    lastSyncAt: toIso(row.lastSyncAt),
    lastSyncDurationMs: row.lastSyncDurationMs,
    lastSyncError: row.lastSyncError,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

function serializeSyncJob(row: {
  id: string;
  connectorId: string;
  status: string;
  trigger: string;
  attempt: number;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  durationMs: number | null;
  createdAt: Date;
}): SyncJobSummary {
  return {
    id: row.id,
    connectorId: row.connectorId,
    status: row.status as SyncJobSummary["status"],
    trigger: row.trigger as SyncJobSummary["trigger"],
    attempt: row.attempt,
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
    error: row.error,
    durationMs: row.durationMs,
    createdAt: toIso(row.createdAt)!,
  };
}

function serializeCustomMetric(row: {
  id: string;
  startupId: string;
  connectorId: string;
  label: string;
  unit: string;
  schema: string;
  view: string;
  status: string;
  metricValue: string | null;
  previousValue: string | null;
  capturedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): CustomMetricSummary {
  return {
    id: row.id,
    startupId: row.startupId,
    connectorId: row.connectorId,
    label: row.label,
    unit: row.unit,
    schema: row.schema,
    view: row.view,
    status: row.status as CustomMetricSummary["status"],
    metricValue: row.metricValue === null ? null : Number(row.metricValue),
    previousValue:
      row.previousValue === null ? null : Number(row.previousValue),
    capturedAt: toIso(row.capturedAt),
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

async function validateProviderConfig(
  runtime: ConnectorRuntime,
  provider: ConnectorProvider,
  config: Record<string, string>
): Promise<ProviderValidationResult> {
  if (provider === "posthog") {
    const posthogConfig: PostHogConfig = {
      apiKey: config.apiKey ?? "",
      projectId: config.projectId ?? "",
      host: config.host ?? "",
    };
    return runtime.posthogValidator.validate(posthogConfig);
  }

  if (provider === "stripe") {
    const stripeConfig: StripeConfig = {
      secretKey: config.secretKey ?? "",
    };
    return runtime.stripeValidator.validate(stripeConfig);
  }

  if (provider === "postgres") {
    const pgInput: PostgresSetupInput = {
      connectionUri: config.connectionUri ?? "",
      schema: config.schema ?? "",
      view: config.view ?? "",
      label: config.label ?? "",
      unit: config.unit ?? "",
    };
    return runtime.postgresValidator.validate(pgInput);
  }

  return { valid: false, error: `Unsupported provider: ${provider}` };
}

/**
 * Verify that a startup belongs to the given workspace.
 * Returns the startup row or null.
 */
async function verifyStartupOwnership(
  db: ConnectorRuntime["db"]["db"],
  startupId: string,
  workspaceId: string
) {
  const startupTable = await import("../db/schema/startup").then(
    (m) => m.startup
  );
  const rows = await db
    .select({ id: startupTable.id })
    .from(startupTable)
    .where(
      and(
        eq(startupTable.id, startupId),
        eq(startupTable.workspaceId, workspaceId)
      )
    );
  return rows[0] ?? null;
}

// ------------------------------------------------------------------
// Route handlers (pure functions that receive runtime + context)
// ------------------------------------------------------------------

export async function handleListConnectors(
  runtime: ConnectorRuntime,
  wsCtx: WorkspaceContext,
  startupId: string | undefined,
  set: { status?: number | string }
) {
  if (!startupId) {
    set.status = 400;
    return {
      error: {
        code: "STARTUP_ID_REQUIRED",
        message: "startupId query parameter is required.",
      },
    };
  }

  const startup = await verifyStartupOwnership(
    runtime.db.db,
    startupId,
    wsCtx.workspace.id
  );
  if (!startup) {
    set.status = 403;
    return {
      error: {
        code: "STARTUP_SCOPE_INVALID",
        message: "The startup does not belong to the active workspace.",
      },
    };
  }

  const rows = await runtime.db.db
    .select()
    .from(connector)
    .where(eq(connector.startupId, startupId))
    .orderBy(asc(connector.createdAt));

  // Also fetch any custom metric definitions for this startup
  const metricRows = await runtime.db.db
    .select()
    .from(customMetric)
    .where(eq(customMetric.startupId, startupId));

  return {
    connectors: rows.map(serializeConnector),
    customMetrics: metricRows.map(serializeCustomMetric),
  };
}

export async function handleCreateConnector(
  runtime: ConnectorRuntime,
  wsCtx: WorkspaceContext,
  body: ConnectorCreateBody,
  set: { status?: number | string }
) {
  const { startupId, provider: rawProvider, config } = body;

  // Validate inputs
  if (!startupId) {
    set.status = 400;
    return {
      error: { code: "STARTUP_ID_REQUIRED", message: "startupId is required." },
    };
  }

  if (!isConnectorProvider(rawProvider)) {
    set.status = 400;
    return {
      error: {
        code: "UNSUPPORTED_PROVIDER",
        message: `Provider must be one of: posthog, stripe, postgres. Received: ${rawProvider}`,
      },
    };
  }

  const provider: ConnectorProvider = rawProvider;

  // Verify startup belongs to workspace
  const startup = await verifyStartupOwnership(
    runtime.db.db,
    startupId,
    wsCtx.workspace.id
  );
  if (!startup) {
    set.status = 403;
    return {
      error: {
        code: "STARTUP_SCOPE_INVALID",
        message: "The startup does not belong to the active workspace.",
      },
    };
  }

  // Validate provider credentials
  const validation = await validateProviderConfig(
    runtime,
    provider,
    config ?? {}
  );
  if (!validation.valid) {
    set.status = 422;
    console.warn("[connector] provider validation failed", {
      provider,
      startupId,
      error: validation.error,
      retryable: validation.retryable,
    });
    return {
      error: {
        code: "PROVIDER_VALIDATION_FAILED",
        message: validation.error ?? "Provider credential validation failed.",
        retryable: validation.retryable ?? false,
      },
    };
  }

  // Encrypt credentials
  const key = parseEncryptionKey(runtime.env.connectorEncryptionKey);
  const encrypted = encryptConnectorConfig(JSON.stringify(config), key);

  const connectorId = randomUUID();
  const syncJobId = randomUUID();

  try {
    // Insert connector
    const insertedRows = await runtime.db.db
      .insert(connector)
      .values({
        id: connectorId,
        startupId,
        provider,
        status: "pending",
        encryptedConfig: encrypted.ciphertext,
        encryptionIv: encrypted.iv,
        encryptionAuthTag: encrypted.authTag,
      })
      .returning();

    const inserted = insertedRows[0];
    if (!inserted) {
      set.status = 502;
      return {
        error: {
          code: "CONNECTOR_CREATE_MALFORMED",
          message: "Connector creation returned an unexpected payload.",
        },
      };
    }

    // For postgres provider: create a startup-scoped custom metric definition row
    let customMetricSummary: CustomMetricSummary | undefined;
    if (provider === "postgres") {
      const customMetricId = randomUUID();
      const metricRows = await runtime.db.db
        .insert(customMetric)
        .values({
          id: customMetricId,
          startupId,
          connectorId,
          label: config.label ?? "",
          unit: config.unit ?? "",
          schema: config.schema ?? "",
          view: config.view ?? "",
          status: "pending",
        })
        .returning();

      const metricRow = metricRows[0];
      if (metricRow) {
        customMetricSummary = serializeCustomMetric(metricRow);
      }

      console.info("[connector] custom metric created", {
        connectorId,
        customMetricId,
        startupId,
        label: config.label,
        schema: config.schema,
        view: config.view,
      });
    }

    // Create initial sync job row
    await runtime.db.db.insert(syncJob).values({
      id: syncJobId,
      connectorId,
      status: "queued",
      trigger: "initial" as SyncTrigger,
      attempt: 1,
    });

    // Enqueue sync job (reference IDs only)
    const enqueueResult = await runtime.queueProducer.enqueue({
      connectorId,
      startupId,
      provider,
      trigger: "initial",
      syncJobId,
    });

    if (!enqueueResult.success) {
      console.error("[connector] initial sync enqueue failed", {
        connectorId,
        provider,
        syncJobId,
        error: enqueueResult.error,
      });
      // Mark sync job as failed but keep connector — it's still valid
      await runtime.db.db
        .update(syncJob)
        .set({
          status: "failed",
          error: enqueueResult.error ?? "Queue enqueue failed",
        })
        .where(eq(syncJob.id, syncJobId));
    }

    console.info("[connector] created", {
      connectorId,
      provider,
      startupId,
      syncJobId,
      enqueued: enqueueResult.success,
    });

    set.status = 201;
    const response: Record<string, unknown> = {
      connector: serializeConnector(inserted),
      syncJob: {
        id: syncJobId,
        status: enqueueResult.success ? "queued" : "failed",
        trigger: "initial",
      },
    };

    if (customMetricSummary) {
      response.customMetric = customMetricSummary;
    }

    return response;
  } catch (error) {
    const pgCode = getPgErrorCode(error);

    if (pgCode === "23505") {
      set.status = 409;
      console.warn("[connector] duplicate provider prevented", {
        provider,
        startupId,
      });
      return {
        error: {
          code: "CONNECTOR_ALREADY_EXISTS",
          message: `A ${provider} connector already exists for this startup.`,
        },
      };
    }

    set.status = 500;
    console.error("[connector] create failed", {
      provider,
      startupId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      error: {
        code: "CONNECTOR_CREATE_FAILED",
        message: "Connector creation failed. Please retry.",
      },
    };
  }
}

export async function handleDeleteConnector(
  runtime: ConnectorRuntime,
  wsCtx: WorkspaceContext,
  connectorId: string,
  set: { status?: number | string }
) {
  // Find the connector and verify it belongs to a startup in this workspace
  const rows = await runtime.db.db
    .select()
    .from(connector)
    .where(eq(connector.id, connectorId));

  const existing = rows[0];
  if (!existing) {
    set.status = 404;
    return {
      error: {
        code: "CONNECTOR_NOT_FOUND",
        message: "Connector not found.",
      },
    };
  }

  const startup = await verifyStartupOwnership(
    runtime.db.db,
    existing.startupId,
    wsCtx.workspace.id
  );
  if (!startup) {
    set.status = 403;
    return {
      error: {
        code: "STARTUP_SCOPE_INVALID",
        message:
          "The connector does not belong to a startup in the active workspace.",
      },
    };
  }

  // Update status to disconnected (cascade will handle sync_jobs on actual delete)
  await runtime.db.db
    .update(connector)
    .set({ status: "disconnected" })
    .where(eq(connector.id, connectorId));

  console.info("[connector] disconnected", {
    connectorId,
    provider: existing.provider,
    startupId: existing.startupId,
  });

  return { deleted: true, connectorId };
}

export async function handleTriggerSync(
  runtime: ConnectorRuntime,
  wsCtx: WorkspaceContext,
  connectorId: string,
  set: { status?: number | string }
) {
  // Find the connector
  const rows = await runtime.db.db
    .select()
    .from(connector)
    .where(eq(connector.id, connectorId));

  const existing = rows[0];
  if (!existing) {
    set.status = 404;
    return {
      error: { code: "CONNECTOR_NOT_FOUND", message: "Connector not found." },
    };
  }

  const startup = await verifyStartupOwnership(
    runtime.db.db,
    existing.startupId,
    wsCtx.workspace.id
  );
  if (!startup) {
    set.status = 403;
    return {
      error: {
        code: "STARTUP_SCOPE_INVALID",
        message:
          "The connector does not belong to a startup in the active workspace.",
      },
    };
  }

  if (existing.status === "disconnected") {
    set.status = 409;
    return {
      error: {
        code: "CONNECTOR_DISCONNECTED",
        message: "Cannot sync a disconnected connector. Reconnect it first.",
      },
    };
  }

  // Check if there's already a running job
  const runningJobs = await runtime.db.db
    .select({ id: syncJob.id })
    .from(syncJob)
    .where(
      and(eq(syncJob.connectorId, connectorId), eq(syncJob.status, "running"))
    );

  if (runningJobs.length > 0) {
    set.status = 409;
    return {
      error: {
        code: "SYNC_ALREADY_RUNNING",
        message:
          "A sync is already running for this connector. Wait for it to complete.",
      },
    };
  }

  const syncJobId = randomUUID();

  // Create sync job row
  await runtime.db.db.insert(syncJob).values({
    id: syncJobId,
    connectorId,
    status: "queued",
    trigger: "manual" as SyncTrigger,
    attempt: 1,
  });

  // Enqueue
  const enqueueResult = await runtime.queueProducer.enqueue({
    connectorId,
    startupId: existing.startupId,
    provider: existing.provider as ConnectorProvider,
    trigger: "manual",
    syncJobId,
  });

  if (!enqueueResult.success) {
    console.error("[connector] manual sync enqueue failed", {
      connectorId,
      syncJobId,
      error: enqueueResult.error,
    });
    await runtime.db.db
      .update(syncJob)
      .set({
        status: "failed",
        error: enqueueResult.error ?? "Queue enqueue failed",
      })
      .where(eq(syncJob.id, syncJobId));

    set.status = 502;
    return {
      error: {
        code: "SYNC_ENQUEUE_FAILED",
        message:
          "Failed to enqueue sync job. The connector status has not changed.",
        retryable: true,
      },
    };
  }

  console.info("[connector] manual sync triggered", {
    connectorId,
    syncJobId,
    provider: existing.provider,
  });

  return {
    syncJob: {
      id: syncJobId,
      connectorId,
      status: "queued",
      trigger: "manual",
    },
  };
}

export async function handleGetConnectorStatus(
  runtime: ConnectorRuntime,
  wsCtx: WorkspaceContext,
  connectorId: string,
  set: { status?: number | string }
) {
  const rows = await runtime.db.db
    .select()
    .from(connector)
    .where(eq(connector.id, connectorId));

  const existing = rows[0];
  if (!existing) {
    set.status = 404;
    return {
      error: { code: "CONNECTOR_NOT_FOUND", message: "Connector not found." },
    };
  }

  const startup = await verifyStartupOwnership(
    runtime.db.db,
    existing.startupId,
    wsCtx.workspace.id
  );
  if (!startup) {
    set.status = 403;
    return {
      error: {
        code: "STARTUP_SCOPE_INVALID",
        message:
          "The connector does not belong to a startup in the active workspace.",
      },
    };
  }

  // Fetch recent sync jobs
  const jobs = await runtime.db.db
    .select()
    .from(syncJob)
    .where(eq(syncJob.connectorId, connectorId))
    .orderBy(desc(syncJob.createdAt))
    .limit(10);

  return {
    connector: serializeConnector(existing),
    syncHistory: jobs.map(serializeSyncJob),
  };
}

export type { ConnectorCreateBody, ConnectorRuntime, WorkspaceContext };
