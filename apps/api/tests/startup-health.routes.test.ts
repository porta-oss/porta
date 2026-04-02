/**
 * Startup health route tests.
 * Covers: auth rejection, scope denial, ready payloads, blocked/stale states,
 * connector freshness, malformed inputs, and negative test paths.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { HealthSnapshotSummary } from "@shared/startup-health";
import {
  emptyFunnelStages,
  emptySupportingMetrics,
} from "@shared/startup-health";

import type { StartupDraft } from "@shared/types";
import { convertSetCookieToCookie } from "better-auth/test";
import { sql } from "drizzle-orm";

import { type ApiApp, createApiApp } from "../src/app";
import { createStubPostHogValidator } from "../src/lib/connectors/posthog";
import { createStubQueueProducer } from "../src/lib/connectors/queue";
import { createStubStripeValidator } from "../src/lib/connectors/stripe";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

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
  CONNECTOR_ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  AUTH_CONTEXT_TIMEOUT_MS: "2000",
  DATABASE_CONNECT_TIMEOUT_MS: "5000",
  DATABASE_POOL_MAX: "5",
} as const;

const VALID_STARTUP: StartupDraft = {
  name: "Health Route Test",
  type: "b2b_saas",
  stage: "mvp",
  timezone: "UTC",
  currency: "USD",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  app: ApiApp,
  url: string,
  init?: RequestInit
): Promise<Response> {
  return app.handle(new Request(url, init));
}

async function signUp(app: ApiApp, email: string): Promise<string> {
  const signInRes = await makeRequest(
    app,
    "http://localhost:3000/api/auth/sign-in/magic-link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: "Health Route Tester" }),
    }
  );
  if (!signInRes.ok) {
    throw new Error(`Magic link request failed: ${signInRes.status}`);
  }

  const magicLink = app.runtime.auth.getLatestMagicLink(email);
  if (!magicLink) {
    throw new Error(`No magic link for ${email}`);
  }

  const verifyRes = await app.handle(new Request(magicLink.url));
  const cookie =
    convertSetCookieToCookie(verifyRes.headers).get("cookie") ?? "";
  if (!cookie) {
    throw new Error(`No cookie returned for ${email}`);
  }

  return cookie;
}

async function createWorkspace(
  app: ApiApp,
  cookie: string,
  name: string
): Promise<string> {
  const response = await makeRequest(
    app,
    "http://localhost:3000/api/workspaces",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name }),
    }
  );
  const payload = (await response.json()) as { workspace: { id: string } };
  return payload.workspace.id;
}

async function createStartup(
  app: ApiApp,
  cookie: string,
  draft: StartupDraft
): Promise<string> {
  const response = await makeRequest(
    app,
    "http://localhost:3000/api/startups",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(draft),
    }
  );
  const payload = (await response.json()) as { startup: { id: string } };
  return payload.startup.id;
}

async function insertSnapshot(
  db: ApiApp["runtime"]["db"]["db"],
  startupId: string,
  overrides: {
    healthState?: string;
    blockedReason?: string | null;
    northStarValue?: number;
    northStarPreviousValue?: number | null;
    computedAt?: Date;
    syncJobId?: string | null;
  } = {}
): Promise<string> {
  const snapshotId = `snap-${randomUUID()}`;
  const metrics = JSON.stringify(emptySupportingMetrics());
  const computedAt = overrides.computedAt ?? new Date();

  await db.execute(
    sql`INSERT INTO health_snapshot
        (id, startup_id, health_state, blocked_reason,
         north_star_key, north_star_value, north_star_previous_value,
         supporting_metrics, sync_job_id, computed_at)
        VALUES (${snapshotId}, ${startupId},
                ${overrides.healthState ?? "ready"},
                ${overrides.blockedReason ?? null},
                ${"mrr"}, ${overrides.northStarValue ?? 4200},
                ${overrides.northStarPreviousValue ?? null},
                ${metrics}::jsonb,
                ${overrides.syncJobId ?? null},
                ${computedAt})`
  );

  // Insert funnel stages
  const stages = emptyFunnelStages();
  for (const stage of stages) {
    await db.execute(
      sql`INSERT INTO health_funnel_stage
          (id, startup_id, stage, label, value, position, snapshot_id)
          VALUES (${`fs-${stage.stage}-${randomUUID()}`}, ${startupId},
                  ${stage.stage}, ${stage.label}, ${stage.value},
                  ${stage.position}, ${snapshotId})`
    );
  }

  return snapshotId;
}

async function insertConnector(
  db: ApiApp["runtime"]["db"]["db"],
  startupId: string,
  provider: string,
  status: string,
  lastSyncAt: Date | null = null,
  lastSyncError: string | null = null
): Promise<string> {
  const connectorId = randomUUID();
  await db.execute(
    sql`INSERT INTO connector
        (id, startup_id, provider, status,
         encrypted_config, encryption_iv, encryption_auth_tag,
         last_sync_at, last_sync_error)
        VALUES (${connectorId}, ${startupId}, ${provider}, ${status},
                ${"fake-encrypted"}, ${"fake-iv"}, ${"fake-auth-tag"},
                ${lastSyncAt}, ${lastSyncError})`
  );
  return connectorId;
}

async function cleanupStartupHealth(
  db: ApiApp["runtime"]["db"]["db"],
  startupId: string
) {
  await db.execute(
    sql`DELETE FROM health_funnel_stage WHERE startup_id = ${startupId}`
  );
  await db.execute(
    sql`DELETE FROM health_snapshot WHERE startup_id = ${startupId}`
  );
  await db.execute(
    sql`DELETE FROM sync_job WHERE connector_id IN (SELECT id FROM connector WHERE startup_id = ${startupId})`
  );
  await db.execute(sql`DELETE FROM connector WHERE startup_id = ${startupId}`);
}

function healthUrl(startupId: string): string {
  return `http://localhost:3000/api/startups/${startupId}/health`;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("startup health route", () => {
  let app: ApiApp;
  let cookie: string;
  let startupId: string;
  let cookie2: string;

  beforeAll(async () => {
    const queueProducer = createStubQueueProducer({
      success: true,
      jobId: "health-rt-job",
    });
    app = await createApiApp(TEST_ENV, {
      posthogValidator: createStubPostHogValidator({ valid: true }),
      stripeValidator: createStubStripeValidator({ valid: true }),
      queueProducer,
    });

    // User 1 — owns the startup
    const runId = Date.now();
    cookie = await signUp(app, `health-route-${runId}@test.local`);
    await createWorkspace(app, cookie, `Health Route WS ${runId}`);
    startupId = await createStartup(app, cookie, {
      ...VALID_STARTUP,
      name: `Health Route Startup ${runId}`,
    });

    // User 2 — different workspace, no access to the startup
    cookie2 = await signUp(app, `health-route-other-${runId}@test.local`);
    await createWorkspace(app, cookie2, `Other WS ${runId}`);
  });

  afterAll(async () => {
    await app.runtime.db.close();
  });

  // =========================================================================
  // Auth rejection
  // =========================================================================

  describe("auth rejection", () => {
    test("unauthenticated request returns 401", async () => {
      const res = await makeRequest(app, healthUrl(startupId));
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("AUTH_REQUIRED");
    });

    test("malformed cookie returns 401", async () => {
      const res = await makeRequest(app, healthUrl(startupId), {
        headers: { cookie: "invalid-cookie=garbage" },
      });
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // Scope denial
  // =========================================================================

  describe("scope denial", () => {
    test("startup from another workspace returns 403", async () => {
      const res = await makeRequest(app, healthUrl(startupId), {
        headers: { cookie: cookie2 },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("STARTUP_SCOPE_INVALID");
    });

    test("non-existent startup returns 404", async () => {
      const fakeId = randomUUID();
      const res = await makeRequest(app, healthUrl(fakeId), {
        headers: { cookie },
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("STARTUP_NOT_FOUND");
    });
  });

  // =========================================================================
  // Blocked state — no connectors
  // =========================================================================

  describe("blocked state — no connectors", () => {
    test("returns blocked with NO_CONNECTORS reason when no connectors configured", async () => {
      await cleanupStartupHealth(app.runtime.db.db, startupId);

      const res = await makeRequest(app, healthUrl(startupId), {
        headers: { cookie },
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        health: HealthSnapshotSummary | null;
        status: string;
        blockedReasons: Array<{ code: string; message: string }>;
      };

      expect(body.health).toBeNull();
      expect(body.status).toBe("blocked");
      expect(body.blockedReasons.length).toBeGreaterThan(0);
      expect(body.blockedReasons.some((r) => r.code === "NO_CONNECTORS")).toBe(
        true
      );
    });
  });

  // =========================================================================
  // Syncing state — pending connectors, no snapshot yet
  // =========================================================================

  describe("syncing state — pending connectors", () => {
    test("returns syncing when connectors are pending and no snapshot exists", async () => {
      await cleanupStartupHealth(app.runtime.db.db, startupId);
      await insertConnector(app.runtime.db.db, startupId, "posthog", "pending");

      const res = await makeRequest(app, healthUrl(startupId), {
        headers: { cookie },
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        health: HealthSnapshotSummary | null;
        status: string;
        connectors: Array<{ provider: string; status: string }>;
        blockedReasons: Array<{ code: string }>;
      };

      expect(body.health).toBeNull();
      expect(body.status).toBe("syncing");
      expect(body.connectors.length).toBe(1);
      expect(body.connectors[0]?.provider).toBe("posthog");
      expect(body.connectors[0]?.status).toBe("pending");

      // Clean up
      await cleanupStartupHealth(app.runtime.db.db, startupId);
    });
  });

  // =========================================================================
  // Ready state — full payload
  // =========================================================================

  describe("ready state — full payload", () => {
    test("returns ready with full metrics when snapshot exists", async () => {
      await cleanupStartupHealth(app.runtime.db.db, startupId);
      await insertConnector(
        app.runtime.db.db,
        startupId,
        "posthog",
        "connected",
        new Date()
      );
      await insertSnapshot(app.runtime.db.db, startupId, {
        healthState: "ready",
        northStarValue: 9500,
        northStarPreviousValue: 8200,
      });

      const res = await makeRequest(app, healthUrl(startupId), {
        headers: { cookie },
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        health: HealthSnapshotSummary;
        status: string;
        connectors: Array<{ provider: string; status: string }>;
        blockedReasons: Array<{ code: string }>;
        lastSnapshotAt: string;
      };

      expect(body.status).toBe("ready");
      expect(body.health).toBeDefined();
      expect(body.health.northStarKey).toBe("mrr");
      expect(body.health.northStarValue).toBe(9500);
      expect(body.health.northStarPreviousValue).toBe(8200);
      expect(body.health.healthState).toBe("ready");
      expect(body.health.funnel.length).toBe(4);
      expect(body.health.supportingMetrics).toBeDefined();
      expect(body.connectors.length).toBe(1);
      expect(body.blockedReasons.length).toBe(0);
      expect(body.lastSnapshotAt).toBeTruthy();

      // Clean up
      await cleanupStartupHealth(app.runtime.db.db, startupId);
    });
  });

  // =========================================================================
  // Stale state — old snapshot
  // =========================================================================

  describe("stale state — old snapshot", () => {
    test("returns stale when snapshot is older than 24h", async () => {
      await cleanupStartupHealth(app.runtime.db.db, startupId);
      await insertConnector(
        app.runtime.db.db,
        startupId,
        "posthog",
        "connected"
      );

      // Snapshot computed 25 hours ago
      const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await insertSnapshot(app.runtime.db.db, startupId, {
        healthState: "ready",
        northStarValue: 3000,
        computedAt: staleDate,
      });

      const res = await makeRequest(app, healthUrl(startupId), {
        headers: { cookie },
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        health: HealthSnapshotSummary;
        status: string;
      };

      expect(body.status).toBe("stale");
      expect(body.health.northStarValue).toBe(3000);

      // Clean up
      await cleanupStartupHealth(app.runtime.db.db, startupId);
    });
  });

  // =========================================================================
  // Connector error/disconnected states
  // =========================================================================

  describe("connector error and disconnected states", () => {
    test("returns blocked reasons for disconnected connector", async () => {
      await cleanupStartupHealth(app.runtime.db.db, startupId);
      await insertConnector(
        app.runtime.db.db,
        startupId,
        "stripe",
        "disconnected"
      );

      const res = await makeRequest(app, healthUrl(startupId), {
        headers: { cookie },
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        status: string;
        blockedReasons: Array<{ code: string; message: string }>;
        connectors: Array<{ provider: string; status: string }>;
      };

      expect(
        body.blockedReasons.some((r) => r.code === "CONNECTOR_DISCONNECTED")
      ).toBe(true);
      expect(body.connectors[0]?.status).toBe("disconnected");

      await cleanupStartupHealth(app.runtime.db.db, startupId);
    });

    test("returns blocked reasons for errored connector", async () => {
      await cleanupStartupHealth(app.runtime.db.db, startupId);
      await insertConnector(
        app.runtime.db.db,
        startupId,
        "posthog",
        "error",
        null,
        "API key revoked"
      );

      const res = await makeRequest(app, healthUrl(startupId), {
        headers: { cookie },
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        status: string;
        blockedReasons: Array<{ code: string; message: string }>;
      };

      expect(
        body.blockedReasons.some((r) => r.code === "CONNECTOR_ERROR")
      ).toBe(true);
      const errorReason = body.blockedReasons.find(
        (r) => r.code === "CONNECTOR_ERROR"
      );
      expect(errorReason?.message).toContain("API key revoked");

      await cleanupStartupHealth(app.runtime.db.db, startupId);
    });

    test("stale when all connectors are disconnected/error but snapshot exists", async () => {
      await cleanupStartupHealth(app.runtime.db.db, startupId);
      await insertConnector(
        app.runtime.db.db,
        startupId,
        "posthog",
        "error",
        null,
        "timeout"
      );
      await insertConnector(
        app.runtime.db.db,
        startupId,
        "stripe",
        "disconnected"
      );
      await insertSnapshot(app.runtime.db.db, startupId, {
        healthState: "ready",
        northStarValue: 5000,
      });

      const res = await makeRequest(app, healthUrl(startupId), {
        headers: { cookie },
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        status: string;
        health: HealthSnapshotSummary;
        blockedReasons: Array<{ code: string }>;
      };

      expect(body.status).toBe("stale");
      expect(body.health.northStarValue).toBe(5000);
      expect(body.blockedReasons.length).toBeGreaterThan(0);

      await cleanupStartupHealth(app.runtime.db.db, startupId);
    });
  });

  // =========================================================================
  // Blocked state — awaiting first sync
  // =========================================================================

  describe("blocked state — awaiting first sync", () => {
    test("returns syncing with AWAITING_FIRST_SYNC when pending connectors and no snapshot", async () => {
      await cleanupStartupHealth(app.runtime.db.db, startupId);
      await insertConnector(app.runtime.db.db, startupId, "posthog", "pending");
      await insertConnector(app.runtime.db.db, startupId, "stripe", "pending");

      const res = await makeRequest(app, healthUrl(startupId), {
        headers: { cookie },
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        status: string;
        blockedReasons: Array<{ code: string }>;
      };

      // Status is syncing because connectors are pending
      expect(body.status).toBe("syncing");
      expect(
        body.blockedReasons.some((r) => r.code === "AWAITING_FIRST_SYNC")
      ).toBe(true);

      await cleanupStartupHealth(app.runtime.db.db, startupId);
    });
  });

  // =========================================================================
  // Serialization contract
  // =========================================================================

  describe("serialization contract", () => {
    test("payload matches the shared HealthSnapshotSummary interface", async () => {
      await cleanupStartupHealth(app.runtime.db.db, startupId);
      await insertConnector(
        app.runtime.db.db,
        startupId,
        "posthog",
        "connected",
        new Date()
      );
      await insertSnapshot(app.runtime.db.db, startupId, {
        healthState: "ready",
        northStarValue: 7777,
        syncJobId: "test-job-123",
      });

      const res = await makeRequest(app, healthUrl(startupId), {
        headers: { cookie },
      });
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        health: HealthSnapshotSummary;
        connectors: Array<{
          provider: string;
          status: string;
          lastSyncAt: string | null;
          lastSyncError: string | null;
        }>;
        status: string;
        blockedReasons: Array<{ code: string; message: string }>;
        lastSnapshotAt: string | null;
      };

      // Verify all expected top-level keys
      expect(body).toHaveProperty("health");
      expect(body).toHaveProperty("connectors");
      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("blockedReasons");
      expect(body).toHaveProperty("lastSnapshotAt");

      // Verify health snapshot shape
      const h = body.health;
      expect(h.startupId).toBe(startupId);
      expect(h.healthState).toBe("ready");
      expect(h.northStarKey).toBe("mrr");
      expect(typeof h.northStarValue).toBe("number");
      expect(h.supportingMetrics).toBeDefined();
      expect(h.funnel).toBeArray();
      expect(h.computedAt).toBeTruthy();
      expect(h.syncJobId).toBe("test-job-123");

      // Verify funnel stages are all present
      const stageNames = h.funnel.map((f) => f.stage);
      expect(stageNames).toContain("visitor");
      expect(stageNames).toContain("signup");
      expect(stageNames).toContain("activation");
      expect(stageNames).toContain("paying_customer");

      // Clean up
      await cleanupStartupHealth(app.runtime.db.db, startupId);
    });
  });
});
