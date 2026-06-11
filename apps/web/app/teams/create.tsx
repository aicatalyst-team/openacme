import { useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { API_BASE } from "../lib/api";
import { AgentAvatar } from "@/app/components/ui/agent-avatar";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { Label } from "@/app/components/ui/label";
import { cn } from "@/app/lib/utils";
import { AddMemberPicker } from "./members";
import { ManagerBadge } from "./manager-badge";
import { MemberRowMenu } from "./row-menu";
import {
  EMPTY_DRAFT,
  TEAM_CHARTER_CHAR_LIMIT,
  type AgentInfo,
  type Draft,
  type Team,
} from "./types";

export function TeamCreateForm({
  agents,
  onCreated,
}: {
  agents: AgentInfo[];
  onCreated: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  function toggleMember(agentId: string) {
    setDraft((d) => {
      const members = d.members.includes(agentId)
        ? d.members.filter((m) => m !== agentId)
        : [...d.members, agentId];
      return {
        ...d,
        members,
        // Deselecting the manager-member vacates the seat.
        manager:
          d.manager !== null && members.includes(d.manager) ? d.manager : null,
      };
    });
  }

  async function create() {
    if (!draft.name.trim()) {
      toast.error("Team needs a name");
      return;
    }
    setSaving(true);
    try {
      const id =
        draft.id.trim() ||
        draft.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
      const res = await fetch(`${API_BASE}/api/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: draft.name.trim(),
          members: draft.members,
          manager: draft.manager,
          charter: draft.charter,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        toast.error(err.error ?? "Failed to create team");
        return;
      }
      const saved = (await res.json()) as Team;
      toast.success(`Team created: ${saved.name}`);
      onCreated(saved.id);
    } finally {
      setSaving(false);
    }
  }

  const charterOver = draft.charter.length > TEAM_CHARTER_CHAR_LIMIT;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="team-name">Name</Label>
          <Input
            id="team-name"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Website Redesign"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="team-id">Id</Label>
          <Input
            id="team-id"
            value={draft.id}
            onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))}
            placeholder="derived from name"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Members</Label>
        {agents.length === 0 ? (
          <p className="text-sm text-ink-faint">
            No agents yet — create agents first.
          </p>
        ) : (
          <>
            {draft.members.length > 0 && (
              <div className="flex flex-col border border-paper-rule">
                {draft.members.map((memberId) => {
                  const agent = agents.find((a) => a.id === memberId);
                  return (
                    <div
                      key={memberId}
                      className="flex items-center gap-3 border-b border-paper-rule/40 px-4 py-2.5 last:border-b-0"
                    >
                      <AgentAvatar avatar={agent?.avatar} size="md" />
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="shrink-0 text-sm font-medium text-ink">
                          {agent?.name ?? memberId}
                        </span>
                        {draft.manager === memberId && <ManagerBadge />}
                        {agent?.role && (
                          <span className="truncate text-xs text-ink-faint">
                            {agent.role}
                          </span>
                        )}
                      </div>
                      <MemberRowMenu
                        name={agent?.name ?? memberId}
                        isManager={draft.manager === memberId}
                        onToggleManager={() =>
                          setDraft((d) => ({
                            ...d,
                            manager:
                              d.manager === memberId ? null : memberId,
                          }))
                        }
                        onRemove={() => toggleMember(memberId)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            <AddMemberPicker
              candidates={agents.filter((a) => !draft.members.includes(a.id))}
              onAdd={(id) => toggleMember(id)}
            />
            <p className="text-xs text-ink-faint">
              Optionally mark one member as manager — team-addressed tasks
              (no assignee) land on them for triage. A routing default, not
              authority.
            </p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="team-charter">Charter</Label>
        <Textarea
          id="team-charter"
          value={draft.charter}
          onChange={(e) =>
            setDraft((d) => ({ ...d, charter: e.target.value }))
          }
          rows={10}
          placeholder={
            "What this team is for, how it works, conventions.\n" +
            'Injected into every member\'s context — e.g. "Ship one growth experiment a week; results go in the team workspace."'
          }
        />
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs text-ink-faint">
            Injected into every member&apos;s context. Human-owned: agents can
            read it but never edit it.
          </p>
          <span
            className={cn(
              "shrink-0 font-mono text-[11px] tabular-nums",
              charterOver ? "text-warn-ochre" : "text-ink-faint"
            )}
          >
            {draft.charter.length} / {TEAM_CHARTER_CHAR_LIMIT}
          </span>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={create} disabled={saving}>
          <Save className="size-4" />
          Create team
        </Button>
      </div>
    </div>
  );
}
