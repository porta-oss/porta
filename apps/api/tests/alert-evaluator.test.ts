import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import type { ApiApp } from "../src/app";
import { evaluateAlerts } from "../src/lib/alerts/evaluator";
import {
  closeTestApiApp,
  createTestApiApp,
  requireValue,
} from "./helpers/test-app";

// ---------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------

let app: ApiApp | undefined;

function getApp() {
  return requireValue(app, "Expected API test app to be initialized.");
}

function getDb() {
  return getApp().runtime.db.db;
}

function getPool() {
  return getApp().runtime.db.pool;
}

beforeAll(async () => {
  app = await createTestApiApp();
});

afterAll(async () => {
  await closeTestApiApp(app);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedStartup(): Promise<{
  workspaceId: string;
  startupId: string;
}> {
  const pool = getPool();
  const workspaceId = randomUUID();
  const startupId = randomUUID();
  const userId = randomUUID();

  await pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ('${userId}', 'Test User', 'test-${userId}@example.com', true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO "workspace" (id, name, slug, created_at)
     VALUES ('${workspaceId}', 'Test WS', 'ws-${workspaceId.slice(0, 8)}', NOW())
     ON CONFLICT (id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO "member" (id, organization_id, user_id, role, created_at)
     VALUES ('${randomUUID()}', '${workspaceId}', '${userId}', 'owner', NOW())
     ON CONFLICT (id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO "startup" (id, workspace_id, name, type, stage, timezone, currency, created_at, updated_at)
     VALUES ('${startupId}', '${workspaceId}', 'Test Startup', 'b2b_saas', 'mvp', 'UTC', 'USD', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`
  );

  return { workspaceId, startupId };
}

async function seedAlertRule(
  startupId: string,
  overrides?: {
    condition?: string;
    enabled?: boolean;
    id?: string;
    metricKey?: string;
    minDataPoints?: number;
    severity?: string;
    threshold?: string;
  }
) {
  const pool = getPool();
  const id = overrides?.id ?? randomUUID();
  const metricKey = overrides?.metricKey ?? "mrr";
  const condition = overrides?.condition ?? "drop_wow_pct";
  const threshold = overrides?.threshold ?? "20";
  const severity = overrides?.severity ?? "critical";
  const enabled = overrides?.enabled ?? true;
  const minDataPoints = overrides?.minDataPoints ?? 7;

  await pool.query(
    `INSERT INTO "alert_rule" (id, startup_id, metric_key, condition, threshold, severity, enabled, min_data_points, created_at, updated_at)
     VALUES ('${id}', '${startupId}', '${metricKey}', '${condition}', '${threshold}', '${severity}', ${enabled}, ${minDataPoints}, NOW(), NOW())`
  );

  return id;
}

async function seedHealthSnapshot(
  startupId: string,
  opts: {
    northStarKey?: string;
    northStarValue?: number;
    supportingMetrics?: Record<string, number>;
  }
) {
  const pool = getPool();
  const snapshotId = randomUUID();
  const northStarKey = opts.northStarKey ?? "mrr";
  const northStarValue = opts.northStarValue ?? 0;
  const supportingMetrics = opts.supportingMetrics ?? {};

  await pool.query(
    `INSERT INTO "health_snapshot" (id, startup_id, health_state, north_star_key, north_star_value, supporting_metrics, computed_at, created_at)
     VALUES ('${snapshotId}', '${startupId}', 'ready', '${northStarKey}', '${northStarValue}', '${JSON.stringify(supportingMetrics)}', NOW(), NOW())
     ON CONFLICT (startup_id) DO UPDATE
       SET north_star_value = '${northStarValue}',
           supporting_metrics = '${JSON.stringify(supportingMetrics)}',
           computed_at = NOW()`
  );

  return snapshotId;
}

/**
 * Seed health_snapshot_history entries for a metric.
 * Values are inserted with capturedAt dates spaced 1 day apart,
 * with the most recent value last.
 */
async function seedHistory(
  startupId: string,
  snapshotId: string,
  metricKey: string,
  values: number[]
) {
  const pool = getPool();
  const now = Date.now();

  for (let i = 0; i < values.length; i++) {
    const daysAgo = values.length - i;
    const capturedAt = new Date(
      now - daysAgo * 24 * 60 * 60 * 1000
    ).toISOString();
    await pool.query(
      `INSERT INTO "health_snapshot_history" (id, startup_id, metric_key, value, snapshot_id, captured_at)
       VALUES ('${randomUUID()}', '${startupId}', '${metricKey}', '${values[i]}', '${snapshotId}', '${capturedAt}')`
    );
  }
}

async function seedExistingAlert(
  startupId: string,
  ruleId: string,
  overrides?: {
    id?: string;
    metricKey?: string;
    occurrenceCount?: number;
    severity?: string;
    status?: string;
    threshold?: string;
    value?: string;
  }
) {
  const pool = getPool();
  const id = overrides?.id ?? randomUUID();
  const metricKey = overrides?.metricKey ?? "mrr";
  const severity = overrides?.severity ?? "critical";
  const value = overrides?.value ?? "750";
  const threshold = overrides?.threshold ?? "20";
  const status = overrides?.status ?? "active";
  const occurrenceCount = overrides?.occurrenceCount ?? 1;

  await pool.query(
    `INSERT INTO "alert" (id, startup_id, rule_id, metric_key, severity, value, threshold, status, occurrence_count, fired_at, last_fired_at, created_at)
     VALUES ('${id}', '${startupId}', '${ruleId}', '${metricKey}', '${severity}', '${value}', '${threshold}', '${status}', ${occurrenceCount}, NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour')`
  );

  return id;
}

interface AlertRow {
  id: string;
  last_fired_at: string;
  occurrence_count: number;
  rule_id: string;
  startup_id: string;
  status: string;
  value: string;
}

async function queryAlerts(startupId: string): Promise<AlertRow[]> {
  const result = (await getPool().query(
    `SELECT id, startup_id, rule_id, metric_key, severity, value, threshold, status, occurrence_count, fired_at, last_fired_at
     FROM "alert" WHERE startup_id = '${startupId}' ORDER BY created_at DESC`
  )) as { rows: AlertRow[] };
  return result.rows ?? [];
}

// ---------------------------------------------------------------------------
// Stable history: 10 values tightly clustered around 1000
// mean ≈ 1000, stddev ≈ 1.4 → any significant move yields z >> 2.5
// ---------------------------------------------------------------------------
const STABLE_HISTORY = [998, 1002, 999, 1001, 1000, 998, 1002, 999, 1001, 1000];

// ---------------------------------------------------------------------------
// Volatile history: 10 values with wide variance
// mean = 1000, stddev ≈ 331.7 → moderate moves yield z < 2.5
// ---------------------------------------------------------------------------
const VOLATILE_HISTORY = [
  500, 1500, 600, 1400, 700, 1300, 800, 1200, 900, 1100,
];

// ============================================================================
// 1. drop_wow_pct — fires when drop >= threshold AND z_score >= 2.5
// ============================================================================

describe("drop_wow_pct fires when drop >= threshold and z_score >= 2.5", () => {
  test("creates alert when MRR drops significantly from stable baseline", async () => {
    const { startupId } = await seedStartup();

    // Current MRR = 750 (in snapshot), prev ≈ 1000 (last history value)
    // drop_pct = ((1000 - 750) / 1000) * 100 = 25% >= 20% threshold
    // z = |750 - 1000| / 1.4 ≈ 178.6 >> 2.5
    const snapshotId = await seedHealthSnapshot(startupId, {
      northStarKey: "mrr",
      northStarValue: 750,
      supportingMetrics: { mrr: 750 },
    });
    await seedHistory(startupId, snapshotId, "mrr", STABLE_HISTORY);
    await seedAlertRule(startupId, {
      condition: "drop_wow_pct",
      metricKey: "mrr",
      severity: "critical",
      threshold: "20",
    });

    const results = await evaluateAlerts(startupId, getDb() as never);

    expect(results.length).toBeGreaterThanOrEqual(1);

    const fired = results.find((r) => r.metricKey === "mrr");
    expect(fired).toBeDefined();
    expect(fired?.isNew).toBe(true);
    expect(fired?.severity).toBe("critical");
    expect(fired?.value).toBe(750);

    // Verify alert was persisted
    const alerts = await queryAlerts(startupId);
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts[0].status).toBe("active");
  });
});

// ============================================================================
// 2. drop_wow_pct — does NOT fire when z_score < 2.5 (noise)
// ============================================================================

describe("drop_wow_pct does NOT fire when z_score < 2.5", () => {
  test("skips alert when drop is within normal volatile range", async () => {
    const { startupId } = await seedStartup();

    // Current MRR = 800, volatile history mean = 1000, stddev ≈ 331.7
    // prev (last history value) = 1100
    // drop_pct = ((1100 - 800) / 1100) * 100 ≈ 27.3% >= 20% threshold
    // BUT z = |800 - 1000| / 331.7 ≈ 0.60 < 2.5 → does NOT fire
    const snapshotId = await seedHealthSnapshot(startupId, {
      northStarKey: "mrr",
      northStarValue: 800,
      supportingMetrics: { mrr: 800 },
    });
    await seedHistory(startupId, snapshotId, "mrr", VOLATILE_HISTORY);
    await seedAlertRule(startupId, {
      condition: "drop_wow_pct",
      metricKey: "mrr",
      severity: "high",
      threshold: "20",
    });

    const results = await evaluateAlerts(startupId, getDb() as never);

    const fired = results.find((r) => r.metricKey === "mrr");
    expect(fired).toBeUndefined();

    // No alert should be persisted
    const alerts = await queryAlerts(startupId);
    expect(alerts.length).toBe(0);
  });
});

// ============================================================================
// 3. spike_vs_avg — fires when ratio >= threshold AND z_score >= 2.5
// ============================================================================

describe("spike_vs_avg fires when ratio >= threshold and z_score >= 2.5", () => {
  test("creates alert when active_users spikes far above stable average", async () => {
    const { startupId } = await seedStartup();

    // Stable history around 100: mean ≈ 100, stddev ≈ 1.4
    // Current active_users = 300
    // ratio = 300 / 100 = 3.0 >= 2.0 threshold
    // z = |300 - 100| / 1.4 ≈ 142.9 >> 2.5
    const stableActiveUsers = [98, 102, 99, 101, 100, 98, 102, 99, 101, 100];
    const snapshotId = await seedHealthSnapshot(startupId, {
      northStarKey: "mrr",
      northStarValue: 5000,
      supportingMetrics: { active_users: 300, mrr: 5000 },
    });
    await seedHistory(startupId, snapshotId, "active_users", stableActiveUsers);
    await seedAlertRule(startupId, {
      condition: "spike_vs_avg",
      metricKey: "active_users",
      severity: "high",
      threshold: "2",
    });

    const results = await evaluateAlerts(startupId, getDb() as never);

    expect(results.length).toBeGreaterThanOrEqual(1);

    const fired = results.find((r) => r.metricKey === "active_users");
    expect(fired).toBeDefined();
    expect(fired?.isNew).toBe(true);
    expect(fired?.severity).toBe("high");
    expect(fired?.value).toBe(300);
  });
});

// ============================================================================
// 4. below_threshold — fires when current < threshold (no z-score)
// ============================================================================

describe("below_threshold fires when current < threshold", () => {
  test("creates alert when error_rate falls below minimum", async () => {
    const { startupId } = await seedStartup();

    // Current active_users = 50, threshold = 100
    // 50 < 100 → fires (no z-score guard for below_threshold)
    const snapshotId = await seedHealthSnapshot(startupId, {
      northStarKey: "mrr",
      northStarValue: 5000,
      supportingMetrics: { active_users: 50, mrr: 5000 },
    });
    // Seed enough history to meet minDataPoints
    await seedHistory(
      startupId,
      snapshotId,
      "active_users",
      [200, 180, 190, 195, 185, 200, 175]
    );
    await seedAlertRule(startupId, {
      condition: "below_threshold",
      metricKey: "active_users",
      severity: "medium",
      threshold: "100",
    });

    const results = await evaluateAlerts(startupId, getDb() as never);

    expect(results.length).toBeGreaterThanOrEqual(1);

    const fired = results.find((r) => r.metricKey === "active_users");
    expect(fired).toBeDefined();
    expect(fired?.isNew).toBe(true);
    expect(fired?.value).toBe(50);
  });
});

// ============================================================================
// 5. above_threshold — fires when current > threshold (no z-score)
// ============================================================================

describe("above_threshold fires when current > threshold", () => {
  test("creates alert when error_rate exceeds maximum", async () => {
    const { startupId } = await seedStartup();

    // Current error_rate = 15, threshold = 10
    // 15 > 10 → fires (no z-score guard for above_threshold)
    const snapshotId = await seedHealthSnapshot(startupId, {
      northStarKey: "mrr",
      northStarValue: 5000,
      supportingMetrics: { error_rate: 15, mrr: 5000 },
    });
    await seedHistory(
      startupId,
      snapshotId,
      "error_rate",
      [5, 6, 4, 5, 7, 3, 5]
    );
    await seedAlertRule(startupId, {
      condition: "above_threshold",
      metricKey: "error_rate",
      severity: "critical",
      threshold: "10",
    });

    const results = await evaluateAlerts(startupId, getDb() as never);

    expect(results.length).toBeGreaterThanOrEqual(1);

    const fired = results.find((r) => r.metricKey === "error_rate");
    expect(fired).toBeDefined();
    expect(fired?.isNew).toBe(true);
    expect(fired?.value).toBe(15);
  });
});

// ============================================================================
// 6. Zero base value skips drop_wow_pct (no division by zero)
// ============================================================================

describe("zero base value skips drop_wow_pct", () => {
  test("does not fire when previous value is zero", async () => {
    const { startupId } = await seedStartup();

    // History ends with 0 (previous value = 0)
    // drop_pct = ((0 - 500) / 0) → division by zero → skip
    const snapshotId = await seedHealthSnapshot(startupId, {
      northStarKey: "mrr",
      northStarValue: 500,
      supportingMetrics: { mrr: 500 },
    });
    await seedHistory(
      startupId,
      snapshotId,
      "mrr",
      [100, 80, 60, 40, 20, 10, 5, 2, 1, 0]
    );
    await seedAlertRule(startupId, {
      condition: "drop_wow_pct",
      metricKey: "mrr",
      severity: "critical",
      threshold: "20",
    });

    const results = await evaluateAlerts(startupId, getDb() as never);

    const fired = results.find((r) => r.metricKey === "mrr");
    expect(fired).toBeUndefined();

    const alerts = await queryAlerts(startupId);
    expect(alerts.length).toBe(0);
  });
});

// ============================================================================
// 7. SD=0 (constant values) skips z-score guard
// ============================================================================

describe("SD=0 (constant values) skips z-score guard", () => {
  test("fires based on condition alone when all history values are identical", async () => {
    const { startupId } = await seedStartup();

    // All history values are 1000 → mean = 1000, stddev = 0
    // Current = 750, prev = 1000
    // drop_pct = 25% >= 20% threshold → condition met
    // z = |750 - 1000| / 0 → undefined → z-score guard skipped
    // Should FIRE because SD=0 bypasses the z-score requirement
    const constantHistory = [
      1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000,
    ];
    const snapshotId = await seedHealthSnapshot(startupId, {
      northStarKey: "mrr",
      northStarValue: 750,
      supportingMetrics: { mrr: 750 },
    });
    await seedHistory(startupId, snapshotId, "mrr", constantHistory);
    await seedAlertRule(startupId, {
      condition: "drop_wow_pct",
      metricKey: "mrr",
      severity: "high",
      threshold: "20",
    });

    const results = await evaluateAlerts(startupId, getDb() as never);

    expect(results.length).toBeGreaterThanOrEqual(1);

    const fired = results.find((r) => r.metricKey === "mrr");
    expect(fired).toBeDefined();
    expect(fired?.isNew).toBe(true);
  });
});

// ============================================================================
// 8. Insufficient data points skips evaluation
// ============================================================================

describe("insufficient data points skips evaluation", () => {
  test("does not fire when history has fewer entries than minDataPoints", async () => {
    const { startupId } = await seedStartup();

    // minDataPoints = 7, but only 3 history entries
    // Should skip evaluation entirely
    const snapshotId = await seedHealthSnapshot(startupId, {
      northStarKey: "mrr",
      northStarValue: 750,
      supportingMetrics: { mrr: 750 },
    });
    await seedHistory(startupId, snapshotId, "mrr", [1000, 1000, 1000]);
    await seedAlertRule(startupId, {
      condition: "drop_wow_pct",
      metricKey: "mrr",
      minDataPoints: 7,
      severity: "critical",
      threshold: "20",
    });

    const results = await evaluateAlerts(startupId, getDb() as never);

    const fired = results.find((r) => r.metricKey === "mrr");
    expect(fired).toBeUndefined();

    const alerts = await queryAlerts(startupId);
    expect(alerts.length).toBe(0);
  });
});

// ============================================================================
// 9. Dedup — existing active alert increments occurrence_count
// ============================================================================

describe("dedup: existing active alert increments occurrence_count", () => {
  test("updates existing alert instead of creating a new one", async () => {
    const { startupId } = await seedStartup();

    const ruleId = randomUUID();
    const existingAlertId = randomUUID();

    // Set up a scenario where the alert would fire
    const snapshotId = await seedHealthSnapshot(startupId, {
      northStarKey: "mrr",
      northStarValue: 750,
      supportingMetrics: { mrr: 750 },
    });
    await seedHistory(startupId, snapshotId, "mrr", STABLE_HISTORY);
    await seedAlertRule(startupId, {
      condition: "drop_wow_pct",
      id: ruleId,
      metricKey: "mrr",
      severity: "critical",
      threshold: "20",
    });

    // Seed an existing active alert for the same rule
    await seedExistingAlert(startupId, ruleId, {
      id: existingAlertId,
      metricKey: "mrr",
      occurrenceCount: 1,
      severity: "critical",
      status: "active",
      threshold: "20",
      value: "800",
    });

    const results = await evaluateAlerts(startupId, getDb() as never);

    expect(results.length).toBeGreaterThanOrEqual(1);

    const fired = results.find((r) => r.ruleId === ruleId);
    expect(fired).toBeDefined();
    expect(fired?.isNew).toBe(false);
    expect(fired?.alertId).toBe(existingAlertId);

    // Verify occurrence_count was incremented, not a new row
    const alerts = await queryAlerts(startupId);
    const matchingAlerts = alerts.filter((a) => a.rule_id === ruleId);
    expect(matchingAlerts.length).toBe(1);
    expect(matchingAlerts[0].occurrence_count).toBe(2);
  });
});
