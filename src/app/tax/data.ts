import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { toCents } from "@/lib/tax/form1120h";
import { determineForms, run1120hTests, type DetermineInput, type FormOutcome, type TemplateRule } from "@/lib/tax/determine";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface TaxContext {
  association: {
    id: string;
    legal_name: string;
    display_name: string;
    ein: string | null;
    state_code: string;
    incorporated_on: string | null;
    street_address: string | null;
    city: string | null;
    postal_code: string | null;
  };
  fiscalYear: { id: string; label: string; starts_on: string; ends_on: string; taxYear: number };
  contractorYear: number;
  input: DetermineInput;
  forms: FormOutcome[];
  /** Income accounts with activity this fiscal year, and whether a board member has confirmed their classification. */
  incomeAccounts: { id: string; name: string; isExempt: boolean; confirmedAt: string | null; totalCents: number }[];
  receiptLineIds: { exempt: string[]; nonexempt: string[] };
  disbursementLineIds: { exempt: string[]; all: string[] };
  contractorRows: {
    vendorId: string;
    name: string;
    address: string | null;
    totalCents: number;
    paymentCount: number;
    w9OnFile: boolean;
    expenseIds: string[];
  }[];
  /** Per-line overrides entered this fiscal year (a manual edit to the classified set). */
  overridesThisYear: number;
  thresholdsVerified: boolean;
}

/**
 * Everything the Taxes tab, form pages and exports need, in one place so they
 * can't disagree. 1099s look at the calendar year just ended in January and
 * February (when they're prepared), and at the current year otherwise.
 */
export async function loadTaxContext(supabase: Supabase, today = new Date()): Promise<TaxContext | null> {
  const todayIso = today.toISOString().slice(0, 10);
  const [{ data: associations }, { data: fiscalYears }] = await Promise.all([
    supabase
      .from("associations")
      .select("id, legal_name, display_name, ein, state_code, incorporated_on, street_address, city, postal_code")
      .limit(1),
    supabase.from("fiscal_years").select("id, label, starts_on, ends_on").order("starts_on", { ascending: false }),
  ]);
  const association = associations?.[0];
  const fy = (fiscalYears ?? []).find((f) => f.starts_on <= todayIso && f.ends_on >= todayIso) ?? fiscalYears?.[0];
  if (!association || !fy) return null;

  const contractorYear = today.getMonth() < 2 ? today.getFullYear() - 1 : today.getFullYear();
  const taxYear = Number(fy.ends_on.slice(0, 4));

  const [
    { data: figuresRows },
    { data: paramRows },
    { data: receipts },
    { data: disbursements },
    { data: incomeAccounts },
    { data: contractorRows },
    { data: templates },
    { data: overrides },
  ] = await Promise.all([
    supabase.rpc("form_1120h_figures", { p_association_id: association.id, p_fiscal_year_id: fy.id }),
    supabase.from("tax_parameters").select("key, numeric_value, source_url, verified_on, effective_from, effective_to"),
    supabase
      .from("cash_basis_receipts")
      .select("journal_line_id, income_account_id, income_account_name, is_exempt, amount")
      .eq("fiscal_year_id", fy.id),
    supabase.from("cash_basis_disbursements").select("journal_line_id, is_exempt, amount").eq("fiscal_year_id", fy.id),
    supabase
      .from("accounts")
      .select("id, name, is_exempt_function_income, tax_classification_confirmed_at")
      .eq("type", "income")
      .eq("is_active", true)
      .order("code"),
    supabase
      .from("vendor_1099_calendar_totals")
      .select("vendor_id, name, address, total_paid, payment_count, w9_on_file, expense_ids")
      .eq("calendar_year", contractorYear)
      .order("total_paid", { ascending: false }),
    supabase
      .from("tax_form_templates")
      .select("form_code, tax_year, due_rule, due_rule_citation, notes, verified_at, active")
      .eq("active", true),
    supabase
      .from("tax_line_classifications")
      .select("id, updated_at")
      .gte("updated_at", `${today.getFullYear()}-01-01`),
  ]);

  const f = (Array.isArray(figuresRows) ? figuresRows[0] : figuresRows) as Record<string, string> | undefined;
  const effective = (paramRows ?? []).filter(
    (p) => p.effective_from <= todayIso && (p.effective_to === null || p.effective_to >= todayIso),
  );

  const incomeTotals = new Map<string, number>();
  for (const r of receipts ?? []) {
    if (!r.income_account_id) continue;
    incomeTotals.set(r.income_account_id, (incomeTotals.get(r.income_account_id) ?? 0) + toCents(String(r.amount)));
  }
  const incomeWithActivity = (incomeAccounts ?? [])
    .filter((a) => incomeTotals.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      isExempt: a.is_exempt_function_income === true,
      confirmedAt: a.tax_classification_confirmed_at,
      totalCents: incomeTotals.get(a.id) ?? 0,
    }));

  const contractors = (contractorRows ?? []).map((c) => ({
    vendorId: c.vendor_id,
    name: c.name,
    address: c.address,
    totalCents: toCents(String(c.total_paid)),
    paymentCount: c.payment_count,
    w9OnFile: c.w9_on_file,
    expenseIds: (c.expense_ids ?? []) as string[],
  }));

  const templateRules: TemplateRule[] = (templates ?? []).map((t) => ({
    formCode: t.form_code,
    taxYear: t.tax_year,
    dueRule: t.due_rule,
    dueRuleCitation: t.due_rule_citation,
    notes: t.notes,
    verified: t.verified_at !== null,
  }));

  const input: DetermineInput = {
    association: { stateCode: association.state_code, incorporatedOn: association.incorporated_on, ein: association.ein },
    fiscalYear: { label: fy.label, endsOn: fy.ends_on, taxYear },
    contractorYear,
    figures: {
      exemptIncomeCents: f ? toCents(String(f.exempt_income)) : 0,
      grossIncomeCents: f ? toCents(String(f.gross_income)) : 0,
      exemptExpendituresCents: f ? toCents(String(f.exempt_expenditures)) : 0,
      totalExpendituresCents: f ? toCents(String(f.total_expenditures)) : 0,
    },
    unconfirmedIncomeAccounts: incomeWithActivity.filter((a) => !a.confirmedAt).map((a) => a.name),
    contractors: contractors.map((c) => ({ vendorId: c.vendorId, name: c.name, totalCents: c.totalCents, w9OnFile: c.w9OnFile })),
    parameters: effective.map((p) => ({
      key: p.key,
      value: Number(p.numeric_value),
      sourceUrl: p.source_url,
      verifiedOn: p.verified_on,
    })),
    templates: templateRules,
    today,
  };

  const tests = run1120hTests(input);
  return {
    association,
    fiscalYear: { ...fy, taxYear },
    contractorYear,
    input,
    forms: determineForms(input),
    incomeAccounts: incomeWithActivity,
    receiptLineIds: {
      exempt: (receipts ?? []).filter((r) => r.is_exempt).map((r) => r.journal_line_id),
      nonexempt: (receipts ?? []).filter((r) => !r.is_exempt).map((r) => r.journal_line_id),
    },
    disbursementLineIds: {
      exempt: (disbursements ?? []).filter((d) => d.is_exempt).map((d) => d.journal_line_id),
      all: (disbursements ?? []).map((d) => d.journal_line_id),
    },
    contractorRows: contractors,
    overridesThisYear: (overrides ?? []).length,
    thresholdsVerified: tests ? tests.every((t) => t.thresholdVerified) : false,
  };
}
