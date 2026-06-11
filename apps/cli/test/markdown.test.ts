import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/tui/markdown.js";

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("renderMarkdown", () => {
  it("renders plain text and strips trailing newlines", () => {
    const out = renderMarkdown("hello world");
    expect(stripAnsi(out)).toContain("hello world");
    expect(out.endsWith("\n")).toBe(false);
  });

  it("styles bold without leaking literal markers", () => {
    const out = stripAnsi(renderMarkdown("some **bold** text"));
    expect(out).toContain("bold");
    expect(out).not.toContain("**");
  });

  it("styles inline emphasis inside list items (marked-terminal recursion fix)", () => {
    const out = stripAnsi(renderMarkdown("- **bold** item\n- _italic_ item"));
    expect(out).toContain("bold item");
    expect(out).not.toContain("**");
    expect(out).not.toContain("_italic_");
  });

  it("keeps code block content intact", () => {
    const out = stripAnsi(renderMarkdown("```ts\nconst x = 1;\n```"));
    expect(out).toContain("const x = 1;");
  });
});
