import { TabularTick } from "@/app/components/ui/tabular-tick";
import { cn } from "@/app/lib/utils";
import {
  formatCost,
  formatDelta,
  formatPercent,
  formatTokens,
} from "@/app/lib/format";
import type { UsageSummaryResponse } from "@/app/lib/types";

function Block({
  label,
  value,
  sub,
  accent,
  onClick,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  accent?: "green" | "blue" | "amber";
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      title={onClick ? "View in Activity" : undefined}
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1 border-r border-paper-rule px-4 py-3 text-left last:border-r-0",
        onClick && "transition-colors hover:bg-paper-sunk"
      )}
    >
      <span className="label-faceplate">{label}</span>
      <TabularTick
        value={value}
        className={cn(
          "text-xl leading-tight text-ink",
          accent === "green" && "text-signal-green",
          accent === "blue" && "text-signal-blue",
          accent === "amber" && "text-warn-ochre"
        )}
      />
      {sub && <span className="meta-row truncate text-ink-faint">{sub}</span>}
    </Tag>
  );
}

function DeltaNote({
  current,
  previous,
}: {
  current: number;
  previous: number;
}) {
  const d = formatDelta(current, previous);
  if (!d) return <>vs prior period: —</>;
  return (
    <span
      className={cn(
        d.direction === "up" && "text-warn-ochre",
        d.direction === "down" && "text-signal-green"
      )}
    >
      {d.text} vs prior period
    </span>
  );
}

/**
 * The summary band: spend, tokens, cache savings, turns, forecast.
 * Subscription-heavy workforces lead with equivalent cost (real spend
 * is $0); the sub-line says which one is shown.
 */
export function StatBlocks({
  summary,
  onTurnsClick,
}: {
  summary: UsageSummaryResponse;
  onTurnsClick?: () => void;
}) {
  const t = summary.totals;
  const p = summary.previous;
  const realSpend = t.costUsd > 0;
  const spend = realSpend ? t.costUsd : t.costUsdEquivalent;
  const prevSpend = realSpend ? p.costUsd : p.costUsdEquivalent;
  const cacheable = t.cachedInputTokens + t.inputTokens;
  const hitRate = t.inputTokens > 0 ? t.cachedInputTokens / t.inputTokens : 0;
  const turns =
    (t.eventsByKind["interactive"] ?? 0) + (t.eventsByKind["autonomous"] ?? 0);
  const overhead = t.events - turns;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap border-b border-paper-rule">
        <Block
          label={realSpend ? "Spend" : "Spend · subscription eq."}
          value={formatCost(spend)}
          sub={<DeltaNote current={spend} previous={prevSpend} />}
        />
        <Block
          label="Tokens"
          value={formatTokens(t.totalTokens)}
          sub={`${formatTokens(t.inputTokens)} in · ${formatTokens(t.outputTokens)} out`}
        />
        <Block
          label="Cache savings"
          value={formatCost(summary.cacheSavingsUsd)}
          accent="green"
          sub={
            cacheable > 0
              ? `${formatPercent(hitRate)} of input read from cache`
              : "no cached traffic yet"
          }
        />
        <Block
          label="Turns"
          value={String(turns)}
          onClick={onTurnsClick}
          sub={`${t.eventsByKind["interactive"] ?? 0} interactive · ${t.eventsByKind["autonomous"] ?? 0} autonomous · ${overhead} overhead`}
        />
        <Block
          label="Projected month"
          value={formatCost(summary.forecast.projectedMonthUsd)}
          accent={summary.anomaly.flagged ? "amber" : undefined}
          sub={`${formatCost(summary.forecast.monthToDateUsd)} month to date`}
        />
      </div>
      {summary.anomaly.flagged && (
        <div className="border-b border-paper-rule bg-paper-sunk px-4 py-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-warn-ochre">
            Anomaly
          </span>
          <span className="meta-row ml-3 text-ink-soft">
            today {formatCost(summary.anomaly.todayUsd)} is{" "}
            {(summary.anomaly.todayUsd / summary.anomaly.trailingMeanUsd).toFixed(1)}
            × the trailing 14-day mean ({formatCost(summary.anomaly.trailingMeanUsd)}
            /day)
          </span>
        </div>
      )}
    </div>
  );
}
