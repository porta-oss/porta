// Webhook delivery processor.
// Loads webhook config, delivers payload via HTTP with HMAC signing and SSRF
// protection, tracks failures with circuit breaker logic.

import type { Job } from "bullmq";
import { sql } from "drizzle-orm";

import {
  type DeliveryOptions,
  deliverWebhook,
  recordDeliveryResult,
} from "../../../api/src/lib/webhooks/delivery";
import type { WebhookJobPayload } from "../queues";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Drizzle-compatible db handle. */
interface DrizzleHandle {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
}

/** Raw row from webhook_config table. */
interface WebhookConfigRow {
  enabled: boolean;
  id: string;
  secret: string;
  startup_id: string;
  url: string;
}

export interface WebhookDeliveryProcessorDeps {
  db: DrizzleHandle;
  /** Optional delivery options for dependency injection in tests. */
  deliveryOptions?: DeliveryOptions;
  log: {
    error: (msg: string, meta?: Record<string, unknown>) => void;
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
  /** Minimal pool interface for raw SQL queries (circuit breaker). */
  pool: {
    query: (sql: string) => Promise<unknown>;
  };
}

// ---------------------------------------------------------------------------
// Processor factory
// ---------------------------------------------------------------------------

export function createWebhookDeliveryProcessor(
  deps: WebhookDeliveryProcessorDeps
) {
  return async function processWebhookDeliveryJob(
    job: Job<WebhookJobPayload>
  ): Promise<void> {
    const { deliveryId, eventType, payload, startupId, webhookConfigId } =
      job.data;
    const attempt = job.attemptsMade + 1;

    const logCtx = {
      attempt,
      bullmqJobId: job.id,
      deliveryId,
      eventType,
      startupId,
      webhookConfigId,
    };

    deps.log.info("webhook delivery started", logCtx);

    // 1. Load webhook config
    const configResult = await deps.db.execute(
      sql`SELECT id, startup_id, url, secret, enabled
          FROM webhook_config
          WHERE id = ${webhookConfigId}
          LIMIT 1`
    );

    const configRow = configResult.rows[0] as WebhookConfigRow | undefined;

    if (!configRow) {
      deps.log.warn("webhook config not found, skipping delivery", logCtx);
      return;
    }

    if (!configRow.enabled) {
      deps.log.warn(
        "webhook disabled (circuit broken), skipping delivery",
        logCtx
      );
      return;
    }

    // 2. Deliver webhook
    const result = await deliverWebhook(
      { id: configRow.id, secret: configRow.secret, url: configRow.url },
      {
        deliveryId,
        event: eventType,
        payload,
        startupId,
        timestamp: new Date().toISOString(),
      },
      deps.deliveryOptions
    );

    // 3. Record result and check circuit breaker
    const circuitResult = await recordDeliveryResult(
      deps.pool,
      webhookConfigId,
      result.success
    );

    // 4. Log event to event_log
    const workspaceResult = await deps.db.execute(
      sql`SELECT workspace_id FROM startup WHERE id = ${startupId} LIMIT 1`
    );
    const workspaceRow = workspaceResult.rows[0] as
      | { workspace_id: string }
      | undefined;

    if (workspaceRow) {
      const eventPayload = JSON.stringify({
        deliveryId,
        error: result.error,
        httpStatus: result.httpStatus,
        success: result.success,
        webhookConfigId,
      });
      const logEventType = result.success
        ? "webhook.delivered"
        : "webhook.failed";

      deps.db
        .execute(
          sql`INSERT INTO event_log (id, workspace_id, startup_id, event_type, actor_type, actor_id, payload, created_at)
              VALUES (gen_random_uuid(), ${workspaceRow.workspace_id}, ${startupId}, ${logEventType}, 'system', NULL, ${eventPayload}::jsonb, NOW())`
        )
        .catch(() => {
          // Silent — event log failures must not block webhook delivery
        });
    }

    if (result.success) {
      deps.log.info("webhook delivered", {
        ...logCtx,
        httpStatus: result.httpStatus,
      });
      return;
    }

    // Log failure details
    deps.log.warn("webhook delivery failed", {
      ...logCtx,
      consecutiveFailures: circuitResult.consecutiveFailures,
      error: result.error,
      httpStatus: result.httpStatus,
    });

    if (circuitResult.circuitBroken) {
      deps.log.error("webhook circuit breaker tripped", {
        ...logCtx,
        consecutiveFailures: circuitResult.consecutiveFailures,
      });
      // Don't throw — circuit is broken, no point retrying
      return;
    }

    // Throw to trigger BullMQ retry
    throw new Error(
      `Webhook delivery failed: ${result.error ?? `HTTP ${result.httpStatus}`}`
    );
  };
}
