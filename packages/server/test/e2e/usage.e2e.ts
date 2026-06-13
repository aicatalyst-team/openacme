import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2EServer, type E2EServer } from "./support/harness.js";
import { makeClient, waitUntil } from "./support/client.js";

/**
 * Usage ledger end to end: a chat turn records a usage event the API can read
 * back. Token counts come from the stub's reported usage, so the numbers are
 * fixed but the recording + aggregation path is real.
 */
describe("usage ledger (e2e)", () => {
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

  it("records a usage event for a chat turn", async () => {
    await c.chat("helper", "hello there");

    // Usage is written fire-and-forget after the turn; poll for it.
    await waitUntil(async () => {
      const { events } = await c.json("/api/usage/events");
      return events.length > 0;
    });

    const { events } = await c.json("/api/usage/events");
    const interactive = events.find((e: any) => e.kind === "interactive");
    expect(interactive, "expected an interactive usage event").toBeTruthy();
    expect(interactive.totalTokens).toBeGreaterThan(0);
    expect(interactive.agentId).toBe("helper");

    // The summary rolls the same events into totals.
    const summary = await c.json("/api/usage/summary");
    expect(summary.totals.events).toBeGreaterThan(0);
  });
});
