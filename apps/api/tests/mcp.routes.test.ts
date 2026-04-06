/**
 * MCP tool route tests (TDD).
 * Covers: 8 tool response shapes, scope enforcement (read vs write),
 * rate limiting (429 after 60 req), McpResponse wrapper, McpErrorResponse shape.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { convertSetCookieToCookie } from "better-auth/test";

import type { ApiApp } from "../src/app";
import {
  closeTestApiApp,
  createTestApiApp,
  requireValue,
} from "./helpers/test-app";

let app: ApiApp | undefined;
let cookie: string;
let readApiKey: string;
let writeApiKey: string;
let testStartupId: string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  a: ApiApp,
  url: string,
  init?: RequestInit
): Promise<Response> {
  return a.handle(new Request(url, init));
}

async function signUp(a: ApiApp, email: string): Promise<string> {
  const signInRes = await makeRequest(
    a,
    "http://localhost:3000/api/auth/sign-in/magic-link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: "MCP Tester" }),
    }
  );
  if (!signInRes.ok) {
    throw new Error(`Magic link request failed: ${signInRes.status}`);
  }

  const magicLink = a.runtime.auth.getLatestMagicLink(email);
  if (!magicLink) {
    throw new Error(`No magic link for ${email}`);
  }

  const verifyRes = await a.handle(new Request(magicLink.url));
  const c = convertSetCookieToCookie(verifyRes.headers).get("cookie") ?? "";
  if (!c) {
    throw new Error(`No cookie returned for ${email}`);
  }

  return c;
}

async function createWorkspace(
  a: ApiApp,
  c: string,
  name: string
): Promise<string> {
  const response = await makeRequest(
    a,
    "http://localhost:3000/api/workspaces",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: c },
      body: JSON.stringify({ name }),
    }
  );
  const payload = (await response.json()) as { workspace: { id: string } };
  return payload.workspace.id;
}

async function createStartup(
  a: ApiApp,
  c: string,
  name: string
): Promise<string> {
  const response = await makeRequest(a, "http://localhost:3000/api/startups", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: c },
    body: JSON.stringify({
      name,
      type: "b2b_saas",
      stage: "mvp",
      timezone: "UTC",
      currency: "USD",
    }),
  });
  const payload = (await response.json()) as { startup: { id: string } };
  return payload.startup.id;
}

async function sendWithCookie(
  path: string,
  init?: { method?: string; body?: unknown; cookie?: string }
) {
  const a = requireValue(app, "Expected API test app to be initialized.");
  const headers = new Headers();
  if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (init?.cookie) {
    headers.set("cookie", init.cookie);
  }
  return a.handle(
    new Request(`http://localhost:3000${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  );
}

async function sendWithApiKey(
  path: string,
  apiKey: string,
  init?: { method?: string; body?: unknown }
) {
  const a = requireValue(app, "Expected API test app to be initialized.");
  const headers = new Headers();
  headers.set("authorization", `Bearer ${apiKey}`);
  if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return a.handle(
    new Request(`http://localhost:3000${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  );
}

async function parseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  app = await createTestApiApp();
  const a = requireValue(app, "Expected API test app to be initialized.");
  a.runtime.auth.resetMagicLinks();
  await a.runtime.db.resetAuthTables();

  cookie = await signUp(a, "mcp-tester@example.com");
  await createWorkspace(a, cookie, "MCP Test Workspace");
  testStartupId = await createStartup(a, cookie, "MCP Test Startup");

  // Create read key
  const readKeyRes = await sendWithCookie("/api/settings/api-keys", {
    method: "POST",
    cookie,
    body: { name: "MCP Read Key", scope: "read" },
  });
  const readKeyPayload = await parseJson(readKeyRes);
  readApiKey = readKeyPayload.key as string;

  // Create write key
  const writeKeyRes = await sendWithCookie("/api/settings/api-keys", {
    method: "POST",
    cookie,
    body: { name: "MCP Write Key", scope: "write" },
  });
  const writeKeyPayload = await parseJson(writeKeyRes);
  writeApiKey = writeKeyPayload.key as string;
});

afterAll(async () => {
  await closeTestApiApp(app);
});

// ---------------------------------------------------------------------------
// Read tool response shape tests
// ---------------------------------------------------------------------------

describe("MCP read tools", () => {
  test("GET /api/mcp/metrics returns McpResponse with data array", async () => {
    const response = await sendWithApiKey(
      `/api/mcp/metrics?startupId=${testStartupId}`,
      readApiKey
    );
    const payload = await parseJson(response);

    expect(response.status).toBe(200);
    expect(payload.data).toBeDefined();
    expect(Array.isArray(payload.data)).toBe(true);
    expect(typeof payload.dataAsOf).toBe("string");
    expect(typeof payload.dashboardUrl).toBe("string");
  });

  test("GET /api/mcp/alerts returns McpResponse with data array", async () => {
    const response = await sendWithApiKey("/api/mcp/alerts", readApiKey);
    const payload = await parseJson(response);

    expect(response.status).toBe(200);
    expect(payload.data).toBeDefined();
    expect(Array.isArray(payload.data)).toBe(true);
    expect(typeof payload.dataAsOf).toBe("string");
    expect(typeof payload.dashboardUrl).toBe("string");
  });

  test("GET /api/mcp/at-risk-customers returns McpResponse with data array", async () => {
    const response = await sendWithApiKey(
      `/api/mcp/at-risk-customers?startupId=${testStartupId}`,
      readApiKey
    );
    const payload = await parseJson(response);

    expect(response.status).toBe(200);
    expect(payload.data).toBeDefined();
    expect(Array.isArray(payload.data)).toBe(true);
    expect(typeof payload.dataAsOf).toBe("string");
    expect(typeof payload.dashboardUrl).toBe("string");
  });

  test("GET /api/mcp/activity-log returns McpResponse with data and pagination", async () => {
    const response = await sendWithApiKey("/api/mcp/activity-log", readApiKey);
    const payload = await parseJson(response);

    expect(response.status).toBe(200);
    expect(payload.data).toBeDefined();
    expect(Array.isArray(payload.data)).toBe(true);
    expect(typeof payload.dataAsOf).toBe("string");
    expect(typeof payload.dashboardUrl).toBe("string");
    // Pagination fields should be present
    expect(payload.pagination).toBeDefined();
  });

  test("GET /api/mcp/portfolio-summary returns McpResponse with data object", async () => {
    const response = await sendWithApiKey(
      "/api/mcp/portfolio-summary",
      readApiKey
    );
    const payload = await parseJson(response);

    expect(response.status).toBe(200);
    expect(payload.data).toBeDefined();
    expect(typeof payload.dataAsOf).toBe("string");
    expect(typeof payload.dashboardUrl).toBe("string");
    // Data should have startups array
    const data = payload.data as Record<string, unknown>;
    expect(data.startups).toBeDefined();
    expect(Array.isArray(data.startups)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Write tool response shape tests
// ---------------------------------------------------------------------------

describe("MCP write tools", () => {
  test("POST /api/mcp/tasks returns McpResponse with created task", async () => {
    const response = await sendWithApiKey("/api/mcp/tasks", writeApiKey, {
      method: "POST",
      body: {
        startupId: testStartupId,
        title: "Test MCP task",
        description: "Created via MCP API",
        priority: "medium",
      },
    });
    const payload = await parseJson(response);

    expect(response.status).toBe(201);
    expect(payload.data).toBeDefined();
    expect(typeof payload.dataAsOf).toBe("string");
    expect(typeof payload.dashboardUrl).toBe("string");
    const data = payload.data as Record<string, unknown>;
    expect(data.task).toBeDefined();
  });

  test("POST /api/mcp/alerts/:alertId/snooze returns McpResponse", async () => {
    // Snooze a non-existent alert should return error
    const response = await sendWithApiKey(
      "/api/mcp/alerts/nonexistent-alert-id/snooze",
      writeApiKey,
      { method: "POST", body: { durationHours: 4 } }
    );
    const payload = await parseJson(response);

    // Should get a NOT_FOUND McpErrorResponse
    expect(response.status).toBe(404);
    expect(payload.error).toBeDefined();
    expect(typeof payload.code).toBe("string");
  });

  test("POST /api/mcp/sync returns McpResponse with sync jobs", async () => {
    const response = await sendWithApiKey("/api/mcp/sync", writeApiKey, {
      method: "POST",
      body: { startupId: testStartupId },
    });
    const payload = await parseJson(response);

    // May return 200 with empty array if no connectors, or 200 with sync jobs
    expect(response.status).toBe(200);
    expect(payload.data).toBeDefined();
    expect(typeof payload.dataAsOf).toBe("string");
    expect(typeof payload.dashboardUrl).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Scope enforcement
// ---------------------------------------------------------------------------

describe("MCP scope enforcement", () => {
  test("read key can access read tools (200)", async () => {
    const endpoints = [
      `/api/mcp/metrics?startupId=${testStartupId}`,
      "/api/mcp/alerts",
      `/api/mcp/at-risk-customers?startupId=${testStartupId}`,
      "/api/mcp/activity-log",
      "/api/mcp/portfolio-summary",
    ];

    for (const endpoint of endpoints) {
      const response = await sendWithApiKey(endpoint, readApiKey);
      expect(response.status).toBe(200);
    }
  });

  test("read key cannot access write tools (403)", async () => {
    const writeEndpoints = [
      {
        path: "/api/mcp/tasks",
        method: "POST",
        body: {
          startupId: testStartupId,
          title: "Blocked task",
        },
      },
      {
        path: "/api/mcp/alerts/fake-id/snooze",
        method: "POST",
        body: { durationHours: 4 },
      },
      {
        path: "/api/mcp/sync",
        method: "POST",
        body: { startupId: testStartupId },
      },
    ];

    for (const endpoint of writeEndpoints) {
      const response = await sendWithApiKey(endpoint.path, readApiKey, {
        method: endpoint.method,
        body: endpoint.body,
      });
      expect(response.status).toBe(403);
      const payload = await parseJson(response);
      expect(payload.error).toBeDefined();
      expect(payload.code).toBe("FORBIDDEN");
    }
  });

  test("write key can access all tools (200)", async () => {
    // Read tools
    const readResponse = await sendWithApiKey(
      "/api/mcp/portfolio-summary",
      writeApiKey
    );
    expect(readResponse.status).toBe(200);

    // Write tool (sync with no connectors → 200 with empty data)
    const writeResponse = await sendWithApiKey("/api/mcp/sync", writeApiKey, {
      method: "POST",
      body: { startupId: testStartupId },
    });
    expect(writeResponse.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe("MCP rate limiting", () => {
  test("returns 429 after 60 requests in a sliding window", async () => {
    // Create a dedicated key for rate limit testing
    const rateLimitKeyRes = await sendWithCookie("/api/settings/api-keys", {
      method: "POST",
      cookie,
      body: { name: "Rate Limit Test Key", scope: "read" },
    });
    const rateLimitKeyPayload = await parseJson(rateLimitKeyRes);
    const rateLimitKey = rateLimitKeyPayload.key as string;

    // Send 60 requests (should all succeed)
    for (let i = 0; i < 60; i++) {
      const response = await sendWithApiKey(
        "/api/mcp/portfolio-summary",
        rateLimitKey
      );
      expect(response.status).toBe(200);
    }

    // The 61st request should be rate limited
    const response = await sendWithApiKey(
      "/api/mcp/portfolio-summary",
      rateLimitKey
    );
    expect(response.status).toBe(429);

    const payload = await parseJson(response);
    expect(payload.error).toBeDefined();
    expect(payload.retryAfter).toBeDefined();
    expect(typeof payload.retryAfter).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// McpResponse wrapper validation
// ---------------------------------------------------------------------------

describe("McpResponse wrapper", () => {
  test("has data, dataAsOf, dashboardUrl fields", async () => {
    const response = await sendWithApiKey(
      "/api/mcp/portfolio-summary",
      readApiKey
    );
    const payload = await parseJson(response);

    expect(response.status).toBe(200);
    expect(payload).toHaveProperty("data");
    expect(payload).toHaveProperty("dataAsOf");
    expect(payload).toHaveProperty("dashboardUrl");

    // dataAsOf should be a valid ISO date string
    const dataAsOf = payload.dataAsOf as string;
    expect(Number.isNaN(Date.parse(dataAsOf))).toBe(false);

    // dashboardUrl should look like a URL
    const dashboardUrl = payload.dashboardUrl as string;
    expect(dashboardUrl).toContain("http");
  });
});

// ---------------------------------------------------------------------------
// McpErrorResponse shape
// ---------------------------------------------------------------------------

describe("McpErrorResponse shape", () => {
  test("NOT_FOUND error has error and code fields", async () => {
    const response = await sendWithApiKey(
      "/api/mcp/alerts/nonexistent-id/snooze",
      writeApiKey,
      { method: "POST", body: { durationHours: 4 } }
    );
    const payload = await parseJson(response);

    expect(response.status).toBe(404);
    expect(typeof payload.error).toBe("string");
    expect(payload.code).toBe("NOT_FOUND");
  });

  test("FORBIDDEN error has error and code fields", async () => {
    const response = await sendWithApiKey("/api/mcp/tasks", readApiKey, {
      method: "POST",
      body: {
        startupId: testStartupId,
        title: "Forbidden task",
      },
    });
    const payload = await parseJson(response);

    expect(response.status).toBe(403);
    expect(typeof payload.error).toBe("string");
    expect(payload.code).toBe("FORBIDDEN");
  });
});
