// Boots a real OpenAcme daemon for Playwright: same Hono app + node-server as
// production, serving the built web bundle (apps/web/out), with the Vercel-SDK
// stub injected via the `resolveModel` seam. No tokens, no network model calls.
//
// Launched by apps/web/playwright.config.ts as its `webServer`. Run from the
// built server dist, so `pnpm build` must have produced packages/server/dist
// and apps/web/out first.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { serve } from "@hono/node-server";
import { ConfigSchema } from "@openacme/config";
import { createApp } from "../../../dist/index.js";
import { createStubModel } from "./stub-model.mjs";

const PORT = Number(process.env["OPENACME_E2E_PORT"] || 3998);

const dataDir = mkdtempSync(path.join(tmpdir(), "openacme-web-e2e-"));
process.env["OPENACME_DATA_DIR"] = dataDir;
process.env["OPENACME_TELEMETRY"] = "";
// Makes /api/keys report a configured provider so the chat page skips the
// first-run setup wizard. Never actually used — resolveModel returns the stub
// for every model call (main turn + title/extractor), so no real request goes
// to OpenRouter.
process.env["OPENROUTER_API_KEY"] = "stub-key";

const config = ConfigSchema.parse({
  dataDir,
  server: { port: PORT, host: "127.0.0.1" },
  // Provider is openrouter to match the configured key above; the actual
  // model call is overridden by resolveModel (the stub).
  model: { provider: "openrouter", model: "anthropic/claude-sonnet-4.6" },
});

const { app, manager } = await createApp(config, { resolveModel: () => createStubModel() });

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, async () => {
  // Seed one agent so the chat UI has someone to talk to.
  const res = await fetch(`http://127.0.0.1:${PORT}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "127.0.0.1" },
    body: JSON.stringify({ id: "helper", name: "Helper" }),
  });
  if (res.status !== 201) {
    console.error(`web-e2e: failed to seed agent (${res.status})`);
    process.exit(1);
  }
  // Seed a task so the board renders a real card (not the empty-state preview).
  await manager.taskStore.create({
    title: "Review the Q3 report",
    assignee: "helper",
    created_by: "user",
  });
  console.log(`web-e2e daemon ready on http://127.0.0.1:${PORT}`);
});
