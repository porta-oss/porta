import { describe, expect, test } from "bun:test";

import { createApiApp } from "../src/app";
import { readApiEnv } from "../src/lib/env";

// ---------------------------------------------------------------------------
// Minimal env that satisfies readApiEnv({ strict: false })
// ---------------------------------------------------------------------------
function baseEnv(overrides: Record<string, string> = {}) {
  return {
    NODE_ENV: "test",
    API_PORT: "3000",
    API_URL: "http://localhost:3000",
    WEB_URL: "http://localhost:5173",
    DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/porta",
    REDIS_URL: "redis://127.0.0.1:6379",
    BETTER_AUTH_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
    CONNECTOR_ENCRYPTION_KEY:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    MAGIC_LINK_SENDER_EMAIL: "dev@porta.local",
    AUTH_CONTEXT_TIMEOUT_MS: "2000",
    DATABASE_CONNECT_TIMEOUT_MS: "5000",
    DATABASE_POOL_MAX: "5",
    ...overrides,
  };
}

const noopAsync = async () => {
  /* intentionally empty test stub */
  await Promise.resolve();
};

const noop = () => {
  /* intentionally empty test stub */
  return;
};

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------
const minimalDb = {
  db: {} as unknown,
  bootstrap: noopAsync,
  close: noopAsync,
  resetAuthTables: noopAsync,
  getSchemaDiagnostics: () => ({
    tables: {
      user: true,
      session: true,
      account: true,
      verification: true,
      workspace: true,
      member: true,
      invitation: true,
      startup: true,
      connector: true,
      sync_job: true,
      health_snapshot: true,
      health_funnel_stage: true,
      startup_insight: true,
      internal_task: true,
      custom_metric: true,
    },
    summary: { total: 15, present: 15, missing: 0 },
  }),
};

const minimalAuth = {
  auth: { handler: async () => new Response("OK") },
  bootstrap: {
    basePath: "/api/auth",
    providers: {
      google: {
        configured: false,
        missing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      },
    },
    magicLinkTransport: "log",
  },
  listMagicLinks: () => [],
  resetMagicLinks: noop,
};

const minimalValidators = {
  posthogValidator: { validate: async () => ({ valid: true }) } as never,
  stripeValidator: { validate: async () => ({ valid: true }) } as never,
  postgresValidator: { validate: async () => ({ valid: true }) } as never,
  queueProducer: { enqueue: async () => ({ success: true }) } as never,
  taskSyncQueueProducer: { enqueue: async () => ({ success: true }) } as never,
};

async function createTestApp(envOverrides: Record<string, string> = {}) {
  const envSource = baseEnv(envOverrides);
  const env = readApiEnv(envSource);
  return createApiApp(envSource, {
    env,
    db: minimalDb as never,
    auth: minimalAuth as never,
    bootstrapDatabase: false,
    ...minimalValidators,
  });
}

async function fetchHealth(app: Awaited<ReturnType<typeof createTestApp>>) {
  return app.handle(new Request("http://localhost:3000/api/health"));
}

// ===========================================================================
// Alpha maturity contract
// ===========================================================================

describe("/api/health alpha maturity metadata", () => {
  test("health response contains release block with product, maturity, license, and support", async () => {
    const app = await createTestApp();
    const response = await fetchHealth(app);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.release).toBeDefined();

    const release = body.release as Record<string, unknown>;
    expect(release.product).toBe("porta");
    expect(release.maturity).toBe("alpha");
    expect(release.license).toBe("AGPL-3.0");
    expect(release.support).toBe("community");
  });

  test("release metadata is present alongside edition and service fields", async () => {
    const app = await createTestApp({ PORTA_EDITION: "pro" });
    const response = await fetchHealth(app);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.service).toBe("api");
    expect(body.edition).toBe("pro");
    expect(body.release).toBeDefined();

    const release = body.release as Record<string, unknown>;
    expect(release.product).toBe("porta");
    expect(release.maturity).toBe("alpha");
  });

  test("maturity field is exactly 'alpha' (not a different string)", async () => {
    const app = await createTestApp();
    const response = await fetchHealth(app);
    const body = (await response.json()) as Record<string, unknown>;
    const release = body.release as Record<string, unknown>;

    // Must be the exact string "alpha", not "beta", "stable", etc.
    expect(release.maturity).toBe("alpha");
    expect(typeof release.maturity).toBe("string");
  });
});

// ===========================================================================
// Porta identity fields
// ===========================================================================

describe("/api/health Porta identity fields", () => {
  test("service is 'api'", async () => {
    const app = await createTestApp();
    const response = await fetchHealth(app);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.service).toBe("api");
  });

  test("release.product is 'porta'", async () => {
    const app = await createTestApp();
    const response = await fetchHealth(app);
    const body = (await response.json()) as Record<string, unknown>;
    const release = body.release as Record<string, unknown>;

    expect(release.product).toBe("porta");
  });

  test("all required identity fields are present", async () => {
    const app = await createTestApp();
    const response = await fetchHealth(app);
    const body = (await response.json()) as Record<string, unknown>;

    // Top-level identity
    expect(body.status).toBe("ok");
    expect(body.service).toBe("api");
    expect(body.edition).toBeDefined();

    // Release identity
    const release = body.release as Record<string, unknown>;
    expect(release.product).toBe("porta");
    expect(release.maturity).toBe("alpha");
    expect(release.license).toBe("AGPL-3.0");
    expect(release.support).toBe("community");
  });
});

// ===========================================================================
// Secret redaction (negative tests)
// ===========================================================================

describe("/api/health secret redaction (alpha contract)", () => {
  test("does not leak BETTER_AUTH_SECRET", async () => {
    const app = await createTestApp();
    const response = await fetchHealth(app);
    const text = await response.text();

    expect(text).not.toContain("0123456789abcdef0123456789abcdef");
    expect(text).not.toContain(baseEnv().BETTER_AUTH_SECRET);
  });

  test("does not leak CONNECTOR_ENCRYPTION_KEY", async () => {
    const app = await createTestApp();
    const response = await fetchHealth(app);
    const text = await response.text();

    expect(text).not.toContain(baseEnv().CONNECTOR_ENCRYPTION_KEY);
  });

  test("does not leak raw database or redis URLs with credentials", async () => {
    const app = await createTestApp();
    const response = await fetchHealth(app);
    const text = await response.text();

    expect(text).not.toContain("postgres://postgres:postgres");
    expect(text).not.toContain("redis://127.0.0.1:6379");
  });

  test("does not serialize the full env object", async () => {
    const app = await createTestApp();
    const response = await fetchHealth(app);
    const text = await response.text();

    // These keys should never appear in the response body
    expect(text).not.toContain("betterAuthSecret");
    expect(text).not.toContain("databaseUrl");
    expect(text).not.toContain("redisUrl");
    expect(text).not.toContain("connectorEncryptionKey");
  });
});

// ===========================================================================
// Edge cases and negative scenarios
// ===========================================================================

describe("/api/health alpha edge cases", () => {
  test("health response is valid JSON with 200 status", async () => {
    const app = await createTestApp();
    const response = await fetchHealth(app);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toBeDefined();
    expect(typeof body).toBe("object");
  });

  test("release block exists even when optional env vars are absent", async () => {
    // No GOOGLE_CLIENT_ID, no GOOGLE_CLIENT_SECRET, no ANTHROPIC_API_KEY, no LINEAR_API_KEY
    const app = await createTestApp();
    const response = await fetchHealth(app);
    const body = (await response.json()) as Record<string, unknown>;
    const release = body.release as Record<string, unknown>;

    expect(release.product).toBe("porta");
    expect(release.maturity).toBe("alpha");
  });

  test("release block is machine-parseable (all string values)", async () => {
    const app = await createTestApp();
    const response = await fetchHealth(app);
    const body = (await response.json()) as Record<string, unknown>;
    const release = body.release as Record<string, unknown>;

    for (const value of Object.values(release)) {
      expect(typeof value).toBe("string");
    }
  });

  test("community edition plus alpha maturity both present simultaneously", async () => {
    const app = await createTestApp();
    const response = await fetchHealth(app);
    const body = (await response.json()) as Record<string, unknown>;
    const release = body.release as Record<string, unknown>;

    expect(body.edition).toBe("community");
    expect(release.maturity).toBe("alpha");
  });

  test("pro edition plus alpha maturity both present simultaneously", async () => {
    const app = await createTestApp({ PORTA_EDITION: "pro" });
    const response = await fetchHealth(app);
    const body = (await response.json()) as Record<string, unknown>;
    const release = body.release as Record<string, unknown>;

    expect(body.edition).toBe("pro");
    expect(release.maturity).toBe("alpha");
  });
});
