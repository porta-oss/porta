import "../test/setup-dom";

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { EventFilter, type EventFilterValues } from "./event-filter";

afterEach(cleanup);

function createMockApply() {
  let lastCall: EventFilterValues | undefined;
  const fn = mock((filters: EventFilterValues) => {
    lastCall = filters;
  });
  return { fn, getLastCall: () => lastCall };
}

describe("EventFilter", () => {
  test("renders category checkboxes", () => {
    const { fn } = createMockApply();
    const { getByTestId } = render(<EventFilter onApply={fn} />);

    expect(getByTestId("category-alert")).toBeDefined();
    expect(getByTestId("category-connector")).toBeDefined();
    expect(getByTestId("category-insight")).toBeDefined();
    expect(getByTestId("category-telegram")).toBeDefined();
    expect(getByTestId("category-mcp")).toBeDefined();
    expect(getByTestId("category-task")).toBeDefined();
    expect(getByTestId("category-webhook")).toBeDefined();
  });

  test("default selection: alert, insight, task checked", () => {
    const { fn } = createMockApply();
    const { getByTestId } = render(<EventFilter onApply={fn} />);

    const alertCb = getByTestId("category-alert") as HTMLInputElement;
    const insightCb = getByTestId("category-insight") as HTMLInputElement;
    const taskCb = getByTestId("category-task") as HTMLInputElement;
    const connectorCb = getByTestId("category-connector") as HTMLInputElement;

    expect(alertCb.checked).toBe(true);
    expect(insightCb.checked).toBe(true);
    expect(taskCb.checked).toBe(true);
    expect(connectorCb.checked).toBe(false);
  });

  test("show all toggle selects all categories", () => {
    const { fn } = createMockApply();
    const { getByTestId } = render(<EventFilter onApply={fn} />);

    const showAll = getByTestId("show-all-toggle") as HTMLInputElement;
    fireEvent.click(showAll);

    const connectorCb = getByTestId("category-connector") as HTMLInputElement;
    const telegramCb = getByTestId("category-telegram") as HTMLInputElement;
    const mcpCb = getByTestId("category-mcp") as HTMLInputElement;
    const webhookCb = getByTestId("category-webhook") as HTMLInputElement;

    expect(connectorCb.checked).toBe(true);
    expect(telegramCb.checked).toBe(true);
    expect(mcpCb.checked).toBe(true);
    expect(webhookCb.checked).toBe(true);
  });

  test("show all toggle deselects back to defaults", () => {
    const { fn } = createMockApply();
    const { getByTestId } = render(<EventFilter onApply={fn} />);

    const showAll = getByTestId("show-all-toggle") as HTMLInputElement;
    // Turn on
    fireEvent.click(showAll);
    // Turn off
    fireEvent.click(showAll);

    const connectorCb = getByTestId("category-connector") as HTMLInputElement;
    expect(connectorCb.checked).toBe(false);
  });

  test("toggling a category checkbox works", () => {
    const { fn } = createMockApply();
    const { getByTestId } = render(<EventFilter onApply={fn} />);

    const connectorCb = getByTestId("category-connector") as HTMLInputElement;
    expect(connectorCb.checked).toBe(false);

    fireEvent.click(connectorCb);
    expect(connectorCb.checked).toBe(true);

    fireEvent.click(connectorCb);
    expect(connectorCb.checked).toBe(false);
  });

  test("apply button calls onApply with current filters", () => {
    const { fn, getLastCall } = createMockApply();
    const { getByTestId } = render(<EventFilter onApply={fn} />);

    fireEvent.click(getByTestId("apply-filters"));

    expect(fn).toHaveBeenCalledTimes(1);
    const args = getLastCall();
    expect(args).toBeDefined();
    expect(args?.eventTypes).toBeInstanceOf(Set);
    expect(args?.eventTypes.has("alert.fired")).toBe(true);
    expect(args?.dateFrom).toBeNull();
    expect(args?.dateTo).toBeNull();
  });

  test("reset button restores defaults and calls onApply", () => {
    const { fn } = createMockApply();
    const { getByTestId } = render(<EventFilter onApply={fn} />);

    // Turn on show all first
    fireEvent.click(getByTestId("show-all-toggle"));

    // Now reset
    fireEvent.click(getByTestId("reset-filters"));

    expect(fn).toHaveBeenCalledTimes(1);
    const connectorCb = getByTestId("category-connector") as HTMLInputElement;
    expect(connectorCb.checked).toBe(false);
  });

  test("date inputs are present", () => {
    const { fn } = createMockApply();
    const { getByTestId } = render(<EventFilter onApply={fn} />);

    const dateFrom = getByTestId("date-from") as HTMLInputElement;
    const dateTo = getByTestId("date-to") as HTMLInputElement;

    expect(dateFrom.type).toBe("date");
    expect(dateTo.type).toBe("date");
    expect(dateFrom.value).toBe("");
    expect(dateTo.value).toBe("");
  });

  test("apply with no dates passes null", () => {
    const { fn, getLastCall } = createMockApply();
    const { getByTestId } = render(<EventFilter onApply={fn} />);

    fireEvent.click(getByTestId("apply-filters"));

    expect(fn).toHaveBeenCalledTimes(1);
    const args = getLastCall();
    expect(args).toBeDefined();
    expect(args?.dateFrom).toBeNull();
    expect(args?.dateTo).toBeNull();
  });

  test("renders show all toggle", () => {
    const { fn } = createMockApply();
    const { getByTestId } = render(<EventFilter onApply={fn} />);
    expect(getByTestId("show-all-toggle")).toBeDefined();
  });

  test("compact horizontal layout wraps categories", () => {
    const { fn } = createMockApply();
    const { getByTestId } = render(<EventFilter onApply={fn} />);
    const container = getByTestId("event-filter");
    expect(container).toBeDefined();
    // Two rows: category checkboxes + date/action row
    expect(container.children.length).toBe(2);
  });
});
