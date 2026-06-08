import type { ModelMessage } from "ai";
import type { ModelConfig } from "@openacme/config";

export type CacheTtl = "5m" | "1h";

type EphemeralMarker = { type: "ephemeral"; ttl?: "1h" };

function ephemeral(ttl: CacheTtl): EphemeralMarker {
  return ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
}

// Anthropic auto-checks up to ~20 content blocks before each explicit
// breakpoint for a cache hit. Spacing the tail breakpoints by less than that
// (slack for the granularity of whole messages) keeps a growing, tool-heavy
// history incrementally cacheable instead of letting one multi-block turn
// overshoot the window and drop the read.
const LOOKBACK_BLOCKS = 18;

function contentBlocks(m: ModelMessage): number {
  const c = (m as { content: unknown }).content;
  return Array.isArray(c) ? Math.max(1, c.length) : 1;
}

/**
 * 4 breakpoints (Anthropic max): 1 on the system block + the most recent
 * non-system message (the growing edge — next turn reads up to here), then
 * up to 2 more anchors walking backward, spaced ~`LOOKBACK_BLOCKS` apart so
 * adjacent breakpoints stay inside Anthropic's auto-lookback window. Short
 * conversations only spend 2 breakpoints; the auto-lookback covers the small
 * per-turn growth on its own. The extra anchors only matter when a single
 * turn adds more blocks than the window (many tool calls + results).
 */
export function applyAnthropicCacheControl(
  messages: ModelMessage[],
  ttl: CacheTtl = "5m",
): ModelMessage[] {
  if (messages.length === 0) return messages;

  const marker = ephemeral(ttl);
  const out = messages.map(cloneMessage);

  let remaining = 4;
  if (out[0]!.role === "system") {
    markCacheable(out[0]!, marker);
    remaining -= 1;
  }

  const nonSystem: number[] = [];
  for (let i = 0; i < out.length; i++) {
    if (out[i]!.role !== "system") nonSystem.push(i);
  }
  if (nonSystem.length === 0 || remaining <= 0) return out;

  markCacheable(out[nonSystem[nonSystem.length - 1]!]!, marker);
  remaining -= 1;

  let blocksSinceMark = 0;
  for (let k = nonSystem.length - 2; k >= 0 && remaining > 0; k--) {
    blocksSinceMark += contentBlocks(out[nonSystem[k + 1]!]!);
    if (blocksSinceMark >= LOOKBACK_BLOCKS) {
      markCacheable(out[nonSystem[k]!]!, marker);
      remaining -= 1;
      blocksSinceMark = 0;
    }
  }

  return out;
}

/** Decide which Anthropic-cache layout (if any) applies to this model config. */
export function anthropicCachePolicy(
  cfg: ModelConfig,
): "native" | "openrouter" | "none" {
  if (cfg.provider === "anthropic") return "native";
  if (cfg.provider === "openrouter" && cfg.model) {
    const m = cfg.model.toLowerCase();
    if (m.startsWith("anthropic/") || m.includes("claude")) return "openrouter";
  }
  return "none";
}

function cloneMessage(m: ModelMessage): ModelMessage {
  const c = (m as { content: unknown }).content;
  if (typeof c === "string") return { ...m };
  if (Array.isArray(c)) {
    return { ...m, content: c.map((p) => ({ ...(p as object) })) } as ModelMessage;
  }
  return { ...m };
}

function markCacheable(m: ModelMessage, marker: EphemeralMarker): void {
  const opts = { anthropic: { cacheControl: marker } };
  const msg = m as { content: unknown; providerOptions?: Record<string, unknown> };

  // For string content (always for system, sometimes for user/assistant): put
  // providerOptions on the message envelope. The @ai-sdk/anthropic SDK reads
  // it from there for system blocks and as the last-part fallback for users.
  // Don't convert string→TextPart[] — SystemModelMessage validator rejects it.
  if (typeof msg.content === "string" || msg.content == null) {
    msg.providerOptions = { ...(msg.providerOptions ?? {}), ...opts };
    return;
  }
  if (Array.isArray(msg.content) && msg.content.length > 0) {
    const arr = msg.content as Array<{ providerOptions?: Record<string, unknown> }>;
    const last = arr[arr.length - 1]!;
    last.providerOptions = { ...(last.providerOptions ?? {}), ...opts };
  }
}
