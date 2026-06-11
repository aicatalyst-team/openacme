import http from "node:http";
import path from "node:path";
import type { RequestListener } from "node:http";

export interface DevWebServerOptions {
  honoListener: RequestListener;
  /** Absolute path to the web app root (apps/web) — the Vite project. */
  webRoot: string;
}

type Middleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void,
) => void;

/**
 * Dev-only HTTP server: /api* → Hono, everything else → embedded Vite in
 * middleware mode. `appType: "spa"` keeps Vite's index.html + history
 * fallback middlewares; `hmr: { server }` attaches the HMR WebSocket to
 * this same server, so one port carries API + UI + HMR. `vite` is a
 * devDependency loaded dynamically — published dists never import it.
 */
export async function createDevWebServer(
  opts: DevWebServerOptions,
): Promise<http.Server> {
  const webRoot = path.resolve(opts.webRoot);

  // The server must exist before Vite so Vite can claim its `upgrade`
  // event; no requests arrive until the caller invokes .listen().
  let viteMiddlewares: Middleware | null = null;
  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (url === "/api" || url.startsWith("/api/")) {
      opts.honoListener(req, res);
      return;
    }
    viteMiddlewares?.(req, res, () => {
      res.statusCode = 404;
      res.end("Not found");
    });
  });

  let createViteServer: (typeof import("vite"))["createServer"];
  try {
    ({ createServer: createViteServer } = await import("vite"));
  } catch {
    throw new Error(
      "OPENACME_WEB_DEV is set but `vite` is not installed. Embedded web dev " +
        "only works inside the workspace (`pnpm dev`); unset OPENACME_WEB_DEV " +
        "to serve the bundled static web UI.",
    );
  }

  const vite = await createViteServer({
    root: webRoot,
    configFile: path.join(webRoot, "vite.config.ts"),
    appType: "spa",
    server: { middlewareMode: true, hmr: { server } },
  });
  viteMiddlewares = vite.middlewares as unknown as Middleware;
  server.on("close", () => {
    void vite.close();
  });
  return server;
}
