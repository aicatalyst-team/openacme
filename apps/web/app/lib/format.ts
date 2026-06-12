/**
 * Shared formatters for usage/cost surfaces. One module so a token
 * count or dollar figure renders identically in the sidebar readout,
 * the /usage page, and any future per-session strip.
 */

/** $0.0042 under a cent, $0.042 under a dollar, $1.23 above. */
export function formatCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return "—";
  if (usd === 0) return "$0.00";
  const abs = Math.abs(usd);
  if (abs < 0.01) return `$${usd.toFixed(4)}`;
  if (abs < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** 950 → "950", 18_200 → "18.2k", 12_400_000 → "12.4M". */
export function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) < 1000) return String(n);
  if (Math.abs(n) < 1_000_000) return `${trimZero((n / 1000).toFixed(1))}k`;
  if (Math.abs(n) < 1_000_000_000)
    return `${trimZero((n / 1_000_000).toFixed(1))}M`;
  return `${trimZero((n / 1_000_000_000).toFixed(1))}B`;
}

function trimZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** Signed percentage delta vs a base value; null when base is 0. */
export function formatDelta(
  current: number,
  previous: number
): { text: string; direction: "up" | "down" | "flat" } | null {
  if (previous <= 0) return null;
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.5) return { text: "±0%", direction: "flat" };
  const rounded = Math.abs(pct) >= 100 ? Math.round(pct) : pct.toFixed(0);
  return {
    text: `${pct > 0 ? "▲" : "▼"} ${Math.abs(Number(rounded))}%`,
    direction: pct > 0 ? "up" : "down",
  };
}

export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${Math.round(fraction * 100)}%`;
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * Stable categorical color per key (agent / model / kind). Hash-based
 * so colors don't shift when the set changes. Reds are deliberately
 * absent — Plot Red stays reserved for live state.
 */
const SERIES_PALETTE = [
  "oklch(60% 0.15 250)", // blue
  "oklch(60% 0.13 150)", // green
  "oklch(70% 0.13 75)", // ochre
  "oklch(58% 0.14 300)", // violet
  "oklch(62% 0.11 200)", // cyan
  "oklch(58% 0.13 340)", // magenta
  "oklch(58% 0.11 110)", // olive
  "oklch(55% 0.05 280)", // slate
];

export function seriesColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return SERIES_PALETTE[h % SERIES_PALETTE.length]!;
}

/** Fixed, semantic colors for the usage-kind split. */
export const KIND_COLORS: Record<string, string> = {
  interactive: "oklch(60% 0.15 250)",
  autonomous: "oklch(60% 0.13 150)",
  extractor: "oklch(70% 0.13 75)",
  title: "oklch(62% 0.11 200)",
  selector: "oklch(58% 0.14 300)",
  summarizer: "oklch(58% 0.13 340)",
};

export function kindColor(kind: string): string {
  return KIND_COLORS[kind] ?? seriesColor(kind);
}
