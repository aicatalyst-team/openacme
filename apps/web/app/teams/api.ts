import { toast } from "sonner";
import { API_BASE } from "../lib/api";
import type { Team } from "./types";

export async function putTeam(
  teamId: string,
  patch: Partial<
    Pick<Team, "name" | "charter" | "members" | "archived" | "manager">
  >
): Promise<boolean> {
  const res = await fetch(
    `${API_BASE}/api/teams/${encodeURIComponent(teamId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    toast.error(err.error ?? "Failed to update team");
    return false;
  }
  return true;
}
