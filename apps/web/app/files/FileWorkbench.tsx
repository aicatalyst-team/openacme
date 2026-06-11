import { useCallback, useEffect, useState } from "react";
import { cn } from "../lib/utils";
import { FileBrowser } from "./FileBrowser";
import { FilePreview } from "./FilePreview";
import { fetchTree } from "./api";
import type { FsEntry, FsRoot, FsTreeResponse } from "./types";

/**
 * Shared split-pane surface for the Workspace / Resources tabs on the
 * agent and team detail pages: tree on the left, preview on the right.
 * Owns the tree fetch and the selection.
 */
export function FileWorkbench({
  root,
  className,
}: {
  root: FsRoot;
  /** Height override for embedded uses (the tab surfaces fill the pane). */
  className?: string;
}) {
  const [tree, setTree] = useState<FsTreeResponse | null>(null);
  const [selected, setSelected] = useState<FsEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rootKey = `${root.kind}:${root.id}:${root.scope}`;

  const refresh = useCallback(async () => {
    try {
      const next = await fetchTree(root);
      setTree(next);
      setError(null);
      // Keep the selection only if the file survived the refresh.
      setSelected((prev) =>
        prev ? (next.files.find((f) => f.path === prev.path) ?? null) : null
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    // root is identity-unstable (inline object literals at call sites);
    // rootKey captures everything that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootKey]);

  useEffect(() => {
    setTree(null);
    setSelected(null);
    void refresh();
  }, [refresh]);

  if (error) {
    return (
      <p className="border border-paper-rule bg-paper-sunk px-3 py-2 font-mono text-[12px] text-plot-red">
        {error}
      </p>
    );
  }
  if (!tree) {
    return (
      <p className="border border-paper-rule bg-paper-sunk px-3 py-2 font-mono text-[12px] text-ink-soft">
        Loading…
      </p>
    );
  }

  return (
    <div
      className={cn(
        "flex h-[calc(100dvh-15rem)] min-h-[24rem] flex-col overflow-hidden border border-paper-rule md:flex-row",
        className
      )}
    >
      <div className="h-56 shrink-0 border-b border-paper-rule md:h-auto md:w-72 md:border-b-0 md:border-r">
        <FileBrowser
          root={root}
          tree={tree}
          selectedPath={selected?.path ?? null}
          onOpenFile={setSelected}
          onChanged={() => void refresh()}
        />
      </div>
      <div className="min-h-0 flex-1">
        {selected ? (
          <FilePreview
            key={`${rootKey}:${selected.path}`}
            root={root}
            relPath={selected.path}
            size={selected.size}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <p className="font-mono text-[12px] text-ink-faint">
              Select a file to preview it.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
