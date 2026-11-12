import { describe, expect, it } from "vitest";
import { resolvePeriod } from "@/lib/money/period";
import { cashByMonth, transfersInByMonth, type CashActivityRow } from "@/lib/money/cash";
import { median, spendByAccount, type ExpenseActualRow } from "@/lib/money/spending";
import { budgetStatus, comparisonSentence, forecastYearEnd } from "@/lib/money/budget";

const FY = { label: "2026", starts_on: "2026-01-01", ends_on: "2026-12-31" };
const SEPT_30 = new Date("2026-09-30T12:00:00");
const fmt = (c: number) => `$${(c / 100).toLocaleString("en-US")}`;

describe("resolvePeriod", () => {
  it("compares 'This year' with the full-year budget; the elapsed share is by the day (273 of 365)", () => {
    const p = resolvePeriod("year", FY, SEPT_30);
    expect(p.startKey).toBe("2026-01-01");
    expect(p.endKey).toBe("2026-09-01");
    expect(p.months).toHaveLength(9);
    expect(p.budgetShare).toBe(1);
    expect(p.elapsedShare).toBeCloseTo(273 / 365);
    expect(p.budgetCaption).toBe("Spending from Jan 1 to Sep 30 against each full-year budget.");
    expect(p.throughLabel).toBe("Through Sep 30");
    expect(p.endDate).toBe("2026-09-30");
  });

  it("prorates this month by the day, against the year's days", () => {
    const m = resolvePeriod("month", FY, SEPT_30);
    expect(m.months).toEqual(["2026-09-01"]);
    expect(m.budgetShare).toBeCloseTo(30 / 365);
    expect(m.elapsedShare).toBeCloseTo(30 / 365);
    expect(m.budgetCaption).toBe("Each budget is prorated to today, Sep 1 to Sep 30.");
  });

  it("handles a fiscal year that doesn't start in January", () => {
    const p = resolvePeriod("year", { label: "FY27", starts_on: "2026-07-01", ends_on: "2027-06-30" }, SEPT_30);
    expect(p.months).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
    expect(p.budgetShare).toBe(1);
    expect(p.elapsedShare).toBeCloseTo(92 / 365);
  });

  it("stops at the end of the fiscal year once it is over", () => {
    const p = resolvePeriod("year", FY, new Date("2027-02-10T12:00:00"));
    expect(p.budgetShare).toBe(1);
    expect(p.budgetCaption).toBe("Spending from Jan 1 to Dec 31 against each full-year budget.");
  });
});

describe("cashByMonth", () => {
  const row = (month: string, kind: string, inflow: string, outflow: string, tIn = "0.00", tOut = "0.00"): CashActivityRow => ({
    month, fund_kind: kind, inflow, outflow, transfer_inflow: tIn, transfer_outflow: tOut,
  });

  it("keeps a reserve transfer out of money in / money out, but in the balance", () => {
    const rows = [
      row("2026-01-01", "operating", "1000.00", "200.00"),
      // Move $300 operating → reserve.
      row("2026-02-01", "operating", "0.00", "300.00", "0.00", "300.00"),
      row("2026-02-01", "reserve", "300.00", "0.00", "300.00", "0.00"),
    ];
    const months = cashByMonth(rows);
    expect(months.map((m) => [m.inCents, m.outCents])).toEqual([[100000, 20000], [0, 0]]);
    expect(months[1].balanceCents).toBe(80000);
    expect(transfersInByMonth(rows, "reserve").get("2026-02-01")).toBe(30000);
  });

  it("fills quiet months by carrying the balance", () => {
    const months = cashByMonth([row("2026-01-01", "operating", "100.00", "0.00"), row("2026-03-01", "operating", "0.00", "40.00")]);
    expect(months.map((m) => m.key)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(months.map((m) => m.balanceCents)).toEqual([10000, 10000, 6000]);
  });
});

describe("spending", () => {
  const rows: ExpenseActualRow[] = [
    { month: "2026-08-01", account_id: "u", account_name: "Utilities", fund_id: "op", total: "100.00" },
    { month: "2026-09-01", account_id: "u", account_name: "Utilities", fund_id: "op", total: "50.00" },
    { month: "2026-09-01", account_id: "r", account_name: "Repairs", fund_id: "res", total: "900.00" },
  ];
  it("sums by account within the months and fund asked for", () => {
    expect(spendByAccount(rows, "2026-09-01", "2026-09-01")).toEqual([
      { accountId: "r", name: "Repairs", cents: 90000 },
      { accountId: "u", name: "Utilities", cents: 5000 },
    ]);
    expect(spendByAccount(rows, "2026-01-01", "2026-12-01", "op")).toEqual([{ accountId: "u", name: "Utilities", cents: 15000 }]);
  });
  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
  });
});

describe("budgetStatus", () => {
  it("on track at or under the target, watch up to 10% over, over beyond that", () => {
    expect(budgetStatus(1000, 1000)).toEqual({ status: "on_track", pctOver: 0 });
    expect(budgetStatus(1100, 1000)).toEqual({ status: "watch", pctOver: 10 });
    expect(budgetStatus(1101, 1000).status).toBe("over");
    expect(budgetStatus(500, 0).status).toBe("over");
    expect(budgetStatus(0, 0).status).toBe("on_track");
  });
});

describe("forecastYearEnd", () => {
  const base = {
    fyStart: "2026-01-01",
    fyEnd: "2026-12-31",
    budgetByAccount: new Map([["rep", 1_200_00], ["util", 1_200_00]]),
  };

  it("refuses to forecast under three months of history", () => {
    expect(
      forecastYearEnd({ ...base, spentByAccount: [], today: new Date("2026-02-15T00:00:00"), monthsElapsed: 1 }),
    ).toBeNull();
  });

  it("pins the three-month minimum: 2 months is refused, 3 months is the first forecast", () => {
    const run = (monthsElapsed: number) =>
      forecastYearEnd({
        ...base,
        spentByAccount: [{ accountId: "rep", name: "Repairs", cents: 300_00 }],
        today: new Date("2026-04-02T12:00:00"),
        monthsElapsed,
      });
    expect(run(2)).toBeNull();
    expect(run(3)).not.toBeNull();
    expect(run(4)).not.toBeNull();
  });

  it("projects straight-line and names the category pushing it over", () => {
    // Halfway through the year: repairs spent the whole annual budget, utilities half.
    const f = forecastYearEnd({
      ...base,
      spentByAccount: [
        { accountId: "rep", name: "Repairs", cents: 1_200_00 },
        { accountId: "util", name: "Utilities", cents: 600_00 },
      ],
      today: new Date("2026-07-02T12:00:00"),
      monthsElapsed: 6,
    })!;
    expect(f.overUnderCents).toBeGreaterThan(1_100_00);
    expect(f.overUnderCents).toBeLessThan(1_300_00);
    expect(f.driver?.name).toBe("Repairs");
    expect(f.driverIsMost).toBe(true);
  });

  it("returns null with no budget", () => {
    expect(
      forecastYearEnd({ ...base, budgetByAccount: new Map(), spentByAccount: [], today: SEPT_30, monthsElapsed: 8 }),
    ).toBeNull();
  });
});

describe("comparisonSentence", () => {
  it("names the biggest change and bounds the rest", () => {
    expect(
      comparisonSentence(
        [{ name: "Repairs", cents: 500_00 }, { name: "Utilities", cents: 110_00 }],
        [{ name: "Repairs", cents: 290_00 }, { name: "Utilities", cents: 100_00 }],
        fmt,
        "last year",
      ),
    ).toBe("That's $220 more than last year, mostly repairs (up $210).");
  });
  it("uses the net change, and doesn't say 'mostly' when the driver runs against it", () => {
    expect(
      comparisonSentence(
        [{ name: "Repairs", cents: 500_00 }, { name: "Utilities", cents: 100_00 }, { name: "Insurance", cents: 100_00 }],
        [{ name: "Repairs", cents: 100_00 }, { name: "Utilities", cents: 400_00 }, { name: "Insurance", cents: 400_00 }],
        fmt,
        "last year",
      ),
    ).toBe("That's $200 less than last year. The biggest change is repairs (up $400).");
  });
  it("is null without a prior period", () => {
    expect(comparisonSentence([{ name: "Repairs", cents: 1 }], [], fmt, "last year")).toBeNull();
  });
});

describe("toCents refuses what it cannot hold exactly (REVIEW-4 #15)", () => {
  it("rejects beyond-safe amounts and turns -0.00 into plain zero", async () => {
    const { toCents } = await import("@/lib/money/cents");
    expect(() => toCents("99999999999999999.99")).toThrow(/NUMERIC\(14,2\)/);
    expect(Object.is(toCents("-0.00"), 0)).toBe(true);
    expect(toCents("999999999999.99")).toBe(99_999_999_999_999);
  });
});
