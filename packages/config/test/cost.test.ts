import { describe, it, expect } from "vitest";
import {
  ModelConfigSchema,
  lookupModelMetadata,
  type ModelMetadata,
} from "../src/schema.js";
import {
  computeUsageCost,
  computeCacheSavings,
  resolveUsageRates,
  fallbackCacheRates,
} from "../src/cost.js";

const anthropic = ModelConfigSchema.parse({
  provider: "anthropic",
  model: "claude-3-5-haiku-20241022", // $0.8 in / $4 out in the bundled registry
});

describe("resolveUsageRates", () => {
  it("returns null for unpriced models (ollama/custom)", () => {
    expect(
      resolveUsageRates(
        ModelConfigSchema.parse({ provider: "ollama", model: "llama3.3" })
      )
    ).toBeNull();
  });

  it("uses explicit registry cache rates when present", () => {
    // models.dev publishes cache rates for snapshot models; they win.
    const rates = resolveUsageRates(anthropic)!;
    expect(rates.inputPerMTok).toBe(0.8);
    expect(rates.outputPerMTok).toBe(4);
    expect(rates.cacheReadPerMTok).toBeCloseTo(0.08);
    expect(rates.cacheWritePerMTok).toBeCloseTo(1.0);
  });
});

// Reached for claude models not yet carrying explicit cache rates — e.g. a
// freshly-shipped model in our presets before models.dev publishes its rates.
describe("fallbackCacheRates", () => {
  const claude = ModelConfigSchema.parse({
    provider: "anthropic",
    model: "claude-future",
  });

  it("derives anthropic rates from multipliers (5m TTL)", () => {
    const fb = fallbackCacheRates(claude, {} as ModelMetadata, 0.8);
    expect(fb.read).toBeCloseTo(0.08); // 0.1× input
    expect(fb.write).toBeCloseTo(1.0); // 1.25× for 5m TTL
  });

  it("uses the 2× write multiplier for 1h cacheTtl", () => {
    const oneHour = ModelConfigSchema.parse({
      provider: "anthropic",
      model: "claude-future",
      cacheTtl: "1h",
    });
    expect(fallbackCacheRates(oneHour, {} as ModelMetadata, 0.8).write).toBeCloseTo(1.6);
  });
});

describe("computeUsageCost", () => {
  it("treats inputTokens as total including cache traffic", () => {
    // Pin the Anthropic-adapter contract the ledger depends on: input
    // includes cacheRead + cacheWrite, so uncached = 1000 − 600 − 200.
    const cost = computeUsageCost(anthropic, {
      inputTokens: 1000,
      outputTokens: 100,
      cachedInputTokens: 600,
      cacheWriteTokens: 200,
    })!;
    const expected =
      (200 * 0.8 + 600 * 0.08 + 200 * 1.0 + 100 * 4) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 12);
  });

  it("clamps when cache counts exceed reported input", () => {
    const cost = computeUsageCost(anthropic, {
      inputTokens: 100,
      outputTokens: 0,
      cachedInputTokens: 150,
      cacheWriteTokens: 0,
    })!;
    expect(cost).toBeCloseTo((150 * 0.08) / 1_000_000, 12);
  });

  it("returns null for unpriced models", () => {
    expect(
      computeUsageCost(
        ModelConfigSchema.parse({ provider: "custom", model: "whatever" }),
        { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }
      )
    ).toBeNull();
  });

  it("prefers registry cache pricing over multipliers when present", () => {
    // Synthetic check via lookup: if the registry ever ships cache costs
    // for this model, resolveUsageRates must surface them verbatim.
    const meta = lookupModelMetadata(anthropic);
    if (meta.cacheReadCostPerMTok !== undefined) {
      expect(resolveUsageRates(anthropic)!.cacheReadPerMTok).toBe(
        meta.cacheReadCostPerMTok
      );
    }
  });
});

describe("computeCacheSavings", () => {
  it("is read tokens times the input/cache-read spread", () => {
    const savings = computeCacheSavings(anthropic, 1_000_000)!;
    expect(savings).toBeCloseTo(0.8 - 0.08, 6);
  });
});
