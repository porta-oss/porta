import "../test/setup-dom";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AlertSummary } from "@shared/alert-rule";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { DecisionSurface, type StreakInfo } from "./decision-surface";

afterEach(cleanup);

const MOCK_ALERT: AlertSummary = {
  id: "alert-1",
  startupId: "startup-1",
  ruleId: "rule-1",
  metricKey: "mrr",
  severity: "critical",
  value: 450,
  threshold: 500,
  status: "active",
  occurrenceCount: 3,
  firedAt: new Date(Date.now() - 3_600_000).toISOString(),
  lastFiredAt: new Date(Date.now() - 1_800_000).toISOString(),
  resolvedAt: null,
  snoozedUntil: null,
};

const MOCK_STREAK: StreakInfo = {
  currentDays: 5,
  longestDays: 12,
};

describe("DecisionSurface", () => {
  test("renders loading skeleton", () => {
    const view = render(
      <DecisionSurface alert={null} error={null} loading={true} streak={null} />
    );
    expect(view.getByLabelText("Loading alerts")).toBeTruthy();
  });

  test("renders error state with message", () => {
    const view = render(
      <DecisionSurface
        alert={null}
        error="Network error"
        loading={false}
        streak={null}
      />
    );
    expect(view.getByLabelText("Alert error")).toBeTruthy();
    expect(view.getByText("Network error")).toBeTruthy();
  });

  test("renders retry button in error state when onRetry provided", () => {
    const onRetry = mock(() => undefined);
    const view = render(
      <DecisionSurface
        alert={null}
        error="Network error"
        loading={false}
        onRetry={onRetry}
        streak={null}
      />
    );
    const retryBtn = view.getByText("Retry");
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("renders zero-alert state when no alert", () => {
    const view = render(
      <DecisionSurface
        alert={null}
        error={null}
        loading={false}
        streak={null}
      />
    );
    expect(view.getByLabelText("No active alerts")).toBeTruthy();
    expect(view.getByText("All clear")).toBeTruthy();
  });

  test("renders streak badge in zero-alert state", () => {
    const view = render(
      <DecisionSurface
        alert={null}
        error={null}
        loading={false}
        streak={MOCK_STREAK}
      />
    );
    expect(view.getByText("5 day streak")).toBeTruthy();
    expect(view.getByText("Best: 12 days")).toBeTruthy();
  });

  test("does not show best streak when current equals longest", () => {
    const view = render(
      <DecisionSurface
        alert={null}
        error={null}
        loading={false}
        streak={{ currentDays: 5, longestDays: 5 }}
      />
    );
    expect(view.getByText("5 day streak")).toBeTruthy();
    expect(view.queryByText(/Best:/)).toBeNull();
  });

  test("renders alert card with severity badge", () => {
    const view = render(
      <DecisionSurface
        alert={MOCK_ALERT}
        error={null}
        loading={false}
        streak={null}
      />
    );
    expect(view.getByLabelText("Top priority alert")).toBeTruthy();
    expect(view.getByText("Critical")).toBeTruthy();
  });

  test("renders alert metric key and values", () => {
    const view = render(
      <DecisionSurface
        alert={MOCK_ALERT}
        error={null}
        loading={false}
        streak={null}
      />
    );
    expect(view.getByText("Mrr")).toBeTruthy();
    expect(view.getByText("450")).toBeTruthy();
    expect(view.getByText("threshold: 500")).toBeTruthy();
  });

  test("renders occurrence count when > 1", () => {
    const view = render(
      <DecisionSurface
        alert={MOCK_ALERT}
        error={null}
        loading={false}
        streak={null}
      />
    );
    expect(view.getByText("fired 3x this week")).toBeTruthy();
  });

  test("does not render occurrence count when 1", () => {
    const singleAlert = { ...MOCK_ALERT, occurrenceCount: 1 };
    const view = render(
      <DecisionSurface
        alert={singleAlert}
        error={null}
        loading={false}
        streak={null}
      />
    );
    expect(view.queryByText(/fired.*this week/)).toBeNull();
  });

  test("calls onAck when Ack button clicked", () => {
    const onAck = mock((_id: string) => undefined);
    const view = render(
      <DecisionSurface
        alert={MOCK_ALERT}
        error={null}
        loading={false}
        onAck={onAck}
        streak={null}
      />
    );
    fireEvent.click(view.getByText("Ack"));
    expect(onAck).toHaveBeenCalledWith("alert-1");
  });

  test("calls onInvestigate when Investigate button clicked", () => {
    const onInvestigate = mock((_id: string) => undefined);
    const view = render(
      <DecisionSurface
        alert={MOCK_ALERT}
        error={null}
        loading={false}
        onInvestigate={onInvestigate}
        streak={null}
      />
    );
    fireEvent.click(view.getByText("Investigate"));
    expect(onInvestigate).toHaveBeenCalledWith("alert-1");
  });

  test("renders snooze button when onSnooze provided", () => {
    const onSnooze = mock((_id: string, _hours: number) => undefined);
    const view = render(
      <DecisionSurface
        alert={MOCK_ALERT}
        error={null}
        loading={false}
        onSnooze={onSnooze}
        streak={null}
      />
    );
    expect(view.getByText("Snooze")).toBeTruthy();
  });

  test("disables action buttons when triaging", () => {
    const onAck = mock((_id: string) => undefined);
    const view = render(
      <DecisionSurface
        alert={MOCK_ALERT}
        error={null}
        loading={false}
        onAck={onAck}
        streak={null}
        triaging={true}
      />
    );
    const ackBtn = view.getByText("Ack").closest("button");
    expect(ackBtn?.disabled).toBe(true);
  });

  test("renders different severity badges correctly", () => {
    for (const severity of ["high", "medium", "low"] as const) {
      const alert = { ...MOCK_ALERT, severity };
      const view = render(
        <DecisionSurface
          alert={alert}
          error={null}
          loading={false}
          streak={null}
        />
      );
      const expected = severity.charAt(0).toUpperCase() + severity.slice(1);
      expect(view.getByText(expected)).toBeTruthy();
      cleanup();
    }
  });
});
