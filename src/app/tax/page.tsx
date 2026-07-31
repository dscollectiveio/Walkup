import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Jargon, Provisional, Restricted, money } from "@/components/ui";
import {
  computeForm1120h,
  formatMoney,
  formatPercent,
  type TaxParameter,
  type TestResult,
} from "@/lib/tax/form1120h";

export const dynamic = "force-dynamic";

/**
 * One of the two eligibility rules, explained in plain words.
 *
 * The spec requires both rules to "show their work" — a bare pass/fail is
 * useless to a board member deciding whether to change something before year
 * end. But showing the work is not the same as showing the arithmetic: the
 * useful thing is knowing how much room there is, and what would eat it.
 */
function Rule({
  heading,
  plainQuestion,
  test,
  numeratorLabel,
  denominatorLabel,
  technicalName,
  meaning,
}: {
  heading: string;
  plainQuestion: string;
  test: TestResult;
  numeratorLabel: string;
  denominatorLabel: string;
  technicalName: string;
  meaning: string;
}) {
  const headroomCents = Math.round(
    test.numeratorCents - test.threshold * test.denominatorCents,
  );

  return (
    <div className="rounded-xl border border-line bg-paper">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <div>
          <h3 className="font-semibold text-ink">{heading}</h3>
          <p className="mt-0.5 text-[13px] text-mute">{plainQuestion}</p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-[13px] font-medium ${
            test.passed
              ? "border-good-line bg-good-tint text-good-text"
              : "border-bad-line bg-bad-tint text-bad-text"
          }`}
        >
          {test.ratio === null ? "Nothing recorded yet" : test.passed ? "Yes" : "No"}
        </span>
      </header>

      <div className="px-5 py-4">
        {test.ratio !== null ? (
          <>
            {/* A bar reads faster than a percentage for someone who does not
                work with ratios daily. */}
            <div className="relative h-3 overflow-hidden rounded-full bg-fill">
              <div
                className={`h-full ${test.passed ? "bg-good" : "bg-bad"}`}
                style={{ width: `${Math.min(100, test.ratio * 100)}%` }}
              />
              <div
                className="absolute top-0 h-full w-0.5 bg-ink"
                style={{ left: `${test.threshold * 100}%` }}
                title={`Minimum required: ${formatPercent(test.threshold)}`}
              />
            </div>
            <div className="mt-2 flex justify-between text-[13px]">
              <span className="font-medium text-ink">
                You&rsquo;re at {formatPercent(test.ratio)}
              </span>
              <span className="text-mute">
                need {formatPercent(test.threshold)} · marked by the line
              </span>
            </div>

            {test.passed ? (
              <p className="mt-3 text-[13px] text-mute">
                You have <strong className="text-ink">{formatMoney(headroomCents)}</strong> of room
                before this rule would be at risk.
              </p>
            ) : (
              <p className="mt-3 text-[13px] font-medium text-bad-text">
                This rule is not met, so the simple tax form is not available
                this year.
              </p>
            )}
          </>
        ) : null}

        <dl className="mt-4 space-y-1 border-t border-line pt-3 text-[13px]">
          <div className="flex justify-between gap-4">
            <dt className="text-mute">{numeratorLabel}</dt>
            <dd className="figures text-ink">{formatMoney(test.numeratorCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-mute">{denominatorLabel}</dt>
            <dd className="figures text-ink">{formatMoney(test.denominatorCents)}</dd>
          </div>
        </dl>

        <p className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-mute">
          {meaning}{" "}
          <span className="text-mute-soft">Accountants call this the {technicalName}.</span>
        </p>
      </div>
    </div>
  );
}

export default async function TaxPage() {
  const supabase = await createClient();

  const { data: fiscalYears } = await supabase
    .from("fiscal_years")
    .select("id, label, association_id")
    .order("starts_on", { ascending: false })
    .limit(1);

  const fy = fiscalYears?.[0];
  if (!fy) return <Restricted what="the tax section" />;

  const [{ data: figuresRows }, { data: paramRows }, { data: receipts }, { data: disbursements }] =
    await Promise.all([
      supabase.rpc("form_1120h_figures", {
        p_association_id: fy.association_id,
        p_fiscal_year_id: fy.id,
      }),
      supabase.from("tax_parameters").select("key, numeric_value, source_url, verified_on, notes"),
      supabase
        .from("tax_receipts_by_account")
        .select("account_name, is_exempt, total")
        .eq("fiscal_year_id", fy.id)
        .order("is_exempt", { ascending: false })
        .order("total", { ascending: false }),
      supabase
        .from("tax_disbursements_by_account")
        .select("account_name, account_type, is_exempt, total")
        .eq("fiscal_year_id", fy.id)
        .order("is_exempt", { ascending: false })
        .order("total", { ascending: false }),
    ]);

  const f = Array.isArray(figuresRows) ? figuresRows[0] : figuresRows;
  if (!f) return <Restricted what="the tax section" />;

  const parameters: TaxParameter[] = (paramRows ?? []).map((p) => ({
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
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">
          Tax filing for {fy.label}
        </h1>
        <p className="mt-1 text-mute">
          Associations like yours can use a short tax form{" "}
          <Jargon term="Form 1120-H">instead of a full company return</Jargon>,
          as long as two rules are met.
        </p>
      </div>

      {result.qualifies ? (
        <Answer
          status="good"
          headline="You can use the short tax form this year"
          detail={
            result.taxDueCents > 0
              ? `Both rules are met. Based on your records you would owe about ${formatMoney(result.taxDueCents)}.`
              : "Both rules are met, and based on your records you would owe no tax."
          }
        />
      ) : (
        <Answer
          status="bad"
          headline="You do not currently qualify for the short tax form"
          detail="At least one of the two rules is not met. Talk to an accountant before the filing deadline — there may still be time to change the outcome."
        />
      )}

      {result.usesUnverifiedParameters ? <Provisional /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Rule
          heading="Rule 1 — where your money comes from"
          plainQuestion="Is most of your income ordinary member fees?"
          test={result.incomeTest}
          numeratorLabel="Fees collected from owners"
          denominatorLabel="All money collected"
          technicalName="60% income test"
          meaning="This counts money you actually received this year, not money you billed. If an owner stops paying, this number goes down — which is why chasing unpaid fees matters for more than just cash flow."
        />
        <Rule
          heading="Rule 2 — what you spend it on"
          plainQuestion="Is almost all your spending on the building?"
          test={result.expenditureTest}
          numeratorLabel="Spent on the building"
          denominatorLabel="All money spent"
          technicalName="90% expenditure test"
          meaning="Repairs, insurance, utilities and improvements all count as spending on the building. Income tax you paid does not, which nudges this number down slightly."
        />
      </div>

      <Card
        title="What you would owe"
        hint="Owner fees are not taxed. Only other income — bank interest, laundry, renting out common space — is."
      >
        <dl className="max-w-md space-y-2 text-[13px]">
          <div className="flex justify-between gap-4">
            <dt className="text-mute">Income that can be taxed</dt>
            <dd className="figures text-ink">{formatMoney(result.nonexemptIncomeCents)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-line pb-2">
            <dt className="text-mute">Allowance every association gets</dt>
            <dd className="figures text-ink">−{formatMoney(result.specificDeductionCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-mute">
              Taxed at {(result.rate * 100).toFixed(0)}%
            </dt>
            <dd className="figures text-ink">{formatMoney(result.taxableIncomeCents)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line-strong pt-2">
            <dt className="font-semibold text-ink">Estimated tax</dt>
            <dd className="figures text-[18px] text-ink">
              {formatMoney(result.taxDueCents)}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-[13px] text-mute">
          The {formatMoney(result.exemptIncomeCents)} you collected in owner fees
          is not taxed at all.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Money you collected" hint="What Rule 1 is worked out from.">
          <ul className="divide-y divide-line text-[13px]">
            {(receipts ?? []).map((r) => (
              <li key={r.account_name} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-ink">{r.account_name}</span>
                <span className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      r.is_exempt
                        ? "bg-good-tint text-good-text"
                        : "bg-warning-tint text-warning-text"
                    }`}
                  >
                    {r.is_exempt ? "owner fees" : "taxable"}
                  </span>
                  <span className="figures text-ink">{money(r.total)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Money you spent" hint="What Rule 2 is worked out from.">
          <ul className="divide-y divide-line text-[13px]">
            {(disbursements ?? []).map((d) => (
              <li key={d.account_name} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-ink">
                  {d.account_name}
                  {d.account_type === "asset" ? (
                    <span className="ml-2 text-[11px] text-mute-soft">major improvement</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      d.is_exempt
                        ? "bg-good-tint text-good-text"
                        : "bg-warning-tint text-warning-text"
                    }`}
                  >
                    {d.is_exempt ? "on the building" : "doesn't count"}
                  </span>
                  <span className="figures text-ink">{money(d.total)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card
        title="Where these tax rules come from"
        hint="Rates and thresholds are stored with their source so an out-of-date figure is visible rather than silent."
      >
        <ul className="divide-y divide-line text-[13px]">
          {result.parametersUsed.map((p) => (
            <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="text-mute">{p.notes?.split(".")[0] ?? p.key}</span>
              <span className="flex items-center gap-3">
                {p.verifiedOn ? (
                  <span className="text-[11px] text-good-text">checked {p.verifiedOn}</span>
                ) : (
                  <span className="text-[11px] font-medium text-warning-text">not yet checked</span>
                )}
                {p.sourceUrl ? (
                  <a
                    href={p.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-mute underline-offset-2 hover:underline"
                  >
                    IRS source
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
