import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { StartupDraft } from "@shared/types";
import { convertSetCookieToCookie } from "better-auth/test";

import type { ApiApp } from "../src/app";
import { createStubPostHogValidator } from "../src/lib/connectors/posthog";
import {
  createFailingQueueProducer,
  createStubQueueProducer,
} from "../src/lib/connectors/queue";
import { createStubStripeValidator } from "../src/lib/connectors/stripe";
import {
  closeTestApiApp,
  createTestApiApp,
  requireValue,
} from "./helpers/test-app";

const VALID_STARTUP: StartupDraft = {
  name: "Connector Test Startup",
  type: "b2b_saas",
  stage: "mvp",
  timezone: "UTC",
  currency: "USD",
};

const POSTHOG_CONFIG = {
  apiKey: "phx_test_key_123",
  projectId: "12345",
  host: "https://app.posthog.com",
};

const STRIPE_CONFIG = {
  secretKey: "sk_test_abc123xyz",
};

// Shared test helpers
let app: ApiApp | undefined;
let posthogValidator: ReturnType<typeof createStubPostHogValidator>;
let stripeValidator: ReturnType<typeof createStubStripeValidator>;
let queueProducer: ReturnType<typeof createStubQueueProducer>;

beforeAll(async () => {
  posthogValidator = createStubPostHogValidator({ valid: true });
  stripeValidator = createStubStripeValidator({ valid: true });
  queueProducer = createStubQueueProducer({
    success: true,
    jobId: "stub-job-id",
  });

  app = await createTestApiApp({
    posthogValidator,
    stripeValidator,
    queueProducer,
  });
});

beforeEach(async () => {
  const testApp = requireValue(app, "Expected API test app to be initialized.");
  testApp.runtime.auth.resetMagicLinks();
  await testApp.runtime.db.resetAuthTables();
  posthogValidator.calls.length = 0;
  stripeValidator.calls.length = 0;
  queueProducer.calls.length = 0;
});

afterAll(async () => {
  await closeTestApiApp(app);
});

async function parseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function send(
  path: string,
  init?: { method?: string; body?: unknown; cookie?: string }
) {
  const testApp = requireValue(app, "Expected API test app to be initialized.");
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

async function createAuthenticatedSession(email = "founder@example.com") {
  const testApp = requireValue(app, "Expected API test app to be initialized.");
  const signInResponse = await send("/api/auth/sign-in/magic-link", {
    method: "POST",
    body: { email, name: "Founder" },
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

async function setupWorkspaceAndStartup(email = "connector-test@example.com") {
  const { cookie } = await createAuthenticatedSession(email);
  await createWorkspace(cookie, "Connector Workspace");
  const startup = await createStartup(cookie);
  return { cookie, startup };
}

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe("connector routes", () => {
  describe("authentication and authorization", () => {
    test("reject unauthenticated connector access", async () => {
      const listResponse = await send("/api/connectors?startupId=fake-id");
      expect(listResponse.status).toBe(401);
      const listPayload = await parseJson(listResponse);
      expect(listPayload.error).toMatchObject({ code: "AUTH_REQUIRED" });

      const createResponse = await send("/api/connectors", {
        method: "POST",
        body: {
          startupId: "fake",
          provider: "posthog",
          config: POSTHOG_CONFIG,
        },
      });
      expect(createResponse.status).toBe(401);

      const deleteResponse = await send("/api/connectors/fake-id", {
        method: "DELETE",
      });
      expect(deleteResponse.status).toBe(401);

      const syncResponse = await send("/api/connectors/fake-id/sync", {
        method: "POST",
      });
      expect(syncResponse.status).toBe(401);

      const statusResponse = await send("/api/connectors/fake-id/status");
      expect(statusResponse.status).toBe(401);
    });

    test("reject cross-workspace startup access for connector creation", async () => {
      // User A creates workspace + startup
      const { startup } = await setupWorkspaceAndStartup("userA@example.com");

      // User B creates their own workspace
      const { cookie: cookieB } =
        await createAuthenticatedSession("userB@example.com");
      await createWorkspace(cookieB, "Other Workspace");

      // User B tries to create a connector on User A's startup
      const response = await send("/api/connectors", {
        method: "POST",
        cookie: cookieB,
        body: {
          startupId: startup.id,
          provider: "posthog",
          config: POSTHOG_CONFIG,
        },
      });

      expect(response.status).toBe(403);
      const payload = await parseJson(response);
      expect(payload.error).toMatchObject({ code: "STARTUP_SCOPE_INVALID" });
    });
  });

  describe("input validation", () => {
    test("reject missing startupId on list", async () => {
      const { cookie } = await setupWorkspaceAndStartup(
        "list-no-startup@example.com"
      );

      const response = await send("/api/connectors", { cookie });
      expect(response.status).toBe(400);
      const payload = await parseJson(response);
      expect(payload.error).toMatchObject({ code: "STARTUP_ID_REQUIRED" });
    });

    test("reject unsupported provider", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "bad-provider@example.com"
      );

      const response = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: { startupId: startup.id, provider: "hubspot", config: {} },
      });

      expect(response.status).toBe(400);
      const payload = await parseJson(response);
      expect(payload.error).toMatchObject({ code: "UNSUPPORTED_PROVIDER" });
    });

    test("reject malformed PostHog config", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "bad-posthog@example.com"
      );

      // blank project ID
      const response = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "posthog",
          config: {
            apiKey: "phx_test_123",
            projectId: "",
            host: "https://app.posthog.com",
          },
        },
      });

      expect(response.status).toBe(422);
      const payload = await parseJson(response);
      expect(payload.error).toMatchObject({
        code: "PROVIDER_VALIDATION_FAILED",
      });
    });

    test("reject malformed Stripe key", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "bad-stripe@example.com"
      );

      const response = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "stripe",
          config: { secretKey: "not-a-stripe-key" },
        },
      });

      expect(response.status).toBe(422);
      const payload = await parseJson(response);
      expect(payload.error).toMatchObject({
        code: "PROVIDER_VALIDATION_FAILED",
      });
    });

    test("reject blank PostHog host URL", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "bad-host@example.com"
      );

      const response = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "posthog",
          config: {
            apiKey: "phx_test_123",
            projectId: "12345",
            host: "not-a-url",
          },
        },
      });

      expect(response.status).toBe(422);
      const payload = await parseJson(response);
      expect(payload.error).toMatchObject({
        code: "PROVIDER_VALIDATION_FAILED",
      });
    });
  });

  describe("connector CRUD lifecycle", () => {
    test("create PostHog connector, list, get status, and delete", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "posthog-lifecycle@example.com"
      );

      // Create
      const createResponse = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "posthog",
          config: POSTHOG_CONFIG,
        },
      });

      expect(createResponse.status).toBe(201);
      const createPayload = await parseJson(createResponse);
      const created = createPayload.connector as Record<string, unknown>;

      expect(created.provider).toBe("posthog");
      expect(created.status).toBe("pending");
      expect(created.startupId).toBe(startup.id);
      // Must never contain raw credentials
      expect(created).not.toHaveProperty("encryptedConfig");
      expect(created).not.toHaveProperty("encryptionIv");
      expect(created).not.toHaveProperty("encryptionAuthTag");
      expect(JSON.stringify(created)).not.toContain("phx_test_key_123");

      // Verify sync job was created and queued
      expect(createPayload.syncJob).toMatchObject({
        status: "queued",
        trigger: "initial",
      });
      expect(queueProducer.calls.length).toBe(1);
      expect(queueProducer.calls[0]?.trigger).toBe("initial");

      // List
      const listResponse = await send(
        `/api/connectors?startupId=${startup.id}`,
        { cookie }
      );
      expect(listResponse.status).toBe(200);
      const listPayload = await parseJson(listResponse);
      const connectors = listPayload.connectors as unknown[];
      expect(connectors.length).toBe(1);

      // Status
      const statusResponse = await send(
        `/api/connectors/${created.id}/status`,
        { cookie }
      );
      expect(statusResponse.status).toBe(200);
      const statusPayload = await parseJson(statusResponse);
      expect(statusPayload.connector).toMatchObject({
        id: created.id,
        provider: "posthog",
      });
      const history = statusPayload.syncHistory as unknown[];
      expect(history.length).toBe(1);

      // Delete (disconnect)
      const deleteResponse = await send(`/api/connectors/${created.id}`, {
        method: "DELETE",
        cookie,
      });
      expect(deleteResponse.status).toBe(200);
      const deletePayload = await parseJson(deleteResponse);
      expect(deletePayload.deleted).toBe(true);

      // Verify status is now disconnected
      const afterDeleteStatus = await send(
        `/api/connectors/${created.id}/status`,
        { cookie }
      );
      const afterDeletePayload = await parseJson(afterDeleteStatus);
      expect(
        (afterDeletePayload.connector as Record<string, unknown>).status
      ).toBe("disconnected");
    });

    test("create Stripe connector with proper validation", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "stripe-lifecycle@example.com"
      );

      const createResponse = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "stripe",
          config: STRIPE_CONFIG,
        },
      });

      expect(createResponse.status).toBe(201);
      const createPayload = await parseJson(createResponse);
      const created = createPayload.connector as Record<string, unknown>;

      expect(created.provider).toBe("stripe");
      expect(created.status).toBe("pending");
      // Never leak the secret key
      expect(JSON.stringify(created)).not.toContain("sk_test_abc123xyz");

      expect(stripeValidator.calls.length).toBe(1);
    });
  });

  describe("duplicate prevention", () => {
    test("reject duplicate provider for same startup", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "dup-provider@example.com"
      );

      // First creation succeeds
      const first = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "posthog",
          config: POSTHOG_CONFIG,
        },
      });
      expect(first.status).toBe(201);

      // Second creation fails
      const second = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "posthog",
          config: POSTHOG_CONFIG,
        },
      });
      expect(second.status).toBe(409);
      const payload = await parseJson(second);
      expect(payload.error).toMatchObject({ code: "CONNECTOR_ALREADY_EXISTS" });
    });

    test("allow different providers for the same startup", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "multi-provider@example.com"
      );

      const posthog = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "posthog",
          config: POSTHOG_CONFIG,
        },
      });
      expect(posthog.status).toBe(201);

      const stripe = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "stripe",
          config: STRIPE_CONFIG,
        },
      });
      expect(stripe.status).toBe(201);

      // List should show both
      const list = await send(`/api/connectors?startupId=${startup.id}`, {
        cookie,
      });
      const listPayload = await parseJson(list);
      expect((listPayload.connectors as unknown[]).length).toBe(2);
    });
  });

  describe("provider validation failures", () => {
    test("reject connector creation when PostHog validation fails", async () => {
      const failingPosthog = createStubPostHogValidator({
        valid: false,
        error:
          "PostHog API key is invalid or lacks access to the specified project.",
      });

      const failApp = await createTestApiApp({
        posthogValidator: failingPosthog,
        stripeValidator: createStubStripeValidator({ valid: true }),
        queueProducer: createStubQueueProducer(),
      });

      try {
        failApp.runtime.auth.resetMagicLinks();
        await failApp.runtime.db.resetAuthTables();

        const { cookie: fCookie } = await createSessionOnApp(
          failApp,
          "ph-fail@example.com"
        );
        await createWorkspaceOnApp(failApp, fCookie, "PH Fail Workspace");
        const startup = await createStartupOnApp(failApp, fCookie);

        const response = await failApp.handle(
          new Request("http://localhost/api/connectors", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: fCookie,
            },
            body: JSON.stringify({
              startupId: startup.id,
              provider: "posthog",
              config: POSTHOG_CONFIG,
            }),
          })
        );

        expect(response.status).toBe(422);
        const payload = await parseJson(response);
        expect(payload.error).toMatchObject({
          code: "PROVIDER_VALIDATION_FAILED",
        });

        // No connector should have been persisted
        const list = await failApp.handle(
          new Request(
            `http://localhost/api/connectors?startupId=${startup.id}`,
            {
              headers: { cookie: fCookie },
            }
          )
        );
        const listPayload = await parseJson(list);
        expect((listPayload.connectors as unknown[]).length).toBe(0);
      } finally {
        await closeTestApiApp(failApp);
      }
    });
  });

  describe("sync trigger and queue handoff", () => {
    test("manual sync enqueues reference-only job", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "manual-sync@example.com"
      );

      // Create a connector first
      const createResponse = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "posthog",
          config: POSTHOG_CONFIG,
        },
      });
      const createPayload = await parseJson(createResponse);
      const connectorId = (createPayload.connector as Record<string, unknown>)
        .id as string;

      const initialQueueCalls = queueProducer.calls.length;

      // Trigger manual sync
      const syncResponse = await send(`/api/connectors/${connectorId}/sync`, {
        method: "POST",
        cookie,
      });
      expect(syncResponse.status).toBe(200);
      const syncPayload = await parseJson(syncResponse);
      expect(syncPayload.syncJob).toMatchObject({
        connectorId,
        status: "queued",
        trigger: "manual",
      });

      // Verify the queue received reference IDs only (no credentials)
      expect(queueProducer.calls.length).toBe(initialQueueCalls + 1);
      const lastCall = requireValue(
        queueProducer.calls.at(-1),
        "Expected queued sync call."
      );
      expect(lastCall.connectorId).toBe(connectorId);
      expect(lastCall.trigger).toBe("manual");
      // No credential data in the queue payload
      expect(lastCall).not.toHaveProperty("config");
      expect(lastCall).not.toHaveProperty("secretKey");
      expect(lastCall).not.toHaveProperty("apiKey");
    });

    test("reject sync on disconnected connector", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "sync-disconnected@example.com"
      );

      const createResponse = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "posthog",
          config: POSTHOG_CONFIG,
        },
      });
      const createPayload = await parseJson(createResponse);
      const connectorId = (createPayload.connector as Record<string, unknown>)
        .id as string;

      // Disconnect
      await send(`/api/connectors/${connectorId}`, {
        method: "DELETE",
        cookie,
      });

      // Try to sync
      const syncResponse = await send(`/api/connectors/${connectorId}/sync`, {
        method: "POST",
        cookie,
      });
      expect(syncResponse.status).toBe(409);
      const payload = await parseJson(syncResponse);
      expect(payload.error).toMatchObject({ code: "CONNECTOR_DISCONNECTED" });
    });

    test("surface queue enqueue failure without corrupting connector state", async () => {
      const failingQueue = createFailingQueueProducer(
        "Redis connection refused"
      );
      const failApp = await createTestApiApp({
        posthogValidator: createStubPostHogValidator({ valid: true }),
        stripeValidator: createStubStripeValidator({ valid: true }),
        queueProducer: failingQueue,
      });

      try {
        failApp.runtime.auth.resetMagicLinks();
        await failApp.runtime.db.resetAuthTables();

        const { cookie } = await createSessionOnApp(
          failApp,
          "queue-fail@example.com"
        );
        await createWorkspaceOnApp(failApp, cookie, "Queue Fail Workspace");
        const startup = await createStartupOnApp(failApp, cookie);

        // Create connector — initial enqueue will fail but connector is still created
        const createResponse = await failApp.handle(
          new Request("http://localhost/api/connectors", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie,
            },
            body: JSON.stringify({
              startupId: startup.id,
              provider: "stripe",
              config: STRIPE_CONFIG,
            }),
          })
        );
        expect(createResponse.status).toBe(201);
        const createPayload = await parseJson(createResponse);
        // The sync job should reflect the failure
        expect((createPayload.syncJob as Record<string, unknown>).status).toBe(
          "failed"
        );

        const connectorId = (createPayload.connector as Record<string, unknown>)
          .id as string;

        // Manual resync should also fail with explicit error
        const syncResponse = await failApp.handle(
          new Request(`http://localhost/api/connectors/${connectorId}/sync`, {
            method: "POST",
            headers: { cookie },
          })
        );
        expect(syncResponse.status).toBe(502);
        const syncPayload = await parseJson(syncResponse);
        expect(syncPayload.error).toMatchObject({
          code: "SYNC_ENQUEUE_FAILED",
          retryable: true,
        });
      } finally {
        await closeTestApiApp(failApp);
      }
    });
  });

  describe("status and history reads", () => {
    test("return empty sync history for first connector", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "empty-history@example.com"
      );

      const createResponse = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "posthog",
          config: POSTHOG_CONFIG,
        },
      });
      const createPayload = await parseJson(createResponse);
      const connectorId = (createPayload.connector as Record<string, unknown>)
        .id as string;

      const statusResponse = await send(
        `/api/connectors/${connectorId}/status`,
        { cookie }
      );
      expect(statusResponse.status).toBe(200);
      const statusPayload = await parseJson(statusResponse);
      expect(statusPayload.connector).toMatchObject({ id: connectorId });
      // Has the initial sync job
      expect((statusPayload.syncHistory as unknown[]).length).toBe(1);
    });

    test("return 404 for non-existent connector status", async () => {
      const { cookie } = await setupWorkspaceAndStartup(
        "no-connector@example.com"
      );

      const response = await send("/api/connectors/non-existent-id/status", {
        cookie,
      });
      expect(response.status).toBe(404);
      const payload = await parseJson(response);
      expect(payload.error).toMatchObject({ code: "CONNECTOR_NOT_FOUND" });
    });

    test("empty connector list for startup with no connectors", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "no-connectors@example.com"
      );

      const response = await send(`/api/connectors?startupId=${startup.id}`, {
        cookie,
      });
      expect(response.status).toBe(200);
      const payload = await parseJson(response);
      expect((payload.connectors as unknown[]).length).toBe(0);
    });
  });

  describe("secret redaction", () => {
    test("no raw credentials in any API response", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "redaction@example.com"
      );

      // Create PostHog connector
      const phResponse = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "posthog",
          config: POSTHOG_CONFIG,
        },
      });
      const phText = await phResponse.clone().text();
      expect(phText).not.toContain("phx_test_key_123");
      expect(phText).not.toContain("encryptedConfig");
      expect(phText).not.toContain("encryptionIv");
      expect(phText).not.toContain("encryptionAuthTag");

      // Create Stripe connector
      const stResponse = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "stripe",
          config: { secretKey: "sk_test_super_secret_key_value" },
        },
      });
      const stText = await stResponse.clone().text();
      expect(stText).not.toContain("sk_test_super_secret_key_value");

      // List should also be clean
      const listResponse = await send(
        `/api/connectors?startupId=${startup.id}`,
        { cookie }
      );
      const listText = await listResponse.clone().text();
      expect(listText).not.toContain("phx_test_key_123");
      expect(listText).not.toContain("sk_test_super_secret_key_value");
      expect(listText).not.toContain("encryptedConfig");

      // Status should also be clean
      const phPayload = await parseJson(phResponse);
      const connectorId = (phPayload.connector as Record<string, unknown>)
        .id as string;
      const statusResponse = await send(
        `/api/connectors/${connectorId}/status`,
        { cookie }
      );
      const statusText = await statusResponse.clone().text();
      expect(statusText).not.toContain("phx_test_key_123");
      expect(statusText).not.toContain("encryptedConfig");
    });
  });
});

// ---------------------------------------------------------------
// Helpers for tests that use a separate app instance
// ---------------------------------------------------------------

async function createSessionOnApp(testApp: ApiApp, email: string) {
  const signInResponse = await testApp.handle(
    new Request("http://localhost/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: "Founder" }),
    })
  );
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

async function createWorkspaceOnApp(
  testApp: ApiApp,
  cookie: string,
  name: string
) {
  const response = await testApp.handle(
    new Request("http://localhost/api/workspaces", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({ name }),
    })
  );
  const payload = await parseJson(response);
  expect(response.status).toBe(201);
  return payload.workspace as { id: string; name: string; slug: string };
}

async function createStartupOnApp(
  testApp: ApiApp,
  cookie: string,
  overrides?: Partial<StartupDraft>
) {
  const response = await testApp.handle(
    new Request("http://localhost/api/startups", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({ ...VALID_STARTUP, ...overrides }),
    })
  );
  const payload = await parseJson(response);
  expect(response.status).toBe(201);
  return payload.startup as { id: string; name: string; workspaceId: string };
}
