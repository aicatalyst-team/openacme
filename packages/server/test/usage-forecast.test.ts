import { describe, expect, it } from "vitest";
import { computeForecast } from "../src/usage-forecast.js";

// 2026-06-12T12:00:00Z — June has 30 days, day-of-month 12.
const NOW = Math.floor(Date.parse("2026-06-12T12:00:00Z") / 1000);
const DAY = 86_400;

function day(offset: number): string {
  return new Date((NOW - (NOW % DAY) + offset * DAY) * 1000)
    .toISOString()
    .slice(0, 10);
}

describe("computeForecast", () => {
  it("steady state: rate = trailing-7 mean, projected over remaining days", () => {
    const byDay = new Map<string, number>();
    for (let i = 1; i <= 10; i++) byDay.set(day(-i), 2); // $2/day history
    byDay.set(day(0), 1); // today, partial
    const fc = computeForecast(byDay, NOW);
    expect(fc.dailyRateUsd).toBeCloseTo(2);
    // MTD = days Jun 2..11 within history (10 days × $2) + today $1 = 21
    expect(fc.monthToDateUsd).toBeCloseTo(21);
    // 30-day June, day 12 → 18 days remain at $2/day
    expect(fc.projectedMonthUsd).toBeCloseTo(21 + 36);
  });

  it("young ledger: window starts at first day, no zero-dilution", () => {
    // Ledger born 2 full days ago at $3/day. Flat /7 would give $0.86.
    const byDay = new Map<string, number>([
      [day(-2), 3],
      [day(-1), 3],
      [day(0), 0.5],
    ]);
    const fc = computeForecast(byDay, NOW);
    expect(fc.dailyRateUsd).toBeCloseTo(3);
    expect(fc.projectedMonthUsd).toBeCloseTo(6.5 + 3 * 18);
  });

  it("ledger born today: today's partial spend is the rate", () => {
    const byDay = new Map<string, number>([[day(0), 0.28]]);
    const fc = computeForecast(byDay, NOW);
    expect(fc.dailyRateUsd).toBeCloseTo(0.28);
    expect(fc.projectedMonthUsd).toBeCloseTo(0.28 + 0.28 * 18);
  });

  it("empty ledger projects zero", () => {
    const fc = computeForecast(new Map(), NOW);
    expect(fc.monthToDateUsd).toBe(0);
    expect(fc.projectedMonthUsd).toBe(0);
    expect(fc.anomaly.flagged).toBe(false);
  });

  it("quiet days inside the ledger's lifetime count as $0", () => {
    // Born 7 days ago, only spent on two of them.
    const byDay = new Map<string, number>([
      [day(-7), 7],
      [day(-3), 7],
    ]);
    const fc = computeForecast(byDay, NOW);
    expect(fc.dailyRateUsd).toBeCloseTo(2); // 14 / 7 real days
  });

  it("anomaly flags only with >=3 days history and >2.5x mean", () => {
    const spike = new Map<string, number>([
      [day(-1), 1],
      [day(-2), 1],
      [day(0), 10],
    ]);
    // Only 2 full days of history → never flags.
    expect(computeForecast(spike, NOW).anomaly.flagged).toBe(false);

    spike.set(day(-3), 1); // 3 days history, mean $1, today $10
    const fc = computeForecast(spike, NOW);
    expect(fc.anomaly.trailingMeanUsd).toBeCloseTo(1);
    expect(fc.anomaly.flagged).toBe(true);

    // Below the 2.5x line → quiet.
    spike.set(day(0), 2.4);
    expect(computeForecast(spike, NOW).anomaly.flagged).toBe(false);
  });

  it("month-to-date excludes last month's days", () => {
    const byDay = new Map<string, number>([
      ["2026-05-30", 50],
      [day(-1), 2],
      [day(0), 1],
    ]);
    const fc = computeForecast(byDay, NOW);
    expect(fc.monthToDateUsd).toBeCloseTo(3);
  });
});
