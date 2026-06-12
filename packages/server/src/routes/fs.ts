import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Context, Hono } from "hono";
import {
  MAX_RESOURCES_PER_AGENT,
  resolveContainedPath,
  type Config,
} from "@openacme/config";
import type { AgentManager } from "../agent-manager.js";
import { serveFileWithRange } from "./_serve-helpers.js";

/**
 * `/api/fs` — scoped file access for the web's file browser + preview.
 * Three roots, addressed as `/:kind/:ownerId/:scope`:
 *
 *   agent/<id>/workspace   read-only   <agentsDir>/<id>/workspace/
 *   agent/<id>/resources   writable    <agentsDir>/<id>/resources/
 *   team/<id>/workspace    read-only   <teamsDir>/<id>/workspace/
 *   skill/<name>/files     read-only   <skillsDir>/<name>/
 *
 * Distinct from `/api/files` (per-session tool-call bytes) and
 * `/api/attachments` (user uploads) — those are message-addressed;
 * this is the browsable view of an agent's or team's disk.
 *
 * Dotfiles are deliberately visible (agents write .env / .gitignore
 * into workspaces); `.git` and dependency dirs are not.
 */

const MAX_FS_ENTRIES = 5000;
const MAX_FS_DEPTH = 12;
const EXCLUDED_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv"]);

const MAX_STAT_PATHS = 64;
const MAX_RESOURCE_FILE_BYTES = 1 * 1024 * 1024;
const MAX_RESOURCE_REQUEST_BYTES = 10 * 1024 * 1024;

interface FsEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

interface FsRootRef {
  rootDir: string;
  writable: boolean;
  /** Root-level filenames omitted from the tree listing (still servable). */
  excludeRootFiles?: ReadonlySet<string>;
}

// The SKILL.md body is surfaced directly on the skill detail page; the
// Files view is for the folder's other contents.
const SKILL_ROOT_EXCLUDES = new Set(["SKILL.md"]);

/** Validate (kind, ownerId, scope) and resolve the on-disk root.
 *  Null means "no such root" — unknown owner or invalid pair. */
function resolveFsRoot(
  manager: AgentManager,
  skillsDir: string,
  kind: string,
  ownerId: string,
  scope: string
): FsRootRef | null {
  if (kind === "agent") {
    const def = manager.agentStore.get(ownerId);
    const dir = manager.agentStore.agentDir(ownerId);
    if (!def || !dir) return null;
    if (scope === "workspace") {
      return { rootDir: path.join(dir, "workspace"), writable: false };
    }
    if (scope === "resources") {
      return { rootDir: path.join(dir, "resources"), writable: !def.managed };
    }
    return null;
  }
  if (kind === "team" && scope === "workspace") {
    const def = manager.teamStore.get(ownerId);
    const dir = manager.teamStore.workspaceDir(ownerId);
    if (!def || !dir) return null;
    return { rootDir: dir, writable: false };
  }
  if (kind === "skill" && scope === "files") {
    // The skill name is a single dir segment under skillsDir; `_hub`
    // is the hub's own state, never a skill.
    if (ownerId.includes("/") || ownerId === "_hub") return null;
    const dir = resolveContainedPath(skillsDir, ownerId);
    if (!dir) return null;
    try {
      if (!fs.statSync(dir).isDirectory()) return null;
    } catch {
      return null;
    }
    return {
      rootDir: dir,
      writable: false,
      excludeRootFiles: SKILL_ROOT_EXCLUDES,
    };
  }
  return null;
}

/** Resolve a relPath inside a root with dotfiles admitted but `.git`
 *  (and traversal, per resolveContainedPath) rejected. Lowercased compare —
 *  APFS is case-insensitive, so `.GIT` would otherwise serve `.git`. */
function resolveFsPath(rootDir: string, relPath: string): string | null {
  const segments = relPath.replace(/\\/g, "/").split("/");
  if (segments.some((s) => s.toLowerCase() === ".git")) return null;
  return resolveContainedPath(rootDir, relPath, { allowDotSegments: true });
}

/** Realpath containment — symlinks inside a root must not reach outside it.
 *  Null means the file doesn't exist or its target escapes the root. */
function realContainedPath(rootDir: string, abs: string): string | null {
  let real: string;
  let realRoot: string;
  try {
    real = fs.realpathSync(abs);
    realRoot = fs.realpathSync(rootDir);
  } catch {
    return null;
  }
  if (!(real === realRoot || real.startsWith(realRoot + path.sep))) return null;
  return real;
}

/** Recursive listing. Files only — directories are derived client-side.
 *  Symlinks are skipped (Dirent.isFile/isDirectory are false for them
 *  with withFileTypes), so a link pointing outside the root never even
 *  appears; the bytes endpoint backstops with a realpath check. */
function walkTree(
  rootDir: string,
  opts?: { excludeRootFiles?: ReadonlySet<string> }
): { files: FsEntry[]; truncated: boolean } {
  const files: FsEntry[] = [];
  let truncated = false;

  const walk = (dir: string, rel: string, depth: number): void => {
    if (files.length >= MAX_FS_ENTRIES) {
      truncated = true;
      return;
    }
    if (depth > MAX_FS_DEPTH) {
      truncated = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_FS_ENTRIES) {
        truncated = true;
        return;
      }
      if (EXCLUDED_DIRS.has(entry.name.toLowerCase())) continue;
      if (rel === "" && opts?.excludeRootFiles?.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, relPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      files.push({ path: relPath, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  };

  walk(rootDir, "", 0);
  return { files, truncated };
}

function treeResponse(c: Context, root: FsRootRef) {
  const { files, truncated } = walkTree(root.rootDir, {
    excludeRootFiles: root.excludeRootFiles,
  });
  return c.json({ files, truncated, writable: root.writable });
}

/**
 * Extension → Content-Type for serving. Code/text extensions all map to
 * text/plain so the preview can fetch them as text; markup types keep
 * their real mime but are served with `CSP: sandbox` (see below).
 */
const EXT_MIME: Record<string, string> = {
  // markup — served with CSP sandbox
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".xhtml": "application/xhtml+xml",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  // structured text
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/json; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  // images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  // av
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  // documents
  ".pdf": "application/pdf",
};

/** Everything code-shaped serves as text/plain; the client highlights. */
const TEXT_EXTS = new Set([
  ".txt", ".log", ".env", ".ini", ".toml", ".conf", ".cfg", ".properties",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".d.ts",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h",
  ".cpp", ".hpp", ".cc", ".cs", ".php", ".scala", ".lua", ".r",
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat",
  ".sql", ".graphql", ".proto", ".scss", ".less", ".vue", ".svelte",
  ".tex", ".rst", ".adoc", ".diff", ".patch", ".lock", ".gitignore",
  ".dockerignore", ".editorconfig",
]);

const SANDBOXED_MIMES = new Set([
  "text/html; charset=utf-8",
  "application/xhtml+xml",
  "application/xml; charset=utf-8",
  "image/svg+xml",
]);

/** Content-Type + CSP for a path. Unknown extensions sniff the first
 *  512 bytes: NUL-free → text, else opaque binary. */
function servePolicy(abs: string): { mime: string; csp?: string } {
  const base = path.basename(abs);
  const ext = path.extname(base).toLowerCase();
  const mapped = EXT_MIME[ext];
  if (mapped) {
    return SANDBOXED_MIMES.has(mapped)
      ? { mime: mapped, csp: "sandbox" }
      : { mime: mapped };
  }
  if (TEXT_EXTS.has(ext) || (base.startsWith(".") && ext === "")) {
    // Dotfiles with no extension (.env, .gitignore) are config text.
    return { mime: "text/plain; charset=utf-8" };
  }
  try {
    const fd = fs.openSync(abs, "r");
    try {
      const buf = Buffer.alloc(512);
      const n = fs.readSync(fd, buf, 0, 512, 0);
      if (!buf.subarray(0, n).includes(0)) {
        return { mime: "text/plain; charset=utf-8" };
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // unreadable → opaque
  }
  return { mime: "application/octet-stream" };
}

/** Hono's `*` capture is unreliable for nested paths; slice the raw
 *  request path past the literal prefix instead (same idiom as the
 *  attachments route). */
function relPathFromWildcard(c: Context, prefix: string): string | null {
  const fullPath = c.req.path;
  if (!fullPath.startsWith(prefix)) return null;
  const rel = decodeURIComponent(fullPath.slice(prefix.length));
  return rel.length > 0 ? rel : null;
}

export function registerFsRoutes(
  app: Hono,
  manager: AgentManager,
  config: Config
): void {
  const skillsDir = path.isAbsolute(config.skills.directory)
    ? config.skills.directory
    : path.join(config.dataDir, config.skills.directory);

  app.get("/api/fs/:kind/:ownerId/:scope/tree", (c) => {
    const root = resolveFsRoot(
      manager,
      skillsDir,
      c.req.param("kind"),
      c.req.param("ownerId"),
      c.req.param("scope")
    );
    if (!root) return c.json({ error: "Unknown root" }, 404);
    return treeResponse(c, root);
  });

  app.get("/api/fs/:kind/:ownerId/:scope/file/*", (c) => {
    const kind = c.req.param("kind");
    const ownerId = c.req.param("ownerId");
    const scope = c.req.param("scope");
    const root = resolveFsRoot(manager, skillsDir, kind, ownerId, scope);
    if (!root) return c.json({ error: "Unknown root" }, 404);

    const relPath = relPathFromWildcard(
      c,
      `/api/fs/${kind}/${ownerId}/${scope}/file/`
    );
    if (!relPath) return c.json({ error: "Missing path" }, 400);
    const abs = resolveFsPath(root.rootDir, relPath);
    if (!abs) return c.json({ error: "Invalid path" }, 400);

    // The walk never lists symlinks, but the path is caller-supplied —
    // realpath both sides so a link inside the root can't read outside it.
    const real = realContainedPath(root.rootDir, abs);
    if (!real) return c.json({ error: "Not found" }, 404);

    const policy = servePolicy(real);
    return serveFileWithRange(c, real, path.basename(relPath), {
      mime: policy.mime,
      csp: policy.csp,
      download: c.req.query("download") === "1",
    });
  });

  // Batch existence check for the file-path linkifier. The owner decides
  // which roots are searched: an agent resolves against its workspace +
  // resources + member-team workspaces (chat prose); a skill against its
  // own folder (SKILL.md bodies reference sibling files); a team against
  // its workspace (charters). Inputs come from model/author prose, so
  // they arrive in every shape paths get written: bare-relative,
  // scope-prefixed, ./-prefixed, ~-expanded, absolute, :line(:col)-suffixed.
  app.post("/api/fs/:kind/:ownerId/stat", async (c) => {
    const kind = c.req.param("kind");
    const ownerId = c.req.param("ownerId");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Expected JSON body" }, 400);
    }
    const paths = (body as { paths?: unknown })?.paths;
    if (
      !Array.isArray(paths) ||
      paths.length === 0 ||
      paths.length > MAX_STAT_PATHS ||
      !paths.every((p): p is string => typeof p === "string")
    ) {
      return c.json(
        { error: `Expected paths: string[] (1-${MAX_STAT_PATHS})` },
        400
      );
    }

    interface SearchRoot {
      kind: "agent" | "team" | "skill";
      ownerId: string;
      scope: "workspace" | "resources" | "files";
      rootDir: string;
      stripPrefixes: string[];
    }
    const searchRoots: SearchRoot[] = [];
    if (kind === "agent") {
      const agentDir = manager.agentStore.get(ownerId)
        ? manager.agentStore.agentDir(ownerId)
        : null;
      if (!agentDir) return c.json({ error: "Agent not found" }, 404);
      searchRoots.push(
        {
          kind: "agent",
          ownerId,
          scope: "workspace",
          rootDir: path.join(agentDir, "workspace"),
          stripPrefixes: ["workspace/"],
        },
        {
          kind: "agent",
          ownerId,
          scope: "resources",
          rootDir: path.join(agentDir, "resources"),
          stripPrefixes: ["resources/"],
        }
      );
      for (const team of manager.teamStore.teamsFor(ownerId)) {
        const rootDir = manager.teamStore.workspaceDir(team.id);
        if (!rootDir) continue;
        searchRoots.push({
          kind: "team",
          ownerId: team.id,
          scope: "workspace",
          rootDir,
          stripPrefixes: [
            "workspace/",
            `${team.id}/workspace/`,
            `teams/${team.id}/workspace/`,
          ],
        });
      }
    } else if (kind === "team" || kind === "skill") {
      const scope = kind === "team" ? "workspace" : "files";
      const root = resolveFsRoot(manager, skillsDir, kind, ownerId, scope);
      if (!root) return c.json({ error: "Unknown root" }, 404);
      searchRoots.push({
        kind,
        ownerId,
        scope,
        rootDir: root.rootDir,
        stripPrefixes:
          kind === "team"
            ? [
                "workspace/",
                `${ownerId}/workspace/`,
                `teams/${ownerId}/workspace/`,
              ]
            : [`${ownerId}/`, `skills/${ownerId}/`],
      });
    } else {
      return c.json({ error: "Unknown root" }, 404);
    }

    const normalize = (input: string): string => {
      // "src/app.ts:42" / ":42:7" → the file; agents cite locations.
      let s = input.trim().replace(/:\d+(?::\d+)?$/, "");
      if (s.startsWith("~/")) s = path.join(os.homedir(), s.slice(2));
      while (s.startsWith("./")) s = s.slice(2);
      return s;
    };

    const results: Record<
      string,
      | {
          kind: "agent" | "team" | "skill";
          ownerId: string;
          scope: string;
          relPath: string;
          size: number;
        }
      | null
    > = {};
    for (const input of paths) {
      results[input] = null;
      const norm = normalize(input);
      if (norm.length === 0) continue;
      outer: for (const root of searchRoots) {
        const candidates: string[] = [];
        if (norm.startsWith("/")) {
          const resolvedRoot = path.resolve(root.rootDir);
          const resolvedInput = path.resolve(norm);
          if (!resolvedInput.startsWith(resolvedRoot + path.sep)) continue;
          candidates.push(
            path
              .relative(resolvedRoot, resolvedInput)
              .split(path.sep)
              .join("/")
          );
        } else {
          candidates.push(norm);
          for (const prefix of root.stripPrefixes) {
            if (norm.startsWith(prefix)) {
              candidates.push(norm.slice(prefix.length));
            }
          }
        }
        for (const relPath of candidates) {
          const abs = resolveFsPath(root.rootDir, relPath);
          if (!abs) continue;
          // Same realpath gate as the bytes endpoint — a planted symlink
          // must not leak even the existence/size of out-of-root files.
          const real = realContainedPath(root.rootDir, abs);
          if (!real) continue;
          let stat: fs.Stats;
          try {
            stat = fs.statSync(real);
          } catch {
            continue;
          }
          if (!stat.isFile()) continue;
          results[input] = {
            kind: root.kind,
            ownerId: root.ownerId,
            scope: root.scope,
            relPath,
            size: stat.size,
          };
          break outer;
        }
      }
    }
    return c.json({ results });
  });

  // Mutations exist only for the agent resources root. Multipart with
  // field names = POSIX relPaths (same convention as /api/skills/import);
  // the whole batch validates before any write.
  app.post("/api/fs/agent/:ownerId/resources/files", async (c) => {
    const ownerId = c.req.param("ownerId");
    const root = resolveFsRoot(manager, skillsDir, "agent", ownerId, "resources");
    if (!root) return c.json({ error: "Unknown root" }, 404);
    if (!root.writable) {
      return c.json(
        { error: `Agent '${ownerId}' is platform-managed; resources are owned by the bundled template.` },
        405
      );
    }

    let form: Record<string, string | File | (string | File)[]>;
    try {
      form = await c.req.parseBody({ all: true });
    } catch {
      return c.json({ error: "Expected multipart/form-data" }, 400);
    }

    const entries: { relPath: string; file: File }[] = [];
    for (const [rawKey, raw] of Object.entries(form)) {
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) {
        if (!(value instanceof File)) continue;
        entries.push({ relPath: rawKey || value.name, file: value });
      }
    }
    if (entries.length === 0) {
      return c.json({ error: "No files in upload" }, 400);
    }

    const existing = manager.agentStore.listResources(ownerId);
    if (existing.length + entries.length > MAX_RESOURCES_PER_AGENT) {
      return c.json(
        {
          error: `Adding ${entries.length} would exceed the ${MAX_RESOURCES_PER_AGENT}-file cap (currently ${existing.length}).`,
        },
        400
      );
    }

    let totalBytes = 0;
    for (const e of entries) {
      if (e.file.size > MAX_RESOURCE_FILE_BYTES) {
        return c.json(
          { error: `File '${e.relPath}' exceeds ${MAX_RESOURCE_FILE_BYTES} bytes` },
          413
        );
      }
      totalBytes += e.file.size;
      if (totalBytes > MAX_RESOURCE_REQUEST_BYTES) {
        return c.json(
          { error: `Upload exceeds ${MAX_RESOURCE_REQUEST_BYTES} bytes` },
          413
        );
      }
      if (!manager.agentStore.resourceAbsPath(ownerId, e.relPath)) {
        return c.json({ error: `Invalid path: ${e.relPath}` }, 400);
      }
    }

    for (const e of entries) {
      const bytes = Buffer.from(await e.file.arrayBuffer());
      try {
        manager.agentStore.writeResource(ownerId, e.relPath, bytes);
      } catch (err) {
        return c.json(
          {
            error: `Failed to write '${e.relPath}': ${err instanceof Error ? err.message : String(err)}`,
          },
          500
        );
      }
    }

    // The prompt's resource listing must refresh on next turn.
    manager.evictAgent(ownerId);
    const { files, truncated } = walkTree(root.rootDir);
    return c.json({ files, truncated, writable: root.writable }, 201);
  });

  app.delete("/api/fs/agent/:ownerId/resources/file/*", (c) => {
    const ownerId = c.req.param("ownerId");
    const root = resolveFsRoot(manager, skillsDir, "agent", ownerId, "resources");
    if (!root) return c.json({ error: "Unknown root" }, 404);
    if (!root.writable) {
      return c.json(
        { error: `Agent '${ownerId}' is platform-managed; resources are owned by the bundled template.` },
        405
      );
    }
    const relPath = relPathFromWildcard(
      c,
      `/api/fs/agent/${ownerId}/resources/file/`
    );
    if (!relPath) return c.json({ error: "Missing path" }, 400);
    if (!manager.agentStore.resourceAbsPath(ownerId, relPath)) {
      return c.json({ error: "Invalid path" }, 400);
    }
    const ok = manager.agentStore.deleteResource(ownerId, relPath);
    if (!ok) return c.json({ error: "Not found" }, 404);
    manager.evictAgent(ownerId);
    return c.json({ success: true });
  });
}
