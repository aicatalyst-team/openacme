import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// Remove the throwaway data dir the webServer (boot-web.mjs) recorded. Runs in
// Playwright's own process after all tests + webServer teardown — reliable,
// unlike an exit hook inside the SIGKILLed webServer.
export default function globalTeardown(): void {
  const sentinel = path.join(tmpdir(), "openacme-web-e2e.current");
  try {
    const dir = readFileSync(sentinel, "utf8").trim();
    if (dir) rmSync(dir, { recursive: true, force: true });
    rmSync(sentinel, { force: true });
  } catch {
    /* nothing recorded — nothing to clean */
  }
}
