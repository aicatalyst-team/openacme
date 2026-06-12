/**
 * Usage-ledger read API. Every endpoint takes the same filter params
 * (`from`/`to` epoch seconds, `agentId`, `model`, `kind`, `taskId`) so
 * the web's filter-chip state maps 1:1 onto query strings, and every
 * number on the page is reproducible as a GROUP BY over `usage_events`.
 *
 * Cost semantics: `costUsd` is real spend (null on subscription/local
 * rows); `costUsdEquivalent` is registry list price whenever pricing is
 * known. Summary-level derived stats (cache savings, forecast, anomaly)
 * are computed here, not in the store — they're presentation math over
 * one or two aggregate queries.
 */

import type { Hono } from "hono";
import { z } from "zod";
import { USAGE_KINDS, type UsageFilter } from "@openacme/db";
import { computeCacheSavings, type ModelConfig } from "@openacme/config";
import { computeForecast } from "../usage-forecast.js";
import type { AgentManager } from "../agent-manager.js";

const UsageQuerySchema = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  agentId: z.string().optional(),
  model: z.string().optional(),
  kind: z.enum(USAGE_KINDS).optional(),
  taskId: z.string().optional(),
});

const DAY_S = 86_400;
const DEFAULT_RANGE_S = 30 * DAY_S;

function parseFilter(
  query: Record<string, string | undefined>
): { filter: UsageFilter; from: number; to: number } | null {
  const parsed = UsageQuerySchema.safeParse(query);
  if (!parsed.success) return null;
  const now = Math.floor(Date.now() / 1000);
  const to = parsed.data.to ?? now;
  const from = parsed.data.from ?? to - DEFAULT_RANGE_S;
  return { filter: { ...parsed.data, from, to }, from, to };
}

/** Start of the current UTC day / month, epoch seconds. */
function utcDayStart(nowS: number): number {
  return nowS - (nowS % DAY_S);
}
function utcMonthStart(nowS: number): { start: number; daysInMonth: number } {
  const d = new Date(nowS * 1000);
  const start =
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  const daysInMonth = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return { start, daysInMonth };
}

export function registerUsageRoutes(app: Hono, manager: AgentManager): void {
  app.get("/api/usage/summary", (c) => {
    const q = parseFilter(c.req.query());
    if (!q) return c.json({ error: "invalid usage query" }, 400);
    const { filter, from, to } = q;
    const store = manager.usageStore;

    const totals = store.totals(filter);
    // Prior window of the same length, same non-time filters.
    const previous = store.totals({
      ...filter,
      from: from - (to - from),
      to: from,
    });

    // Cache savings: read tokens × (input − cacheRead) rate, summed per
    // model so each model's own spread applies. Estimate by definition.
    const byModel = store.breakdown(filter, "model");
    let cacheSavingsUsd = 0;
    for (const row of byModel) {
      if (row.cachedInputTokens <= 0) continue;
      const saving = computeCacheSavings(
        modelConfigFor(row.key),
        row.cachedInputTokens
      );
      if (saving !== null) cacheSavingsUsd += saving;
    }

    // Forecast + anomaly run on equivalent cost (subscription usage has
    // no marginal spend but the operator still wants the trend), over
    // the filter's dimensions but ignoring its time range — they're
    // "now" stats, not range stats. Math lives in usage-forecast.ts.
    const nowS = Math.floor(Date.now() / 1000);
    const { start: monthStart } = utcMonthStart(nowS);
    const trailingStart = utcDayStart(nowS) - 14 * DAY_S;
    const { from: _f, to: _t, ...dims } = filter;
    const daily = store.dailyCostByAgent(
      Math.min(monthStart, trailingStart),
      dims
    );
    const byDay = new Map<string, number>();
    for (const r of daily) {
      byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.costUsdEquivalent);
    }
    const fc = computeForecast(byDay, nowS);

    return c.json({
      range: { from, to },
      totals,
      previous,
      cacheSavingsUsd,
      forecast: {
        monthToDateUsd: fc.monthToDateUsd,
        projectedMonthUsd: fc.projectedMonthUsd,
        dailyRateUsd: fc.dailyRateUsd,
      },
      anomaly: fc.anomaly,
    });
  });

  app.get("/api/usage/series", (c) => {
    const q = parseFilter(c.req.query());
    if (!q) return c.json({ error: "invalid usage query" }, 400);
    const bucket = c.req.query("bucket") === "hour" ? "hour" : "day";
    const groupByRaw = c.req.query("groupBy") ?? "agent";
    if (!["agent", "model", "kind"].includes(groupByRaw)) {
      return c.json({ error: "groupBy must be agent|model|kind" }, 400);
    }
    const rows = manager.usageStore.series(
      q.filter,
      bucket,
      groupByRaw as "agent" | "model" | "kind"
    );
    return c.json({ range: { from: q.from, to: q.to }, bucket, rows });
  });

  app.get("/api/usage/breakdown", (c) => {
    const q = parseFilter(c.req.query());
    if (!q) return c.json({ error: "invalid usage query" }, 400);
    const byRaw = c.req.query("by") ?? "agent";
    if (!["agent", "model", "kind", "task"].includes(byRaw)) {
      return c.json({ error: "by must be agent|model|kind|task" }, 400);
    }
    const rows = manager.usageStore.breakdown(
      q.filter,
      byRaw as "agent" | "model" | "kind" | "task"
    );
    return c.json({ range: { from: q.from, to: q.to }, by: byRaw, rows });
  });

  // Heatmap feeds: per-UTC-day totals (calendar) + agent×hour matrix
  // (punch card). Split from /summary so the Overview tab can lazy-load
  // them and the calendar can use a longer range than the page filter.
  app.get("/api/usage/heatmap", (c) => {
    const q = parseFilter(c.req.query());
    if (!q) return c.json({ error: "invalid usage query" }, 400);
    const { from: _hf, to: _ht, ...dims } = q.filter;
    const daily = manager.usageStore.dailyCostByAgent(q.from, dims);
    const hours = manager.usageStore.agentHourMatrix(q.filter);
    return c.json({ range: { from: q.from, to: q.to }, daily, hours });
  });

  app.get("/api/usage/events", (c) => {
    const q = parseFilter(c.req.query());
    if (!q) return c.json({ error: "invalid usage query" }, 400);
    const limit = Math.min(
      200,
      Math.max(1, parseInt(c.req.query("limit") ?? "50", 10) || 50)
    );
    // Cursor format: "<createdAt>_<rowid>" from the previous response.
    const beforeRaw = c.req.query("before");
    let before: { createdAt: number; rowid: number } | undefined;
    if (beforeRaw) {
      const m = /^(\d+)_(\d+)$/.exec(beforeRaw);
      if (!m) return c.json({ error: "invalid cursor" }, 400);
      before = { createdAt: Number(m[1]), rowid: Number(m[2]) };
    }
    const page = manager.usageStore.listEvents(q.filter, { limit, before });
    return c.json({
      events: page.events,
      nextCursor: page.nextCursor
        ? `${page.nextCursor.createdAt}_${page.nextCursor.rowid}`
        : null,
    });
  });
}

/**
 * Reconstruct a minimal ModelConfig for pricing lookups from a ledger
 * row's model string. Provider is unknown at this layer (the row has
 * it, but breakdown groups by model only) — `lookupModelMetadata`'s
 * suffix matching resolves bare model ids across providers.
 */
function modelConfigFor(model: string): ModelConfig {
  return { model, auth: "api_key", cacheTtl: "5m" } as ModelConfig;
}
