// Webhook dispatch integration tests.
// Verifies that the sync processor enqueues webhook delivery jobs
// when alerts fire and the startup has an enabled webhook config
// subscribed to the matching event type.

import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { SyncJobPayload } from "@shared/connectors";
import { encryptConnectorConfig, parseEncryptionKey } from "@shared/crypto";
import type {
  ConnectorRow,
  SyncProcessorDeps,
  WebhookDispatcher,
} from "../src/processors/sync";
import { createSyncProcessor } from "../src/processors/sync";
import { createStubSyncRouter } from "../src/providers";
import type { AlertEvaluationResult, AlertRepository } from "../src/repository";

// ---------- helpers ----------

const TEST_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const keyBuffer = parseEncryptionKey(TEST_ENCRYPTION_KEY);

function makeConnectorRow(overrides?: Partial<ConnectorRow>): ConnectorRow {
  const config = JSON.stringify({
    apiKey: "sk_test_123",
    host: "https://api.stripe.com",
  });
  const blob = encryptConnectorConfig(config, keyBuffer);
  return {
    id: "conn-1",
    provider: "stripe",
    encryptedConfig: blob.ciphertext,
    encryptionIv: blob.iv,
    encryptionAuthTag: blob.authTag,
    ...overrides,
  };
}

function makePayload(overrides?: Partial<SyncJobPayload>): SyncJobPayload {
  return {
    connectorId: "conn-1",
    startupId: "startup-1",
    provider: "stripe",
    trigger: "initial",
    syncJobId: "sjob-1",
    ...overrides,
  };
}

function makeJob(data: SyncJobPayload, attemptsMade = 0) {
  return {
    id: `bullmq-${data.syncJobId}`,
    data,
    attemptsMade,
    name: "connector-sync",
  } as any;
}

function createInMemoryRepo(connectorRow?: ConnectorRow | undefined) {
  const mutations: Array<{ op: string; args: unknown[] }> = [];
  return {
    mutations,
    async findConnector() {
      return connectorRow;
    },
    async markSyncJobRunning(
      syncJobId: string,
      startedAt: Date,
      attempt: number
    ) {
      mutations.push({
        op: "markSyncJobRunning",
        args: [syncJobId, startedAt, attempt],
      });
    },
    async markSyncJobCompleted(
      syncJobId: string,
      connectorId: string,
      completedAt: Date,
      durationMs: number
    ) {
      mutations.push({
        op: "markSyncJobCompleted",
        args: [syncJobId, connectorId, completedAt, durationMs],
      });
    },
    async markSyncJobFailed(
      syncJobId: string,
      connectorId: string,
      error: string,
      completedAt: Date,
      durationMs: number
    ) {
      mutations.push({
        op: "markSyncJobFailed",
        args: [syncJobId, connectorId, error, completedAt, durationMs],
      });
    },
  };
}

function silentLog() {
  return {
    info: () => {
      /* noop */
    },
    warn: () => {
      /* noop */
    },
    error: () => {
      /* noop */
    },
  };
}

/** Create a stub alert repo that returns the given alert results on evaluate. */
function createStubAlertRepo(
  alertResults: AlertEvaluationResult[] = []
): AlertRepository {
  return {
    async countActiveAlerts() {
      return alertResults.length;
    },
    async evaluateAlerts() {
      return alertResults;
    },
    async seedDefaultAlerts() {
      return 0;
    },
    async updateStreak() {
      /* noop */
    },
  };
}

/** Create a stub health repo that provides minimal snapshot data. */
function createStubHealthRepo() {
  return {
    async checkHealthTablesExist() {
      return { snapshotReady: true, funnelReady: true };
    },
    async findFunnelStages() {
      return [];
    },
    async findSnapshot() {
      return undefined;
    },
    async replaceSnapshot() {
      /* noop */
    },
    async recordHistory() {
      /* noop */
    },
  };
}

/** Create a stub webhook dispatcher that records enqueued jobs. */
function createStubWebhookDispatcher(
  config: { id: string; eventTypes: string[] } | null
): WebhookDispatcher & {
  enqueuedJobs: Array<{
    deliveryId: string;
    eventType: string;
    payload: Record<string, unknown>;
    startupId: string;
    webhookConfigId: string;
  }>;
} {
  const enqueuedJobs: Array<{
    deliveryId: string;
    eventType: string;
    payload: Record<string, unknown>;
    startupId: string;
    webhookConfigId: string;
  }> = [];

  return {
    enqueuedJobs,
    async findEnabledConfig() {
      return config;
    },
    async enqueue(job) {
      enqueuedJobs.push(job);
    },
  };
}

function makeDeps(overrides?: Partial<SyncProcessorDeps>): SyncProcessorDeps {
  return {
    repo: createInMemoryRepo(makeConnectorRow()),
    encryptionKey: TEST_ENCRYPTION_KEY,
    validateProvider: createStubSyncRouter(),
    log: silentLog(),
    ...overrides,
  };
}

// ---------- tests ----------

describe("webhook dispatch from alert pipeline", () => {
  test("enqueues webhook delivery when alert fires and config subscribes to alert.fired", async () => {
    const alertResults: AlertEvaluationResult[] = [
      {
        alertId: "alert-1",
        isNew: true,
        metricKey: "mrr",
        ruleId: "rule-1",
        severity: "warning",
        value: 4500,
      },
    ];

    const webhookDispatcher = createStubWebhookDispatcher({
      id: "wh-config-1",
      eventTypes: ["alert.fired", "connector.synced"],
    });

    const deps = makeDeps({
      alertRepo: createStubAlertRepo(alertResults),
      healthRepo: createStubHealthRepo(),
      webhookDispatcher,
    });

    const processor = createSyncProcessor(deps);
    await processor(makeJob(makePayload()));

    expect(webhookDispatcher.enqueuedJobs.length).toBe(1);
    const job = webhookDispatcher.enqueuedJobs[0];
    expect(job.eventType).toBe("alert.fired");
    expect(job.startupId).toBe("startup-1");
    expect(job.webhookConfigId).toBe("wh-config-1");
    expect(job.payload.alertId).toBe("alert-1");
    expect(job.payload.metricKey).toBe("mrr");
    expect(job.payload.severity).toBe("warning");
    expect(job.payload.value).toBe(4500);
    expect(typeof job.deliveryId).toBe("string");
    expect(job.deliveryId.length).toBeGreaterThan(0);
  });

  test("enqueues one job per fired alert", async () => {
    const alertResults: AlertEvaluationResult[] = [
      {
        alertId: "alert-1",
        isNew: true,
        metricKey: "mrr",
        ruleId: "rule-1",
        severity: "warning",
        value: 4500,
      },
      {
        alertId: "alert-2",
        isNew: false,
        metricKey: "churn_rate",
        ruleId: "rule-2",
        severity: "critical",
        value: 0.15,
      },
    ];

    const webhookDispatcher = createStubWebhookDispatcher({
      id: "wh-config-1",
      eventTypes: ["alert.fired"],
    });

    const deps = makeDeps({
      alertRepo: createStubAlertRepo(alertResults),
      healthRepo: createStubHealthRepo(),
      webhookDispatcher,
    });

    const processor = createSyncProcessor(deps);
    await processor(makeJob(makePayload()));

    expect(webhookDispatcher.enqueuedJobs.length).toBe(2);
    expect(webhookDispatcher.enqueuedJobs[0]?.payload.alertId).toBe("alert-1");
    expect(webhookDispatcher.enqueuedJobs[1]?.payload.alertId).toBe("alert-2");
  });

  test("does not enqueue when webhook config does not subscribe to alert.fired", async () => {
    const alertResults: AlertEvaluationResult[] = [
      {
        alertId: "alert-1",
        isNew: true,
        metricKey: "mrr",
        ruleId: "rule-1",
        severity: "warning",
        value: 4500,
      },
    ];

    const webhookDispatcher = createStubWebhookDispatcher({
      id: "wh-config-1",
      eventTypes: ["connector.synced"], // no alert.fired
    });

    const deps = makeDeps({
      alertRepo: createStubAlertRepo(alertResults),
      healthRepo: createStubHealthRepo(),
      webhookDispatcher,
    });

    const processor = createSyncProcessor(deps);
    await processor(makeJob(makePayload()));

    expect(webhookDispatcher.enqueuedJobs.length).toBe(0);
  });

  test("does not enqueue when no webhook config exists", async () => {
    const alertResults: AlertEvaluationResult[] = [
      {
        alertId: "alert-1",
        isNew: true,
        metricKey: "mrr",
        ruleId: "rule-1",
        severity: "warning",
        value: 4500,
      },
    ];

    const webhookDispatcher = createStubWebhookDispatcher(null);

    const deps = makeDeps({
      alertRepo: createStubAlertRepo(alertResults),
      healthRepo: createStubHealthRepo(),
      webhookDispatcher,
    });

    const processor = createSyncProcessor(deps);
    await processor(makeJob(makePayload()));

    expect(webhookDispatcher.enqueuedJobs.length).toBe(0);
  });

  test("does not enqueue when no alerts fire", async () => {
    const webhookDispatcher = createStubWebhookDispatcher({
      id: "wh-config-1",
      eventTypes: ["alert.fired"],
    });

    const deps = makeDeps({
      alertRepo: createStubAlertRepo([]), // no alerts
      healthRepo: createStubHealthRepo(),
      webhookDispatcher,
    });

    const processor = createSyncProcessor(deps);
    await processor(makeJob(makePayload()));

    expect(webhookDispatcher.enqueuedJobs.length).toBe(0);
  });

  test("does not enqueue when webhookDispatcher is not provided", async () => {
    const alertResults: AlertEvaluationResult[] = [
      {
        alertId: "alert-1",
        isNew: true,
        metricKey: "mrr",
        ruleId: "rule-1",
        severity: "warning",
        value: 4500,
      },
    ];

    const deps = makeDeps({
      alertRepo: createStubAlertRepo(alertResults),
      healthRepo: createStubHealthRepo(),
      // no webhookDispatcher
    });

    const processor = createSyncProcessor(deps);
    // Should not throw — gracefully skips webhook dispatch
    await processor(makeJob(makePayload()));
  });

  test("webhook dispatch failure does not fail the sync job", async () => {
    const alertResults: AlertEvaluationResult[] = [
      {
        alertId: "alert-1",
        isNew: true,
        metricKey: "mrr",
        ruleId: "rule-1",
        severity: "warning",
        value: 4500,
      },
    ];

    const failingDispatcher: WebhookDispatcher = {
      async findEnabledConfig() {
        throw new Error("DB connection lost");
      },
      async enqueue() {
        /* noop */
      },
    };

    const deps = makeDeps({
      alertRepo: createStubAlertRepo(alertResults),
      healthRepo: createStubHealthRepo(),
      webhookDispatcher: failingDispatcher,
    });

    const processor = createSyncProcessor(deps);
    // Should not throw — webhook dispatch errors are swallowed
    await processor(makeJob(makePayload()));
  });
});
