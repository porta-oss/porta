import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import type { ApiApp } from "../src/app";
import { DEFAULT_RULES, seedDefaultAlerts } from "../src/lib/alerts/seeder";
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

async function seedStartup(): Promise<string> {
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

  return startupId;
}

interface AlertRuleRow {
  condition: string;
  enabled: boolean;
  id: string;
  metric_key: string;
  min_data_points: number;
  severity: string;
  startup_id: string;
  threshold: string;
}

async function queryAlertRules(startupId: string): Promise<AlertRuleRow[]> {
  const result = (await getPool().query(
    `SELECT id, startup_id, metric_key, condition, threshold, severity, enabled, min_data_points
     FROM "alert_rule" WHERE startup_id = '${startupId}' ORDER BY metric_key`
  )) as { rows: AlertRuleRow[] };
  return result.rows ?? [];
}

async function insertAlertRule(startupId: string, metricKey: string) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO "alert_rule" (id, startup_id, metric_key, condition, threshold, severity, enabled, min_data_points, created_at, updated_at)
     VALUES ('${randomUUID()}', '${startupId}', '${metricKey}', 'drop_wow_pct', '20', 'critical', true, 7, NOW(), NOW())`
  );
}

// ============================================================================
// 1. Seeds rules for available metrics only
// ============================================================================

describe("seedDefaultAlerts seeds rules for available metrics", () => {
  test("creates rules only for metrics present in availableMetricKeys", async () => {
    const startupId = await seedStartup();

    const count = await seedDefaultAlerts(
      startupId,
      ["mrr", "active_users"],
      getDb() as never
    );

    expect(count).toBe(2);

    const rules = await queryAlertRules(startupId);
    expect(rules.length).toBe(2);

    const metricKeys = rules.map((r) => r.metric_key).sort();
    expect(metricKeys).toEqual(["active_users", "mrr"]);

    // Verify mrr rule details
    const mrrRule = rules.find((r) => r.metric_key === "mrr");
    expect(mrrRule?.condition).toBe("drop_wow_pct");
    expect(mrrRule?.threshold).toBe("20");
    expect(mrrRule?.severity).toBe("critical");
    expect(mrrRule?.enabled).toBe(true);
    expect(mrrRule?.min_data_points).toBe(7);

    // Verify active_users rule details
    const auRule = rules.find((r) => r.metric_key === "active_users");
    expect(auRule?.condition).toBe("drop_wow_pct");
    expect(auRule?.threshold).toBe("25");
    expect(auRule?.severity).toBe("high");
  });
});

// ============================================================================
// 2. Skips if startup already has alert rules
// ============================================================================

describe("seedDefaultAlerts skips if startup already has rules", () => {
  test("returns 0 and creates no rules when startup already has rules", async () => {
    const startupId = await seedStartup();

    // Pre-seed a rule
    await insertAlertRule(startupId, "mrr");

    const count = await seedDefaultAlerts(
      startupId,
      ["mrr", "active_users", "churn_rate"],
      getDb() as never
    );

    expect(count).toBe(0);

    // Only the pre-seeded rule should exist
    const rules = await queryAlertRules(startupId);
    expect(rules.length).toBe(1);
  });
});

// ============================================================================
// 3. Seeds only for matching metrics, ignores unknown
// ============================================================================

describe("seedDefaultAlerts ignores unknown metric keys", () => {
  test("only seeds for known default metrics, not custom ones", async () => {
    const startupId = await seedStartup();

    const count = await seedDefaultAlerts(
      startupId,
      ["mrr", "custom_metric_xyz", "unknown_thing"],
      getDb() as never
    );

    expect(count).toBe(1);

    const rules = await queryAlertRules(startupId);
    expect(rules.length).toBe(1);
    expect(rules[0].metric_key).toBe("mrr");
  });
});

// ============================================================================
// 4. Returns 0 when no available metrics match defaults
// ============================================================================

describe("seedDefaultAlerts returns 0 when no metrics match", () => {
  test("creates nothing when availableMetricKeys has no default matches", async () => {
    const startupId = await seedStartup();

    const count = await seedDefaultAlerts(
      startupId,
      ["custom_only", "another_custom"],
      getDb() as never
    );

    expect(count).toBe(0);

    const rules = await queryAlertRules(startupId);
    expect(rules.length).toBe(0);
  });
});

// ============================================================================
// 5. Seeds all 7 default rules when all metrics are available
// ============================================================================

describe("seedDefaultAlerts seeds all defaults when all metrics present", () => {
  test("creates all 7 default rules", async () => {
    const startupId = await seedStartup();

    const allMetrics = DEFAULT_RULES.map((r) => r.metricKey);
    const count = await seedDefaultAlerts(
      startupId,
      allMetrics,
      getDb() as never
    );

    expect(count).toBe(7);

    const rules = await queryAlertRules(startupId);
    expect(rules.length).toBe(7);
  });
});
