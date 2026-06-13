import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "../src/registry.js";
import {
  bindSkillAuthor,
  SKILL_AUTHOR_TOOLS,
  type SkillAuthorBindings,
} from "../src/builtins/skill-author.js";

interface ToolResult {
  success?: boolean;
  name?: string;
  error?: string;
}

async function run(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const tool = registry.get(toolName);
  if (!tool) throw new Error(`${toolName} not registered`);
  const parsed = tool.parameters.parse(args);
  return JSON.parse(await tool.handler(parsed as Record<string, unknown>));
}

const VALID = {
  name: "weekly-report-format",
  description: "How to format the weekly report",
  tags: ["reporting"],
  body: "# Weekly report\n\nLead with outcomes.",
};

describe("skill_create / skill_edit", () => {
  let saved: Array<{ name: string; description: string }>;
  let existing: Set<string>;
  let hubManaged: Set<string>;

  beforeEach(() => {
    saved = [];
    existing = new Set();
    hubManaged = new Set();
    const bindings: SkillAuthorBindings = {
      exists: (name) => existing.has(name),
      isHubManaged: (name) => hubManaged.has(name),
      save: (name, description) => {
        saved.push({ name, description });
        return { name };
      },
    };
    bindSkillAuthor(bindings);
  });

  it("registers both tools", () => {
    for (const name of SKILL_AUTHOR_TOOLS) {
      expect(registry.get(name)).toBeDefined();
    }
  });

  it("creates a new skill", async () => {
    const res = await run("skill_create", VALID);
    expect(res.success).toBe(true);
    expect(res.name).toBe(VALID.name);
    expect(saved).toHaveLength(1);
  });

  it("refuses to create over an existing skill", async () => {
    existing.add(VALID.name);
    const res = await run("skill_create", VALID);
    expect(res.error).toMatch(/already exists/);
    expect(saved).toHaveLength(0);
  });

  it("rejects non-kebab-case names at the schema boundary", () => {
    const tool = registry.get("skill_create")!;
    for (const bad of ["My Skill", "_hub", "UPPER", "a--b", "-lead"]) {
      expect(() => tool.parameters.parse({ ...VALID, name: bad })).toThrow();
    }
  });

  it("edits an existing locally-authored skill", async () => {
    existing.add(VALID.name);
    const res = await run("skill_edit", VALID);
    expect(res.success).toBe(true);
    expect(saved).toHaveLength(1);
  });

  it("refuses to edit a missing skill", async () => {
    const res = await run("skill_edit", VALID);
    expect(res.error).toMatch(/not found/);
    expect(saved).toHaveLength(0);
  });

  it("refuses to edit a hub-managed skill", async () => {
    existing.add(VALID.name);
    hubManaged.add(VALID.name);
    const res = await run("skill_edit", VALID);
    expect(res.error).toMatch(/hub-managed/);
    expect(saved).toHaveLength(0);
  });
});
