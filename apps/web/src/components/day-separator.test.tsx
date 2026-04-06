import "../test/setup-dom";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import { DaySeparator } from "./day-separator";

afterEach(cleanup);

describe("DaySeparator", () => {
  test("renders 'Today' for today's date", () => {
    const today = new Date().toISOString();
    const { getByText } = render(<DaySeparator date={today} />);
    expect(getByText("Today")).toBeDefined();
  });

  test("renders 'Yesterday' for yesterday's date", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const { getByText } = render(<DaySeparator date={yesterday} />);
    expect(getByText("Yesterday")).toBeDefined();
  });

  test("renders formatted date for older dates", () => {
    // Use a fixed date far enough in the past
    const old = new Date(2025, 0, 15); // January 15, 2025
    const { getByText } = render(<DaySeparator date={old} />);
    expect(getByText("Wednesday, January 15")).toBeDefined();
  });

  test("accepts Date objects", () => {
    const today = new Date();
    const { getByText } = render(<DaySeparator date={today} />);
    expect(getByText("Today")).toBeDefined();
  });

  test("renders horizontal rules on both sides", () => {
    const { container } = render(<DaySeparator date={new Date()} />);
    const rules = container.querySelectorAll(".bg-border");
    expect(rules.length).toBe(2);
  });

  test("uses muted text color", () => {
    const { container } = render(<DaySeparator date={new Date()} />);
    const label = container.querySelector(".text-muted-foreground");
    expect(label).toBeDefined();
  });
});
