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

/**
 * Ask OpenRouter to report actual usage + cost in the response
 * (`usage.cost`, cached token counts). Powers the usage ledger's
 * `provider_reported` cost source; without it OpenRouter omits cost and
 * the ledger falls back to registry estimates.
 */
export function injectUsageAccounting(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed["usage"] !== undefined) return body;
    parsed["usage"] = { include: true };
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
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
  let used = 0;
  const messages = parsed.messages;

  if (messages[0]!.role === "system") {
    markContentCacheable(messages[0]!, marker);
    used += 1;
  }

  const remaining = 4 - used;
  const nonSystem: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role !== "system") nonSystem.push(i);
  }
  for (const i of nonSystem.slice(-remaining)) {
    markContentCacheable(messages[i]!, marker);
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
