import "../test/setup-dom";

import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AlertRuleSummary } from "@shared/alert-rule";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { AlertRuleRow } from "./alert-rule-row";

afterEach(cleanup);

function makeRule(overrides: Partial<AlertRuleSummary> = {}): AlertRuleSummary {
  return {
    id: "rule-1",
    startupId: "startup-1",
    metricKey: "mrr",
    condition: "drop_wow_pct",
    threshold: 20,
    severity: "high",
    enabled: true,
    minDataPoints: 7,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("AlertRuleRow", () => {
  test("displays human-readable metric label from universal metrics", () => {
    const { container } = render(<AlertRuleRow rule={makeRule()} />);
    expect(container.textContent).toContain("MRR");
  });

  test("displays formatted condition text", () => {
    const { container } = render(<AlertRuleRow rule={makeRule()} />);
    expect(container.textContent).toContain("drops week-over-week >20%");
  });

  test("falls back to title-case for custom metric keys", () => {
    const { container } = render(
      <AlertRuleRow rule={makeRule({ metricKey: "custom_metric" })} />
    );
    expect(container.textContent).toContain("Custom Metric");
  });

  test("shows severity badge with correct label", () => {
    const { container } = render(
      <AlertRuleRow rule={makeRule({ severity: "critical" })} />
    );
    const badge = container.querySelector("[data-slot='badge']");
    expect(badge?.textContent).toContain("Critical");
  });

  test("severity badge uses destructive variant for critical", () => {
    const { container } = render(
      <AlertRuleRow rule={makeRule({ severity: "critical" })} />
    );
    const badge = container.querySelector("[data-slot='badge']");
    expect(badge?.getAttribute("data-variant")).toBe("destructive");
  });

  test("severity badge uses secondary variant for medium", () => {
    const { container } = render(
      <AlertRuleRow rule={makeRule({ severity: "medium" })} />
    );
    const badge = container.querySelector("[data-slot='badge']");
    expect(badge?.getAttribute("data-variant")).toBe("secondary");
  });

  test("severity badge uses outline variant for low", () => {
    const { container } = render(
      <AlertRuleRow rule={makeRule({ severity: "low" })} />
    );
    const badge = container.querySelector("[data-slot='badge']");
    expect(badge?.getAttribute("data-variant")).toBe("outline");
  });

  test("renders enabled toggle switch", () => {
    const { container } = render(<AlertRuleRow rule={makeRule()} />);
    const switchEl = container.querySelector("[data-slot='switch']");
    expect(switchEl).not.toBeNull();
    expect(switchEl?.getAttribute("data-state")).toBe("checked");
  });

  test("renders unchecked switch when rule is disabled", () => {
    const { container } = render(
      <AlertRuleRow rule={makeRule({ enabled: false })} />
    );
    const switchEl = container.querySelector("[data-slot='switch']");
    expect(switchEl?.getAttribute("data-state")).toBe("unchecked");
  });

  test("applies reduced opacity when rule is disabled", () => {
    const { container } = render(
      <AlertRuleRow rule={makeRule({ enabled: false })} />
    );
    const row = container.querySelector("[data-testid='alert-rule-row']");
    expect(row?.className).toContain("opacity-60");
  });

  test("calls onToggle when switch is clicked", () => {
    const handleToggle = mock(() => undefined);
    const { container } = render(
      <AlertRuleRow onToggle={handleToggle} rule={makeRule()} />
    );
    const switchEl = container.querySelector("[data-slot='switch']");
    if (switchEl) {
      fireEvent.click(switchEl);
    }
    expect(handleToggle).toHaveBeenCalled();
  });

  test("calls onClick when row content is clicked", () => {
    const handleClick = mock(() => undefined);
    const { container } = render(
      <AlertRuleRow onClick={handleClick} rule={makeRule()} />
    );
    const button = container.querySelector("button");
    if (button) {
      fireEvent.click(button);
    }
    expect(handleClick).toHaveBeenCalled();
  });

  test("switch has accessible aria-label", () => {
    const { container } = render(<AlertRuleRow rule={makeRule()} />);
    const switchEl = container.querySelector("[data-slot='switch']");
    expect(switchEl?.getAttribute("aria-label")).toBe(
      "Disable alert rule for MRR"
    );
  });

  test("formats below_threshold condition with currency unit", () => {
    const { container } = render(
      <AlertRuleRow
        rule={makeRule({
          condition: "below_threshold",
          threshold: 500,
          metricKey: "mrr",
        })}
      />
    );
    expect(container.textContent).toContain("falls below $500");
  });

  test("formats above_threshold condition with percent unit", () => {
    const { container } = render(
      <AlertRuleRow
        rule={makeRule({
          condition: "above_threshold",
          threshold: 10,
          metricKey: "churn_rate",
        })}
      />
    );
    expect(container.textContent).toContain("rises above 10%");
  });

  test("formats spike_vs_avg condition", () => {
    const { container } = render(
      <AlertRuleRow
        rule={makeRule({
          condition: "spike_vs_avg",
          threshold: 50,
          metricKey: "active_users",
        })}
      />
    );
    expect(container.textContent).toContain("spikes vs average >50%");
  });

  test("accepts className prop", () => {
    const { container } = render(
      <AlertRuleRow className="custom-class" rule={makeRule()} />
    );
    const row = container.querySelector("[data-testid='alert-rule-row']");
    expect(row?.className).toContain("custom-class");
  });

  test("compact row layout with flex items-center", () => {
    const { container } = render(<AlertRuleRow rule={makeRule()} />);
    const row = container.querySelector("[data-testid='alert-rule-row']");
    expect(row?.className).toContain("flex");
    expect(row?.className).toContain("items-center");
  });
});
