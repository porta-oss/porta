// BullMQ queue and connection definitions for the connector-sync worker.
// Queue name and job payload shape must match the producer in apps/api/src/lib/connectors/queue.ts.

import type { SyncJobPayload } from "@shared/connectors";
import type { ConnectionOptions, WorkerOptions } from "bullmq";
import { Queue, Worker } from "bullmq";
import type { TaskSyncJobPayload } from "./processors/task-sync";

/** Canonical queue name — must match across producer and consumer. */
export const CONNECTOR_SYNC_QUEUE = "connector-sync" as const;

/** Task sync queue name — must match apps/api/src/lib/tasks/queue.ts. */
export const TASK_SYNC_QUEUE = "task-sync" as const;

/** Default retry policy: 3 attempts with exponential backoff (1s, 4s, 9s). */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: "exponential" as const,
    delay: 1000,
  },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
} as const;

/**
 * Parse a redis:// URL into BullMQ-compatible connection options.
 */
export function parseRedisConnection(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    password: parsed.password || undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

/**
 * Create a BullMQ Queue instance for producing connector-sync jobs.
 */
export function createSyncQueue(redisUrl: string): Queue<SyncJobPayload> {
  const connection = parseRedisConnection(redisUrl);
  return new Queue<SyncJobPayload>(CONNECTOR_SYNC_QUEUE, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

/**
 * Create a BullMQ Worker instance for consuming connector-sync jobs.
 */
export function createSyncWorker(
  redisUrl: string,
  processor: (job: import("bullmq").Job<SyncJobPayload>) => Promise<void>,
  options?: Partial<Pick<WorkerOptions, "concurrency" | "lockDuration">>
): Worker<SyncJobPayload> {
  const connection = parseRedisConnection(redisUrl);
  return new Worker<SyncJobPayload>(CONNECTOR_SYNC_QUEUE, processor, {
    connection,
    concurrency: options?.concurrency ?? 3,
    lockDuration: options?.lockDuration ?? 60_000,
    autorun: true,
  });
}

/**
 * Create a BullMQ Worker instance for consuming task-sync jobs.
 */
export function createTaskSyncWorker(
  redisUrl: string,
  processor: (job: import("bullmq").Job<TaskSyncJobPayload>) => Promise<void>,
  options?: Partial<Pick<WorkerOptions, "concurrency" | "lockDuration">>
): Worker<TaskSyncJobPayload> {
  const connection = parseRedisConnection(redisUrl);
  return new Worker<TaskSyncJobPayload>(TASK_SYNC_QUEUE, processor, {
    connection,
    concurrency: options?.concurrency ?? 2,
    lockDuration: options?.lockDuration ?? 60_000,
    autorun: true,
  });
}
