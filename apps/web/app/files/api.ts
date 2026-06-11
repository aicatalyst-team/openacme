import { API_BASE } from "../lib/api";
import type { FsRoot, FsStatResults, FsTreeResponse } from "./types";

export function fsRootPath(root: FsRoot): string {
  return `${API_BASE}/api/fs/${root.kind}/${encodeURIComponent(root.id)}/${root.scope}`;
}

export function fileUrl(
  root: FsRoot,
  relPath: string,
  opts?: { download?: boolean }
): string {
  const enc = relPath.split("/").map(encodeURIComponent).join("/");
  return `${fsRootPath(root)}/file/${enc}${opts?.download ? "?download=1" : ""}`;
}

async function errorOf(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || res.statusText;
}

export async function fetchTree(root: FsRoot): Promise<FsTreeResponse> {
  const res = await fetch(`${fsRootPath(root)}/tree`);
  if (!res.ok) throw new Error(await errorOf(res));
  return (await res.json()) as FsTreeResponse;
}

export async function statPaths(
  owner: { kind: FsRoot["kind"]; id: string },
  paths: string[]
): Promise<FsStatResults> {
  const res = await fetch(
    `${API_BASE}/api/fs/${owner.kind}/${encodeURIComponent(owner.id)}/stat`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths }),
    }
  );
  if (!res.ok) throw new Error(await errorOf(res));
  return ((await res.json()) as { results: FsStatResults }).results;
}

export async function uploadResourceFiles(
  agentId: string,
  form: FormData
): Promise<FsTreeResponse> {
  const res = await fetch(
    `${API_BASE}/api/fs/agent/${encodeURIComponent(agentId)}/resources/files`,
    { method: "POST", body: form }
  );
  if (!res.ok) throw new Error(await errorOf(res));
  return (await res.json()) as FsTreeResponse;
}

export async function deleteResourceFile(
  agentId: string,
  relPath: string
): Promise<void> {
  const enc = relPath.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(
    `${API_BASE}/api/fs/agent/${encodeURIComponent(agentId)}/resources/file/${enc}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error(await errorOf(res));
}
