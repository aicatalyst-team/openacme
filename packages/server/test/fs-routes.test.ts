import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigSchema } from "@openacme/config";
import { createApp } from "../src/app.js";
import type { AgentManager } from "../src/agent-manager.js";
import type { Hono } from "hono";

/**
 * Route-level tests for /api/fs — the scoped file browser API.
 * Same bootstrap as app-routes.test.ts: real createApp() on a temp
 * data dir, files seeded straight onto disk.
 */

let dataDir: string;
let app: Hono;
let manager: AgentManager;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "openacme-fs-"));
  const config = ConfigSchema.parse({
    dataDir,
    model: { provider: "anthropic", model: "claude-sonnet-4-6" },
  });
  ({ app, manager } = await createApp(config));
});

afterEach(async () => {
  await manager.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function req(p: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("host", "127.0.0.1");
  return app.request(`http://127.0.0.1${p}`, { ...init, headers });
}

async function createAgent(id = "helper", name = "Helper") {
  const res = await req("/api/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, name }),
  });
  expect(res.status).toBe(201);
}

function workspaceDir(agentId: string): string {
  return path.join(dataDir, "agents", agentId, "workspace");
}

function seed(agentId: string, relPath: string, content: string | Buffer) {
  const abs = path.join(workspaceDir(agentId), relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

interface TreeBody {
  files: Array<{ path: string; size: number; mtimeMs: number }>;
  truncated: boolean;
  writable: boolean;
}

describe("GET /api/fs/:kind/:ownerId/:scope/tree", () => {
  it("lists workspace files recursively, dotfiles included, junk dirs excluded", async () => {
    await createAgent();
    seed("helper", "notes.md", "# notes");
    seed("helper", "src/index.ts", "export {}");
    seed("helper", ".env", "SECRET=1");
    seed("helper", ".git/HEAD", "ref: refs/heads/main");
    seed("helper", "node_modules/pkg/index.js", "x");

    const res = await req("/api/fs/agent/helper/workspace/tree");
    expect(res.status).toBe(200);
    const body = (await res.json()) as TreeBody;
    const paths = body.files.map((f) => f.path);
    expect(paths).toContain("notes.md");
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain(".env");
    expect(paths.some((p) => p.startsWith(".git/"))).toBe(false);
    expect(paths.some((p) => p.startsWith("node_modules/"))).toBe(false);
    expect(body.truncated).toBe(false);
    expect(body.writable).toBe(false);
  });

  it("marks the resources root writable for unmanaged agents", async () => {
    await createAgent();
    const res = await req("/api/fs/agent/helper/resources/tree");
    expect(res.status).toBe(200);
    const body = (await res.json()) as TreeBody;
    expect(body.writable).toBe(true);
  });

  it("404s on unknown agents and invalid scopes", async () => {
    expect((await req("/api/fs/agent/nope/workspace/tree")).status).toBe(404);
    await createAgent();
    expect((await req("/api/fs/agent/helper/memory/tree")).status).toBe(404);
    expect((await req("/api/fs/team/helper/workspace/tree")).status).toBe(404);
  });

  it("serves a team workspace", async () => {
    await createAgent();
    const create = await req("/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "crew", name: "Crew", members: ["helper"] }),
    });
    expect(create.status).toBe(201);
    writeFileSync(
      path.join(dataDir, "teams", "crew", "workspace", "plan.md"),
      "# plan"
    );
    const res = await req("/api/fs/team/crew/workspace/tree");
    expect(res.status).toBe(200);
    const body = (await res.json()) as TreeBody;
    expect(body.files.map((f) => f.path)).toContain("plan.md");
    expect(body.writable).toBe(false);
  });
});

describe("GET /api/fs/:kind/:ownerId/:scope/file/*", () => {
  it("serves bytes with the mapped content-type", async () => {
    await createAgent();
    seed("helper", "src/app.ts", "const x = 1;");
    const res = await req("/api/fs/agent/helper/workspace/file/src/app.ts");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("const x = 1;");
  });

  it("honors Range requests with 206/416", async () => {
    await createAgent();
    seed("helper", "data.bin", Buffer.alloc(1000, 7));
    const partial = await req("/api/fs/agent/helper/workspace/file/data.bin", {
      headers: { range: "bytes=0-99" },
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 0-99/1000");
    expect((await partial.arrayBuffer()).byteLength).toBe(100);

    const suffix = await req("/api/fs/agent/helper/workspace/file/data.bin", {
      headers: { range: "bytes=-100" },
    });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get("content-range")).toBe("bytes 900-999/1000");

    const bad = await req("/api/fs/agent/helper/workspace/file/data.bin", {
      headers: { range: "bytes=5000-" },
    });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe("bytes */1000");
  });

  it("sandboxes markup types", async () => {
    await createAgent();
    seed("helper", "page.html", "<script>alert(1)</script>");
    const res = await req("/api/fs/agent/helper/workspace/file/page.html");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
  });

  it("serves extensionless text via NUL sniff and dotfiles as text", async () => {
    await createAgent();
    seed("helper", "Dockerfile", "FROM node:20");
    seed("helper", ".env", "A=1");
    seed("helper", "blob", Buffer.from([0x00, 0x01, 0x02]));
    const docker = await req("/api/fs/agent/helper/workspace/file/Dockerfile");
    expect(docker.headers.get("content-type")).toContain("text/plain");
    const env = await req("/api/fs/agent/helper/workspace/file/.env");
    expect(env.headers.get("content-type")).toContain("text/plain");
    const blob = await req("/api/fs/agent/helper/workspace/file/blob");
    expect(blob.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("forces attachment disposition with ?download=1", async () => {
    await createAgent();
    seed("helper", "a.txt", "hi");
    const res = await req(
      "/api/fs/agent/helper/workspace/file/a.txt?download=1"
    );
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });

  it("rejects traversal, .git access, and out-of-root symlinks", async () => {
    await createAgent();
    seed("helper", ".git/config", "[core]");
    writeFileSync(path.join(dataDir, "outside.txt"), "secret");
    symlinkSync(
      path.join(dataDir, "outside.txt"),
      path.join(workspaceDir("helper"), "escape")
    );

    // A literal `..` segment never reaches the route (the URL parser
    // normalizes it away) — the live vector is an encoded slash, which
    // survives URL parsing and lands on our resolver as `../AGENT.md`.
    const traversal = await req(
      "/api/fs/agent/helper/workspace/file/..%2FAGENT.md"
    );
    expect(traversal.status).toBe(400);
    const git = await req("/api/fs/agent/helper/workspace/file/.git/config");
    expect(git.status).toBe(400);
    const link = await req("/api/fs/agent/helper/workspace/file/escape");
    expect(link.status).toBe(400);
  });
});

describe("POST /api/fs/agent/:ownerId/stat", () => {
  it("resolves relative paths against workspace then resources", async () => {
    await createAgent();
    seed("helper", "draft.md", "x");
    const resourcesDir = path.join(dataDir, "agents", "helper", "resources");
    mkdirSync(resourcesDir, { recursive: true });
    writeFileSync(path.join(resourcesDir, "guide.md"), "y");

    const res = await req("/api/fs/agent/helper/stat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths: ["draft.md", "guide.md", "missing.md"] }),
    });
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as {
      results: Record<string, { scope: string; relPath: string } | null>;
    };
    expect(results["draft.md"]).toMatchObject({
      scope: "workspace",
      relPath: "draft.md",
    });
    expect(results["guide.md"]).toMatchObject({
      scope: "resources",
      relPath: "guide.md",
    });
    expect(results["missing.md"]).toBeNull();
  });

  it("resolves scope-prefixed paths the way agents write them", async () => {
    await createAgent();
    seed("helper", "draft.md", "x");
    const res = await req("/api/fs/agent/helper/stat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths: ["workspace/draft.md", "resources/draft.md"] }),
    });
    const { results } = (await res.json()) as {
      results: Record<string, { scope: string; relPath: string } | null>;
    };
    expect(results["workspace/draft.md"]).toMatchObject({
      scope: "workspace",
      relPath: "draft.md",
    });
    expect(results["resources/draft.md"]).toBeNull();
  });

  it("normalizes ./ prefixes, ~ paths, and :line suffixes", async () => {
    await createAgent();
    seed("helper", "src/app.ts", "x");
    const home = process.env.HOME!;
    const abs = path.join(workspaceDir("helper"), "src/app.ts");
    const tilde = abs.startsWith(home) ? `~${abs.slice(home.length)}` : null;
    const inputs = [
      "./src/app.ts",
      "src/app.ts:42",
      "src/app.ts:42:7",
      ...(tilde ? [tilde] : []),
    ];
    const res = await req("/api/fs/agent/helper/stat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths: inputs }),
    });
    const { results } = (await res.json()) as {
      results: Record<string, { relPath: string } | null>;
    };
    for (const input of inputs) {
      expect(results[input], input).toMatchObject({ relPath: "src/app.ts" });
    }
  });

  it("resolves paths in the agent's team workspaces", async () => {
    await createAgent();
    const create = await req("/api/teams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "crew", name: "Crew", members: ["helper"] }),
    });
    expect(create.status).toBe(201);
    const teamWs = path.join(dataDir, "teams", "crew", "workspace");
    writeFileSync(path.join(teamWs, "plan.md"), "# plan");

    const res = await req("/api/fs/agent/helper/stat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paths: [
          "plan.md",
          "teams/crew/workspace/plan.md",
          path.join(teamWs, "plan.md"),
        ],
      }),
    });
    const { results } = (await res.json()) as {
      results: Record<string, { kind: string; ownerId: string } | null>;
    };
    for (const key of Object.keys(results)) {
      expect(results[key], key).toMatchObject({
        kind: "team",
        ownerId: "crew",
        relPath: "plan.md",
      });
    }
  });

  it("accepts absolute paths only inside the agent roots", async () => {
    await createAgent();
    seed("helper", "deep/file.txt", "x");
    const inside = path.join(workspaceDir("helper"), "deep/file.txt");
    const outside = path.join(dataDir, "agents", "helper", "AGENT.md");
    const res = await req("/api/fs/agent/helper/stat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths: [inside, outside] }),
    });
    const { results } = (await res.json()) as {
      results: Record<string, { relPath: string } | null>;
    };
    expect(results[inside]).toMatchObject({ relPath: "deep/file.txt" });
    expect(results[outside]).toBeNull();
  });

  it("caps the batch and rejects non-arrays", async () => {
    await createAgent();
    const tooMany = await req("/api/fs/agent/helper/stat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths: Array.from({ length: 65 }, (_, i) => `${i}`) }),
    });
    expect(tooMany.status).toBe(400);
    const notArray = await req("/api/fs/agent/helper/stat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths: "draft.md" }),
    });
    expect(notArray.status).toBe(400);
  });
});

describe("resources mutations", () => {
  it("uploads via multipart and returns the fresh tree", async () => {
    await createAgent();
    const form = new FormData();
    form.append(
      "guides/style.md",
      new File(["# style"], "style.md", { type: "text/markdown" })
    );
    const res = await req("/api/fs/agent/helper/resources/files", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as TreeBody;
    expect(body.files.map((f) => f.path)).toContain("guides/style.md");
    expect(body.writable).toBe(true);
  });

  it("deletes a resource file", async () => {
    await createAgent();
    const form = new FormData();
    form.append("tmp.md", new File(["x"], "tmp.md"));
    await req("/api/fs/agent/helper/resources/files", {
      method: "POST",
      body: form,
    });
    const del = await req("/api/fs/agent/helper/resources/file/tmp.md", {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    const tree = (await (
      await req("/api/fs/agent/helper/resources/tree")
    ).json()) as TreeBody;
    expect(tree.files).toHaveLength(0);
  });

  it("refuses writes on managed agents with 405", async () => {
    await createAgent();
    const def = manager.agentStore.get("helper")!;
    manager.agentStore.upsert({ ...def, managed: true });
    const form = new FormData();
    form.append("a.md", new File(["x"], "a.md"));
    const res = await req("/api/fs/agent/helper/resources/files", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(405);
  });
});
