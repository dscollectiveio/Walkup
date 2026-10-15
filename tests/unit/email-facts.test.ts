import { describe, expect, it } from "vitest";
import { parseFacts, unitFacts } from "@/lib/email-outbox/facts";

const unit = {
  unit_id: "aaaa1111-0000-0000-0000-000000000001",
  label: "Unit 1",
  as_of: "2026-10-14",
  owed: "500.00",
  overdue: "500.00",
  credit: "0.00",
  net: "500.00",
  oldest_overdue_on: "2026-01-01",
  lines: [{ due_on: "2026-01-01", label: "Dues for January 2026", balance: "500.00" }],
};

describe("facts", () => {
  it("accepts a row shaped like email_unit_facts", () => {
    expect(unitFacts.safeParse(unit).success).toBe(true);
    expect(parseFacts("dues_reminder", { units: [unit] }).ok).toBe(true);
    expect(unitFacts.safeParse({ ...unit, oldest_overdue_on: null, lines: [] }).success).toBe(true);
  });

  it("rejects money that is not exactly two decimals", () => {
    for (const bad of ["12", "12.5", "1e3", "$12.00", "12.000", "", "-", "abc"]) {
      expect(unitFacts.safeParse({ ...unit, owed: bad }).success, bad).toBe(false);
    }
    expect(unitFacts.safeParse({ ...unit, net: "-12.50" }).success).toBe(true);
  });

  it("rejects a bad date and more than 12 lines", () => {
    expect(unitFacts.safeParse({ ...unit, as_of: "10/14/2026" }).success).toBe(false);
    expect(unitFacts.safeParse({ ...unit, lines: Array.from({ length: 13 }, () => unit.lines[0]) }).success).toBe(false);
  });

  it("checks each kind against its own shape", () => {
    expect(parseFacts("late_fee_notice", { units: [unit] }).ok).toBe(false);
    expect(
      parseFacts("late_fee_notice", {
        units: [unit],
        fee_charge_id: "aaaa1111-0000-0000-0000-000000000009",
        fee_amount: "25.00",
        fee_charged_on: "2026-02-15",
      }).ok,
    ).toBe(true);
    expect(parseFacts("statement", { units: [] }).ok).toBe(false);
    expect(parseFacts("announcement", { announcement_id: "not-a-uuid" }).ok).toBe(false);
    expect(parseFacts("announcement", {}).ok).toBe(false);
    const bad = parseFacts("dues_reminder", null);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe("The saved details for this email could not be read.");
  });
});
