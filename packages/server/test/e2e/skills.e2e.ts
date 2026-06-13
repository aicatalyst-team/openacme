import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2EServer, type E2EServer } from "./support/harness.js";
import { makeClient, waitUntil } from "./support/client.js";

/**
 * Skills hub end to end: install a skill from a local source through the real
 * HTTP route, then have an agent open it via `skill_view` (progressive
 * disclosure — index in the prompt, full body on demand).
 */
describe("skills hub (e2e)", () => {
  let srv: E2EServer;
  let c: ReturnType<typeof makeClient>;
  let skillDir: string;

  beforeAll(async () => {
    skillDir = mkdtempSync(path.join(tmpdir(), "openacme-skill-"));
    writeFileSync(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: e2e-skill",
        "description: A skill installed during the e2e run.",
        "tags: [test]",
        "---",
        "",
        "# E2E Skill",
        "",
        "The secret handshake is BANANA.",
        "",
      ].join("\n")
    );
    srv = await startE2EServer();
    c = makeClient(srv.baseUrl);
    await c.createAgent("helper");
  });
  afterAll(async () => {
    await srv.close();
    rmSync(skillDir, { recursive: true, force: true });
  });

  it("installs a skill from a local directory", async () => {
    const res = await c.post("/api/skills/hub/install", {
      identifier: skillDir,
      source: "local",
    });
    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe("e2e-skill");

    const installed = await c.json("/api/skills/hub/installed");
    expect(JSON.stringify(installed)).toContain("e2e-skill");
  });

  it("an agent reads the skill body via skill_view", async () => {
    const { sessionId } = await c.chat(
      "helper",
      'open it [[mock:tool:skill_view:{"name":"e2e-skill"}]]'
    );

    await waitUntil(async () => {
      const a = (await c.messages(sessionId)).find((m) => m.role === "assistant");
      return !!a?.parts.some(
        (p) => p?.type === "tool-skill_view" && p.state === "output-available"
      );
    });

    const a = (await c.messages(sessionId)).find((m) => m.role === "assistant")!;
    const toolPart = a.parts.find((p) => p?.type === "tool-skill_view");
    expect(JSON.stringify(toolPart), "skill_view should return the full body").toContain(
      "BANANA"
    );
  });
});
