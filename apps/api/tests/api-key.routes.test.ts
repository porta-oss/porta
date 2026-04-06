/**
 * API key management route tests (TDD).
 * Covers: create (returns full key), list (prefix only), revoke (sets revoked_at),
 * revoked key → 401 on MCP endpoints, non-existent key → 401.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { convertSetCookieToCookie } from "better-auth/test";

import type { ApiApp } from "../src/app";
import {
  closeTestApiApp,
  createTestApiApp,
  requireValue,
} from "./helpers/test-app";

let app: ApiApp | undefined;
let cookie: string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  a: ApiApp,
  url: string,
  init?: RequestInit
): Promise<Response> {
  return a.handle(new Request(url, init));
}

async function signUp(a: ApiApp, email: string): Promise<string> {
  const signInRes = await makeRequest(
    a,
    "http://localhost:3000/api/auth/sign-in/magic-link",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: "API Key Tester" }),
    }
  );
  if (!signInRes.ok) {
    throw new Error(`Magic link request failed: ${signInRes.status}`);
  }

  const magicLink = a.runtime.auth.getLatestMagicLink(email);
  if (!magicLink) {
    throw new Error(`No magic link for ${email}`);
  }

  const verifyRes = await a.handle(new Request(magicLink.url));
  const c = convertSetCookieToCookie(verifyRes.headers).get("cookie") ?? "";
  if (!c) {
    throw new Error(`No cookie returned for ${email}`);
  }

  return c;
}

async function createWorkspace(
  a: ApiApp,
  c: string,
  name: string
): Promise<string> {
  const response = await makeRequest(
    a,
    "http://localhost:3000/api/workspaces",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: c },
      body: JSON.stringify({ name }),
    }
  );
  const payload = (await response.json()) as { workspace: { id: string } };
  return payload.workspace.id;
}

async function sendWithCookie(
  path: string,
  init?: { method?: string; body?: unknown; cookie?: string }
) {
  const a = requireValue(app, "Expected API test app to be initialized.");
  const headers = new Headers();
  if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (init?.cookie) {
    headers.set("cookie", init.cookie);
  }
  return a.handle(
    new Request(`http://localhost:3000${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  );
}

async function sendWithApiKey(
  path: string,
  apiKey: string,
  init?: { method?: string; body?: unknown }
) {
  const a = requireValue(app, "Expected API test app to be initialized.");
  const headers = new Headers();
  headers.set("authorization", `Bearer ${apiKey}`);
  if (init?.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return a.handle(
    new Request(`http://localhost:3000${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  );
}

async function parseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  app = await createTestApiApp();
  const a = requireValue(app, "Expected API test app to be initialized.");
  a.runtime.auth.resetMagicLinks();
  await a.runtime.db.resetAuthTables();

  cookie = await signUp(a, "apikey-tester@example.com");
  await createWorkspace(a, cookie, "API Key Test Workspace");
});

afterAll(async () => {
  await closeTestApiApp(app);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("API key management routes", () => {
  test("POST create returns full key (porta_read_...) and stores hash", async () => {
    const response = await sendWithCookie("/api/settings/api-keys", {
      method: "POST",
      cookie,
      body: { name: "My Read Key", scope: "read" },
    });
    const payload = await parseJson(response);

    expect(response.status).toBe(201);
    expect(payload.key).toBeDefined();
    expect(typeof payload.key).toBe("string");

    const key = payload.key as string;
    expect(key).toStartWith("porta_read_");
    // Full key should be ~43 chars: porta_read_ (11) + 32 random chars
    expect(key.length).toBeGreaterThan(40);

    // The summary should NOT include the hash
    const summary = payload.apiKey as Record<string, unknown>;
    expect(summary).toBeDefined();
    expect(summary.id).toBeDefined();
    expect(summary.name).toBe("My Read Key");
    expect(summary.scope).toBe("read");
    expect(summary.keyPrefix).toBeDefined();
    expect(typeof summary.keyPrefix).toBe("string");
    // keyPrefix should be the first visible prefix portion
    expect((summary.keyPrefix as string).length).toBeGreaterThan(0);
    // Should NOT have keyHash in response
    expect(summary).not.toHaveProperty("keyHash");

    // Also test write scope
    const writeResponse = await sendWithCookie("/api/settings/api-keys", {
      method: "POST",
      cookie,
      body: { name: "My Write Key", scope: "write" },
    });
    const writePayload = await parseJson(writeResponse);

    expect(writeResponse.status).toBe(201);
    expect(writePayload.key as string).toStartWith("porta_write_");
  });

  test("GET list returns keys with prefix only, no hash", async () => {
    // Create a key first so there's at least one
    await sendWithCookie("/api/settings/api-keys", {
      method: "POST",
      cookie,
      body: { name: "List Test Key", scope: "read" },
    });

    const response = await sendWithCookie("/api/settings/api-keys", {
      cookie,
    });
    const payload = await parseJson(response);

    expect(response.status).toBe(200);
    expect(payload.apiKeys).toBeDefined();
    expect(Array.isArray(payload.apiKeys)).toBe(true);

    const keys = payload.apiKeys as Record<string, unknown>[];
    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      // Each key should have these fields
      expect(key.id).toBeDefined();
      expect(key.name).toBeDefined();
      expect(key.keyPrefix).toBeDefined();
      expect(key.scope).toBeDefined();
      expect(key.createdAt).toBeDefined();
      // lastUsedAt can be null
      expect(key).toHaveProperty("lastUsedAt");

      // MUST NOT have keyHash
      expect(key).not.toHaveProperty("keyHash");
      // MUST NOT have the full key
      expect(key).not.toHaveProperty("key");
    }
  });

  test("DELETE revoke sets revoked_at", async () => {
    // Create a key to revoke
    const createResponse = await sendWithCookie("/api/settings/api-keys", {
      method: "POST",
      cookie,
      body: { name: "Revokable Key", scope: "read" },
    });
    const createPayload = await parseJson(createResponse);
    const keyId = (createPayload.apiKey as Record<string, unknown>)
      .id as string;

    // Revoke it
    const revokeResponse = await sendWithCookie(
      `/api/settings/api-keys/${keyId}`,
      {
        method: "DELETE",
        cookie,
      }
    );
    const revokePayload = await parseJson(revokeResponse);

    expect(revokeResponse.status).toBe(200);
    expect(revokePayload.revoked).toBe(true);

    // After revoke, the key should either not appear in list or be marked revoked
    const listResponse = await sendWithCookie("/api/settings/api-keys", {
      cookie,
    });
    const listPayload = await parseJson(listResponse);
    const keys = listPayload.apiKeys as Record<string, unknown>[];
    // The revoked key should not appear in the non-revoked list
    const revokedKey = keys.find((k) => k.id === keyId);
    // If it's included, it should have revokedAt set
    if (revokedKey) {
      expect(revokedKey.revokedAt).toBeDefined();
      expect(revokedKey.revokedAt).not.toBeNull();
    }
  });

  test("revoked key returns 401 on MCP endpoints", async () => {
    // Create and then revoke a key
    const createResponse = await sendWithCookie("/api/settings/api-keys", {
      method: "POST",
      cookie,
      body: { name: "Soon Revoked", scope: "read" },
    });
    const createPayload = await parseJson(createResponse);
    const fullKey = createPayload.key as string;
    const keyId = (createPayload.apiKey as Record<string, unknown>)
      .id as string;

    // Revoke it
    await sendWithCookie(`/api/settings/api-keys/${keyId}`, {
      method: "DELETE",
      cookie,
    });

    // Try to use it on an MCP read endpoint
    const mcpResponse = await sendWithApiKey(
      "/api/mcp/portfolio-summary",
      fullKey
    );

    expect(mcpResponse.status).toBe(401);
    const mcpPayload = await parseJson(mcpResponse);
    expect(mcpPayload.error).toBeDefined();
  });

  test("non-existent key returns 401 on MCP endpoints", async () => {
    const fakeKey = "porta_read_00000000000000000000000000000000";

    const mcpResponse = await sendWithApiKey(
      "/api/mcp/portfolio-summary",
      fakeKey
    );

    expect(mcpResponse.status).toBe(401);
    const mcpPayload = await parseJson(mcpResponse);
    expect(mcpPayload.error).toBeDefined();
  });
});
