import { describe, it, expect } from "vitest";
import type { LanguageModelV3Message, LanguageModelV3Prompt } from "ai";
import { applyCacheControlToPrompt } from "../src/anthropic-cache.js";

type AnyOpts = { anthropic?: { cacheControl?: unknown } } | undefined;

function msgMarker(m: LanguageModelV3Message): unknown {
  return (m.providerOptions as AnyOpts)?.anthropic?.cacheControl;
}

function partMarkers(m: LanguageModelV3Message): unknown[] {
  if (!Array.isArray(m.content)) return [];
  return m.content.map(
    (p) => (p.providerOptions as AnyOpts)?.anthropic?.cacheControl
  );
}

function markerCount(prompt: LanguageModelV3Prompt): number {
  let n = 0;
  for (const m of prompt) {
    if (msgMarker(m)) n++;
    n += partMarkers(m).filter(Boolean).length;
  }
  return n;
}

const system = (text = "S"): LanguageModelV3Message => ({
  role: "system",
  content: text,
});
const user = (text = "u"): LanguageModelV3Message => ({
  role: "user",
  content: [{ type: "text", text }],
});
const assistant = (text = "a"): LanguageModelV3Message => ({
  role: "assistant",
  content: [{ type: "text", text }],
});
const assistantWithTrailingReasoning = (): LanguageModelV3Message => ({
  role: "assistant",
  content: [
    { type: "text", text: "a" },
    { type: "reasoning", text: "thinking..." },
  ],
});

describe("applyCacheControlToPrompt", () => {
  it("returns empty prompt unchanged", () => {
    expect(applyCacheControlToPrompt([])).toEqual([]);
  });

  it("marks system message-level and last 2 non-system on their last part", () => {
    const out = applyCacheControlToPrompt([system(), user("q1"), assistant(), user("q2")]);
    expect(msgMarker(out[0]!)).toEqual({ type: "ephemeral" });
    expect(partMarkers(out[1]!)).toEqual([undefined]);
    expect(partMarkers(out[2]!)).toEqual([{ type: "ephemeral" }]);
    expect(partMarkers(out[3]!)).toEqual([{ type: "ephemeral" }]);
    expect(markerCount(out)).toBe(3);
  });

  it("caps at 2 system breakpoints", () => {
    const out = applyCacheControlToPrompt([system("S1"), system("S2"), system("S3"), user()]);
    expect(msgMarker(out[0]!)).toBeTruthy();
    expect(msgMarker(out[1]!)).toBeTruthy();
    expect(msgMarker(out[2]!)).toBeUndefined();
    expect(markerCount(out)).toBe(3);
  });

  it("never exceeds 4 breakpoints", () => {
    const prompt: LanguageModelV3Prompt = [system("S1"), system("S2")];
    for (let i = 0; i < 10; i++) {
      prompt.push(user(`q${i}`), assistant(`a${i}`));
    }
    expect(markerCount(applyCacheControlToPrompt(prompt))).toBe(4);
  });

  it("skips trailing reasoning part and marks the preceding cacheable part", () => {
    const out = applyCacheControlToPrompt([system(), user(), assistantWithTrailingReasoning()]);
    const markers = partMarkers(out[2]!);
    expect(markers[0]).toEqual({ type: "ephemeral" });
    expect(markers[1]).toBeUndefined();
  });

  it("skips a message whose parts are all reasoning and marks an earlier one", () => {
    const allReasoning: LanguageModelV3Message = {
      role: "assistant",
      content: [{ type: "reasoning", text: "t" }],
    };
    const out = applyCacheControlToPrompt([system(), user("q1"), user("q2"), allReasoning]);
    expect(partMarkers(out[3]!)).toEqual([undefined]);
    expect(partMarkers(out[2]!)).toEqual([{ type: "ephemeral" }]);
    expect(partMarkers(out[1]!)).toEqual([{ type: "ephemeral" }]);
  });

  it("is idempotent: re-applying to a marked prompt yields the same markers", () => {
    const once = applyCacheControlToPrompt([system(), user(), assistant(), user("q2")]);
    const grown: LanguageModelV3Prompt = [...once, assistant("a2"), user("q3")];
    const twice = applyCacheControlToPrompt(grown);
    expect(markerCount(twice)).toBe(3);
    expect(partMarkers(twice[2]!)).toEqual([undefined]);
    expect(partMarkers(twice[3]!)).toEqual([undefined]);
    expect(partMarkers(twice[4]!)).toEqual([{ type: "ephemeral" }]);
    expect(partMarkers(twice[5]!)).toEqual([{ type: "ephemeral" }]);
  });

  it("propagates the 1h ttl; 5m emits the bare marker", () => {
    const out1h = applyCacheControlToPrompt([system()], "1h");
    expect(msgMarker(out1h[0]!)).toEqual({ type: "ephemeral", ttl: "1h" });
    const out5m = applyCacheControlToPrompt([system()], "5m");
    expect(msgMarker(out5m[0]!)).toEqual({ type: "ephemeral" });
  });

  it("does not mutate the input prompt", () => {
    const input = [system(), user()];
    applyCacheControlToPrompt(input);
    expect(msgMarker(input[0]!)).toBeUndefined();
    expect(partMarkers(input[1]!)).toEqual([undefined]);
  });

  it("preserves unrelated providerOptions while stripping stale markers", () => {
    const msg: LanguageModelV3Message = {
      role: "user",
      content: [
        {
          type: "text",
          text: "u",
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" }, other: "keep" },
          },
        },
      ],
    };
    const out = applyCacheControlToPrompt([msg, assistant()]);
    const part = (out[0]!.content as Array<{ providerOptions?: Record<string, unknown> }>)[0]!;
    expect((part.providerOptions?.["anthropic"] as Record<string, unknown>)["other"]).toBe(
      "keep"
    );
  });
});
