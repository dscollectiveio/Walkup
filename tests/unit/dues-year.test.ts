import { describe, expect, it } from "vitest";
import { additionalProgress, duesPaidCents, quarterOf, rolledOverCents, yearProgress } from "@/lib/dues/year";

describe("a unit's dues year in four quarters", () => {
  it("knows which quarter a date is in", () => {
    expect(["2026-01-01", "2026-03-31", "2026-04-01", "2026-09-30", "2026-10-16", "2026-12-31"].map(quarterOf)).toEqual([1, 1, 2, 3, 4, 4]);
  });

  it("splits the yearly amount into four equal shares", () => {
    const p = yearProgress(540000, 0, "2026-10-16");
    expect(p.quarters.map((q) => q.targetCents)).toEqual([135000, 135000, 135000, 135000]);
    expect(p.remainingCents).toBe(540000);
  });

  it("gives odd cents to the last quarter so the shares add up exactly", () => {
    const p = yearProgress(100001, 0, "2026-02-01");
    expect(p.quarters.map((q) => q.targetCents)).toEqual([25000, 25000, 25000, 25001]);
    expect(p.quarters.reduce((s, q) => s + q.targetCents, 0)).toBe(100001);
  });

  it("fills the bar with the money paid, quarter by quarter", () => {
    const p = yearProgress(540000, 202500, "2026-10-16"); // $5,400 a year, $2,025 paid
    expect(p.quarters.map((q) => q.filledCents)).toEqual([135000, 67500, 0, 0]);
    expect(p.quarters.map((q) => q.pct)).toEqual([100, 50, 0, 0]);
    expect(p.remainingCents).toBe(337500);
    expect(p.aheadCents).toBe(0);
  });

  it("marks the current quarter", () => {
    expect(yearProgress(400000, 0, "2026-05-10").quarters.map((q) => q.current)).toEqual([false, true, false, false]);
  });

  it("says behind only about quarters that have fully passed", () => {
    // In Q4 with $0 paid, Q1 to Q3 have passed unpaid.
    expect(yearProgress(540000, 0, "2026-10-16").behind).toBe(true);
    // Paid through Q3 in Q4: not behind, even though Q4's share is unpaid.
    expect(yearProgress(540000, 405000, "2026-10-16").behind).toBe(false);
    // In Q1 nothing has fully passed, so nobody is behind.
    expect(yearProgress(540000, 0, "2026-02-01").behind).toBe(false);
  });

  it("shows paying beyond the year as ahead, with every quarter full", () => {
    const p = yearProgress(100000, 130000, "2026-06-01");
    expect(p.quarters.every((q) => q.pct === 100)).toBe(true);
    expect(p.aheadCents).toBe(30000);
    expect(p.remainingCents).toBe(0);
  });

  it("handles no plan without dividing by zero", () => {
    const p = yearProgress(0, 5000, "2026-06-01");
    expect(p.quarters.map((q) => q.pct)).toEqual([0, 0, 0, 0]);
    expect(p.behind).toBe(false);
  });

  it("adds labeled bank deposits and hand-recorded payments, less fees and one-offs", () => {
    // Three deposits labeled dues.
    expect(duesPaidCents({ bankCents: [45000, 45000, 45000], otherPaymentCents: [], appliedToFeesCents: 0 })).toBe(135000);
    // Two deposits plus a $200 check, $50 of the money went to a late fee.
    expect(duesPaidCents({ bankCents: [45000, 45000], otherPaymentCents: [20000], appliedToFeesCents: 5000 })).toBe(105000);
    // Never below zero.
    expect(duesPaidCents({ bankCents: [1000], otherPaymentCents: [], appliedToFeesCents: 5000 })).toBe(0);
    expect(duesPaidCents({ bankCents: [], otherPaymentCents: [], appliedToFeesCents: 0 })).toBe(0);
  });

  it("takes money applied to a required additional assessment out of regular dues", () => {
    expect(
      duesPaidCents({ bankCents: [100000], otherPaymentCents: [], appliedToFeesCents: 0, appliedToAdditionalCents: 30000 }),
    ).toBe(70000);
  });
});

describe("Additional Agreed Assessments", () => {
  it("rolls over only what regular dues paid beyond the yearly plan", () => {
    expect(rolledOverCents(600000, 540000)).toBe(60000);
    expect(rolledOverCents(540000, 540000)).toBe(0);
    expect(rolledOverCents(300000, 540000)).toBe(0);
  });

  it("rolls nothing over when the unit has no dues plan", () => {
    expect(rolledOverCents(600000, 0)).toBe(0);
  });

  it("adds contributions, payments applied to the charge and the roll-over, on its own bar", () => {
    const p = additionalProgress(150000, { contributedCents: 25000, appliedToChargeCents: 0, rolledOverCents: 50000 });
    expect(p.givenCents).toBe(75000);
    expect(p.pct).toBe(50);
    expect(p.remainingCents).toBe(75000);
    expect(p.aheadCents).toBe(0);
  });

  it("shows giving beyond the agreed amount as ahead with a full bar", () => {
    const p = additionalProgress(100000, { contributedCents: 100000, appliedToChargeCents: 0, rolledOverCents: 20000 });
    expect(p.pct).toBe(100);
    expect(p.aheadCents).toBe(20000);
    expect(p.remainingCents).toBe(0);
  });

  it("handles no agreed amount without dividing by zero", () => {
    expect(additionalProgress(0, { contributedCents: 5000, appliedToChargeCents: 0, rolledOverCents: 0 }).pct).toBe(0);
  });
});

