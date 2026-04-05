// Insight generation worker tests.
// Tests the insight-generation pipeline with in-memory stubs:
// condition detection, explainer integration, persist flow,
// preserve-last-good semantics, and failure paths.
// No Redis, Postgres, or Anthropic API required.

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { FunnelStageRow } from "@shared/startup-health";
import type {
  EvidencePacket,
  InsightExplanation,
} from "@shared/startup-insight";
import {
  validateEvidencePacket,
  validateInsightExplanation,
} from "@shared/startup-insight";
import type { UniversalMetrics } from "@shared/universal-metrics";
import type { InsightGenerationDeps } from "../src/insights";
import {
  createFailingExplainer,
  createStubExplainer,
  detectCondition,
  generateInsight,
} from "../src/insights";
import type {
  HealthSnapshotRepository,
  HealthSnapshotRow,
  InsightRepository,
  InsightRow,
  ReplaceInsightInput,
  ReplaceSnapshotInput,
  UpdateInsightDiagnosticsInput,
} from "../src/repository";

// ---------- In-memory stubs ----------

function makeSnapshot(
  overrides: Partial<HealthSnapshotRow> = {}
): HealthSnapshotRow {
  return {
    id: randomUUID(),
    startupId: "startup-1",
    healthState: "ready",
    blockedReason: null,
    northStarKey: "mrr",
    northStarValue: 5000,
    northStarPreviousValue: 6000,
    supportingMetrics: {},
    syncJobId: "sync-1",
    computedAt: new Date(),
    ...overrides,
  };
}

function makeMetrics(
  overrides: Partial<UniversalMetrics> = {}
): UniversalMetrics {
  return {
    ...overrides,
  };
}

function createInMemoryHealthRepo(
  snapshot?: HealthSnapshotRow
): HealthSnapshotRepository & { snapshot: HealthSnapshotRow | undefined } {
  const repo: HealthSnapshotRepository & {
    snapshot: HealthSnapshotRow | undefined;
  } = {
    snapshot,
    async replaceSnapshot(input: ReplaceSnapshotInput): Promise<void> {
      repo.snapshot = {
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
    async findSnapshot(
      startupId: string
    ): Promise<HealthSnapshotRow | undefined> {
      if (repo.snapshot && repo.snapshot.startupId === startupId) {
        return repo.snapshot;
      }
      return undefined;
    },
    async findFunnelStages(_startupId: string): Promise<FunnelStageRow[]> {
      return [];
    },
    async checkHealthTablesExist(): Promise<{
      snapshotReady: boolean;
      funnelReady: boolean;
    }> {
      return { snapshotReady: true, funnelReady: true };
    },
  };
  return repo;
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
      // Update diagnostics only, preserving evidence/explanation
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

function createTestLog() {
  const entries: Array<{
    level: string;
    msg: string;
    meta?: Record<string, unknown>;
  }> = [];
  return {
    entries,
    info(msg: string, meta?: Record<string, unknown>) {
      entries.push({ level: "info", msg, meta });
    },
    warn(msg: string, meta?: Record<string, unknown>) {
      entries.push({ level: "warn", msg, meta });
    },
    error(msg: string, meta?: Record<string, unknown>) {
      entries.push({ level: "error", msg, meta });
    },
  };
}

function _makeDeps(
  overrides: Partial<InsightGenerationDeps> = {}
): InsightGenerationDeps {
  return {
    healthRepo: overrides.healthRepo ?? createInMemoryHealthRepo(),
    insightRepo: overrides.insightRepo ?? createInMemoryInsightRepo(),
    explainer: overrides.explainer ?? createStubExplainer(),
    log: overrides.log ?? createTestLog(),
  };
}

// ============================================================================
// 1. Condition Detection — Deterministic
// ============================================================================

describe("detectCondition", () => {
  test("detects mrr_declining when MRR drops >= 5%", () => {
    const snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const metrics = makeMetrics();
    const result = detectCondition({
      snapshot,
      supportingMetrics: metrics,
      healthState: "ready",
    });

    expect(result.conditionCode).toBe("mrr_declining");
    expect(result.evidence.conditionCode).toBe("mrr_declining");
    expect(result.evidence.items.length).toBeGreaterThanOrEqual(1);
    expect(result.evidence.items[0]?.metricKey).toBe("mrr");
    expect(result.evidence.items[0]?.direction).toBe("down");
  });

  test("includes churn evidence when churn_rate > 5% alongside MRR decline", () => {
    const snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const metrics = makeMetrics({ churn_rate: 8 });
    const result = detectCondition({
      snapshot,
      supportingMetrics: metrics,
      healthState: "ready",
    });

    expect(result.conditionCode).toBe("mrr_declining");
    expect(result.evidence.items.length).toBe(2);
    expect(result.evidence.items[1]?.metricKey).toBe("churn_rate");
  });

  test("detects churn_spike when churn_rate > 10%", () => {
    const snapshot = makeSnapshot({
      northStarValue: 5000,
      northStarPreviousValue: 5000,
    });
    const metrics = makeMetrics({ churn_rate: 12 });
    const result = detectCondition({
      snapshot,
      supportingMetrics: metrics,
      healthState: "ready",
    });

    expect(result.conditionCode).toBe("churn_spike");
    expect(
      result.evidence.items.some((i) => i.metricKey === "churn_rate")
    ).toBe(true);
  });

  test("returns no_condition_detected when metrics are healthy and no MRR decline", () => {
    const snapshot = makeSnapshot({
      northStarValue: 5000,
      northStarPreviousValue: 5000,
    });
    const metrics = makeMetrics({
      growth_rate: 18,
    });
    const result = detectCondition({
      snapshot,
      supportingMetrics: metrics,
      healthState: "ready",
    });

    expect(result.conditionCode).toBe("no_condition_detected");
    expect(result.evidence.items.length).toBeGreaterThanOrEqual(1);
  });

  test("returns no_condition_detected when all metrics are healthy", () => {
    const snapshot = makeSnapshot({
      northStarValue: 5100,
      northStarPreviousValue: 5000,
    });
    const metrics = makeMetrics({
      churn_rate: 3,
      growth_rate: 25,
    });
    const result = detectCondition({
      snapshot,
      supportingMetrics: metrics,
      healthState: "ready",
    });

    expect(result.conditionCode).toBe("no_condition_detected");
    expect(result.evidence.items.length).toBeGreaterThanOrEqual(1);
  });

  test("prioritizes mrr_declining over churn_spike", () => {
    const snapshot = makeSnapshot({
      northStarValue: 4000,
      northStarPreviousValue: 5000,
    });
    const metrics = makeMetrics({ churn_rate: 15 });
    const result = detectCondition({
      snapshot,
      supportingMetrics: metrics,
      healthState: "ready",
    });

    expect(result.conditionCode).toBe("mrr_declining");
  });

  test("evidence packet validates cleanly for all condition codes", () => {
    const cases: Array<{
      mrr: number;
      prevMrr: number | null;
      metrics: Partial<UniversalMetrics>;
    }> = [
      { mrr: 4000, prevMrr: 5000, metrics: {} }, // mrr_declining
      {
        mrr: 5000,
        prevMrr: 5000,
        metrics: { churn_rate: 15 },
      }, // churn_spike
      {
        mrr: 5000,
        prevMrr: 5000,
        metrics: { growth_rate: 18 },
      }, // no_condition (healthy growth)
      { mrr: 5000, prevMrr: 5000, metrics: {} }, // no_condition
    ];

    for (const c of cases) {
      const snapshot = makeSnapshot({
        northStarValue: c.mrr,
        northStarPreviousValue: c.prevMrr,
      });
      const metrics = makeMetrics(c.metrics);
      const result = detectCondition({
        snapshot,
        supportingMetrics: metrics,
        healthState: "ready",
      });
      const err = validateEvidencePacket(result.evidence);
      expect(err).toBeNull();
    }
  });

  test("does not detect mrr_declining when previous MRR is null", () => {
    const snapshot = makeSnapshot({
      northStarValue: 100,
      northStarPreviousValue: null,
    });
    const metrics = makeMetrics();
    const result = detectCondition({
      snapshot,
      supportingMetrics: metrics,
      healthState: "ready",
    });

    expect(result.conditionCode).toBe("no_condition_detected");
  });

  test("does not detect mrr_declining when decline is < 5%", () => {
    const snapshot = makeSnapshot({
      northStarValue: 4800,
      northStarPreviousValue: 5000,
    });
    const metrics = makeMetrics();
    const result = detectCondition({
      snapshot,
      supportingMetrics: metrics,
      healthState: "ready",
    });

    expect(result.conditionCode).toBe("no_condition_detected");
  });
});

// ============================================================================
// 2. Explainer Stubs
// ============================================================================

describe("explainer stubs", () => {
  test("stub explainer returns predictable output", async () => {
    const explainer = createStubExplainer();
    const evidence: EvidencePacket = {
      conditionCode: "mrr_declining",
      items: [
        {
          metricKey: "mrr",
          label: "MRR",
          currentValue: 4000,
          previousValue: 5000,
          direction: "down",
        },
      ],
      snapshotComputedAt: new Date().toISOString(),
      syncJobId: "sync-1",
    };

    const result = await explainer({
      conditionCode: "mrr_declining",
      evidence,
    });

    expect(result.observation).toContain("mrr_declining");
    expect(result.hypothesis).toBeTruthy();
    expect(result.actions.length).toBeGreaterThanOrEqual(1);
    expect(result.actions.length).toBeLessThanOrEqual(3);
    expect(result.model).toBe("stub-model");
    expect(explainer.calls.length).toBe(1);
  });

  test("stub explainer validates as a valid InsightExplanation", async () => {
    const explainer = createStubExplainer();
    const evidence: EvidencePacket = {
      conditionCode: "churn_spike",
      items: [
        {
          metricKey: "churn_rate",
          label: "Churn",
          currentValue: 15,
          previousValue: 3,
          direction: "up",
        },
      ],
      snapshotComputedAt: new Date().toISOString(),
      syncJobId: null,
    };

    const result = await explainer({ conditionCode: "churn_spike", evidence });
    const explanation: InsightExplanation = {
      ...result,
    };
    expect(validateInsightExplanation(explanation)).toBeNull();
  });

  test("failing explainer throws configured error", async () => {
    const explainer = createFailingExplainer("API down");
    const evidence: EvidencePacket = {
      conditionCode: "mrr_declining",
      items: [
        {
          metricKey: "mrr",
          label: "MRR",
          currentValue: 4000,
          previousValue: 5000,
          direction: "down",
        },
      ],
      snapshotComputedAt: new Date().toISOString(),
      syncJobId: null,
    };

    await expect(
      explainer({ conditionCode: "mrr_declining", evidence })
    ).rejects.toThrow("API down");
    expect(explainer.calls.length).toBe(1);
  });

  test("failing explainer can be retryable", async () => {
    const explainer = createFailingExplainer("Rate limited", {
      retryable: true,
    });
    const evidence: EvidencePacket = {
      conditionCode: "mrr_declining",
      items: [
        {
          metricKey: "mrr",
          label: "MRR",
          currentValue: 4000,
          previousValue: 5000,
          direction: "down",
        },
      ],
      snapshotComputedAt: new Date().toISOString(),
      syncJobId: null,
    };

    try {
      await explainer({ conditionCode: "mrr_declining", evidence });
    } catch (err) {
      expect((err as Error & { retryable?: boolean }).retryable).toBe(true);
    }
  });
});

// ============================================================================
// 3. Full Pipeline — Successful Generation
// ============================================================================

describe("generateInsight — successful generation", () => {
  test("generates insight from MRR-declining snapshot", async () => {
    const snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer();
    const log = createTestLog();

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(true);
    expect(result.conditionCode).toBe("mrr_declining");
    expect(result.status).toBe("success");

    // Verify insight was persisted
    const persisted = insightRepo.insights.get("startup-1");
    expect(persisted).toBeDefined();
    expect(persisted?.conditionCode).toBe("mrr_declining");
    expect(persisted?.explanation).not.toBeNull();
    expect(persisted?.generationStatus).toBe("success");
    expect(persisted?.lastError).toBeNull();
  });

  test("explainer receives the correct evidence", async () => {
    const snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer();
    const log = createTestLog();

    await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(explainer.calls.length).toBe(1);
    expect(explainer.calls[0]?.conditionCode).toBe("mrr_declining");
    expect(explainer.calls[0]?.evidence.conditionCode).toBe("mrr_declining");
    expect(explainer.calls[0]?.evidence.items[0]?.metricKey).toBe("mrr");
  });

  test("subsequent generation replaces previous insight", async () => {
    const snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer();
    const log = createTestLog();

    await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );
    const firstInsight = insightRepo.insights.get("startup-1");
    const firstId = firstInsight?.insightId;

    // Second generation with a different snapshot
    healthRepo.snapshot = makeSnapshot({
      northStarValue: 4000,
      northStarPreviousValue: 4500,
      startupId: "startup-1",
    });

    await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-2"
    );
    const secondInsight = insightRepo.insights.get("startup-1");
    expect(secondInsight?.insightId).not.toBe(firstId);
    expect(secondInsight?.conditionCode).toBe("mrr_declining");
  });

  test("logs insight generation start and completion with metadata", async () => {
    const snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer();
    const log = createTestLog();

    await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    const startLog = log.entries.find(
      (e) => e.msg === "insight generation started"
    );
    expect(startLog).toBeDefined();
    expect(startLog?.meta?.startupId).toBe("startup-1");

    const completeLog = log.entries.find(
      (e) => e.msg === "insight generation completed"
    );
    expect(completeLog).toBeDefined();
    expect(completeLog?.meta?.conditionCode).toBe("mrr_declining");
    expect(completeLog?.meta?.model).toBe("stub-model");
    expect(typeof completeLog?.meta?.explainerLatencyMs).toBe("number");
    expect(typeof completeLog?.meta?.totalLatencyMs).toBe("number");
  });
});

// ============================================================================
// 4. Skipped Generation — Untrusted Data
// ============================================================================

describe("generateInsight — skipped generation", () => {
  test("skips when no health snapshot exists", async () => {
    const healthRepo = createInMemoryHealthRepo(undefined);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer();
    const log = createTestLog();

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.status).toBe("skipped_stale");
    expect(explainer.calls.length).toBe(0);
  });

  test("skips when connector is blocked", async () => {
    const snapshot = makeSnapshot({
      healthState: "blocked",
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer();
    const log = createTestLog();

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.status).toBe("skipped_blocked");
    expect(explainer.calls.length).toBe(0);
  });

  test("skips when connector is in error state", async () => {
    const snapshot = makeSnapshot({
      healthState: "error",
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer();
    const log = createTestLog();

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.status).toBe("skipped_stale");
    expect(explainer.calls.length).toBe(0);
  });

  test("persists no-condition insight when metrics are healthy", async () => {
    const snapshot = makeSnapshot({
      northStarValue: 5100,
      northStarPreviousValue: 5000,
      supportingMetrics: makeMetrics({
        churn_rate: 2,
        growth_rate: 30,
      }),
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer();
    const log = createTestLog();

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.conditionCode).toBe("no_condition_detected");
    expect(result.status).toBe("skipped_no_condition");
    expect(explainer.calls.length).toBe(0);

    // Evidence-only insight persisted
    const persisted = insightRepo.insights.get("startup-1");
    expect(persisted).toBeDefined();
    expect(persisted?.conditionCode).toBe("no_condition_detected");
    expect(persisted?.explanation).toBeNull();
    expect(persisted?.generationStatus).toBe("skipped_no_condition");
  });

  test("updates diagnostics when connector is blocked and prior insight exists", async () => {
    const snapshot = makeSnapshot({ healthState: "blocked" });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer();
    const log = createTestLog();

    // Pre-seed an existing insight
    await insightRepo.replaceInsight({
      insightId: randomUUID(),
      startupId: "startup-1",
      conditionCode: "mrr_declining",
      evidence: {
        conditionCode: "mrr_declining",
        items: [
          {
            metricKey: "mrr",
            label: "MRR",
            currentValue: 4000,
            previousValue: 5000,
            direction: "down",
          },
        ],
        snapshotComputedAt: new Date().toISOString(),
        syncJobId: null,
      },
      explanation: {
        observation: "MRR is declining.",
        hypothesis: "Churn may be increasing.",
        actions: [
          { label: "Review churn", rationale: "Understand root cause." },
        ],
        model: "stub-model",
        latencyMs: 42,
      },
      generationStatus: "success",
      lastError: null,
      model: "stub-model",
      explainerLatencyMs: 42,
      generatedAt: new Date(),
    });

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.status).toBe("skipped_blocked");

    // Original explanation preserved
    const persisted = insightRepo.insights.get("startup-1");
    expect(persisted).toBeDefined();
    expect(persisted?.explanation).not.toBeNull();
    expect(persisted?.generationStatus).toBe("skipped_blocked");

    // Diagnostics update was recorded
    expect(insightRepo.diagnosticsUpdates.length).toBe(1);
    expect(insightRepo.diagnosticsUpdates[0]?.generationStatus).toBe(
      "skipped_blocked"
    );
  });
});

// ============================================================================
// 5. Explainer Failures — Preserve Last Good
// ============================================================================

describe("generateInsight — explainer failures", () => {
  test("preserves last good insight when explainer throws", async () => {
    const snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const log = createTestLog();

    // Pre-seed a good insight
    await insightRepo.replaceInsight({
      insightId: randomUUID(),
      startupId: "startup-1",
      conditionCode: "mrr_declining",
      evidence: {
        conditionCode: "mrr_declining",
        items: [
          {
            metricKey: "mrr",
            label: "MRR",
            currentValue: 4500,
            previousValue: 5000,
            direction: "down",
          },
        ],
        snapshotComputedAt: new Date().toISOString(),
        syncJobId: null,
      },
      explanation: {
        observation: "MRR is declining.",
        hypothesis: "Churn is increasing.",
        actions: [{ label: "Review churn", rationale: "Root cause analysis." }],
        model: "stub-model",
        latencyMs: 42,
      },
      generationStatus: "success",
      lastError: null,
      model: "stub-model",
      explainerLatencyMs: 42,
      generatedAt: new Date(),
    });

    const failingExplainer = createFailingExplainer(
      "Anthropic rate limit exceeded"
    );

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer: failingExplainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.status).toBe("failed_explainer");
    expect(result.error).toContain("rate limit");

    // Explanation is preserved from the previous good insight
    const persisted = insightRepo.insights.get("startup-1");
    expect(persisted).toBeDefined();
    expect(persisted?.explanation).not.toBeNull();
    expect(persisted?.generationStatus).toBe("failed_explainer");
    expect(persisted?.lastError).toContain("rate limit");
  });

  test("handles retryable explainer errors without wiping prior insight", async () => {
    const snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const log = createTestLog();

    // Pre-seed
    await insightRepo.replaceInsight({
      insightId: randomUUID(),
      startupId: "startup-1",
      conditionCode: "mrr_declining",
      evidence: {
        conditionCode: "mrr_declining",
        items: [
          {
            metricKey: "mrr",
            label: "MRR",
            currentValue: 4500,
            previousValue: 5000,
            direction: "down",
          },
        ],
        snapshotComputedAt: new Date().toISOString(),
        syncJobId: null,
      },
      explanation: {
        observation: "MRR declining.",
        hypothesis: "Churn.",
        actions: [{ label: "Check churn", rationale: "Investigation." }],
        model: "stub-model",
        latencyMs: 42,
      },
      generationStatus: "success",
      lastError: null,
      model: "stub-model",
      explainerLatencyMs: 42,
      generatedAt: new Date(),
    });

    const failingExplainer = createFailingExplainer("Server error", {
      retryable: true,
    });

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer: failingExplainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.status).toBe("failed_explainer");

    const persisted = insightRepo.insights.get("startup-1");
    expect(persisted?.explanation).not.toBeNull();
  });

  test("first insight with explainer failure records diagnostics only", async () => {
    const snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const failingExplainer = createFailingExplainer("Connection refused");
    const log = createTestLog();

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer: failingExplainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.status).toBe("failed_explainer");

    // No existing insight to preserve — diagnostics update returns false
    expect(insightRepo.diagnosticsUpdates.length).toBe(1);
  });
});

// ============================================================================
// 6. Malformed Explainer Output Rejection
// ============================================================================

describe("generateInsight — malformed explainer output", () => {
  test("rejects explainer response with empty observation", async () => {
    const snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer({ observation: "" });
    const log = createTestLog();

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.status).toBe("failed_explainer");
    expect(result.error).toContain("observation");
  });

  test("rejects explainer response with too many actions", async () => {
    const snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer({
      actions: [
        { label: "Action 1", rationale: "R1" },
        { label: "Action 2", rationale: "R2" },
        { label: "Action 3", rationale: "R3" },
        { label: "Action 4", rationale: "R4" },
      ],
    });
    const log = createTestLog();

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.status).toBe("failed_explainer");
    expect(result.error).toContain("actions");
  });

  test("rejects explainer response with zero actions", async () => {
    const snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer({ actions: [] });
    const log = createTestLog();

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.status).toBe("failed_explainer");
  });

  test("rejects explainer response with action missing label", async () => {
    const snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer({
      actions: [{ label: "", rationale: "Something" }],
    });
    const log = createTestLog();

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.status).toBe("failed_explainer");
  });

  test("rejects explainer response with empty hypothesis", async () => {
    const snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer({ hypothesis: "" });
    const log = createTestLog();

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.status).toBe("failed_explainer");
    expect(result.error).toContain("hypothesis");
  });
});

// ============================================================================
// 7. Persistence Failure — Preserve Last Good
// ============================================================================

describe("generateInsight — persistence failure", () => {
  test("records failed_persistence when insight write throws", async () => {
    const snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
    });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer();
    const log = createTestLog();

    // Override replaceInsight to throw
    const _originalReplace = insightRepo.replaceInsight.bind(insightRepo);
    let _callCount = 0;
    insightRepo.replaceInsight = async (
      _input: ReplaceInsightInput
    ): Promise<void> => {
      _callCount++;
      throw new Error("Postgres connection lost");
    };

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.status).toBe("failed_persistence");
    expect(result.error).toContain("Postgres connection lost");

    // Diagnostics update was attempted
    expect(insightRepo.diagnosticsUpdates.length).toBe(1);
    expect(insightRepo.diagnosticsUpdates[0]?.generationStatus).toBe(
      "failed_persistence"
    );
  });
});

// ============================================================================
// 8. Snapshot Read Failure
// ============================================================================

describe("generateInsight — snapshot read failure", () => {
  test("handles snapshot read error gracefully", async () => {
    const healthRepo = createInMemoryHealthRepo(undefined);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer();
    const log = createTestLog();

    // Override findSnapshot to throw
    healthRepo.findSnapshot = async (): Promise<
      HealthSnapshotRow | undefined
    > => {
      throw new Error("Database timeout");
    };

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.status).toBe("skipped_stale");
    expect(result.error).toContain("Database timeout");
    expect(explainer.calls.length).toBe(0);
  });
});

// ============================================================================
// 9. Malformed Snapshot Data
// ============================================================================

describe("generateInsight — malformed snapshot data", () => {
  test("rejects snapshot with null supporting metrics", async () => {
    const snapshot = makeSnapshot({ supportingMetrics: null as unknown });
    const healthRepo = createInMemoryHealthRepo(snapshot);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer();
    const log = createTestLog();

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(result.status).toBe("skipped_stale");
    expect(explainer.calls.length).toBe(0);
  });
});

// ============================================================================
// 10. Pipeline ordering — snapshot must exist before insight
// ============================================================================

describe("generateInsight — pipeline ordering", () => {
  test("never generates insight when snapshot does not exist", async () => {
    const healthRepo = createInMemoryHealthRepo(undefined);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer();
    const log = createTestLog();

    const result = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );

    expect(result.generated).toBe(false);
    expect(insightRepo.insights.size).toBe(0);
    expect(explainer.calls.length).toBe(0);
  });

  test("generates insight only after snapshot is available", async () => {
    const healthRepo = createInMemoryHealthRepo(undefined);
    const insightRepo = createInMemoryInsightRepo();
    const explainer = createStubExplainer();
    const log = createTestLog();

    // First: no snapshot → no insight
    const r1 = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-1"
    );
    expect(r1.generated).toBe(false);
    expect(insightRepo.insights.size).toBe(0);

    // Now add snapshot and try again
    healthRepo.snapshot = makeSnapshot({
      northStarValue: 4500,
      northStarPreviousValue: 5000,
      startupId: "startup-1",
    });

    const r2 = await generateInsight(
      { healthRepo, insightRepo, explainer, log },
      "startup-1",
      "sync-2"
    );
    expect(r2.generated).toBe(true);
    expect(insightRepo.insights.size).toBe(1);
  });
});
