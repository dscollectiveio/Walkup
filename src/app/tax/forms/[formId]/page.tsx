import Link from "next/link";
import { createClient, getUser } from "@/lib/supabase/server";
import { Restricted } from "@/components/ui";
import type { FieldMap } from "@/lib/tax/autofill";
import { accountantEmail, mailtoHref, type AccountantEmailInput } from "@/lib/tax/accountant-email";
import { dateWords, ESTIMATED_NOTE, TAX_FOOTER } from "@/lib/tax/copy";
import type { Deadline } from "@/lib/tax/deadlines";
import { FORM_LABEL, FORM_PLAIN, run1120hTests, type FormCode } from "@/lib/tax/determine";
import { figuresPack } from "@/lib/tax/figures";
import { computeForm1120h, formatMoney, fromCents } from "@/lib/tax/form1120h";
import { LINK_KIND_LABEL, linksFor, linkStatusWords, type LinkKind, type LinkView } from "@/lib/tax/links";
import { isInformationReturn, loadTaxContext, type SentSnapshot, type TaxContext } from "../../data";
import { FieldRow, type FieldView } from "./field-row";
import { MarkFiled, RefreshButton } from "./form-controls";
import { SendPanel } from "./send-panel";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  draft: "Draft",
  in_review: "In review",
  ready_to_sign: "Ready to sign",
  filed: "Filed",
};

/** The board's five steps, in order; the strip shows which one the form is on. */
const STEPS = ["Check the figures", "Send to your accountant", "Confirm each line", "Export to sign", "Mark as filed"];

const primary = "inline-flex min-h-[44px] items-center rounded-md bg-ink px-4 text-[13px] font-medium text-paper hover:bg-ink-mid";
const secondary = "inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill";

/** A tax_forms row, as much of it as this page reads. */
interface FormRow {
  id: string;
  association_id: string;
  form_code: string;
  tax_year: number;
  vendor_id: string | null;
  fiscal_year_id: string | null;
  determination: string;
  determination_reason: string;
  status: string;
  due_on: string | null;
  filed_on: string | null;
  template_id: string | null;
  sent_to_accountant_at: string | null;
  sent_snapshot_json: SentSnapshot | null;
}

type View = FieldView & { section: string; mapIndex: number };

/**
 * The export filenames, exactly as export/route.ts names the downloads. The
 * email draft tells the accountant which files are attached, so the page and
 * the route must spell them the same way — change both together.
 */
function packetNames(label: string, taxYear: number, vendorName: string | null) {
  const base = `${label} ${taxYear}${vendorName ? ` ${vendorName}` : ""}`.replace(/[/\\?%*:|"<>]/g, "-");
  return { signable: `${base} to sign.pdf`, editable: `${base} editable.pdf`, worksheet: `${base} worksheet.xlsx` };
}

/** A calculated line's formula with the field names replaced by the printed lines they are ("add(line 1, line 2, …)"). */
function formulaWords(formula: string, lineByName: Map<string, string>): string {
  let out = formula;
  for (const [name, line] of [...lineByName].sort((a, b) => b[0].length - a[0].length)) out = out.split(name).join(line);
  return out
    .replace(/param:([a-z0-9_]+)/g, (_, key: string) => `${key.replace(/^form_1120h_/, "").replace(/_/g, " ")} (tax_parameters)`)
    .replace(/topmostSubform\[0\]\.[A-Za-z0-9]+\[0\]\./g, "")
    .replace(/,/g, ", ");
}

/** Where a filled line came from, in plain words, with somewhere to look. */
function sourceLine(source: string, ref: Record<string, unknown>, lineByName: Map<string, string>): { line: string; href: string | null } {
  switch (source) {
    case "setting":
      return { line: `From your settings (${String(ref.setting ?? "").replace(/^association\.|^fiscal_year\.|^form\./, "").replace(/_/g, " ")})`, href: "/building" };
    case "ledger": {
      const n = Number(ref.count ?? 0);
      return { line: `From your ledger: ${n} transaction${n === 1 ? "" : "s"} (${String(ref.aggregate ?? "").replace(/_/g, " ")})`, href: "/tax#income" };
    }
    case "contractors": {
      const n = Array.isArray(ref.expense_ids) ? (ref.expense_ids as unknown[]).length : null;
      return { line: `From contractor payments${n !== null ? `: ${n} payment${n === 1 ? "" : "s"}` : ""}`, href: "/repairs?view=contractors" };
    }
    case "calculated":
      return { line: `Calculated: ${formulaWords(String(ref.formula ?? ""), lineByName)}`, href: null };
    default:
      return { line: "Entered by hand", href: null };
  }
}

/** Sections are named with a numeric prefix ("3. Gross income (lines 1–8)") so they read in form order, not alphabetical. */
function sectionRank(section: string): number {
  const m = /^(\d+)\./.exec(section);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/** A line still waiting on a person: a decision, a confirmation, or an entry. Calculated lines follow their operands and never wait. */
function needsYou(v: FieldView): boolean {
  if (v.source === "calculated") return false;
  if (v.proposedValue !== null) return true;
  const blank = v.value === null || v.value === "";
  return blank ? !v.leaveBlank : !v.confirmed;
}

/** Decide first, then enter, then the rest — and within each, the form's own line order. */
function tier(v: FieldView): number {
  if (v.source === "calculated") return 2;
  if (v.proposedValue !== null || (v.value !== null && v.value !== "" && !v.confirmed)) return 0;
  return (v.value === null || v.value === "") && !v.leaveBlank ? 1 : 2;
}

/**
 * Form 1120-H lines 1–7: the income that isn't owner fees, typed by the board
 * (line 8 adds them up). Found by the printed line in the label, the way the
 * map writes it, so a later year's field names don't matter.
 */
const isIncomeLine = (formCode: string, v: FieldView) => formCode === "irs_1120h" && v.source === "manual" && /^Line [1-7]\b/.test(v.label);

/** "1,250.00", "$1,250" and "1250" all read as 125000 cents; a blank or anything else is null. */
function amountCents(value: string | null): number | null {
  if (value === null) return null;
  const s = value.replace(/[$,\s]/g, "");
  const n = Number(s);
  return s === "" || !Number.isFinite(n) ? null : Math.round(n * 100);
}

/** Which of the five steps the form is on — the next thing to do, as the strip reads it. */
function currentStep(status: string, sentAt: string | null, hasPdf: boolean, accountantSet: boolean): number {
  if (status === "filed") return 4;
  if (status === "ready_to_sign") return 3;
  // Sent: with lines to confirm, that's next; with nothing to confirm in Walkup, marking it filed is.
  // No accountant on file means nothing to send: confirming the lines is the work.
  if (sentAt || !accountantSet) return hasPdf ? 2 : 4;
  return 0;
}

/**
 * The due line, live from the one list every reminder reads (lib/tax/deadlines)
 * — a verified rule with its citation, an estimate that says so, or "ask your
 * CPA". A form that has dropped off that list (filed, or its date long past)
 * falls back to what was recorded when it was started, labeled as such.
 */
function dueWords(deadline: Deadline | undefined, form: Pick<FormRow, "status" | "filed_on" | "due_on">): { text: string; note: string | null; cls: string } {
  if (form.status === "filed") {
    return { text: form.filed_on ? `Filed on ${dateWords(form.filed_on)}.` : "Filed.", note: null, cls: "text-good-text" };
  }
  if (deadline?.dueOn) {
    const when = dateWords(deadline.dueOn);
    const days = deadline.daysLeft !== null && deadline.daysLeft >= 0 ? ` — ${deadline.daysLeft} day${deadline.daysLeft === 1 ? "" : "s"}` : "";
    const cite = deadline.citation ? ` (${deadline.citation})` : "";
    if (deadline.basis === "verified") {
      return deadline.overdue
        ? { text: `Overdue — was due ${when}${cite}.`, note: deadline.note, cls: "text-bad-text" }
        : { text: `Due ${when}${days}${cite}.`, note: deadline.note, cls: "text-ink" };
    }
    return deadline.overdue
      ? { text: `May be overdue — estimated ${when}. ${ESTIMATED_NOTE}`, note: null, cls: "text-warning-text" }
      : { text: `Estimated ${when}${days}. ${ESTIMATED_NOTE}`, note: null, cls: "text-ink" };
  }
  if (deadline) return { text: "Due date not on file — ask your CPA.", note: deadline.note, cls: "text-mute" };
  if (form.due_on) {
    return {
      text: `Due ${dateWords(form.due_on)} — recorded when this form was started; check it against this year’s instructions or ask your CPA.`,
      note: null,
      cls: "text-mute",
    };
  }
  return { text: "Due date not on file — ask your CPA.", note: null, cls: "text-mute" };
}

/**
 * The official links for this form: the registry rows for the building's
 * state, with a verified PDF template's own form and instructions links in
 * place of the registry's for those two kinds (§5.4 — a person checked the
 * template, so its links outrank a retrieved row). Read in registry order.
 */
function officialLinks(ctx: TaxContext, formCode: FormCode, taxYear: number): LinkView[] {
  const registry = linksFor(ctx.links, formCode, ctx.association.state_code, ctx.todayIso);
  const t = ctx.templates.find((x) => x.formCode === formCode && x.taxYear === taxYear && x.kind === "pdf" && x.verifiedAt !== null);
  if (!t) return registry;
  const on = (t.verifiedAt as string).slice(0, 10);
  const view = (kind: LinkKind, url: string, label: string): LinkView => ({ id: `template-${t.id}-${kind}`, kind, label, url, checked: "verified", checkedOn: on, retrievedOn: on });
  const fromTemplate = [
    view("form", t.sourceUrl, `${FORM_LABEL[formCode]} (PDF, ${t.revision ?? taxYear})`),
    ...(t.instructionsUrl ? [view("instructions", t.instructionsUrl, `Instructions for ${FORM_LABEL[formCode]}`)] : []),
  ];
  const covered = new Set(fromTemplate.map((v) => v.kind));
  // LINK_KIND_LABEL's keys are in the registry's reading order (about, form, instructions, …).
  const kinds = Object.keys(LINK_KIND_LABEL);
  const rank = (kind: string) => (kinds.includes(kind) ? kinds.indexOf(kind) : kinds.length);
  return [...fromTemplate, ...registry.filter((v) => !covered.has(v.kind as LinkKind))].sort((a, b) => rank(a.kind) - rank(b.kind));
}

/** "Official form ↗ · Instructions ↗ — checked Oct 11, 2026", or each link with its own words when they differ. */
function LinksLine({ links }: { links: LinkView[] }) {
  if (links.length === 0) return <p className="mt-1 text-[12px] text-mute">Walkup has no links on file for this form yet.</p>;
  const words = links.map(linkStatusWords);
  const uniform = words.every((w) => w === words[0]);
  return (
    <p className="mt-1 text-[12px] text-mute">
      {links.map((l, i) => (
        <span key={l.id}>
          {i > 0 ? " · " : ""}
          <a href={l.url} target="_blank" rel="noreferrer" title={l.label} className="text-ink underline underline-offset-2">
            {LINK_KIND_LABEL[l.kind as LinkKind] ?? l.label} ↗
          </a>
          {uniform ? "" : ` (${words[i]})`}
        </span>
      ))}
      {uniform ? ` — ${words[0]}` : ""}
    </p>
  );
}

/**
 * The draft for this form, from the same context the page shows: the 1120-H
 * figures for a return, the contractor list for a 1099/1096. Pure on its
 * inputs (lib/tax/accountant-email); the body names the files from step 1.
 */
function draftFor(
  ctx: TaxContext,
  form: FormRow,
  opts: { deadline: Deadline | undefined; attachments: string[]; senderName: string; openItems: string[] },
): { subject: string; body: string; href: string } {
  const f = ctx.input.figures;
  const tests = run1120hTests(ctx.input);
  const income = tests?.find((t) => t.key === "income");
  const expenditure = tests?.find((t) => t.key === "expenditure");
  const param = (key: string) => ctx.input.parameters.find((p) => p.key === key) ?? null;
  const rate = param("form_1120h_rate_condo");
  const deduction = param("form_1120h_specific_deduction");
  const threshold = param("form_1099_nec_threshold");

  // The same arithmetic as the tab (lib/tax/form1120h); it refuses to run without a sourced rate or deduction.
  let estimatedTaxCents: number | null = null;
  try {
    estimatedTaxCents = computeForm1120h(
      {
        exemptIncome: fromCents(f.exemptIncomeCents),
        nonexemptIncome: fromCents(f.grossIncomeCents - f.exemptIncomeCents),
        grossIncome: fromCents(f.grossIncomeCents),
        exemptExpenditures: fromCents(f.exemptExpendituresCents),
        totalExpenditures: fromCents(f.totalExpendituresCents),
      },
      ctx.input.parameters.map((p) => ({ key: p.key, numericValue: String(p.value), sourceUrl: p.sourceUrl, verifiedOn: p.verifiedOn, notes: null })),
    ).taxDueCents;
  } catch {
    estimatedTaxCents = null;
  }

  const { deadline } = opts;
  const input: AccountantEmailInput = {
    variant: isInformationReturn(form.form_code) ? "1099" : "1120h",
    association: { legalName: ctx.association.legal_name, displayName: ctx.association.display_name },
    accountant: ctx.accountant ? { firstName: ctx.accountant.firstName, email: ctx.accountant.email } : null,
    fiscalYear: { label: ctx.fiscalYear.label, startsOn: ctx.fiscalYear.starts_on, endsOn: ctx.fiscalYear.ends_on },
    taxYear: form.tax_year,
    figures: {
      exemptIncomeCents: f.exemptIncomeCents,
      nonexemptIncomeCents: f.grossIncomeCents - f.exemptIncomeCents,
      grossIncomeCents: f.grossIncomeCents,
      exemptExpendituresCents: f.exemptExpendituresCents,
      totalExpendituresCents: f.totalExpendituresCents,
      nonexemptByAccount: ctx.nonexemptByAccount,
    },
    tests:
      income && expenditure
        ? {
            income: { ratio: income.ratio, threshold: income.threshold, passed: income.passed, verified: income.thresholdVerified },
            expenditure: { ratio: expenditure.ratio, threshold: expenditure.threshold, passed: expenditure.passed, verified: expenditure.thresholdVerified },
          }
        : null,
    estimatedTaxCents,
    parametersVerified: Boolean(rate?.verifiedOn && deduction?.verifiedOn),
    parameters: { rateCondo: rate?.value ?? null, specificDeductionCents: deduction ? Math.round(deduction.value * 100) : null },
    // The live date when the form is on the list; else what was recorded at start, which nobody has re-checked.
    due: deadline
      ? { on: deadline.dueOn, basis: deadline.basis, citation: deadline.citation }
      : { on: form.due_on, basis: form.due_on ? "estimated" : "none", citation: null },
    contractors: ctx.contractorRows.map((c) => ({ name: c.name, totalCents: c.totalCents, w9OnFile: c.w9OnFile })),
    threshold: threshold ? { cents: Math.round(threshold.value * 100), verified: threshold.verifiedOn !== null } : null,
    deadlines: ctx.deadlines.map((d) => ({ name: d.name, dueOn: d.dueOn, basis: d.basis })),
    openItems: opts.openItems,
    attachments: opts.attachments,
    senderName: opts.senderName,
  };
  const { subject, body } = accountantEmail(input);
  return { subject, body, href: mailtoHref(ctx.accountant?.email ?? null, subject, body) };
}

export default async function TaxFormPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  const supabase = await createClient();
  const { data: forms } = await supabase
    .from("tax_forms")
    .select(
      "id, association_id, form_code, tax_year, vendor_id, fiscal_year_id, determination, determination_reason, status, due_on, filed_on, template_id, sent_to_accountant_at, sent_snapshot_json, vendors(name)",
    )
    .eq("id", formId)
    .limit(1);
  const row = forms?.[0];
  if (!row) return <Restricted what="this tax form" />;
  const form = row as unknown as FormRow & { vendors: { name: string } | null };

  // The context for the form's own year — the fiscal year it reports, or the
  // payment year for a 1099/1096 — never whichever year the tab is showing.
  const [{ data: fields }, { data: isBoard }, { data: templateRows }, user, loaded] = await Promise.all([
    supabase
      .from("tax_form_fields")
      .select("id, pdf_field_name, label, section, citation, value, source, source_ref_json, confidence, proposed_value, confirmed_at, leave_blank")
      .eq("tax_form_id", formId),
    supabase.rpc("is_board", { assoc: form.association_id }),
    form.template_id
      ? supabase.from("tax_form_templates").select("field_map_json").eq("id", form.template_id).limit(1)
      : Promise.resolve({ data: null }),
    getUser(),
    loadTaxContext(supabase, {
      fiscalYearId: form.fiscal_year_id ?? undefined,
      contractorYear: isInformationReturn(form.form_code) ? form.tax_year : undefined,
    }),
  ]);
  const canEdit = isBoard === true;
  const locked = form.status === "filed";
  const formCode = form.form_code as FormCode;
  const label = FORM_LABEL[formCode] ?? form.form_code;
  const vendorName = form.vendors?.name ?? null;
  const title = `${label} · ${form.tax_year}${vendorName ? ` · ${vendorName}` : ""}`;
  const ctx = loaded && (!form.fiscal_year_id || loaded.fiscalYear.id === form.fiscal_year_id) ? loaded : null;

  // The template's map carries how each line is shown (kind, hint, "Enter 0") and the form's own line order.
  const fieldMap = ((templateRows?.[0]?.field_map_json as FieldMap | null | undefined) ?? {}) as FieldMap;
  const mapOrder = new Map(Object.keys(fieldMap).map((name, i) => [name, i]));
  const lineByName = new Map<string, string>();
  for (const f of fields ?? []) {
    const m = /^Line (\S+)/.exec(f.label);
    if (m) lineByName.set(f.pdf_field_name, `line ${m[1]}`);
  }
  const views: View[] = (fields ?? []).map((f) => {
    const entry = fieldMap[f.pdf_field_name];
    const s = sourceLine(f.source, f.source_ref_json as Record<string, unknown>, lineByName);
    return {
      id: f.id,
      section: f.section ?? "Other",
      mapIndex: mapOrder.get(f.pdf_field_name) ?? Number.MAX_SAFE_INTEGER,
      label: f.label,
      pdfFieldName: f.pdf_field_name,
      citation: f.citation,
      value: f.value,
      source: f.source,
      kind: entry?.kind ?? "text",
      zeroOk: entry?.zeroOk === true,
      hint: entry?.hint ?? null,
      confidence: f.confidence,
      sourceLine: s.line,
      sourceHref: s.href,
      proposedValue: f.proposed_value,
      confirmed: f.confirmed_at !== null,
      leaveBlank: f.leave_blank,
    };
  });
  const sections = [...new Set(views.map((v) => v.section))].sort((a, b) => sectionRank(a) - sectionRank(b) || a.localeCompare(b));
  const openCount = views.filter(needsYou).length;

  if (!ctx) {
    // The fiscal year this form reports isn't on file any more (or none is set up): nothing to fill from, nothing to draft.
    return (
      <div className="space-y-6">
        <div>
          <Link href="/tax" className="text-[13px] text-mute hover:underline">← Taxes</Link>
          <h1 className="mt-2 text-[20px] font-bold tracking-tight text-ink">{title}</h1>
          <p className="mt-1 text-mute">{FORM_PLAIN[formCode] ?? ""}</p>
        </div>
        <div className="rounded-xl border border-line bg-paper px-5 py-4 text-[13px] text-ink">
          Walkup can&rsquo;t find the fiscal year this form belongs to, so it can&rsquo;t show its figures. Check the fiscal years in Building Info,
          or ask your CPA.
        </div>
        <p className="text-[11px] text-mute">{TAX_FOOTER}</p>
      </div>
    );
  }

  const template = ctx.templates.find((t) => t.id === form.template_id) ?? null;
  const hasPdf = template?.kind === "pdf";
  const linkOnly = template?.kind === "link_only";
  const deadlineKey = form.vendor_id ? `${form.form_code}:${form.tax_year}:${form.vendor_id}` : `${form.form_code}:${form.tax_year}`;
  const deadline = ctx.deadlines.find((d) => d.key === deadlineKey);
  const due = dueWords(deadline, form);
  const links = officialLinks(ctx, formCode, form.tax_year);
  const step = currentStep(form.status, form.sent_to_accountant_at, hasPdf, ctx.accountant !== null);
  const names = packetNames(label, form.tax_year, vendorName);
  const exportHref = (kind: "signable" | "editable" | "worksheet") => `/tax/forms/${formId}/export?kind=${kind}`;

  // The official page for a form Walkup can't fill: the form itself when there is one, else where to file, else the "About" page.
  const official =
    links.find((l) => l.kind === "form") ??
    links.find((l) => l.kind === "file_online") ??
    links.find((l) => l.kind === "about") ??
    (template ? { kind: "about", url: template.sourceUrl } : null);
  const officialLabel = official?.kind === "form" ? "Open the official form ↗" : official?.kind === "file_online" ? "File online ↗" : "Open the official page ↗";

  // What the accountant should know is still open — the figures are in the body; these are the gaps.
  const openItems: string[] = [];
  if (!ctx.association.ein?.trim()) openItems.push("The association's EIN isn't in Walkup yet — we'll add it.");
  if (ctx.input.unconfirmedIncomeAccounts.length > 0) openItems.push(`Income still to classify in Walkup: ${ctx.input.unconfirmedIncomeAccounts.join(", ")}.`);
  if (openCount > 0 && !locked) openItems.push(`${openCount} line${openCount === 1 ? "" : "s"} on the form still need${openCount === 1 ? "s" : ""} a figure or a confirmation.`);
  const thresholdCents = Math.round((ctx.input.parameters.find((p) => p.key === "form_1099_nec_threshold")?.value ?? Infinity) * 100);
  const missingW9 = ctx.contractorRows.filter((c) => c.totalCents >= thresholdCents && !c.w9OnFile && (!form.vendor_id || c.vendorId === form.vendor_id));
  if (missingW9.length > 0) openItems.push(`W-9 still outstanding from ${missingW9.map((c) => c.name).join(", ")}.`);

  const attachments = [...(hasPdf ? [names.editable] : []), names.worksheet];
  const senderName = ctx.boardMembers.find((m) => m.authUserId === user?.id)?.fullName ?? "";
  const draft = draftFor(ctx, form, { deadline, attachments, senderName, openItems });
  const snapshot = form.sent_snapshot_json;
  const sent = form.sent_to_accountant_at
    ? {
        at: form.sent_to_accountant_at,
        // The accountant it went to, when that's still who is on file; a later change shouldn't put a new name on an old send.
        toFirstName: snapshot?.accountantPersonId && snapshot.accountantPersonId === ctx.accountant?.personId ? ctx.accountant.firstName : null,
        subject: snapshot?.subject ?? null,
        attachments: snapshot?.attachments ?? [],
      }
    : null;
  const downloads = [
    ...(hasPdf ? [{ label: "Editable PDF for a CPA", href: exportHref("editable"), filename: names.editable }] : []),
    { label: "Figures worksheet (Excel)", href: exportHref("worksheet"), filename: names.worksheet },
  ];
  const figures = hasPdf ? [] : figuresPack(ctx, { formCode: form.form_code, taxYear: form.tax_year, vendorId: form.vendor_id });
  const nonexemptCents = ctx.input.figures.grossIncomeCents - ctx.input.figures.exemptIncomeCents;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/tax" className="text-[13px] text-mute hover:underline">← Taxes</Link>
        <h1 className="mt-2 text-[20px] font-bold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 text-mute">{FORM_PLAIN[formCode] ?? ""}</p>
        <p className="mt-2 text-[13px] text-ink">
          <span className="rounded-full border border-line bg-fill px-2 py-0.5 text-[11px] text-mute">{STATUS_LABEL[form.status] ?? form.status}</span>
          <span className="ml-2">{form.determination_reason}</span>
        </p>
        <p className={`mt-1 text-[12px] ${due.cls}`}>{due.text}</p>
        {due.note ? <p className="mt-0.5 text-[12px] text-mute">{due.note}</p> : null}
        {template?.notes && template.notes !== due.note ? <p className="mt-0.5 text-[12px] text-mute">{template.notes}</p> : null}
        <LinksLine links={links} />
      </div>

      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" aria-label="Where this form is">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span aria-current={i === step ? "step" : undefined} className={i === step ? "font-bold text-ink" : i < step ? "text-mute" : "text-mute-soft"}>
              {s}
            </span>
            {i < STEPS.length - 1 ? <span aria-hidden="true" className="text-mute-soft">→</span> : null}
          </li>
        ))}
      </ol>

      {!hasPdf ? (
        <div className="rounded-xl border border-line bg-paper px-5 py-4 text-[13px]">
          <p className="font-medium text-ink">
            {linkOnly ? `${label} is filed on the official site — Walkup doesn’t fill it.` : `Walkup hasn’t checked the ${form.tax_year} official form yet.`}
          </p>
          <p className="mt-1 text-mute">
            {linkOnly
              ? "You can still download your figures, open the official page, and send both to your accountant."
              : "You can still download your figures, open the official form, and send both to your accountant. Walkup fills the official form only after a person has checked it."}
          </p>
          {template?.filingInstructions ? (
            <p className="mt-2 text-ink">
              {template.filingInstructions}
              {template.filingCitation ? <span className="text-mute"> — {template.filingCitation}</span> : null}
            </p>
          ) : null}
          {form.form_code === "il_sos_annual_report" ? (
            <p className="mt-2 text-mute">
              Illinois SOS file number:{" "}
              {ctx.settings.ilSosFileNumber ? (
                <span className="figures text-ink">{ctx.settings.ilSosFileNumber}</span>
              ) : (
                <>
                  not on file — <a href="/tax#sos-file-number" className="underline underline-offset-2">add it on the Taxes tab</a>; the portal asks for it.
                </>
              )}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={exportHref("worksheet")} className={primary}>
              Download your figures (Excel)
            </a>
            {official ? (
              <a href={official.url} target="_blank" rel="noreferrer" className={secondary}>
                {officialLabel}
              </a>
            ) : null}
            <a href="#send" className={secondary}>
              Send to your accountant
            </a>
            {canEdit && !locked && views.length === 0 ? <MarkFiled formId={formId} label="Mark as filed — filed by hand or by your accountant" /> : null}
            {canEdit && !locked ? <RefreshButton formId={formId} /> : null}
          </div>
          {locked ? <p className="mt-3 text-good-text">Filed on {form.filed_on ? dateWords(form.filed_on) : "a date not recorded"}.</p> : null}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {canEdit && !locked ? <RefreshButton formId={formId} /> : null}
            <a href="#send" className={secondary}>
              Send to your accountant
            </a>
            {form.status === "ready_to_sign" || locked ? (
              <a href={exportHref("signable")} className={primary}>
                {isInformationReturn(form.form_code) ? "Export the contractor’s copies" : "Export to sign"}
              </a>
            ) : null}
            <a href={exportHref("editable")} className={secondary}>
              Editable PDF for a CPA
            </a>
            <a href={exportHref("worksheet")} className={secondary}>
              Figures worksheet (Excel)
            </a>
            {canEdit && form.status === "ready_to_sign" ? <MarkFiled formId={formId} /> : null}
          </div>
          {locked ? <p className="text-[13px] text-good-text">Filed on {form.filed_on ? dateWords(form.filed_on) : "a date not recorded"}. The figures are locked.</p> : null}
          {!locked && openCount > 0 ? (
            <p className="text-[13px] text-ink">
              <span className="font-medium">Needs you: {openCount} line{openCount === 1 ? "" : "s"} to confirm.</span>{" "}
              <span className="text-mute">Confirm each figure, and enter or leave blank anything Walkup couldn&rsquo;t find. The form is ready to sign once nothing is left open.</span>
            </p>
          ) : null}
          {!locked && views.length === 0 ? (
            <p className="text-[13px] text-mute">No lines yet — Refresh from your records fills them from the checked official form.</p>
          ) : null}
        </>
      )}

      {sections.map((section) => {
        const rows = views.filter((v) => v.section === section).sort((a, b) => tier(a) - tier(b) || a.mapIndex - b.mapIndex || a.label.localeCompare(b.label));
        const open = rows.filter(needsYou).length;
        const incomeLines = rows.filter((v) => isIncomeLine(form.form_code, v));
        const settled = incomeLines.length > 0 && incomeLines.every((v) => (v.value !== null && v.value !== "") || v.leaveBlank);
        const enteredCents = incomeLines.reduce((sum, v) => sum + (amountCents(v.value) ?? 0), 0);
        const byAccount = ctx.nonexemptByAccount.map((a) => `${a.name} ${formatMoney(a.cents)}`).join(", ");
        return (
          <section key={section} className="rounded-xl border border-line bg-paper">
            <h2 className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3 font-bold tracking-tight text-ink">
              <span>{section}</span>
              {open > 0 && !locked ? (
                <span className="rounded-full border border-warning-line bg-warning-tint px-2 py-0.5 text-[11px] font-medium text-warning-text">
                  Needs you: {open} line{open === 1 ? "" : "s"}
                </span>
              ) : null}
            </h2>
            {incomeLines.length > 0 ? (
              <div className="border-b border-line px-5 py-3 text-[12px]">
                <p className="text-ink">
                  Your records show {formatMoney(nonexemptCents)} of income that isn&rsquo;t owner fees{byAccount ? `: ${byAccount}` : ""}.{" "}
                  {nonexemptCents === 0 ? "Lines 1–7 can be left blank — a blank money line counts as zero." : "Enter it on the matching lines."}
                </p>
                {settled && enteredCents !== nonexemptCents ? (
                  <p className="mt-1 text-warning-text">
                    Lines 1–7 add up to {formatMoney(enteredCents)}, but your records show {formatMoney(nonexemptCents)}. Check which line the difference belongs on,
                    or ask your CPA.
                  </p>
                ) : null}
              </div>
            ) : null}
            <ul className="divide-y divide-line px-5">
              {rows.map((v) => (
                <FieldRow key={v.id} field={v} canEdit={canEdit} locked={locked} />
              ))}
            </ul>
          </section>
        );
      })}

      {!hasPdf ? (
        <section className="rounded-xl border border-line bg-paper">
          <header className="border-b border-line px-5 py-4">
            <h2 className="eyebrow text-mute">Your figures</h2>
            <p className="mt-1.5 text-[13px] text-mute">
              From your records, for your accountant or the official form — the same rows as the worksheet. Nobody has checked them against this
              year&rsquo;s instructions yet.
            </p>
          </header>
          {figures.map((group) => (
            <div key={group.title} className="border-b border-line px-5 py-3 last:border-b-0">
              <h3 className="text-[13px] font-bold text-ink">{group.title}</h3>
              <dl className="mt-1 divide-y divide-line">
                {group.rows.map((r, i) => (
                  <div key={`${r.label}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-[13px]">
                    <dt className="text-mute">{r.label}</dt>
                    <dd className="figures text-right text-ink">{r.value}</dd>
                    {r.note ? <dd className="w-full text-[11px] text-mute-soft">{r.note}</dd> : null}
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>
      ) : null}

      <SendPanel
        formId={formId}
        canEdit={canEdit}
        locked={locked}
        downloads={downloads}
        draft={{ subject: draft.subject, body: draft.body, href: draft.href, attachments }}
        accountant={ctx.accountant ? { firstName: ctx.accountant.firstName, email: ctx.accountant.email } : null}
        sent={sent}
      />

      <p className="text-[11px] text-mute">{TAX_FOOTER}</p>
    </div>
  );
}
