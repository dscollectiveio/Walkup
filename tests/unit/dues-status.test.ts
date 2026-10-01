import { describe, expect, it } from "vitest";
import {
  lateFeeProposals,
  standingFor,
  suggestUnitForDeposit,
  type ChargeLine,
  type UnitHint,
} from "@/lib/dues/status";

const charge = (over: Partial<ChargeLine>): ChargeLine => ({
  id: "c1",
  unit_id: "u1",
  charge_type: "assessment",
  period_start: "2026-10-01",
  due_on: "2026-10-01",
  amountCents: 45000,
  balanceCents: 45000,
  status: "open",
  days_overdue: 0,
  ...over,
});

describe("standingFor", () => {
  const today = "2026-10-15";
  it("is behind when something is owed past its due date", () => {
    expect(standingFor([charge({ due_on: "2026-10-01" })], 0, today)).toEqual({
      standing: "behind",
      owedCents: 45000,
      overdueCents: 45000,
    });
  });
  it("is current when owed but not yet due, or when nothing is owed", () => {
    expect(standingFor([charge({ due_on: "2026-11-01" })], 0, today).standing).toBe("current");
    expect(standingFor([charge({ status: "paid", balanceCents: 0 })], 0, today).standing).toBe("current");
  });
  it("is paid ahead with a credit and nothing owed", () => {
    expect(standingFor([charge({ status: "paid", balanceCents: 0 })], 45000, today).standing).toBe("ahead");
  });
  it("is not charged yet with no charges at all", () => {
    expect(standingFor([], 0, today).standing).toBe("not_charged");
  });
});

describe("lateFeeProposals", () => {
  const rule = { amountCents: 2500, graceDays: 15 };
  it("proposes one fee per overdue assessment past grace, oldest first", () => {
    const out = lateFeeProposals(
      [
        charge({ id: "a", unit_id: "u1", period_start: "2026-09-01", days_overdue: 44 }),
        charge({ id: "b", unit_id: "u1", period_start: "2026-10-01", days_overdue: 14 }),
        charge({ id: "c", unit_id: "u2", period_start: "2026-10-01", days_overdue: 20 }),
      ],
      rule,
    );
    expect(out.map((p) => p.charge_id)).toEqual(["a", "c"]);
    expect(out[0].amountCents).toBe(2500);
  });
  it("never proposes twice for the same period, and never a fee on a fee", () => {
    const out = lateFeeProposals(
      [
        charge({ id: "a", period_start: "2026-09-01", days_overdue: 44 }),
        charge({ id: "f", charge_type: "late_fee", period_start: "2026-09-01", days_overdue: 30, amountCents: 2500, balanceCents: 2500 }),
      ],
      rule,
    );
    expect(out).toEqual([]);
  });
  it("proposes nothing until the board sets a rule", () => {
    expect(lateFeeProposals([charge({ days_overdue: 90 })], { amountCents: null, graceDays: null })).toEqual([]);
  });
});

describe("suggestUnitForDeposit", () => {
  const units: UnitHint[] = [
    { unit_id: "u1", label: "Unit 1", ownerNames: ["Ada Lovelace"], owedCents: 45000, perPeriodCents: 45000 },
    { unit_id: "u2", label: "Unit 2", ownerNames: ["Bo Diddley"], owedCents: 90000, perPeriodCents: 45000 },
    { unit_id: "u3", label: "Unit 3", ownerNames: ["Cy Twombly"], owedCents: 0, perPeriodCents: 50000 },
  ];
  it("trusts a name in the description", () => {
    expect(suggestUnitForDeposit({ description: "ZELLE FROM BO DIDDLEY", amountCents: 45000 }, units)).toMatchObject({
      unit_id: "u2",
      confidence: "high",
    });
  });
  it("uses the exact amount owed when there's no name", () => {
    expect(suggestUnitForDeposit({ description: "MOBILE DEPOSIT", amountCents: 90000 }, units)).toMatchObject({
      unit_id: "u2",
      confidence: "medium",
      reason: "it's exactly what the unit owes",
    });
  });
  it("stays quiet on a tie", () => {
    // $450 is one period's dues for both Unit 1 and Unit 2, and what Unit 1 owes — Unit 1 wins on owed.
    expect(suggestUnitForDeposit({ description: "DEPOSIT", amountCents: 45000 }, units)?.unit_id).toBe("u1");
    // $500 matches only Unit 3's period amount.
    expect(suggestUnitForDeposit({ description: "DEPOSIT", amountCents: 50000 }, units)?.unit_id).toBe("u3");
    // Nothing matches.
    expect(suggestUnitForDeposit({ description: "DEPOSIT", amountCents: 12345 }, units)).toBeNull();
  });
  it("an owner's own report is as good as a name", () => {
    const r = suggestUnitForDeposit(
      { description: "ONLINE TRANSFER", amountCents: 45000 },
      units,
      [{ unit_id: "u3", amountCents: 45000, paid_on: "2026-10-03" }],
      "2026-10-05",
    );
    expect(r).toMatchObject({ unit_id: "u3", confidence: "high" });
    expect(r?.reason).toContain("reported");
  });
});
