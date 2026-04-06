// Telegram alert notification processor tests.
// Tests with in-memory DB stubs and mock Telegram sender.
// No Redis, Postgres, or real Telegram API required.

import { describe, expect, test } from "bun:test";
import {
  createTelegramAlertProcessor,
  formatAlertMessage,
  type InlineKeyboardMarkup,
  type TelegramApiResponse,
  type TelegramSender,
} from "../src/processors/telegram";
import type { TelegramAlertPayload, TelegramJobPayload } from "../src/queues";

// ---------- helpers ----------

function makeJob(
  data: TelegramJobPayload,
  opts?: { id?: string; attemptsMade?: number }
) {
  return {
    id: opts?.id ?? "bullmq-telegram-alert-1",
    data,
    attemptsMade: opts?.attemptsMade ?? 0,
    name: "telegram",
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

interface DbRow {
  [key: string]: unknown;
}

const DEFAULT_TELEGRAM_CONFIG = {
  id: "tg-config-1",
  workspace_id: "ws-1",
  bot_token: "123456:ABCdefGHIjklMNOpqrsTUVwxyz012345678",
  chat_id: "12345",
  is_active: true,
};

const DEFAULT_ALERT_PAYLOAD: TelegramAlertPayload = {
  type: "alert",
  alertId: "alert-1",
  dashboardUrl: "http://localhost:5173",
  eventId: "evt-1",
  metricKey: "mrr",
  occurrenceCount: 3,
  severity: "critical",
  startupId: "startup-1",
  startupName: "Acme Corp",
  threshold: "10000",
  value: "8500",
  workspaceId: "ws-1",
};

function createStubDb(queryHandler?: (sql: string) => DbRow[]) {
  const queries: string[] = [];

  const defaultHandler = (sqlStr: string): DbRow[] => {
    if (sqlStr.includes("telegram_config")) {
      return [DEFAULT_TELEGRAM_CONFIG];
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

function createMockSender(
  responseOverride?: Partial<TelegramApiResponse>
): TelegramSender & {
  calls: Array<{
    method: string;
    botToken: string;
    chatId: string;
    text?: string;
    replyMarkup?: InlineKeyboardMarkup;
    photoSize?: number;
    caption?: string;
  }>;
} {
  const calls: Array<{
    method: string;
    botToken: string;
    chatId: string;
    text?: string;
    replyMarkup?: InlineKeyboardMarkup;
    photoSize?: number;
    caption?: string;
  }> = [];

  const response: TelegramApiResponse = { ok: true, ...responseOverride };

  return {
    calls,
    async sendMessage(botToken, chatId, text, _parseMode, replyMarkup) {
      calls.push({
        method: "sendMessage",
        botToken,
        chatId,
        text,
        replyMarkup,
      });
      return response;
    },
    async sendPhoto(botToken, chatId, photo, caption) {
      calls.push({
        method: "sendPhoto",
        botToken,
        chatId,
        photoSize: photo.length,
        caption,
      });
      return response;
    },
  };
}

// ---------- unit tests ----------

describe("formatAlertMessage", () => {
  test("formats alert with all fields in MarkdownV2", () => {
    const msg = formatAlertMessage(DEFAULT_ALERT_PAYLOAD);
    expect(msg).toContain("CRITICAL Alert");
    expect(msg).toContain("Acme Corp");
    expect(msg).toContain("MRR");
    expect(msg).toContain("8500");
    expect(msg).toContain("10000");
    expect(msg).toContain("Occurrences: 3");
  });

  test("includes journal deep link when dashboardUrl and eventId present", () => {
    const msg = formatAlertMessage(DEFAULT_ALERT_PAYLOAD);
    expect(msg).toContain("View in Journal");
    expect(msg).toContain("startup=startup-1");
    expect(msg).toContain("mode=journal");
    expect(msg).toContain("event=evt-1");
  });

  test("omits journal link when dashboardUrl is empty", () => {
    const msg = formatAlertMessage({
      ...DEFAULT_ALERT_PAYLOAD,
      dashboardUrl: "",
    });
    expect(msg).not.toContain("View in Journal");
  });

  test("omits journal link when eventId is empty", () => {
    const msg = formatAlertMessage({
      ...DEFAULT_ALERT_PAYLOAD,
      eventId: "",
    });
    expect(msg).not.toContain("View in Journal");
  });

  test("uses correct severity emoji for each level", () => {
    expect(
      formatAlertMessage({ ...DEFAULT_ALERT_PAYLOAD, severity: "critical" })
    ).toContain("🔴");
    expect(
      formatAlertMessage({ ...DEFAULT_ALERT_PAYLOAD, severity: "high" })
    ).toContain("🟠");
    expect(
      formatAlertMessage({ ...DEFAULT_ALERT_PAYLOAD, severity: "medium" })
    ).toContain("🟡");
    expect(
      formatAlertMessage({ ...DEFAULT_ALERT_PAYLOAD, severity: "low" })
    ).toContain("🔵");
  });

  test("escapes MarkdownV2 special characters in startup name", () => {
    const msg = formatAlertMessage({
      ...DEFAULT_ALERT_PAYLOAD,
      startupName: "Acme_Corp (v2)",
    });
    expect(msg).toContain("Acme\\_Corp \\(v2\\)");
  });
});

// ---------- processor tests ----------

describe("telegram alert processor", () => {
  test("skips non-alert job types", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender();
    const processor = createTelegramAlertProcessor({ db, log, sender });

    await processor(makeJob({ type: "digest" }));

    expect(db.queries.length).toBe(0);
    expect(sender.calls.length).toBe(0);
  });

  test("looks up telegram config for workspace", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender();
    const processor = createTelegramAlertProcessor({ db, log, sender });

    await processor(makeJob(DEFAULT_ALERT_PAYLOAD));

    expect(db.queries[0]).toContain("telegram_config");
    expect(db.queries[0]).toContain("workspace_id");
    expect(db.queries[0]).toContain("is_active");
  });

  test("skips when no active telegram config exists", async () => {
    const log = createTestLog();
    const db = createStubDb(() => []);
    const sender = createMockSender();
    const processor = createTelegramAlertProcessor({ db, log, sender });

    await processor(makeJob(DEFAULT_ALERT_PAYLOAD));

    expect(sender.calls.length).toBe(0);
    const skipMsg = log.messages.find(
      (m) => m.msg === "no active telegram config for workspace, skipping alert"
    );
    expect(skipMsg).toBeDefined();
  });

  test("sends alert message with inline keyboard", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender();
    const processor = createTelegramAlertProcessor({ db, log, sender });

    await processor(makeJob(DEFAULT_ALERT_PAYLOAD));

    expect(sender.calls.length).toBe(1);
    const call = sender.calls[0];
    expect(call.method).toBe("sendMessage");
    expect(call.chatId).toBe("12345");
    expect(call.text).toContain("CRITICAL Alert");
    expect(call.text).toContain("Acme Corp");

    // Verify inline keyboard
    expect(call.replyMarkup).toBeDefined();
    const keyboard = call.replyMarkup as InlineKeyboardMarkup;
    expect(keyboard.inline_keyboard.length).toBe(1);
    const buttons = keyboard.inline_keyboard[0];
    expect(buttons.length).toBe(3);
    expect(buttons[0].callback_data).toBe("triage:ack:alert-1");
    expect(buttons[1].callback_data).toBe("triage:snooze:alert-1");
    expect(buttons[2].callback_data).toBe("triage:dismiss:alert-1");
  });

  test("logs telegram.alert event after successful send", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender();
    const processor = createTelegramAlertProcessor({ db, log, sender });

    await processor(makeJob(DEFAULT_ALERT_PAYLOAD));

    // Wait for fire-and-forget promise
    await new Promise((r) => setTimeout(r, 10));

    const eventQuery = db.queries.find(
      (q) => q.includes("event_log") && q.includes("telegram.alert")
    );
    expect(eventQuery).toBeDefined();

    const sentMsg = log.messages.find((m) => m.msg === "telegram alert sent");
    expect(sentMsg).toBeDefined();
    expect(sentMsg?.meta?.alertId).toBe("alert-1");
  });

  test("deactivates config on 403 (bot removed)", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender({ ok: false, error_code: 403 });
    const processor = createTelegramAlertProcessor({ db, log, sender });

    await processor(makeJob(DEFAULT_ALERT_PAYLOAD));

    const deactivateQuery = db.queries.find(
      (q) =>
        q.includes("UPDATE") &&
        q.includes("telegram_config") &&
        q.includes("is_active")
    );
    expect(deactivateQuery).toBeDefined();

    const warnMsg = log.messages.find(
      (m) => m.msg === "telegram bot removed, deactivating config"
    );
    expect(warnMsg).toBeDefined();
  });

  test("throws on non-403 Telegram API failure", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender({
      ok: false,
      error_code: 500,
      description: "Internal Server Error",
    });
    const processor = createTelegramAlertProcessor({ db, log, sender });

    let thrown = false;
    try {
      await processor(makeJob(DEFAULT_ALERT_PAYLOAD));
    } catch (err) {
      thrown = true;
      expect((err as Error).message).toContain("Telegram sendMessage failed");
    }
    expect(thrown).toBe(true);
  });

  test("includes deep link in message", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender();
    const processor = createTelegramAlertProcessor({ db, log, sender });

    await processor(makeJob(DEFAULT_ALERT_PAYLOAD));

    const call = sender.calls[0];
    expect(call.text).toContain("View in Journal");
    expect(call.text).toContain("startup=startup-1");
    expect(call.text).toContain("mode=journal");
    expect(call.text).toContain("event=evt-1");
  });

  test("formats message with severity, metric, value, threshold, occurrences", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender();
    const processor = createTelegramAlertProcessor({ db, log, sender });

    await processor(makeJob(DEFAULT_ALERT_PAYLOAD));

    const text = sender.calls[0].text as string;
    expect(text).toContain("CRITICAL");
    expect(text).toContain("MRR");
    expect(text).toContain("8500");
    expect(text).toContain("10000");
    expect(text).toContain("Occurrences: 3");
  });
});
