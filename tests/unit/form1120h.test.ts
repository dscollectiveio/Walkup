import { describe, expect, it } from "vitest";
import {
  computeForm1120h,
  fromCents,
  toCents,
  type Figures,
  type TaxParameter,
} from "@/lib/tax/form1120h";

const PARAMS: TaxParameter[] = [
  { key: "form_1120h_rate_condo", numericValue: "0.300000", sourceUrl: null, verifiedOn: "2026-01-15", notes: null },
  { key: "form_1120h_specific_deduction", numericValue: "100.000000", sourceUrl: null, verifiedOn: "2026-01-15", notes: null },
  { key: "form_1120h_income_test", numericValue: "0.600000", sourceUrl: null, verifiedOn: "2026-01-15", notes: null },
  { key: "form_1120h_expenditure_test", numericValue: "0.900000", sourceUrl: null, verifiedOn: "2026-01-15", notes: null },
];

const figures = (f: Partial<Figures>): Figures => ({
  exemptIncome: "0.00",
  nonexemptIncome: "0.00",
  grossIncome: "0.00",
  exemptExpenditures: "0.00",
  totalExpenditures: "0.00",
  ...f,
});

describe("money conversion", () => {
  it("parses NUMERIC strings without going through a float", () => {
    expect(toCents("1234.56")).toBe(123456);
    expect(toCents("0.01")).toBe(1);
    expect(toCents("100")).toBe(10000);
    expect(toCents("100.5")).toBe(10050);
    expect(toCents("-42.42")).toBe(-4242);
  });

  it("survives the values that break floating point", () => {
    // 0.1 + 0.2 !== 0.3 in float. In cents it is exact.
    expect(toCents("0.10") + toCents("0.20")).toBe(toCents("0.30"));
    expect(fromCents(toCents("8237.35"))).toBe("8237.35");
  });

  it("refuses anything that is not a plain decimal", () => {
    expect(() => toCents("1e5")).toThrow(/NUMERIC/);
    expect(() => toCents("1.234")).toThrow(/NUMERIC/);
    expect(() => toCents("")).toThrow(/NUMERIC/);
  });

  it("refuses a JSON number, because PostgREST turns NUMERIC into a float", () => {
    // Regression. The tax page crashed here after moving to supabase-js:
    // PostgREST serializes NUMERIC to a JSON number, so money reached the
    // computation as an IEEE 754 double. Migration 0011 casts to ::text; this
    // asserts the guard stays loud rather than silently accepting a float.
    // @ts-expect-error deliberately passing the wrong type
    expect(() => toCents(8090.37)).toThrow(/must cross the API boundary as text/);
    // @ts-expect-error deliberately passing the wrong type
    expect(() => toCents(null)).toThrow(/must cross the API boundary as text/);
  });
});

describe("60% income test", () => {
  it("passes an association whose income is overwhelmingly assessments", () => {
    const r = computeForm1120h(
      figures({ exemptIncome: "8400.00", nonexemptIncome: "582.55", grossIncome: "8982.55" }),
      PARAMS,
    );
    expect(r.incomeTest.passed).toBe(true);
    expect(r.incomeTest.ratio).toBeCloseTo(0.93515, 5);
  });

  it("fails when non-exempt income dominates", () => {
    const r = computeForm1120h(
      figures({ exemptIncome: "4000.00", nonexemptIncome: "6000.00", grossIncome: "10000.00" }),
      PARAMS,
    );
    expect(r.incomeTest.passed).toBe(false);
    expect(r.qualifies).toBe(false);
  });

  it("treats exactly 60% as passing", () => {
    const r = computeForm1120h(
      figures({ exemptIncome: "6000.00", nonexemptIncome: "4000.00", grossIncome: "10000.00" }),
      PARAMS,
    );
    expect(r.incomeTest.ratio).toBe(0.6);
    expect(r.incomeTest.passed).toBe(true);
  });

  it("shows how delinquency moves the ratio on the cash basis", () => {
    // The scenario from DECISIONS #1. Same association, same year; the only
    // difference is that one owner of four stopped paying. Assessments are
    // exempt income, so uncollected cash lowers the exempt numerator while
    // reserve interest keeps arriving regardless.
    const collected = computeForm1120h(
      figures({ exemptIncome: "8400.00", nonexemptIncome: "3000.00", grossIncome: "11400.00" }),
      PARAMS,
    );
    const delinquent = computeForm1120h(
      figures({ exemptIncome: "4200.00", nonexemptIncome: "3000.00", grossIncome: "7200.00" }),
      PARAMS,
    );

    expect(collected.incomeTest.passed).toBe(true);
    expect(delinquent.incomeTest.passed).toBe(false);
    // Accrual books would have shown 8400 of income in both cases and hidden
    // this entirely.
  });
});

describe("90% expenditure test", () => {
  it("counts a capitalized improvement toward the numerator", () => {
    // A $6,200 roof is an asset on the books, but it is care of association
    // property and belongs in the 90% numerator (DECISIONS #2).
    const r = computeForm1120h(
      figures({ exemptExpenditures: "12385.63", totalExpenditures: "12449.63" }),
      PARAMS,
    );
    expect(r.expenditureTest.passed).toBe(true);
    expect(r.expenditureTest.ratio).toBeGreaterThan(0.99);
  });

  it("is dragged down by income tax paid, which is not an exempt expenditure", () => {
    const r = computeForm1120h(
      figures({ exemptExpenditures: "8000.00", totalExpenditures: "10000.00" }),
      PARAMS,
    );
    expect(r.expenditureTest.ratio).toBe(0.8);
    expect(r.expenditureTest.passed).toBe(false);
  });
});

describe("tax due", () => {
  it("taxes only non-exempt income, after the specific deduction", () => {
    const r = computeForm1120h(
      figures({ exemptIncome: "8400.00", nonexemptIncome: "582.55", grossIncome: "8982.55" }),
      PARAMS,
    );
    // (582.55 - 100.00) * 0.30
    expect(r.taxableIncomeCents).toBe(48255);
    expect(r.taxDueCents).toBe(14477); // 144.765 rounds to 144.77
  });

  it("never produces negative taxable income", () => {
    const r = computeForm1120h(
      figures({ exemptIncome: "8400.00", nonexemptIncome: "40.00", grossIncome: "8440.00" }),
      PARAMS,
    );
    expect(r.taxableIncomeCents).toBe(0);
    expect(r.taxDueCents).toBe(0);
  });

  it("ignores exempt income entirely when computing tax", () => {
    const small = computeForm1120h(
      figures({ exemptIncome: "1000.00", nonexemptIncome: "500.00", grossIncome: "1500.00" }),
      PARAMS,
    );
    const large = computeForm1120h(
      figures({ exemptIncome: "900000.00", nonexemptIncome: "500.00", grossIncome: "900500.00" }),
      PARAMS,
    );
    expect(small.taxDueCents).toBe(large.taxDueCents);
  });
});

describe("parameters", () => {
  it("refuses to compute when a rate is missing rather than assuming one", () => {
    expect(() =>
      computeForm1120h(figures({}), PARAMS.filter((p) => p.key !== "form_1120h_rate_condo")),
    ).toThrow(/form_1120h_rate_condo is not present/);
  });

  it("flags results computed from unverified parameters", () => {
    const unverified = PARAMS.map((p) => ({ ...p, verifiedOn: null }));
    const r = computeForm1120h(figures({ grossIncome: "0.00" }), unverified);
    expect(r.usesUnverifiedParameters).toBe(true);
  });

  it("treats an association with no activity as not having failed", () => {
    const r = computeForm1120h(figures({}), PARAMS);
    expect(r.incomeTest.ratio).toBeNull();
    expect(r.qualifies).toBe(true);
  });
});
