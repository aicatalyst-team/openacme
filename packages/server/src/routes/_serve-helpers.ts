import * as fs from "node:fs";
import { Readable } from "node:stream";
import type { Context } from "hono";

/** Map common extensions to media types so the browser renders bytes
 *  inline (image previews, PDF viewer). Falls back to
 *  application/octet-stream — browser treats the response as opaque
 *  download. Shared by /api/attachments (user uploads) and /api/files
 *  (agent-side binary content). */
export function mimeForExt(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "pdf": return "application/pdf";
    case "svg": return "image/svg+xml";
    case "txt": return "text/plain; charset=utf-8";
    case "json": return "application/json";
    default: return "application/octet-stream";
  }
}

export interface ServeFileOptions {
  /** Content-Type override; defaults to mimeForExt(filename). */
  mime?: string;
  /** Force `Content-Disposition: attachment`. */
  download?: boolean;
  /** Content-Security-Policy header value (e.g. "sandbox" for markup types). */
  csp?: string;
}

/** Parse a single-range `Range: bytes=...` header against a file size.
 *  Returns null for absent/malformed/multi-range (caller serves 200),
 *  "unsatisfiable" for a valid-but-out-of-bounds range (caller serves 416). */
function parseRange(
  header: string | undefined,
  size: number
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    // Suffix form: last N bytes.
    const n = Number(rawEnd);
    if (n === 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(rawStart);
  if (start >= size) return "unsatisfiable";
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return null;
  return { start, end };
}

/** Stream a file as the response body with the right Content-Type +
 *  RFC 5987 Content-Disposition (non-ASCII filenames need the
 *  filename*= form or Response throws on header bytes). 404s on
 *  ENOENT instead of pre-checking — avoids the existsSync TOCTOU.
 *  Honors single-range Range requests (206/416) so media seeking and
 *  partial text fetches work. */
export function serveFileWithRange(
  c: Context,
  abs: string,
  filename: string,
  opts?: ServeFileOptions
): Response {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
  if (!stat.isFile()) return c.json({ error: "Not a file" }, 404);

  const asciiName = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const disposition = opts?.download ? "attachment" : "inline";
  c.header("Content-Type", opts?.mime ?? mimeForExt(filename));
  c.header("Accept-Ranges", "bytes");
  c.header("X-Content-Type-Options", "nosniff");
  c.header(
    "Content-Disposition",
    `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  if (opts?.csp) c.header("Content-Security-Policy", opts.csp);

  const range = parseRange(c.req.header("range"), stat.size);
  if (range === "unsatisfiable") {
    c.header("Content-Range", `bytes */${stat.size}`);
    return c.body(null, 416);
  }
  if (range) {
    c.header("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
    c.header("Content-Length", String(range.end - range.start + 1));
    const nodeStream = fs.createReadStream(abs, { start: range.start, end: range.end });
    return c.body(Readable.toWeb(nodeStream) as ReadableStream, 206);
  }

  c.header("Content-Length", String(stat.size));
  const nodeStream = fs.createReadStream(abs);
  return c.body(Readable.toWeb(nodeStream) as ReadableStream);
}
