import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Brush,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/app/lib/utils";
import { formatCost, formatTokens, kindColor, seriesColor } from "@/app/lib/format";
import type { UsageSeriesRow } from "@/app/lib/types";

export type SpendMetric = "cost" | "tokens" | "turns";
export type SpendGroupBy = "agent" | "model" | "kind";

function metricOf(row: UsageSeriesRow, metric: SpendMetric): number {
  if (metric === "cost") return row.costUsdEquivalent;
  if (metric === "tokens") return row.totalTokens;
  return row.events;
}

function colorFor(groupBy: SpendGroupBy, key: string): string {
  return groupBy === "kind" ? kindColor(key) : seriesColor(key);
}

/**
 * Stacked area of spend/tokens/turns over time, one band per group
 * key. Pivots the flat `{t, key, ...}` rows into recharts' wide shape.
 * Legend entries double as filters via `onPickKey`.
 */
export function SpendChart({
  rows,
  bucket,
  metric,
  groupBy,
  onPickKey,
  onZoom,
  labelFor,
}: {
  rows: UsageSeriesRow[];
  bucket: "hour" | "day";
  metric: SpendMetric;
  groupBy: SpendGroupBy;
  onPickKey?: (key: string) => void;
  /** Brush commit: the selected sub-window becomes the page's time
   *  filter (refetches everything at the finer bucket). */
  onZoom?: (fromS: number, toS: number) => void;
  labelFor?: (key: string) => string;
}) {
  const { points, keys } = useMemo(() => {
    const keyTotals = new Map<string, number>();
    for (const r of rows) {
      keyTotals.set(r.key, (keyTotals.get(r.key) ?? 0) + metricOf(r, metric));
    }
    // Largest bands first so the stack reads top-down by weight.
    const sortedKeys = [...keyTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
    const byT = new Map<number, Record<string, number>>();
    for (const r of rows) {
      const slot = byT.get(r.t) ?? {};
      slot[r.key] = (slot[r.key] ?? 0) + metricOf(r, metric);
      byT.set(r.t, slot);
    }
    const pts = [...byT.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, vals]) => ({ t, ...vals }));
    return { points: pts, keys: sortedKeys };
  }, [rows, metric]);

  if (points.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center">
        <span className="meta-row text-ink-faint">
          No usage in this range.
        </span>
      </div>
    );
  }

  const fmtT = (t: number) => {
    const d = new Date(t * 1000);
    return bucket === "hour"
      ? `${String(d.getUTCHours()).padStart(2, "0")}:00`
      : d.toISOString().slice(5, 10);
  };
  const fmtV = (v: number) =>
    metric === "cost" ? formatCost(v) : metric === "tokens" ? formatTokens(v) : String(v);

  return (
    <div className="flex flex-col gap-2">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid
              strokeDasharray="2 4"
              stroke="var(--paper-rule)"
              vertical={false}
            />
            <XAxis
              dataKey="t"
              tickFormatter={fmtT}
              tick={{ fontSize: 10, fontFamily: "var(--font-mono, monospace)", fill: "var(--ink-faint)" }}
              axisLine={{ stroke: "var(--paper-rule)" }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={fmtV}
              width={56}
              tick={{ fontSize: 10, fontFamily: "var(--font-mono, monospace)", fill: "var(--ink-faint)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const entries = [...payload]
                  .filter((p) => (p.value as number) > 0)
                  .sort((a, b) => (b.value as number) - (a.value as number));
                const total = entries.reduce((s, p) => s + (p.value as number), 0);
                return (
                  <div className="border border-paper-rule bg-paper px-3 py-2">
                    <div className="meta-row mb-1 text-ink-faint">
                      {new Date((label as number) * 1000)
                        .toISOString()
                        .slice(0, bucket === "hour" ? 16 : 10)
                        .replace("T", " ")}
                      {" · "}
                      {fmtV(total)}
                    </div>
                    {entries.slice(0, 8).map((p) => (
                      <div key={p.dataKey as string} className="flex items-center gap-2">
                        <span
                          className="inline-block size-2"
                          style={{ background: colorFor(groupBy, p.dataKey as string) }}
                        />
                        <span className="meta-row text-ink-soft">
                          {labelFor?.(p.dataKey as string) ?? String(p.dataKey)}
                        </span>
                        <span className="meta-row ml-auto text-ink">
                          {fmtV(p.value as number)}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {keys.map((k) => (
              <Area
                key={k}
                type="step"
                dataKey={k}
                stackId="1"
                stroke={colorFor(groupBy, k)}
                fill={colorFor(groupBy, k)}
                fillOpacity={0.35}
                strokeWidth={1}
                isAnimationActive={false}
                // An Area needs 2+ points to draw a band; isolated
                // buckets (fresh install, single active day) render as
                // dots so sparse data is still visible.
                dot={
                  points.length <= 2
                    ? { r: 3, strokeWidth: 0, fill: colorFor(groupBy, k) }
                    : false
                }
              />
            ))}
            {points.length > 6 && (
              <Brush
                dataKey="t"
                height={18}
                travellerWidth={6}
                stroke="var(--ink-faint)"
                fill="var(--paper-sunk)"
                tickFormatter={fmtT}
                onDragEnd={(range) => {
                  if (!onZoom) return;
                  const { startIndex, endIndex } = range as {
                    startIndex?: number;
                    endIndex?: number;
                  };
                  if (startIndex === undefined || endIndex === undefined) return;
                  // Full-width selection is a no-op, not a zoom.
                  if (startIndex === 0 && endIndex === points.length - 1) return;
                  const from = points[startIndex]?.t;
                  const last = points[endIndex]?.t;
                  if (from === undefined || last === undefined) return;
                  // Include the end bucket's full width.
                  onZoom(from, last + (bucket === "hour" ? 3600 : 86_400));
                }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-1">
        {keys.map((k) => (
          <button
            key={k}
            onClick={() => onPickKey?.(k)}
            title={onPickKey ? `Filter to ${labelFor?.(k) ?? k}` : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 py-0.5",
              onPickKey &&
                "transition-colors hover:[&>span:last-child]:underline"
            )}
          >
            <span
              className="inline-block size-2"
              style={{ background: colorFor(groupBy, k) }}
            />
            <span className="meta-row text-ink-soft">{labelFor?.(k) ?? k}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
