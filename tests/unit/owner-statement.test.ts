import { describe, expect, it } from "vitest";
import { balanceWords, lineAmount, lineSummary, parsePeriodParams, presetPeriods, type StatementLine } from "@/lib/owner/statement";

const TODAY = "2026-10-14";
const line = (o: Partial<StatementLine>): StatementLine => ({
  seq: 1, line_date: "2026-01-01", kind: "charge", description: "x", charge: null, payment: null, adjustment: null,
  balance: "0.00", charge_id: null, payment_id: null, ...o,
});

describe("presetPeriods", () => {
  it("this year, last year and everything", () => {
    expect(presetPeriods(TODAY)).toEqual([
      { key: "this_year", label: "2026", from: "2026-01-01", to: "2026-12-31" },
      { key: "last_year", label: "2025", from: "2025-01-01", to: "2025-12-31" },
      { key: "all", label: "Everything", from: null, to: null },
    ]);
  });
});

describe("parsePeriodParams", () => {
  it("defaults to this year", () => {
    expect(parsePeriodParams({}, TODAY)).toEqual({ from: "2026-01-01", to: "2026-12-31", label: "2026" });
  });
  it("takes a preset", () => {
    expect(parsePeriodParams({ preset: "last_year" }, TODAY)).toEqual({ from: "2025-01-01", to: "2025-12-31", label: "2025" });
    expect(parsePeriodParams({ preset: "all" }, TODAY)).toEqual({ from: null, to: null, label: "Everything" });
  });
  it("falls back to this year on bad dates", () => {
    for (const bad of [{ from: "yesterday" }, { to: "2026-13-40" }, { from: "2026-02-30", to: "2026-03-01" }, { from: "2026-1-1" }]) {
      expect(parsePeriodParams(bad, TODAY).label).toBe("2026");
    }
    expect(parsePeriodParams({ preset: "nonsense" }, TODAY).label).toBe("2026");
  });
  it("swaps a reversed range", () => {
    expect(parsePeriodParams({ from: "2026-06-30", to: "2026-03-01" }, TODAY)).toEqual({
      from: "2026-03-01",
      to: "2026-06-30",
      label: "March 1, 2026 to June 30, 2026",
    });
  });
  it("clamps a span over ten years", () => {
    const p = parsePeriodParams({ from: "2000-01-01", to: "2026-10-14" }, TODAY);
    expect(p.to).toBe("2026-10-14");
    expect(p.from).toBe("2016-10-14");
  });
  it("accepts one open end", () => {
    expect(parsePeriodParams({ from: "2026-03-01" }, TODAY)).toEqual({ from: "2026-03-01", to: null, label: "From March 1, 2026" });
    expect(parsePeriodParams({ to: "2026-03-01" }, TODAY)).toEqual({ from: null, to: "2026-03-01", label: "Up to March 1, 2026" });
  });
  it("handles 29 February when clamping", () => {
    const p = parsePeriodParams({ from: "2010-01-01", to: "2024-02-29" }, TODAY);
    expect(p.from).toBe("2014-02-28");
  });
});

describe("lineAmount and lineSummary", () => {
  it("charges add in neutral ink", () => {
    expect(lineAmount(line({ kind: "charge", charge: "750.00" }))).toEqual({ text: "$750.00", tone: "neutral", sign: "+" });
    expect(lineSummary(line({ kind: "charge", charge: "750.00" }))).toBe("+$750.00 charged");
  });
  it("payments take away in the good tone", () => {
    expect(lineAmount(line({ kind: "payment", payment: "1000.00" }))).toEqual({ text: "$1,000.00", tone: "good", sign: "-" });
    expect(lineSummary(line({ kind: "payment", payment: "1000.00" }))).toBe("-$1,000.00 paid");
  });
  it("waivers and write-offs take away in neutral ink", () => {
    expect(lineAmount(line({ kind: "waiver", adjustment: "25.00" }))).toEqual({ text: "$25.00", tone: "neutral", sign: "-" });
    expect(lineAmount(line({ kind: "write_off", adjustment: "100.00" }))).toEqual({ text: "$100.00", tone: "neutral", sign: "-" });
    expect(lineSummary(line({ kind: "waiver", adjustment: "25.00" }))).toBe("-$25.00 waived");
  });
  it("the opening line has no amount", () => {
    expect(lineAmount(line({ kind: "opening" }))).toEqual({ text: "", tone: "neutral", sign: "" });
    expect(lineSummary(line({ kind: "opening" }))).toBe("");
  });
});

describe("balanceWords", () => {
  it("owed, credit and paid up", () => {
    expect(balanceWords("500.00")).toBe("$500.00 owed");
    expect(balanceWords("-250.00")).toBe("$250.00 credit");
    expect(balanceWords("0.00")).toBe("Paid up");
    expect(balanceWords("-0.00")).toBe("Paid up");
    expect(balanceWords("1500.5")).toBe("$1,500.50 owed");
  });
});
