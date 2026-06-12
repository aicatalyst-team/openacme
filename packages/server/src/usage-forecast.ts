/**
 * Month-end forecast + spend-anomaly heuristics over per-UTC-day cost
 * sums. Pure math, no store access — the route feeds it a day→USD map.
 *
 * Both stats window from the LEDGER's first recorded day, never
 * earlier: days before metering existed are unknown, not $0. A flat
 * trailing-N divisor would dilute the run rate toward zero on young
 * installs (projection collapses to month-to-date) and deflate the
 * anomaly baseline (everything flags).
 */

const DAY_S = 86_400;
const FORECAST_WINDOW_DAYS = 7;
const ANOMALY_WINDOW_DAYS = 14;
/** Full days of history required before an anomaly can be called. */
const ANOMALY_MIN_HISTORY_DAYS = 3;
const ANOMALY_FACTOR = 2.5;

export interface ForecastResult {
  monthToDateUsd: number;
  projectedMonthUsd: number;
  /** Daily run rate the projection used (USD/day). */
  dailyRateUsd: number;
  anomaly: { todayUsd: number; trailingMeanUsd: number; flagged: boolean };
}

function dayKey(epochS: number): string {
  return new Date(epochS * 1000).toISOString().slice(0, 10);
}

/**
 * @param byDay  UTC day (`YYYY-MM-DD`) → cost USD. Days with no usage
 *               may be absent; within the ledger's lifetime they count
 *               as $0 (a quiet workforce is a real signal).
 * @param nowS   Current time, epoch seconds.
 */
export function computeForecast(
  byDay: ReadonlyMap<string, number>,
  nowS: number
): ForecastResult {
  const todayStart = nowS - (nowS % DAY_S);
  const todayKey = dayKey(nowS);
  const d = new Date(nowS * 1000);
  const monthStartKey = dayKey(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
  );
  const daysInMonth = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const dayOfMonth = d.getUTCDate();

  let monthToDateUsd = 0;
  let firstDay: string | null = null;
  for (const [day, v] of byDay) {
    if (day >= monthStartKey && day <= todayKey) monthToDateUsd += v;
    if (v > 0 && (firstDay === null || day < firstDay)) firstDay = day;
  }
  const todayUsd = byDay.get(todayKey) ?? 0;

  // Full days [max(firstDay, today−N) .. yesterday], divided by the
  // window's actual length. Newborn ledger (first event today, or no
  // events): today's partial spend is the only signal — use it as the
  // per-day rate rather than projecting zero.
  const windowSum = (days: number): { sum: number; n: number } => {
    let sum = 0;
    let n = 0;
    for (let i = 1; i <= days; i++) {
      const key = dayKey(todayStart - i * DAY_S);
      if (firstDay !== null && key < firstDay) break;
      sum += byDay.get(key) ?? 0;
      n++;
    }
    return { sum, n };
  };

  const fc = windowSum(FORECAST_WINDOW_DAYS);
  const dailyRateUsd = fc.n > 0 ? fc.sum / fc.n : todayUsd;
  const projectedMonthUsd =
    monthToDateUsd + dailyRateUsd * Math.max(0, daysInMonth - dayOfMonth);

  const an = windowSum(ANOMALY_WINDOW_DAYS);
  const trailingMeanUsd = an.n > 0 ? an.sum / an.n : 0;
  const flagged =
    an.n >= ANOMALY_MIN_HISTORY_DAYS &&
    trailingMeanUsd > 0 &&
    todayUsd > ANOMALY_FACTOR * trailingMeanUsd;

  return {
    monthToDateUsd,
    projectedMonthUsd,
    dailyRateUsd,
    anomaly: { todayUsd, trailingMeanUsd, flagged },
  };
}
