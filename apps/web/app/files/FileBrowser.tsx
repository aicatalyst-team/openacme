import { useEffect, useMemo, useRef, useState } from "react";
import { FolderUp, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { deleteResourceFile, uploadResourceFiles } from "./api";
import type { FsEntry, FsRoot, FsTreeResponse } from "./types";

const MAX_FILE_BYTES = 1 * 1024 * 1024;
const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 200;

// The tree renders in a shadow root, so Tailwind can't reach it — but
// custom properties inherit through shadow boundaries, so mapping the
// --trees-* overrides onto the app's paper/ink tokens themes it for
// light AND dark with zero JS.
const TREE_STYLE = {
  "--trees-bg-override": "var(--paper)",
  "--trees-bg-muted-override": "var(--paper-sunk)",
  "--trees-fg-override": "var(--ink)",
  "--trees-fg-muted-override": "var(--ink-soft)",
  "--trees-accent-override": "var(--plot-red)",
  "--trees-border-color-override": "var(--paper-rule)",
  "--trees-border-radius-override": "0px",
  "--trees-input-bg-override": "var(--paper)",
  "--trees-search-bg-override": "var(--paper)",
  "--trees-search-fg-override": "var(--ink)",
  "--trees-selected-bg-override": "var(--paper-sunk)",
  "--trees-selected-fg-override": "var(--ink)",
  "--trees-focus-ring-color-override": "var(--plot-red)",
  // Match the toolbar's px-2 inset so search + rows align with the
  // scope label and icon buttons above.
  "--trees-padding-inline-override": "8px",
  height: "100%",
} as React.CSSProperties;

/**
 * Tree pane over an /api/fs root. Selection bubbles up via
 * `onOpenFile`; when the tree response says `writable`, upload
 * (buttons + drag-drop) and per-selection delete light up.
 */
export function FileBrowser({
  root,
  tree,
  onOpenFile,
  onChanged,
  selectedPath,
}: {
  root: FsRoot;
  tree: FsTreeResponse;
  onOpenFile: (entry: FsEntry | null) => void;
  onChanged: () => void;
  selectedPath: string | null;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const entryMap = useMemo(
    () => new Map(tree.files.map((f) => [f.path, f])),
    [tree.files]
  );
  const paths = useMemo(() => tree.files.map((f) => f.path), [tree.files]);

  // The model captures its options at creation — route changes through
  // refs/resetPaths instead of recreating it per render.
  const openRef = useRef(onOpenFile);
  openRef.current = onOpenFile;
  const entryMapRef = useRef(entryMap);
  entryMapRef.current = entryMap;

  const { model } = useFileTree({
    paths,
    initialExpansion: "open",
    search: true,
    onSelectionChange: (selected) => {
      const p = selected[0];
      openRef.current(p ? (entryMapRef.current.get(p) ?? null) : null);
    },
  });

  const initialPathsRef = useRef(paths);
  useEffect(() => {
    if (paths === initialPathsRef.current) return;
    model.resetPaths(paths);
  }, [model, paths]);

  const upload = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    if (tree.files.length + arr.length > MAX_FILES) {
      toast.error(`Adding ${arr.length} files would exceed the ${MAX_FILES}-file cap.`);
      return;
    }
    let total = 0;
    for (const f of arr) {
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`${f.name}: too large (max 1 MB)`);
        return;
      }
      total += f.size;
      if (total > MAX_REQUEST_BYTES) {
        toast.error("Upload would exceed 10 MB total");
        return;
      }
    }
    setUploading(true);
    try {
      const form = new FormData();
      for (const f of arr) {
        // webkitRelativePath is set for folder picks/drops; bare name otherwise.
        const withPath = f as File & { webkitRelativePath?: string };
        const rel =
          withPath.webkitRelativePath && withPath.webkitRelativePath.length > 0
            ? withPath.webkitRelativePath
            : f.name;
        form.append(rel, f, f.name);
      }
      await uploadResourceFiles(root.id, form);
      toast.success(`Uploaded ${arr.length} file${arr.length === 1 ? "" : "s"}`);
      onChanged();
    } catch (err) {
      toast.error("Upload failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUploading(false);
    }
  };

  const removeSelected = async () => {
    if (!selectedPath) return;
    try {
      await deleteResourceFile(root.id, selectedPath);
      onOpenFile(null);
      onChanged();
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const writable = tree.writable;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col",
        dragOver && "outline outline-1 outline-plot-red -outline-offset-1"
      )}
      onDragOver={
        writable
          ? (e) => {
              if (!Array.from(e.dataTransfer.types).includes("Files")) return;
              e.preventDefault();
              setDragOver(true);
            }
          : undefined
      }
      onDragLeave={
        writable
          ? (e) => {
              if (!Array.from(e.dataTransfer.types).includes("Files")) return;
              e.preventDefault();
              setDragOver(false);
            }
          : undefined
      }
      onDrop={
        writable
          ? (e) => {
              if (!Array.from(e.dataTransfer.types).includes("Files")) return;
              e.preventDefault();
              setDragOver(false);
              void upload(e.dataTransfer.files);
            }
          : undefined
      }
    >
      <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
          {root.scope}
        </span>
        {writable && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              onChange={(e) => {
                if (e.target.files) void upload(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={folderInputRef}
              type="file"
              hidden
              // @ts-expect-error -- webkitdirectory + directory are non-standard
              // attributes used to pick a folder in Chromium-based browsers.
              webkitdirectory=""
              // eslint-disable-next-line react/no-unknown-property
              directory=""
              multiple
              onChange={(e) => {
                if (e.target.files) void upload(e.target.files);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={uploading}
              title="Upload files"
              aria-label="Upload files"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={uploading}
              title="Upload folder"
              aria-label="Upload folder"
              onClick={() => folderInputRef.current?.click()}
            >
              <FolderUp className="size-3.5" />
            </Button>
            {selectedPath && (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                title={`Delete ${selectedPath}`}
                aria-label={`Delete ${selectedPath}`}
                onClick={() => void removeSelected()}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </>
        )}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title="Refresh"
          aria-label="Refresh"
          onClick={onChanged}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      {tree.truncated && (
        <p className="shrink-0 border-b border-paper-rule bg-paper-sunk px-2 py-1 font-mono text-[11px] text-ink-soft">
          Large tree — listing truncated.
        </p>
      )}

      <div className="min-h-0 flex-1">
        {tree.files.length === 0 ? (
          <p className="px-3 py-4 font-mono text-[12px] text-ink-faint">
            {writable
              ? "No files yet. Drop files here or use the buttons above."
              : "No files yet."}
          </p>
        ) : (
          <FileTree model={model} style={TREE_STYLE} />
        )}
      </div>
    </div>
  );
}
