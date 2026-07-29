/**
 * Form 1120-H computation.
 *
 * Pure functions over figures the database supplies. No database access here,
 * so the arithmetic is testable on its own — which matters more than usual,
 * because none of this has been reviewed by a CPA (docs/DECISIONS.md open
 * question A) and every output must be presented as provisional.
 *
 * All money is handled in integer cents internally. NUMERIC(14,2) arrives from
 * Postgres as a string precisely so it does not pass through a float; parsing
 * it into a JS number and multiplying would reintroduce exactly the error the
 * schema exists to prevent.
 */

export type TaxParameterKey =
  | "form_1120h_rate_condo"
  | "form_1120h_specific_deduction"
  | "form_1120h_income_test"
  | "form_1120h_expenditure_test";

export interface TaxParameter {
  key: string;
  numericValue: string;
  sourceUrl: string | null;
  /** Null means nobody has checked this against the IRS instructions. */
  verifiedOn: string | null;
  notes: string | null;
}

/** Cash-basis figures, as NUMERIC strings from the database. */
export interface Figures {
  exemptIncome: string;
  nonexemptIncome: string;
  grossIncome: string;
  exemptExpenditures: string;
  totalExpenditures: string;
}

export interface TestResult {
  /** e.g. 0.6 */
  threshold: number;
  /** Null when the denominator is zero — a ratio, not a failure. */
  ratio: number | null;
  passed: boolean;
  numeratorCents: number;
  denominatorCents: number;
}

export interface Form1120hResult {
  incomeTest: TestResult;
  expenditureTest: TestResult;
  qualifies: boolean;
  exemptIncomeCents: number;
  nonexemptIncomeCents: number;
  specificDeductionCents: number;
  taxableIncomeCents: number;
  taxDueCents: number;
  rate: number;
  /** True when any parameter used has no verifiedOn date. */
  usesUnverifiedParameters: boolean;
  parametersUsed: TaxParameter[];
}

/** "1234.56" -> 123456. Rejects anything that is not a plain decimal. */
export function toCents(numeric: string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(numeric.trim());
  if (!m) throw new Error(`not a NUMERIC(14,2) value: ${JSON.stringify(numeric)}`);
  const [, sign, whole, frac = ""] = m;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return sign === "-" ? -cents : cents;
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function requireParam(params: TaxParameter[], key: TaxParameterKey): TaxParameter {
  const found = params.find((p) => p.key === key);
  if (!found) {
    // Never fall back to a literal. A missing rate must stop the computation,
    // not silently substitute one nobody sourced. (CLAUDE.md invariant 8.)
    throw new Error(`tax parameter ${key} is not present in tax_parameters`);
  }
  return found;
}

function ratioTest(
  numeratorCents: number,
  denominatorCents: number,
  threshold: number,
): TestResult {
  if (denominatorCents === 0) {
    // No income, or no expenditures. The ratio is undefined rather than zero,
    // and an association with no activity has not failed anything.
    return { threshold, ratio: null, passed: true, numeratorCents, denominatorCents };
  }
  const ratio = numeratorCents / denominatorCents;
  return {
    threshold,
    ratio,
    passed: ratio >= threshold,
    numeratorCents,
    denominatorCents,
  };
}

export function computeForm1120h(
  figures: Figures,
  parameters: TaxParameter[],
): Form1120hResult {
  const rateParam = requireParam(parameters, "form_1120h_rate_condo");
  const deductionParam = requireParam(parameters, "form_1120h_specific_deduction");
  const incomeTestParam = requireParam(parameters, "form_1120h_income_test");
  const expenditureTestParam = requireParam(parameters, "form_1120h_expenditure_test");

  const used = [rateParam, deductionParam, incomeTestParam, expenditureTestParam];

  const exemptIncomeCents = toCents(figures.exemptIncome);
  const nonexemptIncomeCents = toCents(figures.nonexemptIncome);
  const grossIncomeCents = toCents(figures.grossIncome);
  const exemptExpendituresCents = toCents(figures.exemptExpenditures);
  const totalExpendituresCents = toCents(figures.totalExpenditures);

  const incomeTest = ratioTest(
    exemptIncomeCents,
    grossIncomeCents,
    Number(incomeTestParam.numericValue),
  );
  const expenditureTest = ratioTest(
    exemptExpendituresCents,
    totalExpendituresCents,
    Number(expenditureTestParam.numericValue),
  );

  const specificDeductionCents = toCents(
    Number(deductionParam.numericValue).toFixed(2),
  );

  // Only non-exempt income is taxed under the section 528 election. Exempt
  // function income is excluded entirely, which is why the ratio matters far
  // more than the dollar figure.
  const taxableIncomeCents = Math.max(
    0,
    nonexemptIncomeCents - specificDeductionCents,
  );

  const rate = Number(rateParam.numericValue);
  const taxDueCents = Math.round(taxableIncomeCents * rate);

  return {
    incomeTest,
    expenditureTest,
    qualifies: incomeTest.passed && expenditureTest.passed,
    exemptIncomeCents,
    nonexemptIncomeCents,
    specificDeductionCents,
    taxableIncomeCents,
    taxDueCents,
    rate,
    usesUnverifiedParameters: used.some((p) => p.verifiedOn === null),
    parametersUsed: used,
  };
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function formatPercent(ratio: number | null): string {
  if (ratio === null) return "n/a";
  return `${(ratio * 100).toFixed(2)}%`;
}
