// Deadline assembly for the home page's "Coming up" section. Extracted from
// page.tsx so the logic is one place and plain-testable.

export interface Reminder {
  name: string;
  kind: string;
  due: Date;
  // Compliance dates the app computes but nobody has verified against this
  // year's instructions. Stale legal information is worse than absent legal
  // information, so these say so instead of reading as authoritative.
  unverified?: boolean;
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

interface ReminderInputs {
  association: {
    state_code: string;
    fiscal_year_end_month: number | null;
    incorporated_on: string | null;
  };
  bills: { name: string; next_due_on: string | null; autopay_arranged: boolean }[];
  policies: { coverage: string; effective_to: string; renewal_reminder_days?: number | null }[];
  upcomingChargeDates: string[]; // due_on of open/partial charges after today
  today: Date;
  /**
   * Board admins only: when the last access review was recorded (null =
   * never). Omit for everyone else — the reminder is theirs to act on.
   */
  lastAccessReviewAt?: string | null;
  /**
   * Due dates from verified official-form templates (lib/tax/due-rules),
   * keyed by form code. When one exists it replaces the built-in estimate
   * below and is no longer marked unverified.
   */
  verifiedTaxDeadlines?: Partial<Record<"irs_1120h" | "irs_1099_nec" | "il_sos_annual_report", string>>;
  /** Contractors paid this calendar year with no W-9 on file — nudged every December 1. */
  contractorsMissingW9?: number;
}

export function assembleReminders({
  association,
  bills,
  policies,
  upcomingChargeDates,
  today,
  lastAccessReviewAt,
  verifiedTaxDeadlines = {},
  contractorsMissingW9 = 0,
}: ReminderInputs): Reminder[] {
  const reminders: Reminder[] = [];
  const horizon = new Date(today.getTime() + 120 * 86400000);

  for (const b of bills) {
    if (b.autopay_arranged || !b.next_due_on) continue;
    const due = new Date(`${b.next_due_on}T00:00:00`);
    if (due >= today && due <= horizon) {
      reminders.push({ name: b.name, kind: "Bill to pay by hand", due });
    }
  }

  const renewals = policies
    .map((p) => ({
      coverage: p.coverage,
      due: new Date(`${p.effective_to}T00:00:00`),
      leadDays: p.renewal_reminder_days ?? 60,
    }))
    .filter((p) => p.due >= today)
    .sort((a, b) => a.due.getTime() - b.due.getTime());
  const nextRenewal = renewals.find((p) => p.due <= horizon);
  if (nextRenewal) {
    reminders.push({
      name: "Insurance renewal",
      kind: String(nextRenewal.coverage).replace(/_/g, " "),
      due: nextRenewal.due,
    });
  }
  // The board's own lead time (renewal_reminder_days, per policy) is when to
  // start shopping — overdue reads as today, like the access review below.
  for (const r of renewals) {
    const start = new Date(r.due.getFullYear(), r.due.getMonth(), r.due.getDate() - r.leadDays);
    const due = start < today ? today : start;
    if (due > horizon) continue;
    const kind = r.coverage === "property" ? "master" : String(r.coverage).replace(/_/g, " ");
    reminders.push({
      name: "Get insurance quotes",
      kind: `Your ${kind} policy renews on ${formatDueDate(r.due, today)}. This is a good time to get quotes.`,
      due,
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

  // Tax deadlines. A verified official-form template carries a cited due rule
  // (lib/tax/due-rules); until one exists for a form, the built-in estimate
  // is shown and labeled unverified — stale legal information is worse than
  // absent, so it says so rather than reading as authoritative.
  const verified = (code: keyof typeof verifiedTaxDeadlines) => {
    const iso = verifiedTaxDeadlines[code];
    return iso ? new Date(`${iso}T00:00:00`) : null;
  };
  const fyEndMonth = association.fiscal_year_end_month ?? 12;
  const due1120hMonth = ((fyEndMonth + 3) % 12) + 1;
  const d1120h = verified("irs_1120h");
  reminders.push({
    name: "Form 1120-H",
    kind: "Federal tax return",
    due: d1120h ?? nextOccurrence(due1120hMonth, 15, today),
    unverified: !d1120h,
  });
  const d1099 = verified("irs_1099_nec");
  reminders.push({
    name: "1099-NEC to contractors",
    kind: "Federal filing",
    due: d1099 ?? nextOccurrence(1, 31, today),
    unverified: !d1099,
  });

  // Only shown when the state matches and the incorporation date exists —
  // implying coverage of other states would be worse than staying quiet.
  if (association.state_code === "IL" && association.incorporated_on) {
    const inc = new Date(`${association.incorporated_on}T00:00:00`);
    const dSos = verified("il_sos_annual_report");
    reminders.push({
      name: "Illinois annual report",
      kind: "Filed on the incorporation anniversary",
      due: dSos ?? nextOccurrence(inc.getMonth() + 1, inc.getDate(), today),
      unverified: !dSos,
    });
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
