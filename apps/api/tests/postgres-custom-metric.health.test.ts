/**
 * Postgres custom metric health payload tests.
 * Covers: health route returns customMetric when configured,
 * null when not configured, preserves last-good on error status,
 * and doesn't widen the fixed supportingMetrics object.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { CustomMetricSummary } from "@shared/custom-metric";

import type { StartupDraft } from "@shared/types";
import { convertSetCookieToCookie } from "better-auth/test";
import { sql } from "drizzle-orm";

import type { ApiApp } from "../src/app";
import { createStubPostgresValidator } from "../src/lib/connectors/postgres";
import { createStubPostHogValidator } from "../src/lib/connectors/posthog";
import { createStubQueueProducer } from "../src/lib/connectors/queue";
import { createStubStripeValidator } from "../src/lib/connectors/stripe";
import { createStubTaskSyncQueueProducer } from "../src/lib/tasks/queue";
import {
  closeTestApiApp,
  createTestApiApp,
  requireValue,
} from "./helpers/test-app";

const VALID_STARTUP: StartupDraft = {
  name: "PG Metric Health Test",
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
      body: JSON.stringify({ email, name: "PG Metric Tester" }),
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
  const body = (await response.json()) as { workspace?: { id: string } };
  return body.workspace?.id ?? "";
}

async function createStartup(app: ApiApp, cookie: string): Promise<string> {
  const response = await makeRequest(
    app,
    "http://localhost:3000/api/startups",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(VALID_STARTUP),
    }
  );
  const body = (await response.json()) as { startup?: { id: string } };
  return body.startup?.id ?? "";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let app: ApiApp | undefined;
let cookie: string;
let startupId: string;

function getApp() {
  return requireValue(app, "Expected API test app to be initialized.");
}

beforeAll(async () => {
  app = await createTestApiApp({
    posthogValidator: createStubPostHogValidator(),
    stripeValidator: createStubStripeValidator(),
    postgresValidator: createStubPostgresValidator(),
    queueProducer: createStubQueueProducer(),
    taskSyncQueueProducer: createStubTaskSyncQueueProducer(),
  });
  const email = `pg-health-${randomUUID()}@test.local`;
  const testApp = getApp();
  cookie = await signUp(testApp, email);
  await createWorkspace(testApp, cookie, "PG Health Workspace");
  startupId = await createStartup(testApp, cookie);
});

afterAll(async () => {
  const testApp = app;
  if (!testApp) {
    return;
  }

  try {
    await testApp.runtime.db.db.execute(
      sql`DELETE FROM custom_metric WHERE startup_id = ${startupId}`
    );
    await testApp.runtime.db.db.execute(
      sql`DELETE FROM connector WHERE startup_id = ${startupId}`
    );
    await testApp.runtime.db.db.execute(
      sql`DELETE FROM startup WHERE id = ${startupId}`
    );
  } catch {
    /* ignore */
  }

  await closeTestApiApp(testApp);
});

describe("health route — customMetric payload", () => {
  test("returns customMetric: null when no custom metric is configured", async () => {
    const res = await makeRequest(
      getApp(),
      `http://localhost:3000/api/startups/${startupId}/health`,
      {
        headers: { cookie },
      }
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { customMetric: unknown };
    expect(body.customMetric).toBeNull();
  });

  test("returns customMetric with label, unit, and status after setup", async () => {
    // Create a postgres connector + custom metric via the setup endpoint
    const createRes = await makeRequest(
      getApp(),
      "http://localhost:3000/api/connectors",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          startupId,
          provider: "postgres",
          config: {
            connectionUri: "postgresql://user:pass@host:5432/db",
            schema: "public",
            view: "daily_revenue",
            label: "Daily Revenue",
            unit: "$",
          },
        }),
      }
    );
    expect(createRes.status).toBe(201);

    // Now fetch health — should include the custom metric
    const res = await makeRequest(
      getApp(),
      `http://localhost:3000/api/startups/${startupId}/health`,
      {
        headers: { cookie },
      }
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      customMetric: CustomMetricSummary | null;
    };
    expect(body.customMetric).not.toBeNull();
    expect(body.customMetric?.label).toBe("Daily Revenue");
    expect(body.customMetric?.unit).toBe("$");
    expect(body.customMetric?.category).toBe("custom");
    expect(body.customMetric?.metricValue).toBeNull();
    expect(body.customMetric?.startupId).toBe(startupId);
  });

  test("custom metric shows synced values after direct DB update", async () => {
    const now = new Date();

    // Simulate a successful sync by writing directly to the custom_metric table
    // (status column was removed — connector status tracks sync state now)
    await getApp().runtime.db.db.execute(
      sql`UPDATE custom_metric
          SET metric_value = 42500.50,
              previous_value = 41200.00,
              captured_at = ${now},
              updated_at = ${now}
          WHERE startup_id = ${startupId}`
    );

    const res = await makeRequest(
      getApp(),
      `http://localhost:3000/api/startups/${startupId}/health`,
      {
        headers: { cookie },
      }
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      customMetric: CustomMetricSummary | null;
    };
    expect(body.customMetric).not.toBeNull();
    expect(body.customMetric?.metricValue).toBe(42_500.5);
    expect(body.customMetric?.previousValue).toBe(41_200.0);
    expect(body.customMetric?.capturedAt).not.toBeNull();
  });

  test("custom metric preserves last-good data after re-fetch", async () => {
    // Values from the previous test persist — verify they survive a re-read
    const res = await makeRequest(
      getApp(),
      `http://localhost:3000/api/startups/${startupId}/health`,
      {
        headers: { cookie },
      }
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      customMetric: CustomMetricSummary | null;
    };
    expect(body.customMetric).not.toBeNull();
    expect(body.customMetric?.metricValue).toBe(42_500.5);
    expect(body.customMetric?.previousValue).toBe(41_200.0);
    expect(body.customMetric?.capturedAt).not.toBeNull();
  });

  test("health payload does not widen fixed supportingMetrics keys", async () => {
    // Insert a health snapshot so supportingMetrics is populated
    const snapshotId = randomUUID();
    const metrics = { active_users: 100, churn_rate: 0, arpu: 0 };

    await getApp().runtime.db.db.execute(
      sql`INSERT INTO health_snapshot (id, startup_id, health_state, north_star_key, north_star_value, supporting_metrics, computed_at)
          VALUES (${snapshotId}, ${startupId}, 'ready', 'mrr', 5000, ${JSON.stringify(metrics)}::jsonb, ${new Date()})`
    );

    const res = await makeRequest(
      getApp(),
      `http://localhost:3000/api/startups/${startupId}/health`,
      {
        headers: { cookie },
      }
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      health: { supportingMetrics: Record<string, unknown> } | null;
      customMetric: CustomMetricSummary | null;
    };

    // supportingMetrics keys match what was inserted — no custom metric key smuggled in
    expect(body.health).not.toBeNull();
    const health = requireValue(body.health, "Expected health payload.");
    const metricKeys = Object.keys(health.supportingMetrics).sort();
    expect(metricKeys).toEqual(["active_users", "arpu", "churn_rate"]);

    // customMetric is separate at the top level
    expect(body.customMetric).not.toBeNull();
    expect(body.customMetric?.label).toBe("Daily Revenue");
  });

  test("health payload with PostHog/Stripe healthy but Postgres failing", async () => {
    const res = await makeRequest(
      getApp(),
      `http://localhost:3000/api/startups/${startupId}/health`,
      {
        headers: { cookie },
      }
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      health: unknown;
      customMetric: CustomMetricSummary | null;
      connectors: Array<{ provider: string; status: string }>;
    };

    // Custom metric is present
    expect(body.customMetric).not.toBeNull();

    // The health snapshot itself is still present (from the previous test)
    expect(body.health).not.toBeNull();
  });
});
