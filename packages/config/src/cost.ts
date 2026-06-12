import {
  lookupModelMetadata,
  type ModelConfig,
  type ModelMetadata,
} from "./schema.js";

export interface UsageCostTokens {
  /** Provider-reported TOTAL input, including cache reads and writes. */
  inputTokens: number;
  outputTokens: number;
  /** Cache-read tokens (subset of inputTokens). */
  cachedInputTokens: number;
  /** Cache-write tokens (subset of inputTokens). */
  cacheWriteTokens?: number;
}

export interface UsageCostRates {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
}

/**
 * Cache-rate fallbacks for registry entries that predate the
 * cacheRead/cacheWrite cost fields. Anthropic's multipliers are exact
 * (read 0.1×; write 1.25× for 5m TTL, 2× for 1h — the TTL lives on
 * `ModelConfig.cacheTtl`). Other providers: cached reads ~0.5× is the
 * common discount (OpenAI/Gemini implicit caching); writes aren't
 * billed separately, so write rate = input rate.
 */
function fallbackCacheRates(
  model: ModelConfig,
  meta: ModelMetadata,
  inputPerMTok: number
): { read: number; write: number } {
  const isAnthropic =
    model.provider === "anthropic" ||
    meta.family?.startsWith("claude") ||
    model.model?.includes("claude");
  if (isAnthropic) {
    return {
      read: inputPerMTok * 0.1,
      write: inputPerMTok * (model.cacheTtl === "1h" ? 2 : 1.25),
    };
  }
  return { read: inputPerMTok * 0.5, write: inputPerMTok };
}

/** Effective per-MTok rates for a model, or null when unpriced. */
export function resolveUsageRates(model: ModelConfig): UsageCostRates | null {
  const meta = lookupModelMetadata(model);
  if (
    meta.inputCostPerMTok === undefined ||
    meta.outputCostPerMTok === undefined
  ) {
    return null;
  }
  const fb = fallbackCacheRates(model, meta, meta.inputCostPerMTok);
  return {
    inputPerMTok: meta.inputCostPerMTok,
    outputPerMTok: meta.outputCostPerMTok,
    cacheReadPerMTok: meta.cacheReadCostPerMTok ?? fb.read,
    cacheWritePerMTok: meta.cacheWriteCostPerMTok ?? fb.write,
  };
}

/**
 * List-price cost of a call in USD, or null when the model isn't in the
 * pricing registry (custom/ollama). `inputTokens` is the total including
 * cache traffic — uncached input is derived by subtraction (clamped, in
 * case a provider reports cache counts outside the total).
 */
export function computeUsageCost(
  model: ModelConfig,
  tokens: UsageCostTokens
): number | null {
  const rates = resolveUsageRates(model);
  if (!rates) return null;
  const cacheRead = tokens.cachedInputTokens;
  const cacheWrite = tokens.cacheWriteTokens ?? 0;
  const uncached = Math.max(0, tokens.inputTokens - cacheRead - cacheWrite);
  return (
    (uncached * rates.inputPerMTok +
      cacheRead * rates.cacheReadPerMTok +
      cacheWrite * rates.cacheWritePerMTok +
      tokens.outputTokens * rates.outputPerMTok) /
    1_000_000
  );
}

/**
 * What the cache saved versus paying full input price for the read
 * tokens. Used by the summary endpoint's "cache savings" stat.
 */
export function computeCacheSavings(
  model: ModelConfig,
  cachedInputTokens: number
): number | null {
  const rates = resolveUsageRates(model);
  if (!rates) return null;
  return (
    (cachedInputTokens * (rates.inputPerMTok - rates.cacheReadPerMTok)) /
    1_000_000
  );
}
