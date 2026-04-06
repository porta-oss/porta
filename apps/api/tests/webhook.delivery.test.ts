import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac, randomUUID } from "node:crypto";

import type { ApiApp } from "../src/app";
import {
  type CircuitBreakerResult,
  deliverWebhook,
  recordDeliveryResult,
  signPayload,
  validateUrl,
} from "../src/lib/webhooks/delivery";
import {
  closeTestApiApp,
  createTestApiApp,
  requireValue,
} from "./helpers/test-app";

// ---------------------------------------------------------------------------
// Test environment (DB needed for circuit breaker test)
// ---------------------------------------------------------------------------

let app: ApiApp | undefined;

function getApp() {
  return requireValue(app, "Expected API test app to be initialized.");
}

function getPool() {
  return getApp().runtime.db.pool;
}

beforeAll(async () => {
  app = await createTestApiApp();
});

afterAll(async () => {
  await closeTestApiApp(app);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedStartup(): Promise<{
  startupId: string;
  workspaceId: string;
}> {
  const pool = getPool();
  const workspaceId = randomUUID();
  const startupId = randomUUID();
  const userId = randomUUID();

  await pool.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
     VALUES ('${userId}', 'Test User', 'test-${userId}@example.com', true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO "workspace" (id, name, slug, created_at)
     VALUES ('${workspaceId}', 'Test WS', 'ws-${workspaceId.slice(0, 8)}', NOW())
     ON CONFLICT (id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO "member" (id, organization_id, user_id, role, created_at)
     VALUES ('${randomUUID()}', '${workspaceId}', '${userId}', 'owner', NOW())
     ON CONFLICT (id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO "startup" (id, workspace_id, name, type, stage, timezone, currency, created_at, updated_at)
     VALUES ('${startupId}', '${workspaceId}', 'Test Startup', 'b2b_saas', 'mvp', 'UTC', 'USD', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`
  );

  return { workspaceId, startupId };
}

async function seedWebhookConfig(
  startupId: string,
  overrides?: {
    consecutiveFailures?: number;
    enabled?: boolean;
    id?: string;
    secret?: string;
    url?: string;
  }
) {
  const pool = getPool();
  const id = overrides?.id ?? randomUUID();
  const url = overrides?.url ?? "https://example.com/webhook";
  const secret = overrides?.secret ?? "test-secret-key-32-chars-long!!";
  const enabled = overrides?.enabled ?? true;
  const consecutiveFailures = overrides?.consecutiveFailures ?? 0;

  await pool.query(
    `INSERT INTO "webhook_config" (id, startup_id, url, secret, event_types, enabled, consecutive_failures, created_at, updated_at)
     VALUES ('${id}', '${startupId}', '${url}', '${secret}', '["alert.fired"]', ${enabled}, ${consecutiveFailures}, NOW(), NOW())`
  );

  return { id, secret };
}

/** Stub resolver that returns the given IPs for any hostname. */
function fakeResolver(ips: string[]) {
  return async (_hostname: string) => ips;
}

/** Stub fetcher that returns a canned response. */
function fakeFetcher(status: number) {
  return async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(null, { status });
}

// ============================================================================
// 1. HMAC-SHA256 signature computation
// ============================================================================

describe("signPayload", () => {
  test("computes HMAC-SHA256 matching expected format", () => {
    const body = JSON.stringify({
      deliveryId: "d1",
      event: "alert.fired",
      payload: { value: 42 },
      startupId: "s1",
      timestamp: "2026-01-01T00:00:00Z",
    });
    const secret = "my-webhook-secret";

    const signature = signPayload(body, secret);

    // Independently compute expected HMAC
    const expected = createHmac("sha256", secret).update(body).digest("hex");

    expect(signature).toBe(expected);
    // Must be a 64-char hex string (SHA-256 = 32 bytes = 64 hex chars)
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ============================================================================
// 2. SSRF validation — reject blocked IPs
// ============================================================================

describe("validateUrl SSRF protection", () => {
  test("rejects private IP 10.0.0.1 via DNS resolution", async () => {
    const result = await validateUrl(
      "https://internal.example.com/hook",
      fakeResolver(["10.0.0.1"])
    );

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("rejects loopback 127.0.0.1", async () => {
    const result = await validateUrl(
      "https://localhost-alias.example.com/hook",
      fakeResolver(["127.0.0.1"])
    );

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("rejects link-local 169.254.1.1", async () => {
    const result = await validateUrl(
      "https://link-local.example.com/hook",
      fakeResolver(["169.254.1.1"])
    );

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("rejects cloud metadata 169.254.169.254", async () => {
    const result = await validateUrl(
      "https://metadata.example.com/hook",
      fakeResolver(["169.254.169.254"])
    );

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("rejects non-HTTPS URLs", async () => {
    const result = await validateUrl("http://example.com/hook");

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("HTTPS");
  });

  test("allows valid public HTTPS URL", async () => {
    // Resolver returns a public IP
    const result = await validateUrl(
      "https://hooks.example.com/webhook",
      fakeResolver(["93.184.216.34"])
    );

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

// ============================================================================
// 3. DNS rebinding guard — re-resolve at delivery time
// ============================================================================

describe("DNS rebinding guard", () => {
  test("re-resolves DNS at delivery time, rejects if IP becomes private", async () => {
    // Scenario: URL passed initial validation (public IP), but at delivery
    // time DNS now resolves to a private IP (DNS rebinding attack).
    // deliverWebhook must re-resolve and reject.

    const config = {
      id: "wh-rebind",
      secret: "test-secret-for-rebind",
      url: "https://rebind.attacker.example.com/hook",
    };

    const payload = {
      deliveryId: randomUUID(),
      event: "alert.fired",
      payload: { ruleId: "r1", severity: "critical" },
      startupId: "s1",
      timestamp: new Date().toISOString(),
    };

    // At delivery time, DNS resolves to a private IP (attacker rebind)
    const result = await deliverWebhook(config, payload, {
      resolver: fakeResolver(["10.0.0.1"]),
      fetcher: fakeFetcher(200),
    });

    // Must fail — DNS rebinding detected
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("succeeds when DNS resolves to public IP at delivery time", async () => {
    const config = {
      id: "wh-ok",
      secret: "test-secret-ok",
      url: "https://hooks.legit.example.com/hook",
    };

    const payload = {
      deliveryId: randomUUID(),
      event: "alert.fired",
      payload: { ruleId: "r1", severity: "critical" },
      startupId: "s1",
      timestamp: new Date().toISOString(),
    };

    const result = await deliverWebhook(config, payload, {
      resolver: fakeResolver(["93.184.216.34"]),
      fetcher: fakeFetcher(200),
    });

    expect(result.success).toBe(true);
    expect(result.httpStatus).toBe(200);
  });
});

// ============================================================================
// 4. Circuit breaker — 10 consecutive failures disables webhook
// ============================================================================

describe("circuit breaker", () => {
  test("disables webhook after 10 consecutive failures", async () => {
    const { startupId } = await seedStartup();
    const webhookId = randomUUID();

    // Seed webhook with 9 consecutive failures (one away from tripping)
    await seedWebhookConfig(startupId, {
      consecutiveFailures: 9,
      enabled: true,
      id: webhookId,
    });

    // Record the 10th failure — should trip the circuit breaker
    const result: CircuitBreakerResult = await recordDeliveryResult(
      getPool(),
      webhookId,
      false
    );

    expect(result.circuitBroken).toBe(true);
    expect(result.consecutiveFailures).toBe(10);

    // Verify DB state: webhook disabled with circuit_broken_at set
    const dbResult = (await getPool().query(
      `SELECT enabled, consecutive_failures, circuit_broken_at
       FROM "webhook_config" WHERE id = '${webhookId}'`
    )) as {
      rows: Array<{
        circuit_broken_at: string | null;
        consecutive_failures: number;
        enabled: boolean;
      }>;
    };

    expect(dbResult.rows[0].enabled).toBe(false);
    expect(dbResult.rows[0].consecutive_failures).toBe(10);
    expect(dbResult.rows[0].circuit_broken_at).not.toBeNull();
  });

  test("resets consecutive failures to 0 on success", async () => {
    const { startupId } = await seedStartup();
    const webhookId = randomUUID();

    await seedWebhookConfig(startupId, {
      consecutiveFailures: 5,
      enabled: true,
      id: webhookId,
    });

    const result: CircuitBreakerResult = await recordDeliveryResult(
      getPool(),
      webhookId,
      true
    );

    expect(result.circuitBroken).toBe(false);
    expect(result.consecutiveFailures).toBe(0);

    // Verify DB state
    const dbResult = (await getPool().query(
      `SELECT consecutive_failures FROM "webhook_config" WHERE id = '${webhookId}'`
    )) as { rows: Array<{ consecutive_failures: number }> };

    expect(dbResult.rows[0].consecutive_failures).toBe(0);
  });

  test("does not trip circuit breaker before 10 failures", async () => {
    const { startupId } = await seedStartup();
    const webhookId = randomUUID();

    await seedWebhookConfig(startupId, {
      consecutiveFailures: 8,
      enabled: true,
      id: webhookId,
    });

    // 9th failure — not yet at threshold
    const result: CircuitBreakerResult = await recordDeliveryResult(
      getPool(),
      webhookId,
      false
    );

    expect(result.circuitBroken).toBe(false);
    expect(result.consecutiveFailures).toBe(9);

    // Webhook should still be enabled
    const dbResult = (await getPool().query(
      `SELECT enabled FROM "webhook_config" WHERE id = '${webhookId}'`
    )) as { rows: Array<{ enabled: boolean }> };

    expect(dbResult.rows[0].enabled).toBe(true);
  });
});
