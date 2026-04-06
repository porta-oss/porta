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

/** Telegram digest/alert delivery queue. */
export const TELEGRAM_QUEUE = "telegram" as const;

/** Webhook event delivery queue. */
export const WEBHOOK_QUEUE = "webhook" as const;

/** Portfolio-level weekly digest generation queue. */
export const PORTFOLIO_DIGEST_QUEUE = "portfolio-digest" as const;

/** Periodic event_log purge queue. */
export const EVENT_PURGE_QUEUE = "event-purge" as const;

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

// ---------------------------------------------------------------------------
// Telegram queue — digest & alert delivery
// ---------------------------------------------------------------------------

export interface TelegramDigestPayload {
  type: "digest";
}

export interface TelegramAlertPayload {
  alertId: string;
  dashboardUrl: string;
  eventId: string;
  metricKey: string;
  occurrenceCount: number;
  severity: string;
  startupId: string;
  startupName: string;
  threshold: string;
  type: "alert";
  value: string;
  workspaceId: string;
}

export type TelegramJobPayload = TelegramDigestPayload | TelegramAlertPayload;

export function createTelegramQueue(
  redisUrl: string
): Queue<TelegramJobPayload> {
  const connection = parseRedisConnection(redisUrl);
  return new Queue<TelegramJobPayload>(TELEGRAM_QUEUE, {
    connection,
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
    },
  });
}

export function createTelegramWorker(
  redisUrl: string,
  processor: (job: import("bullmq").Job<TelegramJobPayload>) => Promise<void>
): Worker<TelegramJobPayload> {
  const connection = parseRedisConnection(redisUrl);
  return new Worker<TelegramJobPayload>(TELEGRAM_QUEUE, processor, {
    connection,
    concurrency: 1,
    lockDuration: 60_000,
    autorun: true,
  });
}

// ---------------------------------------------------------------------------
// Webhook queue — event delivery with exponential backoff
// ---------------------------------------------------------------------------

export interface WebhookJobPayload {
  deliveryId: string;
  eventType: string;
  payload: Record<string, unknown>;
  startupId: string;
  webhookConfigId: string;
}

/** Webhook retry: 4 attempts with escalating backoff (60s, 300s, 900s, 3600s). */
const WEBHOOK_JOB_OPTIONS = {
  attempts: 4,
  backoff: {
    type: "exponential" as const,
    delay: 60_000,
  },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
} as const;

export function createWebhookQueue(redisUrl: string): Queue<WebhookJobPayload> {
  const connection = parseRedisConnection(redisUrl);
  return new Queue<WebhookJobPayload>(WEBHOOK_QUEUE, {
    connection,
    defaultJobOptions: WEBHOOK_JOB_OPTIONS,
  });
}

export function createWebhookWorker(
  redisUrl: string,
  processor: (job: import("bullmq").Job<WebhookJobPayload>) => Promise<void>
): Worker<WebhookJobPayload> {
  const connection = parseRedisConnection(redisUrl);
  return new Worker<WebhookJobPayload>(WEBHOOK_QUEUE, processor, {
    connection,
    concurrency: 5,
    lockDuration: 60_000,
    autorun: true,
  });
}

// ---------------------------------------------------------------------------
// Portfolio digest queue — weekly summary generation
// ---------------------------------------------------------------------------

export interface PortfolioDigestJobPayload {
  workspaceId: string;
}

export function createPortfolioDigestQueue(
  redisUrl: string
): Queue<PortfolioDigestJobPayload> {
  const connection = parseRedisConnection(redisUrl);
  return new Queue<PortfolioDigestJobPayload>(PORTFOLIO_DIGEST_QUEUE, {
    connection,
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
    },
  });
}

export function createPortfolioDigestWorker(
  redisUrl: string,
  processor: (
    job: import("bullmq").Job<PortfolioDigestJobPayload>
  ) => Promise<void>
): Worker<PortfolioDigestJobPayload> {
  const connection = parseRedisConnection(redisUrl);
  return new Worker<PortfolioDigestJobPayload>(
    PORTFOLIO_DIGEST_QUEUE,
    processor,
    {
      connection,
      concurrency: 1,
      lockDuration: 120_000,
      autorun: true,
    }
  );
}

// ---------------------------------------------------------------------------
// Event purge queue — daily cleanup of old event_log rows
// ---------------------------------------------------------------------------

export interface EventPurgeJobPayload {
  retentionDays?: number;
}

export function createEventPurgeQueue(
  redisUrl: string
): Queue<EventPurgeJobPayload> {
  const connection = parseRedisConnection(redisUrl);
  return new Queue<EventPurgeJobPayload>(EVENT_PURGE_QUEUE, {
    connection,
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
    },
  });
}

export function createEventPurgeWorker(
  redisUrl: string,
  processor: (job: import("bullmq").Job<EventPurgeJobPayload>) => Promise<void>
): Worker<EventPurgeJobPayload> {
  const connection = parseRedisConnection(redisUrl);
  return new Worker<EventPurgeJobPayload>(EVENT_PURGE_QUEUE, processor, {
    connection,
    concurrency: 1,
    lockDuration: 120_000,
    autorun: true,
  });
}
