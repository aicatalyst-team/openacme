import { z } from "zod";
import { registry } from "../registry.js";

/**
 * Skill authoring — the write-side counterpart to `skill_view`. Lets an
 * agent promote a proven, recurring lesson into a reusable skill. Not in
 * SYSTEM_TOOLS: AgentManager merges these into the effective tool set
 * only when `skills.autoGenerate` is on, so the prompt guidance and the
 * callable surface gate together.
 */

export interface SkillAuthorBindings {
  exists: (name: string) => boolean;
  /** True when the skill is hub-managed (tracked in the hub lockfile). */
  isHubManaged: (name: string) => boolean;
  save: (
    name: string,
    description: string,
    tags: string[],
    body: string
  ) => { name: string };
}

let bindings: SkillAuthorBindings | null = null;

export function bindSkillAuthor(b: SkillAuthorBindings): void {
  bindings = b;
}

export const SKILL_AUTHOR_TOOLS = ["skill_create", "skill_edit"] as const;

const NOT_BOUND = JSON.stringify({
  error:
    "skill authoring not initialized — AgentManager must call bindSkillAuthor().",
});

// Kebab-case keeps the name identical to its sanitized folder form, so
// existence checks and the saved identity can't diverge.
const SkillName = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "must be kebab-case: lowercase letters, digits, single hyphens"
  )
  .describe("Kebab-case skill name, e.g. `weekly-report-format`.");

registry.register({
  name: "skill_create",
  toolset: "skills",
  description:
    "Author a new skill — a reusable SKILL.md procedure available to you in " +
    "future sessions via the skills index. Use this to promote a lesson that " +
    "has proven out repeatedly (saved in memory, confirmed across activations) " +
    "into a durable procedure. The body is markdown: when to apply the skill, " +
    "the steps, and the pitfalls it exists to avoid. Fails if the name is " +
    "already taken — use skill_edit to revise an existing skill.",
  parameters: z.object({
    name: SkillName,
    description: z
      .string()
      .min(1)
      .max(500)
      .describe(
        "One-line summary shown in the skills index — used to decide when the skill applies, so be specific."
      ),
    tags: z.array(z.string()).default([]),
    body: z.string().min(1).describe("Full SKILL.md markdown body."),
  }),
  emoji: "✍️",
  parallelSafe: false,
  handler: async (args) => {
    const { name, description, tags, body } = args as {
      name: string;
      description: string;
      tags: string[];
      body: string;
    };
    if (!bindings) return NOT_BOUND;
    if (bindings.exists(name)) {
      return JSON.stringify({
        error: `Skill already exists: ${name}. Use skill_edit to revise it.`,
      });
    }
    const saved = bindings.save(name, description, tags, body);
    return JSON.stringify({
      success: true,
      name: saved.name,
      note: "Skill saved. It appears in the skills index of new sessions; this session's index is a snapshot from session start.",
    });
  },
});

registry.register({
  name: "skill_edit",
  toolset: "skills",
  description:
    "Revise an existing skill's description, tags, or body (full replacement " +
    "per field; omitted fields require re-sending — call skill_view first and " +
    "carry over what should stay). Only locally-authored skills are editable; " +
    "hub-installed skills are managed by their source and will refuse.",
  parameters: z.object({
    name: SkillName,
    description: z.string().min(1).max(500),
    tags: z.array(z.string()).default([]),
    body: z.string().min(1),
  }),
  emoji: "✍️",
  parallelSafe: false,
  handler: async (args) => {
    const { name, description, tags, body } = args as {
      name: string;
      description: string;
      tags: string[];
      body: string;
    };
    if (!bindings) return NOT_BOUND;
    if (!bindings.exists(name)) {
      return JSON.stringify({
        error: `Skill not found: ${name}. Use skill_create for a new skill.`,
      });
    }
    if (bindings.isHubManaged(name)) {
      return JSON.stringify({
        error: `Skill is hub-managed: ${name}. It updates from its install source; edits here would be clobbered. Author a new skill under a different name instead.`,
      });
    }
    const saved = bindings.save(name, description, tags, body);
    return JSON.stringify({
      success: true,
      name: saved.name,
      note: "Skill updated. New sessions see the revised version; this session's index is a snapshot from session start.",
    });
  },
});
