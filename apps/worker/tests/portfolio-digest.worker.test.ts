// Portfolio digest processor tests.
// Tests the processor with in-memory DB stubs.
// No Redis or Postgres required — the processor is pure logic over injected interfaces.

import { describe, expect, test } from "bun:test";
import type { PortfolioDigestProcessorDeps } from "../src/processors/portfolio-digest";
import {
  buildContextString,
  createPortfolioDigestProcessor,
  generatePerStartupSummary,
} from "../src/processors/portfolio-digest";
import type { PortfolioDigestJobPayload } from "../src/queues";

// ---------- helpers ----------

function makeJob(data: PortfolioDigestJobPayload, id = "bullmq-digest-1") {
  return {
    id,
    data,
    attemptsMade: 0,
    name: "portfolio-digest",
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

/**
 * In-memory DB stub that returns configurable results per query.
 * Queries are matched by looking for table name keywords in the SQL.
 */
function createStubDb(opts: {
  startups?: Array<{
    id: string;
    name: string;
    type: string;
    north_star_key: string;
  }>;
  snapshots?: Array<{
    startup_id: string;
    health_state: string;
    north_star_value: string | null;
    north_star_previous_value: string | null;
    supporting_metrics: Record<string, number | null>;
  }>;
  alertCounts?: Array<{ startup_id: string; count: number }>;
}) {
  const queries: string[] = [];

  return {
    queries,
    execute(query: unknown) {
      const queryStr = JSON.stringify(query);
      queries.push(queryStr);

      // Route based on SQL content
      if (queryStr.includes("FROM startup")) {
        return Promise.resolve({ rows: opts.startups ?? [] });
      }
      if (queryStr.includes("FROM health_snapshot")) {
        return Promise.resolve({ rows: opts.snapshots ?? [] });
      }
      if (queryStr.includes("FROM alert")) {
        return Promise.resolve({ rows: opts.alertCounts ?? [] });
      }
      if (
        queryStr.includes("DELETE FROM portfolio_digest") ||
        queryStr.includes("INSERT INTO portfolio_digest")
      ) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      if (queryStr.includes("INSERT INTO event_log")) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }

      return Promise.resolve({ rows: [] });
    },
  };
}

function makeDeps(
  db: ReturnType<typeof createStubDb>,
  log: ReturnType<typeof createTestLog>,
  anthropicApiKey: string | null = null
): PortfolioDigestProcessorDeps {
  return { db, log, anthropicApiKey };
}

// Two sample startups for testing
const STARTUP_ALPHA = {
  id: "s-alpha",
  name: "Alpha SaaS",
  type: "b2b_saas",
  north_star_key: "mrr",
};

const STARTUP_BETA = {
  id: "s-beta",
  name: "Beta Tools",
  type: "b2b_saas",
  north_star_key: "mrr",
};

const SNAPSHOT_ALPHA = {
  startup_id: "s-alpha",
  health_state: "ready",
  north_star_value: "5000",
  north_star_previous_value: "4500",
  supporting_metrics: {
    mrr: 5000,
    active_users: 120,
    churn_rate: 3.2,
    error_rate: 0.1,
    growth_rate: 11.1,
    arpu: 41.67,
  },
};

const SNAPSHOT_BETA = {
  startup_id: "s-beta",
  health_state: "ready",
  north_star_value: "3200",
  north_star_previous_value: "3000",
  supporting_metrics: {
    mrr: 3200,
    active_users: 80,
    churn_rate: 5.5,
    error_rate: 0.3,
    growth_rate: 6.7,
    arpu: 40.0,
  },
};

// ---------- tests ----------

describe("portfolio-digest processor", () => {
  test("skips digest when no startups found", async () => {
    const log = createTestLog();
    const db = createStubDb({ startups: [] });
    const processor = createPortfolioDigestProcessor(makeDeps(db, log));

    const result = await processor(makeJob({ workspaceId: "ws-1" }));

    expect(result.startupCount).toBe(0);
    expect(result.aiSynthesis).toBeNull();
    expect(result.synthesized).toBe(false);

    const skipMsg = log.messages.find(
      (m) => m.msg === "no startups found, skipping digest"
    );
    expect(skipMsg).toBeTruthy();
  });

  test("generates per-startup summary for single startup (no cross-comparison)", async () => {
    const log = createTestLog();
    const db = createStubDb({
      startups: [STARTUP_ALPHA],
      snapshots: [SNAPSHOT_ALPHA],
      alertCounts: [{ startup_id: "s-alpha", count: 2 }],
    });
    const processor = createPortfolioDigestProcessor(makeDeps(db, log));

    const result = await processor(makeJob({ workspaceId: "ws-1" }));

    expect(result.startupCount).toBe(1);
    // Per-startup summary text is generated (not null)
    expect(result.aiSynthesis).toContain("Alpha SaaS");
    expect(result.aiSynthesis).toContain("Health: ready");
    expect(result.synthesized).toBe(true);

    // Should log "fewer than 2 startups"
    const singleMsg = log.messages.find((m) =>
      m.msg.includes("fewer than 2 startups")
    );
    expect(singleMsg).toBeTruthy();

    // Should log insight.degraded event with reason
    const degradedEvent = db.queries.find(
      (q) =>
        q.includes("INSERT INTO event_log") && q.includes("insight.degraded")
    );
    expect(degradedEvent).toBeTruthy();
    expect(degradedEvent).toContain("insufficient_startups");

    // Should store digest (DELETE + INSERT)
    const deleteQuery = db.queries.find((q) =>
      q.includes("DELETE FROM portfolio_digest")
    );
    const insertQuery = db.queries.find((q) =>
      q.includes("INSERT INTO portfolio_digest")
    );
    expect(deleteQuery).toBeTruthy();
    expect(insertQuery).toBeTruthy();
  });

  test("generates metric-only digest when no API key provided and logs degraded event", async () => {
    const log = createTestLog();
    const db = createStubDb({
      startups: [STARTUP_ALPHA, STARTUP_BETA],
      snapshots: [SNAPSHOT_ALPHA, SNAPSHOT_BETA],
      alertCounts: [],
    });
    // No API key
    const processor = createPortfolioDigestProcessor(makeDeps(db, log, null));

    const result = await processor(makeJob({ workspaceId: "ws-1" }));

    expect(result.startupCount).toBe(2);
    expect(result.aiSynthesis).toBeNull();
    expect(result.synthesized).toBe(false);

    const noKeyMsg = log.messages.find((m) =>
      m.msg.includes("no Anthropic API key")
    );
    expect(noKeyMsg).toBeTruthy();

    // Should log insight.degraded event with ai_unavailable reason
    const degradedEvent = db.queries.find(
      (q) =>
        q.includes("INSERT INTO event_log") && q.includes("insight.degraded")
    );
    expect(degradedEvent).toBeTruthy();
    expect(degradedEvent).toContain("ai_unavailable");
  });

  test("stores structured data with correct startup count", async () => {
    const log = createTestLog();
    const db = createStubDb({
      startups: [STARTUP_ALPHA, STARTUP_BETA],
      snapshots: [SNAPSHOT_ALPHA, SNAPSHOT_BETA],
      alertCounts: [{ startup_id: "s-alpha", count: 1 }],
    });
    const processor = createPortfolioDigestProcessor(makeDeps(db, log));

    const result = await processor(makeJob({ workspaceId: "ws-1" }));

    expect(result.startupCount).toBe(2);

    // Verify INSERT query contains startup_count = 2
    const insertQuery = db.queries.find((q) =>
      q.includes("INSERT INTO portfolio_digest")
    );
    expect(insertQuery).toBeTruthy();
  });

  test("logs start and completion messages", async () => {
    const log = createTestLog();
    const db = createStubDb({
      startups: [STARTUP_ALPHA],
      snapshots: [SNAPSHOT_ALPHA],
    });
    const processor = createPortfolioDigestProcessor(makeDeps(db, log));

    await processor(makeJob({ workspaceId: "ws-1" }));

    const startMsg = log.messages.find(
      (m) => m.msg === "portfolio digest started"
    );
    expect(startMsg).toBeTruthy();
    expect(startMsg?.meta?.workspaceId).toBe("ws-1");

    const completedMsg = log.messages.find(
      (m) => m.msg === "portfolio digest completed"
    );
    expect(completedMsg).toBeTruthy();
    expect(completedMsg?.meta?.startupCount).toBe(1);
    expect(completedMsg?.meta?.hasSynthesis).toBe(true);
  });

  test("handles startups without health snapshots gracefully", async () => {
    const log = createTestLog();
    const db = createStubDb({
      startups: [STARTUP_ALPHA],
      snapshots: [], // No snapshot for alpha
      alertCounts: [],
    });
    const processor = createPortfolioDigestProcessor(makeDeps(db, log));

    const result = await processor(makeJob({ workspaceId: "ws-1" }));

    // Should still produce a digest with default health state and per-startup summary
    expect(result.startupCount).toBe(1);
    expect(result.synthesized).toBe(true);
    expect(result.aiSynthesis).toContain("Alpha SaaS");
    expect(result.aiSynthesis).toContain("Health: syncing");
  });

  test("computes north star delta correctly", async () => {
    const log = createTestLog();
    const db = createStubDb({
      startups: [STARTUP_ALPHA],
      snapshots: [SNAPSHOT_ALPHA], // value=5000, prev=4500, delta=500
      alertCounts: [],
    });
    const processor = createPortfolioDigestProcessor(makeDeps(db, log));

    await processor(makeJob({ workspaceId: "ws-1" }));

    // The INSERT query should contain structured_data with the delta
    const insertQuery = db.queries.find((q) =>
      q.includes("INSERT INTO portfolio_digest")
    );
    expect(insertQuery).toBeTruthy();
    // Structured data is serialized as JSON in the query
    // The delta should be 500 (5000 - 4500)
    expect(insertQuery).toContain("500");
  });
});

describe("buildContextString", () => {
  test("formats single startup context", () => {
    const result = buildContextString([
      {
        startupId: "s-1",
        name: "TestApp",
        type: "b2b_saas",
        healthState: "ready",
        northStarKey: "mrr",
        northStarValue: 5000,
        northStarDelta: 500,
        activeAlerts: 2,
        supportingMetrics: {
          mrr: 5000,
          active_users: 100,
          churn_rate: 3.0,
          error_rate: null,
          growth_rate: 10.0,
          arpu: null,
        },
      },
    ]);

    expect(result).toContain("Portfolio of 1 startups");
    expect(result).toContain("## TestApp (b2b_saas)");
    expect(result).toContain("Health: ready");
    expect(result).toContain("North star (mrr): 5000");
    expect(result).toContain("(delta: +500)");
    expect(result).toContain("Active alerts: 2");
    expect(result).toContain("mrr: 5000");
    expect(result).toContain("active_users: 100");
    expect(result).toContain("churn_rate: 3");
  });

  test("formats multiple startups", () => {
    const result = buildContextString([
      {
        startupId: "s-1",
        name: "Alpha",
        type: "b2b_saas",
        healthState: "ready",
        northStarKey: "mrr",
        northStarValue: 5000,
        northStarDelta: 500,
        activeAlerts: 0,
        supportingMetrics: {
          mrr: 5000,
          active_users: 100,
          churn_rate: null,
          error_rate: null,
          growth_rate: null,
          arpu: null,
        },
      },
      {
        startupId: "s-2",
        name: "Beta",
        type: "b2b_saas",
        healthState: "stale",
        northStarKey: "mrr",
        northStarValue: 3000,
        northStarDelta: -200,
        activeAlerts: 3,
        supportingMetrics: {
          mrr: 3000,
          active_users: 50,
          churn_rate: null,
          error_rate: null,
          growth_rate: null,
          arpu: null,
        },
      },
    ]);

    expect(result).toContain("Portfolio of 2 startups");
    expect(result).toContain("## Alpha");
    expect(result).toContain("## Beta");
    expect(result).toContain("Health: stale");
    expect(result).toContain("(delta: -200)");
  });

  test("handles null delta", () => {
    const result = buildContextString([
      {
        startupId: "s-1",
        name: "NoData",
        type: "b2b_saas",
        healthState: "syncing",
        northStarKey: "mrr",
        northStarValue: null,
        northStarDelta: null,
        activeAlerts: 0,
        supportingMetrics: {
          mrr: null,
          active_users: null,
          churn_rate: null,
          error_rate: null,
          growth_rate: null,
          arpu: null,
        },
      },
    ]);

    expect(result).toContain("North star (mrr): N/A");
    // Should NOT contain delta text
    expect(result).not.toContain("delta:");
  });
});

describe("generatePerStartupSummary", () => {
  test("generates bullet-point summary for a single startup", () => {
    const result = generatePerStartupSummary([
      {
        startupId: "s-1",
        name: "TestApp",
        type: "b2b_saas",
        healthState: "ready",
        northStarKey: "mrr",
        northStarValue: 5000,
        northStarDelta: 500,
        activeAlerts: 2,
        supportingMetrics: {
          mrr: 5000,
          active_users: 100,
          churn_rate: 3.0,
          error_rate: null,
          growth_rate: 10.0,
          arpu: null,
        },
      },
    ]);

    expect(result).toContain("TestApp (b2b_saas):");
    expect(result).toContain("- Health: ready");
    expect(result).toContain("- North star (mrr): 5000");
    expect(result).toContain("(delta: +500)");
    expect(result).toContain("- Active alerts: 2");
    expect(result).toContain("- Key metrics:");
    expect(result).toContain("mrr: 5000");
    expect(result).toContain("active_users: 100");
  });

  test("handles null values gracefully", () => {
    const result = generatePerStartupSummary([
      {
        startupId: "s-1",
        name: "NoData",
        type: "b2b_saas",
        healthState: "syncing",
        northStarKey: "mrr",
        northStarValue: null,
        northStarDelta: null,
        activeAlerts: 0,
        supportingMetrics: {
          mrr: null,
          active_users: null,
          churn_rate: null,
          error_rate: null,
          growth_rate: null,
          arpu: null,
        },
      },
    ]);

    expect(result).toContain("- North star (mrr): N/A");
    expect(result).not.toContain("delta:");
    expect(result).not.toContain("- Key metrics:");
  });
});
