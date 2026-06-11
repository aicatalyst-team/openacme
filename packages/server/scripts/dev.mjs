import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Embedded web dev: the server hosts Vite in middleware mode, so one
// process + one port serves API + UI + HMR.
const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../apps/web",
);

// Ignore the web root: embedded Vite bundles apps/web/vite.config.ts into
// node_modules/.vite-temp/ and imports it — without the ignore, tsx watches
// that temp file and its unlink triggers an endless restart loop. Vite owns
// reloading for everything under the web root anyway.
const child = spawn(
  "pnpm",
  [
    "exec",
    "tsx",
    "watch",
    "--ignore",
    `${webRoot}/**`,
    "src/index.ts",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, OPENACME_WEB_DEV: webRoot },
  },
);
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
