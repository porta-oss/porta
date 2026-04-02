import { describe, expect, test } from "bun:test";

import {
  DEFAULT_EDITION,
  isValidEdition,
  parseEdition,
  VALID_EDITIONS,
} from "@shared/edition";

import { createApiApp } from "../src/app";
import { createBootstrapDiagnostics, readApiEnv } from "../src/lib/env";

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

// ===========================================================================
// Edition contract: shared helpers
// ===========================================================================

describe("edition contract (shared)", () => {
  test("DEFAULT_EDITION is community", () => {
    expect(DEFAULT_EDITION).toBe("community");
  });

  test("VALID_EDITIONS contains community and pro", () => {
    expect(VALID_EDITIONS.has("community")).toBe(true);
    expect(VALID_EDITIONS.has("pro")).toBe(true);
    expect(VALID_EDITIONS.size).toBe(2);
  });

  test("isValidEdition accepts valid values", () => {
    expect(isValidEdition("community")).toBe(true);
    expect(isValidEdition("pro")).toBe(true);
  });

  test("isValidEdition rejects invalid values", () => {
    expect(isValidEdition("enterprise")).toBe(false);
    expect(isValidEdition("")).toBe(false);
    expect(isValidEdition("COMMUNITY")).toBe(false);
  });

  test("parseEdition defaults to community when absent or empty", () => {
    expect(parseEdition(undefined)).toBe("community");
    expect(parseEdition("")).toBe("community");
  });

  test("parseEdition accepts community and pro (case-insensitive)", () => {
    expect(parseEdition("community")).toBe("community");
    expect(parseEdition("pro")).toBe("pro");
    expect(parseEdition("  Pro  ")).toBe("pro");
    expect(parseEdition("COMMUNITY")).toBe("community");
  });

  test("parseEdition throws on invalid value", () => {
    expect(() => parseEdition("enterprise")).toThrow(/PORTA_EDITION/);
    expect(() => parseEdition("cloud")).toThrow(/PORTA_EDITION/);
  });
});

// ===========================================================================
// API env: edition + host parsing
// ===========================================================================

describe("readApiEnv edition and host", () => {
  test("defaults edition to community when PORTA_EDITION is absent", () => {
    const env = readApiEnv(baseEnv());
    expect(env.edition).toBe("community");
  });

  test("accepts PORTA_EDITION=pro", () => {
    const env = readApiEnv(baseEnv({ PORTA_EDITION: "pro" }));
    expect(env.edition).toBe("pro");
  });

  test("throws on invalid PORTA_EDITION", () => {
    expect(() => readApiEnv(baseEnv({ PORTA_EDITION: "enterprise" }))).toThrow(
      /PORTA_EDITION/
    );
  });

  test("defaults apiHost to 0.0.0.0 when absent", () => {
    const env = readApiEnv(baseEnv());
    expect(env.apiHost).toBe("0.0.0.0");
  });

  test("respects explicit API_HOST", () => {
    const env = readApiEnv(baseEnv({ API_HOST: "127.0.0.1" }));
    expect(env.apiHost).toBe("127.0.0.1");
  });

  test("trims and falls back on blank API_HOST", () => {
    const env = readApiEnv(baseEnv({ API_HOST: "  " }));
    expect(env.apiHost).toBe("0.0.0.0");
  });
});

// ===========================================================================
// Health payload contract
// ===========================================================================

describe("/api/health edition metadata", () => {
  const minimalDb = {
    db: {} as unknown,
    bootstrap: async () => {},
    close: async () => {},
    resetAuthTables: async () => {},
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
    resetMagicLinks: () => {},
  };

  test("health response contains edition and runtime metadata", async () => {
    const env = readApiEnv(baseEnv({ PORTA_EDITION: "pro" }));
    const app = await createApiApp(baseEnv({ PORTA_EDITION: "pro" }), {
      env,
      db: minimalDb as any,
      auth: minimalAuth as any,
      bootstrapDatabase: false,
      posthogValidator: { validate: async () => ({ valid: true }) } as any,
      stripeValidator: { validate: async () => ({ valid: true }) } as any,
      postgresValidator: { validate: async () => ({ valid: true }) } as any,
      queueProducer: { enqueue: async () => ({ success: true }) } as any,
      taskSyncQueueProducer: {
        enqueue: async () => ({ success: true }),
      } as any,
    });

    const response = await app.handle(
      new Request("http://localhost:3000/api/health")
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.edition).toBe("pro");
    expect(body.runtime).toBeDefined();

    const runtime = body.runtime as Record<string, unknown>;
    expect(runtime.nodeEnv).toBe("test");
    expect(runtime.founderProofMode).toBe(false);
    expect(runtime.apiHost).toBe("0.0.0.0");
  });

  test("health response defaults edition to community", async () => {
    const env = readApiEnv(baseEnv());
    const app = await createApiApp(baseEnv(), {
      env,
      db: minimalDb as any,
      auth: minimalAuth as any,
      bootstrapDatabase: false,
      posthogValidator: { validate: async () => ({ valid: true }) } as any,
      stripeValidator: { validate: async () => ({ valid: true }) } as any,
      postgresValidator: { validate: async () => ({ valid: true }) } as any,
      queueProducer: { enqueue: async () => ({ success: true }) } as any,
      taskSyncQueueProducer: {
        enqueue: async () => ({ success: true }),
      } as any,
    });

    const response = await app.handle(
      new Request("http://localhost:3000/api/health")
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.edition).toBe("community");
  });

  test("health response does not leak secrets", async () => {
    const env = readApiEnv(baseEnv());
    const app = await createApiApp(baseEnv(), {
      env,
      db: minimalDb as any,
      auth: minimalAuth as any,
      bootstrapDatabase: false,
      posthogValidator: { validate: async () => ({ valid: true }) } as any,
      stripeValidator: { validate: async () => ({ valid: true }) } as any,
      postgresValidator: { validate: async () => ({ valid: true }) } as any,
      queueProducer: { enqueue: async () => ({ success: true }) } as any,
      taskSyncQueueProducer: {
        enqueue: async () => ({ success: true }),
      } as any,
    });

    const response = await app.handle(
      new Request("http://localhost:3000/api/health")
    );
    const text = await response.text();

    // The secret and encryption key must never appear in the health payload
    expect(text).not.toContain("0123456789abcdef0123456789abcdef");
    expect(text).not.toContain(baseEnv().BETTER_AUTH_SECRET);
    // databaseUrl / redisUrl with credentials must not appear raw
    expect(text).not.toContain("postgres://postgres:postgres");
  });
});

// ===========================================================================
// Bootstrap diagnostics: edition field
// ===========================================================================

describe("createBootstrapDiagnostics includes edition", () => {
  test("includes edition from source", () => {
    const diagnostics = createBootstrapDiagnostics(
      { PORTA_EDITION: "pro" },
      new Error("test error")
    );
    expect(diagnostics.edition).toBe("pro");
  });

  test("defaults edition to community when absent", () => {
    const diagnostics = createBootstrapDiagnostics({}, new Error("test error"));
    expect(diagnostics.edition).toBe("community");
  });
});
