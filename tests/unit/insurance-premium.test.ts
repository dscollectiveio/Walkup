import { describe, expect, it } from "vitest";
import {
  addMonthsClamped,
  changePercent,
  frequencyFor,
  perUnitCost,
  premiumBillRetires,
  premiumSchedule,
  premiumTotals,
} from "@/lib/insurance/premium";
import { PREMIUM_ADVANCE_CASES } from "../fixtures/premium-cases";

const policy = (payment_schedule: string, effective_from = "2026-03-01", effective_to = "2027-03-01", annual_premium = "4000.00") => ({
  annual_premium, payment_schedule, effective_from, effective_to,
});

function dayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe("premiumSchedule", () => {
  it("annual: next due is the start when it's ahead, else the renewal date", () => {
    expect(premiumSchedule(policy("annual"), "2026-02-01").nextDueOn).toBe("2026-03-01");
    expect(premiumSchedule(policy("annual"), "2026-03-01").nextDueOn).toBe("2026-03-01");
    expect(premiumSchedule(policy("annual"), "2026-03-02").nextDueOn).toBe("2027-03-01");
    expect(premiumSchedule(policy("annual"), "2026-03-02").installments).toBe(1);
  });

  it("quarterly from Mar 1, on Oct 14: Dec 1", () => {
    const s = premiumSchedule(policy("quarterly"), "2026-10-14");
    expect(s.dueDates).toEqual(["2026-03-01", "2026-06-01", "2026-09-01", "2026-12-01"]);
    expect(s.nextDueOn).toBe("2026-12-01");
    expect(s.frequency).toBe("quarterly");
  });

  it("monthly from Jan 31 clamps to the month's end, counted from the start, never chained", () => {
    const s = premiumSchedule(policy("monthly", "2026-01-31", "2027-01-31", "1200.00"), "2026-02-01");
    expect(s.dueDates.slice(0, 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(s.nextDueOn).toBe("2026-02-28");
    expect(premiumSchedule(policy("monthly", "2027-01-31", "2028-01-31", "1200.00"), "2028-02-01").dueDates).toContain("2027-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("splits the cents with the remainder on the first installment", () => {
    const s = premiumSchedule({ ...policy("annual"), annual_premium: "1000.00", payment_schedule: "unknown" }, "2026-01-01");
    expect(s.frequency).toBe("annual");
    const q = premiumSchedule({ annual_premium: "1000.00", payment_schedule: "semi_annual", effective_from: "2026-01-01", effective_to: "2027-01-01" }, "2026-01-01");
    expect(q.frequency).toBe("semiannual");
    const thirds = premiumSchedule({ annual_premium: "1000.00", payment_schedule: "quarterly", effective_from: "2026-01-01", effective_to: "2026-10-01" }, "2026-01-01");
    // A 9-month term has 3 quarterly installments.
    expect(thirds.installments).toBe(3);
    expect(thirds.firstInstallment).toBe("333.34");
    expect(thirds.perInstallment).toBe("333.33");
  });

  it("unknown and odd schedules are annual", () => {
    expect(frequencyFor("unknown")).toBe("annual");
    expect(frequencyFor("whenever")).toBe("annual");
    expect(frequencyFor("semi_annual")).toBe("semiannual");
  });

  it("matches insurance_premium_bill_advance on the shared cases", () => {
    for (const c of PREMIUM_ADVANCE_CASES) {
      const today = dayAfter(c.paidDueOn);
      expect(premiumBillRetires(c.policy, c.successorStart, today), c.name).toBe(c.expected === null);
      if (c.expected !== null) expect(premiumSchedule(c.policy, today).nextDueOn, c.name).toBe(c.expected);
    }
  });
});

describe("premiumBillRetires", () => {
  it("quarterly with a successor starting Mar 1, on Dec 2: retires; with no successor: doesn't", () => {
    expect(premiumBillRetires(policy("quarterly"), "2027-03-01", "2026-12-02")).toBe(true);
    expect(premiumBillRetires(policy("quarterly"), null, "2026-12-02")).toBe(false);
    expect(premiumBillRetires(policy("quarterly"), "2027-03-01", "2026-10-14")).toBe(false);
  });
});

describe("cost figures", () => {
  it("perUnitCost", () => {
    expect(perUnitCost("3766.00", 3)).toEqual({ perYear: "1255.33", perMonth: "104.61" });
    expect(perUnitCost("3766.00", 0)).toBeNull();
  });

  it("changePercent", () => {
    expect(changePercent("0.00", "100.00")).toBeNull();
    expect(changePercent("1000.00", "1200.00")).toBe("20.0");
    expect(changePercent("3348.00", "3766.00")).toBe("12.5");
    expect(changePercent("1200.00", "1000.00")).toBe("-16.7");
    expect(changePercent("1000.00", "1000.00")).toBe("0.0");
  });

  it("premiumTotals", () => {
    expect(premiumTotals([{ annual_premium: "3766.00" }, { annual_premium: "1200.50" }])).toBe("4966.50");
    expect(premiumTotals([])).toBe("0.00");
  });
});
