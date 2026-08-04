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
  policies: { coverage: string; effective_to: string }[];
  upcomingChargeDates: string[]; // due_on of open/partial charges after today
  today: Date;
}

export function assembleReminders({
  association,
  bills,
  policies,
  upcomingChargeDates,
  today,
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

  const nextRenewal = policies
    .map((p) => ({ coverage: p.coverage, due: new Date(`${p.effective_to}T00:00:00`) }))
    .filter((p) => p.due >= today && p.due <= horizon)
    .sort((a, b) => a.due.getTime() - b.due.getTime())[0];
  if (nextRenewal) {
    reminders.push({
      name: "Insurance renewal",
      kind: String(nextRenewal.coverage).replace(/_/g, " "),
      due: nextRenewal.due,
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

  // Federal filing dates, computed rather than read from tax_parameters —
  // that table holds numerics, and "the 15th day of the 4th month after the
  // fiscal year ends" is a rule, not a number. Labeled unverified for the
  // same reason every other tax figure in this app is provisional.
  const fyEndMonth = association.fiscal_year_end_month ?? 12;
  const due1120hMonth = ((fyEndMonth + 3) % 12) + 1;
  reminders.push({
    name: "Form 1120-H",
    kind: "Federal tax return",
    due: nextOccurrence(due1120hMonth, 15, today),
    unverified: true,
  });
  reminders.push({
    name: "1099-NEC to contractors",
    kind: "Federal filing",
    due: nextOccurrence(1, 31, today),
    unverified: true,
  });

  // The one state rule on record. Only shown when the state matches and the
  // incorporation date exists — implying coverage of other states would be
  // worse than staying quiet.
  if (association.state_code === "IL" && association.incorporated_on) {
    const inc = new Date(`${association.incorporated_on}T00:00:00`);
    reminders.push({
      name: "Illinois annual report",
      kind: "Filed on the incorporation anniversary",
      due: nextOccurrence(inc.getMonth() + 1, inc.getDate(), today),
      unverified: true,
    });
  }

  return reminders.sort((a, b) => a.due.getTime() - b.due.getTime());
}
