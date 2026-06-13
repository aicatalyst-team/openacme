/**
 * e2e harness: boots a real listening daemon (the same Hono app + node-server
 * `serve()` production uses) on a random port, against a throwaway data dir,
 * wired to the fake OpenAI-compatible LLM through the stock `custom` provider.
 * No tokens, no network, no production mock code.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { ConfigSchema } from "@openacme/config";
import { createApp } from "../../../src/app.js";
import type { AgentManager } from "../../../src/agent-manager.js";
// @ts-expect-error — plain-JS test helper, no types (not type-checked: tsconfig is src-only)
import { createStubModel } from "./stub-model.mjs";

export interface E2EServer {
  baseUrl: string;
  dataDir: string;
  manager: AgentManager;
  close: () => Promise<void>;
}

export async function startE2EServer(
  opts: { dispatcher?: boolean; tickMs?: number } = {}
): Promise<E2EServer> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "openacme-e2e-"));
  process.env["OPENACME_DATA_DIR"] = dataDir;
  // Model config is irrelevant to the turn — `resolveModel` overrides it with
  // the stub. A dead loopback `custom` baseUrl keeps any background path
  // (title/extractor) from reaching a real provider.
  const config = ConfigSchema.parse({
    dataDir,
    model: { provider: "custom", model: "stub-1", baseUrl: "http://127.0.0.1:9/v1", apiKey: "stub" },
  });
  const { app, manager } = await createApp(config, {
    resolveModel: () => createStubModel(),
    tickIntervalMs: opts.tickMs,
  });

  const { server, port } = await new Promise<{ server: ServerType; port: number }>(
    (resolve) => {
      const s = serve(
        { fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
        (info) => resolve({ server: s, port: info.port })
      );
    }
  );

  if (opts.dispatcher) await manager.dispatcher.start();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    dataDir,
    manager,
    close: async () => {
      if (opts.dispatcher) manager.dispatcher.stop();
      // Let fire-and-forget post-turn writes (usage ledger, title, extractor)
      // flush before we close the DB — otherwise they warn into closed-handle
      // noise. They never affect assertions; this is purely for clean output.
      await new Promise((r) => setTimeout(r, 150));
      await new Promise<void>((r) => server.close(() => r()));
      await manager.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}

/** Minimal SSE reader over fetch (Node 20 has no global EventSource). */
export interface SSEHandle {
  events: SSEEvent[];
  waitFor: (pred: (e: SSEEvent) => boolean, timeoutMs?: number) => Promise<SSEEvent>;
  close: () => void;
}

export async function openSSE(url: string): Promise<SSEHandle> {
  const controller = new AbortController();
  const res = await fetch(url, {
    headers: { host: "127.0.0.1", accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (!res.body) throw new Error(`SSE ${url} returned no body (${res.status})`);

  const events: SSEEvent[] = [];
  const waiters: Array<{ pred: (e: SSEEvent) => boolean; resolve: (e: SSEEvent) => void }> = [];

  const push = (ev: SSEEvent) => {
    events.push(ev);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.pred(ev)) {
        waiters[i]!.resolve(ev);
        waiters.splice(i, 1);
      }
    }
  };

  let buf = "";
  const parseFrame = (frame: string) => {
    let event = "message";
    let data = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    try {
      push({ event, data: JSON.parse(data) as Record<string, unknown> });
    } catch {
      // ignore non-JSON frames
    }
  };

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const drain = () => {
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      parseFrame(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
    }
  };

  // Block until the server's ReadableStream start() runs — it flushes the
  // `: connected` comment in the same block that registers the broadcaster
  // subscription. Reading one chunk guarantees we won't miss the turn's
  // first events posted right after open() resolves.
  const first = await reader.read();
  if (!first.done) {
    buf += dec.decode(first.value, { stream: true });
    drain();
  }

  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        drain();
      }
    } catch {
      // aborted on close
    }
  })();

  return {
    events,
    waitFor: (pred, timeoutMs = 10_000) =>
      new Promise((resolve, reject) => {
        const existing = events.find(pred);
        if (existing) return resolve(existing);
        const timer = setTimeout(
          () => reject(new Error(`SSE waitFor timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
        waiters.push({
          pred,
          resolve: (e) => {
            clearTimeout(timer);
            resolve(e);
          },
        });
      }),
    close: () => controller.abort(),
  };
}
