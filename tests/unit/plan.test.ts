import { describe, expect, it } from "vitest";
import {
  buildPlanRows,
  overBudgetAlerts,
  paceShare,
  planHeadline,
  suggestAnnualFromSpend,
} from "@/lib/money/plan";

const names: Record<string, string> = { rep: "Repairs", util: "Utilities", ins: "Insurance", jan: "Janitorial", law: "Lawn" };
const nameOf = (id: string) => names[id];

describe("buildPlanRows", () => {
  it("puts over budget first, then watch, then on track by use, then untouched by name", () => {
    const annual = new Map([
      ["rep", 200000],
      ["util", 300000],
      ["ins", 400000],
      ["jan", 192000],
      ["law", 150000],
    ]);
    // Half-year share: targets 1000, 1500, 2000, 960, 750 dollars.
    const spent = new Map([
      ["rep", 121000], // 21% over → over
      ["util", 160000], // 6.7% over → watch
      ["ins", 100000], // 50% used → on track
      ["jan", 90000], // 94% used → on track, more used than insurance
      ["law", 0],
    ]);
    const rows = buildPlanRows(annual, spent, nameOf, 0.5);
    expect(rows.map((r) => r.name)).toEqual(["Repairs", "Utilities", "Janitorial", "Insurance", "Lawn"]);
    expect(rows[0]).toMatchObject({ targetCents: 100000, leftCents: -21000, status: "over", pctOver: 21 });
    expect(rows[4].leftCents).toBe(75000);
  });
});

describe("paceShare", () => {
  it("is the fraction of the month for a single month", () => {
    expect(paceShare("2026-10-01", "2026-10-01", new Date(2026, 9, 15))).toBeCloseTo(15 / 31, 3);
  });
  it("counts whole months plus the current fraction across a year", () => {
    // Jan..Dec, on Apr 15: 3 whole months + 15/30 of April = 3.5 / 12
    expect(paceShare("2026-01-01", "2026-12-01", new Date(2026, 3, 15))).toBeCloseTo(3.5 / 12, 3);
  });
  it("is 1 after the period and 0 before it", () => {
    expect(paceShare("2026-01-01", "2026-03-01", new Date(2026, 5, 1))).toBe(1);
    expect(paceShare("2026-06-01", "2026-08-01", new Date(2026, 1, 1))).toBe(0);
  });
});

describe("planHeadline", () => {
  const rows = buildPlanRows(new Map([["rep", 200000]]), new Map([["rep", 121000]]), nameOf, 0.5);

  it("reads plainly for a month", () => {
    const h = planHeadline({
      periodLabel: "October",
      isFiscalYear: false,
      spentCents: 298000,
      targetCents: 319000,
      forecast: null,
      rows: [],
    });
    expect(h.status).toBe("good");
    expect(h.headline).toBe("October: $2,980 spent of $3,190 planned: $210 under plan.");
    expect(h.detail).toBeUndefined();
  });

  it("names the category to watch when something is over its share", () => {
    const h = planHeadline({
      periodLabel: "October",
      isFiscalYear: false,
      spentCents: 350000,
      targetCents: 319000,
      forecast: null,
      rows,
    });
    expect(h.status).toBe("attention");
    expect(h.headline).toContain("$310 over plan");
    expect(h.detail).toBe("Repairs is the one to watch: $210 over its share.");
  });

  it("uses the forecast for the fiscal year", () => {
    const h = planHeadline({
      periodLabel: "2026",
      isFiscalYear: true,
      spentCents: 2940000,
      targetCents: 3428500,
      forecast: {
        overUnderCents: -110000,
        projectedCents: 3318500,
        budgetCents: 3428500,
        driver: { accountId: "ins", name: "Insurance", cents: -90000 },
        driverIsMost: true,
      },
      rows: [],
    });
    expect(h.headline).toBe("2026 so far: $29,400 spent of $34,285 planned, on pace to finish about $1,100 under.");
    expect(h.detail).toBe("Most of the room is insurance.");
    expect(h.status).toBe("good");
  });
});

describe("overBudgetAlerts and suggestAnnualFromSpend", () => {
  it("lists only categories past the watch band, biggest first", () => {
    const annual = new Map([
      ["rep", 100000],
      ["util", 100000],
      ["ins", 100000],
    ]);
    const spent = new Map([
      ["rep", 130000],
      ["util", 105000],
      ["ins", 200000],
    ]);
    expect(overBudgetAlerts(buildPlanRows(annual, spent, nameOf, 1))).toEqual([
      { name: "Insurance", overCents: 100000 },
      { name: "Repairs", overCents: 30000 },
    ]);
  });
  it("annualizes a period's spend to a round number", () => {
    expect(suggestAnnualFromSpend(26000, 1 / 12)).toBe(312000); // $260/mo → $3,120/yr
    expect(suggestAnnualFromSpend(0, 0.5)).toBe(0);
  });
});
