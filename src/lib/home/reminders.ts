// Deadline assembly for the home page: the tax deadlines Home builds from its
// own rows (homeTaxDeadlines) and the "Coming up" list (assembleReminders).
// Extracted from page.tsx so the logic is one place and plain-testable.
//
// Tax dates come from lib/tax/deadlines — the same list the Taxes tab, the
// Next-filing tile and the .ics download read — so Home can't disagree with
// the tab about a date. Home never loads the full tax context: it hands the
// rows it already has (fiscal years, active templates, started forms,
// contractor totals) to taxDeadlines with a light list of which forms apply.

import {
  filingYearFor,
  taxDeadlines,
  type Deadline,
  type DeadlineForm,
  type DeadlineInput,
  type DeadlineTemplate,
  type FilingFiscalYear,
} from "@/lib/tax/deadlines";
import { FORM_LABEL } from "@/lib/tax/determine";
import { coverageShort } from "@/lib/insurance/coverage";

export interface Reminder {
  name: string;
  kind: string;
  due: Date;
  // Compliance dates the app computes but nobody has verified against this
  // year's instructions. Stale legal information is worse than absent legal
  // information, so these say so instead of reading as authoritative.
  unverified?: boolean;
  /** The date has passed and the thing isn't done. The row keeps its real date rather than rolling forward. */
  overdue?: boolean;
  /**
   * Set on tax filings only — the deadline's key from lib/tax/deadlines, or
   * `irs_1099_nec:{year}` for the grouped 1099 row — so the Next-filing tile
   * can pick one out without matching display names. Nudges carry none.
   */
  filingKey?: string;
  /** Where the row's name links, when there is a page for it. */
  href?: string;
}

export type ReminderRail = "bad" | "warning" | "neutral";

/** Board admins re-review who holds access at least this often (0037). */
export const ACCESS_REVIEW_INTERVAL_DAYS = 90;

export function daysUntil(due: Date, today: Date): number {
  return Math.max(0, Math.ceil((due.getTime() - today.getTime()) / 86400000));
}

/** Severity rail: Rust inside 30 days, warning inside 90, quiet beyond. */
export function railFor(days: number): ReminderRail {
  if (days < 30) return "bad";
  if (days < 90) return "warning";
  return "neutral";
}

export function formatDueDate(due: Date, today: Date): string {
  const sameYear = due.getFullYear() === today.getFullYear();
  return due.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Next occurrence of a month/day on or after today. */
export function nextOccurrence(month: number, day: number, today: Date): Date {
  const thisYear = new Date(today.getFullYear(), month - 1, day);
  return thisYear >= today ? thisYear : new Date(today.getFullYear() + 1, month - 1, day);
}

// ---- Tax deadlines from Home's own rows ----------------------------------------

export interface HomeTaxRows {
  /** Today as a local ISO date — the same day every other Home figure uses. */
  todayIso: string;
  association: {
    stateCode: string;
    fiscalYearEndMonth: number | null;
    incorporatedOn: string | null;
    /** How the board files 1099s with the IRS; Form 1096 goes only with paper. Null until someone says. */
    informationReturnsFiling: "paper" | "electronic" | null;
    /** An accountant is on file (associations.accountant_person_id), so the early nudge is to send them the figures. */
    accountantSet: boolean;
  };
  /** Every fiscal year on file, any order; the filing year is picked here. */
  fiscalYears: FilingFiscalYear[];
  /** Calendar year whose contractor payments are reported next January. */
  contractorYear: number;
  /**
   * The 1099-NEC threshold in force on Dec 31 of the contractor year, in
   * cents, resolved by the caller (tax/data.ts's parametersAsOf: half-open,
   * so Jan 1 reads the new amount). Null when no row covers that date.
   */
  thresholdCents: number | null;
  /** Everyone paid for services in the contractor year (vendor_1099_calendar_totals), whatever the amount. */
  contractors: { vendorId: string; name: string; totalCents: number; w9OnFile: boolean }[];
  /** Active tax_form_templates, PDF and link-only. */
  templates: DeadlineTemplate[];
  /** Every tax_forms row. */
  forms: DeadlineForm[];
  locked1120hFiscalYearIds: string[];
}

export interface HomeTaxDeadlines {
  /** Every open deadline for the filing year, soonest first (lib/tax/deadlines). */
  deadlines: Deadline[];
  /** The fiscal year whose return is next to file; null with no fiscal years on file. */
  filingYear: FilingFiscalYear | null;
  /** Contractors at or above the threshold with no W-9 on file — everyone paid, when no threshold is on file. */
  contractorsMissingW9: number;
}

/**
 * The deadlines the Taxes tab would show, worked out from rows alone. Home has
 * no ledger figures to run the two 1120-H tests with, so the return reads
 * ask_cpa here (the tab says whether you qualify); everything else that
 * decides which forms appear is a fact on a row — the state, the incorporation
 * date, who was paid at or above the 1099 threshold, how the board files 1099s.
 */
export function homeTaxDeadlines(rows: HomeTaxRows): HomeTaxDeadlines {
  const { association: a, contractorYear, thresholdCents } = rows;
  const filingYear = filingYearFor(rows.fiscalYears, rows.forms, rows.locked1120hFiscalYearIds, rows.todayIso);
  const thisYear = Number(rows.todayIso.slice(0, 4));
  const taxYear = filingYear ? Number(filingYear.ends_on.slice(0, 4)) : thisYear;

  const outcomes: DeadlineInput["outcomes"] = [];
  // The return can only be dated against a fiscal year; without one it isn't
  // listed, rather than guessed at.
  if (filingYear) {
    outcomes.push({ formCode: "irs_1120h", taxYear, determination: "ask_cpa", name: FORM_LABEL.irs_1120h });
    if (a.stateCode === "IL") outcomes.push({ formCode: "il_1120", taxYear, determination: "ask_cpa", name: FORM_LABEL.il_1120 });
  }
  // Without the incorporation date the annual report can't be dated either;
  // the Taxes tab asks for it in Building Info.
  if (a.stateCode === "IL" && a.incorporatedOn) {
    outcomes.push({ formCode: "il_sos_annual_report", taxYear, determination: "ask_cpa", name: FORM_LABEL.il_sos_annual_report });
  }

  const over = thresholdCents === null ? [] : rows.contractors.filter((c) => c.totalCents >= thresholdCents);
  if (thresholdCents === null) {
    // No threshold on file: nobody can say which contractors need one. The
    // date still stands (one row, no contractor behind it); the tab says ask
    // your CPA.
    outcomes.push({ formCode: "irs_1099_nec", taxYear: contractorYear, determination: "ask_cpa", name: FORM_LABEL.irs_1099_nec });
  }
  for (const c of over) {
    outcomes.push({ formCode: "irs_1099_nec", taxYear: contractorYear, vendorId: c.vendorId, determination: "required", name: `1099-NEC — ${c.name}` });
  }
  if (over.length > 0) {
    // Same three-way answer as determineForms: paper → required, electronic →
    // not required, unanswered → ask your CPA (and no date to remind about).
    const method = a.informationReturnsFiling;
    outcomes.push({
      formCode: "irs_1096",
      taxYear: contractorYear,
      determination: method === "paper" ? "required" : method === "electronic" ? "not_required" : "ask_cpa",
      name: FORM_LABEL.irs_1096,
    });
  }

  const deadlines = taxDeadlines({
    today: rows.todayIso,
    association: {
      stateCode: a.stateCode,
      fiscalYearEndMonth: a.fiscalYearEndMonth,
      incorporatedOn: a.incorporatedOn,
      informationReturnsFiling: a.informationReturnsFiling,
    },
    fiscalYear: filingYear
      ? { id: filingYear.id, label: filingYear.label, startsOn: filingYear.starts_on, endsOn: filingYear.ends_on, taxYear }
      : // No fiscal year on file: the calendar year stands in so the 1099s and
        // the annual report can still be dated. Neither reads it, and the
        // return (which would) isn't in the list above.
        { id: "", label: String(thisYear), startsOn: `${thisYear}-01-01`, endsOn: `${thisYear}-12-31`, taxYear: thisYear },
    contractorYear,
    templates: rows.templates,
    forms: rows.forms,
    locked1120hFiscalYearIds: rows.locked1120hFiscalYearIds,
    outcomes,
    accountantSet: a.accountantSet,
  });

  // Collecting a W-9 is never wasted, so with no threshold on file the nudge
  // covers everyone paid this year rather than nobody.
  const contractorsMissingW9 = (thresholdCents === null ? rows.contractors : over).filter((c) => !c.w9OnFile).length;
  return { deadlines, filingYear, contractorsMissingW9 };
}

// ---- Coming up ----------------------------------------------------------------------

interface ReminderInputs {
  /** Paused bills (paused_at set) are skipped. */
  bills: { name: string; next_due_on: string | null; autopay_arranged: boolean; paused_at?: string | null }[];
  /**
   * Active and upcoming policies (lib/insurance/status). `renewed` = the
   * renewal is already saved, so there are no quotes to chase.
   */
  policies: { coverage: string; effective_to: string; renewal_reminder_days?: number | null; renewed?: boolean }[];
  /** Board only: quote requests to the board's insurance contacts (insurance_quote_requests). */
  quoteRequests?: { contactName: string; followUpOn: string | null; status: string }[];
  /** Board only: quotes received (insurance_quotes). */
  quotes?: { carrier: string; validUntil: string | null; declined: boolean; selected: boolean }[];
  /** Board only: active upkeep tasks (repairs-spec §18.3). */
  upkeep?: { name: string; next_due_on: string }[];
  /** Board only: contractor visits on open problems. */
  visits?: { title: string; reference: number; scheduled_for: string }[];
  /** Board only: certificate and license expiry dates of contractors in use. */
  contractorExpiries?: { name: string; kind: "coi" | "license"; date: string }[];
  upcomingChargeDates: string[]; // due_on of open/partial charges after today
  today: Date;
  /**
   * Board admins only: when the last access review was recorded (null =
   * never). Omit for everyone else — the reminder is theirs to act on.
   */
  lastAccessReviewAt?: string | null;
  /**
   * Every open tax deadline for the filing year (lib/tax/deadlines, via
   * homeTaxDeadlines). Dated ones become rows — the 1099s grouped into one —
   * and their milestones inside the horizon become nudges.
   */
  taxDeadlines?: Deadline[];
  /** Contractors paid this year, at or above the 1099 threshold, with no W-9 on file — nudged every December 1. */
  contractorsMissingW9?: number;
}

export function assembleReminders({
  bills,
  policies,
  upcomingChargeDates,
  today,
  lastAccessReviewAt,
  taxDeadlines = [],
  contractorsMissingW9 = 0,
  quoteRequests = [],
  quotes = [],
  upkeep = [],
  visits = [],
  contractorExpiries = [],
}: ReminderInputs): Reminder[] {
  const reminders: Reminder[] = [];
  const horizon = new Date(today.getTime() + 120 * 86400000);
  const asDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);
  const within = (days: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);

  for (const b of bills) {
    if (b.autopay_arranged || !b.next_due_on || b.paused_at) continue;
    const due = new Date(`${b.next_due_on}T00:00:00`);
    // A hand-paid bill's date only moves on when someone marks it paid, so a
    // past date means it hasn't been: keep it, flagged, instead of dropping it.
    if (due < today) {
      reminders.push({ name: b.name, kind: "Bill to pay by hand", due, overdue: true });
    } else if (due <= horizon) {
      reminders.push({ name: b.name, kind: "Bill to pay by hand", due });
    }
  }

  const renewals = policies
    .map((p) => ({
      coverage: p.coverage,
      due: new Date(`${p.effective_to}T00:00:00`),
      leadDays: p.renewal_reminder_days ?? 60,
      renewed: p.renewed === true,
    }))
    .filter((p) => p.due >= today)
    .sort((a, b) => a.due.getTime() - b.due.getTime());
  const nextRenewal = renewals.find((p) => p.due <= horizon);
  if (nextRenewal) {
    reminders.push({
      name: "Insurance renewal",
      kind: coverageShort(nextRenewal.coverage),
      due: nextRenewal.due,
      href: "/insurance",
    });
  }
  // The board's own lead time (renewal_reminder_days, per policy) is when to
  // start shopping; overdue reads as today, like the access review below. A
  // policy whose renewal is already saved has nothing left to shop for.
  for (const r of renewals) {
    if (r.renewed) continue;
    const start = new Date(r.due.getFullYear(), r.due.getMonth(), r.due.getDate() - r.leadDays);
    const due = start < today ? today : start;
    if (due > horizon) continue;
    const short = coverageShort(r.coverage);
    // "master", "D&O", "liability": an acronym keeps its capitals.
    const kind = r.coverage === "property" ? "master" : /^[A-Z&]+$/.test(short) ? short : short.toLowerCase();
    reminders.push({
      name: "Get insurance quotes",
      kind: `Your ${kind} policy renews on ${formatDueDate(r.due, today)}. This is a good time to get quotes.`,
      due,
      href: "/insurance?view=quotes&new=1",
    });
  }

  // Quote follow-ups and expiries, computed on every render (no cron,
  // DECISIONS #28). A follow-up date that has passed reads as today.
  for (const q of quoteRequests) {
    if (q.status !== "sent" || !q.followUpOn) continue;
    const on = asDay(q.followUpOn);
    if (on > horizon) continue;
    reminders.push({
      name: `Follow up with ${q.contactName} about your quote`,
      kind: "Insurance quote request",
      due: on < today ? today : on,
      href: "/insurance?view=quotes",
    });
  }
  for (const q of quotes) {
    if (q.declined || q.selected || !q.validUntil) continue;
    const ends = asDay(q.validUntil);
    if (ends < today) continue;
    // Shown from 7 days before the quote lapses.
    if (ends > within(7)) continue;
    reminders.push({
      name: `${q.carrier} quote expires ${ends.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      kind: "Insurance quote",
      due: ends,
      href: "/insurance?view=quotes",
    });
  }

  // Repairs & Upkeep (repairs-spec §18.3). Upkeep keeps an overdue job on its
  // real date, like a tax filing, rather than rolling it forward.
  for (const t of upkeep) {
    const due = asDay(t.next_due_on);
    if (due > within(60)) continue;
    reminders.push({
      name: t.name,
      kind: "Upkeep",
      due,
      ...(due < today ? { overdue: true } : {}),
      href: "/repairs?view=upkeep",
    });
  }
  for (const v of visits) {
    const on = asDay(v.scheduled_for);
    if (on < today || on > within(14)) continue;
    reminders.push({
      name: `Contractor visit: ${v.title} (#${v.reference})`,
      kind: "Repair visit",
      due: on,
      href: "/repairs?view=today",
    });
  }
  for (const c of contractorExpiries) {
    const on = asDay(c.date);
    if (on < today || on > within(60)) continue;
    reminders.push({
      name: c.kind === "coi" ? `${c.name}'s insurance certificate` : `${c.name}'s license`,
      kind: "Contractor paperwork",
      due: on,
      href: "/repairs?view=contractors",
    });
  }

  if (upcomingChargeDates.length > 0) {
    const firstDue = upcomingChargeDates[0];
    const count = upcomingChargeDates.filter((d) => d === firstDue).length;
    reminders.push({
      name: `Assessments due from ${count} unit${count === 1 ? "" : "s"}`,
      kind: "Owner fees",
      due: new Date(`${firstDue}T00:00:00`),
    });
  }

  // Tax deadlines (lib/tax/deadlines). A date comes from a verified template's
  // cited rule or from a built-in estimate; one Walkup won't guess at has no
  // row here — "ask your CPA" belongs on the Taxes tab, not in a list of
  // dates. An estimate is marked unverified: stale legal information is worse
  // than absent, so it says so rather than reading as authoritative.
  const asDate = (iso: string) => new Date(`${iso}T00:00:00`);
  const dated = taxDeadlines.filter((d): d is Deadline & { dueOn: string } => d.dueOn !== null);

  // Milestones ("send it to your accountant" 60 days out, "start it" 45 days
  // out) are nudges, so they keep to the horizon. One that has slipped reads
  // as today, like the quotes and access-review nudges; once the filing itself
  // is overdue its own row says everything.
  const nudge = (on: string, name: string, kind: string, unverified: boolean) => {
    const start = asDate(on);
    if (start > horizon) return;
    reminders.push({ name, kind, due: start < today ? today : start, unverified });
  };

  const necs = dated.filter((d) => d.formCode === "irs_1099_nec");
  if (necs.length > 0) {
    // One row for all the 1099s — five contractors would otherwise mean five
    // copies of the same date — on the earliest of them. The one case with no
    // contractor behind it is the "threshold not on file" row, whose count
    // nobody knows.
    const earliest = necs.reduce((a, b) => (b.dueOn < a.dueOn ? b : a));
    const n = necs.length;
    const unverified = necs.some((d) => d.basis !== "verified");
    const counted = necs.some((d) => d.vendorId);
    const name = counted
      ? `${n} 1099-NEC${n === 1 ? "" : "s"} to ${n === 1 ? "a contractor" : "contractors"}`
      : "1099-NECs to contractors";
    const dueWords = `1099-NEC${counted && n === 1 ? "" : "s"} due ${formatDueDate(asDate(earliest.dueOn), today)}`;
    reminders.push({
      name,
      kind: earliest.kind,
      due: asDate(earliest.dueOn),
      unverified,
      overdue: earliest.overdue,
      filingKey: `irs_1099_nec:${earliest.taxYear}`,
    });
    if (!earliest.overdue) {
      for (const key of ["send", "start"] as const) {
        const ms = necs.flatMap((d) => d.milestones.filter((m) => m.key === key));
        if (ms.length === 0) continue;
        const k = ms.length;
        const label = k === 1 ? ms[0].label : key === "send" ? `Send ${k} 1099-NECs to your accountant` : `Start ${k} 1099-NECs`;
        nudge(ms.map((m) => m.on).sort()[0], label, dueWords, unverified);
      }
    }
  }

  for (const d of dated) {
    if (d.formCode === "irs_1099_nec") continue;
    const unverified = d.basis !== "verified";
    reminders.push({ name: d.name, kind: d.kind, due: asDate(d.dueOn), unverified, overdue: d.overdue, filingKey: d.key });
    if (d.overdue) continue;
    for (const m of d.milestones) {
      nudge(m.on, m.label, `${d.name} due ${formatDueDate(asDate(d.dueOn), today)}`, unverified);
    }
  }

  // W-9s are far easier to collect before January's 1099s than during them.
  if (contractorsMissingW9 > 0) {
    const dec1 = new Date(today.getFullYear(), 11, 1);
    reminders.push({
      name: `Collect ${contractorsMissingW9} W-9${contractorsMissingW9 === 1 ? "" : "s"}`,
      kind: "Contractors paid this year without one on file",
      due: dec1 < today ? today : dec1,
    });
  }

  if (lastAccessReviewAt !== undefined) {
    // Calendar days, not 90×24h — the latter drifts an hour across a DST
    // change and can land on the previous date.
    const last = lastAccessReviewAt ? new Date(lastAccessReviewAt) : null;
    const next = last
      ? new Date(last.getFullYear(), last.getMonth(), last.getDate() + ACCESS_REVIEW_INTERVAL_DAYS)
      : today;
    // Overdue reads as due today rather than dropping off the list.
    const due = next < today ? today : next;
    if (due <= horizon) {
      reminders.push({
        name: lastAccessReviewAt ? "Access review" : "First access review",
        kind: "Confirm who can see the books",
        due,
      });
    }
  }

  return reminders.sort((a, b) => a.due.getTime() - b.due.getTime());
}

/**
 * The soonest tax filing among the reminders, for the Next-filing tile. Picked
 * by key, never by display name: the grouped 1099 row's name carries a count.
 * An overdue filing sorts first, so it is the "next" one until it's done.
 */
export function nextFilingReminder(reminders: Reminder[]): Reminder | null {
  return reminders.find((r) => r.filingKey !== undefined) ?? null;
}
