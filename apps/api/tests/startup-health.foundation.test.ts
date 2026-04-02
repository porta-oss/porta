import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { FunnelStageRow } from "@shared/startup-health";
import {
  emptyFunnelStages,
  emptySupportingMetrics,
  FUNNEL_STAGE_LABELS,
  FUNNEL_STAGE_POSITIONS,
  FUNNEL_STAGES,
  HEALTH_STATES,
  isFunnelStage,
  isHealthState,
  isNorthStarMetric,
  isSupportingMetric,
  NORTH_STAR_METRICS,
  SUPPORTING_METRIC_LABELS,
  SUPPORTING_METRIC_UNITS,
  SUPPORTING_METRICS,
  validateFunnelStages,
  validateSupportingMetrics,
} from "@shared/startup-health";
import {
  createHealthSnapshotRepository,
  type HealthSnapshotRepository,
  type ReplaceSnapshotInput,
} from "../../worker/src/repository";
import { type ApiApp, createApiApp } from "../src/app";

// ---------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------

const VALID_HEX_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const TEST_ENV = {
  NODE_ENV: "test",
  API_PORT: "3000",
  API_URL: "http://localhost:3000",
  WEB_URL: "http://localhost:5173",
  DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/porta",
  REDIS_URL: "redis://127.0.0.1:6379",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  MAGIC_LINK_SENDER_EMAIL: "dev@porta.local",
  CONNECTOR_ENCRYPTION_KEY: VALID_HEX_KEY,
  AUTH_CONTEXT_TIMEOUT_MS: "2000",
  DATABASE_CONNECT_TIMEOUT_MS: "5000",
  DATABASE_POOL_MAX: "5",
} as const;

let app: ApiApp;
let healthRepo: HealthSnapshotRepository;

beforeAll(async () => {
  app = await createApiApp(TEST_ENV);

  // The health repo uses the same drizzle db handle (pool) as the API.
  // We cast through the pool's query interface into the DrizzleHandle shape.
  const dbHandle = {
    execute: async (query: unknown) => {
      // Drizzle's sql tagged template produces an object with .queryChunks
      // but when used through drizzle(pool), db.execute works directly.
      // We use the app's db.db (drizzle instance) for the repository.
      return (
        app.runtime.db.db as unknown as {
          execute: (q: unknown) => Promise<{ rows: unknown[] }>;
        }
      ).execute(query);
    },
  };
  healthRepo = createHealthSnapshotRepository(dbHandle);
});

afterAll(async () => {
  await app.runtime.db.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function parseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function send(path: string) {
  return app.handle(new Request(`http://localhost${path}`));
}

/** Insert a workspace + startup directly for testing. */
async function seedStartup(): Promise<{
  workspaceId: string;
  startupId: string;
}> {
  const workspaceId = randomUUID();
  const startupId = randomUUID();
  const userId = randomUUID();

  await app.runtime.db.pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ('${userId}', 'Test User', 'test-${userId}@example.com', true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`
  );
  await app.runtime.db.pool.query(
    `INSERT INTO "workspace" (id, name, slug, created_at)
     VALUES ('${workspaceId}', 'Test WS', 'test-ws-${workspaceId.slice(0, 8)}', NOW())
     ON CONFLICT (id) DO NOTHING`
  );
  await app.runtime.db.pool.query(
    `INSERT INTO "member" (id, organization_id, user_id, role, created_at)
     VALUES ('${randomUUID()}', '${workspaceId}', '${userId}', 'owner', NOW())
     ON CONFLICT (id) DO NOTHING`
  );
  await app.runtime.db.pool.query(
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
      active_users: { value: 150, previous: 120 },
      customer_count: { value: 45, previous: 40 },
      churn_rate: { value: 3, previous: 4 },
      arpu: { value: 278, previous: 250 },
      trial_conversion_rate: { value: 22, previous: 18 },
    },
    syncJobId: randomUUID(),
    computedAt: new Date(),
    funnel: FUNNEL_STAGES.map((stage) => ({
      id: randomUUID(),
      stage,
      label: FUNNEL_STAGE_LABELS[stage],
      value: Math.floor(Math.random() * 1000),
      position: FUNNEL_STAGE_POSITIONS[stage],
    })),
    ...overrides,
  };
}

// ============================================================================
// 1. Shared Contract — Enum Guards
// ============================================================================

describe("shared contract — enum guards", () => {
  test("isNorthStarMetric accepts known values and rejects unknown", () => {
    for (const key of NORTH_STAR_METRICS) {
      expect(isNorthStarMetric(key)).toBe(true);
    }
    expect(isNorthStarMetric("unknown_metric")).toBe(false);
    expect(isNorthStarMetric("")).toBe(false);
    expect(isNorthStarMetric("MRR")).toBe(false); // case-sensitive
  });

  test("isSupportingMetric accepts known values and rejects unknown", () => {
    for (const key of SUPPORTING_METRICS) {
      expect(isSupportingMetric(key)).toBe(true);
    }
    expect(isSupportingMetric("revenue")).toBe(false);
    expect(isSupportingMetric("")).toBe(false);
  });

  test("isFunnelStage accepts known values and rejects unknown", () => {
    for (const key of FUNNEL_STAGES) {
      expect(isFunnelStage(key)).toBe(true);
    }
    expect(isFunnelStage("install")).toBe(false);
    expect(isFunnelStage("")).toBe(false);
  });

  test("isHealthState accepts known values and rejects unknown", () => {
    for (const key of HEALTH_STATES) {
      expect(isHealthState(key)).toBe(true);
    }
    expect(isHealthState("unknown")).toBe(false);
    expect(isHealthState("READY")).toBe(false);
  });

  test("supporting metric labels and units cover all keys", () => {
    for (const key of SUPPORTING_METRICS) {
      expect(typeof SUPPORTING_METRIC_LABELS[key]).toBe("string");
      expect(SUPPORTING_METRIC_LABELS[key].length).toBeGreaterThan(0);
      expect(["count", "currency", "percent"]).toContain(
        SUPPORTING_METRIC_UNITS[key]
      );
    }
  });

  test("funnel stage labels and positions cover all stages", () => {
    for (const stage of FUNNEL_STAGES) {
      expect(typeof FUNNEL_STAGE_LABELS[stage]).toBe("string");
      expect(typeof FUNNEL_STAGE_POSITIONS[stage]).toBe("number");
    }
  });
});

// ============================================================================
// 2. Shared Contract — Validation
// ============================================================================

describe("shared contract — validation helpers", () => {
  test("emptySupportingMetrics produces valid snapshot", () => {
    const metrics = emptySupportingMetrics();
    expect(validateSupportingMetrics(metrics)).toBeNull();
  });

  test("emptyFunnelStages produces valid funnel", () => {
    const stages = emptyFunnelStages();
    expect(validateFunnelStages(stages)).toBeNull();
    expect(stages).toHaveLength(FUNNEL_STAGES.length);
  });

  test("validateSupportingMetrics rejects missing key", () => {
    const metrics = emptySupportingMetrics();
    const { active_users, ...rest } = metrics;
    expect(validateSupportingMetrics(rest)).toContain(
      "Missing supporting metric key: active_users"
    );
  });

  test("validateSupportingMetrics rejects unknown key", () => {
    const metrics = {
      ...emptySupportingMetrics(),
      bogus_key: { value: 0, previous: null },
    };
    expect(validateSupportingMetrics(metrics)).toContain(
      "Unknown supporting metric key: bogus_key"
    );
  });

  test("validateSupportingMetrics rejects non-finite value", () => {
    const metrics = emptySupportingMetrics();
    metrics.churn_rate = { value: Number.NaN, previous: null };
    expect(validateSupportingMetrics(metrics)).toContain("churn_rate");
  });

  test("validateSupportingMetrics rejects non-object", () => {
    expect(validateSupportingMetrics(null)).toContain("non-null object");
    expect(validateSupportingMetrics("string")).toContain("non-null object");
  });

  test("validateFunnelStages rejects missing stage", () => {
    const stages = emptyFunnelStages().filter((s) => s.stage !== "visitor");
    expect(validateFunnelStages(stages)).toContain(
      "Missing funnel stage: visitor"
    );
  });

  test("validateFunnelStages rejects duplicate stage", () => {
    const stages = emptyFunnelStages();
    stages.push({ ...stages[0]! });
    expect(validateFunnelStages(stages)).toContain("Duplicate funnel stage");
  });

  test("validateFunnelStages rejects invalid stage name", () => {
    const stages = emptyFunnelStages().map((s) =>
      s.stage === "visitor"
        ? { ...s, stage: "bogus" as FunnelStageRow["stage"] }
        : s
    );
    expect(validateFunnelStages(stages)).toContain("Invalid funnel stage");
  });

  test("validateFunnelStages rejects non-finite value", () => {
    const stages = emptyFunnelStages().map((s) =>
      s.stage === "visitor" ? { ...s, value: Number.POSITIVE_INFINITY } : s
    );
    expect(validateFunnelStages(stages)).toContain("finite number");
  });

  test("validateFunnelStages rejects non-array", () => {
    expect(validateFunnelStages("not-an-array")).toContain("must be an array");
  });
});

// ============================================================================
// 3. Migration & Bootstrap — Health Tables
// ============================================================================

describe("migration and bootstrap — health tables", () => {
  test("health_snapshot and health_funnel_stage tables exist after bootstrap", async () => {
    const result = (await app.runtime.db.pool.query(
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
// 4. Snapshot Persistence — Write / Read / Replace
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
    expect(funnel).toHaveLength(FUNNEL_STAGES.length);
    expect(funnel[0]?.stage).toBe("visitor");
    expect(funnel.at(-1)?.stage).toBe("paying_customer");
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
    expect(funnel).toHaveLength(FUNNEL_STAGES.length);
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
      await app.runtime.db.pool.query(
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
// 5. Negative Tests — Malformed Inputs
// ============================================================================

describe("negative tests — malformed inputs", () => {
  test("isNorthStarMetric rejects numeric, empty, and uppercase variants", () => {
    expect(isNorthStarMetric("0")).toBe(false);
    expect(isNorthStarMetric(" mrr ")).toBe(false);
    expect(isNorthStarMetric("MRR")).toBe(false);
  });

  test("isSupportingMetric rejects similar-but-wrong keys", () => {
    expect(isSupportingMetric("activeUsers")).toBe(false);
    expect(isSupportingMetric("active-users")).toBe(false);
    expect(isSupportingMetric("CHURN_RATE")).toBe(false);
  });

  test("isFunnelStage rejects camelCase and typos", () => {
    expect(isFunnelStage("payingCustomer")).toBe(false);
    expect(isFunnelStage("signUp")).toBe(false);
    expect(isFunnelStage("vistor")).toBe(false);
  });

  test("isHealthState rejects unknown states", () => {
    expect(isHealthState("pending")).toBe(false);
    expect(isHealthState("active")).toBe(false);
    expect(isHealthState("BLOCKED")).toBe(false);
  });

  test("validateSupportingMetrics rejects entry with non-number previous", () => {
    const metrics = emptySupportingMetrics();
    (metrics.arpu as unknown as Record<string, unknown>).previous =
      "not-a-number";
    const err = validateSupportingMetrics(metrics);
    expect(err).toContain("arpu");
    expect(err).toContain("finite number or null");
  });

  test("validateFunnelStages rejects non-integer position", () => {
    const stages = emptyFunnelStages().map((s) =>
      s.stage === "signup" ? { ...s, position: 1.5 } : s
    );
    expect(validateFunnelStages(stages)).toContain("integer");
  });

  test("validateFunnelStages rejects empty label", () => {
    const stages = emptyFunnelStages().map((s) =>
      s.stage === "activation" ? { ...s, label: "" } : s
    );
    expect(validateFunnelStages(stages)).toContain("non-empty label");
  });
});
