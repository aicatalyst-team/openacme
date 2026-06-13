import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2EServer, type E2EServer } from "./support/harness.js";
import { makeClient, waitUntil } from "./support/client.js";
// @ts-expect-error — plain-JS test fixture, no types
import { startMcpHttpServer } from "./support/mcp-http-server.mjs";

/**
 * MCP end to end: a real MCP server (the SDK over streamable HTTP) wired into
 * an agent's private `mcpServers`. The daemon connects on agent create, the
 * tool registers as `mcp_<server>__<tool>`, and the agent calls it for real —
 * the whole client→server→client round-trip, no stub on the MCP side.
 */
describe("MCP (e2e)", () => {
  let srv: E2EServer;
  let c: ReturnType<typeof makeClient>;
  let mcp: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    mcp = await startMcpHttpServer();
    srv = await startE2EServer();
    c = makeClient(srv.baseUrl);
    // Agent create awaits the MCP reinit, so the server is connected by the
    // time the POST returns 201.
    const res = await c.post("/api/agents", {
      id: "mcpuser",
      name: "McpUser",
      mcpServers: { e2e: { url: mcp.url, transport: "http" } },
    });
    expect(res.status).toBe(201);
  });
  afterAll(async () => {
    await srv.close();
    await mcp.close();
  });

  it("connects to the server and discovers its tool", async () => {
    const status = await c.json("/api/agents/mcpuser/mcp/status");
    const server = status.servers.find((s: any) => s.name === "e2e");
    expect(server, "expected the e2e MCP server in status").toBeTruthy();
    expect(server.connected).toBe(true);
    expect(server.tools).toContain("mcp_e2e__echo");
  });

  it("an agent invokes the MCP tool and receives its result", async () => {
    const { sessionId } = await c.chat(
      "mcpuser",
      'echo it [[mock:tool:mcp_e2e__echo:{"text":"ping"}]]'
    );

    await waitUntil(async () => {
      const a = (await c.messages(sessionId)).find((m) => m.role === "assistant");
      return !!a?.parts.some(
        (p) => p?.type === "tool-mcp_e2e__echo" && p.state === "output-available"
      );
    });

    const a = (await c.messages(sessionId)).find((m) => m.role === "assistant")!;
    const toolPart = a.parts.find((p) => p?.type === "tool-mcp_e2e__echo");
    expect(JSON.stringify(toolPart), "MCP tool output should carry the server's reply").toContain(
      "echo: ping"
    );
  });
});
