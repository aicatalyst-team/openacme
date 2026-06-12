import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { Button } from "@/app/components/ui/button";
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
  // View-is-the-editor: the charter edits in place; save/discard appears
  // once the draft diverges.
  const [draft, setDraft] = useState(team.charter);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(team.charter);
  }, [team.id, team.charter]);

  const dirty = draft !== team.charter;
  const over = draft.length > TEAM_CHARTER_CHAR_LIMIT;

  async function save() {
    setSaving(true);
    try {
      if (await putTeam(team.id, { charter: draft })) {
        toast.success("Charter saved");
        onChanged();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <MarkdownEditor
        value={draft}
        onChange={setDraft}
        placeholder={
          "What this team is for, how it works, conventions. " +
          "Injected into every member's context — type / for blocks…"
        }
        contentClassName="min-h-[160px]"
      />
      <div className="flex items-baseline justify-between gap-2 border-t border-paper-rule pt-2">
        <p className="text-xs text-ink-faint">
          Injected into every member&apos;s context. Human-owned: agents can
          read it but never edit it. Shares a{" "}
          {TEAM_CHARTER_CHAR_LIMIT.toLocaleString()}-char prompt budget across
          an agent&apos;s teams.
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
      {dirty && (
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => setDraft(team.charter)}
          >
            Discard
          </Button>
          <Button size="sm" onClick={save} disabled={saving || over}>
            <Save className="size-4" />
            Save charter
          </Button>
        </div>
      )}
    </div>
  );
}
