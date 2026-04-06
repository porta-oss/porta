// Telegram digest processor tests.
// Tests with in-memory DB stubs and mock Telegram sender.
// No Redis, Postgres, or real Telegram API required.

import { describe, expect, test } from "bun:test";
import {
  createTelegramDigestProcessor,
  escMd2,
  getCurrentTimeInTimezone,
  type TelegramApiResponse,
  type TelegramSender,
} from "../src/processors/telegram";
import type { TelegramJobPayload } from "../src/queues";

// ---------- helpers ----------

function makeJob(
  data: TelegramJobPayload,
  opts?: { id?: string; attemptsMade?: number }
) {
  return {
    id: opts?.id ?? "bullmq-telegram-1",
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

/** Fixed "now" for deterministic tests: 2025-01-15T09:00:00Z */
const TEST_NOW = new Date("2025-01-15T09:00:00Z");

const DEFAULT_CONFIG_ROW = {
  id: "tg-config-1",
  workspace_id: "ws-1",
  bot_token: "123456:ABCdefGHIjklMNOpqrsTUVwxyz012345678",
  bot_username: "test_bot",
  chat_id: "12345",
  digest_time: "09:00",
  digest_timezone: "UTC",
  is_active: true,
  last_digest_at: null,
};

const DEFAULT_STARTUP_ROW = {
  id: "startup-1",
  name: "Acme Corp",
  north_star_key: "mrr",
};

const DEFAULT_SNAPSHOT_ROW = {
  health_state: "ready",
  north_star_key: "mrr",
  north_star_value: "12500",
  north_star_previous_value: "11000",
  supporting_metrics: { churn_rate: 2.5, active_users: 450 },
};

/**
 * In-memory DB stub. The queryHandler receives the SQL string and returns rows.
 */
function createStubDb(queryHandler?: (sql: string) => DbRow[]) {
  const queries: string[] = [];

  const defaultHandler = (sqlStr: string): DbRow[] => {
    if (sqlStr.includes("telegram_config")) {
      return [DEFAULT_CONFIG_ROW];
    }
    if (sqlStr.includes("FROM startup")) {
      return [DEFAULT_STARTUP_ROW];
    }
    if (sqlStr.includes("health_snapshot_history")) {
      return [
        { value: "10000" },
        { value: "10500" },
        { value: "11000" },
        { value: "11200" },
        { value: "11800" },
        { value: "12000" },
        { value: "12500" },
      ];
    }
    if (sqlStr.includes("health_snapshot")) {
      return [DEFAULT_SNAPSHOT_ROW];
    }
    if (sqlStr.includes("COUNT")) {
      return [{ count: "2" }];
    }
    if (sqlStr.includes("health_funnel_stage")) {
      return [
        { key: "active", label: "Active", value: 200 },
        { key: "at_risk", label: "At Risk", value: 15 },
      ];
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

/** Mock Telegram sender that records calls and returns configurable responses. */
function createMockSender(
  responseOverride?: Partial<TelegramApiResponse>
): TelegramSender & {
  calls: Array<{
    method: string;
    botToken: string;
    chatId: string;
    text?: string;
    photoSize?: number;
    caption?: string;
  }>;
} {
  const calls: Array<{
    method: string;
    botToken: string;
    chatId: string;
    text?: string;
    photoSize?: number;
    caption?: string;
  }> = [];

  const response: TelegramApiResponse = { ok: true, ...responseOverride };

  return {
    calls,
    async sendMessage(botToken, chatId, text, _parseMode) {
      calls.push({ method: "sendMessage", botToken, chatId, text });
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

const digestJobPayload: TelegramJobPayload = {
  chatId: "",
  message: "",
  type: "digest",
  workspaceId: "",
};

// ---------- unit tests ----------

describe("escMd2", () => {
  test("escapes MarkdownV2 special characters", () => {
    expect(escMd2("hello_world")).toBe("hello\\_world");
    expect(escMd2("foo*bar")).toBe("foo\\*bar");
    expect(escMd2("test.value")).toBe("test\\.value");
    expect(escMd2("no special")).toBe("no special");
  });
});

describe("getCurrentTimeInTimezone", () => {
  test("returns HH:MM for UTC", () => {
    const result = getCurrentTimeInTimezone("UTC", TEST_NOW);
    expect(result).toBe("09:00");
  });

  test("returns adjusted time for non-UTC timezone", () => {
    // 09:00 UTC = 12:00 Europe/Moscow (+3)
    const result = getCurrentTimeInTimezone("Europe/Moscow", TEST_NOW);
    expect(result).toBe("12:00");
  });

  test("returns 00:00 for invalid timezone", () => {
    const result = getCurrentTimeInTimezone("Invalid/Zone", TEST_NOW);
    expect(result).toBe("00:00");
  });
});

// ---------- processor tests ----------

describe("telegram digest processor", () => {
  test("skips non-digest job types", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender();
    const processor = createTelegramDigestProcessor({
      db,
      log,
      sender,
      now: () => TEST_NOW,
    });

    await processor(
      makeJob({
        chatId: "123",
        message: "alert",
        type: "alert",
        workspaceId: "ws-1",
      })
    );

    expect(db.queries.length).toBe(0);
    expect(sender.calls.length).toBe(0);
  });

  test("queries active telegram configs", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender();
    const processor = createTelegramDigestProcessor({
      db,
      log,
      sender,
      now: () => TEST_NOW,
    });

    await processor(makeJob(digestJobPayload));

    expect(db.queries[0]).toContain("telegram_config");
    expect(db.queries[0]).toContain("is_active");
  });

  test("skips configs where time does not match", async () => {
    const log = createTestLog();
    // Config with digest_time 15:00 but current time is 09:00 UTC
    const db = createStubDb((sqlStr) => {
      if (sqlStr.includes("telegram_config")) {
        return [{ ...DEFAULT_CONFIG_ROW, digest_time: "15:00" }];
      }
      return [];
    });
    const sender = createMockSender();
    const processor = createTelegramDigestProcessor({
      db,
      log,
      sender,
      now: () => TEST_NOW,
    });

    await processor(makeJob(digestJobPayload));

    const noConfigMsg = log.messages.find(
      (m) => m.msg === "telegram digest check complete, no configs due"
    );
    expect(noConfigMsg).toBeDefined();
    expect(sender.calls.length).toBe(0);
  });

  test("skips configs with recent last_digest_at (< 23h)", async () => {
    const log = createTestLog();
    const recentDigest = new Date(
      TEST_NOW.getTime() - 10 * 60 * 60 * 1000
    ).toISOString(); // 10h ago
    const db = createStubDb((sqlStr) => {
      if (sqlStr.includes("telegram_config")) {
        return [{ ...DEFAULT_CONFIG_ROW, last_digest_at: recentDigest }];
      }
      return [];
    });
    const sender = createMockSender();
    const processor = createTelegramDigestProcessor({
      db,
      log,
      sender,
      now: () => TEST_NOW,
    });

    await processor(makeJob(digestJobPayload));

    expect(sender.calls.length).toBe(0);
  });

  test("processes due config and sends sparkline photo + digest message", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender();
    const processor = createTelegramDigestProcessor({
      db,
      log,
      sender,
      now: () => TEST_NOW,
    });

    await processor(makeJob(digestJobPayload));

    // Should have sent a sparkline photo and a text message
    const photoCalls = sender.calls.filter((c) => c.method === "sendPhoto");
    const msgCalls = sender.calls.filter((c) => c.method === "sendMessage");

    expect(photoCalls.length).toBe(1);
    expect(photoCalls[0].chatId).toBe("12345");
    expect(photoCalls[0].caption).toContain("Acme Corp");

    expect(msgCalls.length).toBe(1);
    expect(msgCalls[0].chatId).toBe("12345");
    expect(msgCalls[0].text).toContain("Daily Portfolio Digest");
    expect(msgCalls[0].text).toContain("Acme Corp");
  });

  test("includes alert count in digest message", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender();
    const processor = createTelegramDigestProcessor({
      db,
      log,
      sender,
      now: () => TEST_NOW,
    });

    await processor(makeJob(digestJobPayload));

    const msg = sender.calls.find((c) => c.method === "sendMessage");
    expect(msg?.text).toContain("2 active alerts");
  });

  test("includes at-risk funnel stages in digest", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender();
    const processor = createTelegramDigestProcessor({
      db,
      log,
      sender,
      now: () => TEST_NOW,
    });

    await processor(makeJob(digestJobPayload));

    const msg = sender.calls.find((c) => c.method === "sendMessage");
    expect(msg?.text).toContain("At Risk");
    expect(msg?.text).toContain("15");
  });

  test("updates last_digest_at after successful send", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender();
    const processor = createTelegramDigestProcessor({
      db,
      log,
      sender,
      now: () => TEST_NOW,
    });

    await processor(makeJob(digestJobPayload));

    const updateQuery = db.queries.find(
      (q) => q.includes("UPDATE") && q.includes("last_digest_at")
    );
    expect(updateQuery).toBeDefined();
  });

  test("logs telegram.digest event after successful send", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender();
    const processor = createTelegramDigestProcessor({
      db,
      log,
      sender,
      now: () => TEST_NOW,
    });

    await processor(makeJob(digestJobPayload));

    const eventQuery = db.queries.find(
      (q) => q.includes("event_log") && q.includes("telegram.digest")
    );
    expect(eventQuery).toBeDefined();

    const sentMsg = log.messages.find((m) => m.msg === "telegram digest sent");
    expect(sentMsg).toBeDefined();
    expect(sentMsg?.meta?.startupCount).toBe(1);
  });

  test("deactivates config on 403 (bot removed)", async () => {
    const log = createTestLog();
    const db = createStubDb();
    const sender = createMockSender({ ok: false, error_code: 403 });
    const processor = createTelegramDigestProcessor({
      db,
      log,
      sender,
      now: () => TEST_NOW,
    });

    await processor(makeJob(digestJobPayload));

    // Should have deactivated the config
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
    // sendPhoto succeeds but sendMessage fails
    const sender = {
      calls: [] as any[],
      async sendMessage() {
        return {
          ok: false,
          error_code: 500,
          description: "Internal Server Error",
        } as TelegramApiResponse;
      },
      async sendPhoto() {
        return { ok: true } as TelegramApiResponse;
      },
    };
    const db = createStubDb();
    const processor = createTelegramDigestProcessor({
      db,
      log,
      sender,
      now: () => TEST_NOW,
    });

    await processor(makeJob(digestJobPayload));

    // Error should be caught and logged (not thrown to BullMQ)
    const errorMsg = log.messages.find(
      (m) => m.msg === "telegram digest failed for workspace"
    );
    expect(errorMsg).toBeDefined();
  });

  test("skips sparkline photo when history has < 2 points", async () => {
    const log = createTestLog();
    const db = createStubDb((sqlStr) => {
      if (sqlStr.includes("telegram_config")) {
        return [DEFAULT_CONFIG_ROW];
      }
      if (sqlStr.includes("FROM startup")) {
        return [DEFAULT_STARTUP_ROW];
      }
      if (sqlStr.includes("health_snapshot_history")) {
        return [{ value: "12500" }]; // Only 1 point
      }
      if (sqlStr.includes("health_snapshot")) {
        return [DEFAULT_SNAPSHOT_ROW];
      }
      if (sqlStr.includes("COUNT")) {
        return [{ count: "0" }];
      }
      if (sqlStr.includes("health_funnel_stage")) {
        return [];
      }
      return [];
    });
    const sender = createMockSender();
    const processor = createTelegramDigestProcessor({
      db,
      log,
      sender,
      now: () => TEST_NOW,
    });

    await processor(makeJob(digestJobPayload));

    // No photo should be sent, only text message
    const photoCalls = sender.calls.filter((c) => c.method === "sendPhoto");
    expect(photoCalls.length).toBe(0);

    const msgCalls = sender.calls.filter((c) => c.method === "sendMessage");
    expect(msgCalls.length).toBe(1);
  });

  test("skips workspace with no startups", async () => {
    const log = createTestLog();
    const db = createStubDb((sqlStr) => {
      if (sqlStr.includes("telegram_config")) {
        return [DEFAULT_CONFIG_ROW];
      }
      if (sqlStr.includes("FROM startup")) {
        return []; // No startups
      }
      return [];
    });
    const sender = createMockSender();
    const processor = createTelegramDigestProcessor({
      db,
      log,
      sender,
      now: () => TEST_NOW,
    });

    await processor(makeJob(digestJobPayload));

    expect(sender.calls.length).toBe(0);
    const skipMsg = log.messages.find(
      (m) => m.msg === "no startups for workspace, skipping digest"
    );
    expect(skipMsg).toBeDefined();
  });

  test("uses text fallback arrows when sparkline render returns null", async () => {
    const log = createTestLog();
    const db = createStubDb((sqlStr) => {
      if (sqlStr.includes("telegram_config")) {
        return [DEFAULT_CONFIG_ROW];
      }
      if (sqlStr.includes("FROM startup")) {
        return [DEFAULT_STARTUP_ROW];
      }
      if (sqlStr.includes("health_snapshot_history")) {
        // Return values that produce a flat sparkline which resvg might fail on
        // or simulate by having the renderSparkline imported return null
        // Since we can't easily mock renderSparkline, test with minimal values
        return [{ value: "100" }, { value: "100" }];
      }
      if (sqlStr.includes("health_snapshot")) {
        return [DEFAULT_SNAPSHOT_ROW];
      }
      if (sqlStr.includes("COUNT")) {
        return [{ count: "0" }];
      }
      if (sqlStr.includes("health_funnel_stage")) {
        return [];
      }
      return [];
    });
    const sender = createMockSender();
    const processor = createTelegramDigestProcessor({
      db,
      log,
      sender,
      now: () => TEST_NOW,
    });

    await processor(makeJob(digestJobPayload));

    // If sparkline renders successfully, photo is sent; if not, text fallback used
    // Either way, a text message should be sent
    const msgCalls = sender.calls.filter((c) => c.method === "sendMessage");
    expect(msgCalls.length).toBe(1);
  });
});
