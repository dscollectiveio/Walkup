import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Empty, Jargon, Provisional, Restricted, money } from "@/components/ui";
import {
  computeForm1120h,
  formatMoney,
  formatPercent,
  type TaxParameter,
  type TestResult,
} from "@/lib/tax/form1120h";
import { FilingStatus } from "./filing-status";
import { AccountLineDrilldown, type DrilldownLine } from "./account-line-drilldown";
import { ProvenancePanel, type ProvenanceRow, type ResolvedLine } from "./provenance-panel";
import { loadTaxContext } from "./data";
import { ClassifyIncomeRow, FormCard } from "./tax-client";
import { FORM_LABEL, FORM_PLAIN, nextDeadline } from "@/lib/tax/determine";
import { TAX_FOOTER } from "@/lib/tax/copy";

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
          <h3 className="font-black text-ink">{heading}</h3>
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

  // One context for the whole tab (and the form pages and exports), so the
  // forms list, the 1120-H check and the 1099 table can't disagree.
  const ctx = await loadTaxContext(supabase);
  if (!ctx) return <Restricted what="the tax section" />;
  const fy = { id: ctx.fiscalYear.id, label: ctx.fiscalYear.label, association_id: ctx.association.id };

  const [
    { data: figuresRows },
    { data: paramRows },
    { data: receipts },
    { data: disbursements },
    { data: taxForms },
    { data: filingRows },
    { data: rawReceipts },
    { data: rawDisbursements },
    { data: classifications },
    { data: canWriteRow },
  ] = await Promise.all([
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
    supabase
      .from("tax_forms")
      .select("id, form_code, tax_year, vendor_id, status, filed_on, filed_proof_document_id, signable_document_id, vendors(name)")
      .order("tax_year", { ascending: false }),
    supabase
      .from("tax_filings")
      .select("id, computed_at, filed_on, locked_at")
      .eq("association_id", fy.association_id)
      .eq("fiscal_year_id", fy.id)
      .eq("form", "1120-H")
      .limit(1),
    supabase
      .from("cash_basis_receipts")
      .select("journal_line_id, received_on, income_account_name, is_exempt, amount")
      .eq("association_id", fy.association_id)
      .eq("fiscal_year_id", fy.id),
    supabase
      .from("cash_basis_disbursements")
      .select("journal_line_id, paid_on, account_name, is_exempt, amount")
      .eq("association_id", fy.association_id)
      .eq("fiscal_year_id", fy.id),
    supabase
      .from("tax_line_classifications")
      .select("journal_line_id, is_exempt, note")
      .eq("association_id", fy.association_id),
    supabase.rpc("has_role_in", {
      assoc: fy.association_id,
      roles: ["board_admin", "board_member"],
    }),
  ]);

  const filing = filingRows?.[0] ?? null;
  const canWrite = canWriteRow === true;
  // Once a filing is locked, the transactions that fed it stop being
  // reclassifiable too — a saved, filed return should not keep drifting
  // underneath itself.
  const canReclassify = canWrite && !filing?.locked_at;

  const overriddenLineIds = new Set((classifications ?? []).map((c) => c.journal_line_id));

  const receiptLines = rawReceipts ?? [];
  const disbursementLines = rawDisbursements ?? [];

  const receiptsByAccount = new Map<string, DrilldownLine[]>();
  for (const r of receiptLines) {
    const list = receiptsByAccount.get(r.income_account_name) ?? [];
    list.push({
      journalLineId: r.journal_line_id,
      date: r.received_on,
      amount: money(r.amount),
      isExempt: r.is_exempt,
      overridden: overriddenLineIds.has(r.journal_line_id),
    });
    receiptsByAccount.set(r.income_account_name, list);
  }

  const disbursementsByAccount = new Map<string, DrilldownLine[]>();
  for (const d of disbursementLines) {
    const list = disbursementsByAccount.get(d.account_name) ?? [];
    list.push({
      journalLineId: d.journal_line_id,
      date: d.paid_on,
      amount: money(d.amount),
      isExempt: d.is_exempt,
      overridden: overriddenLineIds.has(d.journal_line_id),
    });
    disbursementsByAccount.set(d.account_name, list);
  }

  const lineIndex = new Map<string, ResolvedLine>();
  for (const r of receiptLines) {
    lineIndex.set(r.journal_line_id, {
      date: r.received_on,
      label: r.income_account_name,
      amount: r.amount,
    });
  }
  for (const d of disbursementLines) {
    lineIndex.set(d.journal_line_id, { date: d.paid_on, label: d.account_name, amount: d.amount });
  }

  let provenanceRows: ProvenanceRow[] = [];
  if (filing) {
    const { data } = await supabase
      .from("tax_figure_provenance")
      .select("figure_key, value, derivation, source_journal_line_ids, formula_description")
      .eq("filing_id", filing.id);
    provenanceRows = data ?? [];
  }

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

  // The 1099 threshold is read from tax_parameters and never hardcoded
  // (CLAUDE.md invariant 8). If it's missing, the section says so instead of
  // assuming a number.
  const thresholdParam = ctx.input.parameters.find((p) => p.key === "form_1099_nec_threshold") ?? null;
  const thresholdCents = thresholdParam ? Math.round(thresholdParam.value * 100) : null;
  const contractorRows = ctx.contractorRows;
  const owesForm = thresholdCents === null ? [] : contractorRows.filter((c) => c.totalCents >= thresholdCents);
  const missingW9 = owesForm.filter((c) => !c.w9OnFile);

  // ---- Your forms -----------------------------------------------------------
  const startedForms = taxForms ?? [];
  const startedFor = (code: string, year: number, vendorId?: string) =>
    startedForms.find((t) => t.form_code === code && t.tax_year === year && (t.vendor_id ?? undefined) === vendorId);
  const deadline = nextDeadline(ctx.forms, new Date());
  const daysLeft = deadline?.dueOn
    ? Math.ceil((new Date(`${deadline.dueOn}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000)
    : null;
  const nextAction =
    ctx.input.unconfirmedIncomeAccounts.length > 0
      ? { text: "Classify your income so the 1120-H check can run", href: "#income" }
      : missingW9.length > 0
        ? { text: `Get a W-9 from ${missingW9[0].name}`, href: "/contractors" }
        : deadline
          ? { text: `Start ${FORM_LABEL[deadline.formCode]}`, href: "#forms" }
          : null;
  const pastForms = startedForms.filter((t) => t.status === "filed");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-black tracking-tight text-ink">Taxes</h1>
        <p className="mt-1 text-mute">
          Fiscal year {ctx.fiscalYear.label} ({ctx.fiscalYear.starts_on} to {ctx.fiscalYear.ends_on}) — which forms you
          need, why, and when.
        </p>
      </div>

      <section className="rounded-xl border border-line bg-paper px-5 py-4">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.07em] text-section-label">This year</h2>
        {deadline && daysLeft !== null ? (
          <p className="mt-1 text-[15px] text-ink">
            Next deadline: <span className="font-medium">{FORM_LABEL[deadline.formCode]}</span> on {deadline.dueOn} —{" "}
            {daysLeft} day{daysLeft === 1 ? "" : "s"} left.
          </p>
        ) : (
          <p className="mt-1 text-[15px] text-ink">
            No deadline is on file yet — due dates appear once each official form has been checked in Walkup.
          </p>
        )}
        {nextAction ? (
          <a href={nextAction.href} className="mt-2 inline-block text-[13px] font-medium text-ink underline underline-offset-2">
            {nextAction.text} →
          </a>
        ) : null}
      </section>

      <section id="forms" className="space-y-3">
        <h2 className="text-[16px] font-black tracking-tight text-ink">Your forms</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {ctx.forms.map((f) => {
            const started = startedFor(f.formCode, f.taxYear, f.vendorId);
            const vendorName = f.vendorId ? contractorRows.find((c) => c.vendorId === f.vendorId)?.name : null;
            return (
              <FormCard
                key={`${f.formCode}-${f.taxYear}-${f.vendorId ?? ""}`}
                outcome={f}
                title={`${FORM_LABEL[f.formCode]} · ${f.taxYear}${vendorName ? ` · ${vendorName}` : ""}`}
                plain={FORM_PLAIN[f.formCode]}
                started={started ? { id: started.id, status: started.status, filedOn: started.filed_on } : null}
                canWrite={canWrite}
              />
            );
          })}
        </div>
        <p className="text-[12px] text-mute">Other filings may apply. Ask your CPA.</p>
      </section>

      <Card
        title="Your income, classified"
        hint="The 1120-H tests depend on which income is from members (dues, assessments) and which isn't (interest, rentals). Walkup suggests a classification; a board member confirms each one once."
      >
        <div id="income" />
        {ctx.incomeAccounts.length === 0 ? (
          <Empty>No income recorded this fiscal year yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {ctx.incomeAccounts.map((a) => (
              <ClassifyIncomeRow
                key={a.id}
                accountId={a.id}
                name={a.name}
                total={formatMoney(a.totalCents)}
                isExempt={a.isExempt}
                confirmedAt={a.confirmedAt}
                canWrite={canWrite}
              />
            ))}
          </ul>
        )}
      </Card>

      <div className="border-t border-line pt-6">
        <h2 className="text-[16px] font-black tracking-tight text-ink">1120-H check</h2>
        <p className="mt-1 text-mute">
          Associations like yours can use a short tax form{" "}
          <Jargon term="Form 1120-H">instead of a full company return</Jargon>,
          as long as two rules are met. This runs all year from your records.
        </p>
      </div>

      {ctx.input.unconfirmedIncomeAccounts.length > 0 ? (
        <Answer
          status="attention"
          headline="Ask your CPA — some income isn't classified yet"
          detail={`Classify ${ctx.input.unconfirmedIncomeAccounts.join(", ")} above to check whether you qualify. The figures below use Walkup's suggestions until then.`}
        />
      ) : null}

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

      <FilingStatus fiscalYearId={fy.id} filing={filing} canWrite={canWrite} />

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

      <ProvenancePanel rows={provenanceRows} lineIndex={lineIndex} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Money you collected" hint="What Rule 1 is worked out from.">
          <ul className="divide-y divide-line text-[13px]">
            {(receipts ?? []).map((r) => (
              <li key={r.account_name} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
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
                </div>
                <AccountLineDrilldown
                  lines={receiptsByAccount.get(r.account_name) ?? []}
                  canWrite={canReclassify}
                  exemptLabel="owner fees"
                  nonExemptLabel="taxable"
                />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Money you spent" hint="What Rule 2 is worked out from.">
          <ul className="divide-y divide-line text-[13px]">
            {(disbursements ?? []).map((d) => (
              <li key={d.account_name} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
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
                </div>
                <AccountLineDrilldown
                  lines={disbursementsByAccount.get(d.account_name) ?? []}
                  canWrite={canReclassify}
                  exemptLabel="on the building"
                  nonExemptLabel="doesn't count"
                />
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

      <div className="border-t border-line pt-6">
        <div>
          <h2 className="text-[16px] font-black tracking-tight text-ink">
            Contractors and 1099s — payments in {ctx.contractorYear}
          </h2>
          <p className="mt-1 text-mute">
            1099-NEC is a calendar-year form: contractors paid for services during {ctx.contractorYear} at or above the
            threshold need one early in {ctx.contractorYear + 1}.
          </p>
        </div>

        <div className="mt-4">
          {thresholdCents === null ? (
            <Answer
              status="attention"
              headline="Ask your CPA which contractors need a 1099"
              detail="The 1099-NEC reporting threshold isn't on file in Walkup, so it can't tell you which contractors cross it."
            />
          ) : contractorRows.length === 0 ? (
            <Answer status="good" headline="Nothing to file" detail={`No contractor was paid for services in ${ctx.contractorYear}.`} />
          ) : missingW9.length > 0 ? (
            <Answer
              status="bad"
              headline={`${missingW9.length} contractor${missingW9.length === 1 ? " needs" : "s need"} a W-9 before you can file`}
              detail={`${missingW9.map((v) => v.name).join(", ")} — get these on file now rather than chasing them in January.`}
            />
          ) : (
            <Answer
              status="good"
              headline={`${owesForm.length} contractor${owesForm.length === 1 ? "" : "s"} will need a 1099-NEC`}
              detail="Everyone who crosses the threshold already has a W-9 on file."
            />
          )}
        </div>

        <div className="mt-4">
          <Card
            title="Everyone paid for services"
            hint={
              thresholdParam
                ? `The threshold is ${money(thresholdParam.value)} per contractor per calendar year. ${thresholdParam.verifiedOn ? `Checked ${thresholdParam.verifiedOn}.` : "Not yet checked against this year's IRS instructions."}`
                : undefined
            }
          >
            {contractorRows.length === 0 ? (
              <Empty>No service payments recorded for {ctx.contractorYear}.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-mute">
                      <th className="pb-2 font-medium">Contractor</th>
                      <th className="pb-2 text-right font-medium">Paid in {ctx.contractorYear}</th>
                      <th className="pb-2 text-right font-medium">W-9</th>
                      <th className="pb-2 text-right font-medium">1099 needed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {contractorRows.map((v) => {
                      const needsForm = thresholdCents !== null && v.totalCents >= thresholdCents;
                      return (
                        <tr key={v.vendorId}>
                          <td className="py-3">
                            <a href={`/contractors/${v.vendorId}`} className="font-medium text-ink underline-offset-2 hover:underline">
                              {v.name}
                            </a>
                            <div className="text-[11px] text-mute-soft">
                              {v.paymentCount} payment{v.paymentCount === 1 ? "" : "s"}
                            </div>
                          </td>
                          <td className="figures py-3 text-right text-ink">{formatMoney(v.totalCents)}</td>
                          <td className="py-3 text-right text-[12px]">
                            {v.w9OnFile ? <span className="text-good-text">On file</span> : <span className="text-bad-text">Missing</span>}
                          </td>
                          <td className="py-3 text-right text-[12px]">
                            {thresholdCents === null ? (
                              <span className="text-mute">Ask your CPA</span>
                            ) : needsForm ? (
                              <span className="font-medium text-ink">Yes</span>
                            ) : (
                              <span className="text-mute-soft">No</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-mute">
          Corporations are usually exempt from 1099-NEC — mark a contractor exempt on the Contractors page rather than
          assuming from the totals here.
        </p>
      </div>

      <Card title="Past years" hint="Forms marked as filed, with their proof.">
        {pastForms.length === 0 ? (
          <Empty>Nothing marked as filed yet.</Empty>
        ) : (
          <ul className="divide-y divide-line text-[13px]">
            {pastForms.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <a href={`/tax/forms/${t.id}`} className="text-ink underline-offset-2 hover:underline">
                  {FORM_LABEL[t.form_code as keyof typeof FORM_LABEL] ?? t.form_code} · {t.tax_year}
                  {(t.vendors as unknown as { name: string } | null)?.name ? ` · ${(t.vendors as unknown as { name: string }).name}` : ""}
                </a>
                <span className="flex items-center gap-3 text-[12px] text-mute">
                  Filed on {t.filed_on}
                  {t.filed_proof_document_id ? (
                    <a href={`/documents/${t.filed_proof_document_id}`} className="underline underline-offset-2">Proof</a>
                  ) : null}
                  {t.signable_document_id ? (
                    <a href={`/documents/${t.signable_document_id}`} className="underline underline-offset-2">The form</a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-[11px] text-mute">{TAX_FOOTER}</p>
    </div>
  );
}
