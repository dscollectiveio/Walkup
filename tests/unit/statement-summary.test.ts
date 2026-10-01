import { describe, expect, it } from "vitest";
import { headlineFor, periodOptions, prorateBudget, varianceWords } from "@/app/financial-statements/summary";

describe("prorateBudget", () => {
  it("splits an annual budget by the period", () => {
    const annual = { a: 1200, b: 100 };
    expect(prorateBudget(annual, "monthly")).toEqual({ byAccount: { a: 100, b: 8.33 }, note: "A twelfth" });
    expect(prorateBudget(annual, "quarterly").byAccount).toEqual({ a: 300, b: 25 });
    expect(prorateBudget(annual, "annual").byAccount).toEqual(annual);
  });
});

describe("periodOptions", () => {
  const now = new Date(2026, 9, 15); // Oct 15, 2026
  const fys = [
    { label: "2026", starts_on: "2026-01-01", ends_on: "2026-12-31" },
    { label: "2025", starts_on: "2025-01-01", ends_on: "2025-12-31" },
  ];

  it("lists months and quarters back to the earliest fiscal year, then the years", () => {
    const opts = periodOptions(fys, now);
    const months = opts.filter((o) => o.group === "Months");
    const quarters = opts.filter((o) => o.group === "Quarters");
    const years = opts.filter((o) => o.group === "Years");
    expect(months[0]).toMatchObject({ label: "October 2026", period: "monthly", offset: 0 });
    expect(months.length).toBe(22); // Oct 2026 back to Jan 2025, capped at 24
    expect(quarters[0].label).toBe("Q4 2026");
    expect(quarters.length).toBe(8);
    expect(years.map((y) => y.label)).toEqual(["2026", "2025"]);
  });

  it("offers a year of months when no fiscal year exists yet", () => {
    const opts = periodOptions([], now);
    expect(opts.filter((o) => o.group === "Months").length).toBe(12);
    expect(opts.filter((o) => o.group === "Years").length).toBe(0);
  });
});

describe("headlineFor", () => {
  it("says it in plain words, with the comparison on the total only", () => {
    const h = headlineFor({
      label: "Q3 2026",
      totalIncome: 12400,
      totalExpenses: 9100,
      hasActivity: true,
      prior: { label: "Q2 2026", netIncome: 2500, hasActivity: true },
    });
    expect(h.status).toBe("good");
    expect(h.headline).toBe("You took in $12,400.00 and spent $9,100.00 in Q3 2026 — $3,300.00 ahead.");
    expect(h.detail).toBe("That's $800.00 better than Q2 2026.");
  });

  it("handles behind, break-even, and an empty period", () => {
    expect(headlineFor({ label: "May 2026", totalIncome: 100, totalExpenses: 250, hasActivity: true, prior: null })).toMatchObject({
      status: "bad",
      headline: "You took in $100.00 and spent $250.00 in May 2026 — $150.00 behind.",
    });
    expect(headlineFor({ label: "May 2026", totalIncome: 100, totalExpenses: 100, hasActivity: true, prior: null }).headline).toContain(
      "broke even",
    );
    expect(headlineFor({ label: "May 2026", totalIncome: 0, totalExpenses: 0, hasActivity: false, prior: null })).toEqual({
      status: "neutral",
      headline: "Nothing has been posted for May 2026 yet.",
    });
  });

  it("skips the comparison when the prior period has nothing in it", () => {
    const h = headlineFor({
      label: "Feb 2026",
      totalIncome: 10,
      totalExpenses: 5,
      hasActivity: true,
      prior: { label: "Jan 2026", netIncome: 0, hasActivity: false },
    });
    expect(h.detail).toBeUndefined();
  });
});

describe("varianceWords", () => {
  it("knows over budget is bad for spending and good for income", () => {
    expect(varianceWords(320, 200, "expense")).toEqual({ words: "$120.00 over", tone: "bad" });
    expect(varianceWords(150, 200, "expense")).toEqual({ words: "$50.00 under", tone: "good" });
    expect(varianceWords(1500, 1400, "income")).toEqual({ words: "$100.00 over", tone: "good" });
    expect(varianceWords(200, 200.4, "income")).toEqual({ words: "on budget", tone: "neutral" });
  });
});
