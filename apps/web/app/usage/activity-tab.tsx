import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { AgentAvatar } from "@/app/components/ui/agent-avatar";
import { Badge } from "@/app/components/ui/badge";
import { API_BASE } from "@/app/lib/api";
import { cn } from "@/app/lib/utils";
import {
  formatCost,
  formatDurationMs,
  formatPercent,
  formatTokens,
  kindColor,
} from "@/app/lib/format";
import type { UsageEventRow } from "@/app/lib/types";
import { usageQueryString, type UsageFilterState } from "@/app/lib/useUsage";

const ROW_GRID =
  "grid min-w-[64rem] grid-cols-[8.5rem_8rem_7rem_minmax(8rem,1fr)_4rem_4rem_4rem_5.5rem_4.5rem_8rem] items-center gap-x-3 px-1";

function tsLabel(unixSec: number): string {
  // `sv-SE` gives ISO shape in local tz; year dropped — this is a
  // rolling feed, the CSV export keeps full timestamps.
  return new Date(unixSec * 1000)
    .toLocaleString("sv-SE")
    .replace("T", " ")
    .slice(5);
}

function toCsv(events: UsageEventRow[]): string {
  const cols = [
    "createdAt",
    "agentId",
    "kind",
    "provider",
    "model",
    "authMode",
    "sessionId",
    "taskId",
    "inputTokens",
    "outputTokens",
    "cachedInputTokens",
    "cacheWriteTokens",
    "reasoningTokens",
    "totalTokens",
    "costUsd",
    "costUsdEquivalent",
    "costSource",
    "steps",
    "durationMs",
  ] as const;
  const lines = [cols.join(",")];
  for (const e of events) {
    lines.push(
      cols
        .map((c) => {
          const v = e[c];
          return v === null || v === undefined ? "" : String(v);
        })
        .join(",")
    );
  }
  return lines.join("\n");
}

/**
 * The audit floor: raw ledger rows, newest first, keyset-paginated.
 * Every aggregate elsewhere clicks through to here pre-filtered — the
 * rows below an aggregate must visibly sum to it.
 */
export function ActivityTab({
  filter,
  agentName,
  agentAvatar,
  liveTick,
}: {
  filter: UsageFilterState;
  agentName: (id: string) => string;
  agentAvatar?: (id: string) => string | undefined;
  /** Bumped by the parent when a usage_event lands — reloads page one. */
  liveTick: number;
}) {
  const [events, setEvents] = useState<UsageEventRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const filterKey = JSON.stringify(filter);
  const abortRef = useRef<AbortController | null>(null);

  const loadFirst = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(
        `${API_BASE}/api/usage/events?${usageQueryString(filter, { limit: "50" })}`,
        { credentials: "include", signal: ctrl.signal }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        events: UsageEventRow[];
        nextCursor: string | null;
      };
      setEvents(data.events);
      setCursor(data.nextCursor);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setEvents([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    setLoading(true);
    void loadFirst();
  }, [loadFirst, liveTick]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const res = await fetch(
      `${API_BASE}/api/usage/events?${usageQueryString(filter, {
        limit: "50",
        before: cursor,
      })}`,
      { credentials: "include" }
    );
    if (!res.ok) return;
    const data = (await res.json()) as {
      events: UsageEventRow[];
      nextCursor: string | null;
    };
    setEvents((prev) => [...prev, ...data.events]);
    setCursor(data.nextCursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, filterKey]);

  const exportCsv = useCallback(() => {
    const blob = new Blob([toCsv(events)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `openacme-usage-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [events]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="meta-row text-ink-faint">
          {events.length} loaded{cursor ? " · more available" : ""}
        </span>
        <button
          onClick={exportCsv}
          disabled={events.length === 0}
          className="inline-flex h-7 items-center gap-1.5 border border-paper-rule px-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-soft transition-colors hover:bg-paper-sunk hover:text-ink disabled:opacity-40"
        >
          <Download className="size-3" />
          Export CSV
        </button>
      </div>
      <div className="flex flex-col overflow-x-auto">
        {events.length > 0 && (
          <div className={cn(ROW_GRID, "border-b border-paper-rule py-1.5")}>
            <span className="label-faceplate text-ink-faint">Time</span>
            <span className="label-faceplate text-ink-faint">Agent</span>
            <span className="label-faceplate text-ink-faint">Kind</span>
            <span className="label-faceplate text-ink-faint">Model</span>
            <span className="label-faceplate text-right text-ink-faint">In</span>
            <span className="label-faceplate text-right text-ink-faint">Out</span>
            <span className="label-faceplate text-right text-ink-faint">
              Cached
            </span>
            <span className="label-faceplate text-right text-ink-faint">
              Cost
            </span>
            <span className="label-faceplate text-right text-ink-faint">
              Dur
            </span>
            <span />
          </div>
        )}
        {events.map((e) => {
          const hitRate =
            e.inputTokens > 0 ? e.cachedInputTokens / e.inputTokens : 0;
          return (
            <div
              key={e.id}
              className={cn(
                ROW_GRID,
                "border-b border-paper-rule py-2 last:border-b-0"
              )}
            >
              <span className="meta-row text-ink-faint">
                {tsLabel(e.createdAt)}
              </span>
              <span className="flex items-center gap-1.5 truncate">
                <AgentAvatar avatar={agentAvatar?.(e.agentId)} size="xs" />
                <span className="meta-row truncate text-ink-soft">
                  {agentName(e.agentId)}
                </span>
              </span>
              <span
                className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em]"
                style={{ color: kindColor(e.kind) }}
              >
                <span
                  className="inline-block size-1.5 shrink-0"
                  style={{ background: kindColor(e.kind) }}
                />
                {e.kind}
              </span>
              <span className="meta-row truncate text-ink-soft">{e.model}</span>
              <span className="meta-row text-right text-ink-soft">
                {formatTokens(e.inputTokens)}
              </span>
              <span className="meta-row text-right text-ink-soft">
                {formatTokens(e.outputTokens)}
              </span>
              <span
                className={cn(
                  "meta-row text-right",
                  e.cachedInputTokens > 0 ? "text-signal-green" : "text-ink-faint"
                )}
              >
                {e.cachedInputTokens > 0 ? formatPercent(hitRate) : "—"}
              </span>
              <span
                className={cn(
                  "text-right font-mono text-xs tabular-nums",
                  e.costSource === "subscription" ? "text-ink-faint" : "text-ink"
                )}
                title={`source: ${e.costSource}${e.costUsdEquivalent !== null ? ` · list ${formatCost(e.costUsdEquivalent)}` : ""}`}
              >
                {e.costSource === "subscription"
                  ? `${formatCost(e.costUsdEquivalent)} eq.`
                  : e.costSource === "free"
                    ? "free"
                    : formatCost(e.costUsd)}
                {e.costSource === "estimated" && (
                  <sup className="text-ink-faint"> est</sup>
                )}
              </span>
              <span
                className="meta-row text-right text-ink-faint"
                title={e.steps !== null ? `${e.steps} steps` : undefined}
              >
                {formatDurationMs(e.durationMs)}
              </span>
              <span className="flex items-center justify-end gap-2">
                {e.taskId && (
                  <Link to="/tasks" search={{ id: e.taskId }}>
                    <Badge variant="secondary" className="font-mono">
                      #{e.taskId}
                    </Badge>
                  </Link>
                )}
                {(e.kind === "interactive" || e.kind === "autonomous") && (
                  <Link
                    to="/"
                    search={{ session: e.sessionId, agent: e.agentId }}
                    className="meta-row text-ink-faint transition-colors hover:text-ink"
                  >
                    session →
                  </Link>
                )}
              </span>
            </div>
          );
        })}
        {!loading && events.length === 0 && (
          <span className="meta-row py-6 text-ink-faint">
            No usage events match this filter. Metering begins with the next
            agent turn.
          </span>
        )}
      </div>
      {cursor && (
        <button
          onClick={() => void loadMore()}
          className="self-start border border-paper-rule px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-soft transition-colors hover:bg-paper-sunk hover:text-ink"
        >
          Load earlier
        </button>
      )}
    </div>
  );
}
