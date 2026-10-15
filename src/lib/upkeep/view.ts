// What the upkeep view and task page say about a task (repairs-spec §12.2,
// §12.3): the when-pill, the groups, the filter, the headline answer and
// the history totals. Pure; client components import it.

import { toCents, fromCents } from "@/lib/tax/form1120h";
import { humanDate, moneyText } from "@/lib/repairs/format";
import { anchorMonths, daysUntil, endOfMonth, MONTH_NAMES, statusFor, type UpkeepStatus } from "./schedule";

export type UpkeepShow = "all" | "overdue" | "soon";

export function parseUpkeepShow(v: string | undefined): UpkeepShow {
  return v === "overdue" || v === "soon" ? v : "all";
}

/** The 60-day window the "Next 60 days" group and filter use. */
export const SOON_DAYS = 60;

export type WhenTone = "bad" | "warning" | "neutral";

/**
 * "12 days overdue" / "due today" / "due in October" (a seasonal task whose
 * due date is its month's end, more than 7 days away) / "due Thu, Oct 22".
 */
export function whenLabel(nextDueOn: string, dueMonth: number | null, todayIso: string): { text: string; tone: WhenTone; status: UpkeepStatus } {
  const status = statusFor(nextDueOn, todayIso, SOON_DAYS);
  const days = daysUntil(nextDueOn, todayIso);
  const tone: WhenTone = status === "overdue" ? "bad" : status === "due_soon" ? "warning" : "neutral";
  if (days < 0) {
    const n = Math.abs(days);
    return { text: `${n} ${n === 1 ? "day" : "days"} overdue`, tone, status };
  }
  if (days === 0) return { text: "due today", tone, status };
  const [y, m] = nextDueOn.slice(0, 10).split("-").map(Number);
  if (dueMonth !== null && days > 7 && nextDueOn.slice(0, 10) === endOfMonth(y, m)) {
    return { text: `due in ${MONTH_NAMES[m - 1]}`, tone, status };
  }
  return { text: `due ${humanDate(nextDueOn, todayIso)}`, tone, status };
}

/** "Due in April and October." for the task form's month hint; null for once-a-year or longer. */
export function monthsHint(intervalMonths: number, dueMonth: number | null): string | null {
  if (dueMonth === null || intervalMonths >= 12) return null;
  const months = anchorMonths(intervalMonths, dueMonth).map((m) => MONTH_NAMES[m - 1]);
  if (months.length <= 1) return null;
  return `Due in ${months.length === 2 ? months.join(" and ") : `${months.slice(0, -1).join(", ")} and ${months[months.length - 1]}`}.`;
}

export interface Groupable {
  next_due_on: string;
}

export function groupUpkeep<T extends Groupable>(tasks: T[], todayIso: string): { overdue: T[]; soon: T[]; later: T[] } {
  const out = { overdue: [] as T[], soon: [] as T[], later: [] as T[] };
  for (const t of tasks) {
    const s = statusFor(t.next_due_on, todayIso, SOON_DAYS);
    if (s === "overdue") out.overdue.push(t);
    else if (s === "due_soon") out.soon.push(t);
    else out.later.push(t);
  }
  return out;
}

/** The view's headline (same logic as before: overdue / coming up in 60 days / all good). */
export function upkeepAnswer(tasks: { name: string; next_due_on: string }[], todayIso: string): {
  status: "attention" | "neutral" | "good";
  headline: string;
  detail: string;
} | null {
  if (tasks.length === 0) return null;
  const { overdue, soon } = groupUpkeep(tasks, todayIso);
  if (overdue.length > 0) {
    return {
      status: "attention",
      headline: `${overdue.length} ${overdue.length === 1 ? "job is" : "jobs are"} overdue`,
      detail: overdue.map((t) => t.name).join(" · "),
    };
  }
  if (soon.length > 0) {
    return {
      status: "neutral",
      headline: `${soon.length} ${soon.length === 1 ? "job" : "jobs"} coming up in the next two months`,
      detail: soon.map((t) => `${t.name} (${humanDate(t.next_due_on, todayIso)})`).join(" · "),
    };
  }
  return { status: "good", headline: "Nothing due for a couple of months", detail: "The schedule is up to date." };
}

/** "Done 4 times since 2022 · $960 in all" (cents arithmetic); null when never done. */
export function historyTotals(log: { done_on: string; cost: string | null }[], showMoney: boolean): string | null {
  if (log.length === 0) return null;
  const first = log.map((l) => l.done_on.slice(0, 4)).sort()[0];
  const n = log.length;
  const cents = log.reduce((s, l) => s + (l.cost ? toCents(l.cost) : 0), 0);
  const times = `Done ${n === 1 ? "once" : `${n} times`} since ${first}`;
  if (!showMoney) return times;
  return `${times} · ${moneyText(fromCents(cents))} in all`;
}

/** The intervals the task form offers, with their words. */
export const INTERVAL_OPTIONS: { months: number; label: string }[] = [
  { months: 1, label: "Every month" },
  { months: 2, label: "Every 2 months" },
  { months: 3, label: "Every 3 months" },
  { months: 4, label: "Every 4 months" },
  { months: 6, label: "Every 6 months" },
  { months: 12, label: "Every year" },
  { months: 24, label: "Every 2 years" },
  { months: 36, label: "Every 3 years" },
  { months: 60, label: "Every 5 years" },
];
