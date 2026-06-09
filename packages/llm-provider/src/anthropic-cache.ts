import type { LanguageModelMiddleware } from "ai";
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  SharedV3ProviderOptions,
} from "@ai-sdk/provider";

export type CacheTtl = "5m" | "1h";

type EphemeralMarker = { type: "ephemeral"; ttl?: "1h" };

function ephemeral(ttl: CacheTtl): EphemeralMarker {
  return ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
}

const MAX_SYSTEM_BREAKPOINTS = 2;
const MAX_TAIL_BREAKPOINTS = 2;

function stripCacheControl(
  opts: SharedV3ProviderOptions | undefined
): SharedV3ProviderOptions | undefined {
  const anthropic = opts?.["anthropic"];
  if (!anthropic || typeof anthropic !== "object") return opts;
  const { cacheControl: _cc, cache_control: _cc2, ...rest } = anthropic as Record<
    string,
    unknown
  >;
  return { ...opts, anthropic: rest } as SharedV3ProviderOptions;
}

function withCacheControl(
  opts: SharedV3ProviderOptions | undefined,
  marker: EphemeralMarker
): SharedV3ProviderOptions {
  const anthropic = opts?.["anthropic"];
  const base =
    anthropic && typeof anthropic === "object"
      ? (anthropic as Record<string, unknown>)
      : {};
  return { ...opts, anthropic: { ...base, cacheControl: marker } } as SharedV3ProviderOptions;
}

/** Index of the last content part a breakpoint can attach to (thinking
 *  blocks are canCache:false in the SDK converter), or -1. */
function lastCacheablePartIndex(msg: LanguageModelV3Message): number {
  if (!Array.isArray(msg.content)) return -1;
  for (let i = msg.content.length - 1; i >= 0; i--) {
    if (msg.content[i]!.type !== "reasoning") return i;
  }
  return -1;
}

/**
 * Anthropic prompt-cache layout: up to 2 system breakpoints + the last 2
 * markable non-system messages (4 max). Designed to run on EVERY request —
 * `transformParams` fires per step, so the tail markers advance with the
 * growing prompt and each request stays within the provider's auto-lookback
 * of the previous frontier. Idempotent: pre-existing markers are stripped
 * before re-marking, and the input prompt is never mutated.
 */
export function applyCacheControlToPrompt(
  prompt: LanguageModelV3Prompt,
  ttl: CacheTtl = "5m"
): LanguageModelV3Prompt {
  if (prompt.length === 0) return prompt;
  const marker = ephemeral(ttl);

  type Part = { providerOptions?: SharedV3ProviderOptions };
  const out: LanguageModelV3Prompt = prompt.map((msg) => {
    const cloned = { ...msg, providerOptions: stripCacheControl(msg.providerOptions) };
    if (Array.isArray(cloned.content)) {
      cloned.content = (cloned.content as Part[]).map((part) => ({
        ...part,
        providerOptions: stripCacheControl(part.providerOptions),
      })) as typeof cloned.content;
    }
    return cloned as LanguageModelV3Message;
  });

  let systemMarked = 0;
  for (const msg of out) {
    if (msg.role !== "system" || systemMarked >= MAX_SYSTEM_BREAKPOINTS) continue;
    msg.providerOptions = withCacheControl(msg.providerOptions, marker);
    systemMarked++;
  }

  let tailMarked = 0;
  for (let i = out.length - 1; i >= 0 && tailMarked < MAX_TAIL_BREAKPOINTS; i--) {
    const msg = out[i]!;
    if (msg.role === "system") continue;
    const partIdx = lastCacheablePartIndex(msg);
    if (partIdx < 0) continue;
    const parts = msg.content as Array<{ providerOptions?: SharedV3ProviderOptions }>;
    const part = parts[partIdx]!;
    part.providerOptions = withCacheControl(part.providerOptions, marker);
    tailMarked++;
  }

  return out;
}

export function anthropicCacheMiddleware(
  ttl: CacheTtl = "5m"
): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    transformParams: async ({ params }: { params: LanguageModelV3CallOptions }) => ({
      ...params,
      prompt: applyCacheControlToPrompt(params.prompt, ttl),
    }),
  };
}
