import { describe, expect, it } from "vitest";
import { moneyAnswer, ownerStanding, type UnitSummary } from "@/lib/owner/standing";

const base: UnitSummary = {
  unit_id: "u1",
  unit_label: "Unit 2",
  as_of: "2026-10-14",
  owed: "0.00",
  overdue: "0.00",
  credit: "0.00",
  net: "0.00",
  open_charges: 0,
  oldest_overdue_on: null,
  next_due_on: null,
  next_due_amount: null,
  last_payment_on: null,
  last_payment_amount: null,
};
const s = (o: Partial<UnitSummary>): UnitSummary => ({ ...base, ...o });
const TODAY = "2026-10-14";

describe("ownerStanding", () => {
  it("behind when anything is overdue", () => {
    expect(ownerStanding(s({ owed: "750.00", overdue: "750.00", net: "750.00", open_charges: 1 }), true, TODAY)).toBe("behind");
  });
  it("due soon when it owes but nothing is late", () => {
    expect(ownerStanding(s({ owed: "750.00", net: "750.00", open_charges: 1 }), true, TODAY)).toBe("due_soon");
  });
  it("ahead when it owes nothing and holds unapplied money", () => {
    expect(ownerStanding(s({ credit: "250.00", net: "-250.00" }), true, TODAY)).toBe("ahead");
  });
  it("current when it owes nothing and has history", () => {
    expect(ownerStanding(s({}), true, TODAY)).toBe("current");
    expect(ownerStanding(s({ last_payment_on: "2026-10-01", last_payment_amount: "750.00" }), false, TODAY)).toBe("current");
  });
  it("not charged when nothing ever happened", () => {
    expect(ownerStanding(s({}), false, TODAY)).toBe("not_charged");
  });
  it("behind while something is still overdue after the unapplied money is counted", () => {
    expect(ownerStanding(s({ owed: "750.00", overdue: "750.00", credit: "100.00", net: "650.00", open_charges: 1 }), true, TODAY)).toBe("behind");
  });
  it("the net rule: unapplied money that covers what is overdue is not behind", () => {
    expect(ownerStanding(s({ owed: "500.00", overdue: "500.00", credit: "500.00", net: "0.00", open_charges: 1 }), true, TODAY)).toBe("current");
    expect(ownerStanding(s({ owed: "500.00", overdue: "500.00", credit: "300.00", net: "200.00", open_charges: 1 }), true, TODAY)).toBe("behind");
    // overdue covered, something not yet due remains: due soon
    expect(ownerStanding(s({ owed: "1000.00", overdue: "500.00", credit: "500.00", net: "500.00", open_charges: 2 }), true, TODAY)).toBe("due_soon");
    // more credit than owed: ahead by the difference
    expect(ownerStanding(s({ owed: "100.00", overdue: "0.00", credit: "250.00", net: "-150.00", open_charges: 1 }), true, TODAY)).toBe("ahead");
    expect(moneyAnswer(s({ owed: "100.00", credit: "250.00", net: "-150.00" }), "ahead", TODAY).headline).toBe("You're $150.00 ahead");
  });
});

describe("moneyAnswer copy", () => {
  it("behind: bad, with the oldest date, the next payment and unapplied money", () => {
    const a = moneyAnswer(
      s({ owed: "1500.00", overdue: "750.00", credit: "250.00", oldest_overdue_on: "2026-09-01", next_due_on: "2026-11-01", next_due_amount: "750.00", open_charges: 2 }),
      "behind",
      TODAY,
    );
    expect(a.status).toBe("bad");
    // the net rule: 1,500 owed minus 250 not yet applied; 750 overdue minus 250
    expect(a.headline).toBe("You owe $1,250.00");
    expect(a.detail).toBe(
      "$500.00 of that was due on or before September 1, 2026. Next payment of $750.00 is due November 1, 2026. That is after taking off your $250.00 in payments not yet applied; the board applies them to charges.",
    );
  });
  it("behind: leaves out the next payment and the credit when there are none", () => {
    const a = moneyAnswer(s({ owed: "500.00", overdue: "500.00", oldest_overdue_on: "2026-01-01" }), "behind", TODAY);
    expect(a.detail).toBe("$500.00 of that was due on or before January 1, 2026.");
  });
  it("due soon: attention", () => {
    const a = moneyAnswer(s({ owed: "750.00", next_due_on: "2026-11-01", next_due_amount: "750.00" }), "due_soon", TODAY);
    expect(a).toEqual({ status: "attention", headline: "You owe $750.00", detail: "Nothing is late. The next payment of $750.00 is due November 1, 2026." });
    expect(moneyAnswer(s({ owed: "750.00" }), "due_soon", TODAY).detail).toBe("Nothing is late.");
  });
  it("current: good, with or without a last payment", () => {
    expect(moneyAnswer(s({ last_payment_on: "2026-10-01", last_payment_amount: "750.00" }), "current", TODAY)).toEqual({
      status: "good",
      headline: "You're all paid up",
      detail: "Your last payment was $750.00 on October 1, 2026.",
    });
    expect(moneyAnswer(s({}), "current", TODAY).detail).toBe("Nothing is owed right now.");
  });
  it("ahead: neutral", () => {
    expect(moneyAnswer(s({ credit: "250.00", net: "-250.00" }), "ahead", TODAY)).toEqual({
      status: "neutral",
      headline: "You're $250.00 ahead",
      detail: "That is money you paid that has not been applied to a charge yet. The board usually applies it to your next charges. Ask the board if you are unsure.",
    });
  });
  it("not charged: neutral, names the unit", () => {
    expect(moneyAnswer(s({}), "not_charged", TODAY)).toEqual({
      status: "neutral",
      headline: "Nothing has been charged yet",
      detail: "When the board posts dues for Unit 2, they show here.",
    });
  });
  it("uses no em dash in any answer", () => {
    for (const st of ["behind", "due_soon", "current", "ahead", "not_charged"] as const) {
      const a = moneyAnswer(s({ owed: "1.00", overdue: "1.00", credit: "1.00", oldest_overdue_on: "2026-01-01", next_due_on: "2026-12-01", next_due_amount: "1.00", last_payment_on: "2026-01-01", last_payment_amount: "1.00" }), st, TODAY);
      expect(a.headline + a.detail).not.toContain("—");
    }
  });
});
