import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { todayIso as localToday } from "@/lib/dates";
import { toCents } from "@/lib/tax/form1120h";
import { filingYearFor, taxDeadlines, type Deadline, type DeadlineForm, type DeadlineTemplate } from "@/lib/tax/deadlines";
import {
  determineForms,
  run1120hTests,
  type DetermineInput,
  type FormOutcome,
  type Parameter,
  type TemplateRule,
} from "@/lib/tax/determine";
import type { LinkRow } from "@/lib/tax/links";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** A fiscal_years row, as the chooser and filingYearFor read it. */
export interface TaxFiscalYear {
  id: string;
  label: string;
  starts_on: string;
  ends_on: string;
}

/** A tax_parameters row, every one of them — for "Where these tax rules come from". */
export interface TaxParameterRow {
  id: string;
  key: string;
  value: number;
  /** The NUMERIC exactly as stored (DECISIONS #20), for computeForm1120h and the worksheet. */
  numericValue: string;
  effectiveFrom: string;
  /** Exclusive: the rule applies while `date < effectiveTo`. Null = still in force. */
  effectiveTo: string | null;
  sourceUrl: string | null;
  /** Null until a platform admin marks it checked. */
  verifiedOn: string | null;
  notes: string | null;
}

/** An active tax_form_templates row (0042 + 0048), PDF or link-only. */
export interface TaxTemplateRow {
  id: string;
  formCode: string;
  taxYear: number;
  /** 'pdf' fills; 'link_only' carries a cited due rule and filing instructions for a form Walkup never fills. */
  kind: "pdf" | "link_only";
  dueRule: string | null;
  dueRuleCitation: string | null;
  filingInstructions: string | null;
  filingCitation: string | null;
  notes: string | null;
  verifiedAt: string | null;
  active: boolean;
  sourceUrl: string;
  instructionsUrl: string | null;
  /** 1-based pages kept in PDF exports; null = every page. */
  includePages: number[] | null;
  /** At export, every filled value whose name contains `from` is also written to the twin with `to`. */
  mirror: { from: string; to: string }[];
  revision: string | null;
  revisionTitle: string | null;
}

/**
 * What was sent to the accountant, frozen at "Mark as sent". The greeting and
 * sign-off lines are replaced before storing, so no person's name lives here
 * outside `persons` (DECISIONS #30); the accountant is referenced by id.
 */
export interface SentSnapshot {
  subject: string;
  body: string;
  attachments: string[];
  accountantPersonId: string | null;
  figures: {
    exemptIncomeCents: number;
    nonexemptIncomeCents: number;
    grossIncomeCents: number;
    exemptExpendituresCents: number;
    totalExpendituresCents: number;
    /** The contractor's total for a 1099-NEC; null on every other form. */
    contractorTotalCents: number | null;
  };
  asOf: { fiscalYearEnd: string; contractorYearEnd: string };
  sentAt: string;
}

/** A tax_forms row the board has started, with the 0048 handoff columns. */
export interface TaxFormRow {
  id: string;
  formCode: string;
  taxYear: number;
  vendorId: string | null;
  fiscalYearId: string | null;
  status: string;
  determination: string;
  dueOn: string | null;
  filedOn: string | null;
  templateId: string | null;
  sentToAccountantAt: string | null;
  sentToAccountantBy: string | null;
  sentSnapshot: SentSnapshot | null;
  /** Lines on the form, and how many still need a person (confirm, enter, or leave blank) — the card's "Needs you: k lines". */
  fields: { total: number; open: number };
}

/** The board's tax accountant: a persons row (DECISIONS #30) plus the firm. */
export interface Accountant {
  personId: string;
  fullName: string;
  /** The first word of the name, for "Hi Jane," — null when the name is empty. */
  firstName: string | null;
  email: string | null;
  firm: string | null;
}

export interface FilingSettings {
  /** How the board files 1099s with the IRS; null = not yet answered (Form 1096 reads ask_cpa). */
  informationReturnsFiling: "paper" | "electronic" | null;
  /** Illinois Secretary of State corporation file number — the annual report portal asks for it. */
  ilSosFileNumber: string | null;
}

/** A person holding an active board grant today — "Send the dates to the board" writes to these. */
export interface BoardMember {
  personId: string;
  fullName: string;
  email: string | null;
  authUserId: string | null;
  role: "board_admin" | "board_member";
}

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
    fiscal_year_end_month: number;
  };
  /** The filing year (filingYearFor, or the `?fy=` / form's own year the caller asked for). */
  fiscalYear: { id: string; label: string; starts_on: string; ends_on: string; taxYear: number };
  /** Every fiscal year on file, newest first — for the chooser. */
  fiscalYears: TaxFiscalYear[];
  /** Today as a local ISO date, computed once so every date comparison in a render agrees. */
  todayIso: string;
  contractorYear: number;
  /** The dates the parameters were resolved as of: 1120-H keys at the fiscal year end, 1099 keys at Dec 31 of the payment year. */
  asOf: { fiscalYearEnd: string; contractorYearEnd: string };
  input: DetermineInput;
  forms: FormOutcome[];
  /** Every open deadline for the filing year, soonest first (lib/tax/deadlines). */
  deadlines: Deadline[];
  /** Active templates, PDF and link-only. */
  templates: TaxTemplateRow[];
  /** Active rows of the official-links registry; filter per form with linksFor(). */
  links: LinkRow[];
  startedForms: TaxFormRow[];
  locked1120hFiscalYearIds: string[];
  accountant: Accountant | null;
  settings: FilingSettings;
  boardMembers: BoardMember[];
  /** Every tax_parameters row, past and future, for "Where these tax rules come from". The resolved ones are input.parameters. */
  parametersAll: TaxParameterRow[];
  /** Income accounts with activity this fiscal year, and whether a board member has confirmed their classification. */
  incomeAccounts: { id: string; name: string; isExempt: boolean; confirmedAt: string | null; totalCents: number }[];
  /** Cash receipts that aren't owner fees, by account, largest first — honours per-line reclassifications. */
  nonexemptByAccount: { name: string; cents: number }[];
  receiptLineIds: { exempt: string[]; nonexempt: string[] };
  disbursementLineIds: { exempt: string[]; all: string[] };
  contractorRows: {
    vendorId: string;
    name: string;
    address: string | null;
    /** For the "Ask for a W-9" draft; never printed on a form. */
    email: string | null;
    totalCents: number;
    paymentCount: number;
    w9OnFile: boolean;
    expenseIds: string[];
  }[];
  /** Per-line overrides entered this fiscal year (a manual edit to the classified set). */
  overridesThisYear: number;
  thresholdsVerified: boolean;
}

export interface LoadTaxContextOptions {
  /** Load this fiscal year instead of the filing year — a `?fy=` choice, or a form's own year. */
  fiscalYearId?: string;
  /** The payment year for 1099s; defaults to the Jan/Feb rule below. */
  contractorYear?: number;
  today?: Date;
}

/** Forms keyed by the calendar year of payment rather than by a fiscal year. */
export function isInformationReturn(formCode: string): boolean {
  return formCode === "irs_1099_nec" || formCode === "irs_1096";
}

/** Parameter keys resolved as of the payment year (Dec 31) rather than the fiscal year end. */
const isPaymentYearKey = (key: string) => key.startsWith("form_1099");

/**
 * The rows in force on a date: `effective_from <= date < effective_to`. The
 * half-open end matches the exclusion constraint in 0001 and
 * compute_and_save_tax_filing() in 0048 — on 2026-01-01 exactly, the $600
 * 1099 row (ending that day) is out and the $2,000 row (starting that day)
 * is in, never both.
 */
export function parametersAsOf<T extends { effectiveFrom: string; effectiveTo: string | null }>(rows: T[], dateIso: string): T[] {
  return rows.filter((p) => p.effectiveFrom <= dateIso && (p.effectiveTo === null || p.effectiveTo > dateIso));
}

/** The 1120-H rules as of the fiscal year end; the 1099 threshold as of Dec 31 of the payment year. */
export function resolveParameters(rows: TaxParameterRow[], asOf: { fiscalYearEnd: string; contractorYearEnd: string }): Parameter[] {
  const forReturn = parametersAsOf(rows, asOf.fiscalYearEnd).filter((p) => !isPaymentYearKey(p.key));
  const forPayments = parametersAsOf(rows, asOf.contractorYearEnd).filter((p) => isPaymentYearKey(p.key));
  return [...forReturn, ...forPayments].map((p) => ({ key: p.key, value: p.value, sourceUrl: p.sourceUrl, verifiedOn: p.verifiedOn }));
}

/** 1099s are prepared in January and February for the year just ended; the rest of the year looks at the current one. */
export function defaultContractorYear(todayIso: string): number {
  const year = Number(todayIso.slice(0, 4));
  return Number(todayIso.slice(5, 7)) <= 2 ? year - 1 : year;
}

/** A tax_form_fields row still waiting on a person — the per-line rule behind isReadyToSign (lib/tax/autofill). */
function isOpenLine(f: { source?: string | null; value: string | null; confirmed_at: string | null; leave_blank: boolean; proposed_value: string | null }): boolean {
  // Calculated lines follow their operands and never wait on a person.
  if (f.source === "calculated") return false;
  if (f.proposed_value !== null) return true;
  if (f.value !== null && f.value !== "") return f.confirmed_at === null;
  return !f.leave_blank;
}

const firstWord = (name: string): string | null => name.trim().split(/\s+/)[0] || null;

/**
 * Everything the Taxes tab, form pages, exports and email drafts need, in one
 * place so they can't disagree. The fiscal year is the one whose return is
 * next to file (filingYearFor) unless the caller names one — the tab's
 * `?fy=` choice, or a form's own year when it is filled. 1099s look at the
 * calendar year just ended in January and February (when they're prepared),
 * and at the current year otherwise, unless the caller names that too.
 */
export async function loadTaxContext(supabase: Supabase, opts: LoadTaxContextOptions = {}): Promise<TaxContext | null> {
  const today = opts.today ?? new Date();
  const todayIso = localToday(today);

  const [{ data: associations }, { data: fiscalYearRows }, { data: formRows }, { data: lockedRows }, { data: taxIdRows }] = await Promise.all([
    supabase
      .from("associations")
      .select(
        "id, legal_name, display_name, state_code, incorporated_on, street_address, city, postal_code, fiscal_year_end_month, accountant_person_id, accountant_firm, il_sos_file_number, information_returns_filing",
      )
      .limit(1),
    supabase.from("fiscal_years").select("id, label, starts_on, ends_on").order("starts_on", { ascending: false }),
    supabase
      .from("tax_forms")
      .select(
        "id, form_code, tax_year, vendor_id, fiscal_year_id, status, determination, due_on, filed_on, template_id, sent_to_accountant_at, sent_to_accountant_by, sent_snapshot_json",
      )
      .order("tax_year", { ascending: false }),
    supabase.from("tax_filings").select("fiscal_year_id").eq("form", "1120-H").not("locked_at", "is", null),
    supabase.from("association_tax_ids").select("ein").limit(1),
  ]);
  const association = associations?.[0];
  const ein = (taxIdRows?.[0]?.ein as string | null | undefined) ?? null;
  const fiscalYears: TaxFiscalYear[] = (fiscalYearRows ?? []).map((f) => ({
    id: f.id,
    label: f.label,
    starts_on: f.starts_on,
    ends_on: f.ends_on,
  }));
  const locked1120hFiscalYearIds = (lockedRows ?? []).map((r) => r.fiscal_year_id as string);
  const deadlineForms: DeadlineForm[] = (formRows ?? []).map((f) => ({
    id: f.id,
    formCode: f.form_code,
    taxYear: f.tax_year,
    vendorId: f.vendor_id ?? null,
    status: f.status,
    filedOn: f.filed_on ?? null,
    sentToAccountantAt: f.sent_to_accountant_at ?? null,
  }));
  const fy =
    (opts.fiscalYearId ? fiscalYears.find((f) => f.id === opts.fiscalYearId) : undefined) ??
    filingYearFor(fiscalYears, deadlineForms, locked1120hFiscalYearIds, todayIso);
  if (!association || !fy) return null;

  const contractorYear = opts.contractorYear ?? defaultContractorYear(todayIso);
  const taxYear = Number(fy.ends_on.slice(0, 4));
  const asOf = { fiscalYearEnd: fy.ends_on, contractorYearEnd: `${contractorYear}-12-31` };

  const [
    { data: figuresRows },
    { data: paramRows },
    { data: receipts },
    { data: disbursements },
    { data: incomeAccounts },
    { data: contractorRows },
    { data: templateRows },
    { data: overrides },
    { data: linkRows },
    { data: accountantRows },
    { data: grantRows },
    { data: fieldRows },
  ] = await Promise.all([
    supabase.rpc("form_1120h_figures", { p_association_id: association.id, p_fiscal_year_id: fy.id }),
    supabase
      .from("tax_parameters")
      .select("id, key, numeric_value, source_url, verified_on, effective_from, effective_to, notes")
      .order("key")
      .order("effective_from"),
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
      .select("vendor_id, name, address, email, total_paid, payment_count, w9_on_file, expense_ids")
      .eq("calendar_year", contractorYear)
      .order("total_paid", { ascending: false }),
    supabase
      .from("tax_form_templates")
      .select(
        "id, form_code, tax_year, kind, due_rule, due_rule_citation, filing_instructions, filing_citation, notes, verified_at, active, source_url, instructions_url, include_pages, mirror_json, revision, revision_title",
      )
      .eq("active", true),
    supabase
      .from("tax_line_classifications")
      .select("id, updated_at")
      .gte("updated_at", `${today.getFullYear()}-01-01`),
    supabase
      .from("tax_form_links")
      .select("id, form_code, kind, label, url, state_code, retrieved_on, verified_at, last_checked_at, last_check_status, active, sort_order")
      .eq("active", true)
      .order("sort_order"),
    association.accountant_person_id
      ? supabase.from("persons").select("id, full_name, email").eq("id", association.accountant_person_id).limit(1)
      : Promise.resolve({ data: null }),
    supabase
      .from("role_grants")
      .select("role, expires_on, persons(id, full_name, email, auth_user_id)")
      .in("role", ["board_admin", "board_member"])
      .is("revoked_at", null),
    supabase.from("tax_form_fields").select("tax_form_id, source, value, confirmed_at, leave_blank, proposed_value"),
  ]);

  const f = (Array.isArray(figuresRows) ? figuresRows[0] : figuresRows) as Record<string, string> | undefined;

  const parametersAll: TaxParameterRow[] = (paramRows ?? []).map((p) => ({
    id: p.id,
    key: p.key,
    value: Number(p.numeric_value),
    numericValue: String(p.numeric_value),
    effectiveFrom: p.effective_from,
    effectiveTo: p.effective_to ?? null,
    sourceUrl: p.source_url ?? null,
    verifiedOn: p.verified_on ?? null,
    notes: p.notes ?? null,
  }));

  const incomeTotals = new Map<string, number>();
  const nonexemptTotals = new Map<string, number>();
  for (const r of receipts ?? []) {
    const cents = toCents(String(r.amount));
    if (r.income_account_id) incomeTotals.set(r.income_account_id, (incomeTotals.get(r.income_account_id) ?? 0) + cents);
    if (!r.is_exempt) nonexemptTotals.set(r.income_account_name, (nonexemptTotals.get(r.income_account_name) ?? 0) + cents);
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
  const nonexemptByAccount = [...nonexemptTotals]
    .map(([name, cents]) => ({ name, cents }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));

  const contractors = (contractorRows ?? []).map((c) => ({
    vendorId: c.vendor_id,
    name: c.name,
    address: c.address,
    email: c.email ?? null,
    totalCents: toCents(String(c.total_paid)),
    paymentCount: c.payment_count,
    w9OnFile: c.w9_on_file,
    expenseIds: (c.expense_ids ?? []) as string[],
  }));

  const templates: TaxTemplateRow[] = (templateRows ?? []).map((t) => ({
    id: t.id,
    formCode: t.form_code,
    taxYear: t.tax_year,
    kind: t.kind === "link_only" ? "link_only" : "pdf",
    dueRule: t.due_rule ?? null,
    dueRuleCitation: t.due_rule_citation ?? null,
    filingInstructions: t.filing_instructions ?? null,
    filingCitation: t.filing_citation ?? null,
    notes: t.notes ?? null,
    verifiedAt: t.verified_at ?? null,
    active: t.active === true,
    sourceUrl: t.source_url,
    instructionsUrl: t.instructions_url ?? null,
    includePages: Array.isArray(t.include_pages) ? (t.include_pages as unknown[]).map(Number) : null,
    mirror: Array.isArray(t.mirror_json)
      ? (t.mirror_json as unknown[]).flatMap((m) => {
          const pair = m as { from?: unknown; to?: unknown };
          return typeof pair?.from === "string" && typeof pair?.to === "string" ? [{ from: pair.from, to: pair.to }] : [];
        })
      : [],
    revision: t.revision ?? null,
    revisionTitle: t.revision_title ?? null,
  }));
  const templateRules: TemplateRule[] = templates.map((t) => ({
    formCode: t.formCode,
    taxYear: t.taxYear,
    dueRule: t.dueRule,
    dueRuleCitation: t.dueRuleCitation,
    notes: t.notes,
    verified: t.verifiedAt !== null,
  }));
  const deadlineTemplates: DeadlineTemplate[] = templateRules.map((t, i) => ({ ...t, active: templates[i].active }));

  const links: LinkRow[] = (linkRows ?? []).map((l) => ({
    id: l.id,
    form_code: l.form_code,
    kind: l.kind,
    label: l.label,
    url: l.url,
    state_code: l.state_code ?? null,
    retrieved_on: l.retrieved_on,
    verified_at: l.verified_at ?? null,
    last_checked_at: l.last_checked_at ?? null,
    last_check_status: l.last_check_status ?? null,
    active: l.active === true,
    sort_order: Number(l.sort_order),
  }));

  const openByForm = new Map<string, { total: number; open: number }>();
  for (const row of fieldRows ?? []) {
    const counts = openByForm.get(row.tax_form_id) ?? { total: 0, open: 0 };
    counts.total += 1;
    if (isOpenLine(row)) counts.open += 1;
    openByForm.set(row.tax_form_id, counts);
  }
  const startedForms: TaxFormRow[] = (formRows ?? []).map((r) => ({
    id: r.id,
    formCode: r.form_code,
    taxYear: r.tax_year,
    vendorId: r.vendor_id ?? null,
    fiscalYearId: r.fiscal_year_id ?? null,
    status: r.status,
    determination: r.determination,
    dueOn: r.due_on ?? null,
    filedOn: r.filed_on ?? null,
    templateId: r.template_id ?? null,
    sentToAccountantAt: r.sent_to_accountant_at ?? null,
    sentToAccountantBy: r.sent_to_accountant_by ?? null,
    sentSnapshot: (r.sent_snapshot_json as SentSnapshot | null) ?? null,
    fields: openByForm.get(r.id) ?? { total: 0, open: 0 },
  }));

  const accountantRow = accountantRows?.[0];
  const accountant: Accountant | null = accountantRow
    ? {
        personId: accountantRow.id,
        fullName: accountantRow.full_name,
        firstName: firstWord(accountantRow.full_name),
        email: accountantRow.email ?? null,
        firm: association.accountant_firm ?? null,
      }
    : null;
  const settings: FilingSettings = {
    informationReturnsFiling:
      association.information_returns_filing === "paper" || association.information_returns_filing === "electronic"
        ? association.information_returns_filing
        : null,
    ilSosFileNumber: association.il_sos_file_number ?? null,
  };

  // One row per person: someone holding both board roles reads as board_admin.
  const boardByPerson = new Map<string, BoardMember>();
  for (const g of grantRows ?? []) {
    if (g.expires_on && g.expires_on < todayIso) continue;
    // A to-one embed arrives as one object; supabase-js's select parser types it as a list.
    const p = g.persons as unknown as { id: string; full_name: string; email: string | null; auth_user_id: string | null } | null;
    if (!p) continue;
    const role: BoardMember["role"] = g.role === "board_admin" ? "board_admin" : "board_member";
    const prev = boardByPerson.get(p.id);
    if (prev && prev.role === "board_admin") continue;
    boardByPerson.set(p.id, { personId: p.id, fullName: p.full_name, email: p.email ?? null, authUserId: p.auth_user_id ?? null, role });
  }
  const boardMembers = [...boardByPerson.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));

  const input: DetermineInput = {
    association: {
      stateCode: association.state_code,
      incorporatedOn: association.incorporated_on,
      ein,
      informationReturnsFiling: settings.informationReturnsFiling,
    },
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
    parameters: resolveParameters(parametersAll, asOf),
    templates: templateRules,
    today,
  };

  // Form 1096 is not shown (DECISIONS #53): Walkup never files with the IRS, and how 1099s are filed is the CPA's call.
  const forms = determineForms(input).filter((o) => o.formCode !== "irs_1096");
  const deadlines = taxDeadlines({
    today: todayIso,
    association: {
      stateCode: association.state_code,
      fiscalYearEndMonth: association.fiscal_year_end_month ?? null,
      incorporatedOn: association.incorporated_on,
      informationReturnsFiling: settings.informationReturnsFiling,
    },
    fiscalYear: { id: fy.id, label: fy.label, startsOn: fy.starts_on, endsOn: fy.ends_on, taxYear },
    contractorYear,
    templates: deadlineTemplates,
    forms: deadlineForms,
    locked1120hFiscalYearIds,
    outcomes: forms.map((o) => ({ formCode: o.formCode, taxYear: o.taxYear, vendorId: o.vendorId, determination: o.determination, name: o.name })),
    accountantSet: accountant !== null,
  });

  const tests = run1120hTests(input);
  return {
    association: {
      id: association.id,
      legal_name: association.legal_name,
      display_name: association.display_name,
      ein,
      state_code: association.state_code,
      incorporated_on: association.incorporated_on,
      street_address: association.street_address,
      city: association.city,
      postal_code: association.postal_code,
      fiscal_year_end_month: Number(association.fiscal_year_end_month ?? 12),
    },
    fiscalYear: { ...fy, taxYear },
    fiscalYears,
    todayIso,
    contractorYear,
    asOf,
    input,
    forms,
    deadlines,
    templates,
    links,
    startedForms,
    locked1120hFiscalYearIds,
    accountant,
    settings,
    boardMembers,
    parametersAll,
    incomeAccounts: incomeWithActivity,
    nonexemptByAccount,
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
