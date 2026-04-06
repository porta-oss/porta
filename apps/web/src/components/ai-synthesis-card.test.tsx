import "../test/setup-dom";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import { AiSynthesisCard } from "./ai-synthesis-card";

afterEach(cleanup);

const RECENT_TIMESTAMP = new Date(Date.now() - 3_600_000).toISOString(); // 1h ago
const STALE_TIMESTAMP = new Date(
  Date.now() - 8 * 24 * 60 * 60 * 1000
).toISOString(); // 8 days ago

describe("AiSynthesisCard", () => {
  test("renders loading skeleton when loading", () => {
    const view = render(<AiSynthesisCard loading={true} />);
    expect(view.getByLabelText("Loading AI synthesis")).toBeTruthy();
  });

  test("renders empty state when text is null", () => {
    const view = render(<AiSynthesisCard text={null} />);
    expect(view.getByLabelText("AI synthesis unavailable")).toBeTruthy();
    expect(
      view.getByText("Add 2+ startups for cross-portfolio analysis")
    ).toBeTruthy();
  });

  test("renders empty state when text is undefined", () => {
    const view = render(<AiSynthesisCard />);
    expect(view.getByLabelText("AI synthesis unavailable")).toBeTruthy();
  });

  test("renders synthesis text as paragraphs", () => {
    const view = render(
      <AiSynthesisCard
        synthesizedAt={RECENT_TIMESTAMP}
        text={
          "First paragraph of analysis.\n\nSecond paragraph with more details."
        }
      />
    );
    expect(view.getByLabelText("AI portfolio synthesis")).toBeTruthy();
    expect(view.getByText("First paragraph of analysis.")).toBeTruthy();
    expect(view.getByText("Second paragraph with more details.")).toBeTruthy();
  });

  test("renders title and AI icon", () => {
    const view = render(
      <AiSynthesisCard
        synthesizedAt={RECENT_TIMESTAMP}
        text="Some analysis text."
      />
    );
    expect(view.getByText("Portfolio Synthesis")).toBeTruthy();
  });

  test("renders synthesized at timestamp with relative time", () => {
    const view = render(
      <AiSynthesisCard
        synthesizedAt={RECENT_TIMESTAMP}
        text="Some analysis text."
      />
    );
    expect(view.getByText(/Synthesized 1h ago/)).toBeTruthy();
  });

  test("renders bold markdown as strong element", () => {
    const view = render(
      <AiSynthesisCard
        synthesizedAt={RECENT_TIMESTAMP}
        text="This has **bold text** inside."
      />
    );
    const strong = view.container.querySelector("strong");
    expect(strong).toBeTruthy();
    expect(strong?.textContent).toBe("bold text");
  });

  test("renders italic markdown as em element", () => {
    const view = render(
      <AiSynthesisCard
        synthesizedAt={RECENT_TIMESTAMP}
        text="This has *italic text* inside."
      />
    );
    const em = view.container.querySelector("em");
    expect(em).toBeTruthy();
    expect(em?.textContent).toBe("italic text");
  });

  test("renders bullet lists", () => {
    const view = render(
      <AiSynthesisCard
        synthesizedAt={RECENT_TIMESTAMP}
        text={"- First item\n- Second item\n- Third item"}
      />
    );
    const listItems = view.container.querySelectorAll("li");
    expect(listItems.length).toBe(3);
    expect(listItems[0]?.textContent).toBe("First item");
    expect(listItems[1]?.textContent).toBe("Second item");
    expect(listItems[2]?.textContent).toBe("Third item");
  });

  test("shows stale badge when synthesis is older than 7 days", () => {
    const view = render(
      <AiSynthesisCard
        synthesizedAt={STALE_TIMESTAMP}
        text="Old analysis text."
      />
    );
    expect(view.getByText("Stale")).toBeTruthy();
  });

  test("does not show stale badge for recent synthesis", () => {
    const view = render(
      <AiSynthesisCard
        synthesizedAt={RECENT_TIMESTAMP}
        text="Recent analysis text."
      />
    );
    expect(view.queryByText("Stale")).toBeNull();
  });

  test("loading takes priority over text", () => {
    const view = render(
      <AiSynthesisCard
        loading={true}
        synthesizedAt={RECENT_TIMESTAMP}
        text="Should not show."
      />
    );
    expect(view.getByLabelText("Loading AI synthesis")).toBeTruthy();
    expect(view.queryByText("Should not show.")).toBeNull();
  });
});
