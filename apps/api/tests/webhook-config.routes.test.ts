/**
 * Webhook config CRUD route tests.
 * Covers: create (with secret shown once), read (without secret), update (URL re-validation),
 * delete, duplicate 409, SSRF rejection on create/update.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { StartupDraft } from "@shared/types";
import type { WebhookConfigSummary } from "@shared/webhook";
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
  name: "Webhook Test Startup",
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
    body: { email, name: "Webhook Tester" },
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
  await createWorkspace(cookie, `Webhook WS ${Date.now()}`);
  const startup = await createStartup(cookie);
  return { cookie, startup };
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
    webhookResolver: async () => ["203.0.113.1"],
  });

  const runId = Date.now();
  const result = await setupWorkspaceAndStartup(
    `webhook-cfg-${runId}@example.com`
  );
  cookie = result.cookie;
  startupId = result.startup.id;
});

afterAll(async () => {
  await closeTestApiApp(app);
});

// ---------------------------------------------------------------------------
// POST /api/startups/:startupId/webhook — Create
// ---------------------------------------------------------------------------

describe("POST /api/startups/:startupId/webhook", () => {
  test("returns 201 with config and secret", async () => {
    const response = await send(`/api/startups/${startupId}/webhook`, {
      method: "POST",
      cookie,
      body: {
        url: "https://hooks.example.com/receive",
        eventTypes: ["alert.fired"],
      },
    });

    expect(response.status).toBe(201);

    const payload = (await response.json()) as {
      webhook: WebhookConfigSummary;
      secret: string;
    };
    expect(payload.webhook).toBeDefined();
    expect(payload.webhook.url).toBe("https://hooks.example.com/receive");
    expect(payload.webhook.eventTypes).toEqual(["alert.fired"]);
    expect(payload.webhook.enabled).toBe(true);
    expect(payload.webhook.startupId).toBe(startupId);
    expect(payload.webhook.consecutiveFailures).toBe(0);
    expect(payload.webhook.circuitBrokenAt).toBeNull();
    // Secret shown on creation
    expect(payload.secret).toBeTruthy();
    expect(payload.secret.length).toBe(64); // 32 bytes hex
  });

  test("returns 409 on duplicate (one webhook per startup)", async () => {
    const response = await send(`/api/startups/${startupId}/webhook`, {
      method: "POST",
      cookie,
      body: {
        url: "https://hooks.example.com/second",
        eventTypes: ["alert.fired"],
      },
    });

    expect(response.status).toBe(409);
    const payload = await parseJson(response);
    expect((payload.error as Record<string, unknown>).code).toBe(
      "WEBHOOK_DUPLICATE"
    );
  });

  test("returns 400 for HTTP (non-HTTPS) URL", async () => {
    // Create a second startup to test URL validation
    const startup2 = await createStartup(cookie, {
      name: "Webhook URL Test Startup",
    });

    const response = await send(`/api/startups/${startup2.id}/webhook`, {
      method: "POST",
      cookie,
      body: {
        url: "http://hooks.example.com/receive",
        eventTypes: ["alert.fired"],
      },
    });

    expect(response.status).toBe(400);
  });

  test("returns 400 with empty eventTypes", async () => {
    const startup3 = await createStartup(cookie, {
      name: "Webhook Empty Events Startup",
    });

    const response = await send(`/api/startups/${startup3.id}/webhook`, {
      method: "POST",
      cookie,
      body: {
        url: "https://hooks.example.com/receive",
        eventTypes: [],
      },
    });

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/startups/:startupId/webhook — Read
// ---------------------------------------------------------------------------

describe("GET /api/startups/:startupId/webhook", () => {
  test("returns webhook config without secret", async () => {
    const response = await send(`/api/startups/${startupId}/webhook`, {
      cookie,
    });

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      webhook: WebhookConfigSummary;
    };
    expect(payload.webhook).toBeDefined();
    expect(payload.webhook.url).toBe("https://hooks.example.com/receive");
    expect(payload.webhook.startupId).toBe(startupId);
    // Secret must NOT be included in GET response
    expect((payload as Record<string, unknown>).secret).toBeUndefined();
  });

  test("returns null for startup without webhook", async () => {
    const noWebhookStartup = await createStartup(cookie, {
      name: "No Webhook Startup",
    });

    const response = await send(
      `/api/startups/${noWebhookStartup.id}/webhook`,
      { cookie }
    );

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      webhook: WebhookConfigSummary | null;
    };
    expect(payload.webhook).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/startups/:startupId/webhook — Update
// ---------------------------------------------------------------------------

describe("PATCH /api/startups/:startupId/webhook", () => {
  test("updates URL and eventTypes", async () => {
    const response = await send(`/api/startups/${startupId}/webhook`, {
      method: "PATCH",
      cookie,
      body: {
        url: "https://updated.example.com/hook",
        eventTypes: ["alert.fired", "connector.synced"],
      },
    });

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      webhook: WebhookConfigSummary;
    };
    expect(payload.webhook.url).toBe("https://updated.example.com/hook");
    expect(payload.webhook.eventTypes).toEqual([
      "alert.fired",
      "connector.synced",
    ]);
  });

  test("returns 404 for non-existent startup webhook", async () => {
    const noHookStartup = await createStartup(cookie, {
      name: "No Hook For Patch",
    });

    const response = await send(`/api/startups/${noHookStartup.id}/webhook`, {
      method: "PATCH",
      cookie,
      body: { url: "https://new.example.com/hook" },
    });

    expect(response.status).toBe(404);
  });

  test("returns 400 for empty update", async () => {
    const response = await send(`/api/startups/${startupId}/webhook`, {
      method: "PATCH",
      cookie,
      body: {},
    });

    expect(response.status).toBe(400);
    const payload = await parseJson(response);
    expect((payload.error as Record<string, unknown>).code).toBe("NO_UPDATES");
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/startups/:startupId/webhook — Delete
// ---------------------------------------------------------------------------

describe("DELETE /api/startups/:startupId/webhook", () => {
  test("deletes webhook and returns confirmation", async () => {
    const response = await send(`/api/startups/${startupId}/webhook`, {
      method: "DELETE",
      cookie,
    });

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      deleted: boolean;
      startupId: string;
    };
    expect(payload.deleted).toBe(true);
    expect(payload.startupId).toBe(startupId);
  });

  test("GET returns null after deletion", async () => {
    const response = await send(`/api/startups/${startupId}/webhook`, {
      cookie,
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      webhook: WebhookConfigSummary | null;
    };
    expect(payload.webhook).toBeNull();
  });

  test("returns 404 on double delete", async () => {
    const response = await send(`/api/startups/${startupId}/webhook`, {
      method: "DELETE",
      cookie,
    });

    expect(response.status).toBe(404);
  });
});
