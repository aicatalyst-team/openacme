import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2EServer, type E2EServer } from "./support/harness.js";
import { makeClient, assistantText, waitUntil } from "./support/client.js";

/**
 * Multi-step agent loop: the model emits a tool call, sees the result, emits a
 * second tool call, then closes with text — all in one turn. Exercises the
 * step loop (stopWhen / maxSteps) past the single round-trip the chat suite
 * covers.
 */
describe("multi-step loop (e2e)", () => {
  let srv: E2EServer;
  let c: ReturnType<typeof makeClient>;

  beforeAll(async () => {
    srv = await startE2EServer();
    c = makeClient(srv.baseUrl);
    await c.createAgent("helper");
  });
  afterAll(async () => {
    await srv.close();
  });

  it("runs two sequential tool calls then closes with text", async () => {
    const { sessionId } = await c.chat("helper", "work through it [[mock:chain]]");

    await waitUntil(
      async () => {
        const a = (await c.messages(sessionId)).find((m) => m.role === "assistant");
        return !!a && assistantText(a.parts).includes("Chain complete");
      },
      { timeoutMs: 25_000 }
    );

    const a = (await c.messages(sessionId)).find((m) => m.role === "assistant")!;
    const toolParts = a.parts.filter(
      (p) => typeof p?.type === "string" && p.type.startsWith("tool-")
    );
    expect(toolParts.length).toBeGreaterThanOrEqual(2);
    expect(assistantText(a.parts)).toContain("Chain complete after 2 tool calls.");
  });
});
