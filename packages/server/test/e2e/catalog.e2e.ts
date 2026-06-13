import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2EServer, type E2EServer } from "./support/harness.js";
import { makeClient } from "./support/client.js";

/**
 * Agent catalog end to end: list the bundled templates and import one into the
 * workforce. Import materializes the agent folder and installs the template's
 * recommended (builtin) skills — all offline.
 */
describe("agent catalog (e2e)", () => {
  let srv: E2EServer;
  let c: ReturnType<typeof makeClient>;

  beforeAll(async () => {
    srv = await startE2EServer();
    c = makeClient(srv.baseUrl);
  });
  afterAll(async () => {
    await srv.close();
  });

  it("lists the bundled templates", async () => {
    const templates = await c.json("/api/agents/catalog");
    expect(Array.isArray(templates)).toBe(true);
    expect(JSON.stringify(templates)).toContain("software-engineer");
  });

  it("imports a template into the workforce", async () => {
    const res = await c.post("/api/agents/catalog/software-engineer/import", {
      idOverride: "eng-1",
    });
    expect(res.status).toBe(200);
    const { agent, manifest } = await res.json();
    expect(agent.id).toBe("eng-1");
    expect(manifest.agent.id).toBe("eng-1");

    // The imported agent is now a real, addressable member of the workforce.
    const got = await c.json("/api/agents/eng-1");
    expect(got.id).toBe("eng-1");
  });
});
