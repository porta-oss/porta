/**
 * Telegram config route tests (TDD).
 * Covers: POST setup (validates token, calls getMe, generates verification code),
 * DELETE unlink (clears chatId, sets isActive=false).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { convertSetCookieToCookie } from "better-auth/test";

import type { ApiApp } from "../src/app";
import { telegramConfig } from "../src/db/schema/telegram-config";
import type { fetchBotInfo } from "../src/routes/telegram";
import {
  closeTestApiApp,
  createTestApiApp,
  requireValue,
} from "./helpers/test-app";

/** Mock that returns "test_bot" for valid tokens, error for tokens starting with 000. */
const mockBotInfoFetcher: typeof fetchBotInfo = async (botToken: string) => {
  if (botToken.startsWith("000")) {
    return { ok: false, error: "Telegram API returned 401" };
  }
  return { ok: true, username: "test_bot" };
};

let app: ApiApp | undefined;
let cookie: string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signUp(a: ApiApp, email: string): Promise<string> {
  const signInRes = await a.handle(
    new Request("http://localhost:3000/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: "Telegram Tester" }),
    })
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
  const response = await a.handle(
    new Request("http://localhost:3000/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: c },
      body: JSON.stringify({ name }),
    })
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

async function parseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  app = await createTestApiApp({
    telegramBotInfoFetcher: mockBotInfoFetcher,
  });
  const a = requireValue(app, "Expected API test app to be initialized.");
  a.runtime.auth.resetMagicLinks();
  await a.runtime.db.resetAuthTables();

  cookie = await signUp(a, "telegram-tester@example.com");
  await createWorkspace(a, cookie, "Telegram Test Workspace");
});

afterAll(async () => {
  await closeTestApiApp(app);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Telegram config routes", () => {
  test("POST setup with valid token returns verification code and config", async () => {
    const response = await sendWithCookie("/api/workspace/telegram", {
      method: "POST",
      cookie,
      body: {
        botToken: "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ012345678",
        digestTime: "10:00",
        digestTimezone: "Europe/Moscow",
      },
    });
    const payload = await parseJson(response);

    // Should succeed (201 for new, 200 for update)
    expect(response.status).toBeLessThanOrEqual(201);
    expect(response.status).toBeGreaterThanOrEqual(200);

    // Should return verification code (6-digit string)
    expect(payload.verificationCode).toBeDefined();
    const code = payload.verificationCode as string;
    expect(code).toMatch(/^\d{6}$/);

    // Should return config summary
    const config = payload.config as Record<string, unknown>;
    expect(config).toBeDefined();
    expect(config.id).toBeDefined();
    expect(config.workspaceId).toBeDefined();
    expect(config.botUsername).toBe("test_bot");
    expect(config.digestTime).toBe("10:00");
    expect(config.digestTimezone).toBe("Europe/Moscow");
    expect(config.isActive).toBe(false);
    expect(config.chatId).toBeNull();

    // botToken should NOT be in the response
    expect(config).not.toHaveProperty("botToken");
  });

  test("POST setup with invalid token format returns 400", async () => {
    const response = await sendWithCookie("/api/workspace/telegram", {
      method: "POST",
      cookie,
      body: {
        botToken: "not-a-valid-token",
      },
    });
    const payload = await parseJson(response);

    expect(response.status).toBe(400);
    expect(payload.error).toBeDefined();
    const error = payload.error as Record<string, unknown>;
    expect(error.code).toBe("VALIDATION_FAILED");
  });

  test("POST setup with bad bot token returns 400 from Telegram API", async () => {
    const response = await sendWithCookie("/api/workspace/telegram", {
      method: "POST",
      cookie,
      body: {
        botToken: "000000000:BADtokenThatTelegramWillReject00000",
      },
    });
    const payload = await parseJson(response);

    expect(response.status).toBe(400);
    expect(payload.error).toBeDefined();
    const error = payload.error as Record<string, unknown>;
    expect(error.code).toBe("TELEGRAM_BOT_INVALID");
  });

  test("POST re-setup resets chatId and isActive", async () => {
    // First setup is already done above, do it again to verify upsert
    const response = await sendWithCookie("/api/workspace/telegram", {
      method: "POST",
      cookie,
      body: {
        botToken: "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ012345678",
        digestTime: "08:00",
        digestTimezone: "UTC",
      },
    });
    const payload = await parseJson(response);

    expect(response.status).toBe(200);
    const config = payload.config as Record<string, unknown>;
    expect(config.digestTime).toBe("08:00");
    expect(config.digestTimezone).toBe("UTC");
    expect(config.chatId).toBeNull();
    expect(config.isActive).toBe(false);
  });

  test("DELETE unlink returns success", async () => {
    // Ensure there's a config to delete
    await sendWithCookie("/api/workspace/telegram", {
      method: "POST",
      cookie,
      body: {
        botToken: "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ012345678",
      },
    });

    const response = await sendWithCookie("/api/workspace/telegram", {
      method: "DELETE",
      cookie,
    });
    const payload = await parseJson(response);

    expect(response.status).toBe(200);
    expect(payload.deleted).toBe(true);
    expect(payload.workspaceId).toBeDefined();
  });

  test("DELETE without prior setup returns 404", async () => {
    // Clear the table first by re-deleting (already unlinked above)
    // Need a fresh workspace for a clean 404 test — but since we only have one,
    // we test by deleting the actual row first
    const a = requireValue(app, "Expected API test app to be initialized.");
    await a.runtime.db.db.delete(telegramConfig);

    const response = await sendWithCookie("/api/workspace/telegram", {
      method: "DELETE",
      cookie,
    });
    const payload = await parseJson(response);

    expect(response.status).toBe(404);
    expect(payload.error).toBeDefined();
    const error = payload.error as Record<string, unknown>;
    expect(error.code).toBe("TELEGRAM_NOT_FOUND");
  });

  test("POST setup requires authentication", async () => {
    const response = await sendWithCookie("/api/workspace/telegram", {
      method: "POST",
      body: {
        botToken: "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ012345678",
      },
      // No cookie
    });

    expect(response.status).toBeGreaterThanOrEqual(401);
  });
});
