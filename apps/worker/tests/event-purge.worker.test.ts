// Event purge processor tests.
// Tests the purge processor with in-memory DB stubs.
// No Redis or Postgres required — the processor is pure logic over injected interfaces.

import { describe, expect, test } from "bun:test";
import { createEventPurgeProcessor } from "../src/processors/event-purge";
import type { EventPurgeJobPayload } from "../src/queues";

// ---------- helpers ----------

/** Minimal BullMQ Job-like object for testing. */
function makeJob(data: EventPurgeJobPayload, id = "bullmq-purge-1") {
  return {
    id,
    data,
    attemptsMade: 0,
    name: "event-purge",
  } as any;
}

/** Silent logger that records messages for assertion. */
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

interface ExecutedQuery {
  queryString: string;
  rowCount: number;
}

/**
 * In-memory DB stub that records executed queries and returns configurable rowCounts.
 * The first call (redact) returns redactRowCount, the second (delete) returns deleteRowCount.
 */
function createStubDb(redactRowCount = 0, deleteRowCount = 0) {
  const queries: ExecutedQuery[] = [];
  let callIndex = 0;
  const rowCounts = [redactRowCount, deleteRowCount];

  return {
    queries,
    execute(query: unknown) {
      // Drizzle sql`` returns a SQL object; JSON.stringify captures the query chunks
      const queryStr = JSON.stringify(query);
      const rowCount = rowCounts[callIndex] ?? 0;
      callIndex++;
      queries.push({ queryString: queryStr, rowCount });
      return Promise.resolve({ rows: [], rowCount });
    },
  };
}

/** Extract the completion log from recorded messages. */
function getCompletionLog(log: ReturnType<typeof createTestLog>) {
  return log.messages.find(
    (m) => m.level === "info" && m.msg === "event purge completed"
  );
}

// ---------- tests ----------

describe("event-purge processor", () => {
  test("deletes old events and logs counts", async () => {
    const log = createTestLog();
    const db = createStubDb(0, 42);
    const processor = createEventPurgeProcessor({ db, log });

    await processor(makeJob({}));

    const completed = getCompletionLog(log);
    expect(completed?.meta?.deletedCount).toBe(42);
    expect(completed?.meta?.redactedCount).toBe(0);
  });

  test("uses custom retentionDays from job payload", async () => {
    const log = createTestLog();
    const db = createStubDb(0, 10);
    const processor = createEventPurgeProcessor({ db, log });

    await processor(makeJob({ retentionDays: 30 }));

    const startMsg = log.messages.find((m) => m.msg === "event purge started");
    expect(startMsg?.meta?.retentionDays).toBe(30);
    const completed = getCompletionLog(log);
    expect(completed?.meta?.deletedCount).toBe(10);
  });

  test("redacts PII for legal-hold workspaces", async () => {
    const log = createTestLog();
    const db = createStubDb(5, 20);
    const processor = createEventPurgeProcessor({ db, log });

    await processor(makeJob({}));

    const completed = getCompletionLog(log);
    expect(completed?.meta?.redactedCount).toBe(5);
    expect(completed?.meta?.deletedCount).toBe(20);
  });

  test("executes redact query before delete query", async () => {
    const log = createTestLog();
    const db = createStubDb(0, 0);
    const processor = createEventPurgeProcessor({ db, log });

    await processor(makeJob({}));

    expect(db.queries.length).toBe(2);
    // First query should be the UPDATE (redact)
    expect(db.queries[0].queryString).toContain("UPDATE");
    expect(db.queries[0].queryString).toContain("[REDACTED]");
    // Second query should be the DELETE
    expect(db.queries[1].queryString).toContain("DELETE");
  });

  test("queries filter by legal_hold_until", async () => {
    const log = createTestLog();
    const db = createStubDb(0, 0);
    const processor = createEventPurgeProcessor({ db, log });

    await processor(makeJob({}));

    // Redact query targets workspaces WITH legal hold
    expect(db.queries[0].queryString).toContain("legal_hold_until");
    expect(db.queries[0].queryString).toContain("workspace_id IN");

    // Delete query excludes workspaces WITH legal hold
    expect(db.queries[1].queryString).toContain("legal_hold_until");
    expect(db.queries[1].queryString).toContain("workspace_id NOT IN");
  });

  test("logs start and completion messages", async () => {
    const log = createTestLog();
    const db = createStubDb(3, 15);
    const processor = createEventPurgeProcessor({ db, log });

    await processor(makeJob({}));

    const infoMessages = log.messages.filter((m) => m.level === "info");
    expect(infoMessages.length).toBe(2);
    expect(infoMessages[0].msg).toBe("event purge started");
    expect(infoMessages[1].msg).toBe("event purge completed");
    expect(infoMessages[1].meta?.deletedCount).toBe(15);
    expect(infoMessages[1].meta?.redactedCount).toBe(3);
  });

  test("defaults retentionDays to 90 when not provided", async () => {
    const log = createTestLog();
    const db = createStubDb(0, 0);
    const processor = createEventPurgeProcessor({ db, log });

    await processor(makeJob({}));

    const startMsg = log.messages.find((m) => m.msg === "event purge started");
    expect(startMsg?.meta?.retentionDays).toBe(90);
  });

  test("logs zero counts when nothing to purge", async () => {
    const log = createTestLog();
    const db = createStubDb(0, 0);
    const processor = createEventPurgeProcessor({ db, log });

    await processor(makeJob({}));

    const completed = getCompletionLog(log);
    expect(completed?.meta?.deletedCount).toBe(0);
    expect(completed?.meta?.redactedCount).toBe(0);
  });
});
