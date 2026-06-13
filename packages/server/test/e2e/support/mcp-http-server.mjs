// A minimal, real MCP server over streamable HTTP — the transport the
// OpenAcme MCP client connects to daemon-side (no sandbox worker). Built on
// the official @modelcontextprotocol/sdk in stateless mode (a fresh server +
// transport per request), so an e2e test can point an agent's `mcpServers` at
// a live URL and drive a real tool call through it. Test-only.
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

function buildServer() {
  const server = new McpServer({ name: "e2e", version: "1.0.0" });
  server.registerTool(
    "echo",
    {
      description: "Echo the input text back, prefixed with 'echo: '.",
      inputSchema: { text: z.string() },
    },
    async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] })
  );
  return server;
}

/** Start the fixture. Returns `{ url, close }`; `url` is the `mcpServers`
 *  endpoint to use with `transport: "http"`. */
export async function startMcpHttpServer() {
  const httpServer = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      let body;
      if (chunks.length) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          body = undefined;
        }
      }
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end();
        }
      }
    });
  });

  const port = await new Promise((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve(httpServer.address().port));
  });

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise((r) => httpServer.close(() => r())),
  };
}
