import "../test/setup-dom";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import {
  DataFreshnessBadge,
  formatRelativeTime,
  getFreshnessLevel,
  STALE_THRESHOLD_MS,
  WARNING_THRESHOLD_MS,
} from "./data-freshness-badge";

afterEach(cleanup);

describe("getFreshnessLevel", () => {
  test("returns fresh for recent data", () => {
    expect(getFreshnessLevel(0)).toBe("fresh");
    expect(getFreshnessLevel(60_000)).toBe("fresh");
    expect(getFreshnessLevel(WARNING_THRESHOLD_MS - 1)).toBe("fresh");
  });

  test("returns warning for data >5min old", () => {
    expect(getFreshnessLevel(WARNING_THRESHOLD_MS)).toBe("warning");
    expect(getFreshnessLevel(10 * 60 * 1000)).toBe("warning");
    expect(getFreshnessLevel(STALE_THRESHOLD_MS - 1)).toBe("warning");
  });

  test("returns stale for data >30min old", () => {
    expect(getFreshnessLevel(STALE_THRESHOLD_MS)).toBe("stale");
    expect(getFreshnessLevel(60 * 60 * 1000)).toBe("stale");
  });
});

describe("formatRelativeTime", () => {
  test("returns 'just now' for < 60s", () => {
    expect(formatRelativeTime(0)).toBe("just now");
    expect(formatRelativeTime(59_000)).toBe("just now");
  });

  test("returns minutes for < 60min", () => {
    expect(formatRelativeTime(60_000)).toBe("1m ago");
    expect(formatRelativeTime(5 * 60_000)).toBe("5m ago");
    expect(formatRelativeTime(59 * 60_000)).toBe("59m ago");
  });

  test("returns hours for < 24h", () => {
    expect(formatRelativeTime(60 * 60_000)).toBe("1h ago");
    expect(formatRelativeTime(23 * 60 * 60_000)).toBe("23h ago");
  });

  test("returns days for >= 24h", () => {
    expect(formatRelativeTime(24 * 60 * 60_000)).toBe("1d ago");
    expect(formatRelativeTime(72 * 60 * 60_000)).toBe("3d ago");
  });
});

describe("DataFreshnessBadge", () => {
  test("renders nothing when fetchedAt is null", () => {
    const { container } = render(<DataFreshnessBadge fetchedAt={null} />);
    expect(container.innerHTML).toBe("");
  });

  test("renders fresh badge for recent data", () => {
    const { getByTestId } = render(
      <DataFreshnessBadge fetchedAt={Date.now()} />
    );
    const badge = getByTestId("data-freshness-badge");
    expect(badge.dataset.freshness).toBe("fresh");
    expect(badge.textContent).toContain("Updated just now");
  });

  test("renders warning badge for data >5min old", () => {
    const fetchedAt = Date.now() - WARNING_THRESHOLD_MS - 1000;
    const { getByTestId } = render(
      <DataFreshnessBadge fetchedAt={fetchedAt} />
    );
    const badge = getByTestId("data-freshness-badge");
    expect(badge.dataset.freshness).toBe("warning");
  });

  test("renders stale badge with outdated message for data >30min old", () => {
    const fetchedAt = Date.now() - STALE_THRESHOLD_MS - 1000;
    const { getByTestId } = render(
      <DataFreshnessBadge fetchedAt={fetchedAt} />
    );
    const badge = getByTestId("data-freshness-badge");
    expect(badge.dataset.freshness).toBe("stale");
    expect(badge.textContent).toContain("Data may be outdated");
  });

  test("uses custom label", () => {
    const { getByTestId } = render(
      <DataFreshnessBadge fetchedAt={Date.now()} label="Alerts updated" />
    );
    const badge = getByTestId("data-freshness-badge");
    expect(badge.textContent).toContain("Alerts updated just now");
  });

  test("has correct aria-label", () => {
    const { getByTestId } = render(
      <DataFreshnessBadge fetchedAt={Date.now()} label="Metrics updated" />
    );
    const badge = getByTestId("data-freshness-badge");
    expect(badge.getAttribute("aria-label")).toBe("Metrics updated just now");
  });
});
