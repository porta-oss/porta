/**
 * Event log route tests (TDD — tests first).
 * Covers: paginated event query, cursor pagination, workspace tenant isolation,
 * eventTypes filter, date range filter, startupId filter, limit clamping, empty results.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { EventLogEntrySummary } from "@shared/event-log";
import type { StartupDraft } from "@shared/types";
import { convertSetCookieToCookie } from "better-auth/test";
import { sql } from "drizzle-orm";

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
  name: "Event Log Test Startup",
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
      body: JSON.stringify({ email, name: "Event Log Tester" }),
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

async function insertEvent(
  db: ApiApp["runtime"]["db"]["db"],
  workspaceId: string,
  opts: {
    startupId?: string | null;
    eventType?: string;
    actorType?: string;
    actorId?: string | null;
    payload?: Record<string, unknown>;
    createdAt?: string;
  } = {}
): Promise<string> {
  const eventId = randomUUID();
  const eventType = opts.eventType ?? "connector.synced";
  const actorType = opts.actorType ?? "system";
  const payload = opts.payload ?? {
    connectorId: `c-${randomUUID()}`,
    provider: "stripe",
    recordsProcessed: 42,
  };
  const createdAt = opts.createdAt ?? new Date().toISOString();

  await db.execute(
    sql`INSERT INTO event_log (id, workspace_id, startup_id, event_type, actor_type, actor_id, payload, created_at)
        VALUES (${eventId}, ${workspaceId}, ${opts.startupId ?? null}, ${eventType}, ${actorType}, ${opts.actorId ?? null}, ${JSON.stringify(payload)}::jsonb, ${createdAt}::timestamptz)`
  );

  return eventId;
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

let app: ApiApp | undefined;
let cookie: string;
let workspaceId: string;
let startupId: string;

function getApp() {
  return requireValue(app, "Expected API test app to be initialized.");
}

beforeAll(async () => {
  app = await createTestApiApp({
    posthogValidator: createStubPostHogValidator(),
    stripeValidator: createStubStripeValidator(),
    queueProducer: createStubQueueProducer(),
    taskSyncQueueProducer: createStubTaskSyncQueueProducer(),
  });

  const runId = Date.now();
  const testApp = getApp();
  cookie = await signUp(testApp, `event-log-${runId}@example.com`);
  workspaceId = await createWorkspace(testApp, cookie, `Event Log WS ${runId}`);
  startupId = await createStartup(testApp, cookie, VALID_STARTUP);
});

afterAll(async () => {
  await closeTestApiApp(app);
});

// ---------------------------------------------------------------------------
// GET /api/events — Event log query
// ---------------------------------------------------------------------------

describe("GET /api/events", () => {
  test("rejects unauthenticated requests with 401", async () => {
    const res = await makeRequest(getApp(), "http://localhost:3000/api/events");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  test("returns paginated events for workspace", async () => {
    const testApp = getApp();

    // Insert 3 events with distinct timestamps
    for (let i = 0; i < 3; i++) {
      await insertEvent(testApp.runtime.db.db, workspaceId, {
        startupId,
        eventType: "connector.synced",
        createdAt: new Date(Date.now() - (3 - i) * 1000).toISOString(),
      });
    }

    const res = await makeRequest(testApp, "http://localhost:3000/api/events", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      events: EventLogEntrySummary[];
      pagination: { cursor: string | null; hasMore: boolean; limit: number };
    };

    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThanOrEqual(3);
    expect(body.pagination).toBeDefined();
    expect(typeof body.pagination.hasMore).toBe("boolean");
    expect(body.pagination.limit).toBe(50);

    // Verify events are sorted by created_at DESC
    for (let i = 1; i < body.events.length; i++) {
      const prev = new Date(body.events[i - 1]?.createdAt ?? 0).getTime();
      const curr = new Date(body.events[i]?.createdAt ?? 0).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }

    // Verify event shape
    const event = requireValue(body.events[0], "Expected at least one event");
    expect(event.id).toBeTruthy();
    expect(event.workspaceId).toBe(workspaceId);
    expect(event.eventType).toBeTruthy();
    expect(event.actorType).toBeTruthy();
    expect(event.payload).toBeDefined();
    expect(event.createdAt).toBeTruthy();
  });

  test("cursor pagination returns next page correctly", async () => {
    const testApp = getApp();

    // Clean existing events and insert exactly 5 with distinct timestamps
    await testApp.runtime.db.db.execute(
      sql`DELETE FROM event_log WHERE workspace_id = ${workspaceId}`
    );
    for (let i = 0; i < 5; i++) {
      await insertEvent(testApp.runtime.db.db, workspaceId, {
        startupId,
        eventType: "connector.synced",
        createdAt: new Date(Date.now() - (5 - i) * 1000).toISOString(),
      });
    }

    // Page 1: limit=3
    const res1 = await makeRequest(
      testApp,
      "http://localhost:3000/api/events?limit=3",
      { headers: { cookie } }
    );
    expect(res1.status).toBe(200);

    const page1 = (await res1.json()) as {
      events: EventLogEntrySummary[];
      pagination: { cursor: string | null; hasMore: boolean; limit: number };
    };

    expect(page1.events.length).toBe(3);
    expect(page1.pagination.hasMore).toBe(true);
    expect(page1.pagination.cursor).toBeTruthy();
    expect(page1.pagination.limit).toBe(3);

    // Page 2: use cursor from page 1
    const res2 = await makeRequest(
      testApp,
      `http://localhost:3000/api/events?limit=3&cursor=${page1.pagination.cursor}`,
      { headers: { cookie } }
    );
    expect(res2.status).toBe(200);

    const page2 = (await res2.json()) as {
      events: EventLogEntrySummary[];
      pagination: { cursor: string | null; hasMore: boolean; limit: number };
    };

    expect(page2.events.length).toBe(2);
    expect(page2.pagination.hasMore).toBe(false);

    // Verify no overlap between pages
    const page1Ids = new Set(page1.events.map((e) => e.id));
    for (const event of page2.events) {
      expect(page1Ids.has(event.id)).toBe(false);
    }

    // Page 2 events should be older than page 1 events
    const oldestPage1 = new Date(
      page1.events.at(-1)?.createdAt ?? ""
    ).getTime();
    const newestPage2 = new Date(page2.events[0]?.createdAt ?? "").getTime();
    expect(oldestPage1).toBeGreaterThanOrEqual(newestPage2);
  });

  test("workspace tenant isolation prevents seeing other workspace events", async () => {
    const testApp = getApp();
    const runId2 = Date.now();

    // Create a second user + workspace
    const cookie2 = await signUp(
      testApp,
      `other-event-user-${runId2}@example.com`
    );
    const ws2Id = await createWorkspace(
      testApp,
      cookie2,
      `Other Event WS ${runId2}`
    );

    // Insert events in both workspaces
    await insertEvent(testApp.runtime.db.db, workspaceId, {
      eventType: "alert.fired",
      payload: {
        metricKey: "mrr",
        ruleId: "r1",
        severity: "warn",
        threshold: 100,
        value: 50,
      },
    });
    await insertEvent(testApp.runtime.db.db, ws2Id, {
      eventType: "task.created",
      payload: { taskId: "t1", title: "Other workspace task" },
    });

    // User 1 should only see their workspace's events
    const res1 = await makeRequest(
      testApp,
      "http://localhost:3000/api/events",
      { headers: { cookie } }
    );
    const body1 = (await res1.json()) as {
      events: EventLogEntrySummary[];
    };
    for (const event of body1.events) {
      expect(event.workspaceId).toBe(workspaceId);
    }

    // User 2 should only see their workspace's events
    const res2 = await makeRequest(
      testApp,
      "http://localhost:3000/api/events",
      { headers: { cookie: cookie2 } }
    );
    const body2 = (await res2.json()) as {
      events: EventLogEntrySummary[];
    };
    for (const event of body2.events) {
      expect(event.workspaceId).toBe(ws2Id);
    }
  });

  test("eventTypes filter returns only matching types", async () => {
    const testApp = getApp();

    // Clean and insert events of different types
    await testApp.runtime.db.db.execute(
      sql`DELETE FROM event_log WHERE workspace_id = ${workspaceId}`
    );
    await insertEvent(testApp.runtime.db.db, workspaceId, {
      eventType: "connector.synced",
      payload: {
        connectorId: "c1",
        provider: "stripe",
        recordsProcessed: 10,
      },
    });
    await insertEvent(testApp.runtime.db.db, workspaceId, {
      eventType: "alert.fired",
      payload: {
        metricKey: "mrr",
        ruleId: "r1",
        severity: "warn",
        threshold: 100,
        value: 50,
      },
    });
    await insertEvent(testApp.runtime.db.db, workspaceId, {
      eventType: "task.created",
      payload: { taskId: "t1", title: "Test task" },
    });

    // Filter for connector.synced only
    const res = await makeRequest(
      testApp,
      "http://localhost:3000/api/events?eventTypes=connector.synced",
      { headers: { cookie } }
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { events: EventLogEntrySummary[] };
    expect(body.events.length).toBe(1);
    expect(body.events[0]?.eventType).toBe("connector.synced");

    // Filter for multiple types
    const res2 = await makeRequest(
      testApp,
      "http://localhost:3000/api/events?eventTypes=alert.fired,task.created",
      { headers: { cookie } }
    );
    expect(res2.status).toBe(200);

    const body2 = (await res2.json()) as { events: EventLogEntrySummary[] };
    expect(body2.events.length).toBe(2);
    const types = new Set(body2.events.map((e) => e.eventType));
    expect(types.has("alert.fired")).toBe(true);
    expect(types.has("task.created")).toBe(true);
  });

  test("date range filter (from/to)", async () => {
    const testApp = getApp();

    // Clean and insert events at specific times
    await testApp.runtime.db.db.execute(
      sql`DELETE FROM event_log WHERE workspace_id = ${workspaceId}`
    );

    const t1 = new Date("2025-01-15T10:00:00Z");
    const t2 = new Date("2025-01-15T12:00:00Z");
    const t3 = new Date("2025-01-15T14:00:00Z");

    await insertEvent(testApp.runtime.db.db, workspaceId, {
      eventType: "connector.synced",
      createdAt: t1.toISOString(),
      payload: {
        connectorId: "c1",
        provider: "stripe",
        recordsProcessed: 1,
      },
    });
    await insertEvent(testApp.runtime.db.db, workspaceId, {
      eventType: "connector.synced",
      createdAt: t2.toISOString(),
      payload: {
        connectorId: "c2",
        provider: "stripe",
        recordsProcessed: 2,
      },
    });
    await insertEvent(testApp.runtime.db.db, workspaceId, {
      eventType: "connector.synced",
      createdAt: t3.toISOString(),
      payload: {
        connectorId: "c3",
        provider: "stripe",
        recordsProcessed: 3,
      },
    });

    // from only: events >= t2
    const resFrom = await makeRequest(
      testApp,
      `http://localhost:3000/api/events?from=${t2.toISOString()}`,
      { headers: { cookie } }
    );
    expect(resFrom.status).toBe(200);
    const bodyFrom = (await resFrom.json()) as {
      events: EventLogEntrySummary[];
    };
    expect(bodyFrom.events.length).toBe(2);

    // to only: events <= t2
    const resTo = await makeRequest(
      testApp,
      `http://localhost:3000/api/events?to=${t2.toISOString()}`,
      { headers: { cookie } }
    );
    expect(resTo.status).toBe(200);
    const bodyTo = (await resTo.json()) as {
      events: EventLogEntrySummary[];
    };
    expect(bodyTo.events.length).toBe(2);

    // both from and to: events between t1+1ms and t3-1ms (only t2)
    const fromBound = new Date(t1.getTime() + 1).toISOString();
    const toBound = new Date(t3.getTime() - 1).toISOString();
    const resBoth = await makeRequest(
      testApp,
      `http://localhost:3000/api/events?from=${fromBound}&to=${toBound}`,
      { headers: { cookie } }
    );
    expect(resBoth.status).toBe(200);
    const bodyBoth = (await resBoth.json()) as {
      events: EventLogEntrySummary[];
    };
    expect(bodyBoth.events.length).toBe(1);
  });

  test("startupId filter returns only events for that startup", async () => {
    const testApp = getApp();

    // Create a second startup
    const startup2Id = await createStartup(testApp, cookie, {
      ...VALID_STARTUP,
      name: `Event Log Startup 2 ${Date.now()}`,
    });

    // Clean and insert events for different startups
    await testApp.runtime.db.db.execute(
      sql`DELETE FROM event_log WHERE workspace_id = ${workspaceId}`
    );
    await insertEvent(testApp.runtime.db.db, workspaceId, {
      startupId,
      eventType: "connector.synced",
      payload: {
        connectorId: "c1",
        provider: "stripe",
        recordsProcessed: 10,
      },
    });
    await insertEvent(testApp.runtime.db.db, workspaceId, {
      startupId: startup2Id,
      eventType: "connector.synced",
      payload: {
        connectorId: "c2",
        provider: "posthog",
        recordsProcessed: 20,
      },
    });
    await insertEvent(testApp.runtime.db.db, workspaceId, {
      startupId: null,
      eventType: "task.created",
      payload: { taskId: "t1", title: "Workspace-level event" },
    });

    // Filter for startupId
    const res = await makeRequest(
      testApp,
      `http://localhost:3000/api/events?startupId=${startupId}`,
      { headers: { cookie } }
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { events: EventLogEntrySummary[] };
    expect(body.events.length).toBe(1);
    expect(body.events[0]?.startupId).toBe(startupId);
  });

  test("limit parameter defaults to 50, max 200, clamped", async () => {
    const testApp = getApp();

    // Default limit check — already tested above, but verify pagination.limit
    const resDefault = await makeRequest(
      testApp,
      "http://localhost:3000/api/events",
      { headers: { cookie } }
    );
    expect(resDefault.status).toBe(200);
    const bodyDefault = (await resDefault.json()) as {
      pagination: { limit: number };
    };
    expect(bodyDefault.pagination.limit).toBe(50);

    // Explicit limit=5
    const resSmall = await makeRequest(
      testApp,
      "http://localhost:3000/api/events?limit=5",
      { headers: { cookie } }
    );
    expect(resSmall.status).toBe(200);
    const bodySmall = (await resSmall.json()) as {
      pagination: { limit: number };
    };
    expect(bodySmall.pagination.limit).toBe(5);

    // Limit > 200 should be clamped to 200
    const resOver = await makeRequest(
      testApp,
      "http://localhost:3000/api/events?limit=500",
      { headers: { cookie } }
    );
    expect(resOver.status).toBe(200);
    const bodyOver = (await resOver.json()) as {
      pagination: { limit: number };
    };
    expect(bodyOver.pagination.limit).toBe(200);

    // Limit <= 0 should fall back to default 50
    const resZero = await makeRequest(
      testApp,
      "http://localhost:3000/api/events?limit=0",
      { headers: { cookie } }
    );
    expect(resZero.status).toBe(200);
    const bodyZero = (await resZero.json()) as {
      pagination: { limit: number };
    };
    expect(bodyZero.pagination.limit).toBe(50);
  });

  test("empty result returns correct shape", async () => {
    const testApp = getApp();
    const runId3 = Date.now();

    // Create a fresh user+workspace with zero events
    const cookie3 = await signUp(
      testApp,
      `empty-event-user-${runId3}@example.com`
    );
    await createWorkspace(testApp, cookie3, `Empty Event WS ${runId3}`);

    const res = await makeRequest(testApp, "http://localhost:3000/api/events", {
      headers: { cookie: cookie3 },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      events: EventLogEntrySummary[];
      pagination: { cursor: string | null; hasMore: boolean; limit: number };
    };

    expect(body.events).toEqual([]);
    expect(body.pagination.cursor).toBeNull();
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.limit).toBe(50);
  });
});
