import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "./api";
import type {
  UsageBreakdownRow,
  UsageHeatmapResponse,
  UsageKind,
  UsageSeriesRow,
  UsageSummaryResponse,
} from "./types";

/** Filter state shared by every usage endpoint (mirrors query params). */
export interface UsageFilterState {
  /** Epoch seconds. */
  from: number;
  to: number;
  agentId?: string;
  model?: string;
  kind?: UsageKind;
  taskId?: string;
}

export function usageQueryString(
  f: UsageFilterState,
  extra?: Record<string, string>
): string {
  const p = new URLSearchParams();
  p.set("from", String(f.from));
  p.set("to", String(f.to));
  if (f.agentId) p.set("agentId", f.agentId);
  if (f.model) p.set("model", f.model);
  if (f.kind) p.set("kind", f.kind);
  if (f.taskId) p.set("taskId", f.taskId);
  for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
  return p.toString();
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface UsageData {
  summary: UsageSummaryResponse | null;
  series: UsageSeriesRow[];
  breakdownAgent: UsageBreakdownRow[];
  breakdownModel: UsageBreakdownRow[];
  breakdownKind: UsageBreakdownRow[];
  breakdownTask: UsageBreakdownRow[];
  heatmap: UsageHeatmapResponse | null;
}

const EMPTY: UsageData = {
  summary: null,
  series: [],
  breakdownAgent: [],
  breakdownModel: [],
  breakdownKind: [],
  breakdownTask: [],
  heatmap: null,
};

/**
 * Aggregate usage data for the /usage page: one parallel fetch of
 * summary + series + breakdowns + heatmap, re-run when the filter
 * changes, refreshed (rAF-coalesced, same pattern as useHomeStream)
 * when a `usage_event` lands on the workforce stream.
 */
export function useUsage(
  filter: UsageFilterState,
  opts: { seriesBucket: "hour" | "day"; seriesGroupBy: "agent" | "model" | "kind" }
): {
  data: UsageData;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [data, setData] = useState<UsageData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refetchScheduled = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const key = JSON.stringify([filter, opts.seriesBucket, opts.seriesGroupBy]);

  const fetchAll = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const qs = (extra?: Record<string, string>) =>
      usageQueryString(filter, extra);
    try {
      const [summary, series, byAgent, byModel, byKind, byTask, heatmap] =
        await Promise.all([
          getJson<UsageSummaryResponse>(`/api/usage/summary?${qs()}`, ctrl.signal),
          getJson<{ rows: UsageSeriesRow[] }>(
            `/api/usage/series?${qs({ bucket: opts.seriesBucket, groupBy: opts.seriesGroupBy })}`,
            ctrl.signal
          ),
          getJson<{ rows: UsageBreakdownRow[] }>(
            `/api/usage/breakdown?${qs({ by: "agent" })}`,
            ctrl.signal
          ),
          getJson<{ rows: UsageBreakdownRow[] }>(
            `/api/usage/breakdown?${qs({ by: "model" })}`,
            ctrl.signal
          ),
          getJson<{ rows: UsageBreakdownRow[] }>(
            `/api/usage/breakdown?${qs({ by: "kind" })}`,
            ctrl.signal
          ),
          getJson<{ rows: UsageBreakdownRow[] }>(
            `/api/usage/breakdown?${qs({ by: "task" })}`,
            ctrl.signal
          ),
          getJson<UsageHeatmapResponse>(`/api/usage/heatmap?${qs()}`, ctrl.signal),
        ]);
      setData({
        summary,
        series: series.rows,
        breakdownAgent: byAgent.rows,
        breakdownModel: byModel.rows,
        breakdownKind: byKind.rows,
        breakdownTask: byTask.rows,
        heatmap,
      });
      setError(null);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const refresh = useCallback(() => {
    if (refetchScheduled.current) return;
    refetchScheduled.current = true;
    requestAnimationFrame(() => {
      refetchScheduled.current = false;
      void fetchAll();
    });
  }, [fetchAll]);

  useEffect(() => {
    setLoading(true);
    void fetchAll();
    return () => abortRef.current?.abort();
  }, [fetchAll]);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/home/stream`, {
      withCredentials: true,
    });
    const onUsage = () => refresh();
    es.addEventListener("usage_event", onUsage);
    return () => {
      es.removeEventListener("usage_event", onUsage);
      es.close();
    };
  }, [refresh]);

  return { data, loading, error, refresh };
}
