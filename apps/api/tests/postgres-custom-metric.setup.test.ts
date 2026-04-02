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

import { type ApiApp, createApiApp } from "../src/app";
import { createStubPostgresValidator } from "../src/lib/connectors/postgres";
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
  name: "PG Metric Test Startup",
  type: "b2b_saas",
  stage: "mvp",
  timezone: "UTC",
  currency: "USD",
};

const VALID_POSTGRES_CONFIG = {
  connectionUri: "postgres://user:pass@db.example.com:5432/mydb",
  schema: "public",
  view: "daily_revenue",
  label: "Daily Revenue",
  unit: "$",
};

const POSTHOG_CONFIG = {
  apiKey: "phx_test_key_123",
  projectId: "12345",
  host: "https://app.posthog.com",
};

const STRIPE_CONFIG = {
  secretKey: "sk_test_abc123xyz",
};

// Shared test state
let app: ApiApp;
let posthogValidator: ReturnType<typeof createStubPostHogValidator>;
let stripeValidator: ReturnType<typeof createStubStripeValidator>;
let postgresValidator: ReturnType<typeof createStubPostgresValidator>;
let queueProducer: ReturnType<typeof createStubQueueProducer>;

beforeAll(async () => {
  posthogValidator = createStubPostHogValidator({ valid: true });
  stripeValidator = createStubStripeValidator({ valid: true });
  postgresValidator = createStubPostgresValidator({ valid: true });
  queueProducer = createStubQueueProducer({
    success: true,
    jobId: "stub-job-id",
  });

  app = await createApiApp(TEST_ENV, {
    posthogValidator,
    stripeValidator,
    postgresValidator,
    queueProducer,
  });
});

beforeEach(async () => {
  app.runtime.auth.resetMagicLinks();
  await app.runtime.db.resetAuthTables();
  posthogValidator.calls.length = 0;
  stripeValidator.calls.length = 0;
  postgresValidator.calls.length = 0;
  queueProducer.calls.length = 0;
});

afterAll(async () => {
  await app.runtime.db.close();
});

async function parseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function send(
  path: string,
  init?: { method?: string; body?: unknown; cookie?: string }
) {
  const headers = new Headers();
  if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (init?.cookie) {
    headers.set("cookie", init.cookie);
  }

  return app.handle(
    new Request(`http://localhost${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  );
}

async function createAuthenticatedSession(email = "pgmetric@example.com") {
  const signInResponse = await send("/api/auth/sign-in/magic-link", {
    method: "POST",
    body: { email, name: "Founder" },
  });
  expect(signInResponse.status).toBe(200);

  const magicLink = app.runtime.auth.getLatestMagicLink(email);
  expect(magicLink).toBeDefined();

  const verifyResponse = await app.handle(new Request(magicLink!.url));
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

async function setupWorkspaceAndStartup(email = "pgmetric-setup@example.com") {
  const { cookie } = await createAuthenticatedSession(email);
  await createWorkspace(cookie, "PG Metric Workspace");
  const startup = await createStartup(cookie);
  return { cookie, startup };
}

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

describe("postgres custom metric setup", () => {
  describe("authentication and authorization", () => {
    test("reject unauthenticated postgres setup", async () => {
      const response = await send("/api/connectors", {
        method: "POST",
        body: {
          startupId: "fake-id",
          provider: "postgres",
          config: VALID_POSTGRES_CONFIG,
        },
      });
      expect(response.status).toBe(401);
      const payload = await parseJson(response);
      expect(payload.error).toMatchObject({ code: "AUTH_REQUIRED" });
    });

    test("reject cross-workspace startup access for postgres setup", async () => {
      // User A creates workspace + startup
      const { startup } = await setupWorkspaceAndStartup("pgA@example.com");

      // User B creates their own workspace
      const { cookie: cookieB } =
        await createAuthenticatedSession("pgB@example.com");
      await createWorkspace(cookieB, "Other PG Workspace");

      const response = await send("/api/connectors", {
        method: "POST",
        cookie: cookieB,
        body: {
          startupId: startup.id,
          provider: "postgres",
          config: VALID_POSTGRES_CONFIG,
        },
      });

      expect(response.status).toBe(403);
      const payload = await parseJson(response);
      expect(payload.error).toMatchObject({ code: "STARTUP_SCOPE_INVALID" });
    });
  });

  describe("input validation — malformed inputs", () => {
    test("reject non-postgres URL scheme", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "pg-bad-scheme@example.com"
      );

      const response = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "postgres",
          config: {
            ...VALID_POSTGRES_CONFIG,
            connectionUri: "mysql://host/db",
          },
        },
      });

      expect(response.status).toBe(422);
      const payload = await parseJson(response);
      expect(payload.error).toMatchObject({
        code: "PROVIDER_VALIDATION_FAILED",
      });
    });

    test("reject unsafe schema identifier (SQL injection attempt)", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "pg-bad-schema@example.com"
      );

      const response = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "postgres",
          config: {
            ...VALID_POSTGRES_CONFIG,
            schema: "public; DROP TABLE users--",
          },
        },
      });

      expect(response.status).toBe(422);
      const payload = await parseJson(response);
      expect(payload.error).toMatchObject({
        code: "PROVIDER_VALIDATION_FAILED",
      });
    });

    test("reject unsafe view identifier", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "pg-bad-view@example.com"
      );

      const response = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "postgres",
          config: { ...VALID_POSTGRES_CONFIG, view: "my view" },
        },
      });

      expect(response.status).toBe(422);
      const payload = await parseJson(response);
      expect(payload.error).toMatchObject({
        code: "PROVIDER_VALIDATION_FAILED",
      });
    });

    test("reject blank label", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "pg-blank-label@example.com"
      );

      const response = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "postgres",
          config: { ...VALID_POSTGRES_CONFIG, label: "" },
        },
      });

      expect(response.status).toBe(422);
      const payload = await parseJson(response);
      expect(payload.error).toMatchObject({
        code: "PROVIDER_VALIDATION_FAILED",
      });
    });

    test("reject invalid unit (blank)", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "pg-blank-unit@example.com"
      );

      const response = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "postgres",
          config: { ...VALID_POSTGRES_CONFIG, unit: "" },
        },
      });

      expect(response.status).toBe(422);
      const payload = await parseJson(response);
      expect(payload.error).toMatchObject({
        code: "PROVIDER_VALIDATION_FAILED",
      });
    });

    test("reject missing connection URI", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "pg-no-uri@example.com"
      );

      const response = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "postgres",
          config: {
            schema: "public",
            view: "test_view",
            label: "Test",
            unit: "$",
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

  describe("successful postgres setup", () => {
    test("create postgres connector with custom metric", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "pg-success@example.com"
      );

      const response = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "postgres",
          config: VALID_POSTGRES_CONFIG,
        },
      });

      expect(response.status).toBe(201);
      const payload = await parseJson(response);

      // Connector created
      const conn = payload.connector as Record<string, unknown>;
      expect(conn.provider).toBe("postgres");
      expect(conn.status).toBe("pending");
      expect(conn.startupId).toBe(startup.id);

      // Custom metric metadata returned
      const metric = payload.customMetric as Record<string, unknown>;
      expect(metric).toBeDefined();
      expect(metric.label).toBe("Daily Revenue");
      expect(metric.unit).toBe("$");
      expect(metric.schema).toBe("public");
      expect(metric.view).toBe("daily_revenue");
      expect(metric.status).toBe("pending");
      expect(metric.metricValue).toBeNull();
      expect(metric.startupId).toBe(startup.id);
      expect(metric.connectorId).toBe(conn.id);

      // Sync job queued
      expect(payload.syncJob).toMatchObject({
        status: "queued",
        trigger: "initial",
      });
      expect(queueProducer.calls.length).toBe(1);
      expect(queueProducer.calls[0]?.provider).toBe("postgres");

      // Validator was called
      expect(postgresValidator.calls.length).toBe(1);
    });

    test("credential redaction — connection URI never in response", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "pg-redact@example.com"
      );

      const response = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "postgres",
          config: VALID_POSTGRES_CONFIG,
        },
      });

      const text = await response.clone().text();
      expect(text).not.toContain("postgres://user:pass@db.example.com");
      expect(text).not.toContain("encryptedConfig");
      expect(text).not.toContain("encryptionIv");
      expect(text).not.toContain("encryptionAuthTag");
    });

    test("list connectors includes custom metrics", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "pg-list@example.com"
      );

      // Create postgres connector
      await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "postgres",
          config: VALID_POSTGRES_CONFIG,
        },
      });

      const listResponse = await send(
        `/api/connectors?startupId=${startup.id}`,
        { cookie }
      );
      expect(listResponse.status).toBe(200);

      const listPayload = await parseJson(listResponse);
      const connectors = listPayload.connectors as unknown[];
      expect(connectors.length).toBe(1);

      const metrics = listPayload.customMetrics as unknown[];
      expect(metrics.length).toBe(1);

      const metric = metrics[0] as Record<string, unknown>;
      expect(metric.label).toBe("Daily Revenue");
      expect(metric.unit).toBe("$");

      // List response must not contain raw credentials
      const listText = await listResponse.clone().text();
      expect(listText).not.toContain("postgres://user:pass");
    });
  });

  describe("duplicate prevention", () => {
    test("reject duplicate postgres setup for same startup", async () => {
      const { cookie, startup } =
        await setupWorkspaceAndStartup("pg-dup@example.com");

      // First creation succeeds
      const first = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "postgres",
          config: VALID_POSTGRES_CONFIG,
        },
      });
      expect(first.status).toBe(201);

      // Second creation fails — only one postgres connector per startup
      const second = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "postgres",
          config: VALID_POSTGRES_CONFIG,
        },
      });
      expect(second.status).toBe(409);
      const payload = await parseJson(second);
      expect(payload.error).toMatchObject({ code: "CONNECTOR_ALREADY_EXISTS" });
    });
  });

  describe("coexistence with PostHog and Stripe", () => {
    test("startup can have posthog, stripe, and postgres connectors", async () => {
      const { cookie, startup } = await setupWorkspaceAndStartup(
        "pg-coexist@example.com"
      );

      // Create PostHog
      const ph = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "posthog",
          config: POSTHOG_CONFIG,
        },
      });
      expect(ph.status).toBe(201);

      // Create Stripe
      const st = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "stripe",
          config: STRIPE_CONFIG,
        },
      });
      expect(st.status).toBe(201);

      // Create Postgres
      const pg = await send("/api/connectors", {
        method: "POST",
        cookie,
        body: {
          startupId: startup.id,
          provider: "postgres",
          config: VALID_POSTGRES_CONFIG,
        },
      });
      expect(pg.status).toBe(201);

      // List should show all three connectors plus custom metric
      const listResponse = await send(
        `/api/connectors?startupId=${startup.id}`,
        { cookie }
      );
      const listPayload = await parseJson(listResponse);
      expect((listPayload.connectors as unknown[]).length).toBe(3);
      expect((listPayload.customMetrics as unknown[]).length).toBe(1);
    });
  });

  describe("queue failure handling", () => {
    test("surface queue enqueue failure without corrupting connector or metric state", async () => {
      const failingQueue = createFailingQueueProducer(
        "Redis connection refused"
      );
      const failApp = await createApiApp(TEST_ENV, {
        posthogValidator: createStubPostHogValidator({ valid: true }),
        stripeValidator: createStubStripeValidator({ valid: true }),
        postgresValidator: createStubPostgresValidator({ valid: true }),
        queueProducer: failingQueue,
      });

      try {
        failApp.runtime.auth.resetMagicLinks();
        await failApp.runtime.db.resetAuthTables();

        const { cookie, startup } = await setupOnApp(
          failApp,
          "pg-qfail@example.com"
        );

        const response = await failApp.handle(
          new Request("http://localhost/api/connectors", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie,
            },
            body: JSON.stringify({
              startupId: startup.id,
              provider: "postgres",
              config: VALID_POSTGRES_CONFIG,
            }),
          })
        );

        expect(response.status).toBe(201);
        const payload = await parseJson(response);

        // Connector created successfully
        expect(payload.connector).toBeDefined();
        expect((payload.connector as Record<string, unknown>).provider).toBe(
          "postgres"
        );

        // Custom metric created successfully
        expect(payload.customMetric).toBeDefined();
        expect((payload.customMetric as Record<string, unknown>).label).toBe(
          "Daily Revenue"
        );

        // But sync job reflects the failure
        expect((payload.syncJob as Record<string, unknown>).status).toBe(
          "failed"
        );
      } finally {
        await failApp.runtime.db.close();
      }
    });
  });
});

// ---------------------------------------------------------------
// Helpers for tests that use a separate app instance
// ---------------------------------------------------------------

async function setupOnApp(testApp: ApiApp, email: string) {
  // Create session
  const signInResponse = await testApp.handle(
    new Request("http://localhost/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: "Founder" }),
    })
  );
  expect(signInResponse.status).toBe(200);
  const magicLink = testApp.runtime.auth.getLatestMagicLink(email);
  expect(magicLink).toBeDefined();
  const verifyResponse = await testApp.handle(new Request(magicLink!.url));
  const cookie =
    convertSetCookieToCookie(verifyResponse.headers).get("cookie") ?? "";
  expect(cookie.length).toBeGreaterThan(0);

  // Create workspace
  const wsResponse = await testApp.handle(
    new Request("http://localhost/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "PG Fail WS" }),
    })
  );
  expect(wsResponse.status).toBe(201);

  // Create startup
  const startupResponse = await testApp.handle(
    new Request("http://localhost/api/startups", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(VALID_STARTUP),
    })
  );
  const startupPayload = await parseJson(startupResponse);
  expect(startupResponse.status).toBe(201);

  return {
    cookie,
    startup: startupPayload.startup as {
      id: string;
      name: string;
      workspaceId: string;
    },
  };
}
