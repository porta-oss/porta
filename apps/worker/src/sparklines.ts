// Sparkline generation: SVG → PNG via @resvg/resvg-js.
// Used in Telegram daily digests to show 7-day north star metric trends.

import { Resvg } from "@resvg/resvg-js";

const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 50;
const RENDER_TIMEOUT_MS = 5000;
const PADDING = 4;

/**
 * Render a sparkline from numeric values as a PNG Buffer.
 * Returns null on error or timeout (caller should fall back to text).
 */
export async function renderSparkline(
  values: number[],
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT
): Promise<Buffer | null> {
  if (values.length < 2) {
    return null;
  }

  try {
    const svg = buildSparklineSvg(values, width, height);
    const png = await renderSvgToPng(svg, width);
    return png;
  } catch {
    return null;
  }
}

/** Build an SVG string with a polyline path for the given values. */
function buildSparklineSvg(
  values: number[],
  width: number,
  height: number
): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1; // avoid division by zero for flat lines

  const drawWidth = width - PADDING * 2;
  const drawHeight = height - PADDING * 2;

  const points = values
    .map((v, i) => {
      const x = PADDING + (i / (values.length - 1)) * drawWidth;
      const y = PADDING + drawHeight - ((v - min) / range) * drawHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <rect width="${width}" height="${height}" fill="#1a1a2e" rx="4"/>`,
    `  <polyline points="${points}" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    "</svg>",
  ].join("\n");
}

/** Convert an SVG string to a PNG Buffer with a timeout. */
function renderSvgToPng(svg: string, width: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Sparkline render timed out"));
    }, RENDER_TIMEOUT_MS);

    try {
      const resvg = new Resvg(svg, {
        fitTo: { mode: "width" as const, value: width },
        background: "rgba(0,0,0,0)",
      });
      const rendered = resvg.render();
      const png = rendered.asPng();
      clearTimeout(timer);
      resolve(Buffer.from(png));
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}
