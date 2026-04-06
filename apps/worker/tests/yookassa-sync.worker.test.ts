// TDD tests for YooKassa sync provider adapter.
// Tests the syncYooKassa logic via createProviderSyncRouter() and
// createFounderProofSyncRouter() with mocked fetch responses.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createFounderProofSyncRouter,
  createProviderSyncRouter,
  FOUNDER_PROOF_YOOKASSA_CONFIG,
  type YooKassaSyncResult,
} from "../src/providers";

// ---------------------------------------------------------------
// Fetch mock infrastructure
// ---------------------------------------------------------------

const originalFetch = globalThis.fetch;
let mockResponses: Map<string, { status: number; body: unknown }>;

function installFetchMock(
  responses: Record<string, { status: number; body: unknown }>
) {
  mockResponses = new Map(Object.entries(responses));
  globalThis.fetch = (async (
    input: string | URL | Request,
    _init?: RequestInit
  ) => {
    const url = typeof input === "string" ? input : input.toString();

    // Match by URL prefix (ignoring query params)
    for (const [pattern, response] of mockResponses) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(response.body), {
          status: response.status,
        });
      }
    }

    return new Response(JSON.stringify({}), { status: 404 });
  }) as unknown as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// ---------------------------------------------------------------
// Test data
// ---------------------------------------------------------------

const validConfig = JSON.stringify({
  shopId: "123456",
  secretKey: "test_secret_key_abc",
});

function makePayment(
  status: string,
  amount: string,
  currency = "RUB"
): Record<string, unknown> {
  return {
    id: `pay_${Math.random().toString(36).slice(2)}`,
    status,
    amount: { value: amount, currency },
  };
}

function makeRefund(amount: string, currency = "RUB"): Record<string, unknown> {
  return {
    id: `ref_${Math.random().toString(36).slice(2)}`,
    status: "succeeded",
    amount: { value: amount, currency },
  };
}

// ---------------------------------------------------------------
// syncYooKassa via createProviderSyncRouter
// ---------------------------------------------------------------

describe("YooKassa sync provider", () => {
  beforeEach(() => {
    installFetchMock({
      "/v3/me": { status: 200, body: { account_id: "123456" } },
      "/v3/payments": {
        status: 200,
        body: {
          type: "list",
          items: [
            makePayment("succeeded", "1000.00"),
            makePayment("succeeded", "2500.50"),
            makePayment("canceled", "500.00"),
            makePayment("pending", "300.00"),
          ],
        },
      },
      "/v3/refunds": {
        status: 200,
        body: {
          type: "list",
          items: [makeRefund("200.00"), makeRefund("100.00")],
        },
      },
    });
  });

  afterEach(() => {
    restoreFetch();
  });

  test("returns valid result with revenue from succeeded payments", async () => {
    const router = createProviderSyncRouter();
    const result = (await router(
      "yookassa",
      validConfig
    )) as YooKassaSyncResult;

    expect(result.valid).toBe(true);
    // 1000.00 + 2500.50 = 3500.50
    expect(result.mrr).toBe(3500.5);
  });

  test("computes failed_payments count from canceled status", async () => {
    const router = createProviderSyncRouter();
    const result = (await router(
      "yookassa",
      validConfig
    )) as YooKassaSyncResult;

    expect(result.valid).toBe(true);
    expect(result.yookassaMetrics.failedPayments).toBe(1);
  });

  test("computes refunds_30d count", async () => {
    const router = createProviderSyncRouter();
    const result = (await router(
      "yookassa",
      validConfig
    )) as YooKassaSyncResult;

    expect(result.valid).toBe(true);
    expect(result.yookassaMetrics.refunds30d).toBe(2);
  });

  test("promotes revenue_30d to mrr", async () => {
    const router = createProviderSyncRouter();
    const result = (await router(
      "yookassa",
      validConfig
    )) as YooKassaSyncResult;

    expect(result.valid).toBe(true);
    expect(result.mrr).toBe(result.yookassaMetrics.revenue30d);
  });

  test("missing shopId returns invalid", async () => {
    const router = createProviderSyncRouter();
    const result = await router(
      "yookassa",
      JSON.stringify({ secretKey: "key" })
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain("shop ID");
  });

  test("missing secretKey returns invalid", async () => {
    const router = createProviderSyncRouter();
    const result = await router("yookassa", JSON.stringify({ shopId: "shop" }));

    expect(result.valid).toBe(false);
    expect(result.error).toContain("secret key");
  });

  test("auth failure (401) returns invalid", async () => {
    installFetchMock({
      "/v3/me": { status: 401, body: {} },
    });
    const router = createProviderSyncRouter();
    const result = await router("yookassa", validConfig);

    expect(result.valid).toBe(false);
    expect(result.error).toContain("invalid");
  });

  test("server error (500) returns retryable", async () => {
    installFetchMock({
      "/v3/me": { status: 500, body: {} },
    });
    const router = createProviderSyncRouter();
    const result = await router("yookassa", validConfig);

    expect(result.valid).toBe(false);
    expect(result.retryable).toBe(true);
  });

  test("network timeout returns retryable", async () => {
    globalThis.fetch = (async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    }) as unknown as typeof fetch;

    const router = createProviderSyncRouter();
    const result = await router("yookassa", validConfig);

    expect(result.valid).toBe(false);
    expect(result.retryable).toBe(true);
  });

  test("empty payment list returns zero metrics", async () => {
    installFetchMock({
      "/v3/me": { status: 200, body: {} },
      "/v3/payments": {
        status: 200,
        body: { type: "list", items: [] },
      },
      "/v3/refunds": {
        status: 200,
        body: { type: "list", items: [] },
      },
    });

    const router = createProviderSyncRouter();
    const result = (await router(
      "yookassa",
      validConfig
    )) as YooKassaSyncResult;

    expect(result.valid).toBe(true);
    expect(result.mrr).toBe(0);
    expect(result.yookassaMetrics.failedPayments).toBe(0);
    expect(result.yookassaMetrics.refunds30d).toBe(0);
  });

  test("pagination follows next_cursor", async () => {
    let callCount = 0;
    globalThis.fetch = (async (
      input: string | URL | Request,
      _init?: RequestInit
    ) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/v3/me")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }

      if (url.includes("/v3/payments")) {
        callCount++;
        if (callCount === 1 && !url.includes("cursor=page2")) {
          return new Response(
            JSON.stringify({
              type: "list",
              items: [makePayment("succeeded", "100.00")],
              next_cursor: "page2",
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            type: "list",
            items: [makePayment("succeeded", "200.00")],
          }),
          { status: 200 }
        );
      }

      if (url.includes("/v3/refunds")) {
        return new Response(JSON.stringify({ type: "list", items: [] }), {
          status: 200,
        });
      }

      return new Response(JSON.stringify({}), { status: 404 });
    }) as unknown as typeof fetch;

    const router = createProviderSyncRouter();
    const result = (await router(
      "yookassa",
      validConfig
    )) as YooKassaSyncResult;

    expect(result.valid).toBe(true);
    // 100.00 + 200.00 = 300.00 (from two pages)
    expect(result.mrr).toBe(300);
  });

  test("malformed JSON config returns error", async () => {
    const router = createProviderSyncRouter();
    const result = await router("yookassa", "not-json");

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Malformed");
  });
});

// ---------------------------------------------------------------
// Founder-proof sync router
// ---------------------------------------------------------------

describe("YooKassa founder-proof sync", () => {
  test("returns deterministic revenue data", async () => {
    const router = createFounderProofSyncRouter();
    const result = await router(
      "yookassa",
      JSON.stringify(FOUNDER_PROOF_YOOKASSA_CONFIG)
    );

    expect(result.valid).toBe(true);
    expect(result.mrr).toBeGreaterThan(0);
    expect(typeof result.mrr).toBe("number");
  });

  test("returns consistent values across calls", async () => {
    const router = createFounderProofSyncRouter();
    const config = JSON.stringify(FOUNDER_PROOF_YOOKASSA_CONFIG);

    const result1 = await router("yookassa", config);
    const result2 = await router("yookassa", config);

    expect(result1.mrr).toBe(result2.mrr);
    expect(result1.valid).toBe(result2.valid);
  });

  test("rejects malformed JSON", async () => {
    const router = createFounderProofSyncRouter();
    const result = await router("yookassa", "bad-json");

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Malformed");
  });
});
