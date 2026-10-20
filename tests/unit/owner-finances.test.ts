import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OWNER_FINANCES_COPY,
  budgetWords,
  dollars,
  lineBarPercent,
  lineWords,
  netWords,
  parseOwnerFinances,
  spendingPace,
  type FinanceBudget,
  type FinancePeriod,
} from "@/lib/owner/finances";
import { NAV_GROUPS, navFor, pageTitleFor, withOwnerFinances } from "@/components/sidebar/config";
import { OWNER_FINANCES_NAV, OWNER_NAV, ownerNavItems } from "@/lib/owner/nav";

const MIGRATION = readFileSync(path.resolve(import.meta.dirname, "../../supabase/migrations/0079_owner_unit_documents.sql"), "utf8");

const period = (over: Partial<Record<string, unknown>> = {}) => ({
  label: "2026",
  starts_on: "2026-01-01",
  ends_on: "2026-12-31",
  has_activity: true,
  income: "90000.00",
  expenses: "71500.50",
  net: "18499.50",
  ...over,
});

const raw = (over: Partial<Record<string, unknown>> = {}) => ({
  as_of: "2026-10-20",
  posted_through: "2026-10-15",
  year_to_date: period(),
  last_year: period({ label: "2025", starts_on: "2025-01-01", ends_on: "2025-12-31" }),
  cash: { as_of: "2026-10-20", has_data: true, has_reserve_fund: true, operating: "12000.00", reserve: "55000.00" },
  budget: {
    fiscal_year: "2026",
    days_elapsed: 293,
    days_total: 365,
    income_budget: "120000.00",
    income_actual: "90000.00",
    expense_budget: "100000.00",
    expense_actual: "71500.50",
    lines: [
      { name: "Insurance", type: "expense", budget: "30000.00", actual: "29000.00" },
      { name: "Dues", type: "income", budget: "120000.00", actual: "90000.00" },
    ],
  },
  ...over,
});

describe("parseOwnerFinances", () => {
  it("reads a complete summary", () => {
    const f = parseOwnerFinances(raw());
    expect(f).not.toBeNull();
    expect(f?.yearToDate).toMatchObject({ label: "2026", hasActivity: true, income: "90000.00", net: "18499.50" });
    expect(f?.lastYear?.label).toBe("2025");
    expect(f?.cash).toMatchObject({ hasReserveFund: true, reserve: "55000.00" });
    expect(f?.budget?.lines).toHaveLength(2);
    expect(f?.postedThrough).toBe("2026-10-15");
  });

  it("keeps missing sections missing instead of inventing them", () => {
    const f = parseOwnerFinances(raw({ last_year: null, cash: null, budget: null, posted_through: null }));
    expect(f).toMatchObject({ lastYear: null, cash: null, budget: null, postedThrough: null });
    expect(parseOwnerFinances(raw({ year_to_date: undefined }))?.yearToDate).toBeNull();
  });

  it("refuses the whole summary when any figure is not a plain decimal", () => {
    expect(parseOwnerFinances(raw({ year_to_date: period({ income: 90000 }) }))).toBeNull();
    expect(parseOwnerFinances(raw({ year_to_date: period({ net: "1e3" }) }))).toBeNull();
    expect(parseOwnerFinances(raw({ cash: { as_of: "2026-10-20", has_data: true, has_reserve_fund: false, operating: "$5", reserve: "0.00" } }))).toBeNull();
    expect(parseOwnerFinances(raw({ posted_through: "yesterday" }))).toBeNull();
  });

  it("refuses null, text and malformed shapes", () => {
    for (const bad of [null, undefined, "x", 3, [], {}, raw({ as_of: "soon" }), raw({ budget: { fiscal_year: "2026" } })]) {
      expect(parseOwnerFinances(bad)).toBeNull();
    }
  });
});

describe("the words", () => {
  it("rounds to whole dollars and keeps the sign", () => {
    expect(dollars("12345.49")).toBe("$12,345");
    expect(dollars("12345.50")).toBe("$12,346");
    expect(dollars("-1200.00")).toBe("-$1,200");
    expect(dollars("-0.20")).toBe("$0");
    expect(dollars("0")).toBe("$0");
  });

  it("says what the net result means", () => {
    const p = (net: string) => parseOwnerFinances(raw({ year_to_date: period({ net }) }))!.yearToDate as FinancePeriod;
    expect(netWords(p("18499.50"))).toBe("The association took in $18,500 more than it spent.");
    expect(netWords(p("-250.00"))).toBe("The association spent $250 more than it took in.");
    expect(netWords(p("0.00"))).toBe("Income and spending came out even.");
  });

  const budget = (over: Partial<FinanceBudget> = {}): FinanceBudget => ({ ...parseOwnerFinances(raw())!.budget!, ...over });

  it("compares spending with the part of the year that has passed", () => {
    // 293 of 365 days: about 80,274 of a 100,000 budget is on pace.
    expect(spendingPace(budget()).status).toBe("on_track");
    expect(spendingPace(budget({ expenseActual: "95000.00" })).status).toBe("watch");
    expect(spendingPace(budget({ expenseActual: "100000.01" })).status).toBe("over");
    expect(spendingPace(budget({ expenseActual: "40000.00" })).status).toBe("under");
    expect(spendingPace(budget({ expenseBudget: "0.00" })).status).toBe("no_budget");
  });

  it("does not divide by a part of the year that has not started", () => {
    expect(spendingPace(budget({ daysElapsed: 0, expenseActual: "0.00" })).status).toBe("on_track");
  });

  it("explains the budget in plain sentences with no em dash", () => {
    const w = budgetWords(budget());
    expect(w.spending).toBe("Spending is on track with the budget: $71,501 spent so far, where about $80,274 would be on pace.");
    expect(w.income).toBe("Income so far is $90,000 of the $120,000 planned for the year.");
    expect(budgetWords(budget({ expenseBudget: "0.00", incomeBudget: "0.00" }))).toEqual({
      spending: "No spending budget has been set for 2026.",
      income: null,
    });
    expect(budgetWords(budget({ expenseActual: "120000.00" })).spending).toMatch(/passed the whole 2026 budget/);
  });

  it("describes a budget line and sizes its bar", () => {
    const l = { name: "Insurance", type: "expense" as const, budget: "30000.00", actual: "29000.00" };
    expect(lineWords(l)).toBe("$29,000 of $30,000 used (97%)");
    expect(lineBarPercent(l)).toBe(97);
    expect(lineBarPercent({ ...l, actual: "45000.00" })).toBe(100);
    expect(lineWords({ ...l, budget: "0.00", actual: "500.00" })).toBe("$500 used, nothing planned");
    expect(lineBarPercent({ ...l, budget: "0.00" })).toBe(0);
  });

  it("uses no em dash anywhere", () => {
    expect(JSON.stringify(OWNER_FINANCES_COPY)).not.toContain("—");
  });
});

describe("owner navigation", () => {
  it("does not link to Finances by default", () => {
    expect(ownerNavItems().map((i) => i.href)).not.toContain("/owner/finances");
    expect(OWNER_NAV.length).toBe(4);
    const all = navFor("owner");
    const hrefs = [...all.ungrouped, ...all.groups.flatMap((g) => g.items), ...all.trailing].map((i) => i.href);
    expect(hrefs).not.toContain("/owner/finances");
  });

  it("adds Finances right after Budget when it is switched on, and only there", () => {
    const owner = withOwnerFinances(navFor("owner"));
    const building = owner.groups.find((g) => g.items.some((i) => i.href === "/budget"))!;
    const labels = building.items.map((i) => i.label);
    expect(labels[labels.indexOf("Budget") + 1]).toBe("Finances");
    expect(owner.groups.flatMap((g) => g.items).filter((i) => i.href === "/owner/finances")).toHaveLength(1);
    expect(OWNER_FINANCES_NAV).toMatchObject({ href: "/owner/finances", label: "Finances" });
  });

  it("leaves a navigation without a Budget item alone", () => {
    const nav = { groups: [{ label: "x", items: [] }] };
    expect(withOwnerFinances(nav)).toBe(nav);
  });

  it("never gives the board's own navigation a second Finances item", () => {
    expect(NAV_GROUPS.flatMap((g) => g.items).map((i) => i.href)).not.toContain("/owner/finances");
  });

  it("names the page in the top bar", () => {
    expect(pageTitleFor("/owner/finances", "owner")).toBe("Finances");
  });
});

describe("the migration keeps the promises the page makes", () => {
  it("is off by default", () => {
    expect(MIGRATION).toContain("add column owner_finances_enabled boolean not null default false");
  });

  it("only a board admin can switch it", () => {
    expect(MIGRATION).toMatch(/set_owner_finances_enabled[\s\S]*has_role_in\(p_association_id, array\['board_admin'\]/);
  });

  it("the public summary checks the flag and membership, and the figure builders are not callable by owners", () => {
    expect(MIGRATION).toContain("owner_finances_enabled(p_association_id)");
    expect(MIGRATION).toContain("public.is_member(a.id)");
    expect(MIGRATION).toContain("revoke all on function public.owner_finances_core(uuid, date) from public, anon, authenticated;");
    expect(MIGRATION).toContain("revoke all on function public.owner_finances_period(uuid, text, date, date) from public, anon, authenticated;");
    expect(MIGRATION).toContain("revoke all on function public.owner_finances_summary(uuid) from public, anon;");
  });
});
