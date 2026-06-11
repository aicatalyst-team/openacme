import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "../components/Markdown";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import { cn } from "@/app/lib/utils";
import { putTeam } from "./api";
import { TEAM_CHARTER_CHAR_LIMIT, type Team } from "./types";

export function TeamCharterTab({
  team,
  onChanged,
}: {
  team: Team;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(team.charter);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditing(false);
    setDraft(team.charter);
  }, [team.id, team.charter]);

  async function save() {
    setSaving(true);
    try {
      if (await putTeam(team.id, { charter: draft })) {
        toast.success("Charter saved");
        setEditing(false);
        onChanged();
      }
    } finally {
      setSaving(false);
    }
  }

  function startEdit() {
    setDraft(team.charter);
    setEditing(true);
  }

  const over = draft.length > TEAM_CHARTER_CHAR_LIMIT;

  if (editing) {
    return (
      <div className="flex flex-col gap-1.5">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={14}
          autoFocus
          placeholder={
            "What this team is for, how it works, conventions.\n" +
            'Injected into every member\'s context — e.g. "Zoe is the manager and splits incoming work."'
          }
        />
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs text-ink-faint">
            Injected into every member&apos;s context. Human-owned: agents can
            read it but never edit it. Shares a{" "}
            {TEAM_CHARTER_CHAR_LIMIT.toLocaleString()}-char prompt budget
            across an agent&apos;s teams.
          </p>
          <span
            className={cn(
              "shrink-0 font-mono text-[11px] tabular-nums",
              over ? "text-warn-ochre" : "text-ink-faint"
            )}
          >
            {draft.length} / {TEAM_CHARTER_CHAR_LIMIT}
          </span>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft(team.charter);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            Save charter
          </Button>
        </div>
      </div>
    );
  }

  if (!team.charter.trim()) {
    return (
      <div className="flex flex-col items-start gap-2 border border-dashed border-paper-rule px-4 py-5">
        <p className="text-sm text-ink-faint">
          No charter yet. The charter is injected into every member&apos;s
          context — it&apos;s how the team knows what it&apos;s for.
        </p>
        <Button variant="outline" size="sm" onClick={startEdit}>
          <Pencil className="size-3.5" /> Write the charter
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="ghost" size="xs" onClick={startEdit}>
          <Pencil className="size-3" /> Edit
        </Button>
      </div>
      <div className="text-sm text-ink-soft">
        <Markdown>{team.charter}</Markdown>
      </div>
    </div>
  );
}
