import "../test/setup-dom";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import { StreakBadge } from "./streak-badge";

afterEach(cleanup);

describe("StreakBadge", () => {
  test("returns null when streakDays < 7", () => {
    const { container } = render(<StreakBadge streakDays={3} />);
    expect(container.innerHTML).toBe("");
  });

  test("renders SVG for bronze tier (>=7 days)", () => {
    const { container } = render(<StreakBadge streakDays={7} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 16 16");
  });

  test("renders SVG for silver tier (>=14 days)", () => {
    const { container } = render(<StreakBadge streakDays={14} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  test("renders SVG for gold tier (>=30 days)", () => {
    const { container } = render(<StreakBadge streakDays={30} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  test("displays streak day count inside SVG", () => {
    const { container } = render(<StreakBadge streakDays={10} />);
    const text = container.querySelector("text");
    expect(text?.textContent).toBe("10");
  });

  test("has correct aria-label for accessibility", () => {
    const { container } = render(<StreakBadge streakDays={15} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toBe(
      "15 day healthy streak (Silver)"
    );
  });

  test("uses amber stroke for bronze tier", () => {
    const { container } = render(<StreakBadge streakDays={7} />);
    const circles = container.querySelectorAll("circle");
    const progressCircle = circles[1];
    expect(progressCircle?.getAttribute("stroke")).toBe("#F59E0B");
  });

  test("uses gray stroke for silver tier", () => {
    const { container } = render(<StreakBadge streakDays={14} />);
    const circles = container.querySelectorAll("circle");
    const progressCircle = circles[1];
    expect(progressCircle?.getAttribute("stroke")).toBe("#9CA3AF");
  });

  test("uses gold stroke for gold tier", () => {
    const { container } = render(<StreakBadge streakDays={30} />);
    const circles = container.querySelectorAll("circle");
    const progressCircle = circles[1];
    expect(progressCircle?.getAttribute("stroke")).toBe("#EAB308");
  });

  test("progress is capped at 1.0 (full ring)", () => {
    const { container } = render(<StreakBadge streakDays={60} />);
    const circles = container.querySelectorAll("circle");
    const progressCircle = circles[1];
    // Full ring means dashoffset = 0
    expect(progressCircle?.getAttribute("stroke-dashoffset")).toBe("0");
  });

  test("accepts className prop", () => {
    const { container } = render(
      <StreakBadge className="custom-class" streakDays={10} />
    );
    const wrapper = container.querySelector(".custom-class");
    expect(wrapper).not.toBeNull();
  });
});
