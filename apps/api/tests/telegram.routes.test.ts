/**
 * Telegram config route tests (TDD).
 * Covers: POST setup (validates token, calls getMe, generates verification code),
 * DELETE unlink (clears chatId, sets isActive=false),
 * Webhook handler (/start verification, expired/invalid codes).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { StartupDraft } from "@shared/types";
import { convertSetCookieToCookie } from "better-auth/test";
import { eq } from "drizzle-orm";
import type { Transformer } from "grammy";

import type { ApiApp } from "../src/app";
import { alert, alertRule } from "../src/db/schema/alert-rule";
import { eventLog } from "../src/db/schema/event-log";
import { telegramConfig } from "../src/db/schema/telegram-config";
import type { fetchBotInfo } from "../src/routes/telegram";
import { handleTelegramWebhook } from "../src/routes/telegram";
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

// ---------------------------------------------------------------------------
// Webhook handler tests
// ---------------------------------------------------------------------------

/** Transformer that captures outgoing Telegram API calls instead of hitting the network. */
function createCapturingTransformer(): {
  transformer: Transformer;
  calls: Array<{ method: string; payload: Record<string, unknown> }>;
} {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  const transformer = (async (
    _prev: unknown,
    method: string,
    payload: unknown
  ) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true as const, result: true };
  }) as Transformer;
  return { transformer, calls };
}

/** Build a fake Telegram Update for a /start command. */
function buildStartUpdate(chatId: number, code: string) {
  const text = `/start ${code}`;
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      from: {
        id: chatId,
        is_bot: false,
        first_name: "Test",
        language_code: "en",
      },
      chat: { id: chatId, type: "private" as const, first_name: "Test" },
      date: Math.floor(Date.now() / 1000),
      text,
      entities: [{ type: "bot_command" as const, offset: 0, length: 6 }],
    },
  };
}

describe("Telegram webhook handler", () => {
  /** Helper: set up a fresh telegram config and return its id + verification code. */
  async function setupConfig() {
    const a = requireValue(app, "Expected API test app to be initialized.");

    // Ensure clean state
    await a.runtime.db.db.delete(telegramConfig);

    // Create a config via the setup route
    const response = await sendWithCookie("/api/workspace/telegram", {
      method: "POST",
      cookie,
      body: {
        botToken: "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ012345678",
        digestTime: "09:00",
        digestTimezone: "UTC",
      },
    });
    const payload = await parseJson(response);
    const config = payload.config as Record<string, unknown>;

    return {
      configId: config.id as string,
      verificationCode: payload.verificationCode as string,
    };
  }

  test("/start with valid code links chat and replies 'Linked!'", async () => {
    const a = requireValue(app, "Expected API test app to be initialized.");
    const { configId, verificationCode } = await setupConfig();
    const { transformer, calls } = createCapturingTransformer();
    const chatId = 99_887_766;

    const set: { status?: number | string } = {};
    const result = await handleTelegramWebhook(
      { db: a.runtime.db },
      configId,
      buildStartUpdate(chatId, verificationCode),
      set,
      transformer
    );

    // Handler returns ok
    expect(result).toEqual({ ok: true });

    // Bot replied "Linked!"
    const replyCall = calls.find((c) => c.method === "sendMessage");
    expect(replyCall).toBeDefined();
    expect(replyCall?.payload.text).toBe("Linked!");

    // DB updated: chatId set, isActive true
    const rows = await a.runtime.db.db
      .select()
      .from(telegramConfig)
      .where(eq(telegramConfig.id, configId));
    expect(rows.length).toBe(1);
    expect(rows[0].chatId).toBe(String(chatId));
    expect(rows[0].isActive).toBe(true);
    expect(rows[0].verificationCode).toBeNull();
  });

  test("/start with wrong code replies 'Invalid or expired code'", async () => {
    const a = requireValue(app, "Expected API test app to be initialized.");
    const { configId } = await setupConfig();
    const { transformer, calls } = createCapturingTransformer();

    const set: { status?: number | string } = {};
    await handleTelegramWebhook(
      { db: a.runtime.db },
      configId,
      buildStartUpdate(11_111_111, "000000"),
      set,
      transformer
    );

    const replyCall = calls.find((c) => c.method === "sendMessage");
    expect(replyCall).toBeDefined();
    expect(replyCall?.payload.text).toBe("Invalid or expired code");

    // DB NOT updated: isActive still false
    const rows = await a.runtime.db.db
      .select()
      .from(telegramConfig)
      .where(eq(telegramConfig.id, configId));
    expect(rows[0].isActive).toBe(false);
    expect(rows[0].chatId).toBeNull();
  });

  test("/start with expired code replies 'Invalid or expired code'", async () => {
    const a = requireValue(app, "Expected API test app to be initialized.");
    const { configId, verificationCode } = await setupConfig();
    const { transformer, calls } = createCapturingTransformer();

    // Expire the verification code by setting expiry to the past
    await a.runtime.db.db
      .update(telegramConfig)
      .set({
        verificationExpiresAt: new Date(Date.now() - 60_000),
      })
      .where(eq(telegramConfig.id, configId));

    const set: { status?: number | string } = {};
    await handleTelegramWebhook(
      { db: a.runtime.db },
      configId,
      buildStartUpdate(22_222_222, verificationCode),
      set,
      transformer
    );

    const replyCall = calls.find((c) => c.method === "sendMessage");
    expect(replyCall).toBeDefined();
    expect(replyCall?.payload.text).toBe("Invalid or expired code");
  });

  test("webhook with unknown configId returns 404", async () => {
    const a = requireValue(app, "Expected API test app to be initialized.");
    const set: { status?: number | string } = {};
    const result = await handleTelegramWebhook(
      { db: a.runtime.db },
      "nonexistent-config-id",
      buildStartUpdate(33_333_333, "123456"),
      set
    );

    expect(set.status).toBe(404);
    expect(result).toHaveProperty("error");
    const err = (result as { error: { code: string } }).error;
    expect(err.code).toBe("TELEGRAM_CONFIG_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// Callback query (inline keyboard triage) tests
// ---------------------------------------------------------------------------

const VALID_STARTUP: StartupDraft = {
  name: "Telegram Triage Startup",
  type: "b2b_saas",
  stage: "mvp",
  timezone: "UTC",
  currency: "USD",
};

/** Build a fake Telegram Update for a callback_query (inline keyboard press). */
function buildCallbackQueryUpdate(
  chatId: number,
  callbackData: string,
  messageId = 42
) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    callback_query: {
      id: String(Math.floor(Math.random() * 1_000_000)),
      from: {
        id: chatId,
        is_bot: false,
        first_name: "Test",
        language_code: "en",
      },
      chat_instance: "test",
      message: {
        message_id: messageId,
        from: {
          id: 123_456_789,
          is_bot: true,
          first_name: "Bot",
          username: "test_bot",
        },
        chat: { id: chatId, type: "private" as const, first_name: "Test" },
        date: Math.floor(Date.now() / 1000),
        text: "Alert: critical issue",
      },
      data: callbackData,
    },
  };
}

describe("Telegram callback query (triage)", () => {
  let triageConfigId: string;
  let triageStartupId: string;
  let triageWorkspaceId: string;
  const chatId = 55_555_555;

  /** Create a fresh config, workspace, startup, and link the chat for triage tests. */
  async function setupTriageContext() {
    const a = requireValue(app, "Expected API test app to be initialized.");

    // Clean slate
    await a.runtime.db.db.delete(telegramConfig);

    // Create config
    const response = await sendWithCookie("/api/workspace/telegram", {
      method: "POST",
      cookie,
      body: {
        botToken: "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ012345678",
        digestTime: "09:00",
        digestTimezone: "UTC",
      },
    });
    const payload = await parseJson(response);
    const config = payload.config as Record<string, unknown>;
    triageConfigId = config.id as string;
    triageWorkspaceId = config.workspaceId as string;

    // Link chat directly in DB (skip /start flow)
    await a.runtime.db.db
      .update(telegramConfig)
      .set({ chatId: String(chatId), isActive: true })
      .where(eq(telegramConfig.id, triageConfigId));

    // Create a startup for the workspace (unique name per call)
    const createStartupRes = await sendWithCookie("/api/startups", {
      method: "POST",
      cookie,
      body: { ...VALID_STARTUP, name: `Triage Startup ${Date.now()}` },
    });
    const startupPayload = (await createStartupRes.json()) as {
      startup: { id: string };
    };
    triageStartupId = startupPayload.startup.id;
  }

  /** Seed an alert rule + alert directly in DB. Returns the alert id. */
  async function seedTriageAlert(overrides?: {
    status?: string;
  }): Promise<string> {
    const a = requireValue(app, "Expected API test app to be initialized.");
    const ruleId = crypto.randomUUID();
    const alertId = crypto.randomUUID();

    await a.runtime.db.db.insert(alertRule).values({
      id: ruleId,
      startupId: triageStartupId,
      metricKey: "mrr",
      condition: "drop_wow_pct",
      threshold: "20",
      severity: "critical",
    });

    await a.runtime.db.db.insert(alert).values({
      id: alertId,
      startupId: triageStartupId,
      ruleId,
      metricKey: "mrr",
      severity: "critical",
      value: "1000",
      threshold: "20",
      status: overrides?.status ?? "active",
      firedAt: new Date(),
      lastFiredAt: new Date(),
    });

    return alertId;
  }

  test("triage ack updates alert status and answers callback", async () => {
    const a = requireValue(app, "Expected API test app to be initialized.");
    await setupTriageContext();
    const alertId = await seedTriageAlert();
    const { transformer, calls } = createCapturingTransformer();

    const set: { status?: number | string } = {};
    const result = await handleTelegramWebhook(
      { db: a.runtime.db },
      triageConfigId,
      buildCallbackQueryUpdate(chatId, `triage:ack:${alertId}`),
      set,
      transformer
    );

    expect(result).toEqual({ ok: true });

    // Should answer callback query
    const answerCall = calls.find((c) => c.method === "answerCallbackQuery");
    expect(answerCall).toBeDefined();
    expect(answerCall?.payload.text).toBe("Alert acknowledged");

    // Should edit message to remove keyboard
    const editCall = calls.find((c) => c.method === "editMessageReplyMarkup");
    expect(editCall).toBeDefined();

    // Alert status should be updated in DB
    const rows = await a.runtime.db.db
      .select()
      .from(alert)
      .where(eq(alert.id, alertId));
    expect(rows[0].status).toBe("acknowledged");
  });

  test("triage snooze sets snoozedUntil +24h", async () => {
    const a = requireValue(app, "Expected API test app to be initialized.");
    await setupTriageContext();
    const alertId = await seedTriageAlert();
    const { transformer, calls } = createCapturingTransformer();

    const before = Date.now();
    const set: { status?: number | string } = {};
    await handleTelegramWebhook(
      { db: a.runtime.db },
      triageConfigId,
      buildCallbackQueryUpdate(chatId, `triage:snooze:${alertId}`),
      set,
      transformer
    );

    const answerCall = calls.find((c) => c.method === "answerCallbackQuery");
    expect(answerCall?.payload.text).toBe("Alert snoozed for 24h");

    const rows = await a.runtime.db.db
      .select()
      .from(alert)
      .where(eq(alert.id, alertId));
    expect(rows[0].status).toBe("snoozed");
    expect(rows[0].snoozedUntil).not.toBeNull();

    // snoozedUntil should be roughly 24h from now
    const snoozedUntil = rows[0].snoozedUntil;
    if (!snoozedUntil) {
      throw new Error("snoozedUntil should not be null");
    }
    const snoozedMs = new Date(snoozedUntil).getTime();
    const expectedMs = before + 24 * 60 * 60 * 1000;
    expect(Math.abs(snoozedMs - expectedMs)).toBeLessThan(5000);
  });

  test("triage dismiss sets status to dismissed", async () => {
    const a = requireValue(app, "Expected API test app to be initialized.");
    await setupTriageContext();
    const alertId = await seedTriageAlert();
    const { transformer, calls } = createCapturingTransformer();

    const set: { status?: number | string } = {};
    await handleTelegramWebhook(
      { db: a.runtime.db },
      triageConfigId,
      buildCallbackQueryUpdate(chatId, `triage:dismiss:${alertId}`),
      set,
      transformer
    );

    const answerCall = calls.find((c) => c.method === "answerCallbackQuery");
    expect(answerCall?.payload.text).toBe("Alert dismissed");

    const rows = await a.runtime.db.db
      .select()
      .from(alert)
      .where(eq(alert.id, alertId));
    expect(rows[0].status).toBe("dismissed");
  });

  test("triage emits telegram.reaction event", async () => {
    const a = requireValue(app, "Expected API test app to be initialized.");
    await setupTriageContext();
    const alertId = await seedTriageAlert();
    const { transformer } = createCapturingTransformer();

    // Clear event log first
    await a.runtime.db.db.delete(eventLog);

    const set: { status?: number | string } = {};
    await handleTelegramWebhook(
      { db: a.runtime.db },
      triageConfigId,
      buildCallbackQueryUpdate(chatId, `triage:ack:${alertId}`, 99),
      set,
      transformer
    );

    // Check event_log for telegram.reaction event
    const events = await a.runtime.db.db
      .select()
      .from(eventLog)
      .where(eq(eventLog.eventType, "telegram.reaction"));

    expect(events.length).toBe(1);
    expect(events[0].actorType).toBe("user");
    expect(events[0].workspaceId).toBe(triageWorkspaceId);
    expect(events[0].startupId).toBe(triageStartupId);

    const payload = events[0].payload as Record<string, unknown>;
    expect(payload.chatId).toBe(String(chatId));
    expect(payload.messageId).toBe("99");
    expect(payload.reaction).toBe("ack");
  });

  test("triage with nonexistent alert answers 'Alert not found'", async () => {
    const a = requireValue(app, "Expected API test app to be initialized.");
    await setupTriageContext();
    const { transformer, calls } = createCapturingTransformer();

    const set: { status?: number | string } = {};
    await handleTelegramWebhook(
      { db: a.runtime.db },
      triageConfigId,
      buildCallbackQueryUpdate(chatId, `triage:ack:${crypto.randomUUID()}`),
      set,
      transformer
    );

    const answerCall = calls.find((c) => c.method === "answerCallbackQuery");
    expect(answerCall).toBeDefined();
    expect(answerCall?.payload.text).toBe("Alert not found");
  });

  test("triage with invalid action answers 'Invalid triage action'", async () => {
    const a = requireValue(app, "Expected API test app to be initialized.");
    await setupTriageContext();
    const { transformer, calls } = createCapturingTransformer();

    const set: { status?: number | string } = {};
    await handleTelegramWebhook(
      { db: a.runtime.db },
      triageConfigId,
      buildCallbackQueryUpdate(chatId, "triage:invalid:some-id"),
      set,
      transformer
    );

    const answerCall = calls.find((c) => c.method === "answerCallbackQuery");
    expect(answerCall).toBeDefined();
    expect(answerCall?.payload.text).toBe("Invalid triage action");
  });

  test("callback with unknown format answers 'Unknown action'", async () => {
    const a = requireValue(app, "Expected API test app to be initialized.");
    await setupTriageContext();
    const { transformer, calls } = createCapturingTransformer();

    const set: { status?: number | string } = {};
    await handleTelegramWebhook(
      { db: a.runtime.db },
      triageConfigId,
      buildCallbackQueryUpdate(chatId, "some:random:data:extra"),
      set,
      transformer
    );

    const answerCall = calls.find((c) => c.method === "answerCallbackQuery");
    expect(answerCall).toBeDefined();
    expect(answerCall?.payload.text).toBe("Unknown action");
  });
});

// ---------------------------------------------------------------------------
// Webhook HTTP route registration tests
// ---------------------------------------------------------------------------

describe("Telegram webhook HTTP route", () => {
  test("POST /api/telegram/webhook/:configId is accessible without session auth", async () => {
    const a = requireValue(app, "Expected API test app to be initialized.");

    // Ensure clean state + create config
    await a.runtime.db.db.delete(telegramConfig);
    const setupRes = await sendWithCookie("/api/workspace/telegram", {
      method: "POST",
      cookie,
      body: {
        botToken: "123456789:ABCdefGHIjklMNOpqrSTUvwxYZ012345678",
        digestTime: "09:00",
        digestTimezone: "UTC",
      },
    });
    const setupPayload = await parseJson(setupRes);
    const config = setupPayload.config as Record<string, unknown>;
    const configId = config.id as string;

    // Hit the webhook route WITHOUT any cookie/auth — should still work
    const response = await a.handle(
      new Request(`http://localhost:3000/api/telegram/webhook/${configId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          buildStartUpdate(77_777_777, "wrong-code-doesnt-matter")
        ),
      })
    );

    // Should return 200 with { ok: true } (the code is wrong, but route itself works)
    expect(response.status).toBe(200);
    const payload = await parseJson(response);
    expect(payload.ok).toBe(true);
  });

  test("POST /api/telegram/webhook/:configId with unknown configId returns 404", async () => {
    const a = requireValue(app, "Expected API test app to be initialized.");

    const response = await a.handle(
      new Request("http://localhost:3000/api/telegram/webhook/nonexistent-id", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildStartUpdate(88_888_888, "123456")),
      })
    );

    expect(response.status).toBe(404);
    const payload = await parseJson(response);
    expect(payload.error).toBeDefined();
    const err = payload.error as Record<string, unknown>;
    expect(err.code).toBe("TELEGRAM_CONFIG_NOT_FOUND");
  });
});
