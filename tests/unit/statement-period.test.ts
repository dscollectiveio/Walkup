import { describe, expect, it } from "vitest";
import { isAnnual, parsePeriod, periodLabel, statementPeriods } from "@/lib/statements/period";
import { totalsOf } from "@/lib/statements/summary";

const byKey = (today: string) => Object.fromEntries(statementPeriods(today).map((p) => [p.key, p]));

describe("statementPeriods", () => {
  it("mid-month: last month, last quarter, this year so far, last year", () => {
    const p = byKey("2026-10-14");
    expect(p.last_month).toMatchObject({ from: "2026-09-01", to: "2026-09-30", label: "Last month" });
    expect(p.last_quarter).toMatchObject({ from: "2026-07-01", to: "2026-09-30" });
    expect(p.year_to_date).toMatchObject({ from: "2026-01-01", to: "2026-10-14", label: "This year so far" });
    expect(p.last_year).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("in January the previous month and quarter fall in the previous year", () => {
    const p = byKey("2026-01-09");
    expect(p.last_month).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(p.last_quarter).toMatchObject({ from: "2025-10-01", to: "2025-12-31" });
    expect(p.year_to_date).toMatchObject({ from: "2026-01-01", to: "2026-01-09" });
  });

  it("in December the previous month is November and the quarter is Q3", () => {
    const p = byKey("2026-12-31");
    expect(p.last_month).toMatchObject({ from: "2026-11-01", to: "2026-11-30" });
    expect(p.last_quarter).toMatchObject({ from: "2026-07-01", to: "2026-09-30" });
  });

  it("handles a leap February and the first quarter", () => {
    expect(byKey("2024-03-05").last_month).toMatchObject({ from: "2024-02-01", to: "2024-02-29" });
    expect(byKey("2026-03-05").last_month).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(byKey("2026-05-05").last_quarter).toMatchObject({ from: "2026-01-01", to: "2026-03-31" });
  });

  it("refuses a bad date", () => {
    expect(() => statementPeriods("2026-13-01")).toThrow();
  });
});

describe("periodLabel and isAnnual", () => {
  it("names a full month, quarter and year", () => {
    expect(periodLabel("2026-10-01", "2026-10-31")).toBe("October 2026");
    expect(periodLabel("2026-02-01", "2026-02-28")).toBe("February 2026");
    expect(periodLabel("2026-07-01", "2026-09-30")).toBe("Q3 2026");
    expect(periodLabel("2026-01-01", "2026-03-31")).toBe("Q1 2026");
    expect(periodLabel("2025-01-01", "2025-12-31")).toBe("2025");
  });

  it("writes an odd range with the word to and no dash", () => {
    expect(periodLabel("2026-10-01", "2026-10-14")).toBe("Oct 1 to Oct 14, 2026");
    expect(periodLabel("2026-02-01", "2026-04-30")).toBe("Feb 1 to Apr 30, 2026");
    expect(periodLabel("2025-11-15", "2026-03-03")).toBe("Nov 15, 2025 to Mar 3, 2026");
    expect(periodLabel("2026-04-01", "2026-06-30")).toBe("Q2 2026");
    for (const l of [periodLabel("2026-10-01", "2026-10-14"), periodLabel("2025-11-15", "2026-03-03")]) expect(l).not.toMatch(/[–—-]\s/);
  });

  it("is annual only for January 1 to December 31 of one year", () => {
    expect(isAnnual("2025-01-01", "2025-12-31")).toBe(true);
    expect(isAnnual("2025-01-01", "2025-12-30")).toBe(false);
    expect(isAnnual("2025-01-01", "2026-12-31")).toBe(false);
    expect(isAnnual("2025-02-01", "2025-12-31")).toBe(false);
  });
});

describe("parsePeriod", () => {
  it("accepts a sane span and refuses reversed, invalid or very long ones", () => {
    expect(parsePeriod("2026-01-01", "2026-03-31")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(parsePeriod("2026-03-31", "2026-01-01")).toBeNull();
    expect(parsePeriod("2026-02-30", "2026-03-01")).toBeNull();
    expect(parsePeriod("2000-01-01", "2026-03-01")).toBeNull();
    expect(parsePeriod(undefined, "2026-03-01")).toBeNull();
    expect(parsePeriod("2026-1-1", "2026-03-01")).toBeNull();
  });
});

describe("totalsOf", () => {
  const L = (kind: string, charge: string | null, payment: string | null, adjustment: string | null, balance: string) => ({ kind: kind as never, charge, payment, adjustment, balance });
  it("adds the period's activity and ends at the last running balance", () => {
    const t = totalsOf([
      L("opening", null, null, null, "100.00"),
      L("charge", "500.00", "0.00", "0.00", "600.00"),
      L("payment", "0.00", "250.00", "0.00", "350.00"),
      L("waiver", "0.00", "0.00", "25.00", "325.00"),
    ]);
    expect(t).toEqual({ opening: "100.00", charges: "500.00", payments: "250.00", adjustments: "25.00", closing: "325.00" });
  });

  it("handles no lines, and a credit", () => {
    expect(totalsOf([])).toEqual({ opening: "0.00", charges: "0.00", payments: "0.00", adjustments: "0.00", closing: "0.00" });
    expect(totalsOf([L("payment", "0.00", "50.00", "0.00", "-50.00")]).closing).toBe("-50.00");
  });

  it("sums cents exactly", () => {
    const rows = Array.from({ length: 10 }, () => L("charge", "0.10", "0.00", "0.00", "0.10"));
    expect(totalsOf(rows).charges).toBe("1.00");
  });
});
