/**
 * Connector integration tests — higher-level mocked-provider flow spanning
 * API create → queue enqueue → status/history lifecycle.
 *
 * Exercises the full create→list→status→sync→disconnect loop, including
 * negative paths (provider validation failure, queue enqueue failure,
 * resync after failure, and stale state detection).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ConnectorProvider, ConnectorSummary } from "@shared/connectors";
import type { StartupDraft } from "@shared/types";
import { convertSetCookieToCookie } from "better-auth/test";

import { type ApiApp, createApiApp } from "../src/app";
import { createStubPostHogValidator } from "../src/lib/connectors/posthog";
import {
  createFailingQueueProducer,
  createStubQueueProducer,
} from "../src/lib/connectors/queue";
import { createStubStripeValidator } from "../src/lib/connectors/stripe";

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
  name: "Integration Test Startup",
  type: "b2b_saas",
  stage: "mvp",
  timezone: "UTC",
  currency: "USD",
};

const POSTHOG_CONFIG = {
  apiKey: "phx_integration_key",
  projectId: "99999",
  host: "https://app.posthog.com",
};

const STRIPE_CONFIG = {
  secretKey: "sk_test_integration_key",
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function makeRequest(
  app: ApiApp,
  url: string,
  init?: RequestInit
): Promise<Response> {
  return app.handle(new Request(url, init));
}

async function signUp(app: ApiApp, email: string): Promise<string> {
  // Send magic link sign-in
  const signInRes = await makeRequest(
    app,
    "http://localhost:3000/api/auth/sign-in/magic-link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: "Int User" }),
    }
  );
  if (!signInRes.ok) {
    throw new Error(`Magic link request failed: ${signInRes.status}`);
  }

  // Get the magic link from the runtime
  const magicLink = app.runtime.auth.getLatestMagicLink(email);
  if (!magicLink) {
    throw new Error(`No magic link for ${email}`);
  }

  // Verify the magic link to establish a session
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

async function createConnector(
  app: ApiApp,
  cookie: string,
  startupId: string,
  provider: ConnectorProvider,
  config: Record<string, string>
): Promise<Response> {
  return makeRequest(app, "http://localhost:3000/api/connectors", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ startupId, provider, config }),
  });
}

async function listConnectors(
  app: ApiApp,
  cookie: string,
  startupId: string
): Promise<Response> {
  return makeRequest(
    app,
    `http://localhost:3000/api/connectors?startupId=${encodeURIComponent(startupId)}`,
    {
      headers: { cookie },
    }
  );
}

async function getConnectorStatus(
  app: ApiApp,
  cookie: string,
  connectorId: string
): Promise<Response> {
  return makeRequest(
    app,
    `http://localhost:3000/api/connectors/${encodeURIComponent(connectorId)}/status`,
    {
      headers: { cookie },
    }
  );
}

async function triggerSyncReq(
  app: ApiApp,
  cookie: string,
  connectorId: string
): Promise<Response> {
  return makeRequest(
    app,
    `http://localhost:3000/api/connectors/${encodeURIComponent(connectorId)}/sync`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
    }
  );
}

async function deleteConnector(
  app: ApiApp,
  cookie: string,
  connectorId: string
): Promise<Response> {
  return makeRequest(
    app,
    `http://localhost:3000/api/connectors/${encodeURIComponent(connectorId)}`,
    {
      method: "DELETE",
      headers: { cookie },
    }
  );
}

// ------------------------------------------------------------------
// Full integration lifecycle
// ------------------------------------------------------------------

describe("connector integration lifecycle", () => {
  let app: ApiApp;
  let cookie: string;
  let startupId: string;
  const queueProducer = createStubQueueProducer({
    success: true,
    jobId: "int-job-id",
  });

  beforeAll(async () => {
    app = await createApiApp(TEST_ENV, {
      posthogValidator: createStubPostHogValidator({ valid: true }),
      stripeValidator: createStubStripeValidator({ valid: true }),
      queueProducer,
    });

    const runId = Date.now();
    cookie = await signUp(app, `connector-int-${runId}@test.local`);
    await createWorkspace(app, cookie, `Int Workspace ${runId}`);
    startupId = await createStartup(app, cookie, {
      ...VALID_STARTUP,
      name: `Int Startup ${runId}`,
    });
  });

  afterAll(async () => {
    await app.runtime.db.close();
  });

  test("full happy path: create PostHog → list → status → manual resync", async () => {
    queueProducer.calls.length = 0;

    const createRes = await createConnector(
      app,
      cookie,
      startupId,
      "posthog",
      POSTHOG_CONFIG
    );
    expect(createRes.status).toBe(201);

    const createPayload = (await createRes.json()) as {
      connector: ConnectorSummary;
      syncJob: { id: string; status: string; trigger: string };
    };
    const connectorId = createPayload.connector.id;
    expect(createPayload.connector.provider).toBe("posthog");
    expect(createPayload.connector.status).toBe("pending");
    expect(createPayload.syncJob.trigger).toBe("initial");

    // Queue received the job
    expect(queueProducer.calls.length).toBeGreaterThanOrEqual(1);
    const lastCall = queueProducer.calls.at(-1);
    expect(lastCall?.connectorId).toBe(connectorId);

    // List connectors shows the new one
    const listRes = await listConnectors(app, cookie, startupId);
    expect(listRes.status).toBe(200);
    const listPayload = (await listRes.json()) as {
      connectors: ConnectorSummary[];
    };
    const found = listPayload.connectors.find((c) => c.id === connectorId);
    expect(found).toBeDefined();
    expect(found?.provider).toBe("posthog");

    // Status endpoint returns connector + sync history
    const statusRes = await getConnectorStatus(app, cookie, connectorId);
    expect(statusRes.status).toBe(200);
    const statusPayload = (await statusRes.json()) as {
      connector: ConnectorSummary;
      syncHistory: Array<{ id: string; trigger: string }>;
    };
    expect(statusPayload.connector.id).toBe(connectorId);
    expect(statusPayload.syncHistory.length).toBeGreaterThanOrEqual(1);

    // Manual resync creates a second job
    const syncRes = await triggerSyncReq(app, cookie, connectorId);
    expect(syncRes.status).toBe(200);
    const syncPayload = (await syncRes.json()) as {
      syncJob: { trigger: string };
    };
    expect(syncPayload.syncJob.trigger).toBe("manual");
  });

  test("create Stripe → disconnect → resync rejected", async () => {
    const createRes = await createConnector(
      app,
      cookie,
      startupId,
      "stripe",
      STRIPE_CONFIG
    );
    expect(createRes.status).toBe(201);

    const createPayload = (await createRes.json()) as {
      connector: ConnectorSummary;
    };
    const connectorId = createPayload.connector.id;

    // Disconnect
    const deleteRes = await deleteConnector(app, cookie, connectorId);
    expect(deleteRes.status).toBe(200);

    // Resync on disconnected connector should be rejected
    const syncRes = await triggerSyncReq(app, cookie, connectorId);
    expect(syncRes.status).toBe(409);
    const syncPayload = (await syncRes.json()) as { error: { code: string } };
    expect(syncPayload.error.code).toBe("CONNECTOR_DISCONNECTED");
  });

  test("duplicate provider is rejected with 409", async () => {
    // PostHog was already connected above in happy path test
    const res = await createConnector(
      app,
      cookie,
      startupId,
      "posthog",
      POSTHOG_CONFIG
    );
    expect(res.status).toBe(409);
    const payload = (await res.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("CONNECTOR_ALREADY_EXISTS");
  });

  test("listing connectors after disconnect shows disconnected status", async () => {
    const listRes = await listConnectors(app, cookie, startupId);
    expect(listRes.status).toBe(200);
    const payload = (await listRes.json()) as {
      connectors: ConnectorSummary[];
    };

    // Stripe was disconnected in earlier test
    const stripe = payload.connectors.find((c) => c.provider === "stripe");
    if (stripe) {
      expect(stripe.status).toBe("disconnected");
    }
  });
});

describe("connector integration — failure paths", () => {
  test("provider validation failure returns 422 with error detail", async () => {
    // Create app with a failing PostHog validator
    const failingPH = createStubPostHogValidator({
      valid: false,
      error: "Invalid API key",
      retryable: false,
    });
    const app = await createApiApp(TEST_ENV, {
      posthogValidator: failingPH,
      stripeValidator: createStubStripeValidator({ valid: true }),
      queueProducer: createStubQueueProducer({ success: true }),
    });

    const runId = Date.now();
    const cookie = await signUp(app, `val-fail-${runId}@test.local`);
    await createWorkspace(app, cookie, `Val Fail WS ${runId}`);
    const startupId = await createStartup(app, cookie, {
      ...VALID_STARTUP,
      name: `Val Fail Startup ${runId}`,
    });

    const res = await createConnector(
      app,
      cookie,
      startupId,
      "posthog",
      POSTHOG_CONFIG
    );
    expect(res.status).toBe(422);

    const payload = (await res.json()) as {
      error: { code: string; message: string; retryable: boolean };
    };
    expect(payload.error.code).toBe("PROVIDER_VALIDATION_FAILED");
    expect(payload.error.message).toContain("Invalid API key");
    expect(payload.error.retryable).toBe(false);

    await app.runtime.db.close();
  });

  test("queue enqueue failure creates connector but sync job shows failed", async () => {
    const failingQueue = createFailingQueueProducer("Redis connection refused");
    const app = await createApiApp(TEST_ENV, {
      posthogValidator: createStubPostHogValidator({ valid: true }),
      stripeValidator: createStubStripeValidator({ valid: true }),
      queueProducer: failingQueue,
    });

    const runId = Date.now();
    const cookie = await signUp(app, `queue-fail-${runId}@test.local`);
    await createWorkspace(app, cookie, `Queue Fail WS ${runId}`);
    const startupId = await createStartup(app, cookie, {
      ...VALID_STARTUP,
      name: `Queue Fail Startup ${runId}`,
    });

    const res = await createConnector(
      app,
      cookie,
      startupId,
      "posthog",
      POSTHOG_CONFIG
    );
    expect(res.status).toBe(201);

    const payload = (await res.json()) as {
      connector: ConnectorSummary;
      syncJob: { status: string };
    };
    expect(payload.connector.status).toBe("pending");
    expect(payload.syncJob.status).toBe("failed");

    await app.runtime.db.close();
  });
});
