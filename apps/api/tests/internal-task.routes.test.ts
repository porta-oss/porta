/**
 * Internal task route tests.
 * Covers: auth rejection, scope denial, task creation from insight actions,
 * idempotent duplicate retries, missing insight, actionIndex validation,
 * workspace mismatch, and task-list payload shape.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { InternalTaskPayload } from "@shared/internal-task";
import type { InsightConditionCode } from "@shared/startup-insight";

import type { StartupDraft } from "@shared/types";
import { convertSetCookieToCookie } from "better-auth/test";
import { sql } from "drizzle-orm";

import { type ApiApp, createApiApp } from "../src/app";
import { createStubPostHogValidator } from "../src/lib/connectors/posthog";
import { createStubQueueProducer } from "../src/lib/connectors/queue";
import { createStubStripeValidator } from "../src/lib/connectors/stripe";
import { createStubTaskSyncQueueProducer } from "../src/lib/tasks/queue";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const TEST_ENV = {
  NODE_ENV: "test",
  API_PORT: "3000",
  API_URL: "http://localhost:3000",
  WEB_URL: "http://localhost:5173",
  DATABASE_URL:
    "postgres://postgres:postgres@127.0.0.1:5432/founder_control_plane",
  REDIS_URL: "redis://127.0.0.1:6379",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  MAGIC_LINK_SENDER_EMAIL: "dev@founder-control-plane.local",
  CONNECTOR_ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  AUTH_CONTEXT_TIMEOUT_MS: "2000",
  DATABASE_CONNECT_TIMEOUT_MS: "5000",
  DATABASE_POOL_MAX: "5",
} as const;

const VALID_STARTUP: StartupDraft = {
  name: "Task Route Test",
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
      body: JSON.stringify({ email, name: "Task Route Tester" }),
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

function createEvidencePayload(
  conditionCode: InsightConditionCode = "mrr_declining"
) {
  return {
    conditionCode,
    items: [
      {
        metricKey: "mrr",
        label: "Monthly Recurring Revenue",
        currentValue: 9500,
        previousValue: 11_000,
        direction: "down" as const,
      },
      {
        metricKey: "churn_rate",
        label: "Churn Rate",
        currentValue: 8.2,
        previousValue: 4.1,
        direction: "up" as const,
      },
    ],
    snapshotComputedAt: new Date().toISOString(),
    syncJobId: `job-${randomUUID()}`,
  };
}

function createExplanationPayload() {
  return {
    observation: "MRR declined from $11,000 to $9,500 over the last 30 days.",
    hypothesis:
      "Increased churn among mid-tier accounts suggests pricing friction.",
    actions: [
      {
        label: "Review churn cohorts",
        rationale: "Identify which customer segment is leaving.",
      },
      {
        label: "Run pricing experiment",
        rationale: "Test alternative pricing tiers.",
      },
    ],
    model: "claude-sonnet-4-20250514",
    latencyMs: 1200,
  };
}

async function insertInsight(
  db: ApiApp["runtime"]["db"]["db"],
  startupId: string,
  overrides: {
    conditionCode?: InsightConditionCode;
    explanation?: object | null;
  } = {}
): Promise<string> {
  const insightId = `insight-${randomUUID()}`;
  const conditionCode = overrides.conditionCode ?? "mrr_declining";
  const evidence = createEvidencePayload(conditionCode);
  const explanation =
    overrides.explanation === undefined
      ? createExplanationPayload()
      : overrides.explanation;

  await db.execute(
    sql`INSERT INTO startup_insight (id, startup_id, condition_code, evidence, explanation, generation_status, last_error, model, explainer_latency_ms, generated_at, created_at, updated_at)
        VALUES (${insightId}, ${startupId}, ${conditionCode}, ${JSON.stringify(evidence)}::jsonb, ${explanation ? JSON.stringify(explanation) : null}::jsonb, ${"success"}, ${null}, ${"claude-sonnet-4-20250514"}, ${1200}, NOW(), NOW(), NOW())
        ON CONFLICT (startup_id) DO UPDATE SET
          id = ${insightId},
          condition_code = EXCLUDED.condition_code,
          evidence = EXCLUDED.evidence,
          explanation = EXCLUDED.explanation,
          generation_status = EXCLUDED.generation_status,
          generated_at = NOW(),
          updated_at = NOW()`
  );

  return insightId;
}

async function cleanupTasks(
  db: ApiApp["runtime"]["db"]["db"],
  startupId: string
) {
  await db.execute(
    sql`DELETE FROM internal_task WHERE startup_id = ${startupId}`
  );
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

let app: ApiApp;
let cookie: string;
let startupId: string;
let insightId: string;

beforeAll(async () => {
  app = await createApiApp(TEST_ENV, {
    posthogValidator: createStubPostHogValidator(),
    stripeValidator: createStubStripeValidator(),
    queueProducer: createStubQueueProducer(),
    taskSyncQueueProducer: createStubTaskSyncQueueProducer(),
  });

  const runId = Date.now();
  cookie = await signUp(app, `task-rt-${runId}@example.com`);
  await createWorkspace(app, cookie, `Task RT WS ${runId}`);
  startupId = await createStartup(app, cookie, VALID_STARTUP);
  insightId = await insertInsight(app.runtime.db.db, startupId);
});

afterAll(async () => {
  if (app) {
    await app.runtime.db.close();
  }
});

// ---------------------------------------------------------------------------
// POST /api/tasks — Create task from insight action
// ---------------------------------------------------------------------------

describe("POST /api/tasks", () => {
  // ── Auth rejection ──
  test("rejects unauthenticated requests with 401", async () => {
    const res = await makeRequest(app, "http://localhost:3000/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ startupId, actionIndex: 0 }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  // ── Successful task creation ──
  test("creates a task from the first insight action", async () => {
    await cleanupTasks(app.runtime.db.db, startupId);

    const res = await makeRequest(app, "http://localhost:3000/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ startupId, actionIndex: 0 }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      task: InternalTaskPayload;
      created: boolean;
    };

    expect(body.created).toBe(true);
    expect(body.task.startupId).toBe(startupId);
    expect(body.task.sourceInsightId).toBe(insightId);
    expect(body.task.sourceActionIndex).toBe(0);
    expect(body.task.title).toBe("Review churn cohorts");
    expect(body.task.description).toBe(
      "Identify which customer segment is leaving."
    );
    expect(body.task.syncStatus).toBe("not_synced");
    expect(body.task.linearIssueId).toBeNull();
    expect(body.task.lastSyncError).toBeNull();
    expect(body.task.lastSyncAttemptAt).toBeNull();
    expect(body.task.createdAt).toBeTruthy();
    // Linked metric keys from evidence
    expect(body.task.linkedMetricKeys).toContain("mrr");
    expect(body.task.linkedMetricKeys).toContain("churn_rate");
  });

  // ── Creates task from second action ──
  test("creates a task from the second insight action", async () => {
    const res = await makeRequest(app, "http://localhost:3000/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ startupId, actionIndex: 1 }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      task: InternalTaskPayload;
      created: boolean;
    };

    expect(body.created).toBe(true);
    expect(body.task.sourceActionIndex).toBe(1);
    expect(body.task.title).toBe("Run pricing experiment");
    expect(body.task.description).toBe("Test alternative pricing tiers.");
  });

  // ── Idempotent duplicate retry ──
  test("returns existing task on duplicate create (same startup + insight + actionIndex)", async () => {
    // Try to create the same task again (actionIndex 0 already exists)
    const res = await makeRequest(app, "http://localhost:3000/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ startupId, actionIndex: 0 }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      task: InternalTaskPayload;
      created: boolean;
    };

    expect(body.created).toBe(false);
    expect(body.task.sourceActionIndex).toBe(0);
    expect(body.task.title).toBe("Review churn cohorts");
  });

  // ── actionIndex out of bounds ──
  test("rejects actionIndex that exceeds available actions", async () => {
    const res = await makeRequest(app, "http://localhost:3000/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ startupId, actionIndex: 99 }),
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("ACTION_INDEX_OUT_OF_BOUNDS");
    expect(body.error.message).toContain("99");
  });

  // ── Negative actionIndex ──
  test("rejects negative actionIndex", async () => {
    const res = await makeRequest(app, "http://localhost:3000/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ startupId, actionIndex: -1 }),
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_ACTION_INDEX");
  });

  // ── No insight for startup ──
  test("rejects task creation when no insight exists", async () => {
    // Create a fresh startup with no insight
    const freshId = await createStartup(app, cookie, {
      ...VALID_STARTUP,
      name: `No Insight ${Date.now()}`,
    });

    const res = await makeRequest(app, "http://localhost:3000/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ startupId: freshId, actionIndex: 0 }),
    });
    expect(res.status).toBe(422);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NO_INSIGHT_AVAILABLE");
  });

  // ── Insight with null explanation ──
  test("rejects task creation when insight has null explanation", async () => {
    const noExplId = await createStartup(app, cookie, {
      ...VALID_STARTUP,
      name: `Null Expl ${Date.now()}`,
    });
    await insertInsight(app.runtime.db.db, noExplId, { explanation: null });

    const res = await makeRequest(app, "http://localhost:3000/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ startupId: noExplId, actionIndex: 0 }),
    });
    expect(res.status).toBe(422);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INSIGHT_NO_ACTIONS");
  });

  // ── Startup not found ──
  test("returns 404 for non-existent startup", async () => {
    const res = await makeRequest(app, "http://localhost:3000/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ startupId: "nonexistent-id", actionIndex: 0 }),
    });
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("STARTUP_NOT_FOUND");
  });

  // ── Workspace mismatch ──
  test("returns 403 when startup belongs to a different workspace", async () => {
    const runId2 = Date.now();
    const cookie2 = await signUp(app, `other-task-user-${runId2}@example.com`);
    await createWorkspace(app, cookie2, `Other Task WS ${runId2}`);

    const res = await makeRequest(app, "http://localhost:3000/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie2 },
      body: JSON.stringify({ startupId, actionIndex: 0 }),
    });
    expect(res.status).toBe(403);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("STARTUP_SCOPE_INVALID");
  });
});

// ---------------------------------------------------------------------------
// GET /api/tasks — List tasks for a startup
// ---------------------------------------------------------------------------

describe("GET /api/tasks", () => {
  // ── Auth rejection ──
  test("rejects unauthenticated requests with 401", async () => {
    const res = await makeRequest(
      app,
      `http://localhost:3000/api/tasks?startupId=${startupId}`
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  // ── List tasks with results ──
  test("lists tasks for a startup with correct payload shape", async () => {
    const res = await makeRequest(
      app,
      `http://localhost:3000/api/tasks?startupId=${startupId}`,
      {
        headers: { cookie },
      }
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      tasks: InternalTaskPayload[];
      startupId: string;
      count: number;
    };

    expect(body.startupId).toBe(startupId);
    expect(body.count).toBeGreaterThanOrEqual(2);
    expect(body.tasks.length).toBe(body.count);

    // Verify task payload shape
    const task = body.tasks[0]!;
    expect(task.id).toBeTruthy();
    expect(task.startupId).toBe(startupId);
    expect(task.sourceInsightId).toBeTruthy();
    expect(typeof task.sourceActionIndex).toBe("number");
    expect(task.title).toBeTruthy();
    expect(task.description).toBeTruthy();
    expect(Array.isArray(task.linkedMetricKeys)).toBe(true);
    expect(task.syncStatus).toBe("not_synced");
    expect(task.createdAt).toBeTruthy();
  });

  // ── Empty list for startup with no tasks ──
  test("returns empty list when startup has no tasks", async () => {
    const freshId = await createStartup(app, cookie, {
      ...VALID_STARTUP,
      name: `No Tasks ${Date.now()}`,
    });

    const res = await makeRequest(
      app,
      `http://localhost:3000/api/tasks?startupId=${freshId}`,
      {
        headers: { cookie },
      }
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      tasks: InternalTaskPayload[];
      count: number;
    };

    expect(body.tasks).toEqual([]);
    expect(body.count).toBe(0);
  });

  // ── Missing startupId query param ──
  test("rejects request without startupId query parameter", async () => {
    const res = await makeRequest(app, "http://localhost:3000/api/tasks", {
      headers: { cookie },
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_STARTUP_ID");
  });

  // ── Startup not found ──
  test("returns 404 for non-existent startup", async () => {
    const res = await makeRequest(
      app,
      "http://localhost:3000/api/tasks?startupId=nonexistent",
      {
        headers: { cookie },
      }
    );
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("STARTUP_NOT_FOUND");
  });

  // ── Workspace mismatch ──
  test("returns 403 when startup belongs to a different workspace", async () => {
    const runId3 = Date.now();
    const cookie3 = await signUp(app, `list-other-${runId3}@example.com`);
    await createWorkspace(app, cookie3, `List Other WS ${runId3}`);

    const res = await makeRequest(
      app,
      `http://localhost:3000/api/tasks?startupId=${startupId}`,
      {
        headers: { cookie: cookie3 },
      }
    );
    expect(res.status).toBe(403);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("STARTUP_SCOPE_INVALID");
  });

  // ── Tasks ordered by createdAt ASC ──
  test("returns tasks ordered by creation time ascending", async () => {
    const res = await makeRequest(
      app,
      `http://localhost:3000/api/tasks?startupId=${startupId}`,
      {
        headers: { cookie },
      }
    );
    const body = (await res.json()) as { tasks: InternalTaskPayload[] };

    for (let i = 1; i < body.tasks.length; i++) {
      const prev = new Date(body.tasks[i - 1]?.createdAt).getTime();
      const curr = new Date(body.tasks[i]?.createdAt).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });
});
