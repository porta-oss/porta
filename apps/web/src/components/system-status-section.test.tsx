import "../test/setup-dom";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import { SystemStatusSection } from "./system-status-section";

afterEach(cleanup);

describe("SystemStatusSection", () => {
  test("renders section with system status label", () => {
    const { getByText } = render(<SystemStatusSection />);
    expect(getByText("System Status")).toBeDefined();
  });

  test("renders aria-label on section element", () => {
    const { container } = render(<SystemStatusSection />);
    const section = container.querySelector('[aria-label="System status"]');
    expect(section).toBeDefined();
  });

  test("shows 'Never' when no digest has been sent", () => {
    const { getByText } = render(<SystemStatusSection lastDigestAt={null} />);
    expect(getByText("Never")).toBeDefined();
  });

  test("shows relative time for last digest", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    const { getByText } = render(
      <SystemStatusSection lastDigestAt={twoHoursAgo} />
    );
    expect(getByText("2h ago")).toBeDefined();
  });

  test("displays MCP query count", () => {
    const { getByText } = render(<SystemStatusSection mcpQueryCount={42} />);
    expect(getByText("42")).toBeDefined();
  });

  test("defaults MCP query count to 0", () => {
    const { getByText } = render(<SystemStatusSection />);
    expect(getByText("0")).toBeDefined();
  });

  test("shows 'None' when no active alerts", () => {
    const { getAllByText } = render(
      <SystemStatusSection alertsBySeverity={{}} />
    );
    const noneElements = getAllByText("None");
    expect(noneElements.length).toBeGreaterThanOrEqual(1);
  });

  test("shows severity breakdown badges for active alerts", () => {
    const { getByText } = render(
      <SystemStatusSection
        alertsBySeverity={{ critical: 2, high: 1, medium: 3 }}
      />
    );
    expect(getByText("2 critical")).toBeDefined();
    expect(getByText("1 high")).toBeDefined();
    expect(getByText("3 medium")).toBeDefined();
  });

  test("shows connector sync status with last sync time", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { getByText } = render(
      <SystemStatusSection
        connectors={[
          {
            provider: "stripe",
            status: "connected",
            lastSyncAt: oneHourAgo,
            hasError: false,
          },
        ]}
      />
    );
    expect(getByText("1h ago")).toBeDefined();
    expect(getByText("1 ok")).toBeDefined();
  });

  test("shows error count when connectors have errors", () => {
    const { getByText } = render(
      <SystemStatusSection
        connectors={[
          {
            provider: "stripe",
            status: "error",
            lastSyncAt: null,
            hasError: true,
          },
          {
            provider: "posthog",
            status: "error",
            lastSyncAt: null,
            hasError: true,
          },
        ]}
      />
    );
    expect(getByText("2 errors")).toBeDefined();
  });

  test("shows 'None' when no connectors configured", () => {
    const { getAllByText } = render(<SystemStatusSection connectors={[]} />);
    const noneElements = getAllByText("None");
    expect(noneElements.length).toBeGreaterThanOrEqual(1);
  });

  test("renders all four status rows", () => {
    const { getByText } = render(<SystemStatusSection />);
    expect(getByText("Last digest")).toBeDefined();
    expect(getByText("MCP queries today")).toBeDefined();
    expect(getByText("Active alerts")).toBeDefined();
    expect(getByText("Connectors")).toBeDefined();
  });

  test("renders compact sidebar format with icon + label + value rows", () => {
    const { container } = render(<SystemStatusSection mcpQueryCount={5} />);
    // Each StatusRow has the flex justify-between layout
    const rows = container.querySelectorAll(
      ".flex.items-center.justify-between"
    );
    expect(rows.length).toBe(4);
  });
});
