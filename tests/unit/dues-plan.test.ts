import { describe, expect, it } from "vitest";
import {
  annualFromPeriodCents,
  nextPeriodStartFor,
  perPeriodCents,
  periodStartFor,
  planStartsOn,
} from "@/lib/dues/plan";

describe("per-unit dues plan math", () => {
  it("splits a yearly amount by cadence, to the cent", () => {
    expect(perPeriodCents(540000, "monthly")).toBe(45000);
    expect(perPeriodCents(540000, "quarterly")).toBe(135000);
    expect(perPeriodCents(540000, "annual")).toBe(540000);
    expect(perPeriodCents(100000, "monthly")).toBe(8333);
  });
  it("recovers a yearly figure from an old per-period schedule", () => {
    expect(annualFromPeriodCents(45000, "monthly")).toBe(540000);
    expect(annualFromPeriodCents(135000, "quarterly")).toBe(540000);
  });
  it("knows this period and the next for each cadence", () => {
    const d = new Date(2026, 9, 15); // Oct 15
    expect(periodStartFor("monthly", d)).toBe("2026-10-01");
    expect(periodStartFor("quarterly", d)).toBe("2026-10-01");
    expect(periodStartFor("annual", d)).toBe("2026-01-01");
    expect(nextPeriodStartFor("monthly", d)).toBe("2026-11-01");
    expect(nextPeriodStartFor("quarterly", d)).toBe("2027-01-01");
    expect(nextPeriodStartFor("annual", d)).toBe("2027-01-01");
    expect(nextPeriodStartFor("monthly", new Date(2026, 11, 3))).toBe("2027-01-01");
  });
  it("a changed plan starts next period if this one is already charged", () => {
    const d = new Date(2026, 9, 15);
    expect(planStartsOn("monthly", d, false)).toBe("2026-10-01");
    expect(planStartsOn("monthly", d, true)).toBe("2026-11-01");
  });
});
