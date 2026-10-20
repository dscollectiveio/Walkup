import { describe, expect, it } from "vitest";
import { billTotals, monthIndex } from "@/lib/upkeep/bill-totals";

const bill = (over = {}) => ({ frequency: "monthly" as const, next_due_on: "2026-10-15", typical_amount: "100.00", category: "Utilities", ...over });
const OCT = monthIndex(2026, 10);
const JAN = monthIndex(2026, 1);
const DEC = monthIndex(2026, 12);

describe("billTotals", () => {
  it("adds a monthly bill once in a month and twelve times in a year", () => {
    expect(billTotals([bill()], OCT, OCT)).toMatchObject({ totalCents: 10000, payments: 1 });
    expect(billTotals([bill()], JAN, DEC)).toMatchObject({ totalCents: 120000, payments: 12 });
  });

  it("puts a quarterly bill only in the months it falls on, past and future", () => {
    const q = bill({ frequency: "quarterly", next_due_on: "2026-11-01", typical_amount: "300.00" });
    expect(billTotals([q], OCT, OCT).payments).toBe(0);
    expect(billTotals([q], monthIndex(2026, 11), monthIndex(2026, 11)).totalCents).toBe(30000);
    // Feb, May, Aug and Nov of 2026.
    expect(billTotals([q], JAN, DEC)).toMatchObject({ payments: 4, totalCents: 120000 });
  });

  it("counts an annual bill once a year, wherever its date sits relative to today", () => {
    const a = bill({ frequency: "annual", next_due_on: "2027-03-10", typical_amount: "1200.00" });
    expect(billTotals([a], JAN, DEC)).toMatchObject({ payments: 1, totalCents: 120000 });
    expect(billTotals([a], monthIndex(2026, 3), monthIndex(2026, 3)).payments).toBe(1);
    expect(billTotals([a], monthIndex(2026, 4), monthIndex(2026, 4)).payments).toBe(0);
  });

  it("counts a bill with no amount but adds nothing for it, and says so", () => {
    const t = billTotals([bill(), bill({ typical_amount: null })], OCT, OCT);
    expect(t).toMatchObject({ totalCents: 10000, payments: 2, withoutAmount: 1 });
  });

  it("skips a bill with no due date", () => {
    expect(billTotals([bill({ next_due_on: null })], JAN, DEC).payments).toBe(0);
  });

  it("groups by category, biggest first", () => {
    const t = billTotals([bill({ category: "Insurance", typical_amount: "500.00" }), bill()], OCT, OCT);
    expect(t.byCategory).toEqual([
      { label: "Insurance", valueCents: 50000 },
      { label: "Utilities", valueCents: 10000 },
    ]);
  });
});
