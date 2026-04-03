/**
 * Unit tests for auth-client base-URL resolution across origins.
 *
 * Tests validate that resolveApiBaseUrl and resolveWebBaseUrl produce safe
 * defaults for both local development and self-hosted origins.
 *
 * We inject a mock location via the optional parameter rather than
 * fighting JSDOM's non-configurable window.location.
 */
import "../test/setup-dom";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resolveApiBaseUrl, resolveWebBaseUrl } from "./auth-client";

// ---------------------------------------------------------------------------
// import.meta.env helpers
// ---------------------------------------------------------------------------

function setViteEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete (import.meta.env as Record<string, unknown>)[key];
  } else {
    (import.meta.env as Record<string, unknown>)[key] = value;
  }
}

// ===========================================================================
// resolveApiBaseUrl
// ===========================================================================

describe("resolveApiBaseUrl", () => {
  let savedViteApiUrl: string | undefined;

  beforeEach(() => {
    savedViteApiUrl = import.meta.env.VITE_API_URL as string | undefined;
  });

  afterEach(() => {
    setViteEnv("VITE_API_URL", savedViteApiUrl);
  });

  test("returns explicit VITE_API_URL when set", () => {
    setViteEnv("VITE_API_URL", "https://api.porta.example.com");
    expect(resolveApiBaseUrl()).toBe("https://api.porta.example.com");
  });

  test("returns localhost:3000 for localhost origin when no VITE_API_URL", () => {
    setViteEnv("VITE_API_URL", undefined);
    const loc = { origin: "http://localhost:5173", hostname: "localhost" };
    expect(resolveApiBaseUrl(loc)).toBe("http://localhost:3000");
  });

  test("returns localhost:3000 for 127.0.0.1 origin when no VITE_API_URL", () => {
    setViteEnv("VITE_API_URL", undefined);
    const loc = { origin: "http://127.0.0.1:5173", hostname: "127.0.0.1" };
    expect(resolveApiBaseUrl(loc)).toBe("http://localhost:3000");
  });

  test("returns same-origin for self-hosted non-localhost origin when no VITE_API_URL", () => {
    setViteEnv("VITE_API_URL", undefined);
    const loc = {
      origin: "https://porta.mycompany.io",
      hostname: "porta.mycompany.io",
    };
    expect(resolveApiBaseUrl(loc)).toBe("https://porta.mycompany.io");
  });

  test("returns same-origin for IP-based self-hosted origin when no VITE_API_URL", () => {
    setViteEnv("VITE_API_URL", undefined);
    const loc = {
      origin: "http://192.168.1.100:8080",
      hostname: "192.168.1.100",
    };
    expect(resolveApiBaseUrl(loc)).toBe("http://192.168.1.100:8080");
  });

  test("trims whitespace from VITE_API_URL", () => {
    setViteEnv("VITE_API_URL", "  https://api.porta.example.com  ");
    expect(resolveApiBaseUrl()).toBe("https://api.porta.example.com");
  });

  test("ignores blank VITE_API_URL and falls back to origin resolution", () => {
    setViteEnv("VITE_API_URL", "   ");
    const loc = {
      origin: "https://selfhost.example.com",
      hostname: "selfhost.example.com",
    };
    expect(resolveApiBaseUrl(loc)).toBe("https://selfhost.example.com");
  });

  test("does not return localhost:3000 for non-localhost self-host origins", () => {
    setViteEnv("VITE_API_URL", undefined);
    const loc = {
      origin: "https://dashboard.acme.co",
      hostname: "dashboard.acme.co",
    };
    const result = resolveApiBaseUrl(loc);
    expect(result).not.toContain("localhost");
    expect(result).toBe("https://dashboard.acme.co");
  });
});

// ===========================================================================
// resolveWebBaseUrl
// ===========================================================================

describe("resolveWebBaseUrl", () => {
  let savedViteWebUrl: string | undefined;

  beforeEach(() => {
    savedViteWebUrl = import.meta.env.VITE_WEB_URL as string | undefined;
  });

  afterEach(() => {
    setViteEnv("VITE_WEB_URL", savedViteWebUrl);
  });

  test("returns explicit VITE_WEB_URL when set", () => {
    setViteEnv("VITE_WEB_URL", "https://porta.mycompany.io");
    expect(resolveWebBaseUrl()).toBe("https://porta.mycompany.io");
  });

  test("returns location origin when no VITE_WEB_URL is set", () => {
    setViteEnv("VITE_WEB_URL", undefined);
    const loc = { origin: "https://selfhost.example.com" };
    expect(resolveWebBaseUrl(loc)).toBe("https://selfhost.example.com");
  });

  test("falls back to localhost:5173 when no VITE_WEB_URL and no location", () => {
    setViteEnv("VITE_WEB_URL", undefined);
    // Pass a location with empty origin to simulate SSR/no-window
    const loc = { origin: "" };
    expect(resolveWebBaseUrl(loc)).toBe("http://localhost:5173");
  });
});

// ===========================================================================
// Derived constants sanity checks
// ===========================================================================

describe("AUTH_BASE_URL and API_BASE_URL derived paths", () => {
  test("AUTH_BASE_URL ends with /api/auth", async () => {
    const { AUTH_BASE_URL } = await import("./auth-client");
    expect(AUTH_BASE_URL).toContain("/api/auth");
  });

  test("API_BASE_URL ends with /api", async () => {
    const { API_BASE_URL } = await import("./auth-client");
    expect(API_BASE_URL).toContain("/api");
  });
});
