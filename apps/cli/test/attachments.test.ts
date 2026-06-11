import { mkdtempSync, rmSync, writeFileSync, truncateSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  normalizeDroppedPath,
  loadAttachment,
  commitAttachmentForCli,
  looksLikeDroppedPath,
  extractAtPaths,
} from "../src/tui/attachments.js";
import type { PendingAttachment } from "../src/tui/state.js";

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const GIF_HEAD = Buffer.from("GIF89a______");
const WEBP_HEAD = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
const PDF_HEAD = Buffer.from("%PDF-1.4____");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "openacme-cli-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeTmp(name: string, content: Buffer | string): string {
  const p = path.join(dir, name);
  writeFileSync(p, content);
  return p;
}

describe("normalizeDroppedPath", () => {
  it("passes a plain path through", () => {
    expect(normalizeDroppedPath("/tmp/a.png")).toBe("/tmp/a.png");
  });

  it("strips outer single quotes", () => {
    expect(normalizeDroppedPath("'/tmp/My File.png'")).toBe("/tmp/My File.png");
  });

  it("strips outer double quotes", () => {
    expect(normalizeDroppedPath('"/tmp/My File.png"')).toBe("/tmp/My File.png");
  });

  it("unescapes backslash-escaped spaces", () => {
    expect(normalizeDroppedPath("/tmp/My\\ File.png")).toBe("/tmp/My File.png");
  });

  it("decodes file:// URLs", () => {
    expect(normalizeDroppedPath("file:///tmp/My%20File.png")).toBe("/tmp/My File.png");
  });

  it("expands ~ to the home directory", () => {
    expect(normalizeDroppedPath("~/a.png")).toBe(path.join(homedir(), "a.png"));
    expect(normalizeDroppedPath("~")).toBe(homedir());
  });

  it("does not expand ~user-style paths", () => {
    expect(normalizeDroppedPath("~other/a.png")).toBe("~other/a.png");
  });

  it("trims trailing control bytes and whitespace", () => {
    expect(normalizeDroppedPath("/tmp/a.png\x01\x02")).toBe("/tmp/a.png");
    expect(normalizeDroppedPath("  /tmp/a.png  ")).toBe("/tmp/a.png");
  });
});

describe("loadAttachment", () => {
  it("loads a PNG as an image attachment", () => {
    const p = writeTmp("pic.png", PNG_HEAD);
    const res = loadAttachment(p);
    expect(typeof res).not.toBe("string");
    const att = res as PendingAttachment;
    expect(att.mediaType).toBe("image/png");
    expect(att.kind).toBe("image");
    expect(att.filename).toBe("pic.png");
    expect(att.sourcePath).toBe(p);
    expect(att.size).toBe(PNG_HEAD.length);
  });

  it("sniffs JPEG, GIF, WebP by magic bytes", () => {
    expect((loadAttachment(writeTmp("a.jpg", JPEG_HEAD)) as PendingAttachment).mediaType).toBe("image/jpeg");
    expect((loadAttachment(writeTmp("a.gif", GIF_HEAD)) as PendingAttachment).mediaType).toBe("image/gif");
    expect((loadAttachment(writeTmp("a.webp", WEBP_HEAD)) as PendingAttachment).mediaType).toBe("image/webp");
  });

  it("loads a PDF as kind file", () => {
    const att = loadAttachment(writeTmp("doc.pdf", PDF_HEAD)) as PendingAttachment;
    expect(att.mediaType).toBe("application/pdf");
    expect(att.kind).toBe("file");
  });

  it("sniffs content, not extension", () => {
    const att = loadAttachment(writeTmp("misnamed.txt", PNG_HEAD)) as PendingAttachment;
    expect(att.mediaType).toBe("image/png");
  });

  it("rejects missing paths", () => {
    expect(loadAttachment(path.join(dir, "nope.png"))).toMatch(/not found/);
  });

  it("rejects directories", () => {
    expect(loadAttachment(dir)).toMatch(/not a file/);
  });

  it("rejects unsupported types", () => {
    const p = writeTmp("notes.txt", "just some text");
    expect(loadAttachment(p)).toMatch(/unsupported type/);
  });

  it("rejects files over the size cap", () => {
    const p = writeTmp("big.png", PNG_HEAD);
    // Sparse-extend past 5MB instead of writing real bytes.
    truncateSync(p, 5 * 1024 * 1024 + 1);
    expect(loadAttachment(p)).toMatch(/too large/);
  });

  it("normalizes the path before resolving", () => {
    const p = writeTmp("with space.png", PNG_HEAD);
    const res = loadAttachment(`'${p}'`);
    expect((res as PendingAttachment).sourcePath).toBe(p);
  });
});

describe("commitAttachmentForCli", () => {
  it("copies the file under the session dir and returns a matching FileUIPart", () => {
    const src = writeTmp("pic.png", PNG_HEAD);
    const root = path.join(dir, "attachments");
    const att = loadAttachment(src) as PendingAttachment;
    const part = commitAttachmentForCli(root, "sess-1", att);

    expect(part.type).toBe("file");
    expect(part.mediaType).toBe("image/png");
    expect(part.filename).toBe("pic.png");
    const m = part.url.match(/^\/api\/attachments\/sess-1\/(att_[0-9a-f-]+)\/pic\.png$/);
    expect(m).not.toBeNull();
    const onDisk = path.join(root, "sess-1", m![1]!, "pic.png");
    expect(existsSync(onDisk)).toBe(true);
    expect(readFileSync(onDisk).equals(PNG_HEAD)).toBe(true);
  });

  it("mints a distinct attachment id per commit", () => {
    const src = writeTmp("pic.png", PNG_HEAD);
    const root = path.join(dir, "attachments");
    const att = loadAttachment(src) as PendingAttachment;
    const a = commitAttachmentForCli(root, "s", att);
    const b = commitAttachmentForCli(root, "s", att);
    expect(a.url).not.toBe(b.url);
  });
});

describe("looksLikeDroppedPath", () => {
  it("accepts an existing file path", () => {
    const p = writeTmp("pic.png", PNG_HEAD);
    expect(looksLikeDroppedPath(p)).toBe(true);
  });

  it("accepts a quoted path with spaces", () => {
    const p = writeTmp("my pic.png", PNG_HEAD);
    expect(looksLikeDroppedPath(`'${p}'`)).toBe(true);
  });

  it("rejects directories, missing paths, empty and multi-line input", () => {
    expect(looksLikeDroppedPath(dir)).toBe(false);
    expect(looksLikeDroppedPath(path.join(dir, "missing.png"))).toBe(false);
    expect(looksLikeDroppedPath("")).toBe(false);
    expect(looksLikeDroppedPath("   ")).toBe(false);
    const p = writeTmp("pic.png", PNG_HEAD);
    expect(looksLikeDroppedPath(`${p}\nmore text`)).toBe(false);
  });
});

describe("extractAtPaths", () => {
  it("extracts a bare @path token", () => {
    expect(extractAtPaths("look at @src/a.ts please")).toEqual({
      cleaned: "look at please",
      paths: ["src/a.ts"],
    });
  });

  it("extracts double- and single-quoted paths with spaces", () => {
    expect(extractAtPaths('see @"my file.png"').paths).toEqual(["my file.png"]);
    expect(extractAtPaths("see @'my file.png'").paths).toEqual(["my file.png"]);
  });

  it("extracts multiple tokens in order", () => {
    const { cleaned, paths } = extractAtPaths("@a.png compare with @b.png done");
    expect(paths).toEqual(["a.png", "b.png"]);
    expect(cleaned).toBe("compare with done");
  });

  it("ignores emails — @ must follow whitespace or start", () => {
    const { cleaned, paths } = extractAtPaths("mail user@example.com now");
    expect(paths).toEqual([]);
    expect(cleaned).toBe("mail user@example.com now");
  });

  it("returns text unchanged when no tokens", () => {
    expect(extractAtPaths("plain text")).toEqual({ cleaned: "plain text", paths: [] });
  });

  it("collapses leftover double spaces", () => {
    expect(extractAtPaths("a @x.png b").cleaned).toBe("a b");
  });
});
