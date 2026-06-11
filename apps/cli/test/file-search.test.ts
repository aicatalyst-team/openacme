import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listProjectFiles,
  makeRanker,
  detectAtQuery,
  replaceAtToken,
  stripAtToken,
} from "../src/tui/file-search.js";

describe("detectAtQuery", () => {
  it("detects a trailing @token at start or after whitespace", () => {
    expect(detectAtQuery("@src/a")).toBe("src/a");
    expect(detectAtQuery("look at @src/a")).toBe("src/a");
    expect(detectAtQuery("@")).toBe("");
  });

  it("ignores emails and non-trailing tokens", () => {
    expect(detectAtQuery("user@example.com")).toBeNull();
    expect(detectAtQuery("@src/a done")).toBeNull();
    expect(detectAtQuery("plain text")).toBeNull();
  });
});

describe("replaceAtToken / stripAtToken", () => {
  it("replaces the trailing token and appends a space", () => {
    expect(replaceAtToken("see @src/a", "src/app.ts")).toBe("see @src/app.ts ");
    expect(replaceAtToken("@par", "package.json")).toBe("@package.json ");
  });

  it("strips the trailing token, preserving the whitespace boundary", () => {
    expect(stripAtToken("see @src/a")).toBe("see ");
    expect(stripAtToken("@src/a")).toBe("");
  });
});

describe("listProjectFiles + makeRanker", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "openacme-cli-"));
    for (const rel of [
      "README.md",
      ".env",
      "src/tui/App.tsx",
      "src/tui/state.ts",
      "docs/guide.md",
      "node_modules/dep/index.js",
      ".git/HEAD",
    ]) {
      const abs = path.join(root, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, "x");
    }
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists files including dotfiles but skips node_modules and .git", async () => {
    const files = await listProjectFiles(root);
    const rels = files.map((f) => path.relative(root, f)).sort();
    expect(rels).toEqual([".env", "README.md", "docs/guide.md", "src/tui/App.tsx", "src/tui/state.ts"]);
    expect(files.every((f) => path.isAbsolute(f))).toBe(true);
  });

  it("ranks fuzzy matches and returns absolute paths", async () => {
    const files = await listProjectFiles(root);
    const rank = makeRanker(files, root);
    const hits = rank("state").map((f) => path.relative(root, f));
    expect(hits).toContain("src/tui/state.ts");
    expect(hits).not.toContain("docs/guide.md");
  });

  it("treats a space in the query as AND of tokens (extendedMatch)", async () => {
    const files = await listProjectFiles(root);
    const rank = makeRanker(files, root);
    const hits = rank("tui App").map((f) => path.relative(root, f));
    expect(hits).toEqual(["src/tui/App.tsx"]);
  });

  it("returns the first N files for an empty query", async () => {
    const files = await listProjectFiles(root);
    const rank = makeRanker(files, root, 3);
    expect(rank("")).toEqual(files.slice(0, 3));
  });
});
