import { useState } from "react";
import { Ellipsis } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/app/components/ui/popover";

/** Per-member row actions, kebab-style — one predictable place for
 *  manager toggling and removal instead of scattered hover affordances. */
export function MemberRowMenu({
  name,
  isManager,
  onToggleManager,
  onRemove,
}: {
  name: string;
  isManager: boolean;
  onToggleManager: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const item =
    "block w-full px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-paper-sunk";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${name}`}
          className="flex shrink-0 items-center justify-center p-1 text-ink-faint transition-colors hover:text-ink"
        >
          <Ellipsis className="size-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <button
          type="button"
          className={`${item} text-ink-soft hover:text-ink`}
          onClick={() => {
            setOpen(false);
            onToggleManager();
          }}
        >
          {isManager ? "Unset manager" : "Make manager"}
        </button>
        <button
          type="button"
          className={`${item} text-ink-soft hover:text-plot-red`}
          onClick={() => {
            setOpen(false);
            onRemove();
          }}
        >
          Remove from team
        </button>
      </PopoverContent>
    </Popover>
  );
}
