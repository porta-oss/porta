// Health sync worker tests.
// Tests the sync processor's health snapshot recompute flow with in-memory stubs.
// Verifies: enqueue → consume → snapshot persistence, and inspectable failure paths.
// No Redis or Postgres required.

import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { ConnectorProvider, SyncJobPayload } from "@shared/connectors";
import { encryptConnectorConfig, parseEncryptionKey } from "@shared/crypto";
import type { FunnelStageRow } from "@shared/startup-health";
import type { UniversalMetrics } from "@shared/universal-metrics";
import type {
  ConnectorRow,
  SyncProcessorDeps,
  SyncRepository,
} from "../src/processors/sync";
import { createSyncProcessor } from "../src/processors/sync";
import {
  createStubProviderRouter,
  createStubSyncRouter,
  createThrowingProviderRouter,
  mergeFunnel,
  mergeMetrics,
} from "../src/providers";
import type {
  HealthSnapshotRepository,
  HealthSnapshotRow,
  ReplaceSnapshotInput,
} from "../src/repository";

// ---------- helpers ----------

const TEST_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const keyBuffer = parseEncryptionKey(TEST_ENCRYPTION_KEY);

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }

  return value;
}

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

function _makeStripeConnectorRow(
  overrides?: Partial<ConnectorRow>
): ConnectorRow {
  const config = JSON.stringify({ secretKey: "sk_test_abc123" });
  const blob = encryptConnectorConfig(config, keyBuffer);
  return {
    id: "conn-stripe-1",
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

/** In-memory sync repository. */
function createInMemoryRepo(
  connectorRow?: ConnectorRow | undefined
): SyncRepository & {
  mutations: Array<{ op: string; args: unknown[] }>;
} {
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

/** In-memory health snapshot repository. */
function createInMemoryHealthRepo(): HealthSnapshotRepository & {
  snapshots: Map<string, ReplaceSnapshotInput>;
  replaceCalls: ReplaceSnapshotInput[];
  shouldFail: boolean;
} {
  const snapshots = new Map<string, ReplaceSnapshotInput>();
  const replaceCalls: ReplaceSnapshotInput[] = [];
  let shouldFail = false;

  return {
    snapshots,
    replaceCalls,
    get shouldFail() {
      return shouldFail;
    },
    set shouldFail(v: boolean) {
      shouldFail = v;
    },

    async replaceSnapshot(input: ReplaceSnapshotInput): Promise<void> {
      replaceCalls.push(input);
      if (shouldFail) {
        throw new Error("Snapshot write failure (simulated)");
      }
      snapshots.set(input.startupId, input);
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

    async findFunnelStages(startupId: string): Promise<FunnelStageRow[]> {
      const input = snapshots.get(startupId);
      if (!input) {
        return [];
      }
      return input.funnel.map((f) => ({
        key: f.key,
        label: f.label,
        value: f.value,
        position: f.position,
      }));
    },

    async checkHealthTablesExist() {
      return { snapshotReady: true, funnelReady: true };
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

/** Captured log calls for assertions. */
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
    validateProvider: createStubProviderRouter({ valid: true }),
    log: silentLog(),
    ...overrides,
  };
}

// ---------- tests ----------

describe("health snapshot recompute", () => {
  describe("successful sync produces snapshot", () => {
    test("creates a snapshot on first sync with valid health data", async () => {
      const healthRepo = createInMemoryHealthRepo();
      const syncRouter = createStubSyncRouter({
        valid: true,
        mrr: 4200,
        supportingMetrics: {
          active_users: 42,
          churn_rate: 2.5,
          arpu: 100,
        },
        funnelStages: { paying_customer: 42 },
      });

      const deps = makeDeps({
        validateProvider: syncRouter,
        healthRepo,
      });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      expect(healthRepo.replaceCalls.length).toBe(1);
      const snap = requireValue(
        healthRepo.replaceCalls[0],
        "Expected health snapshot write on first sync."
      );
      expect(snap.startupId).toBe("startup-1");
      expect(snap.northStarKey).toBe("mrr");
      expect(snap.northStarValue).toBe(4200);
      expect(snap.healthState).toBe("ready");
      expect(snap.syncJobId).toBe("sjob-1");
      expect(snap.funnel.length).toBe(4);
    });

    test("carries forward previous MRR when PostHog sync provides no MRR", async () => {
      const healthRepo = createInMemoryHealthRepo();

      // Pre-seed a snapshot with MRR from a previous Stripe sync
      healthRepo.snapshots.set("startup-1", {
        snapshotId: "old-snap",
        startupId: "startup-1",
        healthState: "ready",
        blockedReason: null,
        northStarKey: "mrr",
        northStarValue: 3000,
        northStarPreviousValue: null,
        supportingMetrics: {},
        syncJobId: "old-job",
        computedAt: new Date(),
        funnel: [],
      });

      const syncRouter = createStubSyncRouter({
        valid: true,
        mrr: null, // PostHog doesn't provide MRR
        supportingMetrics: {
          active_users: 150,
        },
        funnelStages: { visitor: 1000, signup: 200, activation: 80 },
      });

      const deps = makeDeps({
        validateProvider: syncRouter,
        healthRepo,
      });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      const snap = requireValue(
        healthRepo.replaceCalls[0],
        "Expected carried-forward snapshot write."
      );
      expect(snap.northStarValue).toBe(3000); // Carried forward from previous
      expect(snap.northStarPreviousValue).toBe(3000); // Previous was the old value
    });

    test("replaces existing snapshot on manual resync", async () => {
      const healthRepo = createInMemoryHealthRepo();

      // Pre-seed with old data
      healthRepo.snapshots.set("startup-1", {
        snapshotId: "old-snap",
        startupId: "startup-1",
        healthState: "ready",
        blockedReason: null,
        northStarKey: "mrr",
        northStarValue: 1000,
        northStarPreviousValue: null,
        supportingMetrics: {},
        syncJobId: "old-job",
        computedAt: new Date(Date.now() - 60_000),
        funnel: [],
      });

      const syncRouter = createStubSyncRouter({
        valid: true,
        mrr: 2000, // Updated MRR
        supportingMetrics: {
          active_users: 20,
        },
        funnelStages: null,
      });

      const deps = makeDeps({
        validateProvider: syncRouter,
        healthRepo,
      });
      const processor = createSyncProcessor(deps);

      await processor(
        makeJob(makePayload({ trigger: "manual", syncJobId: "sjob-resync" }))
      );

      expect(healthRepo.replaceCalls.length).toBe(1);
      const snap = requireValue(
        healthRepo.replaceCalls[0],
        "Expected snapshot write on manual resync."
      );
      expect(snap.northStarValue).toBe(2000);
      expect(snap.northStarPreviousValue).toBe(1000);
      expect(snap.syncJobId).toBe("sjob-resync");
    });

    test("includes funnel stages with correct positions", async () => {
      const healthRepo = createInMemoryHealthRepo();
      const syncRouter = createStubSyncRouter({
        valid: true,
        mrr: 5000,
        supportingMetrics: null,
        funnelStages: {
          visitor: 500,
          signup: 100,
          activation: 50,
          paying_customer: 20,
        },
      });

      const deps = makeDeps({ validateProvider: syncRouter, healthRepo });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      const snap = requireValue(
        healthRepo.replaceCalls[0],
        "Expected snapshot write with funnel stages."
      );
      expect(snap.funnel.length).toBe(4);

      const visitor = requireValue(
        snap.funnel.find((f) => f.key === "visitor"),
        "Expected visitor funnel stage."
      );
      expect(visitor.value).toBe(500);
      expect(visitor.position).toBe(0);

      const paying = requireValue(
        snap.funnel.find((f) => f.key === "paying_customer"),
        "Expected paying customer funnel stage."
      );
      expect(paying.value).toBe(20);
      expect(paying.position).toBe(3);
    });
  });

  describe("failure preserves previous snapshot", () => {
    test("provider failure does not create or replace snapshot", async () => {
      const healthRepo = createInMemoryHealthRepo();

      // Pre-seed snapshot
      healthRepo.snapshots.set("startup-1", {
        snapshotId: "preserved-snap",
        startupId: "startup-1",
        healthState: "ready",
        blockedReason: null,
        northStarKey: "mrr",
        northStarValue: 5000,
        northStarPreviousValue: null,
        supportingMetrics: {},
        syncJobId: "old-job",
        computedAt: new Date(),
        funnel: [],
      });

      const deps = makeDeps({
        validateProvider: createStubProviderRouter({
          valid: false,
          error: "Auth expired",
        }),
        healthRepo,
      });
      const processor = createSyncProcessor(deps);

      // Non-retryable failure — no throw
      await processor(makeJob(makePayload()));

      // Snapshot should NOT have been replaced
      expect(healthRepo.replaceCalls.length).toBe(0);
      const preserved = requireValue(
        healthRepo.snapshots.get("startup-1"),
        "Expected preserved snapshot after provider failure."
      );
      expect(preserved.snapshotId).toBe("preserved-snap");
      expect(preserved.northStarValue).toBe(5000);
    });

    test("retryable provider failure preserves snapshot and throws", async () => {
      const healthRepo = createInMemoryHealthRepo();
      healthRepo.snapshots.set("startup-1", {
        snapshotId: "preserved-snap",
        startupId: "startup-1",
        healthState: "ready",
        blockedReason: null,
        northStarKey: "mrr",
        northStarValue: 3000,
        northStarPreviousValue: null,
        supportingMetrics: {},
        syncJobId: "old-job",
        computedAt: new Date(),
        funnel: [],
      });

      const deps = makeDeps({
        validateProvider: createStubProviderRouter({
          valid: false,
          error: "Timeout",
          retryable: true,
        }),
        healthRepo,
      });
      const processor = createSyncProcessor(deps);

      await expect(processor(makeJob(makePayload()))).rejects.toThrow(
        "Timeout"
      );

      expect(healthRepo.replaceCalls.length).toBe(0);
      expect(healthRepo.snapshots.get("startup-1")?.northStarValue).toBe(3000);
    });

    test("snapshot write failure is caught and logged, does not fail sync job", async () => {
      const healthRepo = createInMemoryHealthRepo();
      healthRepo.shouldFail = true;

      const log = capturingLog();
      const syncRouter = createStubSyncRouter({
        valid: true,
        mrr: 7000,
        supportingMetrics: null,
        funnelStages: null,
      });

      const deps = makeDeps({
        validateProvider: syncRouter,
        healthRepo,
        log,
      });
      const processor = createSyncProcessor(deps);

      // Should NOT throw even though snapshot write fails
      await processor(makeJob(makePayload()));

      // Sync job should still be marked completed
      const completedOp = deps.repo.mutations.find(
        (m) => m.op === "markSyncJobCompleted"
      );
      expect(completedOp).toBeDefined();

      // Error should be logged
      const errorLog = log.entries.find((e) =>
        e.msg.includes("recompute failed")
      );
      expect(errorLog).toBeDefined();
    });

    test("provider throw preserves snapshot and fails sync job", async () => {
      const healthRepo = createInMemoryHealthRepo();
      healthRepo.snapshots.set("startup-1", {
        snapshotId: "safe-snap",
        startupId: "startup-1",
        healthState: "ready",
        blockedReason: null,
        northStarKey: "mrr",
        northStarValue: 9000,
        northStarPreviousValue: null,
        supportingMetrics: {},
        syncJobId: "old-job",
        computedAt: new Date(),
        funnel: [],
      });

      const deps = makeDeps({
        validateProvider: createThrowingProviderRouter("Connection refused"),
        healthRepo,
      });
      const processor = createSyncProcessor(deps);

      await expect(processor(makeJob(makePayload()))).rejects.toThrow(
        "Connection refused"
      );

      expect(healthRepo.replaceCalls.length).toBe(0);
      expect(healthRepo.snapshots.get("startup-1")?.northStarValue).toBe(9000);
    });
  });

  describe("no health repo (backward compatibility)", () => {
    test("processor works without healthRepo injected", async () => {
      const deps = makeDeps({ healthRepo: undefined });
      const processor = createSyncProcessor(deps);

      await processor(makeJob(makePayload()));

      const completedOp = deps.repo.mutations.find(
        (m) => m.op === "markSyncJobCompleted"
      );
      expect(completedOp).toBeDefined();
    });
  });
});

describe("metric merging", () => {
  test("mergeMetrics passes through provided keys", () => {
    const partial: Partial<UniversalMetrics> = {
      churn_rate: 42,
    };
    const result = mergeMetrics(partial, null);

    expect(result.churn_rate).toBe(42);
    expect(result.active_users).toBeUndefined();
    expect(result.arpu).toBeUndefined();
  });

  test("mergeMetrics combines Stripe and PostHog metrics", () => {
    const stripe: Partial<UniversalMetrics> = {
      churn_rate: 5,
      arpu: 50,
    };
    const posthog: Partial<UniversalMetrics> = {
      active_users: 200,
    };

    const result = mergeMetrics(stripe, posthog);

    expect(result.active_users).toBe(200);
    expect(result.churn_rate).toBe(5);
    expect(result.arpu).toBe(50);
  });

  test("mergeMetrics handles all nulls gracefully", () => {
    const result = mergeMetrics(null, null);

    expect(result.active_users).toBeUndefined();
    expect(result.churn_rate).toBeUndefined();
    expect(result.arpu).toBeUndefined();
  });
});

describe("funnel merging", () => {
  test("mergeFunnel applies partial values over defaults", () => {
    const partial = { visitor: 500, signup: 100 };
    const result = mergeFunnel(partial);

    expect(result.length).toBe(4);
    expect(result.find((r) => r.key === "visitor")?.value).toBe(500);
    expect(result.find((r) => r.key === "signup")?.value).toBe(100);
    expect(result.find((r) => r.key === "activation")?.value).toBe(0); // Default
    expect(result.find((r) => r.key === "paying_customer")?.value).toBe(0); // Default
  });

  test("mergeFunnel returns zeros when input is null", () => {
    const result = mergeFunnel(null);
    expect(result.length).toBe(4);
    for (const row of result) {
      expect(row.value).toBe(0);
    }
  });

  test("mergeFunnel ignores non-finite values", () => {
    const partial = { visitor: Number.NaN, signup: Number.POSITIVE_INFINITY };
    const result = mergeFunnel(partial);

    expect(result.find((r) => r.key === "visitor")?.value).toBe(0);
    expect(result.find((r) => r.key === "signup")?.value).toBe(0);
  });

  test("mergeFunnel preserves stage positions and labels", () => {
    const result = mergeFunnel({ visitor: 10 });

    const visitor = requireValue(
      result.find((r) => r.key === "visitor"),
      "Expected visitor stage in merged funnel."
    );
    expect(visitor.position).toBe(0);
    expect(visitor.label).toBe("Visitors");

    const paying = requireValue(
      result.find((r) => r.key === "paying_customer"),
      "Expected paying customer stage in merged funnel."
    );
    expect(paying.position).toBe(3);
    expect(paying.label).toBe("Paying Customers");
  });
});

describe("malformed inputs", () => {
  test("malformed connector config JSON is caught by provider router", async () => {
    // The provider router should gracefully handle malformed JSON
    const healthRepo = createInMemoryHealthRepo();

    // Use a connector with corrupted encrypted config that decrypts to invalid JSON
    const badConfig = "this is not JSON";
    const blob = encryptConnectorConfig(badConfig, keyBuffer);
    const connectorRow = makeConnectorRow({
      encryptedConfig: blob.ciphertext,
      encryptionIv: blob.iv,
      encryptionAuthTag: blob.authTag,
    });

    const repo = createInMemoryRepo(connectorRow);

    // Use the stub provider router that accepts ProviderValidationResult
    // The production router handles JSON.parse errors internally
    const stubRouter = createStubProviderRouter({
      valid: false,
      error: "Malformed provider config JSON for posthog.",
    });

    const deps = makeDeps({
      repo,
      validateProvider: stubRouter,
      healthRepo,
    });
    const processor = createSyncProcessor(deps);

    // Should not throw (non-retryable)
    await processor(makeJob(makePayload()));

    // Sync job should be failed
    const failOp = deps.repo.mutations.find(
      (m) => m.op === "markSyncJobFailed"
    );
    expect(failOp).toBeDefined();

    // No snapshot should have been created
    expect(healthRepo.replaceCalls.length).toBe(0);
  });

  test("unsupported provider is handled as non-retryable failure", async () => {
    const healthRepo = createInMemoryHealthRepo();
    const connectorRow = makeConnectorRow({ provider: "unknown_provider" });
    const repo = createInMemoryRepo(connectorRow);
    const stubRouter = createStubProviderRouter({
      valid: false,
      error: "Unsupported provider: unknown_provider",
    });

    const deps = makeDeps({ repo, validateProvider: stubRouter, healthRepo });
    const processor = createSyncProcessor(deps);

    await processor(
      makeJob(
        makePayload({ provider: "unknown_provider" as ConnectorProvider })
      )
    );

    const failOp = deps.repo.mutations.find(
      (m) => m.op === "markSyncJobFailed"
    );
    expect(failOp).toBeDefined();
    expect(healthRepo.replaceCalls.length).toBe(0);
  });
});

describe("boundary conditions", () => {
  test("initial sync creates snapshot from scratch", async () => {
    const healthRepo = createInMemoryHealthRepo();
    const syncRouter = createStubSyncRouter({
      valid: true,
      mrr: 1000,
      supportingMetrics: {
        churn_rate: 5,
      },
      funnelStages: { paying_customer: 5 },
    });

    const deps = makeDeps({ validateProvider: syncRouter, healthRepo });
    const processor = createSyncProcessor(deps);

    await processor(makeJob(makePayload({ trigger: "initial" })));

    expect(healthRepo.replaceCalls.length).toBe(1);
    const snap = requireValue(
      healthRepo.replaceCalls[0],
      "Expected initial sync snapshot write."
    );
    expect(snap.northStarPreviousValue).toBeNull(); // No previous on initial sync
    expect(snap.northStarValue).toBe(1000);
  });

  test("one provider stale while other stays healthy", async () => {
    const healthRepo = createInMemoryHealthRepo();

    // Pre-seed with data from both providers
    const prevMetrics: UniversalMetrics = {
      churn_rate: 10,
      active_users: 100,
    };

    healthRepo.snapshots.set("startup-1", {
      snapshotId: "old-snap",
      startupId: "startup-1",
      healthState: "ready",
      blockedReason: null,
      northStarKey: "mrr",
      northStarValue: 2000,
      northStarPreviousValue: null,
      supportingMetrics: prevMetrics,
      syncJobId: "old-job",
      computedAt: new Date(),
      funnel: [],
    });

    // PostHog sync succeeds with updated active_users, but no Stripe data
    const syncRouter = createStubSyncRouter({
      valid: true,
      mrr: null, // PostHog doesn't provide MRR
      supportingMetrics: {
        active_users: 150,
      },
      funnelStages: { visitor: 500, signup: 100 },
    });

    const deps = makeDeps({ validateProvider: syncRouter, healthRepo });
    const processor = createSyncProcessor(deps);

    await processor(makeJob(makePayload()));

    const snap = requireValue(
      healthRepo.replaceCalls[0],
      "Expected snapshot write when one provider stays healthy."
    );
    // MRR carried from previous (Stripe data)
    expect(snap.northStarValue).toBe(2000);
    // Active users updated from PostHog
    expect((snap.supportingMetrics as UniversalMetrics).active_users).toBe(150);
  });
});

describe("observability", () => {
  test("successful recompute logs snapshot metadata", async () => {
    const healthRepo = createInMemoryHealthRepo();
    const log = capturingLog();
    const syncRouter = createStubSyncRouter({
      valid: true,
      mrr: 5000,
      supportingMetrics: null,
      funnelStages: null,
    });

    const deps = makeDeps({ validateProvider: syncRouter, healthRepo, log });
    const processor = createSyncProcessor(deps);

    await processor(makeJob(makePayload()));

    const recomputeLog = log.entries.find(
      (e) => e.msg === "health snapshot recomputed"
    );
    expect(recomputeLog).toBeDefined();
    expect(recomputeLog?.meta?.mrr).toBe(5000);
    expect(recomputeLog?.meta?.healthState).toBe("ready");
    expect(recomputeLog?.meta?.snapshotId).toBeDefined();
    expect(recomputeLog?.meta?.computedAt).toBeDefined();
  });

  test("failed recompute logs error with context", async () => {
    const healthRepo = createInMemoryHealthRepo();
    healthRepo.shouldFail = true;
    const log = capturingLog();
    const syncRouter = createStubSyncRouter({
      valid: true,
      mrr: 5000,
      supportingMetrics: null,
      funnelStages: null,
    });

    const deps = makeDeps({ validateProvider: syncRouter, healthRepo, log });
    const processor = createSyncProcessor(deps);

    await processor(makeJob(makePayload()));

    const errorLog = log.entries.find((e) =>
      e.msg.includes("recompute failed")
    );
    expect(errorLog).toBeDefined();
    expect(errorLog?.level).toBe("error");
    expect(errorLog?.meta?.error).toContain("Snapshot write failure");
  });
});
