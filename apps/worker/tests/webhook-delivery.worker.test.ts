// Webhook delivery processor tests.
// Tests the processor with in-memory DB stubs and mock delivery function.
// No Redis or Postgres required — the processor is pure logic over injected interfaces.

import { describe, expect, test } from "bun:test";
import { createWebhookDeliveryProcessor } from "../src/processors/webhook";
import type { WebhookJobPayload } from "../src/queues";

// ---------- helpers ----------

function makeJob(
  data: WebhookJobPayload,
  opts?: { id?: string; attemptsMade?: number }
) {
  return {
    id: opts?.id ?? "bullmq-webhook-1",
    data,
    attemptsMade: opts?.attemptsMade ?? 0,
    name: "webhook",
  } as any;
}

function createTestLog() {
  const messages: Array<{
    level: string;
    msg: string;
    meta?: Record<string, unknown>;
  }> = [];
  return {
    messages,
    info(msg: string, meta?: Record<string, unknown>) {
      messages.push({ level: "info", msg, meta });
    },
    warn(msg: string, meta?: Record<string, unknown>) {
      messages.push({ level: "warn", msg, meta });
    },
    error(msg: string, meta?: Record<string, unknown>) {
      messages.push({ level: "error", msg, meta });
    },
  };
}

const defaultJobPayload: WebhookJobPayload = {
  deliveryId: "delivery-001",
  eventType: "health_snapshot.created",
  payload: { score: 72 },
  startupId: "startup-001",
  webhookConfigId: "wh-config-001",
};

interface DbRow {
  [key: string]: unknown;
}

/**
 * In-memory DB stub that returns configurable rows per query.
 * The queryHandler receives the SQL string and returns rows.
 */
function createStubDb(queryHandler?: (sql: string) => DbRow[]) {
  const queries: string[] = [];

  const defaultHandler = (sqlStr: string): DbRow[] => {
    if (sqlStr.includes("webhook_config")) {
      return [
        {
          id: "wh-config-001",
          startup_id: "startup-001",
          url: "https://example.com/hook",
          secret: "test-secret-key",
          enabled: true,
        },
      ];
    }
    if (sqlStr.includes("startup")) {
      return [{ workspace_id: "ws-001" }];
    }
    return [];
  };

  const handler = queryHandler ?? defaultHandler;

  return {
    queries,
    execute(query: unknown) {
      const queryStr = JSON.stringify(query);
      queries.push(queryStr);
      const rows = handler(queryStr);
      return Promise.resolve({ rows });
    },
  };
}

/**
 * In-memory pool stub that records raw SQL queries and returns configurable results.
 */
function createStubPool(queryHandler?: (sql: string) => { rows: DbRow[] }) {
  const queries: string[] = [];

  return {
    queries,
    query(sql: string) {
      queries.push(sql);
      if (queryHandler) {
        return Promise.resolve(queryHandler(sql));
      }
      // Default: return 0 consecutive_failures
      if (sql.includes("RETURNING")) {
        return Promise.resolve({
          rows: [{ consecutive_failures: 1 }],
        });
      }
      return Promise.resolve({ rows: [] });
    },
  };
}

// ---------- tests ----------

describe("webhook delivery processor", () => {
  test("delivers webhook and logs success", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const pool = createStubPool();

    const processor = createWebhookDeliveryProcessor({
      db,
      pool,
      log,
      deliveryOptions: {
        resolver: async () => ["1.2.3.4"],
        fetcher: async () => new Response("OK", { status: 200 }),
      },
    });

    await processor(makeJob(defaultJobPayload));

    const successMsg = log.messages.find((m) => m.msg === "webhook delivered");
    expect(successMsg).toBeTruthy();
    expect(successMsg?.meta?.httpStatus).toBe(200);
  });

  test("skips delivery when webhook config not found", async () => {
    const log = createTestLog();
    const db = createStubDb(() => []);
    const pool = createStubPool();

    const processor = createWebhookDeliveryProcessor({
      db,
      pool,
      log,
      deliveryOptions: {
        resolver: async () => ["1.2.3.4"],
        fetcher: async () => new Response("OK", { status: 200 }),
      },
    });

    await processor(makeJob(defaultJobPayload));

    const warnMsg = log.messages.find(
      (m) => m.msg === "webhook config not found, skipping delivery"
    );
    expect(warnMsg).toBeTruthy();
  });

  test("skips delivery when webhook is disabled (circuit broken)", async () => {
    const log = createTestLog();
    const db = createStubDb((sqlStr) => {
      if (sqlStr.includes("webhook_config")) {
        return [
          {
            id: "wh-config-001",
            startup_id: "startup-001",
            url: "https://example.com/hook",
            secret: "test-secret",
            enabled: false,
          },
        ];
      }
      return [];
    });
    const pool = createStubPool();

    const processor = createWebhookDeliveryProcessor({
      db,
      pool,
      log,
      deliveryOptions: {
        resolver: async () => ["1.2.3.4"],
        fetcher: async () => new Response("OK", { status: 200 }),
      },
    });

    await processor(makeJob(defaultJobPayload));

    const warnMsg = log.messages.find((m) => m.msg.includes("circuit broken"));
    expect(warnMsg).toBeTruthy();
  });

  test("throws on delivery failure to trigger BullMQ retry", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const pool = createStubPool((sql) => {
      if (sql.includes("RETURNING")) {
        return { rows: [{ consecutive_failures: 3 }] };
      }
      return { rows: [] };
    });

    const processor = createWebhookDeliveryProcessor({
      db,
      pool,
      log,
      deliveryOptions: {
        resolver: async () => ["1.2.3.4"],
        fetcher: async () => new Response("Error", { status: 500 }),
      },
    });

    let threw = false;
    try {
      await processor(makeJob(defaultJobPayload));
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain("Webhook delivery failed");
    }
    expect(threw).toBe(true);
  });

  test("does not throw when circuit breaker trips (no point retrying)", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const pool = createStubPool((sql) => {
      if (sql.includes("RETURNING")) {
        return { rows: [{ consecutive_failures: 10 }] };
      }
      return { rows: [] };
    });

    const processor = createWebhookDeliveryProcessor({
      db,
      pool,
      log,
      deliveryOptions: {
        resolver: async () => ["1.2.3.4"],
        fetcher: async () => new Response("Error", { status: 500 }),
      },
    });

    // Should NOT throw — circuit is broken, no point retrying
    await processor(makeJob(defaultJobPayload));

    const errorMsg = log.messages.find(
      (m) => m.msg === "webhook circuit breaker tripped"
    );
    expect(errorMsg).toBeTruthy();
    expect(errorMsg?.meta?.consecutiveFailures).toBe(10);
  });

  test("resets consecutive_failures on success", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const pool = createStubPool();

    const processor = createWebhookDeliveryProcessor({
      db,
      pool,
      log,
      deliveryOptions: {
        resolver: async () => ["1.2.3.4"],
        fetcher: async () => new Response("OK", { status: 200 }),
      },
    });

    await processor(makeJob(defaultJobPayload));

    // Pool should have received a query that resets failures
    const resetQuery = pool.queries.find((q) =>
      q.includes("consecutive_failures = 0")
    );
    expect(resetQuery).toBeTruthy();
  });

  test("increments consecutive_failures on failure", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const pool = createStubPool((sql) => {
      if (sql.includes("RETURNING")) {
        return { rows: [{ consecutive_failures: 5 }] };
      }
      return { rows: [] };
    });

    const processor = createWebhookDeliveryProcessor({
      db,
      pool,
      log,
      deliveryOptions: {
        resolver: async () => ["1.2.3.4"],
        fetcher: async () => new Response("Error", { status: 502 }),
      },
    });

    try {
      await processor(makeJob(defaultJobPayload));
    } catch {
      // expected — triggers BullMQ retry
    }

    const incrementQuery = pool.queries.find((q) =>
      q.includes("consecutive_failures + 1")
    );
    expect(incrementQuery).toBeTruthy();
  });

  test("logs webhook.delivered event to event_log on success", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const pool = createStubPool();

    const processor = createWebhookDeliveryProcessor({
      db,
      pool,
      log,
      deliveryOptions: {
        resolver: async () => ["1.2.3.4"],
        fetcher: async () => new Response("OK", { status: 200 }),
      },
    });

    await processor(makeJob(defaultJobPayload));

    // The third db.execute call should be the event_log INSERT
    const eventLogQuery = db.queries.find(
      (q) => q.includes("event_log") && q.includes("webhook.delivered")
    );
    expect(eventLogQuery).toBeTruthy();
  });

  test("logs webhook.failed event to event_log on failure", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const pool = createStubPool((sql) => {
      if (sql.includes("RETURNING")) {
        return { rows: [{ consecutive_failures: 2 }] };
      }
      return { rows: [] };
    });

    const processor = createWebhookDeliveryProcessor({
      db,
      pool,
      log,
      deliveryOptions: {
        resolver: async () => ["1.2.3.4"],
        fetcher: async () => new Response("Error", { status: 500 }),
      },
    });

    try {
      await processor(makeJob(defaultJobPayload));
    } catch {
      // expected
    }

    const eventLogQuery = db.queries.find(
      (q) => q.includes("event_log") && q.includes("webhook.failed")
    );
    expect(eventLogQuery).toBeTruthy();
  });

  test("logs start message with job context", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const pool = createStubPool();

    const processor = createWebhookDeliveryProcessor({
      db,
      pool,
      log,
      deliveryOptions: {
        resolver: async () => ["1.2.3.4"],
        fetcher: async () => new Response("OK", { status: 200 }),
      },
    });

    await processor(makeJob(defaultJobPayload, { attemptsMade: 2 }));

    const startMsg = log.messages.find(
      (m) => m.msg === "webhook delivery started"
    );
    expect(startMsg).toBeTruthy();
    expect(startMsg?.meta?.attempt).toBe(3); // attemptsMade + 1
    expect(startMsg?.meta?.deliveryId).toBe("delivery-001");
    expect(startMsg?.meta?.webhookConfigId).toBe("wh-config-001");
  });
});
