import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog";
import { FilePreview } from "./FilePreview";
import type { FsRoot } from "./types";

export interface FilePreviewTarget {
  root: FsRoot;
  relPath: string;
  size: number;
}

/** Modal preview used from chat (clicking a linkified file path). The
 *  tabs on agent/team pages use FileWorkbench's inline pane instead. */
export function FilePreviewDialog({
  target,
  onClose,
}: {
  target: FilePreviewTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[80dvh] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogTitle className="sr-only">
          {target?.relPath ?? "File preview"}
        </DialogTitle>
        {target && (
          <FilePreview
            key={`${target.root.kind}:${target.root.id}:${target.root.scope}:${target.relPath}`}
            root={target.root}
            relPath={target.relPath}
            size={target.size}
            headerClassName="pr-12"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
