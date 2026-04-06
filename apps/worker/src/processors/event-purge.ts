// Event purge processor.
// Deletes event_log rows older than 90 days (configurable via retentionDays).
// Workspaces with an active legal hold (legal_hold_until > now()) get PII
// redacted in the payload instead of full row deletion.

import type { Job } from "bullmq";
import { sql } from "drizzle-orm";
import type { EventPurgeJobPayload } from "../queues";

const DEFAULT_RETENTION_DAYS = 90;

/** Drizzle-compatible db handle. */
interface DrizzleHandle {
  execute: (query: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }>;
}

export interface EventPurgeProcessorDeps {
  db: DrizzleHandle;
  log: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

/**
 * Create a BullMQ-compatible processor function for event-purge jobs.
 *
 * Lifecycle per job:
 *   1. Identify workspaces under legal hold
 *   2. Redact PII in old events for legal-hold workspaces
 *   3. Delete old events for all other workspaces
 *   4. Log results
 */
export function createEventPurgeProcessor(deps: EventPurgeProcessorDeps) {
  return async function processEventPurgeJob(
    job: Job<EventPurgeJobPayload>
  ): Promise<void> {
    const retentionDays = job.data.retentionDays ?? DEFAULT_RETENTION_DAYS;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const logCtx = {
      retentionDays,
      cutoffDate: cutoffDate.toISOString(),
      bullmqJobId: job.id,
    };

    deps.log.info("event purge started", logCtx);

    // Step 1: Redact PII in payloads for workspaces with active legal holds.
    // Replace all string values in the JSONB payload with '[REDACTED]'.
    const redactResult = await deps.db.execute(
      sql`UPDATE event_log
          SET payload = (
            SELECT jsonb_object_agg(
              key,
              CASE
                WHEN jsonb_typeof(value) = 'string' THEN '"[REDACTED]"'::jsonb
                ELSE value
              END
            )
            FROM jsonb_each(event_log.payload)
          )
          WHERE created_at < ${cutoffDate}
            AND workspace_id IN (
              SELECT id FROM workspace
              WHERE legal_hold_until IS NOT NULL
                AND legal_hold_until > NOW()
            )`
    );

    const redactedCount =
      (redactResult as unknown as { rowCount?: number }).rowCount ?? 0;

    // Step 2: Delete old events for workspaces NOT under legal hold.
    const deleteResult = await deps.db.execute(
      sql`DELETE FROM event_log
          WHERE created_at < ${cutoffDate}
            AND workspace_id NOT IN (
              SELECT id FROM workspace
              WHERE legal_hold_until IS NOT NULL
                AND legal_hold_until > NOW()
            )`
    );

    const deletedCount =
      (deleteResult as unknown as { rowCount?: number }).rowCount ?? 0;

    deps.log.info("event purge completed", {
      ...logCtx,
      deletedCount,
      redactedCount,
    });
  };
}
