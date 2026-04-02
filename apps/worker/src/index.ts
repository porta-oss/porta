// Worker bootstrap entrypoint.
// Reads env, connects to Postgres and Redis, and starts the connector-sync BullMQ worker.

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { readWorkerEnv } from './env';
import { createSyncWorker, createTaskSyncWorker } from './queues';
import { createSyncProcessor } from './processors/sync';
import { createTaskSyncProcessor, createLinearIssueClient, createFounderProofLinearClient } from './processors/task-sync';
import { createSyncRepository, createHealthSnapshotRepository, createInsightRepository, createInternalTaskRepository } from './repository';
import { createProviderSyncRouter, createFounderProofSyncRouter } from './providers';
import { createAnthropicExplainer, createFounderProofExplainer } from './insights';

const { Pool } = pg;

const log = {
  info(msg: string, meta?: Record<string, unknown>) {
    console.info(`[worker] ${msg}`, meta ? JSON.stringify(meta) : '');
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    console.warn(`[worker] ${msg}`, meta ? JSON.stringify(meta) : '');
  },
  error(msg: string, meta?: Record<string, unknown>) {
    console.error(`[worker] ${msg}`, meta ? JSON.stringify(meta) : '');
  },
};

async function main() {
  log.info('starting worker process');

  const env = readWorkerEnv(process.env as Record<string, string | undefined>);

  // Postgres pool
  const pool = new Pool({
    connectionString: env.databaseUrl,
    max: env.databasePoolMax,
    connectionTimeoutMillis: env.databaseConnectTimeoutMs,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: false,
  });
  const db = drizzle(pool);

  // Repository + provider router
  const repo = createSyncRepository(db as any);
  const healthRepo = createHealthSnapshotRepository(db as any);
  const insightRepo = createInsightRepository(db as any);

  // Provider sync router — deterministic stubs in founder-proof mode
  const validateProvider = env.founderProofMode
    ? createFounderProofSyncRouter()
    : createProviderSyncRouter();

  if (env.founderProofMode) {
    log.info('founder-proof mode enabled — using deterministic provider sync router');
  }

  // Explainer — deterministic stub in founder-proof mode, Anthropic when key present
  const explainer = env.founderProofMode
    ? createFounderProofExplainer()
    : env.anthropicApiKey
      ? createAnthropicExplainer(env.anthropicApiKey)
      : undefined;

  if (env.founderProofMode) {
    log.info('insight generation enabled (founder-proof deterministic explainer)');
  } else if (explainer) {
    log.info('insight generation enabled (Anthropic explainer configured)');
  } else {
    log.info('insight generation disabled (ANTHROPIC_API_KEY not set)');
  }

  // Build processor
  const processor = createSyncProcessor({
    repo,
    encryptionKey: env.connectorEncryptionKey,
    validateProvider,
    log,
    healthRepo,
    insightRepo,
    explainer,
  });

  // Start BullMQ worker
  const worker = createSyncWorker(env.redisUrl, processor, {
    concurrency: env.workerConcurrency,
  });

  worker.on('ready', () => {
    log.info('worker ready', {
      queue: 'connector-sync',
      concurrency: env.workerConcurrency,
    });
  });

  worker.on('failed', (job: any, err: Error) => {
    log.error('job failed', {
      jobId: job?.id,
      syncJobId: job?.data?.syncJobId,
      connectorId: job?.data?.connectorId,
      attempt: job?.attemptsMade,
      error: err.message,
    });
  });

  worker.on('error', (err: Error) => {
    log.error('worker error', { error: err.message });
  });

  // ---------------------------------------------------------------------------
  // Task-sync worker (Linear delivery)
  // ---------------------------------------------------------------------------

  const taskRepo = createInternalTaskRepository(db as any);
  let taskSyncWorker: ReturnType<typeof createTaskSyncWorker> | undefined;

  // Task-sync: founder-proof mode uses deterministic stub, otherwise needs real Linear keys
  const shouldEnableTaskSync = env.founderProofMode || (env.linearApiKey && env.linearTeamId);

  if (shouldEnableTaskSync) {
    const createLinearIssue = env.founderProofMode
      ? createFounderProofLinearClient()
      : createLinearIssueClient(env.linearApiKey!);

    const taskSyncTeamId = env.founderProofMode
      ? 'founder-proof-team'
      : env.linearTeamId!;

    const taskSyncProcessor = createTaskSyncProcessor({
      taskRepo,
      createLinearIssue,
      linearTeamId: taskSyncTeamId,
      log,
    });

    taskSyncWorker = createTaskSyncWorker(env.redisUrl, taskSyncProcessor, {
      concurrency: 2,
    });

    taskSyncWorker.on('ready', () => {
      log.info('task-sync worker ready', { queue: 'task-sync', concurrency: 2 });
    });

    taskSyncWorker.on('failed', (job: any, err: Error) => {
      log.error('task-sync job failed', {
        jobId: job?.id,
        taskId: job?.data?.taskId,
        attempt: job?.attemptsMade,
        error: err.message,
      });
    });

    taskSyncWorker.on('error', (err: Error) => {
      log.error('task-sync worker error', { error: err.message });
    });

    if (env.founderProofMode) {
      log.info('task-sync delivery enabled (founder-proof deterministic Linear client)');
    } else {
      log.info('task-sync delivery enabled (Linear credentials configured)');
    }
  } else {
    log.info('task-sync delivery disabled (LINEAR_API_KEY or LINEAR_TEAM_ID not set)');
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info(`received ${signal}, shutting down`);
    await worker.close();
    if (taskSyncWorker) await taskSyncWorker.close();
    await pool.end();
    log.info('worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  log.info('worker bootstrap complete', { nodeEnv: env.nodeEnv, founderProofMode: env.founderProofMode });
}

main().catch((err: unknown) => {
  log.error('worker failed to start', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
