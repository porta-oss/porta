// Queue producer that enqueues reference-only task-sync jobs via BullMQ.
// The queue name and default job options must match the worker consumer
// in apps/worker/src/queues.ts so that jobs flow end-to-end.
//
// Follows the same pattern as apps/api/src/lib/connectors/queue.ts.

import { Queue } from 'bullmq';

/** Canonical queue name — must match apps/worker/src/queues.ts. */
export const TASK_SYNC_QUEUE = 'task-sync' as const;

/** Reference-only payload — never contains secrets or raw issue content. */
export interface TaskSyncJobPayload {
  /** Internal task row ID — the only data the worker needs to load the rest. */
  taskId: string;
}

/** Default retry policy: 3 attempts with exponential backoff (2s, 8s, 18s). */
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000,
  },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
} as const;

export interface TaskSyncEnqueueRequest {
  taskId: string;
}

export interface TaskSyncEnqueueResult {
  success: boolean;
  jobId?: string;
  error?: string;
}

export interface TaskSyncQueueProducer {
  enqueue(request: TaskSyncEnqueueRequest): Promise<TaskSyncEnqueueResult>;
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
 * Sends reference-only payloads (task ID only) with retry/backoff.
 */
export function createTaskSyncQueueProducer(redisUrl: string): TaskSyncQueueProducer {
  const connection = parseRedisConnection(redisUrl);
  const queue = new Queue<TaskSyncJobPayload>(TASK_SYNC_QUEUE, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  return {
    async enqueue(request: TaskSyncEnqueueRequest): Promise<TaskSyncEnqueueResult> {
      if (!request.taskId) {
        return {
          success: false,
          error: 'Task sync enqueue failed: missing taskId.',
        };
      }

      const payload: TaskSyncJobPayload = {
        taskId: request.taskId,
      };

      try {
        const job = await queue.add('task-sync', payload, {
          jobId: `task-sync-${request.taskId}`,
        });

        console.info('[task-queue] task sync job enqueued', {
          taskId: request.taskId,
          bullmqJobId: job.id,
        });

        return {
          success: true,
          jobId: job.id,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[task-queue] task sync enqueue failed', {
          taskId: request.taskId,
          error: message,
        });
        return {
          success: false,
          error: `Task sync enqueue failed: ${message}`,
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
export function createStubTaskSyncQueueProducer(
  result: TaskSyncEnqueueResult = { success: true, jobId: 'stub-task-sync-job' },
): TaskSyncQueueProducer & { calls: TaskSyncEnqueueRequest[] } {
  const calls: TaskSyncEnqueueRequest[] = [];
  return {
    calls,
    async enqueue(request: TaskSyncEnqueueRequest): Promise<TaskSyncEnqueueResult> {
      calls.push(request);

      if (!request.taskId) {
        return {
          success: false,
          error: 'Task sync enqueue failed: missing taskId.',
        };
      }

      return { ...result, jobId: result.jobId ?? `task-sync-${request.taskId}` };
    },
  };
}

/**
 * Failing queue producer stub for error-path tests.
 */
export function createFailingTaskSyncQueueProducer(
  error = 'Task sync queue connection refused',
): TaskSyncQueueProducer & { calls: TaskSyncEnqueueRequest[] } {
  const calls: TaskSyncEnqueueRequest[] = [];
  return {
    calls,
    async enqueue(request: TaskSyncEnqueueRequest): Promise<TaskSyncEnqueueResult> {
      calls.push(request);
      return { success: false, error };
    },
  };
}
