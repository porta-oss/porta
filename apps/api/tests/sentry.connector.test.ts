// TDD tests for Sentry credential validator.
// Written before implementation — all tests should initially fail.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  createFounderProofSentryValidator,
  createSentryValidator,
  createStubSentryValidator,
  SENTRY_DEMO_AUTH_TOKEN,
  SENTRY_DEMO_ORGANIZATION,
  SENTRY_DEMO_PROJECT,
  type SentryConfig,
} from "../src/lib/connectors/sentry";

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

describe("Sentry validator", () => {
  beforeEach(() => {
    mockResponse = { status: 200 };
    installFetchMock();
  });

  afterEach(() => {
    restoreFetch();
  });

  const validConfig: SentryConfig = {
    authToken: "sntrys_test_token_abc123",
    organization: "my-org",
    project: "my-project",
  };

  test("valid token + org + project return { valid: true }", async () => {
    mockResponse = { status: 200 };
    const validator = createSentryValidator();
    const result = await validator.validate(validConfig);
    expect(result).toEqual({ valid: true });
  });

  test("sends Bearer auth header", async () => {
    mockResponse = { status: 200 };
    const validator = createSentryValidator();
    await validator.validate(validConfig);

    expect(interceptedRequests).toHaveLength(1);
    const { url, headers } = interceptedRequests[0];

    // Must call the Sentry project endpoint
    expect(url).toBe(
      `https://sentry.io/api/0/projects/${validConfig.organization}/${validConfig.project}/`
    );

    // Bearer token auth
    expect(headers.get("Authorization")).toBe(
      `Bearer ${validConfig.authToken}`
    );
  });

  test("blank authToken returns { valid: false }", async () => {
    const validator = createSentryValidator();
    const result = await validator.validate({
      authToken: "",
      organization: "org",
      project: "proj",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(interceptedRequests).toHaveLength(0);
  });

  test("blank organization returns { valid: false }", async () => {
    const validator = createSentryValidator();
    const result = await validator.validate({
      authToken: "token",
      organization: "  ",
      project: "proj",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(interceptedRequests).toHaveLength(0);
  });

  test("blank project returns { valid: false }", async () => {
    const validator = createSentryValidator();
    const result = await validator.validate({
      authToken: "token",
      organization: "org",
      project: "",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(interceptedRequests).toHaveLength(0);
  });

  test("HTTP 401 returns { valid: false } — invalid token", async () => {
    mockResponse = { status: 401 };
    const validator = createSentryValidator();
    const result = await validator.validate(validConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.retryable).toBeUndefined();
  });

  test("HTTP 403 returns { valid: false } — insufficient permissions", async () => {
    mockResponse = { status: 403 };
    const validator = createSentryValidator();
    const result = await validator.validate(validConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("HTTP 404 returns { valid: false } — non-existent org/project", async () => {
    mockResponse = { status: 404 };
    const validator = createSentryValidator();
    const result = await validator.validate(validConfig);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.retryable).toBeUndefined();
  });

  test("HTTP 5xx returns { valid: false, retryable: true }", async () => {
    mockResponse = { status: 502 };
    const validator = createSentryValidator();
    const result = await validator.validate(validConfig);
    expect(result.valid).toBe(false);
    expect(result.retryable).toBe(true);
  });

  test("network timeout returns { valid: false, retryable: true }", async () => {
    globalThis.fetch = (async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    }) as unknown as typeof fetch;

    const validator = createSentryValidator({ timeoutMs: 1 });
    const result = await validator.validate(validConfig);
    expect(result.valid).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.error).toBeDefined();
  });

  test("network failure returns { valid: false, retryable: true }", async () => {
    globalThis.fetch = (async () => {
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;

    const validator = createSentryValidator();
    const result = await validator.validate(validConfig);
    expect(result.valid).toBe(false);
    expect(result.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------
// Stub validator
// ---------------------------------------------------------------

describe("Sentry stub validator", () => {
  test("returns configured result and records calls", async () => {
    const stub = createStubSentryValidator({ valid: true });
    const config: SentryConfig = {
      authToken: "token-1",
      organization: "org-1",
      project: "proj-1",
    };
    const result = await stub.validate(config);
    expect(result).toEqual({ valid: true });
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]).toEqual(config);
  });

  test("still rejects blank authToken", async () => {
    const stub = createStubSentryValidator({ valid: true });
    const result = await stub.validate({
      authToken: "",
      organization: "org",
      project: "proj",
    });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------
// Founder-proof validator
// ---------------------------------------------------------------

describe("Sentry founder-proof validator", () => {
  test("accepts demo credentials", async () => {
    const validator = createFounderProofSentryValidator();
    const result = await validator.validate({
      authToken: SENTRY_DEMO_AUTH_TOKEN,
      organization: SENTRY_DEMO_ORGANIZATION,
      project: SENTRY_DEMO_PROJECT,
    });
    expect(result).toEqual({ valid: true });
  });

  test("rejects non-demo credentials", async () => {
    const validator = createFounderProofSentryValidator();
    const result = await validator.validate({
      authToken: "real-token",
      organization: "real-org",
      project: "real-project",
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("still rejects blank fields", async () => {
    const validator = createFounderProofSentryValidator();
    const result = await validator.validate({
      authToken: "",
      organization: "",
      project: "",
    });
    expect(result.valid).toBe(false);
  });
});
