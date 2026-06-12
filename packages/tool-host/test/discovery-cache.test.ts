import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  hashMcpConfig,
  loadMcpDiscoveryCache,
  saveMcpDiscoveryCache,
  deleteMcpDiscoveryCache,
} from "../src/discovery-cache.js";
import type { McpServerDiscovery } from "../src/protocol.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "openacme-mcp-cache-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const DISCOVERY: McpServerDiscovery[] = [
  {
    server: "fs",
    state: "connected",
    connected: true,
    tools: [
      {
        name: "read",
        description: "Read a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
      },
    ],
  },
];

describe("hashMcpConfig", () => {
  it("is stable across key order", () => {
    expect(hashMcpConfig({ a: { command: "x", args: ["1"] }, b: { command: "y" } })).toBe(
      hashMcpConfig({ b: { command: "y" }, a: { args: ["1"], command: "x" } })
    );
  });

  it("changes when the config changes", () => {
    expect(hashMcpConfig({ a: { command: "x" } })).not.toBe(
      hashMcpConfig({ a: { command: "x", args: ["--flag"] } })
    );
  });
});

describe("discovery cache round-trip", () => {
  const hash = hashMcpConfig({ fs: { command: "mcp-fs" } });

  it("returns what was saved for a matching hash", () => {
    saveMcpDiscoveryCache(dir, "agent-1", hash, DISCOVERY);
    expect(loadMcpDiscoveryCache(dir, "agent-1", hash)).toEqual(DISCOVERY);
  });

  it("misses on a different hash, missing file, or corrupt file", () => {
    expect(loadMcpDiscoveryCache(dir, "agent-1", hash)).toBeNull();
    saveMcpDiscoveryCache(dir, "agent-1", hash, DISCOVERY);
    expect(loadMcpDiscoveryCache(dir, "agent-1", "other-hash")).toBeNull();
    fs.writeFileSync(path.join(dir, "agent-1.json"), "{not json");
    expect(loadMcpDiscoveryCache(dir, "agent-1", hash)).toBeNull();
  });

  it("delete removes the entry; deleting a missing entry is a no-op", () => {
    saveMcpDiscoveryCache(dir, "agent-1", hash, DISCOVERY);
    deleteMcpDiscoveryCache(dir, "agent-1");
    expect(loadMcpDiscoveryCache(dir, "agent-1", hash)).toBeNull();
    deleteMcpDiscoveryCache(dir, "agent-1");
  });

  it("agent ids are filename-encoded (no path traversal)", () => {
    saveMcpDiscoveryCache(dir, "../evil", hash, DISCOVERY);
    expect(fs.existsSync(path.join(path.dirname(dir), "evil.json"))).toBe(false);
    expect(loadMcpDiscoveryCache(dir, "../evil", hash)).toEqual(DISCOVERY);
  });
});
