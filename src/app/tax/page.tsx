import { queryAs } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { Card, Provisional, Restricted, money } from "@/components/ui";
import {
  computeForm1120h,
  formatMoney,
  formatPercent,
  type TaxParameter,
  type TestResult,
} from "@/lib/tax/form1120h";

export const dynamic = "force-dynamic";

function TestPanel({
  title,
  test,
  numeratorLabel,
  denominatorLabel,
  explanation,
}: {
  title: string;
  test: TestResult;
  numeratorLabel: string;
  denominatorLabel: string;
  explanation: string;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white">
      <header className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            test.passed
              ? "bg-emerald-100 text-emerald-800"
              : "bg-red-100 text-red-800"
          }`}
        >
          {test.ratio === null ? "No activity" : test.passed ? "Passes" : "FAILS"}
        </span>
      </header>

      <div className="space-y-3 px-5 py-4">
        {/* Show the work. A bare pass/fail is useless to a board member who
            has to decide whether to change something before year end. */}
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-stone-600">{numeratorLabel}</dt>
            <dd className="tabular font-medium">{formatMoney(test.numeratorCents)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-stone-100 pb-1.5">
            <dt className="text-stone-600">{denominatorLabel}</dt>
            <dd className="tabular font-medium">{formatMoney(test.denominatorCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="font-medium">Ratio</dt>
            <dd className="tabular font-semibold">{formatPercent(test.ratio)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-stone-600">Required</dt>
            <dd className="tabular text-stone-600">
              at least {formatPercent(test.threshold)}
            </dd>
          </div>
        </dl>

        {test.ratio !== null && test.passed ? (
          <p className="text-xs text-stone-500">
            Headroom:{" "}
            {formatMoney(
              Math.round(test.numeratorCents - test.threshold * test.denominatorCents),
            )}
          </p>
        ) : null}

        <p className="border-t border-stone-100 pt-3 text-xs leading-relaxed text-stone-500">
          {explanation}
        </p>
      </div>
    </div>
  );
}

export default async function TaxPage() {
  const userId = await getCurrentUserId();

  const fiscalYears = await queryAs<{ id: string; label: string; association_id: string }>(
    userId,
    `select id, label, association_id from fiscal_years order by starts_on desc limit 1`,
  );

  if (fiscalYears.length === 0) {
    return <Restricted what="tax worksheets" />;
  }
  const fy = fiscalYears[0];

  const [figuresRows, paramRows, receipts, disbursements] = await Promise.all([
    queryAs<{
      exempt_income: string;
      nonexempt_income: string;
      gross_income: string;
      exempt_expenditures: string;
      total_expenditures: string;
    }>(userId, `select * from form_1120h_figures($1::uuid, $2::uuid)`, [
      fy.association_id,
      fy.id,
    ]),
    queryAs<{
      key: string;
      numeric_value: string;
      source_url: string | null;
      verified_on: string | null;
      notes: string | null;
    }>(userId, `select key, numeric_value, source_url, verified_on, notes from tax_parameters`),
    queryAs<{ name: string; is_exempt: boolean; total: string }>(
      userId,
      `select income_account_name as name, is_exempt, sum(amount)::text as total
         from cash_basis_receipts
        where association_id = $1 and fiscal_year_id = $2
        group by 1,2 order by is_exempt desc, 3 desc`,
      [fy.association_id, fy.id],
    ),
    queryAs<{ name: string; is_exempt: boolean; account_type: string; total: string }>(
      userId,
      `select account_name as name, is_exempt, account_type, sum(amount)::text as total
         from cash_basis_disbursements
        where association_id = $1 and fiscal_year_id = $2
        group by 1,2,3 order by is_exempt desc, 4 desc`,
      [fy.association_id, fy.id],
    ),
  ]);

  const f = figuresRows[0];
  const parameters: TaxParameter[] = paramRows.map((p) => ({
    key: p.key,
    numericValue: p.numeric_value,
    sourceUrl: p.source_url,
    verifiedOn: p.verified_on,
    notes: p.notes,
  }));

  const result = computeForm1120h(
    {
      exemptIncome: f.exempt_income,
      nonexemptIncome: f.nonexempt_income,
      grossIncome: f.gross_income,
      exemptExpenditures: f.exempt_expenditures,
      totalExpenditures: f.total_expenditures,
    },
    parameters,
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Form 1120-H worksheet · {fy.label}
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Computed on the cash method. Assessments charged but not collected are
          not income here, even though the books accrue them.
        </p>
      </div>

      {result.usesUnverifiedParameters ? <Provisional /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <TestPanel
          title="60% income test"
          test={result.incomeTest}
          numeratorLabel="Exempt function income received"
          denominatorLabel="Gross income received"
          explanation="Cash actually received, classified by what it was for. Assessment payments are traced through to the charge they settled; interest and laundry are classified directly. An owner who stops paying reduces the numerator, which is why delinquency can move this ratio even when the books look healthy."
        />
        <TestPanel
          title="90% expenditure test"
          test={result.expenditureTest}
          numeratorLabel="Exempt expenditures paid"
          denominatorLabel="Total expenditures paid"
          explanation="Cash actually spent, classified by what it bought. Capitalized improvements count here even though they are assets on the balance sheet, because they are care of association property. Income tax paid does not count, so paying tax on reserve interest mildly lowers this ratio."
        />
      </div>

      <Card
        title="Tax computation"
        hint="Only non-exempt income is taxed under the section 528 election."
      >
        <dl className="max-w-md space-y-1.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-stone-600">Non-exempt income</dt>
            <dd className="tabular">{formatMoney(result.nonexemptIncomeCents)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-stone-100 pb-1.5">
            <dt className="text-stone-600">Specific deduction</dt>
            <dd className="tabular">−{formatMoney(result.specificDeductionCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-stone-600">Taxable income</dt>
            <dd className="tabular">{formatMoney(result.taxableIncomeCents)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-stone-100 pb-1.5">
            <dt className="text-stone-600">Rate</dt>
            <dd className="tabular">{(result.rate * 100).toFixed(0)}%</dd>
          </div>
          <div className="flex justify-between gap-4 pt-1">
            <dt className="font-semibold">Tax due</dt>
            <dd className="tabular text-lg font-semibold">
              {formatMoney(result.taxDueCents)}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-stone-500">
          Exempt function income of {formatMoney(result.exemptIncomeCents)} is
          excluded entirely. The election is{" "}
          {result.qualifies ? "available" : "NOT available — both tests must pass"}.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Cash received" hint="What the 60% test is built from.">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-stone-100">
              {receipts.map((r) => (
                <tr key={r.name}>
                  <td className="py-2">{r.name}</td>
                  <td className="py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        r.is_exempt
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {r.is_exempt ? "exempt" : "non-exempt"}
                    </span>
                  </td>
                  <td className="tabular py-2 text-right">{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Cash spent" hint="What the 90% test is built from.">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-stone-100">
              {disbursements.map((d) => (
                <tr key={d.name}>
                  <td className="py-2">
                    {d.name}
                    {d.account_type === "asset" ? (
                      <span className="ml-2 text-xs text-stone-400">capitalized</span>
                    ) : null}
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        d.is_exempt
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {d.is_exempt ? "exempt" : "non-exempt"}
                    </span>
                  </td>
                  <td className="tabular py-2 text-right">{money(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Parameters used" hint="Never hardcoded. Every figure is dated and sourced.">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-stone-100">
            {result.parametersUsed.map((p) => (
              <tr key={p.key}>
                <td className="py-2 font-mono text-xs">{p.key}</td>
                <td className="tabular py-2">{p.numericValue}</td>
                <td className="py-2">
                  {p.verifiedOn ? (
                    <span className="text-xs text-emerald-700">
                      verified {p.verifiedOn}
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-red-700">unverified</span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {p.sourceUrl ? (
                    <a
                      href={p.sourceUrl}
                      className="text-xs text-stone-500 underline-offset-2 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      source
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
