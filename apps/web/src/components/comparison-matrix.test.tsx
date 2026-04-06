import "../test/setup-dom";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { ComparisonMatrix, type StartupComparison } from "./comparison-matrix";

afterEach(cleanup);

const STARTUP_A: StartupComparison = {
  id: "s1",
  name: "Alpha",
  healthState: "ready",
  metrics: {
    mrr: 5000,
    active_users: 120,
    churn_rate: 2.5,
    error_rate: 0.3,
    growth_rate: 8.1,
    arpu: 42,
  },
  previousMetrics: {
    mrr: 4500,
    active_users: 110,
    churn_rate: 3.0,
    error_rate: 0.3,
    growth_rate: 7.0,
    arpu: 40,
  },
  sourceMetrics: {
    Stripe: { revenue: 5000, customers: 120 },
    PostHog: { dau: 80, sessions: 450 },
  },
};

const STARTUP_B: StartupComparison = {
  id: "s2",
  name: "Beta",
  healthState: "blocked",
  metrics: { mrr: 3000, active_users: 80, churn_rate: 5.0 },
  previousMetrics: { mrr: 3500, active_users: 80, churn_rate: 4.0 },
};

const STARTUP_C: StartupComparison = {
  id: "s3",
  name: "Charlie",
  healthState: "stale",
  metrics: { mrr: 8000 },
};

describe("ComparisonMatrix", () => {
  test("renders empty state when no startups", () => {
    const view = render(<ComparisonMatrix startups={[]} />);
    expect(view.getByText(/No startups to compare/)).toBeTruthy();
  });

  test("renders startup names", () => {
    const view = render(<ComparisonMatrix startups={[STARTUP_A, STARTUP_B]} />);
    expect(view.getByText("Alpha")).toBeTruthy();
    expect(view.getByText("Beta")).toBeTruthy();
  });

  test("renders health badges", () => {
    const view = render(<ComparisonMatrix startups={[STARTUP_A, STARTUP_B]} />);
    expect(view.getByText("Healthy")).toBeTruthy();
    expect(view.getByText("Blocked")).toBeTruthy();
  });

  test("renders metric column headers", () => {
    const view = render(<ComparisonMatrix startups={[STARTUP_A]} />);
    expect(view.getByText("MRR")).toBeTruthy();
    expect(view.getByText("Active Users")).toBeTruthy();
    expect(view.getByText("Churn Rate")).toBeTruthy();
    expect(view.getByText("Error Rate")).toBeTruthy();
    expect(view.getByText("Growth Rate")).toBeTruthy();
    expect(view.getByText("ARPU")).toBeTruthy();
  });

  test("renders formatted metric values", () => {
    const view = render(<ComparisonMatrix startups={[STARTUP_A]} />);
    // MRR formatted as currency
    expect(view.getByText(/\$5,000/)).toBeTruthy();
    // Active users formatted as count
    expect(view.getByText("120")).toBeTruthy();
    // Churn rate formatted as percent
    expect(view.getByText("2.5%")).toBeTruthy();
  });

  test("renders dash for missing metrics", () => {
    const view = render(<ComparisonMatrix startups={[STARTUP_C]} />);
    // Charlie only has MRR, all others should be dashes
    const dashes = view.container.querySelectorAll(".text-muted-foreground");
    // At least some dashes should exist for missing metrics
    expect(dashes.length).toBeGreaterThan(0);
  });

  test("renders delta indicators for up/down/flat", () => {
    const view = render(<ComparisonMatrix startups={[STARTUP_A]} />);
    // Multiple metrics went up (mrr, active_users, growth_rate, arpu)
    expect(view.getAllByLabelText("increased").length).toBeGreaterThan(0);
    // error_rate stayed flat (0.3 -> 0.3)
    expect(view.getAllByLabelText("no change").length).toBeGreaterThan(0);
  });

  test("renders decreased delta for Beta MRR", () => {
    const view = render(<ComparisonMatrix startups={[STARTUP_B]} />);
    // MRR went down (3500 -> 3000)
    expect(view.getByLabelText("decreased")).toBeTruthy();
  });

  test("sorts by column header click", () => {
    const view = render(
      <ComparisonMatrix startups={[STARTUP_A, STARTUP_B, STARTUP_C]} />
    );
    // Default sort is by name ascending: Alpha, Beta, Charlie
    const rows = view.container.querySelectorAll("[data-slot='table-row']");
    // Header row + 3 data rows
    expect(rows.length).toBe(4);

    // Click MRR to sort descending
    fireEvent.click(view.getByText("MRR"));
    // After sorting by MRR desc: Charlie (8000), Alpha (5000), Beta (3000)
    const cells = view.container.querySelectorAll(".font-medium:not(th *)");
    const names: string[] = [];
    for (const cell of cells) {
      const text = cell.textContent?.trim();
      if (text === "Alpha" || text === "Beta" || text === "Charlie") {
        names.push(text);
      }
    }
    expect(names).toEqual(["Charlie", "Alpha", "Beta"]);
  });

  test("toggles sort direction on double click", () => {
    const view = render(<ComparisonMatrix startups={[STARTUP_A, STARTUP_B]} />);
    // Click Startup header to sort by name ascending (default)
    const startupBtn = view.getByText("Startup");
    // Already sorted asc by name, click toggles to desc
    fireEvent.click(startupBtn);
    expect(view.getByLabelText("sorted descending")).toBeTruthy();
  });

  test("renders expand button for startups with source metrics", () => {
    const view = render(<ComparisonMatrix startups={[STARTUP_A, STARTUP_B]} />);
    // Alpha has sourceMetrics, Beta does not
    expect(view.getByLabelText("Expand Alpha details")).toBeTruthy();
    expect(view.queryByLabelText("Expand Beta details")).toBeNull();
  });

  test("expands and collapses row details", () => {
    const view = render(<ComparisonMatrix startups={[STARTUP_A]} />);
    const expandBtn = view.getByLabelText("Expand Alpha details");

    // Click to expand
    fireEvent.click(expandBtn);
    expect(view.getByText("Stripe")).toBeTruthy();
    expect(view.getByText("PostHog")).toBeTruthy();
    expect(view.getByLabelText("Collapse Alpha details")).toBeTruthy();

    // Click to collapse
    fireEvent.click(view.getByLabelText("Collapse Alpha details"));
    expect(view.queryByText("Stripe")).toBeNull();
  });

  test("renders source metric values in expanded detail", () => {
    const view = render(<ComparisonMatrix startups={[STARTUP_A]} />);
    fireEvent.click(view.getByLabelText("Expand Alpha details"));
    expect(view.getByText("revenue:")).toBeTruthy();
    expect(view.getByText("5000")).toBeTruthy();
    expect(view.getByText("dau:")).toBeTruthy();
  });

  test("renders all health state variants", () => {
    const states: Array<{
      expected: string;
      state: StartupComparison["healthState"];
    }> = [
      { state: "ready", expected: "Healthy" },
      { state: "syncing", expected: "Syncing" },
      { state: "stale", expected: "Stale" },
      { state: "blocked", expected: "Blocked" },
      { state: "error", expected: "Error" },
    ];

    for (const { state, expected } of states) {
      const startup: StartupComparison = {
        id: `s-${state}`,
        name: state,
        healthState: state,
        metrics: { mrr: 1000 },
      };
      const view = render(<ComparisonMatrix startups={[startup]} />);
      expect(view.getByText(expected)).toBeTruthy();
      cleanup();
    }
  });
});
