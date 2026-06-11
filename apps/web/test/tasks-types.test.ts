import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  STATUS_ORDER,
  STATUS_LABEL,
  STATUS_VARIANT,
  formatDate,
  formatAbsoluteFromUnix,
  formatRelativeFromUnix,
  formatRelativeFutureFromIso,
  dueUrgencyClass,
  shortRecurrenceLabel,
  type Recurrence,
} from "@/app/tasks/types";

const NOW = new Date("2026-06-12T12:00:00Z").getTime();
const NOW_SEC = Math.floor(NOW / 1000);
const isoAt = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const ISO_LOCAL_SHAPE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

describe("status constants", () => {
  it("STATUS_ORDER lists each status exactly once", () => {
    expect(new Set(STATUS_ORDER).size).toBe(STATUS_ORDER.length);
    expect(STATUS_ORDER).toHaveLength(5);
  });

  it("label and variant maps cover every status in STATUS_ORDER", () => {
    for (const status of STATUS_ORDER) {
      expect(STATUS_LABEL[status]).toBeTruthy();
      expect(STATUS_VARIANT[status]).toBeTruthy();
    }
    expect(Object.keys(STATUS_LABEL).sort()).toEqual([...STATUS_ORDER].sort());
    expect(Object.keys(STATUS_VARIANT).sort()).toEqual(
      [...STATUS_ORDER].sort()
    );
  });
});

describe("formatDate", () => {
  it("renders ISO-shape local time (sv-SE)", () => {
    const iso = "2026-01-02T03:04:05.000Z";
    const out = formatDate(iso);
    expect(out).toMatch(ISO_LOCAL_SHAPE);
    // Round-trip: parsing the local-time string back yields the same instant.
    expect(new Date(out.replace(" ", "T")).getTime()).toBe(
      new Date(iso).getTime()
    );
  });
});

describe("formatAbsoluteFromUnix", () => {
  it("matches formatDate for the same instant", () => {
    const sec = NOW_SEC;
    expect(formatAbsoluteFromUnix(sec)).toBe(
      formatDate(new Date(sec * 1000).toISOString())
    );
  });
});

describe("time-relative helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("formatRelativeFromUnix", () => {
    it("formats seconds, minutes, hours, days", () => {
      expect(formatRelativeFromUnix(NOW_SEC - 30)).toBe("30s ago");
      expect(formatRelativeFromUnix(NOW_SEC - 90)).toBe("1m ago");
      expect(formatRelativeFromUnix(NOW_SEC - 5 * 3600)).toBe("5h ago");
      expect(formatRelativeFromUnix(NOW_SEC - 3 * 86400)).toBe("3d ago");
    });

    it("clamps future timestamps to 0s ago", () => {
      expect(formatRelativeFromUnix(NOW_SEC + 500)).toBe("0s ago");
    });

    it("rolls over at unit boundaries", () => {
      expect(formatRelativeFromUnix(NOW_SEC - 59)).toBe("59s ago");
      expect(formatRelativeFromUnix(NOW_SEC - 60)).toBe("1m ago");
      expect(formatRelativeFromUnix(NOW_SEC - 3599)).toBe("59m ago");
      expect(formatRelativeFromUnix(NOW_SEC - 3600)).toBe("1h ago");
      expect(formatRelativeFromUnix(NOW_SEC - 86400)).toBe("1d ago");
    });
  });

  describe("formatRelativeFutureFromIso", () => {
    it("formats near-future deltas", () => {
      expect(formatRelativeFutureFromIso(isoAt(30 * 1000))).toBe("in <1m");
      expect(formatRelativeFutureFromIso(isoAt(5 * 60 * 1000))).toBe("in 5m");
      expect(formatRelativeFutureFromIso(isoAt(3 * 3600 * 1000))).toBe("in 3h");
      expect(formatRelativeFutureFromIso(isoAt(2 * 86400 * 1000))).toBe(
        "in 2d"
      );
    });

    it("falls back to absolute formatting for past timestamps", () => {
      const iso = isoAt(-60 * 1000);
      expect(formatRelativeFutureFromIso(iso)).toBe(formatDate(iso));
    });

    it("returns the input verbatim when unparseable", () => {
      expect(formatRelativeFutureFromIso("not-a-date")).toBe("not-a-date");
    });
  });

  describe("dueUrgencyClass", () => {
    it("returns undefined for missing values", () => {
      expect(dueUrgencyClass(null)).toBeUndefined();
      expect(dueUrgencyClass(undefined)).toBeUndefined();
      expect(dueUrgencyClass("")).toBeUndefined();
    });

    it("returns undefined for unparseable dates", () => {
      expect(dueUrgencyClass("not-a-date")).toBeUndefined();
    });

    it("flags overdue as destructive", () => {
      expect(dueUrgencyClass(isoAt(-1000))).toBe("text-destructive");
    });

    it("flags due-within-24h as warn-ochre", () => {
      expect(dueUrgencyClass(isoAt(60 * 60 * 1000))).toBe("text-warn-ochre");
      expect(dueUrgencyClass(isoAt(24 * 60 * 60 * 1000 - 1000))).toBe(
        "text-warn-ochre"
      );
    });

    it("leaves distant deadlines untinted", () => {
      expect(dueUrgencyClass(isoAt(25 * 60 * 60 * 1000))).toBeUndefined();
    });
  });
});

describe("shortRecurrenceLabel", () => {
  it("renders cron expr with and without tz", () => {
    const base: Recurrence = {
      kind: "cron",
      expr: "0 9 * * 1",
      session: "fresh",
    };
    expect(shortRecurrenceLabel(base)).toBe("0 9 * * 1");
    expect(shortRecurrenceLabel({ ...base, tz: "Asia/Kolkata" })).toBe(
      "0 9 * * 1 (Asia/Kolkata)"
    );
  });

  it("humanizes interval recurrences across units", () => {
    const interval = (every_ms: number): Recurrence => ({
      kind: "interval",
      every_ms,
      session: "reuse",
    });
    expect(shortRecurrenceLabel(interval(30 * 1000))).toBe("every 30s");
    expect(shortRecurrenceLabel(interval(5 * 60 * 1000))).toBe("every 5m");
    expect(shortRecurrenceLabel(interval(2 * 3600 * 1000))).toBe("every 2h");
    expect(shortRecurrenceLabel(interval(3 * 86400 * 1000))).toBe("every 3d");
  });
});
