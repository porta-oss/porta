// Alert integration worker tests.
// Tests alert evaluation, seeding, history recording, and streak tracking
// integrated into the sync processor pipeline with in-memory stubs.
// No Redis or Postgres required.

import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { SyncJobPayload } from "@shared/connectors";
import { encryptConnectorConfig, parseEncryptionKey } from "@shared/crypto";
import type { FunnelStageRow } from "@shared/startup-health";
import type {
  ConnectorRow,
  SyncProcessorDeps,
  SyncRepository,
} from "../src/processors/sync";
import { createSyncProcessor } from "../src/processors/sync";
import { createStubSyncRouter } from "../src/providers";
import type {
  AlertEvaluationResult,
  AlertRepository,
  HealthSnapshotRepository,
  HealthSnapshotRow,
  RecordHistoryInput,
  ReplaceSnapshotInput,
} from "../src/repository";

// ---------- helpers ----------

const TEST_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const keyBuffer = parseEncryptionKey(TEST_ENCRYPTION_KEY);

function makeConnectorRow(overrides?: Partial<ConnectorRow>): ConnectorRow {
  const config = JSON.stringify({
    apiKey: "phc_test",
    projectId: "123",
    host: "https://app.posthog.com",
  });
  const blob = encryptConnectorConfig(config, keyBuffer);
  return {
    id: "conn-1",
    provider: "posthog",
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
    provider: "posthog",
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

function createInMemoryRepo(
  connectorRow?: ConnectorRow | undefined
): SyncRepository & { mutations: Array<{ op: string; args: unknown[] }> } {
  const mutations: Array<{ op: string; args: unknown[] }> = [];
  return {
    mutations,
    async findConnector(connectorId: string) {
      mutations.push({ op: "findConnector", args: [connectorId] });
      return connectorRow;
    },
    async markSyncJobRunning(syncJobId, startedAt, attempt) {
      mutations.push({
        op: "markSyncJobRunning",
        args: [syncJobId, startedAt, attempt],
      });
    },
    async markSyncJobCompleted(
      syncJobId,
      connectorId,
      completedAt,
      durationMs
    ) {
      mutations.push({
        op: "markSyncJobCompleted",
        args: [syncJobId, connectorId, completedAt, durationMs],
      });
    },
    async markSyncJobFailed(
      syncJobId,
      connectorId,
      error,
      completedAt,
      durationMs
    ) {
      mutations.push({
        op: "markSyncJobFailed",
        args: [syncJobId, connectorId, error, completedAt, durationMs],
      });
    },
  };
}

/** In-memory health snapshot repository with history tracking. */
function createInMemoryHealthRepo(): HealthSnapshotRepository & {
  snapshots: Map<string, ReplaceSnapshotInput>;
  replaceCalls: ReplaceSnapshotInput[];
  historyCalls: RecordHistoryInput[];
} {
  const snapshots = new Map<string, ReplaceSnapshotInput>();
  const replaceCalls: ReplaceSnapshotInput[] = [];
  const historyCalls: RecordHistoryInput[] = [];

  return {
    snapshots,
    replaceCalls,
    historyCalls,

    async replaceSnapshot(input: ReplaceSnapshotInput): Promise<void> {
      replaceCalls.push(input);
      snapshots.set(input.startupId, input);
    },

    async recordHistory(input: RecordHistoryInput): Promise<void> {
      historyCalls.push(input);
    },

    async findSnapshot(
      startupId: string
    ): Promise<HealthSnapshotRow | undefined> {
      const input = snapshots.get(startupId);
      if (!input) {
        return undefined;
      }
      return {
        id: input.snapshotId,
        startupId: input.startupId,
        healthState: input.healthState,
        blockedReason: input.blockedReason,
        northStarKey: input.northStarKey,
        northStarValue: input.northStarValue,
        northStarPreviousValue: input.northStarPreviousValue,
        supportingMetrics: input.supportingMetrics,
        syncJobId: input.syncJobId,
        computedAt: input.computedAt,
      };
    },

    async findFunnelStages(_startupId: string): Promise<FunnelStageRow[]> {
      return [];
    },

    async checkHealthTablesExist() {
      return { snapshotReady: true, funnelReady: true };
    },
  };
}

/** In-memory alert repository with inspectable calls. */
function createInMemoryAlertRepo(): AlertRepository & {
  evaluateCalls: string[];
  seedCalls: Array<{ startupId: string; metricKeys: string[] }>;
  streakCalls: Array<{ startupId: string; hasActiveAlerts: boolean }>;
  countCalls: string[];
  evaluateResults: AlertEvaluationResult[];
  seedResult: number;
  activeAlertCount: number;
  shouldThrow: boolean;
} {
  const evaluateCalls: string[] = [];
  const seedCalls: Array<{ startupId: string; metricKeys: string[] }> = [];
  const streakCalls: Array<{
    startupId: string;
    hasActiveAlerts: boolean;
  }> = [];
  const countCalls: string[] = [];
  let evaluateResults: AlertEvaluationResult[] = [];
  let seedResult = 0;
  let activeAlertCount = 0;
  let shouldThrow = false;

  return {
    evaluateCalls,
    seedCalls,
    streakCalls,
    countCalls,
    get evaluateResults() {
      return evaluateResults;
    },
    set evaluateResults(v: AlertEvaluationResult[]) {
      evaluateResults = v;
    },
    get seedResult() {
      return seedResult;
    },
    set seedResult(v: number) {
      seedResult = v;
    },
    get activeAlertCount() {
      return activeAlertCount;
    },
    set activeAlertCount(v: number) {
      activeAlertCount = v;
    },
    get shouldThrow() {
      return shouldThrow;
    },
    set shouldThrow(v: boolean) {
      shouldThrow = v;
    },

    async evaluateAlerts(startupId: string) {
      evaluateCalls.push(startupId);
      if (shouldThrow) {
        throw new Error("alert evaluation failed (simulated)");
      }
      return evaluateResults;
    },

    async seedDefaultAlerts(startupId: string, metricKeys: string[]) {
      seedCalls.push({ startupId, metricKeys });
      return seedResult;
    },

    async updateStreak(startupId: string, hasActiveAlerts: boolean) {
      streakCalls.push({ startupId, hasActiveAlerts });
    },

    async countActiveAlerts(startupId: string) {
      countCalls.push(startupId);
      return activeAlertCount;
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

function capturingLog() {
  const entries: Array<{
    level: string;
    msg: string;
    meta?: Record<string, unknown>;
  }> = [];
  return {
    entries,
    info: (msg: string, meta?: Record<string, unknown>) => {
      entries.push({ level: "info", msg, meta });
    },
    warn: (msg: string, meta?: Record<string, unknown>) => {
      entries.push({ level: "warn", msg, meta });
    },
    error: (msg: string, meta?: Record<string, unknown>) => {
      entries.push({ level: "error", msg, meta });
    },
  };
}

function makeDeps(
  overrides?: Partial<SyncProcessorDeps> & {
    repo?: ReturnType<typeof createInMemoryRepo>;
  }
): SyncProcessorDeps & { repo: ReturnType<typeof createInMemoryRepo> } {
  const repo = overrides?.repo ?? createInMemoryRepo(makeConnectorRow());
  return {
    repo,
    encryptionKey: TEST_ENCRYPTION_KEY,
    validateProvider: createStubSyncRouter({
      valid: true,
      mrr: 5000,
      supportingMetrics: { active_users: 100, churn_rate: 3 },
      funnelStages: null,
    }),
    log: silentLog(),
    ...overrides,
  };
}

// ---------- tests ----------

describe("alert integration in sync pipeline", () => {
  describe("history recording", () => {
    test("records metric history after snapshot recompute", async () => {
      const healthRepo = createInMemoryHealthRepo();
      const alertRepo = createInMemoryAlertRepo();
      const syncRouter = createStubSyncRouter({
        valid: true,
        mrr: 5000,
        supportingMetrics: { active_users: 100, churn_rate: 3 },
        funnelStages: null,
      });

      const deps = makeDeps({
        validateProvider: syncRouter,
        healthRepo,
        alertRepo,
      });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      // History should have been recorded
      expect(healthRepo.historyCalls.length).toBe(1);
      const historyInput = healthRepo.historyCalls[0];
      expect(historyInput.startupId).toBe("startup-1");
      expect(historyInput.northStarKey).toBe("mrr");
      expect(historyInput.northStarValue).toBe(5000);
      expect(historyInput.supportingMetrics.active_users).toBe(100);
      expect(historyInput.supportingMetrics.churn_rate).toBe(3);
      expect(historyInput.capturedAt).toBeInstanceOf(Date);
      expect(historyInput.snapshotId).toBeDefined();
    });

    test("does not record history when health repo is not provided", async () => {
      const alertRepo = createInMemoryAlertRepo();
      const deps = makeDeps({ healthRepo: undefined, alertRepo });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      // Alert processing should not be called without healthRepo
      expect(alertRepo.evaluateCalls.length).toBe(0);
    });
  });

  describe("alert seeding", () => {
    test("seeds default alerts on successful sync", async () => {
      const healthRepo = createInMemoryHealthRepo();
      const alertRepo = createInMemoryAlertRepo();
      alertRepo.seedResult = 3;
      const log = capturingLog();

      const syncRouter = createStubSyncRouter({
        valid: true,
        mrr: 5000,
        supportingMetrics: { active_users: 100 },
        funnelStages: null,
      });

      const deps = makeDeps({
        validateProvider: syncRouter,
        healthRepo,
        alertRepo,
        log,
      });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      // Seed should have been called with available metric keys
      expect(alertRepo.seedCalls.length).toBe(1);
      expect(alertRepo.seedCalls[0].startupId).toBe("startup-1");
      expect(alertRepo.seedCalls[0].metricKeys).toContain("active_users");
      expect(alertRepo.seedCalls[0].metricKeys).toContain("mrr");

      // Should log seeding
      const seedLog = log.entries.find((e) =>
        e.msg.includes("default alert rules seeded")
      );
      expect(seedLog).toBeDefined();
      expect(seedLog?.meta?.rulesSeeded).toBe(3);
    });

    test("does not log seeding when zero rules seeded", async () => {
      const healthRepo = createInMemoryHealthRepo();
      const alertRepo = createInMemoryAlertRepo();
      alertRepo.seedResult = 0; // Already has rules
      const log = capturingLog();

      const syncRouter = createStubSyncRouter({
        valid: true,
        mrr: 5000,
        supportingMetrics: {},
        funnelStages: null,
      });

      const deps = makeDeps({
        validateProvider: syncRouter,
        healthRepo,
        alertRepo,
        log,
      });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      const seedLog = log.entries.find((e) =>
        e.msg.includes("default alert rules seeded")
      );
      expect(seedLog).toBeUndefined();
    });
  });

  describe("alert evaluation", () => {
    test("evaluates alerts after snapshot recompute", async () => {
      const healthRepo = createInMemoryHealthRepo();
      const alertRepo = createInMemoryAlertRepo();
      alertRepo.evaluateResults = [
        {
          alertId: "alert-1",
          isNew: true,
          metricKey: "mrr",
          ruleId: "rule-1",
          severity: "critical",
          value: 750,
        },
      ];

      const syncRouter = createStubSyncRouter({
        valid: true,
        mrr: 5000,
        supportingMetrics: { active_users: 100 },
        funnelStages: null,
      });

      const deps = makeDeps({
        validateProvider: syncRouter,
        healthRepo,
        alertRepo,
      });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      expect(alertRepo.evaluateCalls.length).toBe(1);
      expect(alertRepo.evaluateCalls[0]).toBe("startup-1");
    });

    test("logs evaluation results with alert counts", async () => {
      const healthRepo = createInMemoryHealthRepo();
      const alertRepo = createInMemoryAlertRepo();
      alertRepo.evaluateResults = [
        {
          alertId: "a1",
          isNew: true,
          metricKey: "mrr",
          ruleId: "r1",
          severity: "critical",
          value: 750,
        },
        {
          alertId: "a2",
          isNew: false,
          metricKey: "active_users",
          ruleId: "r2",
          severity: "high",
          value: 50,
        },
      ];
      const log = capturingLog();

      const syncRouter = createStubSyncRouter({
        valid: true,
        mrr: 5000,
        supportingMetrics: {},
        funnelStages: null,
      });

      const deps = makeDeps({
        validateProvider: syncRouter,
        healthRepo,
        alertRepo,
        log,
      });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      const evalLog = log.entries.find((e) =>
        e.msg.includes("alert evaluation complete")
      );
      expect(evalLog).toBeDefined();
      expect(evalLog?.meta?.alertsFired).toBe(2);
      expect(evalLog?.meta?.newAlerts).toBe(1);
    });

    test("does not evaluate alerts when alertRepo is not provided", async () => {
      const healthRepo = createInMemoryHealthRepo();
      const log = capturingLog();

      const syncRouter = createStubSyncRouter({
        valid: true,
        mrr: 5000,
        supportingMetrics: {},
        funnelStages: null,
      });

      const deps = makeDeps({
        validateProvider: syncRouter,
        healthRepo,
        alertRepo: undefined,
        log,
      });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      // No alert-related logs
      const alertLog = log.entries.find(
        (e) =>
          e.msg.includes("alert evaluation") ||
          e.msg.includes("alert rules seeded")
      );
      expect(alertLog).toBeUndefined();
    });

    test("evaluation failure does not fail the sync job", async () => {
      const healthRepo = createInMemoryHealthRepo();
      const alertRepo = createInMemoryAlertRepo();
      alertRepo.shouldThrow = true;
      const log = capturingLog();

      const syncRouter = createStubSyncRouter({
        valid: true,
        mrr: 5000,
        supportingMetrics: {},
        funnelStages: null,
      });

      const deps = makeDeps({
        validateProvider: syncRouter,
        healthRepo,
        alertRepo,
        log,
      });
      const processor = createSyncProcessor(deps);

      // Should NOT throw even though alert evaluation fails
      await processor(makeJob(makePayload()));

      // Sync job should still complete
      const completedOp = deps.repo.mutations.find(
        (m) => m.op === "markSyncJobCompleted"
      );
      expect(completedOp).toBeDefined();

      // Error should be logged
      const errorLog = log.entries.find((e) =>
        e.msg.includes("alert processing failed")
      );
      expect(errorLog).toBeDefined();
      expect(errorLog?.meta?.error).toContain("alert evaluation failed");
    });
  });

  describe("streak tracking", () => {
    test("updates streak with no active alerts (increment)", async () => {
      const healthRepo = createInMemoryHealthRepo();
      const alertRepo = createInMemoryAlertRepo();
      alertRepo.activeAlertCount = 0;

      const syncRouter = createStubSyncRouter({
        valid: true,
        mrr: 5000,
        supportingMetrics: {},
        funnelStages: null,
      });

      const deps = makeDeps({
        validateProvider: syncRouter,
        healthRepo,
        alertRepo,
      });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      expect(alertRepo.streakCalls.length).toBe(1);
      expect(alertRepo.streakCalls[0].startupId).toBe("startup-1");
      expect(alertRepo.streakCalls[0].hasActiveAlerts).toBe(false);
    });

    test("updates streak with active alerts (reset)", async () => {
      const healthRepo = createInMemoryHealthRepo();
      const alertRepo = createInMemoryAlertRepo();
      alertRepo.activeAlertCount = 3;

      const syncRouter = createStubSyncRouter({
        valid: true,
        mrr: 5000,
        supportingMetrics: {},
        funnelStages: null,
      });

      const deps = makeDeps({
        validateProvider: syncRouter,
        healthRepo,
        alertRepo,
      });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      expect(alertRepo.streakCalls.length).toBe(1);
      expect(alertRepo.streakCalls[0].hasActiveAlerts).toBe(true);
    });
  });

  describe("provider failure skips alerts", () => {
    test("does not process alerts when sync fails", async () => {
      const healthRepo = createInMemoryHealthRepo();
      const alertRepo = createInMemoryAlertRepo();

      const deps = makeDeps({
        validateProvider: createStubSyncRouter({
          valid: false,
          error: "Auth expired",
          mrr: null,
          supportingMetrics: null,
          funnelStages: null,
        } as any),
        healthRepo,
        alertRepo,
      });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      // No alert processing on failed sync
      expect(alertRepo.evaluateCalls.length).toBe(0);
      expect(alertRepo.seedCalls.length).toBe(0);
      expect(alertRepo.streakCalls.length).toBe(0);
    });
  });

  describe("execution order", () => {
    test("seeds before evaluating, evaluates before updating streak", async () => {
      const healthRepo = createInMemoryHealthRepo();
      const callOrder: string[] = [];

      const alertRepo: AlertRepository & { [key: string]: unknown } = {
        async evaluateAlerts(_startupId: string) {
          callOrder.push("evaluate");
          return [];
        },
        async seedDefaultAlerts(_startupId: string, _metricKeys: string[]) {
          callOrder.push("seed");
          return 0;
        },
        async updateStreak(_startupId: string, _hasActiveAlerts: boolean) {
          callOrder.push("streak");
        },
        async countActiveAlerts(_startupId: string) {
          callOrder.push("count");
          return 0;
        },
      };

      const syncRouter = createStubSyncRouter({
        valid: true,
        mrr: 5000,
        supportingMetrics: {},
        funnelStages: null,
      });

      const deps = makeDeps({
        validateProvider: syncRouter,
        healthRepo,
        alertRepo,
      });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      expect(callOrder).toEqual(["seed", "evaluate", "count", "streak"]);
    });
  });
});
