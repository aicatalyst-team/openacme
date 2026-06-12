import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { clampPngDimensions } from "../src/builtins/browser/inspection.js";

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
}

async function dims(bytes: Buffer): Promise<{ width?: number; height?: number }> {
  const meta = await sharp(bytes).metadata();
  return { width: meta.width, height: meta.height };
}

describe("clampPngDimensions", () => {
  it("returns small images untouched", async () => {
    const png = await makePng(1440, 900);
    const out = await clampPngDimensions(png);
    expect(out).toBe(png);
  });

  it("downscales images exceeding the max dimension, preserving aspect", async () => {
    const png = await makePng(1440, 11400);
    const out = await clampPngDimensions(png);
    const { width, height } = await dims(out);
    expect(height).toBeLessThanOrEqual(7900);
    expect(width).toBeLessThanOrEqual(7900);
    // aspect ratio preserved within rounding
    expect(Math.abs(width! / height! - 1440 / 11400)).toBeLessThan(0.01);
  });

  it("passes non-PNG bytes through", async () => {
    const notPng = Buffer.from("definitely not a png");
    expect(await clampPngDimensions(notPng)).toBe(notPng);
  });
});
