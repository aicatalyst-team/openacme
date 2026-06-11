import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { useHomeStream } from "../lib/useHomeStream";
import { AgentAvatar } from "@/app/components/ui/agent-avatar";
import { AgentRef } from "@/app/components/ui/agent-ref";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/app/components/ui/popover";
import { cn } from "@/app/lib/utils";
import { formatRelativeFromUnix } from "../tasks/types";
import { putTeam } from "./api";
import type { AgentInfo, AgentLiveStatus, Team } from "./types";

const STATUS_DOT: Record<AgentLiveStatus, string> = {
  waiting: "bg-plot-red pulse-live",
  running: "bg-signal-blue",
  idle: "bg-ink-faint",
};

const STATUS_TEXT: Record<AgentLiveStatus, string> = {
  waiting: "text-plot-red",
  running: "text-signal-blue",
  idle: "text-ink-soft",
};

function AddMemberPicker({
  candidates,
  onAdd,
}: {
  candidates: AgentInfo[];
  onAdd: (agentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? candidates.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q) ||
          (a.role ?? "").toLowerCase().includes(q)
      )
    : candidates;

  return (
    <Popover onOpenChange={(open) => !open && setQuery("")}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-fit">
          <Plus className="size-4" /> Add member
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="border-b border-paper-rule p-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents…"
            autoFocus
            className="h-8"
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-3 text-sm text-ink-faint">
              No matching agents.
            </p>
          ) : (
            filtered.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => onAdd(agent.id)}
                className="flex w-full items-center gap-2 border-b border-paper-rule/40 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-paper-sunk"
              >
                <AgentAvatar avatar={agent.avatar} size="md" />
                <span className="shrink-0 text-sm font-medium text-ink">
                  {agent.name}
                </span>
                {agent.role && (
                  <span className="truncate text-xs text-ink-faint">
                    {agent.role}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface AgentWork {
  status: AgentLiveStatus;
  /** Task title from the session driving the status, if any. */
  currentTaskTitle: string | null;
  /** Non-terminal tasks bound to this agent's sessions. */
  pending: number;
  /** Most recent activity across the agent's sessions (unix-seconds). */
  lastActivity: number;
  pingMessage?: string;
}

export function TeamMembersTab({
  team,
  agents,
  onChanged,
}: {
  team: Team;
  agents: AgentInfo[];
  onChanged: () => void;
}) {
  const { payload, loading } = useHomeStream();

  // Per-agent rollup across the agent's sessions; waiting > running > idle.
  const workByAgent = useMemo(() => {
    const m = new Map<string, AgentWork>();
    if (!payload) return m;
    const buckets: Array<[AgentLiveStatus, typeof payload.idle]> = [
      ["idle", payload.idle],
      ["running", payload.running],
      ["waiting", payload.waiting],
    ];
    for (const [status, sessions] of buckets) {
      for (const s of sessions) {
        const prev = m.get(s.agentId);
        m.set(s.agentId, {
          status,
          currentTaskTitle: s.currentTaskTitle ?? prev?.currentTaskTitle ?? null,
          pending: (prev?.pending ?? 0) + s.pendingTaskCount,
          lastActivity: Math.max(prev?.lastActivity ?? 0, s.lastActivity),
          pingMessage: s.pingMessage ?? prev?.pingMessage,
        });
      }
    }
    return m;
  }, [payload]);

  const agentById = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents]
  );
  const nonMembers = agents.filter((a) => !team.members.includes(a.id));

  async function addMember(agentId: string) {
    if (await putTeam(team.id, { members: [...team.members, agentId] })) {
      onChanged();
    }
  }

  async function removeMember(agentId: string) {
    const next = team.members.filter((m) => m !== agentId);
    if (await putTeam(team.id, { members: next })) {
      onChanged();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {team.members.length === 0 ? (
        <p className="border border-dashed border-paper-rule px-4 py-4 text-sm text-ink-faint">
          No members yet. Add agents below — each member gets the team charter
          in its context and read-write access to the team workspace.
        </p>
      ) : (
        <div className="flex flex-col border border-paper-rule">
          {team.members.map((memberId) => {
            const agent = agentById.get(memberId);
            const work = agent ? workByAgent.get(memberId) : undefined;
            const status: AgentLiveStatus | null = agent
              ? (work?.status ?? "idle")
              : null;
            const metaParts: string[] = [];
            if (work?.pending) {
              metaParts.push(
                `${work.pending} pending task${work.pending === 1 ? "" : "s"}`
              );
            }
            if (work?.lastActivity) {
              metaParts.push(`active ${formatRelativeFromUnix(work.lastActivity)}`);
            }
            return (
              <div
                key={memberId}
                className="group flex items-start gap-3 border-b border-paper-rule/40 px-4 py-3 last:border-b-0"
              >
                <AgentAvatar
                  avatar={agent?.avatar}
                  size="lg"
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <AgentRef
                    id={memberId}
                    label={agent?.name}
                    className="text-sm font-medium text-ink"
                  />
                  {agent?.role && (
                    <div className="truncate text-sm text-ink-soft">
                      {agent.role}
                    </div>
                  )}
                  {!agent && (
                    <div className="text-xs text-ink-faint">
                      agent not found
                    </div>
                  )}
                  {(work?.currentTaskTitle || metaParts.length > 0) && (
                    <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] tabular-nums text-ink-faint">
                      {work?.currentTaskTitle && (
                        <span className="truncate text-ink-soft">
                          on: {work.currentTaskTitle}
                        </span>
                      )}
                      {metaParts.map((p) => (
                        <span key={p} className="shrink-0">
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                  {work?.pingMessage && (
                    <div className="mt-1 line-clamp-2 border border-paper-rule bg-paper-sunk px-1.5 py-0.5 text-[11px] text-ink-soft">
                      {work.pingMessage}
                    </div>
                  )}
                </div>
                {status && (
                  <div className="flex shrink-0 items-center gap-2 pt-0.5">
                    {loading && !payload ? (
                      <span className="font-mono text-[10px] text-ink-faint">
                        —
                      </span>
                    ) : (
                      <>
                        <span
                          className={cn("status-dot", STATUS_DOT[status])}
                          aria-hidden
                        />
                        <span
                          className={cn(
                            "font-mono text-[10px] uppercase tracking-[0.08em]",
                            STATUS_TEXT[status]
                          )}
                        >
                          {status}
                        </span>
                      </>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void removeMember(memberId)}
                  aria-label={`Remove ${agent?.name ?? memberId} from team`}
                  title="Remove from team"
                  className="flex shrink-0 items-center justify-center p-1 text-ink-faint opacity-0 transition-opacity hover:text-plot-red focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-60"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {nonMembers.length > 0 && (
        <AddMemberPicker
          candidates={nonMembers}
          onAdd={(id) => void addMember(id)}
        />
      )}
    </div>
  );
}
