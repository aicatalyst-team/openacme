// mirrored (not imported) — TeamDefinition from @openacme/config
export interface Team {
  id: string;
  name: string;
  members: string[];
  archived?: boolean;
  charter: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  role?: string;
  avatar?: string;
}

export interface Draft {
  id: string;
  name: string;
  members: string[];
  charter: string;
}

export const EMPTY_DRAFT: Draft = { id: "", name: "", members: [], charter: "" };

// mirrored (not imported) — TEAM_CHARTER_CHAR_LIMIT in
// @openacme/agent-core prompt.ts: charters share this budget across all
// of an agent's teams; the overflow is truncated in member prompts.
export const TEAM_CHARTER_CHAR_LIMIT = 4000;

export type AgentLiveStatus = "waiting" | "running" | "idle";
