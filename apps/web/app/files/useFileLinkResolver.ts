import { useEffect, useMemo, useState } from "react";
import { statPaths } from "./api";
import type { FsRoot, FsStatHit } from "./types";

/** A confirmed file reference inside prose, ready to preview. */
export interface FileLinkTarget {
  root: FsRoot;
  relPath: string;
  size: number;
}

/** Whose roots candidate paths resolve against (see the /api/fs stat
 *  route): agent → workspace + resources + member-team workspaces;
 *  skill → its folder; team → its workspace. */
export interface FileLinkOwner {
  kind: "agent" | "team" | "skill";
  id: string;
}

/** A piece of prose to scan. `id` keys nothing server-side — it only
 *  keeps the array memo-friendly at call sites. */
export interface FileLinkSource {
  id: string;
  text: string;
}

const INLINE_CODE_RE = /`([^`\n]{2,256})`/g;
const STAT_CHUNK = 64;
const FLUSH_DELAY_MS = 300;

/** Cheap shape filter before asking the server. Misses just stay plain
 *  text, so this only needs to be conservative, not clever. */
function isPathish(s: string): boolean {
  if (/\s/.test(s)) return false;
  if (s.includes("://")) return false;
  if (s.endsWith("()")) return false;
  if (!s.includes("/") && !s.includes(".")) return false;
  if (s.startsWith("-")) return false;
  return true;
}

// Module-lifetime state, shared across surfaces: candidates resolve once
// per (owner, text) and survive component remounts. The queue + single
// timer keep streaming-driven effect re-runs from cancelling each
// other's fetches.
const resolved = new Map<string, FsStatHit | null>();
const queue = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function ownerKey(owner: FileLinkOwner): string {
  return `${owner.kind}:${owner.id}`;
}

// Space separator is safe: isPathish rejects whitespace and owner ids
// can't contain spaces.
function keyOf(owner: FileLinkOwner, candidate: string): string {
  return `${ownerKey(owner)} ${candidate}`;
}

function scheduleFlush(): void {
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

async function flush(): Promise<void> {
  const byOwner = new Map<string, string[]>();
  for (const key of queue) {
    const sep = key.indexOf(" ");
    const owner = key.slice(0, sep);
    const candidate = key.slice(sep + 1);
    const list = byOwner.get(owner) ?? [];
    list.push(candidate);
    byOwner.set(owner, list);
  }
  queue.clear();
  for (const [owner, candidates] of byOwner) {
    const sep = owner.indexOf(":");
    const kind = owner.slice(0, sep) as FileLinkOwner["kind"];
    const id = owner.slice(sep + 1);
    for (let i = 0; i < candidates.length; i += STAT_CHUNK) {
      const chunk = candidates.slice(i, i + STAT_CHUNK);
      try {
        const results = await statPaths({ kind, id }, chunk);
        for (const c of chunk) {
          resolved.set(`${owner} ${c}`, results[c] ?? null);
        }
      } catch {
        // Treat as misses; a failed stat shouldn't re-fire every render.
        for (const c of chunk) resolved.set(`${owner} ${c}`, null);
      }
    }
  }
  for (const l of listeners) l();
}

/**
 * Scans prose for inline-code spans that look like file paths,
 * batch-verifies them against the owner's roots via /api/fs stat, and
 * returns the confirmed hits keyed by the literal span text. Map
 * identity is stable between resolution arrivals, so memoized consumers
 * only re-render when links change.
 */
export function useFileLinkResolver(
  owner: FileLinkOwner | null,
  sources: ReadonlyArray<FileLinkSource>
): Map<string, FileLinkTarget> {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!owner) return;
    let enqueued = false;
    for (const source of sources) {
      for (const match of source.text.matchAll(INLINE_CODE_RE)) {
        const candidate = match[1]!;
        if (!isPathish(candidate)) continue;
        const key = keyOf(owner, candidate);
        if (resolved.has(key) || queue.has(key)) continue;
        queue.add(key);
        enqueued = true;
      }
    }
    if (enqueued) scheduleFlush();
  }, [owner, sources]);

  return useMemo(() => {
    const links = new Map<string, FileLinkTarget>();
    if (!owner) return links;
    const prefix = `${ownerKey(owner)} `;
    for (const [key, hit] of resolved) {
      if (!hit || !key.startsWith(prefix)) continue;
      links.set(key.slice(prefix.length), {
        root: { kind: hit.kind, id: hit.ownerId, scope: hit.scope },
        relPath: hit.relPath,
        size: hit.size,
      });
    }
    return links;
    // version is the change signal for the module-level `resolved` map;
    // owner identity is what call sites can keep stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner?.kind, owner?.id, version]);
}
