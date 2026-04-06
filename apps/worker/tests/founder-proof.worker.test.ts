// Founder-proof worker tests.
// Tests that founder-proof mode produces deterministic health snapshots,
// grounded insights, and synced task state through the real worker pipeline
// without requiring live Anthropic or Linear credentials.
// Also verifies that the non-proof runtime still behaves correctly when
// live keys are absent.
//
// No Redis, Postgres, Anthropic, or Linear API required — all tests use
// in-memory stubs for repositories and injected dependencies.

import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { ConnectorProvider, SyncJobPayload } from "@shared/connectors";
import { encryptConnectorConfig, parseEncryptionKey } from "@shared/crypto";
import type { FunnelStageRow } from "@shared/startup-health";
import type { InsightExplanation } from "@shared/startup-insight";
import { readWorkerEnv } from "../src/env";
import { createFounderProofExplainer } from "../src/insights";
import type { ConnectorRow, SyncRepository } from "../src/processors/sync";
import { createSyncProcessor } from "../src/processors/sync";
import type { TaskSyncJobPayload } from "../src/processors/task-sync";
import {
  createFounderProofLinearClient,
  createTaskSyncProcessor,
} from "../src/processors/task-sync";
import {
  createFounderProofSyncRouter,
  FOUNDER_PROOF_POSTHOG_CONFIG,
  FOUNDER_PROOF_STRIPE_CONFIG,
} from "../src/providers";
import type {
  HealthSnapshotRepository,
  HealthSnapshotRow,
  InsightRepository,
  InsightRow,
  InternalTaskRepository,
  InternalTaskRow,
  ReplaceInsightInput,
  ReplaceSnapshotInput,
  UpdateInsightDiagnosticsInput,
} from "../src/repository";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const keyBuffer = parseEncryptionKey(TEST_ENCRYPTION_KEY);

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }

  return value;
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

function makeConnectorRow(
  provider: ConnectorProvider,
  config: Record<string, unknown>,
  overrides?: Partial<ConnectorRow>
): ConnectorRow {
  const blob = encryptConnectorConfig(JSON.stringify(config), keyBuffer);
  return {
    id: `conn-${provider}-1`,
    provider,
    encryptedConfig: blob.ciphertext,
    encryptionIv: blob.iv,
    encryptionAuthTag: blob.authTag,
    ...overrides,
  };
}

function makePayload(overrides?: Partial<SyncJobPayload>): SyncJobPayload {
  return {
    connectorId: "conn-posthog-1",
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

function makeTaskRow(overrides?: Partial<InternalTaskRow>): InternalTaskRow {
  return {
    id: "task-1",
    startupId: "startup-1",
    title: "Investigate MRR drop",
    description: "The MRR dropped 15% — investigate churn patterns.",
    linkedMetricKeys: ["mrr", "churn_rate"],
    syncStatus: "not_synced",
    linearIssueId: null,
    sourceInsightId: "insight-1",
    sourceActionIndex: 0,
    ...overrides,
  };
}

function makeTaskJob(data: TaskSyncJobPayload, attemptsMade = 0) {
  return {
    id: `bullmq-task-sync-${data.taskId}`,
    data,
    attemptsMade,
    name: "task-sync",
  } as any;
}

// In-memory repositories

function createInMemoryRepo(connectorRow?: ConnectorRow): SyncRepository & {
  mutations: Array<{ op: string; args: unknown[] }>;
} {
  const mutations: Array<{ op: string; args: unknown[] }> = [];
  return {
    mutations,
    async findConnector(_connectorId: string) {
      mutations.push({ op: "findConnector", args: [_connectorId] });
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

function createInMemoryHealthRepo(
  initialSnapshot?: HealthSnapshotRow
): HealthSnapshotRepository & {
  snapshots: Map<string, ReplaceSnapshotInput>;
  snapshotRows: Map<string, HealthSnapshotRow>;
} {
  const snapshots = new Map<string, ReplaceSnapshotInput>();
  const snapshotRows = new Map<string, HealthSnapshotRow>();

  if (initialSnapshot) {
    snapshotRows.set(initialSnapshot.startupId, initialSnapshot);
  }

  return {
    snapshots,
    snapshotRows,
    async recordHistory(): Promise<void> {
      // no-op for tests
    },
    async replaceSnapshot(input: ReplaceSnapshotInput): Promise<void> {
      snapshots.set(input.startupId, input);
      snapshotRows.set(input.startupId, {
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
      });
    },
    async findSnapshot(
      startupId: string
    ): Promise<HealthSnapshotRow | undefined> {
      return snapshotRows.get(startupId);
    },
    async findFunnelStages(_startupId: string): Promise<FunnelStageRow[]> {
      const input = snapshots.get(_startupId);
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

function createInMemoryInsightRepo(): InsightRepository & {
  insights: Map<string, ReplaceInsightInput>;
  diagnosticsUpdates: UpdateInsightDiagnosticsInput[];
} {
  const insights = new Map<string, ReplaceInsightInput>();
  const diagnosticsUpdates: UpdateInsightDiagnosticsInput[] = [];

  return {
    insights,
    diagnosticsUpdates,
    async replaceInsight(input: ReplaceInsightInput): Promise<void> {
      insights.set(input.startupId, input);
    },
    async findInsight(startupId: string): Promise<InsightRow | undefined> {
      const input = insights.get(startupId);
      if (!input) {
        return undefined;
      }
      return {
        id: input.insightId,
        startupId: input.startupId,
        conditionCode: input.conditionCode,
        evidence: input.evidence,
        explanation: input.explanation,
        generationStatus: input.generationStatus,
        lastError: input.lastError,
        model: input.model,
        explainerLatencyMs: input.explainerLatencyMs,
        generatedAt: input.generatedAt,
        updatedAt: input.generatedAt,
      };
    },
    async updateInsightDiagnostics(
      input: UpdateInsightDiagnosticsInput
    ): Promise<boolean> {
      diagnosticsUpdates.push(input);
      const existing = insights.get(input.startupId);
      if (!existing) {
        return false;
      }
      insights.set(input.startupId, {
        ...existing,
        generationStatus: input.generationStatus,
        lastError: input.lastError,
      });
      return true;
    },
    async checkInsightTableExists(): Promise<boolean> {
      return true;
    },
  };
}

function createStubTaskRepo(
  tasks: Map<string, InternalTaskRow> = new Map()
): InternalTaskRepository & {
  tasks: Map<string, InternalTaskRow>;
  syncingCalls: Array<{ taskId: string; attemptAt: Date }>;
  syncedCalls: Array<{
    taskId: string;
    linearIssueId: string;
    linearIssueUrl: string;
    syncedAt: Date;
  }>;
  failedCalls: Array<{ taskId: string; error: string; attemptAt: Date }>;
} {
  const syncingCalls: Array<{ taskId: string; attemptAt: Date }> = [];
  const syncedCalls: Array<{
    taskId: string;
    linearIssueId: string;
    linearIssueUrl: string;
    syncedAt: Date;
  }> = [];
  const failedCalls: Array<{ taskId: string; error: string; attemptAt: Date }> =
    [];

  return {
    tasks,
    syncingCalls,
    syncedCalls,
    failedCalls,
    async findTask(taskId: string) {
      return tasks.get(taskId);
    },
    async markTaskSyncing(taskId: string, attemptAt: Date) {
      syncingCalls.push({ taskId, attemptAt });
      const task = tasks.get(taskId);
      if (task) {
        task.syncStatus = "syncing";
      }
    },
    async markTaskSynced(input) {
      syncedCalls.push(input);
      const task = tasks.get(input.taskId);
      if (task) {
        task.syncStatus = "synced";
        task.linearIssueId = input.linearIssueId;
      }
    },
    async markTaskSyncFailed(input) {
      failedCalls.push(input);
      const task = tasks.get(input.taskId);
      if (task) {
        task.syncStatus = "failed";
      }
    },
  };
}

// =========================================================================
// Tests
// =========================================================================

// ---------------------------------------------------------------------------
// 1. Worker env parsing
// ---------------------------------------------------------------------------

describe("worker env — founder-proof mode parsing", () => {
  const baseEnv: Record<string, string> = {
    CONNECTOR_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    DATABASE_URL: "postgres://localhost:5432/test",
    REDIS_URL: "redis://localhost:6379",
  };

  test("founderProofMode defaults to false when absent", () => {
    const env = readWorkerEnv(baseEnv);
    expect(env.founderProofMode).toBe(false);
  });

  test("founderProofMode is true when FOUNDER_PROOF_MODE=true", () => {
    const env = readWorkerEnv({ ...baseEnv, FOUNDER_PROOF_MODE: "true" });
    expect(env.founderProofMode).toBe(true);
  });

  test("founderProofMode is true when FOUNDER_PROOF_MODE=1", () => {
    const env = readWorkerEnv({ ...baseEnv, FOUNDER_PROOF_MODE: "1" });
    expect(env.founderProofMode).toBe(true);
  });

  test("founderProofMode is false when FOUNDER_PROOF_MODE=false", () => {
    const env = readWorkerEnv({ ...baseEnv, FOUNDER_PROOF_MODE: "false" });
    expect(env.founderProofMode).toBe(false);
  });

  test("founderProofMode is false when FOUNDER_PROOF_MODE=0", () => {
    const env = readWorkerEnv({ ...baseEnv, FOUNDER_PROOF_MODE: "0" });
    expect(env.founderProofMode).toBe(false);
  });

  test("throws on malformed FOUNDER_PROOF_MODE", () => {
    expect(() =>
      readWorkerEnv({ ...baseEnv, FOUNDER_PROOF_MODE: "yes" })
    ).toThrow("FOUNDER_PROOF_MODE must be one of");
  });

  test('throws on malformed FOUNDER_PROOF_MODE "maybe"', () => {
    expect(() =>
      readWorkerEnv({ ...baseEnv, FOUNDER_PROOF_MODE: "maybe" })
    ).toThrow("FOUNDER_PROOF_MODE must be one of");
  });
});

// ---------------------------------------------------------------------------
// 2. Founder-proof sync router
// ---------------------------------------------------------------------------

describe("founder-proof sync router", () => {
  const syncRouter = createFounderProofSyncRouter();

  test("returns valid PostHog sync result with deterministic metrics", async () => {
    const result = await syncRouter(
      "posthog",
      JSON.stringify(FOUNDER_PROOF_POSTHOG_CONFIG)
    );
    expect(result.valid).toBe(true);
    expect(result.mrr).toBeNull(); // MRR comes from Stripe
    expect(result.supportingMetrics).toBeDefined();
    expect((result.supportingMetrics as any).active_users).toBe(1420);
    expect(result.funnelStages).toBeDefined();
    expect((result.funnelStages as any).visitor).toBe(8500);
    expect((result.funnelStages as any).signup).toBe(620);
    expect((result.funnelStages as any).activation).toBe(248);
  });

  test("returns valid Stripe sync result with deterministic MRR and metrics", async () => {
    const result = await syncRouter(
      "stripe",
      JSON.stringify(FOUNDER_PROOF_STRIPE_CONFIG)
    );
    expect(result.valid).toBe(true);
    expect(result.mrr).toBe(12_400);
    expect(result.supportingMetrics).toBeDefined();
    expect((result.supportingMetrics as any).churn_rate).toBe(3.2);
    expect((result.supportingMetrics as any).arpu).toBe(258.33);
    expect(result.funnelStages).toBeDefined();
    expect((result.funnelStages as any).paying_customer).toBe(48);
  });

  test("returns invalid for unsupported provider", async () => {
    const result = await syncRouter("unknown_provider" as any, "{}");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Unsupported provider");
  });

  test("returns valid postgres result with multi-metric data", async () => {
    const result = await syncRouter(
      "postgres",
      JSON.stringify({ connectionUri: "postgresql://localhost/test" })
    );
    expect(result.valid).toBe(true);
    expect(result.mrr).toBe(9500);
    expect(result.supportingMetrics).toBeDefined();
    const pgResult = result as import("../src/providers").PostgresSyncResult;
    expect(pgResult.customMetrics).toHaveLength(3);
    expect(pgResult.customMetrics[0]?.key).toBe("mrr");
    expect(pgResult.customMetrics[1]?.key).toBe("active_users");
    expect(pgResult.customMetrics[2]?.key).toBe("nps_score");
  });

  test("returns invalid for malformed JSON config", async () => {
    const result = await syncRouter("posthog", "not-json");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Malformed provider config JSON");
  });

  test("PostHog result is idempotent across calls", async () => {
    const r1 = await syncRouter(
      "posthog",
      JSON.stringify(FOUNDER_PROOF_POSTHOG_CONFIG)
    );
    const r2 = await syncRouter(
      "posthog",
      JSON.stringify(FOUNDER_PROOF_POSTHOG_CONFIG)
    );
    expect(r1.mrr).toBe(r2.mrr);
    expect((r1.supportingMetrics as any).active_users).toBe(
      (r2.supportingMetrics as any).active_users
    );
  });

  test("Stripe result is idempotent across calls", async () => {
    const r1 = await syncRouter(
      "stripe",
      JSON.stringify(FOUNDER_PROOF_STRIPE_CONFIG)
    );
    const r2 = await syncRouter(
      "stripe",
      JSON.stringify(FOUNDER_PROOF_STRIPE_CONFIG)
    );
    expect(r1.mrr).toBe(r2.mrr);
    expect((r1.supportingMetrics as any).churn_rate).toBe(
      (r2.supportingMetrics as any).churn_rate
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Founder-proof explainer
// ---------------------------------------------------------------------------

describe("founder-proof explainer", () => {
  const explainer = createFounderProofExplainer();

  test("returns deterministic mrr_declining explanation", async () => {
    const result = await explainer({
      conditionCode: "mrr_declining",
      evidence: {
        conditionCode: "mrr_declining",
        items: [
          {
            metricKey: "mrr",
            label: "MRR",
            currentValue: 5000,
            previousValue: 6000,
            direction: "down",
          },
        ],
        snapshotComputedAt: new Date().toISOString(),
        syncJobId: "sjob-1",
      },
    });

    expect(result.observation).toContain("MRR");
    expect(result.hypothesis).toBeTruthy();
    expect(result.actions.length).toBeGreaterThanOrEqual(1);
    expect(result.model).toBe("founder-proof-deterministic");
    expect(typeof result.latencyMs).toBe("number");
  });

  test("returns deterministic churn_spike explanation", async () => {
    const result = await explainer({
      conditionCode: "churn_spike",
      evidence: {
        conditionCode: "churn_spike",
        items: [
          {
            metricKey: "churn_rate",
            label: "Churn Rate",
            currentValue: 15,
            previousValue: 5,
            direction: "up",
          },
        ],
        snapshotComputedAt: new Date().toISOString(),
        syncJobId: "sjob-1",
      },
    });

    expect(result.observation).toContain("Churn");
    expect(result.actions.length).toBeGreaterThanOrEqual(1);
    expect(result.model).toBe("founder-proof-deterministic");
  });

  test("returns deterministic no_condition_detected explanation", async () => {
    const result = await explainer({
      conditionCode: "no_condition_detected",
      evidence: {
        conditionCode: "no_condition_detected",
        items: [
          {
            metricKey: "mrr",
            label: "MRR",
            currentValue: 5000,
            previousValue: 5000,
            direction: "flat",
          },
        ],
        snapshotComputedAt: new Date().toISOString(),
        syncJobId: "sjob-1",
      },
    });

    expect(result.observation).toContain("normal");
    expect(result.model).toBe("founder-proof-deterministic");
  });

  test("each action has label and rationale", async () => {
    const result = await explainer({
      conditionCode: "mrr_declining",
      evidence: {
        conditionCode: "mrr_declining",
        items: [
          {
            metricKey: "mrr",
            label: "MRR",
            currentValue: 5000,
            previousValue: 6000,
            direction: "down",
          },
        ],
        snapshotComputedAt: new Date().toISOString(),
        syncJobId: "sjob-1",
      },
    });

    for (const action of result.actions) {
      expect(typeof action.label).toBe("string");
      expect(action.label.length).toBeGreaterThan(0);
      expect(typeof action.rationale).toBe("string");
      expect(action.rationale.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Founder-proof Linear client
// ---------------------------------------------------------------------------

describe("founder-proof Linear client", () => {
  const client = createFounderProofLinearClient();
  const task = makeTaskRow();

  test("returns success with deterministic issue ID and URL", async () => {
    const result = await client(task, "team-123");

    expect(result.success).toBe(true);
    expect(result.issueId).toBe("FP-task-1");
    expect(result.issueUrl).toBe(
      "https://linear.app/founder-proof/issue/FP-task-1"
    );
  });

  test("issue ID is derived from task ID for idempotency", async () => {
    const r1 = await client(task, "team-a");
    const r2 = await client(task, "team-b");

    expect(r1.issueId).toBe(r2.issueId);
    expect(r1.issueUrl).toBe(r2.issueUrl);
  });

  test("different tasks get different issue IDs", async () => {
    const task2 = makeTaskRow({ id: "task-2" });
    const r1 = await client(task, "team-1");
    const r2 = await client(task2, "team-1");

    expect(r1.issueId).not.toBe(r2.issueId);
  });
});

// ---------------------------------------------------------------------------
// 5. Full proof-mode connector sync → snapshot → insight pipeline
// ---------------------------------------------------------------------------

describe("proof-mode full sync pipeline", () => {
  test("Stripe sync writes a ready health snapshot with MRR", async () => {
    const stripeRow = makeConnectorRow("stripe", FOUNDER_PROOF_STRIPE_CONFIG);
    const repo = createInMemoryRepo(stripeRow);
    const healthRepo = createInMemoryHealthRepo();
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createFounderProofExplainer();

    const processor = createSyncProcessor({
      repo,
      encryptionKey: TEST_ENCRYPTION_KEY,
      validateProvider: createFounderProofSyncRouter(),
      log: silentLog(),
      healthRepo,
      insightRepo,
      explainer,
    });

    await processor(
      makeJob(
        makePayload({
          connectorId: stripeRow.id,
          provider: "stripe",
        })
      )
    );

    // Snapshot was written
    expect(healthRepo.snapshots.size).toBe(1);
    const snapshot = requireValue(
      healthRepo.snapshots.get("startup-1"),
      "Expected founder-proof snapshot to be written."
    );
    expect(snapshot.healthState).toBe("ready");
    expect(snapshot.northStarValue).toBe(12_400);
    expect(snapshot.northStarKey).toBe("mrr");

    // Sync job was marked completed
    const completedOp = repo.mutations.find(
      (m) => m.op === "markSyncJobCompleted"
    );
    expect(completedOp).toBeDefined();
  });

  test("PostHog sync writes a ready snapshot (MRR from carry-forward)", async () => {
    const posthogRow = makeConnectorRow(
      "posthog",
      FOUNDER_PROOF_POSTHOG_CONFIG
    );
    const repo = createInMemoryRepo(posthogRow);
    const healthRepo = createInMemoryHealthRepo();

    const processor = createSyncProcessor({
      repo,
      encryptionKey: TEST_ENCRYPTION_KEY,
      validateProvider: createFounderProofSyncRouter(),
      log: silentLog(),
      healthRepo,
    });

    await processor(
      makeJob(
        makePayload({
          connectorId: posthogRow.id,
          provider: "posthog",
        })
      )
    );

    expect(healthRepo.snapshots.size).toBe(1);
    const snapshot = requireValue(
      healthRepo.snapshots.get("startup-1"),
      "Expected founder-proof PostHog snapshot to be written."
    );
    expect(snapshot.healthState).toBe("ready");
    // PostHog doesn't set MRR — it defaults to 0 from carry-forward
    expect(snapshot.northStarValue).toBe(0);
  });

  test("Stripe sync + explainer produces a deterministic insight", async () => {
    const stripeRow = makeConnectorRow("stripe", FOUNDER_PROOF_STRIPE_CONFIG);
    const repo = createInMemoryRepo(stripeRow);

    // Pre-seed a previous snapshot with higher MRR so the pipeline detects
    // mrr_declining (12400 current vs 14000 previous = -11.4%, above 5% threshold)
    const healthRepo = createInMemoryHealthRepo({
      id: "prev-snap",
      startupId: "startup-1",
      healthState: "ready",
      blockedReason: null,
      northStarKey: "mrr",
      northStarValue: 14_000,
      northStarPreviousValue: null,
      supportingMetrics: {},
      syncJobId: "sjob-prev",
      computedAt: new Date(Date.now() - 86_400_000),
    });
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createFounderProofExplainer();

    const processor = createSyncProcessor({
      repo,
      encryptionKey: TEST_ENCRYPTION_KEY,
      validateProvider: createFounderProofSyncRouter(),
      log: silentLog(),
      healthRepo,
      insightRepo,
      explainer,
    });

    await processor(
      makeJob(
        makePayload({
          connectorId: stripeRow.id,
          provider: "stripe",
        })
      )
    );

    // Insight was generated
    expect(insightRepo.insights.size).toBe(1);
    const insight = requireValue(
      insightRepo.insights.get("startup-1"),
      "Expected founder-proof insight to be written."
    );
    expect(insight.generationStatus).toBe("success");
    expect(insight.model).toBe("founder-proof-deterministic");
    expect(insight.explanation).toBeDefined();
    const explanation = insight.explanation as InsightExplanation;
    expect(explanation.observation.length).toBeGreaterThan(0);
    expect(explanation.hypothesis.length).toBeGreaterThan(0);
    expect(explanation.actions.length).toBeGreaterThanOrEqual(1);
  });

  test("repeated Stripe sync produces identical snapshot values", async () => {
    const stripeRow = makeConnectorRow("stripe", FOUNDER_PROOF_STRIPE_CONFIG);
    const healthRepo = createInMemoryHealthRepo();

    for (let i = 0; i < 3; i++) {
      const repo = createInMemoryRepo(stripeRow);
      const processor = createSyncProcessor({
        repo,
        encryptionKey: TEST_ENCRYPTION_KEY,
        validateProvider: createFounderProofSyncRouter(),
        log: silentLog(),
        healthRepo,
      });

      await processor(
        makeJob(
          makePayload({
            connectorId: stripeRow.id,
            provider: "stripe",
            syncJobId: `sjob-${i}`,
          })
        )
      );
    }

    // All syncs should produce the same MRR
    const snapshot = requireValue(
      healthRepo.snapshots.get("startup-1"),
      "Expected repeated founder-proof syncs to leave a snapshot."
    );
    expect(snapshot.northStarValue).toBe(12_400);
  });
});

// ---------------------------------------------------------------------------
// 6. Proof-mode task sync reaches synced status
// ---------------------------------------------------------------------------

describe("proof-mode task sync", () => {
  test("task reaches synced with deterministic external reference", async () => {
    const taskRepo = createStubTaskRepo(new Map([["task-1", makeTaskRow()]]));
    const log = capturingLog();

    const processor = createTaskSyncProcessor({
      taskRepo,
      createLinearIssue: createFounderProofLinearClient(),
      linearTeamId: "founder-proof-team",
      log,
    });

    await processor(makeTaskJob({ taskId: "task-1" }));

    expect(taskRepo.syncedCalls).toHaveLength(1);
    expect(taskRepo.syncedCalls[0]?.linearIssueId).toBe("FP-task-1");
    expect(taskRepo.syncedCalls[0]?.linearIssueUrl).toBe(
      "https://linear.app/founder-proof/issue/FP-task-1"
    );
    expect(taskRepo.failedCalls).toHaveLength(0);

    // Task status in repository is synced
    const task = requireValue(
      taskRepo.tasks.get("task-1"),
      "Expected synced task to remain in the repository."
    );
    expect(task.syncStatus).toBe("synced");
    expect(task.linearIssueId).toBe("FP-task-1");
  });

  test("already-synced task is skipped in proof mode", async () => {
    const taskRepo = createStubTaskRepo(
      new Map([
        [
          "task-1",
          makeTaskRow({ syncStatus: "synced", linearIssueId: "FP-task-1" }),
        ],
      ])
    );

    const processor = createTaskSyncProcessor({
      taskRepo,
      createLinearIssue: createFounderProofLinearClient(),
      linearTeamId: "founder-proof-team",
      log: silentLog(),
    });

    await processor(makeTaskJob({ taskId: "task-1" }));

    expect(taskRepo.syncingCalls).toHaveLength(0);
    expect(taskRepo.syncedCalls).toHaveLength(0);
  });

  test("duplicate task sync is idempotent", async () => {
    const taskRepo = createStubTaskRepo(new Map([["task-1", makeTaskRow()]]));

    const processor = createTaskSyncProcessor({
      taskRepo,
      createLinearIssue: createFounderProofLinearClient(),
      linearTeamId: "founder-proof-team",
      log: silentLog(),
    });

    // First sync
    await processor(makeTaskJob({ taskId: "task-1" }));
    expect(taskRepo.syncedCalls).toHaveLength(1);

    // Second sync — skipped because already synced
    await processor(makeTaskJob({ taskId: "task-1" }));
    expect(taskRepo.syncedCalls).toHaveLength(1); // still 1
  });

  test("missing task is handled gracefully", async () => {
    const taskRepo = createStubTaskRepo(new Map());
    const log = capturingLog();

    const processor = createTaskSyncProcessor({
      taskRepo,
      createLinearIssue: createFounderProofLinearClient(),
      linearTeamId: "founder-proof-team",
      log,
    });

    await processor(makeTaskJob({ taskId: "nonexistent" }));

    expect(taskRepo.syncedCalls).toHaveLength(0);
    const errorLog = log.entries.find(
      (e) => e.msg === "task not found — may have been deleted"
    );
    expect(errorLog).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Non-proof runtime still disables delivery without keys
// ---------------------------------------------------------------------------

describe("non-proof runtime with absent keys", () => {
  test("env parsing produces null keys when Anthropic/Linear are absent", () => {
    const env = readWorkerEnv({
      CONNECTOR_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      DATABASE_URL: "postgres://localhost:5432/test",
      REDIS_URL: "redis://localhost:6379",
    });

    expect(env.founderProofMode).toBe(false);
    expect(env.anthropicApiKey).toBeNull();
    expect(env.linearApiKey).toBeNull();
    expect(env.linearTeamId).toBeNull();
  });

  test("explainer is not available when Anthropic key is absent and proof mode is off", () => {
    // This mirrors the logic in index.ts:
    // const explainer = env.founderProofMode ? createFounderProofExplainer()
    //   : env.anthropicApiKey ? createAnthropicExplainer(env.anthropicApiKey)
    //   : undefined;
    const env = readWorkerEnv({
      CONNECTOR_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    });

    let explainer: ReturnType<typeof createFounderProofExplainer> | undefined;
    if (env.founderProofMode) {
      explainer = createFounderProofExplainer();
    }

    expect(explainer).toBeUndefined();
  });

  test("task sync is not enabled when Linear keys are absent and proof mode is off", () => {
    const env = readWorkerEnv({
      CONNECTOR_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    });

    const shouldEnableTaskSync =
      env.founderProofMode ||
      (env.linearApiKey !== null && env.linearTeamId !== null);
    expect(shouldEnableTaskSync).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Negative tests — malformed inputs and error paths
// ---------------------------------------------------------------------------

describe("negative tests", () => {
  test("malformed founder-proof env value throws at parse time", () => {
    expect(() =>
      readWorkerEnv({
        CONNECTOR_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
        FOUNDER_PROOF_MODE: "enabled",
      })
    ).toThrow("FOUNDER_PROOF_MODE must be one of");
  });

  test("founder-proof sync router rejects malformed JSON", async () => {
    const router = createFounderProofSyncRouter();
    const result = await router("posthog", "{bad json");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Malformed");
  });

  test("task sync with empty taskId is dropped gracefully", async () => {
    const taskRepo = createStubTaskRepo(new Map());
    const log = capturingLog();

    const processor = createTaskSyncProcessor({
      taskRepo,
      createLinearIssue: createFounderProofLinearClient(),
      linearTeamId: "founder-proof-team",
      log,
    });

    await processor(makeTaskJob({ taskId: "" }));

    const errorLog = log.entries.find(
      (e) => e.msg === "task sync job missing taskId — dropping"
    );
    expect(errorLog).toBeDefined();
  });

  test("connector sync job failure before snapshot recompute does not leave stale data", async () => {
    // Connector not found — sync fails before any snapshot write
    const repo = createInMemoryRepo(undefined); // no connector
    const healthRepo = createInMemoryHealthRepo();

    const processor = createSyncProcessor({
      repo,
      encryptionKey: TEST_ENCRYPTION_KEY,
      validateProvider: createFounderProofSyncRouter(),
      log: silentLog(),
      healthRepo,
    });

    await expect(processor(makeJob(makePayload()))).rejects.toThrow(
      "not found"
    );

    // No snapshot was written
    expect(healthRepo.snapshots.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Observability — log messages
// ---------------------------------------------------------------------------

describe("observability", () => {
  test("proof-mode sync processor logs completion", async () => {
    const stripeRow = makeConnectorRow("stripe", FOUNDER_PROOF_STRIPE_CONFIG);
    const repo = createInMemoryRepo(stripeRow);
    const healthRepo = createInMemoryHealthRepo();
    const log = capturingLog();

    const processor = createSyncProcessor({
      repo,
      encryptionKey: TEST_ENCRYPTION_KEY,
      validateProvider: createFounderProofSyncRouter(),
      log,
      healthRepo,
    });

    await processor(
      makeJob(
        makePayload({
          connectorId: stripeRow.id,
          provider: "stripe",
        })
      )
    );

    const completedLog = log.entries.find(
      (e) => e.msg === "sync job completed"
    );
    expect(completedLog).toBeDefined();
    expect(typeof completedLog?.meta?.durationMs).toBe("number");

    const snapshotLog = log.entries.find(
      (e) => e.msg === "health snapshot recomputed"
    );
    expect(snapshotLog).toBeDefined();
    expect(snapshotLog?.meta?.healthState).toBe("ready");
  });

  test("proof-mode task sync logs synced with issue reference", async () => {
    const taskRepo = createStubTaskRepo(new Map([["task-1", makeTaskRow()]]));
    const log = capturingLog();

    const processor = createTaskSyncProcessor({
      taskRepo,
      createLinearIssue: createFounderProofLinearClient(),
      linearTeamId: "founder-proof-team",
      log,
    });

    await processor(makeTaskJob({ taskId: "task-1" }));

    const syncedLog = log.entries.find(
      (e) => e.msg === "task synced to Linear"
    );
    expect(syncedLog).toBeDefined();
    expect(syncedLog?.meta?.linearIssueId).toBe("FP-task-1");
  });
});
