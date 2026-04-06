// TDD tests for YooKassa credential validator.
// Written before implementation — all tests should initially fail.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  createFounderProofYooKassaValidator,
  createStubYooKassaValidator,
  createYooKassaValidator,
  YOOKASSA_DEMO_SECRET_KEY,
  YOOKASSA_DEMO_SHOP_ID,
  type YooKassaConfig,
} from "../src/lib/connectors/yookassa";

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

let interceptedRequests: { url: string; headers: Headers }[] = [];
let mockResponse: { status: number; body?: unknown } = { status: 200 };
const originalFetch = globalThis.fetch;

function installFetchMock() {
  interceptedRequests = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = new Headers(init?.headers);
    interceptedRequests.push({ url, headers });
    return new Response(JSON.stringify(mockResponse.body ?? {}), {
      status: mockResponse.status,
    });
  }) as unknown as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// ---------------------------------------------------------------
// Production validator
// ---------------------------------------------------------------

describe("YooKassa validator", () => {
  beforeEach(() => {
    mockResponse = { status: 200 };
    installFetchMock();
  });

  afterEach(() => {
    restoreFetch();
  });

  const validConfig: YooKassaConfig = {
    shopId: "123456",
    secretKey: "test_secret_key_abc",
  };

  test("valid credentials return { valid: true }", async () => {
    mockResponse = { status: 200 };
    const validator = createYooKassaValidator();
    const result = await validator.validate(validConfig);
    expect(result).toEqual({ valid: true });
  });

  test("sends HTTP Basic auth header (base64 of shopId:secretKey)", async () => {
    mockResponse = { status: 200 };
    const validator = createYooKassaValidator();
    await validator.validate(validConfig);

    expect(interceptedRequests).toHaveLength(1);
    const { url, headers } = interceptedRequests[0];

    // Must call the YooKassa /v3/me endpoint
    expect(url).toBe("https://api.yookassa.ru/v3/me");

    // HTTP Basic: base64("shopId:secretKey")
    const expectedAuth = `Basic ${btoa(`${validConfig.shopId}:${validConfig.secretKey}`)}`;
    expect(headers.get("Authorization")).toBe(expectedAuth);
  });

  test("blank shopId returns { valid: false }", async () => {
    const validator = createYooKassaValidator();
    const result = await validator.validate({ shopId: "", secretKey: "key" });
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    // Should not make an HTTP call
    expect(interceptedRequests).toHaveLength(0);
  });

  test("blank secretKey returns { valid: false }", async () => {
    const validator = createYooKassaValidator();
    const result = await validator.validate({
      shopId: "123",
      secretKey: "  ",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(interceptedRequests).toHaveLength(0);
  });

  test("HTTP 401 returns { valid: false } with auth error", async () => {
    mockResponse = { status: 401 };
    const validator = createYooKassaValidator();
    const result = await validator.validate(validConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.retryable).toBeUndefined();
  });

  test("HTTP 403 returns { valid: false } with permission error", async () => {
    mockResponse = { status: 403 };
    const validator = createYooKassaValidator();
    const result = await validator.validate(validConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("HTTP 5xx returns { valid: false, retryable: true }", async () => {
    mockResponse = { status: 502 };
    const validator = createYooKassaValidator();
    const result = await validator.validate(validConfig);
    expect(result.valid).toBe(false);
    expect(result.retryable).toBe(true);
  });

  test("network timeout returns { valid: false, retryable: true }", async () => {
    globalThis.fetch = (async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    }) as unknown as typeof fetch;

    const validator = createYooKassaValidator({ timeoutMs: 1 });
    const result = await validator.validate(validConfig);
    expect(result.valid).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.error).toBeDefined();
  });

  test("network failure returns { valid: false, retryable: true }", async () => {
    globalThis.fetch = (async () => {
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;

    const validator = createYooKassaValidator();
    const result = await validator.validate(validConfig);
    expect(result.valid).toBe(false);
    expect(result.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------
// Stub validator
// ---------------------------------------------------------------

describe("YooKassa stub validator", () => {
  test("returns configured result and records calls", async () => {
    const stub = createStubYooKassaValidator({ valid: true });
    const config: YooKassaConfig = {
      shopId: "shop-1",
      secretKey: "secret-1",
    };
    const result = await stub.validate(config);
    expect(result).toEqual({ valid: true });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]).toEqual(config);
  });

  test("still rejects blank shopId", async () => {
    const stub = createStubYooKassaValidator({ valid: true });
    const result = await stub.validate({ shopId: "", secretKey: "key" });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------
// Founder-proof validator
// ---------------------------------------------------------------

describe("YooKassa founder-proof validator", () => {
  test("accepts demo credentials", async () => {
    const validator = createFounderProofYooKassaValidator();
    const result = await validator.validate({
      shopId: YOOKASSA_DEMO_SHOP_ID,
      secretKey: YOOKASSA_DEMO_SECRET_KEY,
    });
    expect(result).toEqual({ valid: true });
  });

  test("rejects non-demo credentials", async () => {
    const validator = createFounderProofYooKassaValidator();
    const result = await validator.validate({
      shopId: "real-shop",
      secretKey: "real-key",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("still rejects blank fields", async () => {
    const validator = createFounderProofYooKassaValidator();
    const result = await validator.validate({ shopId: "", secretKey: "" });
    expect(result.valid).toBe(false);
  });
});
