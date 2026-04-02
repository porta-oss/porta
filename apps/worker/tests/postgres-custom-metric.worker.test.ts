// Postgres custom metric worker tests.
// Tests the sync processor's Postgres-specific custom metric flow
// with in-memory stubs. Verifies: successful sync writes custom metric data,
// failed sync preserves last-good data, malformed responses rejected,
// and boundary conditions handled.
// No Redis or external Postgres required.

import { describe, test, expect, beforeEach } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';

import { encryptConnectorConfig, parseEncryptionKey } from '@shared/crypto';
import type { SyncJobPayload, ConnectorProvider } from '@shared/connectors';
import { emptySupportingMetrics } from '@shared/startup-health';

import { createSyncProcessor } from '../src/processors/sync';
import type { SyncRepository, ConnectorRow, SyncProcessorDeps } from '../src/processors/sync';
import type { CustomMetricRepository, CustomMetricRow, UpdateCustomMetricSuccessInput, UpdateCustomMetricFailureInput } from '../src/repository';
import type { ProviderSyncResult, PostgresSyncResult } from '../src/providers';

// ---------- helpers ----------

const TEST_ENCRYPTION_KEY = randomBytes(32).toString('hex');
const keyBuffer = parseEncryptionKey(TEST_ENCRYPTION_KEY);

function makePostgresConnectorRow(overrides?: Partial<ConnectorRow>): ConnectorRow {
  const config = JSON.stringify({
    connectionUri: 'postgresql://user:pass@host:5432/db',
    schema: 'public',
    view: 'daily_revenue',
    label: 'Daily Revenue',
    unit: '$',
  });
  const blob = encryptConnectorConfig(config, keyBuffer);
  return {
    id: 'conn-pg-1',
    provider: 'postgres',
    encryptedConfig: blob.ciphertext,
    encryptionIv: blob.iv,
    encryptionAuthTag: blob.authTag,
    ...overrides,
  };
}

function makePayload(overrides?: Partial<SyncJobPayload>): SyncJobPayload {
  return {
    connectorId: 'conn-pg-1',
    startupId: 'startup-1',
    syncJobId: 'sjob-1',
    provider: 'postgres',
    trigger: 'initial',
    ...overrides,
  };
}

function makeFakeJob(payload: SyncJobPayload) {
  return {
    data: payload,
    id: `bull-${randomUUID()}`,
    attemptsMade: 0,
  } as unknown as import('bullmq').Job<SyncJobPayload>;
}

// ---------- stub factories ----------

function createStubSyncRepo(connector?: ConnectorRow): SyncRepository & {
  completedCalls: Array<{ syncJobId: string; connectorId: string }>;
  failedCalls: Array<{ syncJobId: string; connectorId: string; error: string }>;
} {
  const completedCalls: Array<{ syncJobId: string; connectorId: string }> = [];
  const failedCalls: Array<{ syncJobId: string; connectorId: string; error: string }> = [];
  return {
    completedCalls,
    failedCalls,
    findConnector: async (connectorId: string) => connector,
    markSyncJobRunning: async () => {},
    markSyncJobCompleted: async (syncJobId, connectorId) => {
      completedCalls.push({ syncJobId, connectorId });
    },
    markSyncJobFailed: async (syncJobId, connectorId, error) => {
      failedCalls.push({ syncJobId, connectorId, error });
    },
  };
}

function createStubCustomMetricRepo(): CustomMetricRepository & {
  successCalls: UpdateCustomMetricSuccessInput[];
  failureCalls: UpdateCustomMetricFailureInput[];
  row: CustomMetricRow | undefined;
} {
  const successCalls: UpdateCustomMetricSuccessInput[] = [];
  const failureCalls: UpdateCustomMetricFailureInput[] = [];
  let row: CustomMetricRow | undefined;

  return {
    successCalls,
    failureCalls,
    get row() { return row; },
    set row(r: CustomMetricRow | undefined) { row = r; },
    findByStartupId: async () => row,
    findByConnectorId: async () => row,
    updateOnSyncSuccess: async (input: UpdateCustomMetricSuccessInput) => {
      successCalls.push(input);
      if (row) {
        row = {
          ...row,
          status: 'active',
          metricValue: input.metricValue,
          previousValue: input.previousValue,
          capturedAt: input.capturedAt,
        };
      }
    },
    updateOnSyncFailure: async (input: UpdateCustomMetricFailureInput) => {
      failureCalls.push(input);
      if (row) {
        row = { ...row, status: 'error' };
      }
    },
  };
}

function createStubPostgresProvider(
  result: PostgresSyncResult,
): SyncProcessorDeps['validateProvider'] & { calls: Array<{ provider: ConnectorProvider; configJson: string }> } {
  const calls: Array<{ provider: ConnectorProvider; configJson: string }> = [];
  const fn = async (provider: ConnectorProvider, configJson: string) => {
    calls.push({ provider, configJson });
    return result;
  };
  fn.calls = calls;
  return fn;
}

function createThrowingPostgresProvider(
  error = 'Connection refused',
): SyncProcessorDeps['validateProvider'] {
  return async () => {
    throw new Error(error);
  };
}

function makeLog() {
  const entries: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> = [];
  return {
    entries,
    info: (msg: string, meta?: Record<string, unknown>) => { entries.push({ level: 'info', msg, meta }); },
    warn: (msg: string, meta?: Record<string, unknown>) => { entries.push({ level: 'warn', msg, meta }); },
    error: (msg: string, meta?: Record<string, unknown>) => { entries.push({ level: 'error', msg, meta }); },
  };
}

// ============================================================================
// 1. Successful Postgres sync
// ============================================================================

describe('postgres custom metric sync — success', () => {
  test('successful sync writes custom metric value', async () => {
    const connector = makePostgresConnectorRow();
    const repo = createStubSyncRepo(connector);
    const customMetricRepo = createStubCustomMetricRepo();
    const log = makeLog();

    const pgResult: PostgresSyncResult = {
      valid: true,
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
      customMetric: {
        metricValue: 42500.50,
        previousValue: 41200.00,
        capturedAt: '2026-04-01T12:00:00.000Z',
      },
    };

    const processor = createSyncProcessor({
      repo,
      encryptionKey: TEST_ENCRYPTION_KEY,
      validateProvider: createStubPostgresProvider(pgResult),
      log,
      customMetricRepo,
    });

    const job = makeFakeJob(makePayload());
    await processor(job);

    // Sync job marked completed
    expect(repo.completedCalls).toHaveLength(1);
    expect(repo.completedCalls[0]!.connectorId).toBe('conn-pg-1');

    // Custom metric updated
    expect(customMetricRepo.successCalls).toHaveLength(1);
    expect(customMetricRepo.successCalls[0]!.startupId).toBe('startup-1');
    expect(customMetricRepo.successCalls[0]!.metricValue).toBe(42500.50);
    expect(customMetricRepo.successCalls[0]!.previousValue).toBe(41200.00);
    expect(customMetricRepo.successCalls[0]!.capturedAt).toEqual(new Date('2026-04-01T12:00:00.000Z'));

    // Log includes custom metric sync info
    const syncLog = log.entries.find((e) => e.msg === 'custom metric synced');
    expect(syncLog).toBeDefined();
    expect(syncLog!.meta!.metricValue).toBe(42500.50);
  });

  test('first sync with null previous value', async () => {
    const connector = makePostgresConnectorRow();
    const repo = createStubSyncRepo(connector);
    const customMetricRepo = createStubCustomMetricRepo();
    const log = makeLog();

    const pgResult: PostgresSyncResult = {
      valid: true,
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
      customMetric: {
        metricValue: 1000,
        previousValue: null,
        capturedAt: '2026-04-01T08:00:00.000Z',
      },
    };

    const processor = createSyncProcessor({
      repo,
      encryptionKey: TEST_ENCRYPTION_KEY,
      validateProvider: createStubPostgresProvider(pgResult),
      log,
      customMetricRepo,
    });

    await processor(makeFakeJob(makePayload()));

    expect(customMetricRepo.successCalls).toHaveLength(1);
    expect(customMetricRepo.successCalls[0]!.metricValue).toBe(1000);
    expect(customMetricRepo.successCalls[0]!.previousValue).toBeNull();
  });
});

// ============================================================================
// 2. Failed Postgres sync — last-good preservation
// ============================================================================

describe('postgres custom metric sync — failure preserves last-good', () => {
  test('connection failure marks custom metric as error without wiping data', async () => {
    const connector = makePostgresConnectorRow();
    const repo = createStubSyncRepo(connector);
    const customMetricRepo = createStubCustomMetricRepo();
    const log = makeLog();

    const pgResult: PostgresSyncResult = {
      valid: false,
      error: 'Postgres connection failed: connection refused',
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
      customMetric: null,
    };

    const processor = createSyncProcessor({
      repo,
      encryptionKey: TEST_ENCRYPTION_KEY,
      validateProvider: createStubPostgresProvider(pgResult),
      log,
      customMetricRepo,
    });

    await processor(makeFakeJob(makePayload()));

    // Sync job marked failed
    expect(repo.failedCalls).toHaveLength(1);
    expect(repo.failedCalls[0]!.error).toContain('connection refused');

    // Custom metric marked error, but no success update (last-good preserved)
    expect(customMetricRepo.failureCalls).toHaveLength(1);
    expect(customMetricRepo.failureCalls[0]!.status).toBe('error');
    expect(customMetricRepo.successCalls).toHaveLength(0);
  });

  test('retryable timeout throws for BullMQ retry while preserving data', async () => {
    const connector = makePostgresConnectorRow();
    const repo = createStubSyncRepo(connector);
    const customMetricRepo = createStubCustomMetricRepo();
    const log = makeLog();

    const pgResult: PostgresSyncResult = {
      valid: false,
      error: 'Postgres query timed out',
      retryable: true,
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
      customMetric: null,
    };

    const processor = createSyncProcessor({
      repo,
      encryptionKey: TEST_ENCRYPTION_KEY,
      validateProvider: createStubPostgresProvider(pgResult),
      log,
      customMetricRepo,
    });

    // Should throw for BullMQ retry
    await expect(processor(makeFakeJob(makePayload()))).rejects.toThrow('Postgres query timed out');

    // Custom metric still marked error
    expect(customMetricRepo.failureCalls).toHaveLength(1);
  });

  test('provider adapter throws — sync fails, custom metric preserved', async () => {
    const connector = makePostgresConnectorRow();
    const repo = createStubSyncRepo(connector);
    const customMetricRepo = createStubCustomMetricRepo();
    const log = makeLog();

    const processor = createSyncProcessor({
      repo,
      encryptionKey: TEST_ENCRYPTION_KEY,
      validateProvider: createThrowingPostgresProvider('ECONNREFUSED'),
      log,
      customMetricRepo,
    });

    await expect(processor(makeFakeJob(makePayload()))).rejects.toThrow('ECONNREFUSED');

    // Sync job failed, but custom metric was never touched (no update calls)
    expect(repo.failedCalls).toHaveLength(1);
    expect(customMetricRepo.successCalls).toHaveLength(0);
    expect(customMetricRepo.failureCalls).toHaveLength(0);
  });
});

// ============================================================================
// 3. Malformed responses
// ============================================================================

describe('postgres custom metric sync — malformed response handling', () => {
  test('non-numeric metric_value is rejected', async () => {
    const connector = makePostgresConnectorRow();
    const repo = createStubSyncRepo(connector);
    const customMetricRepo = createStubCustomMetricRepo();
    const log = makeLog();

    const pgResult: PostgresSyncResult = {
      valid: false,
      error: 'metric_value from public.daily_revenue is not a finite number: abc',
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
      customMetric: null,
    };

    const processor = createSyncProcessor({
      repo,
      encryptionKey: TEST_ENCRYPTION_KEY,
      validateProvider: createStubPostgresProvider(pgResult),
      log,
      customMetricRepo,
    });

    await processor(makeFakeJob(makePayload()));

    // Failed, not zeroed
    expect(repo.failedCalls).toHaveLength(1);
    expect(customMetricRepo.successCalls).toHaveLength(0);
  });

  test('empty result set is rejected', async () => {
    const connector = makePostgresConnectorRow();
    const repo = createStubSyncRepo(connector);
    const customMetricRepo = createStubCustomMetricRepo();
    const log = makeLog();

    const pgResult: PostgresSyncResult = {
      valid: false,
      error: 'Prepared view public.daily_revenue returned no rows.',
      retryable: true,
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
      customMetric: null,
    };

    const processor = createSyncProcessor({
      repo,
      encryptionKey: TEST_ENCRYPTION_KEY,
      validateProvider: createStubPostgresProvider(pgResult),
      log,
      customMetricRepo,
    });

    await expect(processor(makeFakeJob(makePayload()))).rejects.toThrow('returned no rows');
  });
});

// ============================================================================
// 4. Boundary conditions
// ============================================================================

describe('postgres custom metric sync — boundary conditions', () => {
  test('custom metric update failure does not fail the sync job', async () => {
    const connector = makePostgresConnectorRow();
    const repo = createStubSyncRepo(connector);
    const log = makeLog();

    // Create a broken custom metric repo that throws on success update
    const brokenCustomMetricRepo: CustomMetricRepository = {
      findByStartupId: async () => undefined,
      findByConnectorId: async () => undefined,
      updateOnSyncSuccess: async () => { throw new Error('DB write failed'); },
      updateOnSyncFailure: async () => {},
    };

    const pgResult: PostgresSyncResult = {
      valid: true,
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
      customMetric: {
        metricValue: 5000,
        previousValue: null,
        capturedAt: '2026-04-01T12:00:00.000Z',
      },
    };

    const processor = createSyncProcessor({
      repo,
      encryptionKey: TEST_ENCRYPTION_KEY,
      validateProvider: createStubPostgresProvider(pgResult),
      log,
      customMetricRepo: brokenCustomMetricRepo,
    });

    // Should NOT throw — sync job succeeds even if custom metric write fails
    await processor(makeFakeJob(makePayload()));

    expect(repo.completedCalls).toHaveLength(1);
    const errorLog = log.entries.find((e) => e.msg === 'custom metric update failed — previous data preserved');
    expect(errorLog).toBeDefined();
  });

  test('without customMetricRepo, postgres sync still completes', async () => {
    const connector = makePostgresConnectorRow();
    const repo = createStubSyncRepo(connector);
    const log = makeLog();

    const pgResult: PostgresSyncResult = {
      valid: true,
      mrr: null,
      supportingMetrics: null,
      funnelStages: null,
      customMetric: {
        metricValue: 5000,
        previousValue: null,
        capturedAt: '2026-04-01T12:00:00.000Z',
      },
    };

    const processor = createSyncProcessor({
      repo,
      encryptionKey: TEST_ENCRYPTION_KEY,
      validateProvider: createStubPostgresProvider(pgResult),
      log,
      // No customMetricRepo provided
    });

    await processor(makeFakeJob(makePayload()));
    expect(repo.completedCalls).toHaveLength(1);
  });

  test('connector not found results in sync failure', async () => {
    const repo = createStubSyncRepo(undefined); // No connector found
    const customMetricRepo = createStubCustomMetricRepo();
    const log = makeLog();

    const processor = createSyncProcessor({
      repo,
      encryptionKey: TEST_ENCRYPTION_KEY,
      validateProvider: createStubPostgresProvider({ valid: true, mrr: null, supportingMetrics: null, funnelStages: null, customMetric: null }),
      log,
      customMetricRepo,
    });

    await expect(processor(makeFakeJob(makePayload()))).rejects.toThrow('not found');
    expect(repo.failedCalls).toHaveLength(1);
  });
});
