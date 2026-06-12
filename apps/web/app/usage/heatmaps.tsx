import { useMemo, useState } from "react";
import { AgentAvatar } from "@/app/components/ui/agent-avatar";
import { cn } from "@/app/lib/utils";
import { formatCost, formatTokens } from "@/app/lib/format";
import type { UsageHeatmapResponse } from "@/app/lib/types";

const DAY_MS = 86_400_000;
const CELL = 11;
const GAP = 2;

/** 5-step intensity ramp on the warm amber family (red stays reserved). */
function rampColor(v: number, max: number): string {
  if (v <= 0 || max <= 0) return "var(--paper-sunk)";
  const step = Math.min(4, Math.ceil((v / max) * 4));
  return [
    "var(--paper-sunk)",
    "oklch(85% 0.07 75)",
    "oklch(76% 0.11 75)",
    "oklch(66% 0.13 70)",
    "oklch(55% 0.14 60)",
  ][step]!;
}

interface DayCell {
  day: string;
  cost: number;
  tokens: number;
  events: number;
}

/**
 * GitHub-style calendar heatmap of daily spend (UTC days). Click a
 * cell to filter the page to that day.
 */
export function CalendarHeatmap({
  heatmap,
  weeks = 17,
  onPickDay,
  agentName,
}: {
  heatmap: UsageHeatmapResponse;
  weeks?: number;
  onPickDay?: (dayIso: string) => void;
  agentName?: (id: string) => string;
}) {
  void agentName;
  const [hover, setHover] = useState<DayCell | null>(null);

  const { grid, maxCost, todayKey } = useMemo(() => {
    const byDay = new Map<string, DayCell>();
    for (const r of heatmap.daily) {
      const cur = byDay.get(r.day) ?? {
        day: r.day,
        cost: 0,
        tokens: 0,
        events: 0,
      };
      cur.cost += r.costUsdEquivalent;
      cur.tokens += r.totalTokens;
      cur.events += r.events;
      byDay.set(r.day, cur);
    }
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    // Align the last column to the current week (Mon-start).
    const dow = (now.getUTCDay() + 6) % 7;
    const end = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    );
    const cells: Array<Array<DayCell | null>> = [];
    let max = 0;
    for (let w = weeks - 1; w >= 0; w--) {
      const col: Array<DayCell | null> = [];
      for (let d = 0; d < 7; d++) {
        const t = end - (dow - d) * DAY_MS - w * 7 * DAY_MS;
        if (t > end) {
          col.push(null);
          continue;
        }
        const key = new Date(t).toISOString().slice(0, 10);
        const cell = byDay.get(key) ?? {
          day: key,
          cost: 0,
          tokens: 0,
          events: 0,
        };
        max = Math.max(max, cell.cost);
        col.push(cell);
      }
      cells.push(col);
    }
    return { grid: cells, maxCost: max, todayKey: today };
  }, [heatmap, weeks]);

  const width = grid.length * (CELL + GAP);
  const height = 7 * (CELL + GAP);

  return (
    <div className="flex flex-col gap-2">
      <svg
        width={width}
        height={height}
        className="shrink-0"
        role="img"
        aria-label="Daily spend heatmap"
      >
        {grid.map((col, x) =>
          col.map((cell, y) =>
            cell ? (
              <rect
                key={`${x}-${y}`}
                x={x * (CELL + GAP)}
                y={y * (CELL + GAP)}
                width={CELL}
                height={CELL}
                fill={rampColor(cell.cost, maxCost)}
                stroke={cell.day === todayKey ? "var(--plot-red)" : "none"}
                strokeWidth={cell.day === todayKey ? 1.5 : 0}
                className={cn(onPickDay && "cursor-pointer")}
                onMouseEnter={() => setHover(cell)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onPickDay?.(cell.day)}
              />
            ) : null
          )
        )}
      </svg>
      <div className="flex items-center justify-between">
        <span className="meta-row h-4 text-ink-faint">
          {hover
            ? `${hover.day} · ${formatCost(hover.cost)} · ${formatTokens(hover.tokens)} tok · ${hover.events} calls`
            : ""}
        </span>
        <span className="meta-row flex items-center gap-1 text-ink-faint">
          less
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="inline-block size-2.5"
              style={{ background: rampColor(i, 4) }}
            />
          ))}
          more
        </span>
      </div>
    </div>
  );
}

/**
 * Agent × hour-of-day punch card (UTC hours). Makes overnight
 * autonomous work visible at a glance.
 */
export function PunchCard({
  heatmap,
  agentName,
  agentAvatar,
  maxAgents = 8,
}: {
  heatmap: UsageHeatmapResponse;
  agentName: (id: string) => string;
  agentAvatar?: (id: string) => string | undefined;
  maxAgents?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const { agents, byCell, max } = useMemo(() => {
    const totals = new Map<string, number>();
    const cells = new Map<string, { cost: number; events: number }>();
    let m = 0;
    for (const r of heatmap.hours) {
      totals.set(r.agentId, (totals.get(r.agentId) ?? 0) + r.costUsdEquivalent);
      const key = `${r.agentId}:${r.hour}`;
      const cur = cells.get(key) ?? { cost: 0, events: 0 };
      cur.cost += r.costUsdEquivalent;
      cur.events += r.events;
      cells.set(key, cur);
      m = Math.max(m, cur.cost);
    }
    const top = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxAgents)
      .map(([id]) => id);
    return { agents: top, byCell: cells, max: m };
  }, [heatmap, maxAgents]);

  if (agents.length === 0) {
    return (
      <span className="meta-row text-ink-faint">No activity in range.</span>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {agents.map((id) => (
        <div key={id} className="flex items-center gap-2">
          <span className="flex w-28 shrink-0 items-center gap-1.5 truncate">
            <AgentAvatar avatar={agentAvatar?.(id)} size="xs" />
            <span className="meta-row truncate text-ink-soft">
              {agentName(id)}
            </span>
          </span>
          <div className="flex gap-[2px]">
            {Array.from({ length: 24 }, (_, h) => {
              const cell = byCell.get(`${id}:${h}`);
              return (
                <span
                  key={h}
                  className="inline-block size-2.5"
                  style={{ background: rampColor(cell?.cost ?? 0, max) }}
                  onMouseEnter={() =>
                    setHover(
                      cell
                        ? `${agentName(id)} · ${String(h).padStart(2, "0")}:00 UTC · ${formatCost(cell.cost)} · ${cell.events} calls`
                        : null
                    )
                  }
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0" />
        <span
          className="meta-row flex justify-between text-ink-faint"
          style={{ width: 24 * 12 - 2 }}
        >
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>23 UTC</span>
        </span>
      </div>
      <span className="meta-row h-4 text-ink-faint">{hover ?? ""}</span>
    </div>
  );
}
