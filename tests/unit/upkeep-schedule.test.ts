import { describe, expect, it } from "vitest";
import {
  addMonthsClamped, allowsDueMonth, anchorMonths, cadenceWords, endOfMonth, initialNextDue, nextDueAfter, statusFor,
  templateForName, UPKEEP_TEMPLATES, daysUntil,
} from "@/lib/upkeep/schedule";
import { isTradeSlug } from "@/lib/contractors/trades";
import { UPKEEP_CASES } from "../fixtures/upkeep-cases";

describe("upkeep schedule", () => {
  it.each(UPKEEP_CASES)("nextDueAfter($doneOn, $interval, $month) is $expected: $why", ({ doneOn, interval, month, expected }) => {
    expect(nextDueAfter(doneOn, interval, month)).toBe(expected);
  });

  it("rolls forward by the interval, landing seasonal work on the month end", () => {
    expect(nextDueAfter("2026-09-14", 12, 9)).toBe("2027-09-30");
    // Done late (October) for a September job: still next September, not October.
    expect(nextDueAfter("2026-10-20", 12, 9)).toBe("2027-09-30");
    // Done early (July) for a September job: next year's September, not this year's.
    expect(nextDueAfter("2026-07-02", 12, 9)).toBe("2027-09-30");
    expect(nextDueAfter("2026-03-10", 6, null)).toBe("2026-09-10");
    // Month-end clamp instead of day 28.
    expect(nextDueAfter("2026-05-31", 1, null)).toBe("2026-06-30");
  });

  it("starts a new task on the first anchor month-end on or after today, or a month out", () => {
    const today = "2026-10-14";
    expect(initialNextDue(today, 12, 10)).toBe("2026-10-31"); // Snow removal: due this month, not overdue
    expect(initialNextDue(today, 12, 11)).toBe("2026-11-30"); // Gutters
    expect(initialNextDue(today, 12, 9)).toBe("2027-09-30"); // Boiler
    expect(initialNextDue(today, 6, null)).toBe("2026-11-14"); // Smoke and CO batteries
    expect(initialNextDue(today, 12, 9, "2026-09-20")).toBe("2027-09-30"); // Boiler, last done given
    expect(initialNextDue("2026-10-01", 12, 10)).toBe("2026-10-31");
    expect(initialNextDue("2026-10-01", 12, null)).toBe("2026-11-01");
    // Sub-annual anchors: every 6 months in April and October, added in November.
    expect(initialNextDue("2026-11-02", 6, 4)).toBe("2027-04-30");
    expect(initialNextDue("2026-05-02", 6, 4)).toBe("2026-10-31");
    expect(initialNextDue("2026-01-31", 1, null)).toBe("2026-02-28");
  });

  it("allows a preferred month only for intervals that divide a year or are whole years", () => {
    for (const n of [2, 3, 4, 6, 12, 24, 36, 120]) expect(allowsDueMonth(n)).toBe(true);
    for (const n of [1, 5, 7, 8, 9, 10, 11, 18, 0]) expect(allowsDueMonth(n)).toBe(false);
  });

  it("lists anchor months", () => {
    expect(anchorMonths(6, 4)).toEqual([4, 10]);
    expect(anchorMonths(6, 10)).toEqual([4, 10]);
    expect(anchorMonths(3, 1)).toEqual([1, 4, 7, 10]);
    expect(anchorMonths(4, 2)).toEqual([2, 6, 10]);
    expect(anchorMonths(12, 9)).toEqual([9]);
    expect(anchorMonths(24, 5)).toEqual([5]);
  });

  it("adds months with a month-end clamp, leap years included", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2028-02-29", 12)).toBe("2029-02-28");
    expect(addMonthsClamped("2028-02-29", 48)).toBe("2032-02-29");
    expect(addMonthsClamped("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonthsClamped("2026-11-15", 3)).toBe("2027-02-15");
    expect(endOfMonth(2028, 2)).toBe("2028-02-29");
    expect(endOfMonth(2100, 2)).toBe("2100-02-28");
    expect(endOfMonth(2026, 12)).toBe("2026-12-31");
  });

  it("describes state against today", () => {
    expect(statusFor("2026-09-01", "2026-10-01")).toBe("overdue");
    expect(statusFor("2026-11-15", "2026-10-01")).toBe("due_soon");
    expect(statusFor("2027-04-01", "2026-10-01")).toBe("scheduled");
  });

  it("says the cadence in words, with every anchor month", () => {
    expect(cadenceWords(12, 9)).toBe("every year, in September");
    expect(cadenceWords(6, null)).toBe("every 6 months");
    expect(cadenceWords(24, 5)).toBe("every 2 years, in May");
    expect(cadenceWords(6, 4)).toBe("every 6 months, in April and October");
    expect(cadenceWords(3, 1)).toBe("every 3 months, in January, April, July and October");
    expect(cadenceWords(1, null)).toBe("every month");
  });

  it("templates are well-formed and mapped to trades", () => {
    for (const t of UPKEEP_TEMPLATES) {
      expect(t.interval_months).toBeGreaterThan(0);
      if (t.due_month !== null) {
        expect(t.due_month).toBeGreaterThanOrEqual(1);
        expect(allowsDueMonth(t.interval_months)).toBe(true);
      }
      expect(isTradeSlug(t.trade)).toBe(true);
      expect(t.searchPhrase).toMatch(/^[a-z]+( [a-z]+)*$/);
      expect(`${t.name} ${t.description}`).not.toMatch(/—/);
    }
    expect(new Set(UPKEEP_TEMPLATES.map((t) => t.name)).size).toBe(UPKEEP_TEMPLATES.length);
    expect(UPKEEP_TEMPLATES).toHaveLength(18);
    expect(UPKEEP_TEMPLATES.filter((t) => !t.defaultChecked).map((t) => t.trade).sort()).toEqual(["chimney", "elevator", "tree", "windows"]);
    expect(templateForName("boiler / furnace service")?.trade).toBe("hvac");
    expect(templateForName("Sewer line rodded")?.searchPhrase).toBe("sewer rodding");
    expect(templateForName("Paint the lobby")).toBeNull();
  });
});

// Was the reviewer's scratch tz.test.ts: daysUntil is a calendar-day count, so a daylight
// saving change anywhere in the span cannot move a status. Checked against plain UTC day arithmetic.
describe("daysUntil is exact across daylight saving", () => {
  it("equals the UTC calendar difference for 1, 59, 60, 61 and 400 days from every start date over four years", () => {
    const bad: unknown[] = [];
    for (let i = 0; i < 1500; i++) {
      for (const k of [1, 59, 60, 61, 400]) {
        const a = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
        const b = new Date(Date.UTC(2025, 0, 1 + i + k)).toISOString().slice(0, 10);
        if (daysUntil(b, a) !== k) bad.push({ a, b, k, got: daysUntil(b, a) });
      }
    }
    expect(bad.slice(0, 3)).toEqual([]);
  });
  it("is negative for the past and zero for today", () => {
    expect(daysUntil("2026-03-07", "2026-03-08")).toBe(-1);
    expect(daysUntil("2026-03-08", "2026-03-08")).toBe(0);
    expect(daysUntil("2026-11-01", "2026-10-31")).toBe(1);
  });
});

describe("bad input never reads as fine (REVIEW-4 #15)", () => {
  it("an unreadable due date is overdue, and a non-number interval steps one month", () => {
    expect(statusFor("garbage", "2026-10-14")).toBe("overdue");
    expect(nextDueAfter("2026-01-31", Number.NaN, null)).toBe("2026-02-28");
  });
});
