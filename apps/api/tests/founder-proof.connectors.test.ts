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
import {
  POSTHOG_DEMO_API_KEY,
  POSTHOG_DEMO_HOST,
  POSTHOG_DEMO_PROJECT_ID,
} from "../src/lib/connectors/posthog";
import { createStubQueueProducer } from "../src/lib/connectors/queue";
import { STRIPE_DEMO_SECRET_KEY } from "../src/lib/connectors/stripe";
import { readApiEnv } from "../src/lib/env";

const BASE_ENV = {
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
  name: "Proof Test Startup",
  type: "b2b_saas",
  stage: "mvp",
  timezone: "UTC",
  currency: "USD",
};

const POSTHOG_DEMO_CONFIG = {
  apiKey: POSTHOG_DEMO_API_KEY,
  projectId: POSTHOG_DEMO_PROJECT_ID,
  host: POSTHOG_DEMO_HOST,
};

const STRIPE_DEMO_CONFIG = {
  secretKey: STRIPE_DEMO_SECRET_KEY,
};

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

async function parseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function sendOnApp(
  testApp: ApiApp,
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

  return testApp.handle(
    new Request(`http://localhost${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  );
}

async function createSessionOnApp(testApp: ApiApp, email: string) {
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
  return { cookie };
}

async function createWorkspaceOnApp(
  testApp: ApiApp,
  cookie: string,
  name: string
) {
  const response = await sendOnApp(testApp, "/api/workspaces", {
    method: "POST",
    cookie,
    body: { name },
  });
  const payload = await parseJson(response);
  expect(response.status).toBe(201);
  return payload.workspace as { id: string; name: string; slug: string };
}

async function createStartupOnApp(
  testApp: ApiApp,
  cookie: string,
  overrides?: Partial<StartupDraft>
) {
  const response = await sendOnApp(testApp, "/api/startups", {
    method: "POST",
    cookie,
    body: { ...VALID_STARTUP, ...overrides },
  });
  const payload = await parseJson(response);
  expect(response.status).toBe(201);
  return payload.startup as { id: string; name: string; workspaceId: string };
}

async function setupWorkspaceAndStartupOnApp(testApp: ApiApp, email: string) {
  const { cookie } = await createSessionOnApp(testApp, email);
  await createWorkspaceOnApp(testApp, cookie, "Proof Workspace");
  const startup = await createStartupOnApp(testApp, cookie);
  return { cookie, startup };
}

// ---------------------------------------------------------------
// Tests: founder-proof env parsing
// ---------------------------------------------------------------

describe("founder-proof env parsing", () => {
  test("defaults to disabled when FOUNDER_PROOF_MODE is absent", () => {
    const env = readApiEnv({ ...BASE_ENV });
    expect(env.founderProofMode).toBe(false);
  });

  test("enables when FOUNDER_PROOF_MODE=true", () => {
    const env = readApiEnv({ ...BASE_ENV, FOUNDER_PROOF_MODE: "true" });
    expect(env.founderProofMode).toBe(true);
  });

  test("enables when FOUNDER_PROOF_MODE=1", () => {
    const env = readApiEnv({ ...BASE_ENV, FOUNDER_PROOF_MODE: "1" });
    expect(env.founderProofMode).toBe(true);
  });

  test("disables when FOUNDER_PROOF_MODE=false", () => {
    const env = readApiEnv({ ...BASE_ENV, FOUNDER_PROOF_MODE: "false" });
    expect(env.founderProofMode).toBe(false);
  });

  test("disables when FOUNDER_PROOF_MODE=0", () => {
    const env = readApiEnv({ ...BASE_ENV, FOUNDER_PROOF_MODE: "0" });
    expect(env.founderProofMode).toBe(false);
  });

  test("rejects malformed FOUNDER_PROOF_MODE values", () => {
    expect(() =>
      readApiEnv({ ...BASE_ENV, FOUNDER_PROOF_MODE: "yes" })
    ).toThrow(/FOUNDER_PROOF_MODE must be one of/);
    expect(() =>
      readApiEnv({ ...BASE_ENV, FOUNDER_PROOF_MODE: "enabled" })
    ).toThrow(/FOUNDER_PROOF_MODE must be one of/);
    expect(() =>
      readApiEnv({ ...BASE_ENV, FOUNDER_PROOF_MODE: "maybe" })
    ).toThrow(/FOUNDER_PROOF_MODE must be one of/);
  });
});

// ---------------------------------------------------------------
// Tests: proof mode is opt-in — demo credentials rejected when off
// ---------------------------------------------------------------

describe("founder-proof mode off (default)", () => {
  let app: ApiApp;
  let queueProducer: ReturnType<typeof createStubQueueProducer>;

  beforeAll(async () => {
    queueProducer = createStubQueueProducer({
      success: true,
      jobId: "stub-job-id",
    });
    // No FOUNDER_PROOF_MODE set — validators use real HTTP calls.
    // Provide no custom validators so the real ones are used.
    app = await createApiApp({ ...BASE_ENV }, { queueProducer });
  });

  beforeEach(async () => {
    app.runtime.auth.resetMagicLinks();
    await app.runtime.db.resetAuthTables();
  });

  afterAll(async () => {
    await app.runtime.db.close();
  });

  test("/api/health reports founderProofMode=false and validationMode=live", async () => {
    const response = await sendOnApp(app, "/api/health");
    const payload = await parseJson(response);
    expect(payload.founderProofMode).toBe(false);
    expect((payload.connectors as Record<string, unknown>).validationMode).toBe(
      "live"
    );
  });

  test("PostHog demo credentials fail when proof mode is off", async () => {
    const { cookie, startup } = await setupWorkspaceAndStartupOnApp(
      app,
      "proof-off-ph@example.com"
    );

    const response = await sendOnApp(app, "/api/connectors", {
      method: "POST",
      cookie,
      body: {
        startupId: startup.id,
        provider: "posthog",
        config: POSTHOG_DEMO_CONFIG,
      },
    });

    // Real validator will attempt HTTP call and fail — should get 422
    expect(response.status).toBe(422);
    const payload = await parseJson(response);
    expect(payload.error).toMatchObject({ code: "PROVIDER_VALIDATION_FAILED" });
  }, 15_000);

  test("Stripe demo credentials fail when proof mode is off", async () => {
    const { cookie, startup } = await setupWorkspaceAndStartupOnApp(
      app,
      "proof-off-st@example.com"
    );

    const response = await sendOnApp(app, "/api/connectors", {
      method: "POST",
      cookie,
      body: {
        startupId: startup.id,
        provider: "stripe",
        config: STRIPE_DEMO_CONFIG,
      },
    });

    // Real validator will attempt HTTP call and fail — should get 422
    expect(response.status).toBe(422);
    const payload = await parseJson(response);
    expect(payload.error).toMatchObject({ code: "PROVIDER_VALIDATION_FAILED" });
  }, 15_000);
});

// ---------------------------------------------------------------
// Tests: proof mode enabled — deterministic demo credentials accepted
// ---------------------------------------------------------------

describe("founder-proof mode on", () => {
  let app: ApiApp;
  let queueProducer: ReturnType<typeof createStubQueueProducer>;

  beforeAll(async () => {
    queueProducer = createStubQueueProducer({
      success: true,
      jobId: "stub-job-id",
    });
    // Explicitly enable founder-proof mode — no custom validators provided,
    // so createApiApp should create founder-proof validators automatically.
    app = await createApiApp(
      { ...BASE_ENV, FOUNDER_PROOF_MODE: "true" },
      { queueProducer }
    );
  });

  beforeEach(async () => {
    app.runtime.auth.resetMagicLinks();
    await app.runtime.db.resetAuthTables();
    queueProducer.calls.length = 0;
  });

  afterAll(async () => {
    await app.runtime.db.close();
  });

  test("/api/health reports founderProofMode=true and validationMode=founder-proof", async () => {
    const response = await sendOnApp(app, "/api/health");
    const payload = await parseJson(response);
    expect(payload.founderProofMode).toBe(true);
    expect((payload.connectors as Record<string, unknown>).validationMode).toBe(
      "founder-proof"
    );
  });

  test("/api/health does not leak secrets or connector config values", async () => {
    const response = await sendOnApp(app, "/api/health");
    const text = await response.clone().text();
    // Must not contain encryption key, auth secret, or any demo credential values
    expect(text).not.toContain(BASE_ENV.CONNECTOR_ENCRYPTION_KEY);
    expect(text).not.toContain(BASE_ENV.BETTER_AUTH_SECRET);
    expect(text).not.toContain(POSTHOG_DEMO_API_KEY);
    expect(text).not.toContain(STRIPE_DEMO_SECRET_KEY);
  });

  test("PostHog demo credentials succeed in proof mode", async () => {
    const { cookie, startup } = await setupWorkspaceAndStartupOnApp(
      app,
      "proof-on-ph@example.com"
    );

    const response = await sendOnApp(app, "/api/connectors", {
      method: "POST",
      cookie,
      body: {
        startupId: startup.id,
        provider: "posthog",
        config: POSTHOG_DEMO_CONFIG,
      },
    });

    expect(response.status).toBe(201);
    const payload = await parseJson(response);
    expect((payload.connector as Record<string, unknown>).provider).toBe(
      "posthog"
    );
    expect((payload.connector as Record<string, unknown>).status).toBe(
      "pending"
    );

    // Credentials must be redacted in the response
    const text = await response.clone().text();
    expect(text).not.toContain(POSTHOG_DEMO_API_KEY);
  });

  test("Stripe demo credentials succeed in proof mode", async () => {
    const { cookie, startup } = await setupWorkspaceAndStartupOnApp(
      app,
      "proof-on-st@example.com"
    );

    const response = await sendOnApp(app, "/api/connectors", {
      method: "POST",
      cookie,
      body: {
        startupId: startup.id,
        provider: "stripe",
        config: STRIPE_DEMO_CONFIG,
      },
    });

    expect(response.status).toBe(201);
    const payload = await parseJson(response);
    expect((payload.connector as Record<string, unknown>).provider).toBe(
      "stripe"
    );

    // Credentials must be redacted in the response
    const text = await response.clone().text();
    expect(text).not.toContain(STRIPE_DEMO_SECRET_KEY);
  });

  test("both PostHog and Stripe can be connected for the same startup in proof mode", async () => {
    const { cookie, startup } = await setupWorkspaceAndStartupOnApp(
      app,
      "proof-both@example.com"
    );

    const phResponse = await sendOnApp(app, "/api/connectors", {
      method: "POST",
      cookie,
      body: {
        startupId: startup.id,
        provider: "posthog",
        config: POSTHOG_DEMO_CONFIG,
      },
    });
    expect(phResponse.status).toBe(201);

    const stResponse = await sendOnApp(app, "/api/connectors", {
      method: "POST",
      cookie,
      body: {
        startupId: startup.id,
        provider: "stripe",
        config: STRIPE_DEMO_CONFIG,
      },
    });
    expect(stResponse.status).toBe(201);

    const listResponse = await sendOnApp(
      app,
      `/api/connectors?startupId=${startup.id}`,
      { cookie }
    );
    const listPayload = await parseJson(listResponse);
    expect((listPayload.connectors as unknown[]).length).toBe(2);
  });

  test("workspace scoping still works in proof mode", async () => {
    // User A sets up workspace + startup
    const { startup } = await setupWorkspaceAndStartupOnApp(
      app,
      "proof-scope-a@example.com"
    );

    // User B with their own workspace
    const { cookie: cookieB } = await createSessionOnApp(
      app,
      "proof-scope-b@example.com"
    );
    await createWorkspaceOnApp(app, cookieB, "Other Proof Workspace");

    // User B tries to create a connector on User A's startup
    const response = await sendOnApp(app, "/api/connectors", {
      method: "POST",
      cookie: cookieB,
      body: {
        startupId: startup.id,
        provider: "posthog",
        config: POSTHOG_DEMO_CONFIG,
      },
    });
    expect(response.status).toBe(403);
    const payload = await parseJson(response);
    expect(payload.error).toMatchObject({ code: "STARTUP_SCOPE_INVALID" });
  });
});

// ---------------------------------------------------------------
// Negative tests: malformed inputs in proof mode
// ---------------------------------------------------------------

describe("founder-proof mode negative tests", () => {
  let app: ApiApp;
  let queueProducer: ReturnType<typeof createStubQueueProducer>;

  beforeAll(async () => {
    queueProducer = createStubQueueProducer({
      success: true,
      jobId: "stub-job-id",
    });
    app = await createApiApp(
      { ...BASE_ENV, FOUNDER_PROOF_MODE: "true" },
      { queueProducer }
    );
  });

  beforeEach(async () => {
    app.runtime.auth.resetMagicLinks();
    await app.runtime.db.resetAuthTables();
  });

  afterAll(async () => {
    await app.runtime.db.close();
  });

  test("blank PostHog fields rejected even in proof mode", async () => {
    const { cookie, startup } = await setupWorkspaceAndStartupOnApp(
      app,
      "proof-blank-ph@example.com"
    );

    const response = await sendOnApp(app, "/api/connectors", {
      method: "POST",
      cookie,
      body: {
        startupId: startup.id,
        provider: "posthog",
        config: { apiKey: "", projectId: "", host: "" },
      },
    });
    expect(response.status).toBe(422);
  });

  test("blank Stripe key rejected even in proof mode", async () => {
    const { cookie, startup } = await setupWorkspaceAndStartupOnApp(
      app,
      "proof-blank-st@example.com"
    );

    const response = await sendOnApp(app, "/api/connectors", {
      method: "POST",
      cookie,
      body: {
        startupId: startup.id,
        provider: "stripe",
        config: { secretKey: "" },
      },
    });
    expect(response.status).toBe(422);
  });

  test("non-demo PostHog credentials rejected in proof mode", async () => {
    const { cookie, startup } = await setupWorkspaceAndStartupOnApp(
      app,
      "proof-nondemo-ph@example.com"
    );

    const response = await sendOnApp(app, "/api/connectors", {
      method: "POST",
      cookie,
      body: {
        startupId: startup.id,
        provider: "posthog",
        config: {
          apiKey: "phx_real_key",
          projectId: "99999",
          host: "https://app.posthog.com",
        },
      },
    });
    expect(response.status).toBe(422);
    const payload = await parseJson(response);
    expect((payload.error as Record<string, unknown>).message).toContain(
      "deterministic demo credentials"
    );
  });

  test("non-demo Stripe key rejected in proof mode", async () => {
    const { cookie, startup } = await setupWorkspaceAndStartupOnApp(
      app,
      "proof-nondemo-st@example.com"
    );

    const response = await sendOnApp(app, "/api/connectors", {
      method: "POST",
      cookie,
      body: {
        startupId: startup.id,
        provider: "stripe",
        config: { secretKey: "sk_test_real_key_value" },
      },
    });
    expect(response.status).toBe(422);
    const payload = await parseJson(response);
    expect((payload.error as Record<string, unknown>).message).toContain(
      "deterministic demo"
    );
  });

  test("unsupported provider still rejected in proof mode", async () => {
    const { cookie, startup } = await setupWorkspaceAndStartupOnApp(
      app,
      "proof-unsupported@example.com"
    );

    const response = await sendOnApp(app, "/api/connectors", {
      method: "POST",
      cookie,
      body: { startupId: startup.id, provider: "hubspot", config: {} },
    });
    expect(response.status).toBe(400);
    const payload = await parseJson(response);
    expect(payload.error).toMatchObject({ code: "UNSUPPORTED_PROVIDER" });
  });

  test("invalid Stripe key format still rejected in proof mode", async () => {
    const { cookie, startup } = await setupWorkspaceAndStartupOnApp(
      app,
      "proof-badformat@example.com"
    );

    const response = await sendOnApp(app, "/api/connectors", {
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
    expect((payload.error as Record<string, unknown>).message).toContain(
      "key format is invalid"
    );
  });
});
