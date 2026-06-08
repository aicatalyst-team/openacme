import { describe, it, expect } from "vitest";
import type { ModelMessage } from "ai";
import { applyAnthropicCacheControl } from "../src/cache-control.js";

function cc(m: ModelMessage): unknown {
  // Marker lands on the message envelope for string content, else on the
  // last content part.
  const env = (m as { providerOptions?: { anthropic?: { cacheControl?: unknown } } })
    .providerOptions?.anthropic?.cacheControl;
  if (env) return env;
  const c = (m as { content: unknown }).content;
  if (Array.isArray(c) && c.length > 0) {
    return (c[c.length - 1] as { providerOptions?: { anthropic?: { cacheControl?: unknown } } })
      .providerOptions?.anthropic?.cacheControl;
  }
  return undefined;
}

function marked(messages: ModelMessage[]): number[] {
  return messages.map((m, i) => (cc(m) ? i : -1)).filter((i) => i >= 0);
}

const sys = (): ModelMessage => ({ role: "system", content: "S" });
const user = (t = "u"): ModelMessage => ({ role: "user", content: t });
const asst = (t = "a"): ModelMessage => ({ role: "assistant", content: t });
// Assistant message with `n` content blocks (simulates n tool calls).
const fatAsst = (n: number): ModelMessage => ({
  role: "assistant",
  content: Array.from({ length: n }, (_, i) => ({ type: "text", text: `b${i}` })) as never,
});

describe("applyAnthropicCacheControl", () => {
  it("returns empty unchanged", () => {
    expect(applyAnthropicCacheControl([])).toEqual([]);
  });

  it("short conversation: marks system + the most recent message only", () => {
    const out = applyAnthropicCacheControl([sys(), user(), asst(), user("q2")]);
    expect(marked(out)).toEqual([0, 3]);
  });

  it("does not mutate the input messages", () => {
    const input = [sys(), user()];
    applyAnthropicCacheControl(input);
    expect(cc(input[0]!)).toBeUndefined();
    expect(cc(input[1]!)).toBeUndefined();
  });

  it("no system message: still marks the most recent message", () => {
    const out = applyAnthropicCacheControl([user(), asst(), user("q2")]);
    expect(marked(out)).toEqual([2]);
  });

  it("emits the 1h ttl marker when requested", () => {
    const out = applyAnthropicCacheControl([sys()], "1h");
    expect(cc(out[0]!)).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("emits the bare (5m) marker by default", () => {
    const out = applyAnthropicCacheControl([sys()]);
    expect(cc(out[0]!)).toEqual({ type: "ephemeral" });
  });

  it("spreads anchors backward across a block-heavy tail, within budget", () => {
    // A single fat assistant turn (25 blocks) sits between two user turns.
    // The most recent message is always anchored; walking back, the 25-block
    // message crosses the lookback threshold so the message before it is also
    // anchored. Total breakpoints capped at 4 (system + 3).
    const out = applyAnthropicCacheControl([
      sys(),
      user("q1"),
      fatAsst(25),
      user("q2"),
    ]);
    const m = marked(out);
    expect(m[0]).toBe(0); // system
    expect(m).toContain(3); // most recent
    expect(m).toContain(1); // anchored because the fat turn overshot the window
    expect(m.length).toBeLessThanOrEqual(4);
  });

  it("never exceeds 4 breakpoints even with many fat turns", () => {
    const msgs: ModelMessage[] = [sys()];
    for (let i = 0; i < 10; i++) {
      msgs.push(user(`q${i}`));
      msgs.push(fatAsst(25));
    }
    const out = applyAnthropicCacheControl(msgs);
    expect(marked(out).length).toBeLessThanOrEqual(4);
  });
});
