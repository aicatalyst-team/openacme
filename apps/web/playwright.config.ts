import { defineConfig, devices } from "@playwright/test";
import * as os from "node:os";
import * as path from "node:path";

// Browser-level e2e. The `webServer` boots a real daemon (built server dist +
// built web bundle) with a stub model injected via `resolveModel` — no tokens.
// Requires `pnpm build` first (packages/server/dist + apps/web/out).
const PORT = Number(process.env.OPENACME_E2E_PORT ?? 3998);

// Auth is always on; boot-web.mjs writes this storageState (a localStorage
// bearer for the seeded operator) so every spec starts authenticated.
const STORAGE_STATE = path.join(os.tmpdir(), "openacme-web-e2e.storage.json");

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/global-teardown.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    storageState: STORAGE_STATE,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node ../../packages/server/test/e2e/support/boot-web.mjs",
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env: { OPENACME_E2E_PORT: String(PORT) },
  },
});
