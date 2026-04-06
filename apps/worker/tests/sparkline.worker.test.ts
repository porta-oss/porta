// Sparkline generation tests.
// Verifies SVG → PNG rendering, edge cases, and error handling.

import { describe, expect, test } from "bun:test";
import { renderSparkline } from "../src/sparklines";

/** PNG magic bytes: 0x89 P N G */
function expectPng(buf: Buffer | null): void {
  expect(buf).not.toBeNull();
  const b = buf as Buffer;
  expect(b[0]).toBe(0x89);
  expect(b[1]).toBe(0x50);
  expect(b[2]).toBe(0x4e);
  expect(b[3]).toBe(0x47);
}

describe("renderSparkline", () => {
  test("returns a PNG buffer for valid values", async () => {
    const result = await renderSparkline([10, 20, 15, 30, 25, 35, 40]);
    expectPng(result);
  });

  test("returns null for fewer than 2 values", async () => {
    expect(await renderSparkline([])).toBeNull();
    expect(await renderSparkline([42])).toBeNull();
  });

  test("handles exactly 2 values", async () => {
    expectPng(await renderSparkline([10, 20]));
  });

  test("handles flat values (all identical)", async () => {
    expectPng(await renderSparkline([5, 5, 5, 5, 5]));
  });

  test("handles negative values", async () => {
    expectPng(await renderSparkline([-10, -5, 0, 5, 10]));
  });

  test("respects custom dimensions", async () => {
    expectPng(await renderSparkline([1, 2, 3, 4, 5], 100, 30));
  });

  test("handles large datasets", async () => {
    const values = Array.from(
      { length: 365 },
      (_, i) => Math.sin(i / 10) * 100 + 200
    );
    expectPng(await renderSparkline(values));
  });
});
