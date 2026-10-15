import Link from "next/link";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { BoardOnly, viewerIsOwnerOnly } from "@/components/board-only";
import { Answer, Card, Empty, Jargon, Provisional, Restricted, money, moneyRounded } from "@/components/ui";
import {
  computeForm1120h,
  formatMoney,
  formatPercent,
  fromCents,
  type Form1120hResult,
  type TaxParameter,
  type TestResult,
} from "@/lib/tax/form1120h";
import { FilingStatus } from "./filing-status";
import { AccountLineDrilldown, type DrilldownLine } from "./account-line-drilldown";
import { ProvenancePanel, type ProvenanceRow, type ResolvedLine } from "./provenance-panel";
import { loadTaxContext, parametersAsOf, type TaxContext, type TaxParameterRow } from "./data";
import { ClassifyIncomeRow, FormCard, type CardAction, type CardLink, type FormCardView } from "./tax-client";
import { ThisYear, type ThisYearInput } from "./this-year";
import { AccountantCard } from "./accountant-card";
import { FilingMethodChooser, SosFileNumber } from "./filing-settings";
import { startForm } from "./form-actions";
import { FORM_LABEL, FORM_PLAIN, run1120hTests, type FormOutcome } from "@/lib/tax/determine";
import { addDays } from "@/lib/tax/deadlines";
import { accountantEmail, mailtoHref, type AccountantEmailInput } from "@/lib/tax/accountant-email";
import { LINK_KIND_LABEL, linkStatusWords, linksFor, type LinkFormCode, type LinkKind, type LinkView } from "@/lib/tax/links";
import { LINKS_NOT_CHECKED, TAX_FOOTER, dateWords } from "@/lib/tax/copy";

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
          <h3 className="font-bold text-ink">{heading}</h3>
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

// ---- Wording helpers (server side, from the one tax context) ------------------

/** Forms Walkup never fills: filed on a portal or by the CPA, then marked filed here. */
const NEVER_FILLED: ReadonlySet<string> = new Set(["il_sos_annual_report", "il_1120", "irs_1096"]);

/** The key deadlines.ts gives a form, so an outcome finds its date in ctx.deadlines. */
const deadlineKey = (formCode: string, taxYear: number, vendorId: string | null) =>
  vendorId ? `${formCode}:${taxYear}:${vendorId}` : `${formCode}:${taxYear}`;

/** How the registry wants a form's links read: about, form, instructions, file online, … */
const LINK_KIND_ORDER: LinkKind[] = ["about", "form", "instructions", "file_online", "order_paper", "guidance", "law"];

/** Plain names for the stored rules, for "Where these tax rules come from". Falls back to the key. */
const PARAMETER_LABEL: Record<string, string> = {
  form_1120h_rate_condo: "Tax rate on income that isn't owner fees",
  form_1120h_specific_deduction: "Allowance every association gets",
  form_1120h_income_test: "Rule 1 — the share of income that must be owner fees",
  form_1120h_expenditure_test: "Rule 2 — the share of spending that must be on the building",
  form_1099_nec_threshold: "1099-NEC threshold, per contractor per calendar year",
};

/** "30%" for a rate or test, "$600" for a dollar figure. */
function parameterValueWords(p: TaxParameterRow): string {
  if (p.key.includes("_rate") || p.key.includes("_test")) return `${Math.round(p.value * 100)}%`;
  return Number.isInteger(p.value) ? moneyRounded(p.value) : money(p.value);
}

/** "from Jan 1, 2026" / "Jan 1, 2020 through Dec 31, 2025" — effective_to is exclusive, so the last day in force is the day before it. */
function effectiveWords(p: TaxParameterRow): string {
  const from = dateWords(p.effectiveFrom, "short");
  return p.effectiveTo ? `${from} through ${dateWords(addDays(p.effectiveTo, -1), "short")}` : `from ${from}`;
}

/**
 * The active template for a form and year, verified first. The Illinois
 * annual report isn't year-specific, so its newest one applies.
 */
function templateFor(ctx: TaxContext, formCode: string, taxYear: number) {
  const usable = ctx.templates.filter((t) => t.active && t.formCode === formCode);
  const pick = formCode === "il_sos_annual_report" ? [...usable].sort((a, b) => b.taxYear - a.taxYear) : usable.filter((t) => t.taxYear === taxYear);
  return pick.find((t) => t.verifiedAt !== null) ?? pick[0] ?? null;
}

/**
 * The official links for a card: the registry rows for this form and state,
 * with a verified PDF template's own form and instructions links in place of
 * the registry's (the template is pinned to the exact revision a person
 * checked, so it outranks the registry for that form and year).
 */
function linkViewsFor(ctx: TaxContext, formCode: LinkFormCode, taxYear: number): LinkView[] {
  let views = linksFor(ctx.links, formCode, ctx.association.state_code, ctx.todayIso);
  const t = formCode === "irs_w9" ? null : templateFor(ctx, formCode, taxYear);
  if (t && t.kind === "pdf" && t.verifiedAt) {
    const on = t.verifiedAt.slice(0, 10);
    const fromTemplate = (kind: LinkKind, url: string): LinkView => ({
      id: `template-${t.id}-${kind}`,
      kind,
      label: LINK_KIND_LABEL[kind],
      url,
      checked: "verified",
      checkedOn: on,
      retrievedOn: on,
    });
    const own = [fromTemplate("form", t.sourceUrl), ...(t.instructionsUrl ? [fromTemplate("instructions", t.instructionsUrl)] : [])];
    const replaced = new Set(own.map((v) => v.kind));
    views = [...own, ...views.filter((v) => !replaced.has(v.kind))];
  }
  const order = (v: LinkView) => {
    const i = LINK_KIND_ORDER.indexOf(v.kind as LinkKind);
    return i === -1 ? LINK_KIND_ORDER.length : i;
  };
  return views.sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label));
}

/** A link a person has opened and confirmed: verified, or one the robot can't reach (ilsos.gov) that a person has opened. */
const personChecked = (v: LinkView) => v.checkedOn !== null && v.checked !== "stale";

/**
 * The words after a card's links, for the set as a whole. "checked {date}"
 * only when every link has been opened by a person (the oldest such date, so
 * it never overstates); otherwise it says plainly how many haven't been.
 */
function linksWords(views: LinkView[]): string | null {
  if (views.length === 0) return null;
  const unchecked = views.filter((v) => !personChecked(v));
  if (unchecked.length === 0) {
    const oldest = views.map((v) => v.checkedOn as string).sort()[0];
    return `checked ${dateWords(oldest, "short")}`;
  }
  if (unchecked.every((v) => v.checked === "stale")) return "last checked over a year ago";
  if (unchecked.length === views.length) {
    const retrieved = views.map((v) => v.retrievedOn).sort().reverse()[0];
    return `retrieved ${dateWords(retrieved, "short")} · ${LINKS_NOT_CHECKED}`;
  }
  return `${unchecked.length} of ${views.length} ${LINKS_NOT_CHECKED}`;
}

const toCardLink = (v: LinkView): CardLink => ({
  label: LINK_KIND_LABEL[v.kind as LinkKind] ?? v.label,
  href: v.url,
  words: linkStatusWords(v),
});

/** Everything one form card says, worded here so the cards, the deadlines and the form page agree. */
function cardViewFor(ctx: TaxContext, o: FormOutcome, canWrite: boolean): FormCardView {
  const vendorId = o.vendorId ?? null;
  const key = deadlineKey(o.formCode, o.taxYear, vendorId);
  const deadline = ctx.deadlines.find((d) => d.key === key) ?? null;
  const started = ctx.startedForms.find((f) => f.formCode === o.formCode && f.taxYear === o.taxYear && f.vendorId === vendorId) ?? null;
  const template = templateFor(ctx, o.formCode, o.taxYear);
  const pdfBacked = (started?.fields.total ?? 0) > 0 || template?.kind === "pdf";
  const neverFilled = NEVER_FILLED.has(o.formCode) || template?.kind === "link_only";
  const notRequired = o.determination === "not_required";
  const filed = started?.status === "filed";
  // Figures frozen by an earlier filing record with no form behind it: the date
  // list drops it, so say so instead of "Not started".
  const lockedYear = o.formCode === "irs_1120h" && !filed && ctx.locked1120hFiscalYearIds.includes(ctx.fiscalYear.id);
  const formHref = started ? `/tax/forms/${started.id}` : null;

  // The due line: the one list every reminder reads (a checked rule, else the
  // labeled estimate), falling back to the outcome's own verified date for a
  // form the list no longer carries (rolled to a later year).
  let due: FormCardView["due"] = null;
  if (!notRequired && !filed && !lockedYear) {
    if (deadline?.dueOn) {
      const when = dateWords(deadline.dueOn);
      if (deadline.basis === "verified") {
        due = {
          text: `${deadline.overdue ? "Was due" : "Due"} ${when}${deadline.citation ? ` (${deadline.citation})` : ""}${deadline.overdue ? " — overdue" : ""}`,
          tone: deadline.overdue ? "bad" : "ink",
        };
      } else {
        due = {
          text: `Estimated ${when} — not yet checked against this year's instructions${deadline.overdue ? " — may be overdue" : ""}`,
          tone: deadline.overdue ? "warning" : "mute",
        };
      }
    } else if (deadline) {
      due = { text: `Due date not on file — ask your CPA.${deadline.note ? ` ${deadline.note}` : ""}`, tone: "mute" };
    } else if (o.dueOn) {
      due = { text: `Due ${dateWords(o.dueOn)}${o.dueCitation ? ` (${o.dueCitation})` : ""}`, tone: "ink" };
    } else {
      due = { text: "Due date not on file — ask your CPA.", tone: "mute" };
    }
  }

  const views = linkViewsFor(ctx, o.formCode, o.taxYear);
  const fileOnlineView = views.find((v) => v.kind === "file_online") ?? null;

  let status: FormCardView["status"];
  if (lockedYear) {
    status = { text: "Figures saved and locked on the 1120-H check — record the filing here", tone: "warning" };
  } else if (!started) {
    status = { text: notRequired ? "Nothing to do" : "Not started", tone: "mute" };
  } else if (started.status === "filed") {
    status = { text: started.filedOn ? `Filed on ${dateWords(started.filedOn)}` : "Filed", tone: "good" };
  } else if (started.status === "ready_to_sign") {
    status = { text: "Ready to sign", tone: "good" };
  } else {
    const open = started.fields.open;
    const needs = open > 0 ? `Needs you: ${open} line${open === 1 ? "" : "s"} to confirm` : null;
    if (started.sentToAccountantAt) {
      const who = ctx.accountant?.firstName ?? "your accountant";
      status = {
        text: `Sent to ${who} on ${dateWords(started.sentToAccountantAt.slice(0, 10))}${needs ? ` · ${needs}` : ""}`,
        tone: needs ? "warning" : "ink",
      };
    } else if (needs) {
      status = { text: needs, tone: "warning" };
    } else if (started.fields.total === 0) {
      status = { text: "Figures ready — nothing to confirm in Walkup", tone: "ink" };
    } else {
      status = { text: "In review", tone: "ink" };
    }
  }

  let action: CardAction = { kind: "none" };
  if (started && formHref) {
    if (started.status === "filed") action = { kind: "filed", href: formHref, label: started.filedOn ? `Filed on ${dateWords(started.filedOn)}` : "Filed" };
    else if (started.status === "ready_to_sign")
      // Same words as the form page: a 1099 export is the contractor's copies, not a packet to sign.
      action = { kind: "link", href: formHref, label: o.formCode === "irs_1099_nec" ? "Export the contractor’s copies" : "Export to sign", primary: true };
    else action = { kind: "link", href: formHref, label: pdfBacked ? "Continue" : "Open", primary: false };
  } else if (canWrite && !notRequired) {
    // A form Walkup never fills is filed on the portal or by the CPA; the
    // button opens its page, where the filing date is recorded.
    action = neverFilled ? { kind: "start", label: "Mark as filed…", primary: !fileOnlineView } : { kind: "start", label: "Start", primary: true };
  }

  return {
    key,
    formCode: o.formCode,
    taxYear: o.taxYear,
    vendorId,
    title: `${o.name} · ${o.taxYear}`,
    plain: FORM_PLAIN[o.formCode],
    determination: o.determination,
    reason: o.reason,
    note: o.note,
    warnings: o.warnings,
    due,
    links: views.map(toCardLink),
    linksWords: linksWords(views),
    status,
    action,
    fileOnline: fileOnlineView && !filed && !notRequired ? toCardLink(fileOnlineView) : null,
    muted: notRequired,
  };
}

/** The heads-up draft for the accountant, from the same figures the tab shows. */
function headsUpInput(ctx: TaxContext, result: Form1120hResult | null, senderName: string): AccountantEmailInput {
  const f = ctx.input.figures;
  const tests = run1120hTests(ctx.input);
  const param = (key: string) => ctx.input.parameters.find((p) => p.key === key) ?? null;
  const rate = param("form_1120h_rate_condo");
  const deduction = param("form_1120h_specific_deduction");
  const threshold = param("form_1099_nec_threshold");
  const due = ctx.deadlines.find((d) => d.key === deadlineKey("irs_1120h", ctx.fiscalYear.taxYear, null)) ?? null;
  const asEmailTest = (t: NonNullable<ReturnType<typeof run1120hTests>>[number]) => ({
    ratio: t.ratio,
    threshold: t.threshold,
    passed: t.passed,
    verified: t.thresholdVerified,
  });
  return {
    variant: "heads_up",
    association: { legalName: ctx.association.legal_name, displayName: ctx.association.display_name },
    accountant: ctx.accountant ? { firstName: ctx.accountant.firstName, email: ctx.accountant.email } : null,
    fiscalYear: { label: ctx.fiscalYear.label, startsOn: ctx.fiscalYear.starts_on, endsOn: ctx.fiscalYear.ends_on },
    taxYear: ctx.fiscalYear.taxYear,
    figures: {
      exemptIncomeCents: f.exemptIncomeCents,
      nonexemptIncomeCents: f.grossIncomeCents - f.exemptIncomeCents,
      grossIncomeCents: f.grossIncomeCents,
      exemptExpendituresCents: f.exemptExpendituresCents,
      totalExpendituresCents: f.totalExpendituresCents,
      nonexemptByAccount: ctx.nonexemptByAccount,
    },
    tests: tests ? { income: asEmailTest(tests[0]), expenditure: asEmailTest(tests[1]) } : null,
    estimatedTaxCents: result?.taxDueCents ?? null,
    parametersVerified: Boolean(rate?.verifiedOn && deduction?.verifiedOn),
    parameters: { rateCondo: rate?.value ?? null, specificDeductionCents: deduction ? Math.round(deduction.value * 100) : null },
    due: due ? { on: due.dueOn, basis: due.basis, citation: due.citation } : { on: null, basis: "none", citation: null },
    contractors: ctx.contractorRows.map((c) => ({ name: c.name, totalCents: c.totalCents, w9OnFile: c.w9OnFile })),
    threshold: threshold ? { cents: Math.round(threshold.value * 100), verified: threshold.verifiedOn !== null } : null,
    deadlines: ctx.deadlines.map((d) => ({ name: d.name, dueOn: d.dueOn, basis: d.basis })),
    openItems: [],
    attachments: [],
    senderName,
  };
}

/** "Send the dates to the board": the deadline list with its estimated marks, and the tab's link. */
function boardDraft(ctx: TaxContext, taxUrl: string, senderName: string): { subject: string; body: string } {
  const subject = `${ctx.association.display_name}: tax dates for ${ctx.fiscalYear.taxYear}`;
  const dates = ctx.deadlines.map((d) =>
    d.dueOn ? `- ${d.name}: ${dateWords(d.dueOn)}${d.basis === "verified" ? "" : " (estimated)"}` : `- ${d.name}: date not on file — ask our CPA`,
  );
  const estimated = ctx.deadlines.some((d) => d.dueOn && d.basis !== "verified");
  const lines = [
    "Hi all,",
    "",
    dates.length > 0
      ? `Here are the tax dates Walkup has for ${ctx.association.display_name}, fiscal year ${ctx.fiscalYear.label}:`
      : `Walkup has no tax dates on file yet for ${ctx.association.display_name}, fiscal year ${ctx.fiscalYear.label}.`,
    ...dates,
    ...(estimated ? ["", "Estimated dates haven't been checked against this year's instructions yet."] : []),
    "",
    `The details, and a calendar file: ${taxUrl}`,
    "",
    "Nothing on this list has been filed yet.",
    ...(senderName ? ["", senderName] : []),
  ];
  return { subject, body: lines.join("\n") };
}

/** "Ask for a W-9": a draft to the contractor, with the registry's W-9 link. */
function w9Href(ctx: TaxContext, contractor: { name: string; email: string | null }, w9Url: string | null, senderName: string): string {
  const subject = `${ctx.association.display_name}: W-9 request`;
  const lines = [
    `Hi ${contractor.name},`,
    "",
    `${ctx.association.legal_name} needs a completed Form W-9 from you for our records before we can prepare a 1099-NEC. ${
      w9Url ? `The form is here: ${w9Url}` : "You can download the form from irs.gov (search for Form W-9)."
    }`,
    "",
    "You can reply to this email with it attached.",
    "",
    "Thanks,",
    [senderName, ctx.association.display_name].filter(Boolean).join(", "),
  ];
  return mailtoHref(contractor.email, subject, lines.join("\n"));
}

export default async function TaxPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const { fy: fyParam } = await searchParams;
  const supabase = await createClient();

  // One context for the whole tab (and the form pages and exports), so the
  // forms list, the deadlines, the 1120-H check and the 1099 table can't
  // disagree. `?fy=` shows an earlier year; an unknown id falls back to the
  // year whose return is next to file.
  const ctx = await loadTaxContext(supabase, { fiscalYearId: fyParam || undefined });
  if (!ctx) {
    if (await viewerIsOwnerOnly()) {
      return (
        <BoardOnly
          what="Taxes"
          why="The association's tax returns and 1099s are prepared by the board with the accountant."
          alternative={{ label: "See documents shared with you", href: "/documents" }}
        />
      );
    }
    return <Restricted what="the tax section" />;
  }
  const fy = { id: ctx.fiscalYear.id, label: ctx.fiscalYear.label, association_id: ctx.association.id };
  const isIllinois = ctx.association.state_code === "IL";

  const [
    { data: receipts },
    { data: disbursements },
    { data: filedForms },
    { data: filingRows },
    { data: rawReceipts },
    { data: rawDisbursements },
    { data: classifications },
    { data: canWriteRow },
    {
      data: { user },
    },
    requestHeaders,
  ] = await Promise.all([
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
      .select("id, form_code, tax_year, filed_on, filed_proof_document_id, signable_document_id, vendors(name)")
      .eq("status", "filed")
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
    supabase.auth.getUser(),
    headers(),
  ]);

  const filing = filingRows?.[0] ?? null;
  const canWrite = canWriteRow === true;
  // Once a filing is locked, the transactions that fed it stop being
  // reclassifiable too — a saved, filed return should not keep drifting
  // underneath itself.
  const canReclassify = canWrite && !filing?.locked_at;

  // The app's address, for the links inside the email drafts. Behind Vercel
  // the forwarded headers carry it; locally it's the plain host.
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") ?? (host && /^(localhost|127\.)/.test(host) ? "http" : "https");
  const taxUrl = host ? `${proto}://${host}/tax` : "/tax";
  const senderName = ctx.boardMembers.find((m) => m.authUserId === user?.id)?.fullName ?? "";

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

  // ---- 1120-H check -----------------------------------------------------------
  // The rules in force for this year, not whatever row happens to be current:
  // the 1120-H figures as of the fiscal year end, the 1099 threshold as of
  // Dec 31 of the payment year (the same half-open rule as the migration).
  const isPaymentYearKey = (p: TaxParameterRow) => p.key.startsWith("form_1099");
  const inForce: TaxParameterRow[] = [
    ...parametersAsOf(ctx.parametersAll.filter((p) => !isPaymentYearKey(p)), ctx.asOf.fiscalYearEnd),
    ...parametersAsOf(ctx.parametersAll.filter(isPaymentYearKey), ctx.asOf.contractorYearEnd),
  ];
  const inForceIds = new Set(inForce.map((p) => p.id));
  const parameters: TaxParameter[] = inForce.map((p) => ({
    key: p.key,
    numericValue: p.numericValue,
    sourceUrl: p.sourceUrl,
    verifiedOn: p.verifiedOn,
    notes: p.notes,
  }));
  const figures = ctx.input.figures;
  let result: Form1120hResult | null = null;
  try {
    result = computeForm1120h(
      {
        exemptIncome: fromCents(figures.exemptIncomeCents),
        nonexemptIncome: fromCents(figures.grossIncomeCents - figures.exemptIncomeCents),
        grossIncome: fromCents(figures.grossIncomeCents),
        exemptExpenditures: fromCents(figures.exemptExpendituresCents),
        totalExpenditures: fromCents(figures.totalExpendituresCents),
      },
      parameters,
    );
  } catch {
    // A year no stored rate or threshold covers. The check says so below
    // rather than borrowing another year's numbers (CLAUDE.md invariant 8).
    result = null;
  }

  // The 1099 threshold is read from tax_parameters and never hardcoded
  // (CLAUDE.md invariant 8), as of Dec 31 of the payment year. If it's
  // missing, the section says so instead of assuming a number.
  const thresholdParam = ctx.input.parameters.find((p) => p.key === "form_1099_nec_threshold") ?? null;
  const thresholdCents = thresholdParam ? Math.round(thresholdParam.value * 100) : null;
  const contractorRows = ctx.contractorRows;
  const owesForm = thresholdCents === null ? [] : contractorRows.filter((c) => c.totalCents >= thresholdCents);
  const missingW9 = owesForm.filter((c) => !c.w9OnFile);
  const w9Url = linkViewsFor(ctx, "irs_w9", ctx.contractorYear).find((v) => v.kind === "form" || v.kind === "about")?.url ?? null;

  // ---- This year ----------------------------------------------------------------
  const thisYear: ThisYearInput = {
    todayIso: ctx.todayIso,
    ein: ctx.association.ein,
    unconfirmedIncomeAccounts: ctx.input.unconfirmedIncomeAccounts,
    missingW9: missingW9.map((c) => c.name),
    deadlines: ctx.deadlines,
    accountantSet: ctx.accountant !== null,
    forms: Object.fromEntries(
      ctx.deadlines.flatMap((d) => {
        const form = d.formId ? ctx.startedForms.find((f) => f.id === d.formId) : null;
        if (!form) return [];
        const t = templateFor(ctx, form.formCode, form.taxYear);
        return [[d.key, { hasPdfTemplate: form.fields.total > 0 || t?.kind === "pdf", openLines: form.fields.open, sent: form.sentToAccountantAt !== null }]];
      }),
    ),
  };
  const boardEmails = ctx.boardMembers.filter((m) => m.email && m.authUserId !== user?.id).map((m) => m.email as string);
  const board = boardDraft(ctx, taxUrl, senderName);
  const boardHref = boardEmails.length > 0 ? mailtoHref(boardEmails, board.subject, board.body) : null;

  // ---- Your forms -----------------------------------------------------------------
  const dueByKey = new Map(ctx.deadlines.map((d) => [d.key, d.dueOn]));
  const cards = ctx.forms
    .map((o) => cardViewFor(ctx, o, canWrite))
    // Soonest first, undated next, not-required last; ties keep the determination order.
    .sort((a, b) => {
      if (a.muted !== b.muted) return a.muted ? 1 : -1;
      const da = dueByKey.get(a.key) ?? null;
      const db = dueByKey.get(b.key) ?? null;
      if (da && db && da !== db) return da < db ? -1 : 1;
      if ((da === null) !== (db === null)) return da === null ? 1 : -1;
      return 0;
    });
  const started1120h = ctx.startedForms.find((f) => f.formCode === "irs_1120h" && (f.fiscalYearId === fy.id || f.taxYear === ctx.fiscalYear.taxYear)) ?? null;
  const headsUpHref = ctx.accountant
    ? (() => {
        const draft = accountantEmail(headsUpInput(ctx, result, senderName));
        return mailtoHref(ctx.accountant.email, draft.subject, draft.body);
      })()
    : null;
  const pastForms = filedForms ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Taxes</h1>
        <p className="mt-1 text-mute">
          Fiscal year {ctx.fiscalYear.label} ({ctx.fiscalYear.starts_on} to {ctx.fiscalYear.ends_on}) — which forms you
          need, why, and when.
        </p>
        {ctx.fiscalYears.length > 1 ? (
          <nav aria-label="Fiscal year" className="mt-3 inline-flex flex-wrap rounded-full border border-line bg-paper p-0.5">
            {ctx.fiscalYears.map((f) => (
              <Link
                key={f.id}
                href={`/tax?fy=${f.id}`}
                aria-current={f.id === fy.id ? "page" : undefined}
                className={`inline-flex min-h-[36px] items-center rounded-full px-3 text-[12px] font-medium ${
                  f.id === fy.id ? "bg-ink text-paper" : "text-mute hover:text-ink"
                }`}
              >
                {f.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      <ThisYear
        input={thisYear}
        calendarHref="/tax/calendar"
        boardHref={boardHref}
        boardNote={boardHref ? null : "No other board member has an email on file, so there's nobody to send the dates to yet."}
        canWrite={canWrite}
        onStart={startForm}
      />

      <section id="forms" className="space-y-3">
        <h2 className="text-[16px] font-bold tracking-tight text-ink">Your forms</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {cards.map((v) => (
            <FormCard key={v.key} view={v} canWrite={canWrite}>
              {v.formCode === "il_sos_annual_report" && isIllinois ? (
                <SosFileNumber current={ctx.settings.ilSosFileNumber} canWrite={canWrite} />
              ) : v.formCode === "irs_1096" && v.determination === "ask_cpa" ? (
                <a href="#filing-method" className="text-[12px] text-ink underline underline-offset-2">
                  Say how you file 1099s ↓
                </a>
              ) : null}
            </FormCard>
          ))}
        </div>
        <p className="text-[12px] text-mute">Other filings may apply. Ask your CPA.</p>
        {!isIllinois ? (
          <Answer
            status="neutral"
            headline="Walkup only knows Illinois' state filings so far"
            detail={`Your building is in ${ctx.association.state_code}. The federal forms above still apply; ask your CPA which ${ctx.association.state_code} filings do.`}
          />
        ) : !ctx.association.incorporated_on ? (
          <Answer
            status="attention"
            headline="Add your incorporation date so Walkup can list the Illinois annual report"
            detail="The Secretary of State's annual report is due around the anniversary of incorporation. Add the date in Building Info and the report appears above with an estimated date."
          >
            <a href="/building" className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill">
              Open Building Info
            </a>
          </Answer>
        ) : null}
      </section>

      <div id="accountant">
        <AccountantCard
          accountant={ctx.accountant ? { fullName: ctx.accountant.fullName, firm: ctx.accountant.firm, email: ctx.accountant.email } : null}
          canWrite={canWrite}
          headsUpHref={headsUpHref}
        />
      </div>

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
        <h2 className="text-[16px] font-bold tracking-tight text-ink">1120-H check</h2>
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

      {!result ? (
        <Answer
          status="attention"
          headline="Ask your CPA — this year's tax rules aren't on file in Walkup"
          detail={`No stored rate or threshold covers a fiscal year ending ${dateWords(ctx.fiscalYear.ends_on)}, so the check can't run. The rules Walkup has are listed under "Where these tax rules come from".`}
        />
      ) : result.qualifies ? (
        <Answer
          status="good"
          headline="You qualify for the short tax form this year"
          detail={`Both rules are met. Filing 1120-H is a choice you make each year by filing it — ask your CPA whether 1120-H or Form 1120 is better for you. ${
            result.taxDueCents > 0
              ? `Walkup's provisional estimate, before any deductions or credits the form allows, is about ${formatMoney(result.taxDueCents)} — ask your CPA.`
              : "Walkup's provisional estimate, before any deductions or credits the form allows, is $0 — ask your CPA."
          }`}
        />
      ) : (
        <Answer
          status="bad"
          headline="You do not currently qualify for the short tax form"
          detail="At least one of the two rules is not met. Talk to an accountant before the filing deadline — there may still be time to change the outcome."
        />
      )}

      {result?.usesUnverifiedParameters ? <Provisional /> : null}

      <FilingStatus fiscalYearId={fy.id} filing={filing} canWrite={canWrite} formHref={started1120h ? `/tax/forms/${started1120h.id}` : "#forms"} />

      {result ? (
        <>
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
            title="What you might owe (estimate, before deductions)"
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
        </>
      ) : null}

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
        hint={`Every rate and threshold is stored with the dates it applies to and its source, so an out-of-date figure is visible rather than silent. "This year" marks the rows in force for a fiscal year ending ${dateWords(ctx.fiscalYear.ends_on)} and for payments made in ${ctx.contractorYear}.`}
      >
        <ul className="divide-y divide-line text-[13px]">
          {ctx.parametersAll.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="min-w-0">
                <span className="figures text-ink">{parameterValueWords(p)}</span>
                <span className="text-mute"> — {PARAMETER_LABEL[p.key] ?? p.key}</span>
                <span className="block text-[11px] text-mute-soft">
                  {effectiveWords(p)}
                  {inForceIds.has(p.id) ? " · this year" : ""}
                </span>
              </span>
              <span className="flex items-center gap-3">
                {p.verifiedOn ? (
                  <span className="text-[11px] text-good-text">checked {dateWords(p.verifiedOn, "short")}</span>
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
                    Source ↗
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="border-t border-line pt-6">
        <div>
          <h2 className="text-[16px] font-bold tracking-tight text-ink">
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
              detail={`The 1099-NEC reporting threshold for payments made in ${ctx.contractorYear} isn't on file in Walkup, so it can't tell you which contractors cross it.`}
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
          <FilingMethodChooser current={ctx.settings.informationReturnsFiling} canWrite={canWrite} />
        </div>

        <div className="mt-4">
          <Card
            title="Everyone paid for services"
            hint={
              thresholdParam && thresholdCents !== null
                ? `The threshold for payments made in ${ctx.contractorYear} is ${formatMoney(thresholdCents)} per contractor — ${
                    thresholdParam.verifiedOn ? `checked ${dateWords(thresholdParam.verifiedOn, "short")}` : "not yet checked against this year's instructions"
                  }.`
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
                            {v.w9OnFile ? (
                              <span className="text-good-text">On file</span>
                            ) : (
                              <span className="inline-flex flex-col items-end gap-0.5">
                                <span className="text-bad-text">Missing</span>
                                <a
                                  href={w9Href(ctx, v, w9Url, senderName)}
                                  title={v.email ? `Opens a draft to ${v.email} — nothing is sent.` : "No email on file — opens a draft with no recipient."}
                                  className="text-[11px] text-ink underline underline-offset-2"
                                >
                                  Ask for a W-9
                                </a>
                              </span>
                            )}
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
          assuming from the totals here. &ldquo;Ask for a W-9&rdquo; opens a draft in your email app; nothing is sent.
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
                  Filed on {t.filed_on ? dateWords(t.filed_on) : "—"}
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
