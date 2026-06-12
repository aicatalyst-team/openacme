/**
 * On-disk cache of stdio MCP discovery results, keyed by a hash of the
 * agent's effective stdio server config. Boot registers MCP tool
 * schemas from the cache without spawning the agent's worker — workers
 * then spawn lazily on the first worker-runtime tool call, restoring
 * the "N idle agents hold 0 workers" property.
 *
 * Schemas can drift under an unchanged config (e.g. an `npx`-latest
 * server updating), so callers should refresh discovery once after the
 * first real worker spawn. The cache is best-effort: any read/write
 * failure degrades to live discovery, never to an error.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { McpServerDiscovery } from "./protocol.js";

interface CacheFile {
  version: 1;
  configHash: string;
  discovery: McpServerDiscovery[];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashMcpConfig(stdioServers: Record<string, unknown>): string {
  return createHash("sha256")
    .update(stableStringify(stdioServers))
    .digest("hex");
}

function cachePath(cacheDir: string, agentId: string): string {
  return path.join(cacheDir, `${encodeURIComponent(agentId)}.json`);
}

export function loadMcpDiscoveryCache(
  cacheDir: string,
  agentId: string,
  configHash: string
): McpServerDiscovery[] | null {
  try {
    const raw = fs.readFileSync(cachePath(cacheDir, agentId), "utf-8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed.version !== 1) return null;
    if (parsed.configHash !== configHash) return null;
    if (!Array.isArray(parsed.discovery)) return null;
    return parsed.discovery;
  } catch {
    return null;
  }
}

export function saveMcpDiscoveryCache(
  cacheDir: string,
  agentId: string,
  configHash: string,
  discovery: McpServerDiscovery[]
): void {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const file = cachePath(cacheDir, agentId);
    const tmp = `${file}.tmp`;
    const payload: CacheFile = { version: 1, configHash, discovery };
    fs.writeFileSync(tmp, JSON.stringify(payload), "utf-8");
    fs.renameSync(tmp, file);
  } catch {
    // best-effort — next boot just does live discovery
  }
}

export function deleteMcpDiscoveryCache(
  cacheDir: string,
  agentId: string
): void {
  try {
    fs.unlinkSync(cachePath(cacheDir, agentId));
  } catch {
    // already gone
  }
}
