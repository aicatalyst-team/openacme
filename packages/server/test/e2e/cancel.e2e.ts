import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2EServer, openSSE, type E2EServer } from "./support/harness.js";
import { makeClient, isState, waitUntil } from "./support/client.js";

// Cancellation: a live turn aborts when the stop endpoint is hit.
describe("cancel a turn (e2e)", () => {
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

  it("DELETE active-turn aborts a running stream", async () => {
    const sessionId = randomUUID();
    const sse = await openSSE(`${srv.baseUrl}/api/sessions/${sessionId}/stream`);

    // `[[mock:slow]]` streams ~5s of deltas, so the turn is in-flight long
    // enough to cancel.
    await c.chat("helper", "take your time [[mock:slow]]", sessionId);
    await sse.waitFor(isState("running"));

    // 200 = a running turn was aborted (404 would mean none was running).
    await waitUntil(
      async () => {
        const res = await c.req(`/api/sessions/${sessionId}/active-turn`, { method: "DELETE" });
        return res.status === 200;
      },
      { timeoutMs: 3000, intervalMs: 100 }
    );

    // The turn settles to idle after the abort.
    await sse.waitFor(isState("idle"), 10_000);
    sse.close();

    // A second cancel is a no-op now that nothing is running.
    const again = await c.req(`/api/sessions/${sessionId}/active-turn`, { method: "DELETE" });
    expect(again.status).toBe(404);
  });
});
