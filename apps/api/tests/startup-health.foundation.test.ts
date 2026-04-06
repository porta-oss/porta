import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { HEALTH_STATES, isHealthState } from "@shared/startup-health";
import {
  isUniversalMetricKey,
  METRIC_LABELS,
  METRIC_UNITS,
  UNIVERSAL_METRIC_KEYS,
} from "@shared/universal-metrics";
import {
  createHealthSnapshotRepository,
  type HealthSnapshotRepository,
  type ReplaceSnapshotInput,
} from "../../worker/src/repository";
import type { ApiApp } from "../src/app";
import {
  closeTestApiApp,
  createTestApiApp,
  requireValue,
} from "./helpers/test-app";

// ---------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------

let app: ApiApp | undefined;
let healthRepo: HealthSnapshotRepository;

function getApp() {
  return requireValue(app, "Expected API test app to be initialized.");
}

beforeAll(async () => {
  app = await createTestApiApp();
  const testApp = getApp();

  // The health repo uses the same drizzle db handle (pool) as the API.
  // We cast through the pool's query interface into the DrizzleHandle shape.
  const dbHandle = {
    execute: async (query: unknown) => {
      // Drizzle's sql tagged template produces an object with .queryChunks
      // but when used through drizzle(pool), db.execute works directly.
      // We use the app's db.db (drizzle instance) for the repository.
      return (
        testApp.runtime.db.db as unknown as {
          execute: (q: unknown) => Promise<{ rows: unknown[] }>;
        }
      ).execute(query);
    },
  };
  healthRepo = createHealthSnapshotRepository(dbHandle);
});

afterAll(async () => {
  await closeTestApiApp(app);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function parseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function send(path: string) {
  return getApp().handle(new Request(`http://localhost${path}`));
}

/** Default funnel stage definitions for testing. */
const DEFAULT_FUNNEL_STAGES = [
  { key: "visitor", label: "Visitors", position: 0 },
  { key: "signup", label: "Sign-ups", position: 1 },
  { key: "activation", label: "Activated", position: 2 },
  { key: "paying_customer", label: "Paying Customers", position: 3 },
] as const;

/** Insert a workspace + startup directly for testing. */
async function seedStartup(): Promise<{
  workspaceId: string;
  startupId: string;
}> {
  const testApp = getApp();
  const workspaceId = randomUUID();
  const startupId = randomUUID();
  const userId = randomUUID();

  await testApp.runtime.db.pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ('${userId}', 'Test User', 'test-${userId}@example.com', true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`
  );
  await testApp.runtime.db.pool.query(
    `INSERT INTO "workspace" (id, name, slug, created_at)
     VALUES ('${workspaceId}', 'Test WS', 'test-ws-${workspaceId.slice(0, 8)}', NOW())
     ON CONFLICT (id) DO NOTHING`
  );
  await testApp.runtime.db.pool.query(
    `INSERT INTO "member" (id, organization_id, user_id, role, created_at)
     VALUES ('${randomUUID()}', '${workspaceId}', '${userId}', 'owner', NOW())
     ON CONFLICT (id) DO NOTHING`
  );
  await testApp.runtime.db.pool.query(
    `INSERT INTO "startup" (id, workspace_id, name, type, stage, timezone, currency, created_at, updated_at)
     VALUES ('${startupId}', '${workspaceId}', 'Test Startup', 'b2b_saas', 'mvp', 'UTC', 'USD', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`
  );

  return { workspaceId, startupId };
}

function makeSnapshotInput(
  startupId: string,
  overrides?: Partial<ReplaceSnapshotInput>
): ReplaceSnapshotInput {
  const snapshotId = randomUUID();
  return {
    snapshotId,
    startupId,
    healthState: "ready",
    blockedReason: null,
    northStarKey: "mrr",
    northStarValue: 12_500,
    northStarPreviousValue: 10_000,
    supportingMetrics: {
      active_users: 150,
      churn_rate: 3,
      arpu: 278,
      mrr: 12_500,
    },
    syncJobId: randomUUID(),
    computedAt: new Date(),
    funnel: DEFAULT_FUNNEL_STAGES.map((stage) => ({
      id: randomUUID(),
      key: stage.key,
      label: stage.label,
      value: Math.floor(Math.random() * 1000),
      position: stage.position,
    })),
    ...overrides,
  };
}

// ============================================================================
// 1. Shared Contract — Enum Guards
// ============================================================================

describe("shared contract — enum guards", () => {
  test("isHealthState accepts known values and rejects unknown", () => {
    for (const key of HEALTH_STATES) {
      expect(isHealthState(key)).toBe(true);
    }
    expect(isHealthState("unknown")).toBe(false);
    expect(isHealthState("READY")).toBe(false);
  });

  test("isUniversalMetricKey accepts known values and rejects unknown", () => {
    for (const key of UNIVERSAL_METRIC_KEYS) {
      expect(isUniversalMetricKey(key)).toBe(true);
    }
    expect(isUniversalMetricKey("revenue")).toBe(false);
    expect(isUniversalMetricKey("")).toBe(false);
  });

  test("metric labels and units cover all keys", () => {
    for (const key of UNIVERSAL_METRIC_KEYS) {
      expect(typeof METRIC_LABELS[key]).toBe("string");
      expect(METRIC_LABELS[key].length).toBeGreaterThan(0);
      expect(["count", "currency", "percent"]).toContain(METRIC_UNITS[key]);
    }
  });
});

// ============================================================================
// 2. Migration & Bootstrap — Health Tables
// ============================================================================

describe("migration and bootstrap — health tables", () => {
  test("health_snapshot and health_funnel_stage tables exist after bootstrap", async () => {
    const result = (await getApp().runtime.db.pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('health_snapshot', 'health_funnel_stage')`
    )) as { rows?: Array<{ table_name: string }> };

    const tableNames = new Set((result.rows ?? []).map((r) => r.table_name));
    expect(tableNames.has("health_snapshot")).toBe(true);
    expect(tableNames.has("health_funnel_stage")).toBe(true);
  });

  test("health endpoint reports startup-health tables readiness", async () => {
    const res = await send("/api/health");
    const body = await parseJson(res);

    expect(res.status).toBe(200);
    expect(body.startupHealth).toEqual({ tablesReady: true });

    const database = body.database as { tables: string[] };
    expect(database.tables).toContain("health_snapshot");
    expect(database.tables).toContain("health_funnel_stage");
  });

  test("checkHealthTablesExist reports both tables ready", async () => {
    const status = await healthRepo.checkHealthTablesExist();
    expect(status.snapshotReady).toBe(true);
    expect(status.funnelReady).toBe(true);
  });
});

// ============================================================================
// 3. Snapshot Persistence — Write / Read / Replace
// ============================================================================

describe("snapshot persistence", () => {
  test("first snapshot for a startup can be written and read back", async () => {
    const { startupId } = await seedStartup();
    const input = makeSnapshotInput(startupId);

    await healthRepo.replaceSnapshot(input);

    const snapshot = await healthRepo.findSnapshot(startupId);
    expect(snapshot).toBeDefined();
    expect(snapshot?.startupId).toBe(startupId);
    expect(snapshot?.healthState).toBe("ready");
    expect(snapshot?.northStarKey).toBe("mrr");
    expect(snapshot?.northStarValue).toBe(12_500);
    expect(snapshot?.northStarPreviousValue).toBe(10_000);
    expect(snapshot?.syncJobId).toBe(input.syncJobId);
    expect(snapshot?.supportingMetrics).toBeTruthy();

    const funnel = await healthRepo.findFunnelStages(startupId);
    expect(funnel).toHaveLength(DEFAULT_FUNNEL_STAGES.length);
    expect(funnel[0]?.key).toBe("visitor");
    expect(funnel.at(-1)?.key).toBe("paying_customer");
  });

  test("replacing an existing snapshot atomically swaps all data", async () => {
    const { startupId } = await seedStartup();

    // Write initial snapshot
    const first = makeSnapshotInput(startupId, {
      northStarValue: 5000,
      healthState: "ready",
    });
    await healthRepo.replaceSnapshot(first);

    // Replace with updated snapshot
    const second = makeSnapshotInput(startupId, {
      northStarValue: 15_000,
      healthState: "stale",
      blockedReason: null,
    });
    await healthRepo.replaceSnapshot(second);

    const snapshot = await healthRepo.findSnapshot(startupId);
    expect(snapshot).toBeDefined();
    expect(snapshot?.northStarValue).toBe(15_000);
    expect(snapshot?.healthState).toBe("stale");
    // Old snapshot ID should not be present
    expect(snapshot?.id).toBe(second.snapshotId);
    expect(snapshot?.id).not.toBe(first.snapshotId);

    // Funnel rows should belong to the new snapshot
    const funnel = await healthRepo.findFunnelStages(startupId);
    expect(funnel).toHaveLength(DEFAULT_FUNNEL_STAGES.length);
  });

  test("reading a startup with no snapshot returns undefined", async () => {
    const { startupId } = await seedStartup();
    const snapshot = await healthRepo.findSnapshot(startupId);
    expect(snapshot).toBeUndefined();

    const funnel = await healthRepo.findFunnelStages(startupId);
    expect(funnel).toHaveLength(0);
  });

  test("snapshot with blocked state persists blocked reason", async () => {
    const { startupId } = await seedStartup();
    const input = makeSnapshotInput(startupId, {
      healthState: "blocked",
      blockedReason: "PostHog connector in error state",
    });
    await healthRepo.replaceSnapshot(input);

    const snapshot = await healthRepo.findSnapshot(startupId);
    expect(snapshot?.healthState).toBe("blocked");
    expect(snapshot?.blockedReason).toBe("PostHog connector in error state");
  });

  test("snapshot with null syncJobId is valid (manual/bootstrap case)", async () => {
    const { startupId } = await seedStartup();
    const input = makeSnapshotInput(startupId, {
      syncJobId: null,
    });
    await healthRepo.replaceSnapshot(input);

    const snapshot = await healthRepo.findSnapshot(startupId);
    expect(snapshot?.syncJobId).toBeNull();
  });

  test("unique constraint prevents duplicate startup rows in health_snapshot", async () => {
    const { startupId } = await seedStartup();

    // First insert
    const first = makeSnapshotInput(startupId);
    await healthRepo.replaceSnapshot(first);

    // Direct insert (bypassing the delete-first logic) should fail
    const secondId = randomUUID();
    try {
      await getApp().runtime.db.pool.query(
        `INSERT INTO health_snapshot (id, startup_id, health_state, north_star_key, north_star_value, supporting_metrics, computed_at)
         VALUES ('${secondId}', '${startupId}', 'ready', 'mrr', 100, '{}', NOW())`
      );
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // Expect unique constraint violation (23505)
      const pgCode =
        typeof (error as Record<string, unknown>).code === "string"
          ? (error as Record<string, unknown>).code
          : undefined;
      expect(pgCode).toBe("23505");
    }
  });
});

// ============================================================================
// 4. Negative Tests — Malformed Inputs
// ============================================================================

describe("negative tests — malformed inputs", () => {
  test("isHealthState rejects unknown states", () => {
    expect(isHealthState("pending")).toBe(false);
    expect(isHealthState("active")).toBe(false);
    expect(isHealthState("BLOCKED")).toBe(false);
  });

  test("isUniversalMetricKey rejects similar-but-wrong keys", () => {
    expect(isUniversalMetricKey("activeUsers")).toBe(false);
    expect(isUniversalMetricKey("active-users")).toBe(false);
    expect(isUniversalMetricKey("CHURN_RATE")).toBe(false);
  });
});
