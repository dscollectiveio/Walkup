import { describe, expect, it } from "vitest";
import { billsAnswer, billShowFilter, manualDueSoon, monthlyTotal, nextDueText, parseBillShow, type BillLike } from "@/lib/upkeep/bills-view";

const TODAY = "2026-10-14";

function bill(over: Partial<BillLike>): BillLike {
  return {
    name: "Bill",
    frequency: "monthly",
    typical_amount: null,
    due_day: null,
    next_due_on: null,
    autopay_arranged: false,
    is_active: true,
    paused_at: null,
    ...over,
  };
}

describe("bills view (repairs-spec §13.2)", () => {
  it("lists bills paid by hand due within 14 days, overdue included, soonest first", () => {
    const bills = [
      bill({ name: "Water", next_due_on: "2026-10-25" }),
      bill({ name: "ComEd", next_due_on: "2026-10-10" }),
      bill({ name: "Later", next_due_on: "2026-11-30" }),
      bill({ name: "Auto", next_due_on: "2026-10-20", autopay_arranged: true }),
      bill({ name: "Paused", next_due_on: "2026-10-20", paused_at: "2026-10-01T00:00:00Z" }),
      bill({ name: "Gone", next_due_on: "2026-10-20", is_active: false }),
    ];
    expect(manualDueSoon(bills, TODAY).map((b) => b.name)).toEqual(["ComEd", "Water"]);
    expect(billsAnswer(bills, TODAY)).toEqual({
      status: "attention",
      headline: "2 bills to pay by hand soon",
      detail: "ComEd due Sat, Oct 10 · Water due Sun, Oct 25",
    });
  });

  it("says how many are on autopay when nothing is due by hand", () => {
    const bills = [bill({ autopay_arranged: true, next_due_on: "2026-10-20" }), bill({ next_due_on: "2026-12-01" })];
    expect(billsAnswer(bills, TODAY)).toEqual({
      status: "good",
      headline: "Nothing to pay by hand in the next two weeks",
      detail: "1 of 2 bills are on autopay with the provider.",
    });
  });

  it("sums a monthly figure over active, unpaused bills in cents", () => {
    const bills = [
      bill({ typical_amount: "300.00", frequency: "quarterly" }),
      bill({ typical_amount: "50.50" }),
      bill({ typical_amount: "999.00", paused_at: "2026-10-01T00:00:00Z" }),
      bill({ typical_amount: "999.00", is_active: false }),
    ];
    expect(monthlyTotal(bills)).toBe("$150.50");
    expect(monthlyTotal([])).toBe("$0");
  });

  it("rolls an autopay bill's date forward for display only", () => {
    expect(nextDueText(bill({ next_due_on: "2026-09-01", autopay_arranged: true, due_day: 1 }), TODAY)).toBe("next Sun, Nov 1 (autopay)");
    expect(nextDueText(bill({ next_due_on: "2026-09-01" }), TODAY)).toBe("next Tue, Sep 1");
    expect(nextDueText(bill({ next_due_on: null }), TODAY)).toBeNull();
  });

  it("filters by active, paused and archived", () => {
    expect(parseBillShow("paused")).toBe("paused");
    expect(parseBillShow("nope")).toBe("active");
    const paused = bill({ paused_at: "2026-10-01T00:00:00Z" });
    expect(billShowFilter(paused, "paused")).toBe(true);
    expect(billShowFilter(paused, "active")).toBe(false);
    expect(billShowFilter(bill({ is_active: false }), "archived")).toBe(true);
  });
});
