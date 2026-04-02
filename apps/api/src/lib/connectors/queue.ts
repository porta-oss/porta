// Queue producer that enqueues reference-only sync jobs via BullMQ.
// The queue name and default job options match the worker consumer in
// apps/worker/src/queues.ts so that jobs flow end-to-end.

import { Queue } from 'bullmq';
import type { ConnectorProvider, SyncTrigger, SyncJobPayload } from '@shared/connectors';

/** Canonical queue name — must match apps/worker/src/queues.ts. */
const CONNECTOR_SYNC_QUEUE = 'connector-sync';

/** Default retry policy — mirrored from the worker for consistency. */
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 1000,
  },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
} as const;

export interface SyncEnqueueRequest {
  connectorId: string;
  startupId: string;
  provider: ConnectorProvider;
  trigger: SyncTrigger;
  syncJobId: string;
}

export interface SyncEnqueueResult {
  success: boolean;
  jobId?: string;
  error?: string;
}

export interface SyncQueueProducer {
  enqueue(request: SyncEnqueueRequest): Promise<SyncEnqueueResult>;
  /** Graceful shutdown — closes the underlying Redis connection. */
  close?(): Promise<void>;
}

/**
 * Parse a redis:// URL into BullMQ-compatible connection options.
 */
function parseRedisConnection(redisUrl: string) {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null as null,
  };
}

/**
 * Production queue producer backed by a real BullMQ Queue.
 * Sends reference-only payloads (connector ID, startup ID, sync job ID)
 * with the canonical job options for retry/backoff.
 */
export function createSyncQueueProducer(redisUrl: string): SyncQueueProducer {
  const connection = parseRedisConnection(redisUrl);
  const queue = new Queue<SyncJobPayload>(CONNECTOR_SYNC_QUEUE, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  return {
    async enqueue(request: SyncEnqueueRequest): Promise<SyncEnqueueResult> {
      // Validate payload shape before accepting
      if (!request.connectorId || !request.startupId || !request.syncJobId) {
        return {
          success: false,
          error: 'Queue enqueue failed: malformed payload — missing required reference IDs.',
        };
      }

      const payload: SyncJobPayload = {
        connectorId: request.connectorId,
        startupId: request.startupId,
        provider: request.provider,
        trigger: request.trigger,
        syncJobId: request.syncJobId,
      };

      try {
        const job = await queue.add('connector-sync', payload, {
          jobId: request.syncJobId,
        });

        console.info('[queue] sync job enqueued', {
          syncJobId: payload.syncJobId,
          connectorId: payload.connectorId,
          provider: payload.provider,
          trigger: payload.trigger,
          bullmqJobId: job.id,
        });

        return {
          success: true,
          jobId: job.id,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[queue] sync job enqueue failed', {
          syncJobId: payload.syncJobId,
          connectorId: payload.connectorId,
          error: message,
        });
        return {
          success: false,
          error: `Queue enqueue failed: ${message}`,
        };
      }
    },

    async close() {
      await queue.close();
    },
  };
}

/**
 * Stub queue producer for tests — records all enqueue attempts.
 */
export function createStubQueueProducer(
  result: SyncEnqueueResult = { success: true, jobId: 'stub-job-id' },
): SyncQueueProducer & { calls: SyncEnqueueRequest[] } {
  const calls: SyncEnqueueRequest[] = [];
  return {
    calls,
    async enqueue(request: SyncEnqueueRequest): Promise<SyncEnqueueResult> {
      calls.push(request);

      if (!request.connectorId || !request.startupId || !request.syncJobId) {
        return {
          success: false,
          error: 'Queue enqueue failed: malformed payload — missing required reference IDs.',
        };
      }

      return { ...result, jobId: result.jobId ?? request.syncJobId };
    },
  };
}

/**
 * Failing queue producer stub for error-path tests.
 */
export function createFailingQueueProducer(
  error = 'Queue connection refused',
): SyncQueueProducer & { calls: SyncEnqueueRequest[] } {
  const calls: SyncEnqueueRequest[] = [];
  return {
    calls,
    async enqueue(request: SyncEnqueueRequest): Promise<SyncEnqueueResult> {
      calls.push(request);
      return { success: false, error };
    },
  };
}
