import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2EServer, type E2EServer } from "./support/harness.js";
import { makeClient, waitUntil } from "./support/client.js";

// Memory: an agent persists a durable fact via the memory tool, landing in its
// per-agent memory store on disk.
describe("agent memory (e2e)", () => {
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

  it("an agent saves a fact through the memory tool", async () => {
    const directive = JSON.stringify({
      command: "create",
      path: "facts.md",
      file_text: "The capital of France is Paris.",
    });
    await c.chat("helper", `remember this [[mock:tool:memory:${directive}]]`);

    const memPath = path.join(srv.dataDir, "agents", "helper", "memory", "facts.md");
    await waitUntil(async () => existsSync(memPath));
    expect(readFileSync(memPath, "utf8")).toContain("Paris");
  });
});
