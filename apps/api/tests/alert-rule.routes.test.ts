/**
 * Alert rule CRUD and triage route tests (TDD — tests first).
 * Covers: create, duplicate 409, list, update, delete cascade, list alerts
 * with status filter, triage ack/snooze/dismiss, bulk triage.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { AlertRuleSummary, AlertSummary } from "@shared/alert-rule";
import type { StartupDraft } from "@shared/types";
import { convertSetCookieToCookie } from "better-auth/test";

import type { ApiApp } from "../src/app";
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
  name: "Alert Rule Test Startup",
  type: "b2b_saas",
  stage: "mvp",
  timezone: "UTC",
  currency: "USD",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let app: ApiApp | undefined;

function getApp() {
  return requireValue(app, "Expected API test app to be initialized.");
}

function getPool() {
  return getApp().runtime.db.pool;
}

async function parseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function send(
  path: string,
  init?: { method?: string; body?: unknown; cookie?: string }
) {
  const testApp = getApp();
  const headers = new Headers();

  if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  if (init?.cookie) {
    headers.set("cookie", init.cookie);
  }

  return testApp.handle(
    new Request(`http://localhost${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  );
}

async function createAuthenticatedSession(email: string) {
  const testApp = getApp();
  const signInResponse = await send("/api/auth/sign-in/magic-link", {
    method: "POST",
    body: { email, name: "Alert Tester" },
  });
  expect(signInResponse.status).toBe(200);

  const magicLink = requireValue(
    testApp.runtime.auth.getLatestMagicLink(email),
    `Expected magic link for ${email}.`
  );
  const verifyResponse = await testApp.handle(new Request(magicLink.url));
  const cookie =
    convertSetCookieToCookie(verifyResponse.headers).get("cookie") ?? "";
  expect(cookie.length).toBeGreaterThan(0);

  return { cookie };
}

async function createWorkspace(cookie: string, name: string) {
  const response = await send("/api/workspaces", {
    method: "POST",
    cookie,
    body: { name },
  });
  const payload = await parseJson(response);
  expect(response.status).toBe(201);
  return payload.workspace as { id: string; name: string; slug: string };
}

async function createStartup(
  cookie: string,
  overrides?: Partial<StartupDraft>
) {
  const response = await send("/api/startups", {
    method: "POST",
    cookie,
    body: { ...VALID_STARTUP, ...overrides },
  });
  const payload = await parseJson(response);
  expect(response.status).toBe(201);
  return payload.startup as { id: string; name: string; workspaceId: string };
}

async function setupWorkspaceAndStartup(email: string) {
  const { cookie } = await createAuthenticatedSession(email);
  await createWorkspace(cookie, `Alert WS ${Date.now()}`);
  const startup = await createStartup(cookie);
  return { cookie, startup };
}

/**
 * Seed an alert directly in the DB for triage tests.
 */
async function seedAlert(
  startupId: string,
  ruleId: string,
  overrides?: {
    id?: string;
    status?: string;
    occurrenceCount?: number;
    snoozedUntil?: string | null;
  }
) {
  const pool = getPool();
  const id = overrides?.id ?? randomUUID();
  const status = overrides?.status ?? "active";
  const occurrenceCount = overrides?.occurrenceCount ?? 1;
  const snoozedUntilClause =
    overrides?.snoozedUntil == null ? "NULL" : `'${overrides.snoozedUntil}'`;

  await pool.query(
    `INSERT INTO "alert" (id, startup_id, rule_id, metric_key, severity, value, threshold, status, occurrence_count, snoozed_until, fired_at, last_fired_at, created_at)
     VALUES ('${id}', '${startupId}', '${ruleId}', 'mrr', 'critical', '1000', '20', '${status}', ${occurrenceCount}, ${snoozedUntilClause}, NOW(), NOW(), NOW())`
  );

  return id;
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

let cookie: string;
let startupId: string;

beforeAll(async () => {
  app = await createTestApiApp({
    posthogValidator: createStubPostHogValidator(),
    stripeValidator: createStubStripeValidator(),
    queueProducer: createStubQueueProducer(),
    taskSyncQueueProducer: createStubTaskSyncQueueProducer(),
  });

  const runId = Date.now();
  const result = await setupWorkspaceAndStartup(
    `alert-rule-${runId}@example.com`
  );
  cookie = result.cookie;
  startupId = result.startup.id;
});

afterAll(async () => {
  await closeTestApiApp(app);
});

// ---------------------------------------------------------------------------
// POST /api/startups/:startupId/alert-rules — Create rule
// ---------------------------------------------------------------------------

describe("POST /api/startups/:startupId/alert-rules", () => {
  test("returns 201 with created rule", async () => {
    const response = await send(`/api/startups/${startupId}/alert-rules`, {
      method: "POST",
      cookie,
      body: {
        metricKey: "mrr",
        condition: "drop_wow_pct",
        threshold: 20,
        severity: "critical",
      },
    });

    expect(response.status).toBe(201);

    const payload = (await response.json()) as { rule: AlertRuleSummary };
    expect(payload.rule).toBeDefined();
    expect(payload.rule.metricKey).toBe("mrr");
    expect(payload.rule.condition).toBe("drop_wow_pct");
    expect(payload.rule.threshold).toBe(20);
    expect(payload.rule.severity).toBe("critical");
    expect(payload.rule.enabled).toBe(true);
    expect(payload.rule.startupId).toBe(startupId);
    expect(payload.rule.id).toBeTruthy();
    expect(payload.rule.createdAt).toBeTruthy();
  });

  test("returns 409 on duplicate (same startup+metric+condition)", async () => {
    // First create should succeed (may already exist from previous test)
    await send(`/api/startups/${startupId}/alert-rules`, {
      method: "POST",
      cookie,
      body: {
        metricKey: "active_users",
        condition: "drop_wow_pct",
        threshold: 25,
        severity: "high",
      },
    });

    // Second create with same startup+metric+condition should 409
    const response = await send(`/api/startups/${startupId}/alert-rules`, {
      method: "POST",
      cookie,
      body: {
        metricKey: "active_users",
        condition: "drop_wow_pct",
        threshold: 30,
        severity: "medium",
      },
    });

    expect(response.status).toBe(409);
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GET /api/startups/:startupId/alert-rules — List rules
// ---------------------------------------------------------------------------

describe("GET /api/startups/:startupId/alert-rules", () => {
  test("returns all rules for startup", async () => {
    const response = await send(`/api/startups/${startupId}/alert-rules`, {
      cookie,
    });

    expect(response.status).toBe(200);

    const payload = (await response.json()) as { rules: AlertRuleSummary[] };
    expect(Array.isArray(payload.rules)).toBe(true);
    expect(payload.rules.length).toBeGreaterThanOrEqual(1);

    const rule = payload.rules[0];
    expect(rule?.id).toBeTruthy();
    expect(rule?.startupId).toBe(startupId);
    expect(rule?.metricKey).toBeTruthy();
    expect(rule?.condition).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/startups/:startupId/alert-rules/:ruleId — Update rule
// ---------------------------------------------------------------------------

describe("PATCH /api/startups/:startupId/alert-rules/:ruleId", () => {
  test("changes threshold and severity", async () => {
    // Create a rule to update
    const createRes = await send(`/api/startups/${startupId}/alert-rules`, {
      method: "POST",
      cookie,
      body: {
        metricKey: "churn_rate",
        condition: "above_threshold",
        threshold: 5,
        severity: "medium",
      },
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { rule: AlertRuleSummary };
    const ruleId = created.rule.id;

    // Update threshold and severity
    const updateRes = await send(
      `/api/startups/${startupId}/alert-rules/${ruleId}`,
      {
        method: "PATCH",
        cookie,
        body: {
          threshold: 10,
          severity: "critical",
        },
      }
    );

    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as { rule: AlertRuleSummary };
    expect(updated.rule.threshold).toBe(10);
    expect(updated.rule.severity).toBe("critical");
    expect(updated.rule.id).toBe(ruleId);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/startups/:startupId/alert-rules/:ruleId — Delete rule
// ---------------------------------------------------------------------------

describe("DELETE /api/startups/:startupId/alert-rules/:ruleId", () => {
  test("removes rule and cascaded alerts", async () => {
    // Create a rule
    const createRes = await send(`/api/startups/${startupId}/alert-rules`, {
      method: "POST",
      cookie,
      body: {
        metricKey: "burn_rate",
        condition: "above_threshold",
        threshold: 100,
        severity: "high",
      },
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { rule: AlertRuleSummary };
    const ruleId = created.rule.id;

    // Seed an alert for this rule directly in DB
    await seedAlert(startupId, ruleId);

    // Delete the rule
    const deleteRes = await send(
      `/api/startups/${startupId}/alert-rules/${ruleId}`,
      { method: "DELETE", cookie }
    );

    expect(deleteRes.status).toBe(200);

    // Verify rule is gone
    const listRes = await send(`/api/startups/${startupId}/alert-rules`, {
      cookie,
    });
    const payload = (await listRes.json()) as { rules: AlertRuleSummary[] };
    const found = payload.rules.find((r) => r.id === ruleId);
    expect(found).toBeUndefined();

    // Verify cascaded alerts are also gone
    const result = (await getPool().query(
      `SELECT id FROM "alert" WHERE rule_id = '${ruleId}'`
    )) as { rows: { id: string }[] };
    expect(result.rows.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/startups/:startupId/alerts — List alerts
// ---------------------------------------------------------------------------

describe("GET /api/startups/:startupId/alerts", () => {
  test("returns alerts with optional status filter", async () => {
    // Create a fresh rule and seed alerts with different statuses
    const createRes = await send(`/api/startups/${startupId}/alert-rules`, {
      method: "POST",
      cookie,
      body: {
        metricKey: "revenue_growth",
        condition: "below_threshold",
        threshold: 10,
        severity: "high",
      },
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { rule: AlertRuleSummary };
    const ruleId = created.rule.id;

    await seedAlert(startupId, ruleId, { status: "active" });
    await seedAlert(startupId, ruleId, { status: "acknowledged" });
    await seedAlert(startupId, ruleId, { status: "dismissed" });

    // List all alerts (no filter)
    const allRes = await send(`/api/startups/${startupId}/alerts`, { cookie });
    expect(allRes.status).toBe(200);
    const allPayload = (await allRes.json()) as { alerts: AlertSummary[] };
    expect(Array.isArray(allPayload.alerts)).toBe(true);
    expect(allPayload.alerts.length).toBeGreaterThanOrEqual(3);

    // Filter by status=active
    const activeRes = await send(
      `/api/startups/${startupId}/alerts?status=active`,
      { cookie }
    );
    expect(activeRes.status).toBe(200);
    const activePayload = (await activeRes.json()) as {
      alerts: AlertSummary[];
    };
    for (const a of activePayload.alerts) {
      expect(a.status).toBe("active");
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/alerts/:alertId/triage — Triage individual alert
// ---------------------------------------------------------------------------

describe("POST /api/alerts/:alertId/triage", () => {
  test("ack sets status to acknowledged", async () => {
    // Create rule + seed active alert
    const createRes = await send(`/api/startups/${startupId}/alert-rules`, {
      method: "POST",
      cookie,
      body: {
        metricKey: "ack_test_metric",
        condition: "above_threshold",
        threshold: 50,
        severity: "medium",
      },
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { rule: AlertRuleSummary };
    const alertId = await seedAlert(startupId, created.rule.id, {
      status: "active",
    });

    const res = await send(`/api/alerts/${alertId}/triage`, {
      method: "POST",
      cookie,
      body: { action: "ack" },
    });

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { alert: AlertSummary };
    expect(payload.alert.status).toBe("acknowledged");
  });

  test("snooze sets snoozedUntil", async () => {
    const createRes = await send(`/api/startups/${startupId}/alert-rules`, {
      method: "POST",
      cookie,
      body: {
        metricKey: "snooze_test_metric",
        condition: "above_threshold",
        threshold: 50,
        severity: "medium",
      },
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { rule: AlertRuleSummary };
    const alertId = await seedAlert(startupId, created.rule.id, {
      status: "active",
    });

    const res = await send(`/api/alerts/${alertId}/triage`, {
      method: "POST",
      cookie,
      body: { action: "snooze", snoozeDurationHours: 24 },
    });

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { alert: AlertSummary };
    expect(payload.alert.status).toBe("snoozed");
    expect(payload.alert.snoozedUntil).toBeTruthy();

    // snoozedUntil should be approximately 24 hours from now
    const snoozedUntil = new Date(
      payload.alert.snoozedUntil as string
    ).getTime();
    const expectedMin = Date.now() + 23 * 60 * 60 * 1000;
    const expectedMax = Date.now() + 25 * 60 * 60 * 1000;
    expect(snoozedUntil).toBeGreaterThan(expectedMin);
    expect(snoozedUntil).toBeLessThan(expectedMax);
  });
});

// ---------------------------------------------------------------------------
// POST /api/startups/:startupId/alerts/bulk-triage — Bulk triage
// ---------------------------------------------------------------------------

describe("POST /api/startups/:startupId/alerts/bulk-triage", () => {
  test("updates multiple alerts", async () => {
    const createRes = await send(`/api/startups/${startupId}/alert-rules`, {
      method: "POST",
      cookie,
      body: {
        metricKey: "bulk_test_metric",
        condition: "below_threshold",
        threshold: 5,
        severity: "low",
      },
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { rule: AlertRuleSummary };
    const ruleId = created.rule.id;

    const alertId1 = await seedAlert(startupId, ruleId, { status: "active" });
    const alertId2 = await seedAlert(startupId, ruleId, { status: "active" });

    const res = await send(`/api/startups/${startupId}/alerts/bulk-triage`, {
      method: "POST",
      cookie,
      body: {
        action: "dismiss",
        alertIds: [alertId1, alertId2],
      },
    });

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { updated: number };
    expect(payload.updated).toBe(2);

    // Verify both are dismissed
    const checkRes = await send(
      `/api/startups/${startupId}/alerts?status=dismissed`,
      { cookie }
    );
    const checkPayload = (await checkRes.json()) as {
      alerts: AlertSummary[];
    };
    const dismissedIds = checkPayload.alerts.map((a) => a.id);
    expect(dismissedIds).toContain(alertId1);
    expect(dismissedIds).toContain(alertId2);
  });
});
