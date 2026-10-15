import { describe, expect, it } from "vitest";
import { humanDate, moneyText, monthYear, whereLabel } from "@/lib/repairs/format";

const TODAY = "2026-10-14";

describe("humanDate", () => {
  it("says today, tomorrow and yesterday when adjacent", () => {
    expect(humanDate("2026-10-14", TODAY)).toBe("today");
    expect(humanDate("2026-10-15", TODAY)).toBe("tomorrow");
    expect(humanDate("2026-10-13", TODAY)).toBe("yesterday");
    expect(humanDate("2026-10-14T23:59:00Z", TODAY)).toBe("today");
    expect(humanDate("2027-01-01", "2026-12-31")).toBe("tomorrow");
  });

  it("gives the weekday this year and the year otherwise", () => {
    expect(humanDate("2026-10-22", TODAY)).toBe("Thu, Oct 22");
    expect(humanDate("2026-01-05", TODAY)).toBe("Mon, Jan 5");
    expect(humanDate("2027-10-22", TODAY)).toBe("Oct 22, 2027");
    expect(humanDate("2025-12-30", TODAY)).toBe("Dec 30, 2025");
  });

  it("passes unreadable input through", () => {
    expect(humanDate("soon", TODAY)).toBe("soon");
    expect(humanDate("2026-13-01", TODAY)).toBe("2026-13-01");
  });

  it("monthYear", () => {
    expect(monthYear("2026-09-14")).toBe("Sep 2026");
  });
});

describe("moneyText", () => {
  it("drops .00 and groups thousands", () => {
    expect(moneyText("1250.00")).toBe("$1,250");
    expect(moneyText("1250.50")).toBe("$1,250.50");
    expect(moneyText("1250.5")).toBe("$1,250.50");
    expect(moneyText("0.05")).toBe("$0.05");
    expect(moneyText("1234567.89")).toBe("$1,234,567.89");
    expect(moneyText("12")).toBe("$12");
    expect(moneyText("-40.00")).toBe("-$40");
  });

  it("is empty for nothing and refuses a float", () => {
    expect(moneyText(null)).toBe("");
    expect(moneyText("")).toBe("");
    expect(() => moneyText(12.5 as unknown as string)).toThrow(/as text/);
  });
});

describe("whereLabel", () => {
  it("names shared areas and units, with the detail", () => {
    expect(whereLabel(null, null)).toBe("Shared area");
    expect(whereLabel(null, "back stairwell")).toBe("Shared area: back stairwell");
    expect(whereLabel("Unit 2", null)).toBe("Inside Unit 2");
    expect(whereLabel("Unit 2", " kitchen ")).toBe("Inside Unit 2: kitchen");
    expect(whereLabel("Unit 2", "  ")).toBe("Inside Unit 2");
  });
});
