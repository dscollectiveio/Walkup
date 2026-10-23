import { describe, expect, it } from "vitest";
import { tierChangeNeeded, tierChangeReady, type TierFacts } from "@/lib/billing/tier";

const NOW = new Date("2026-10-23T18:00:00Z");
const facts = (over: Partial<TierFacts> = {}): TierFacts => ({
  planKey: "starter",
  interval: "year",
  currentPeriodEnd: "2027-03-01T06:00:00Z",
  unitCount: 9,
  noticeEmailedAt: null,
  ...over,
});

describe("tier changes at renewal", () => {
  it("says nothing while the unit count still fits the plan, or the plan is unknown", () => {
    expect(tierChangeNeeded(facts({ unitCount: 5 }), NOW)).toBeNull();
    expect(tierChangeNeeded(facts({ planKey: null }), NOW)).toBeNull();
    expect(tierChangeNeeded(facts({ unitCount: 40 }), NOW)).toBeNull(); // above the largest tier: a person handles it
  });

  it("notices a yearly plan for its next renewal, in words, with both prices", () => {
    const n = tierChangeNeeded(facts(), NOW);
    expect(n).toMatchObject({ toPlan: "building", effectiveOn: "2027-03-01" });
    expect(n?.detail).toContain("9 units");
    expect(n?.detail).toContain("from Starter ($190 a year) to Building ($390 a year)");
    expect(n?.detail).not.toContain("—");
  });

  it("gives a monthly plan a renewal at least 31 days away, never the next one if it is too close", () => {
    // A monthly plan renewing in 12 days: that renewal is under the 30 days, so the change waits for the one after the next.
    const n = tierChangeNeeded(facts({ interval: "month", currentPeriodEnd: "2026-11-04T06:00:00Z" }), NOW);
    expect(n?.effectiveOn).toBe("2026-12-04");
    expect(n?.effectiveOn).not.toBe("2026-11-04");
    // A monthly renewal 34 days away is far enough: that very renewal is the one named.
    const far = tierChangeNeeded(facts({ interval: "month", currentPeriodEnd: "2026-11-26T06:00:00Z" }), NOW);
    expect(far?.effectiveOn).toBe("2026-11-26");
  });

  it("moves a plan at Stripe only for the renewal the notice named, 30 days after it went out, and only in the last 3 days", () => {
    const base = facts({ currentPeriodEnd: "2026-10-25T06:00:00Z", noticeEmailedAt: "2026-09-20T12:00:00Z" });
    expect(tierChangeReady(base, NOW)).toBe("building");
    // No email yet, or an email less than 30 days before the renewal.
    expect(tierChangeReady({ ...base, noticeEmailedAt: null }, NOW)).toBeNull();
    expect(tierChangeReady({ ...base, noticeEmailedAt: "2026-10-01T12:00:00Z" }, NOW)).toBeNull();
    // The renewal is not close yet, or has passed.
    expect(tierChangeReady({ ...base, currentPeriodEnd: "2026-11-25T06:00:00Z" }, NOW)).toBeNull();
    expect(tierChangeReady({ ...base, currentPeriodEnd: "2026-10-20T06:00:00Z" }, NOW)).toBeNull();
    // The count no longer calls for another tier.
    expect(tierChangeReady({ ...base, unitCount: 5 }, NOW)).toBeNull();
  });
});
