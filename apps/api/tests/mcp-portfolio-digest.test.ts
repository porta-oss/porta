/**
 * Unit tests for getPortfolioSummary — portfolio digest integration.
 * Tests that AI synthesis is sourced from portfolio_digest table with
 * correct staleness handling.
 */

import { describe, expect, test } from "bun:test";
import type { sql } from "drizzle-orm";

import { getPortfolioSummary } from "../src/services/mcp-tools";

// ---------------------------------------------------------------------------
// Mock DB helper
// ---------------------------------------------------------------------------

type SqlQuery = ReturnType<typeof sql>;

/**
 * Build a mock DB that returns predefined rows for each sequential
 * execute() call. The getPortfolioSummary function issues 6 queries:
 *   1. startups
 *   2. health_snapshots
 *   3. alert counts
 *   4. custom_metric counts
 *   5. connector sync times
 *   6. portfolio_digest
 */
function mockDb(queryResults: Array<{ rows: unknown[] }>) {
  let callIndex = 0;
  return {
    execute(_query: SqlQuery) {
      const result = queryResults[callIndex] ?? { rows: [] };
      callIndex++;
      return Promise.resolve(result);
    },
  };
}

const WORKSPACE_ID = "ws-test-001";

const ONE_STARTUP = [
  {
    id: "s1",
    name: "Startup Alpha",
    type: "b2b_saas",
    currency: "USD",
    north_star_key: "mrr",
  },
];

const BASE_QUERY_RESULTS = [
  { rows: ONE_STARTUP }, // 1. startups
  { rows: [] }, // 2. health_snapshots
  { rows: [] }, // 3. alert counts
  { rows: [] }, // 4. custom_metric counts
  { rows: [] }, // 5. connector sync times
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getPortfolioSummary — portfolio digest", () => {
  test("returns no aiSynthesis when no portfolio_digest row exists", async () => {
    const db = mockDb([
      ...BASE_QUERY_RESULTS,
      { rows: [] }, // 6. no portfolio_digest
    ]);

    const result = await getPortfolioSummary(db, WORKSPACE_ID);

    expect(result.startups).toHaveLength(1);
    expect(result.aiSynthesis).toBeUndefined();
    expect(result.synthesizedAt).toBeUndefined();
    expect(result.stale).toBeUndefined();
  });

  test("returns no aiSynthesis when digest has null ai_synthesis", async () => {
    const db = mockDb([
      ...BASE_QUERY_RESULTS,
      {
        rows: [
          {
            ai_synthesis: null,
            synthesized_at: new Date().toISOString(),
          },
        ],
      },
    ]);

    const result = await getPortfolioSummary(db, WORKSPACE_ID);

    expect(result.startups).toHaveLength(1);
    expect(result.aiSynthesis).toBeUndefined();
    expect(result.synthesizedAt).toBeUndefined();
  });

  test("returns aiSynthesis when digest is fresh (< 7 days old)", async () => {
    const recentTimestamp = new Date(
      Date.now() - 2 * 24 * 60 * 60 * 1000
    ).toISOString(); // 2 days ago

    const db = mockDb([
      ...BASE_QUERY_RESULTS,
      {
        rows: [
          {
            ai_synthesis: "- Alpha and Beta show correlated growth patterns.",
            synthesized_at: recentTimestamp,
          },
        ],
      },
    ]);

    const result = await getPortfolioSummary(db, WORKSPACE_ID);

    expect(result.startups).toHaveLength(1);
    expect(result.aiSynthesis).toBe(
      "- Alpha and Beta show correlated growth patterns."
    );
    expect(result.synthesizedAt).toBe(new Date(recentTimestamp).toISOString());
    expect(result.stale).toBeUndefined();
  });

  test("returns stale flag without aiSynthesis when digest > 7 days old", async () => {
    const staleTimestamp = new Date(
      Date.now() - 10 * 24 * 60 * 60 * 1000
    ).toISOString(); // 10 days ago

    const db = mockDb([
      ...BASE_QUERY_RESULTS,
      {
        rows: [
          {
            ai_synthesis: "- Old analysis that should not be returned.",
            synthesized_at: staleTimestamp,
          },
        ],
      },
    ]);

    const result = await getPortfolioSummary(db, WORKSPACE_ID);

    expect(result.startups).toHaveLength(1);
    expect(result.aiSynthesis).toBeUndefined();
    expect(result.stale).toBe(true);
    expect(result.synthesizedAt).toBe(new Date(staleTimestamp).toISOString());
  });

  test("returns no fields when workspace has no startups", async () => {
    const db = mockDb([{ rows: [] }]); // empty startups query → early return

    const result = await getPortfolioSummary(db, WORKSPACE_ID);

    expect(result.startups).toHaveLength(0);
    expect(result.aiSynthesis).toBeUndefined();
    expect(result.synthesizedAt).toBeUndefined();
  });

  test("digest at exactly 7 days is not stale", async () => {
    // Exactly 7 days minus 1 second (just under threshold)
    const justUnderTimestamp = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000 + 1000
    ).toISOString();

    const db = mockDb([
      ...BASE_QUERY_RESULTS,
      {
        rows: [
          {
            ai_synthesis: "- Fresh enough analysis.",
            synthesized_at: justUnderTimestamp,
          },
        ],
      },
    ]);

    const result = await getPortfolioSummary(db, WORKSPACE_ID);

    expect(result.aiSynthesis).toBe("- Fresh enough analysis.");
    expect(result.stale).toBeUndefined();
  });
});
