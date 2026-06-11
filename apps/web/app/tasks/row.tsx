import { Badge } from "@/app/components/ui/badge";
import { ActiveMarker } from "@/app/components/ui/active-marker";
import { AgentRef } from "@/app/components/ui/agent-ref";
import { cn } from "@/app/lib/utils";
import {
  STATUS_LABEL,
  STATUS_VARIANT,
  dueUrgencyClass,
  formatDate,
  formatRelativeFutureFromIso,
  type Task,
} from "./types";

export function TaskListRow({
  task,
  isActive,
  onPick,
}: {
  task: Task;
  isActive: boolean;
  onPick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
      className={cn(
        "group relative flex cursor-pointer flex-col items-start gap-1 border-b border-paper-rule/40 px-4 py-3 text-left transition-colors last:border-b-0",
        isActive
          ? "bg-paper-sunk text-ink"
          : "text-ink-soft hover:bg-paper-sunk hover:text-ink"
      )}
    >
      <ActiveMarker active={isActive} />
      <div className="flex w-full items-center gap-2">
        <Badge variant={STATUS_VARIANT[task.status]} className="shrink-0">
          {STATUS_LABEL[task.status]}
        </Badge>
        <span className="truncate text-sm font-medium text-ink">
          {task.title}
        </span>
      </div>
      <div className="flex w-full flex-wrap gap-x-3 font-mono text-[11px] tabular-nums text-ink-faint">
        <AgentRef id={task.assignee} />
        {task.due_at && (
          <span className={dueUrgencyClass(task.due_at)}>
            due {formatDate(task.due_at)}
          </span>
        )}
        {task.start_at &&
          (new Date(task.start_at).getTime() > Date.now() ? (
            <span className="text-signal-blue">
              starts {formatRelativeFutureFromIso(task.start_at)}
            </span>
          ) : (
            <span>starts {formatDate(task.start_at)}</span>
          ))}
        {task.depends_on.length > 0 && (
          <span>
            {task.depends_on.length} dep
            {task.depends_on.length === 1 ? "" : "s"}
          </span>
        )}
        {task.comment_count !== undefined && task.comment_count > 0 && (
          <span>
            {task.comment_count} comment
            {task.comment_count === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}
