import { describe, expect, it } from "vitest";
import { billNextDue, FREQUENCY_MONTHS, monthlyEquivalentCents, rollForward } from "@/lib/upkeep/bills";
import { BILL_CASES } from "../fixtures/bill-cases";

describe("billNextDue", () => {
  it.each(BILL_CASES)("billNextDue($from, $frequency, $dueDay) is $expected", ({ from, frequency, dueDay, expected }) => {
    expect(billNextDue(from, frequency, dueDay)).toBe(expected);
  });

  it("clamps the due day to the month and steps by the frequency", () => {
    expect(billNextDue("2026-03-31", "monthly", 31)).toBe("2026-04-30");
    expect(billNextDue("2027-01-15", "monthly", 30)).toBe("2027-02-28");
    expect(billNextDue("2028-01-15", "monthly", 30)).toBe("2028-02-29");
    expect(billNextDue("2026-05-10", "semiannual", 1)).toBe("2026-11-01");
    expect(billNextDue("2026-08-31", "quarterly", null)).toBe("2026-11-30");
    expect(billNextDue("2026-12-05", "monthly", 5)).toBe("2027-01-05");
    expect(FREQUENCY_MONTHS).toEqual({ monthly: 1, quarterly: 3, semiannual: 6, annual: 12 });
  });
});

describe("rollForward", () => {
  it("leaves a date that is today or later alone", () => {
    expect(rollForward("2026-10-14", "monthly", 14, "2026-10-14")).toBe("2026-10-14");
    expect(rollForward("2026-12-01", "monthly", 1, "2026-10-14")).toBe("2026-12-01");
  });

  it("rolls a past autopay date forward until it is today or later", () => {
    expect(rollForward("2026-07-01", "monthly", 1, "2026-10-14")).toBe("2026-11-01");
    expect(rollForward("2026-01-31", "monthly", 31, "2026-03-15")).toBe("2026-03-31");
    expect(rollForward("2025-03-15", "quarterly", null, "2026-10-14")).toBe("2026-12-15");
    expect(rollForward("2024-11-01", "annual", 1, "2026-10-14")).toBe("2026-11-01");
  });
});

describe("monthlyEquivalentCents", () => {
  it("turns a typical amount into cents a month, rounding half up", () => {
    expect(monthlyEquivalentCents("120.00", "monthly")).toBe(12_000);
    expect(monthlyEquivalentCents("300.00", "quarterly")).toBe(10_000);
    expect(monthlyEquivalentCents("100.00", "quarterly")).toBe(3_333);
    expect(monthlyEquivalentCents("200.00", "quarterly")).toBe(6_667);
    expect(monthlyEquivalentCents("0.05", "quarterly")).toBe(2);
    expect(monthlyEquivalentCents("0.06", "annual")).toBe(1); // 0.5 cents rounds up
    expect(monthlyEquivalentCents("1200", "annual")).toBe(10_000);
    expect(monthlyEquivalentCents("99.99", "semiannual")).toBe(1_667);
  });

  it("is 0 with no amount and refuses a float that skipped the ::text cast", () => {
    expect(monthlyEquivalentCents(null, "monthly")).toBe(0);
    expect(monthlyEquivalentCents("", "monthly")).toBe(0);
    expect(() => monthlyEquivalentCents(12.5 as unknown as string, "monthly")).toThrow(/as text/);
    expect(() => monthlyEquivalentCents("12.345", "monthly")).toThrow();
  });
});
