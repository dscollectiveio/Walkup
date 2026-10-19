// When each tax form is due, for the board's reminders. Pure: the filing year,
// the forms already started, the active templates and the determinations in;
// one dated row per form out. The Taxes tab, Home's "Coming up", the
// Next-filing tile, the urgent items and the .ics download all read this one
// list, so they can't disagree about a date.
//
// A date comes from exactly one of three places, in this order, and says which:
//   verified   — an active, verified template's cited due rule (due-rules.ts)
//   estimated  — the built-in estimate below, labeled in words as an estimate
//   none       — nothing Walkup will guess at: the note says "ask your CPA"
//
// Dates are ISO "YYYY-MM-DD" strings end to end. Day arithmetic runs in UTC on
// those strings, so a DST change never shifts a date or a day count. The one
// Date object made here is the local-midnight one dueDate() wants for the
// anniversary rule, and it is built from the parts, never from a timestamp.

import { ESTIMATED_NOTE } from "./copy";
import type { FormCode } from "./determine";
import { dueDate, fiscalRuleSkipsJune, parseDueRule } from "./due-rules";

export type DeadlineBasis = "verified" | "estimated" | "none";
export type DeadlineStatus = "not_started" | "started" | "with_accountant" | "ready_to_sign" | "filed";

export interface DeadlineTemplate {
  formCode: string;
  taxYear: number;
  dueRule: string | null;
  dueRuleCitation: string | null;
  notes: string | null;
  verified: boolean;
  active: boolean;
}

/** A tax_forms row, as much of it as a deadline needs. */
export interface DeadlineForm {
  formCode: string;
  taxYear: number;
  vendorId: string | null;
  status: string;
  filedOn: string | null;
  sentToAccountantAt: string | null;
  id: string;
}

export interface DeadlineInput {
  /** ISO date (local), computed once by the caller. */
  today: string;
  association: {
    stateCode: string;
    /** Reserved: the estimates read fiscalYear.endsOn, so this is carried but not read yet. */
    fiscalYearEndMonth: number | null;
    incorporatedOn: string | null;
    informationReturnsFiling: "paper" | "electronic" | null;
  };
  /** The filing year (see filingYearFor). */
  fiscalYear: { id: string; label: string; startsOn: string; endsOn: string; taxYear: number };
  /** Calendar year whose contractor payments are reported next January. */
  contractorYear: number;
  templates: DeadlineTemplate[];
  forms: DeadlineForm[];
  locked1120hFiscalYearIds: string[];
  /** From determineForms; drives which forms appear (not_required ones never do). */
  outcomes: { formCode: string; taxYear: number; vendorId?: string; determination: string; name?: string }[];
  accountantSet: boolean;
}

export interface Deadline {
  /** `${formCode}:${taxYear}` or `${formCode}:${taxYear}:${vendorId}` — matches a tax_forms row. */
  key: string;
  formCode: FormCode;
  taxYear: number;
  vendorId?: string;
  /** "Form 1120-H" / "1099-NEC — Acme Plumbing" / "Illinois annual report" */
  name: string;
  /** "Federal tax return" / "Federal filing" / "Illinois return" / "Secretary of State" */
  kind: string;
  dueOn: string | null;
  basis: DeadlineBasis;
  citation: string | null;
  note: string | null;
  status: DeadlineStatus;
  formId: string | null;
  overdue: boolean;
  /** Days from today to the due date; negative once overdue; null without a date. */
  daysLeft: number | null;
  /** /tax#forms, or /tax/forms/{id} once the form exists. */
  href: string;
  milestones: { key: "send" | "start"; label: string; on: string }[];
}

/** An overdue deadline keeps showing this long, then the next instance replaces it. */
export const OVERDUE_GRACE_DAYS = 120;
/** "Send it to your accountant" lands this many days before the due date. */
export const SEND_LEAD_DAYS = 60;
/** "Start it" lands this many days before the due date, when there's no accountant to send it to. */
export const START_LEAD_DAYS = 45;

// The estimated wording lives in copy.ts (Home and the email drafts read it
// too); re-exported here so callers of this module need only one import.
export { ESTIMATED_NOTE };
const JUNE_30_NOTE =
  "Fiscal years ending June 30 have their own rule (the 3rd month, not the 4th), so Walkup doesn't estimate this date — ask your CPA.";
const NO_1120_ESTIMATE_NOTE = "Walkup doesn't estimate Form 1120's due date — ask your CPA.";
const NO_INCORPORATION_DATE_NOTE =
  "Walkup needs your incorporation date to estimate this one — add it in Building & Owners, or ask your CPA.";

// Mirrors FORM_LABEL in determine.ts. Only the FormCode *type* is imported
// from there: determine.ts re-exports nextDeadline from this file, and a value
// import back the other way would make a cycle.
const LABEL: Record<FormCode, string> = {
  irs_1120h: "Form 1120-H",
  irs_1120: "Form 1120",
  il_1120: "Illinois IL-1120",
  irs_1099_nec: "Form 1099-NEC",
  irs_1096: "Form 1096",
  il_sos_annual_report: "Illinois annual report",
};

const KIND: Record<FormCode, string> = {
  irs_1120h: "Federal tax return",
  irs_1120: "Federal tax return",
  il_1120: "Illinois return",
  irs_1099_nec: "Federal filing",
  irs_1096: "Federal filing",
  il_sos_annual_report: "Secretary of State",
};

/** Tie-break order when two deadlines share a date (or both have none). */
const ORDER: FormCode[] = ["irs_1120h", "irs_1120", "il_1120", "irs_1099_nec", "irs_1096", "il_sos_annual_report"];

const isFormCode = (s: string): s is FormCode => s in LABEL;
const isInformationReturn = (code: FormCode) => code === "irs_1099_nec" || code === "irs_1096";
const isIllinois = (code: FormCode) => code === "il_1120" || code === "il_sos_annual_report";

// ---- ISO date arithmetic (UTC, so no DST drift) ------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0");
const toIso = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
const parts = (iso: string): [number, number, number] => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [y, m, d];
};
/** Days in month `m` (1-based) of year `y`. */
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Whole days from `fromIso` to `toIso`; negative when `toIso` is earlier. */
export function daysBetween(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = parts(fromIso);
  const [y2, m2, d2] = parts(toIso);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** The same month and day `years` later; a Feb 29 becomes Feb 28 when it has to. */
function shiftYears(iso: string, years: number): string {
  const [y, m, d] = parts(iso);
  return toIso(y + years, m, Math.min(d, daysInMonth(y + years, m)));
}

/** Local midnight of an ISO date — what dueDate() reads with local getters. */
function localDate(iso: string): Date {
  const [y, m, d] = parts(iso);
  return new Date(y, m - 1, d);
}

// ---- Built-in estimates (§3.10 of the Tax Center v2 spec) ---------------------

/**
 * The 15th of the 4th month after the fiscal year ends — the general 1120-H
 * rule, which Illinois follows for IL-1120. A year ending in June is the one
 * exception the IRS carves out (3rd month), and Walkup doesn't estimate it.
 */
function fourthMonthFifteenth(fiscalYearEnd: string): string | null {
  const [y, m] = parts(fiscalYearEnd);
  if (m === 6) return null;
  const months = y * 12 + (m - 1) + 4;
  return toIso(Math.floor(months / 12), (months % 12) + 1, 15);
}

/**
 * Illinois annual report: the last day of the month before the anniversary
 * month (805 ILCS 105/114.10 says within the 60 days before that month; the
 * month-end is the safer, earlier estimate). A January anniversary means
 * December 31 of the year before. The report recurs every year, so this picks
 * the instance for today: the first one not yet past the overdue grace window.
 */
function annualReportInstance(incorporatedOn: string, today: string): string {
  const anniversaryMonth = parts(incorporatedOn)[1];
  const staleBefore = addDays(today, -OVERDUE_GRACE_DAYS);
  const todayYear = parts(today)[0];
  for (let y = todayYear - 1; y <= todayYear + 2; y++) {
    const m = anniversaryMonth === 1 ? 12 : anniversaryMonth - 1;
    const year = anniversaryMonth === 1 ? y - 1 : y;
    const candidate = toIso(year, m, daysInMonth(year, m));
    if (candidate >= staleBefore) return candidate;
  }
  // Unreachable: the candidates are a year apart and the window is 120 days.
  return toIso(todayYear + 2, 12, 31);
}

interface Due {
  dueOn: string | null;
  basis: DeadlineBasis;
  citation: string | null;
  note: string | null;
}

const estimated = (dueOn: string): Due => ({ dueOn, basis: "estimated", citation: null, note: ESTIMATED_NOTE });
const none = (note: string): Due => ({ dueOn: null, basis: "none", citation: null, note });

function estimate(input: DeadlineInput, code: FormCode, instanceYear: number, fiscalYearEnd: string): Due {
  switch (code) {
    case "irs_1120h":
    case "il_1120": {
      const on = fourthMonthFifteenth(fiscalYearEnd);
      return on ? estimated(on) : none(JUNE_30_NOTE);
    }
    case "irs_1120":
      // Form 1120's rule isn't sourced in Walkup, and it has its own June
      // quirks — not a guess worth making.
      return none(NO_1120_ESTIMATE_NOTE);
    case "irs_1099_nec":
    case "irs_1096":
      // IRC 6071(c): January 31 after the year of payment.
      return estimated(toIso(instanceYear + 1, 1, 31));
    case "il_sos_annual_report":
      return input.association.incorporatedOn
        ? estimated(annualReportInstance(input.association.incorporatedOn, input.today))
        : none(NO_INCORPORATION_DATE_NOTE);
  }
}

// ---- Verified templates --------------------------------------------------------

/**
 * The verified, active template whose cited rule decides this form's date.
 * Returns and information returns are matched on their own year; the Illinois
 * annual report isn't year-specific, so the newest verified one applies.
 */
function templateFor(templates: DeadlineTemplate[], code: FormCode, instanceYear: number): DeadlineTemplate | null {
  const usable = templates.filter(
    (t) => t.formCode === code && t.verified && t.active && t.dueRule !== null && parseDueRule(t.dueRule) !== null,
  );
  if (code === "il_sos_annual_report") {
    return usable.sort((a, b) => b.taxYear - a.taxYear)[0] ?? null;
  }
  return usable.find((t) => t.taxYear === instanceYear) ?? null;
}

function resolveDue(input: DeadlineInput, code: FormCode, instanceYear: number, fiscalYearEnd: string): Due {
  const t = templateFor(input.templates, code, instanceYear);
  // A June-30 year is the one the general rule can't cover (due-rules.ts);
  // no date beats a verified-looking wrong one.
  if (t && fiscalRuleSkipsJune(t.dueRule, fiscalYearEnd)) return none(JUNE_30_NOTE);
  if (t) {
    const on = dueDate(t.dueRule, {
      fiscalYearEnd,
      calendarYear: instanceYear,
      incorporatedOn: input.association.incorporatedOn,
      today: localDate(input.today),
    });
    if (on) return { dueOn: on, basis: "verified", citation: t.dueRuleCitation, note: t.notes };
  }
  return estimate(input, code, instanceYear, fiscalYearEnd);
}

// ---- Status, milestones, assembly -----------------------------------------------

const keyFor = (code: FormCode, taxYear: number, vendorId: string | null) =>
  vendorId ? `${code}:${taxYear}:${vendorId}` : `${code}:${taxYear}`;

function findForm(forms: DeadlineForm[], code: FormCode, taxYear: number, vendorId: string | null): DeadlineForm | null {
  return forms.find((f) => f.formCode === code && f.taxYear === taxYear && (f.vendorId ?? null) === vendorId) ?? null;
}

/** tax_forms.status plus "sent to the accountant", read as the board's five steps. */
function statusOf(form: DeadlineForm | null): DeadlineStatus {
  if (!form) return "not_started";
  if (form.status === "filed") return "filed";
  if (form.status === "ready_to_sign") return "ready_to_sign";
  if (form.sentToAccountantAt) return "with_accountant";
  if (form.status === "draft" || form.status === "in_review") return "started";
  return "not_started";
}

function milestonesFor(
  dueOn: string | null,
  status: DeadlineStatus,
  form: DeadlineForm | null,
  accountantSet: boolean,
  name: string,
): Deadline["milestones"] {
  if (!dueOn || status === "filed") return [];
  // With an accountant on file, the one thing to do early is send them the
  // figures; without one, the nudge is simply to start.
  if (accountantSet && !form?.sentToAccountantAt) {
    return [{ key: "send", label: `Send ${name} to your accountant`, on: addDays(dueOn, -SEND_LEAD_DAYS) }];
  }
  if (status === "not_started") {
    return [{ key: "start", label: `Start ${name}`, on: addDays(dueOn, -START_LEAD_DAYS) }];
  }
  return [];
}

function deadlineFor(input: DeadlineInput, outcome: DeadlineInput["outcomes"][number], code: FormCode): Deadline | null {
  const vendorId = outcome.vendorId ?? null;
  const name = outcome.name ?? LABEL[code];
  // 1099/1096 are keyed by the payment year (the contractor year), which is
  // what determineForms puts on those outcomes; returns by the fiscal year.
  const baseYear = isInformationReturn(code) ? input.contractorYear : outcome.taxYear;
  const staleBefore = addDays(input.today, -OVERDUE_GRACE_DAYS);
  // The annual report chooses its own instance (annualReportInstance); the
  // others roll forward a year at a time once this year's date is stale.
  const offsets = code === "il_sos_annual_report" ? [0] : [0, 1, 2];

  for (const offset of offsets) {
    const taxYear = baseYear + offset;
    const form = findForm(input.forms, code, taxYear, vendorId);
    // Filed, or figures locked for the year: nothing left to remind about.
    if (form?.status === "filed") return null;
    if (code === "irs_1120h" && offset === 0 && input.locked1120hFiscalYearIds.includes(input.fiscalYear.id)) return null;

    const due = resolveDue(input, code, taxYear, shiftYears(input.fiscalYear.endsOn, offset));
    // Past the grace window: assume it was handled outside Walkup and show the
    // next instance instead of nagging forever.
    if (due.dueOn && due.dueOn < staleBefore) continue;

    const status = statusOf(form);
    return {
      key: keyFor(code, taxYear, vendorId),
      formCode: code,
      taxYear,
      ...(vendorId ? { vendorId } : {}),
      name,
      kind: KIND[code],
      dueOn: due.dueOn,
      basis: due.basis,
      citation: due.citation,
      note: due.note,
      status,
      formId: form?.id ?? null,
      overdue: due.dueOn !== null && due.dueOn < input.today,
      daysLeft: due.dueOn ? daysBetween(input.today, due.dueOn) : null,
      href: form ? `/tax/forms/${form.id}` : "/tax#forms",
      milestones: milestonesFor(due.dueOn, status, form, input.accountantSet, name),
    };
  }
  return null;
}

function byDue(a: Deadline, b: Deadline): number {
  if (a.dueOn && b.dueOn && a.dueOn !== b.dueOn) return a.dueOn < b.dueOn ? -1 : 1;
  if ((a.dueOn === null) !== (b.dueOn === null)) return a.dueOn === null ? 1 : -1;
  const order = ORDER.indexOf(a.formCode) - ORDER.indexOf(b.formCode);
  return order !== 0 ? order : a.name.localeCompare(b.name);
}

/** Every open deadline for the filing year, soonest first, undated ones last. */
export function taxDeadlines(input: DeadlineInput): Deadline[] {
  const out: Deadline[] = [];
  const seen = new Set<string>();
  for (const outcome of input.outcomes) {
    if (!isFormCode(outcome.formCode) || outcome.determination === "not_required") continue;
    const code = outcome.formCode;
    // Walkup only knows Illinois' state filings; other states get an honest
    // "not on file" on the tab, not a date.
    if (isIllinois(code) && input.association.stateCode !== "IL") continue;
    // Form 1096 goes only with paper 1099s. Until the board says how they
    // file, the card reads "ask your CPA" and there's no date to remind about.
    if (code === "irs_1096" && input.association.informationReturnsFiling !== "paper") continue;

    const d = deadlineFor(input, outcome, code);
    if (!d || seen.has(d.key)) continue;
    seen.add(d.key);
    out.push(d);
  }
  return out.sort(byDue);
}

/** The soonest open deadline with a date — overdue ones included, since they come first. */
export function nextDeadline(deadlines: Deadline[]): Deadline | null {
  let best: Deadline | null = null;
  for (const d of deadlines) {
    if (d.dueOn === null || d.status === "filed") continue;
    if (!best || byDue(d, best) < 0) best = d;
  }
  return best;
}

/** The fiscal_years row shape filingYearFor reads (snake_case, straight from the DB). */
export interface FilingFiscalYear {
  id: string;
  label: string;
  starts_on: string;
  ends_on: string;
}

/**
 * The fiscal year whose return is next to file: the newest one that has ended
 * within the last 12 months and whose 1120-H is neither filed nor locked;
 * otherwise the year containing today; otherwise the newest on file. Null only
 * when there are no fiscal years at all. A form's tax year is the year its
 * fiscal year ends in (the convention in tax/data.ts), which is how a filed
 * 1120-H is matched to its year here.
 */
export function filingYearFor<T extends FilingFiscalYear>(
  fiscalYears: T[],
  forms: DeadlineForm[],
  locked1120hFiscalYearIds: string[],
  todayIso: string,
): T | null {
  if (fiscalYears.length === 0) return null;
  const newestFirst = [...fiscalYears].sort((a, b) => b.ends_on.localeCompare(a.ends_on));
  const windowStart = addDays(todayIso, -365);
  const filedYears = new Set(forms.filter((f) => f.formCode === "irs_1120h" && f.status === "filed").map((f) => f.taxYear));
  const justEnded = newestFirst.find(
    (fy) =>
      fy.ends_on < todayIso &&
      fy.ends_on >= windowStart &&
      !filedYears.has(Number(fy.ends_on.slice(0, 4))) &&
      !locked1120hFiscalYearIds.includes(fy.id),
  );
  if (justEnded) return justEnded;
  return newestFirst.find((fy) => fy.starts_on <= todayIso && todayIso <= fy.ends_on) ?? newestFirst[0];
}
