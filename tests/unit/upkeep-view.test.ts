import { describe, expect, it } from "vitest";
import { groupUpkeep, historyTotals, monthsHint, parseUpkeepShow, upkeepAnswer, whenLabel } from "@/lib/upkeep/view";

const TODAY = "2026-10-14";

describe("when-pill (repairs-spec §12.2)", () => {
  it("says how overdue", () => {
    expect(whenLabel("2026-09-30", 9, TODAY)).toMatchObject({ text: "14 days overdue", tone: "bad", status: "overdue" });
    expect(whenLabel("2026-10-13", null, TODAY).text).toBe("1 day overdue");
  });

  it("says due today", () => {
    expect(whenLabel(TODAY, null, TODAY).text).toBe("due today");
  });

  it("names the month for a seasonal task due at a month end more than a week away", () => {
    expect(whenLabel("2026-11-30", 11, TODAY)).toMatchObject({ text: "due in November", tone: "warning" });
    expect(whenLabel("2027-04-30", 4, TODAY)).toMatchObject({ text: "due in April", tone: "neutral" });
  });

  it("uses the date otherwise", () => {
    expect(whenLabel("2026-10-31", 10, TODAY).text).toBe("due in October");
    expect(whenLabel("2026-10-31", 10, "2026-10-27").text).toBe("due Sat, Oct 31");
    expect(whenLabel("2026-10-20", 10, TODAY).text).toBe("due Tue, Oct 20");
    expect(whenLabel("2026-11-12", null, TODAY).text).toBe("due Thu, Nov 12");
  });
});

describe("groups, filter and answer", () => {
  const tasks = [
    { name: "Boiler", next_due_on: "2026-09-30" },
    { name: "Gutters", next_due_on: "2026-11-30" },
    { name: "Roof", next_due_on: "2027-04-30" },
  ];

  it("groups overdue, next 60 days and later", () => {
    const g = groupUpkeep(tasks, TODAY);
    expect(g.overdue.map((t) => t.name)).toEqual(["Boiler"]);
    expect(g.soon.map((t) => t.name)).toEqual(["Gutters"]);
    expect(g.later.map((t) => t.name)).toEqual(["Roof"]);
  });

  it("answers with what's overdue first", () => {
    expect(upkeepAnswer(tasks, TODAY)).toMatchObject({ status: "attention", headline: "1 job is overdue", detail: "Boiler" });
    expect(upkeepAnswer(tasks.slice(1), TODAY)).toMatchObject({ status: "neutral", headline: "1 job coming up in the next two months" });
    expect(upkeepAnswer(tasks.slice(2), TODAY)?.status).toBe("good");
    expect(upkeepAnswer([], TODAY)).toBeNull();
  });

  it("parses the show filter", () => {
    expect(parseUpkeepShow("overdue")).toBe("overdue");
    expect(parseUpkeepShow("soon")).toBe("soon");
    expect(parseUpkeepShow("x")).toBe("all");
    expect(parseUpkeepShow(undefined)).toBe("all");
  });
});

describe("form hints and history totals", () => {
  it("shows the resulting months for sub-annual seasonal jobs", () => {
    expect(monthsHint(6, 4)).toBe("Due in April and October.");
    expect(monthsHint(3, 1)).toBe("Due in January, April, July and October.");
    expect(monthsHint(12, 4)).toBeNull();
    expect(monthsHint(6, null)).toBeNull();
  });

  it("totals the history in cents", () => {
    const log = [
      { done_on: "2026-10-04", cost: "240.10" },
      { done_on: "2024-09-28", cost: "219.95" },
      { done_on: "2025-09-30", cost: null },
    ];
    expect(historyTotals(log, true)).toBe("Done 3 times since 2024 · $460.05 in all");
    expect(historyTotals(log, false)).toBe("Done 3 times since 2024");
    expect(historyTotals([{ done_on: "2026-01-02", cost: null }], true)).toBe("Done once since 2026 · $0 in all");
    expect(historyTotals([], true)).toBeNull();
  });
});
