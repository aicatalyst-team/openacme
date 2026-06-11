// Mirrors of the /api/fs server contracts (not imported — the web can't
// depend on server packages; same pattern as app/teams/types.ts).

export type FsScope = "workspace" | "resources" | "files";

export interface FsRoot {
  kind: "agent" | "team" | "skill";
  id: string;
  scope: FsScope;
}

export interface FsEntry {
  /** POSIX path relative to the root. */
  path: string;
  size: number;
  mtimeMs: number;
}

export interface FsTreeResponse {
  files: FsEntry[];
  truncated: boolean;
  writable: boolean;
}

export interface FsStatHit {
  kind: "agent" | "team";
  ownerId: string;
  scope: FsScope;
  relPath: string;
  size: number;
}

export type FsStatResults = Record<string, FsStatHit | null>;
