/**
 * OpenRouter passes `cache_control` straight through to Anthropic for
 * Claude-family models. The @ai-sdk/openai-compatible adapter doesn't
 * surface `providerOptions.anthropic.cacheControl` on chat-completions
 * content blocks, so we inject markers at the wire level — same
 * `system_and_3` strategy as native Anthropic (system + last 3 non-system
 * messages, max 4 breakpoints).
 */

type ContentPart = {
  type?: string;
  text?: string;
  cache_control?: { type: string; ttl?: string };
} & Record<string, unknown>;

type ChatMessage = {
  role?: string;
  content?: string | ContentPart[];
  tool_calls?: unknown[];
} & Record<string, unknown>;

type ChatBody = {
  messages?: ChatMessage[];
  [k: string]: unknown;
};

type CacheTtl = "5m" | "1h";

// 5m is OpenRouter's default when `ttl` is absent; only emit the field for 1h.
function buildMarker(ttl: CacheTtl): { type: "ephemeral"; ttl?: "1h" } {
  return ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
}

// Block count after OpenRouter translates the chat-completions message into
// Anthropic blocks: content parts (string ⇒ 1) plus one tool_use block per
// tool call. Mirrors `contentBlocks` on the native path so the lookback math
// matches the same ~20-block window.
const LOOKBACK_BLOCKS = 18;
function messageBlocks(msg: ChatMessage): number {
  const contentBlocks = Array.isArray(msg.content)
    ? Math.max(1, msg.content.length)
    : 1;
  const toolBlocks = Array.isArray(msg.tool_calls) ? msg.tool_calls.length : 0;
  return contentBlocks + toolBlocks;
}

export function injectAnthropicCacheControl(
  body: unknown,
  ttl: CacheTtl = "5m",
): unknown {
  if (typeof body !== "string") return body;
  let parsed: ChatBody;
  try {
    parsed = JSON.parse(body) as ChatBody;
  } catch {
    return body;
  }
  if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) return body;

  const marker = buildMarker(ttl);
  const messages = parsed.messages;
  let remaining = 4;

  if (messages[0]!.role === "system") {
    markContentCacheable(messages[0]!, marker);
    remaining -= 1;
  }

  const nonSystem: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role !== "system") nonSystem.push(i);
  }
  if (nonSystem.length === 0 || remaining <= 0) return JSON.stringify(parsed);

  markContentCacheable(messages[nonSystem[nonSystem.length - 1]!]!, marker);
  remaining -= 1;

  let blocksSinceMark = 0;
  for (let k = nonSystem.length - 2; k >= 0 && remaining > 0; k--) {
    blocksSinceMark += messageBlocks(messages[nonSystem[k + 1]!]!);
    if (blocksSinceMark >= LOOKBACK_BLOCKS) {
      markContentCacheable(messages[nonSystem[k]!]!, marker);
      remaining -= 1;
      blocksSinceMark = 0;
    }
  }

  return JSON.stringify(parsed);
}

function markContentCacheable(
  msg: ChatMessage,
  marker: { type: "ephemeral"; ttl?: "1h" },
): void {
  const content = msg.content;
  if (typeof content === "string") {
    if (!content) return;
    msg.content = [{ type: "text", text: content, cache_control: { ...marker } }];
    return;
  }
  if (Array.isArray(content) && content.length > 0) {
    const last = content[content.length - 1]!;
    last.cache_control = { ...marker };
  }
}
