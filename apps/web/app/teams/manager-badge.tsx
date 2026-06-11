/** State chip for the team's manager seat — display only; actions live
 *  in the row menu. */
export function ManagerBadge() {
  return (
    <span
      title="Team-addressed tasks (no assignee) land here for triage"
      className="shrink-0 border border-paper-rule bg-paper-sunk px-1 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft"
    >
      Manager
    </span>
  );
}
