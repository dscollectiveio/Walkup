/**
 * Pure date rules for the upkeep schedule: when a task comes due next, how
 * to describe its state, and a starter checklist for a small walk-up.
 * ISO dates in, ISO dates out; no database. nextDueAfter mirrors
 * public.upkeep_next_due (0053) exactly; tests/fixtures/upkeep-cases.ts holds
 * the worked examples both are tested against (repairs-spec §4.13).
 */

export type UpkeepStatus = "overdue" | "due_soon" | "scheduled";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const pad2 = (n: number) => String(n).padStart(2, "0");
const parts = (s: string) => s.slice(0, 10).split("-").map(Number) as [number, number, number];

function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** The intervals the task form offers (and add_upkeep_task accepts), in months. */
export const UPKEEP_INTERVALS = [1, 2, 3, 4, 6, 12, 24, 36, 60] as const;

/** A preferred month only makes sense when the interval divides a year (2, 3, 4, 6) or is whole years. */
export function allowsDueMonth(intervalMonths: number): boolean {
  return [2, 3, 4, 6].includes(intervalMonths) || (intervalMonths > 0 && intervalMonths % 12 === 0);
}

/** Add months, clamping the day to the target month's last day: Jan 31 + 1 = Feb 28 (Feb 29 in a leap year). */
export function addMonthsClamped(dateIso: string, months: number): string {
  const [y, m, d] = parts(dateIso);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return `${year}-${pad2(month)}-${pad2(Math.min(d, daysInMonth(year, month)))}`;
}

/** The last day of a month, as YYYY-MM-DD. */
export function endOfMonth(year: number, month1to12: number): string {
  return `${year}-${pad2(month1to12)}-${pad2(daysInMonth(year, month1to12))}`;
}

/**
 * The months a seasonal task falls in, ascending: the preferred month and,
 * when the interval divides a year, every interval after it.
 * (6, 4) -> [4, 10]; (3, 1) -> [1, 4, 7, 10]; (24, 5) -> [5].
 */
export function anchorMonths(intervalMonths: number, dueMonth: number): number[] {
  if (intervalMonths < 12 && intervalMonths > 0 && 12 % intervalMonths === 0) {
    const out: number[] = [];
    for (let k = 0; k < 12 / intervalMonths; k++) out.push(((dueMonth - 1 + k * intervalMonths) % 12) + 1);
    return out.sort((a, b) => a - b);
  }
  return [dueMonth];
}

/**
 * Next due date after a task was done. Mirrors public.upkeep_next_due:
 * without a preferred month, add the interval (month-end clamp). With one,
 * due dates are month-ends of the anchor months, and the next one is the
 * first anchor month-end on or after done + interval - half a cycle (a cycle
 * is min(interval, 12) months). That picks the anchor nearest to done +
 * interval, so an early or late completion keeps the task on its season.
 */
export function nextDueAfter(doneOn: string, intervalMonths: number, dueMonth: number | null): string {
  // The SQL returns null below 1; a string-typed caller gets a one-month step instead.
  const interval = Number.isFinite(intervalMonths) ? Math.max(1, Math.floor(intervalMonths)) : 1;
  if (!dueMonth) return addMonthsClamped(doneOn, interval);
  const step = Math.min(interval, 12);
  const lower = addMonthsClamped(doneOn, interval - Math.floor(step / 2));
  const monthEnd = (iso: string) => {
    const [y, m] = parts(iso);
    return endOfMonth(y, m);
  };
  let anchor = `${parts(lower)[0] - 1}-${pad2(dueMonth)}-01`;
  let due = monthEnd(anchor);
  while (due < lower) {
    anchor = addMonthsClamped(anchor, step);
    due = monthEnd(anchor);
  }
  return due;
}

/**
 * First due date for a new task. With a last-done date: nextDueAfter it.
 * Without a preferred month: one month from today. With one: the first
 * anchor month-end on or after today (a task added in its own month is due
 * by the end of it, not overdue).
 */
export function initialNextDue(todayIso: string, intervalMonths: number, dueMonth: number | null, lastDoneOn?: string | null): string {
  if (lastDoneOn) return nextDueAfter(lastDoneOn, intervalMonths, dueMonth);
  const today = todayIso.slice(0, 10);
  if (!dueMonth) return addMonthsClamped(today, 1);
  const [y] = parts(today);
  const anchors = anchorMonths(intervalMonths, dueMonth);
  for (const year of [y, y + 1]) {
    for (const m of anchors) {
      const end = endOfMonth(year, m);
      if (end >= today) return end;
    }
  }
  return endOfMonth(y + 1, anchors[0]);
}

export function statusFor(nextDueOn: string, todayIso: string, soonDays = 60): UpkeepStatus {
  const days = daysUntil(nextDueOn, todayIso);
  // An unreadable date must not look like "scheduled": surface it as needing attention.
  if (!Number.isFinite(days) || days < 0) return "overdue";
  if (days <= soonDays) return "due_soon";
  return "scheduled";
}

export function daysUntil(dateIso: string, todayIso: string): number {
  return Math.round((new Date(`${dateIso.slice(0, 10)}T00:00:00`).getTime() - new Date(`${todayIso.slice(0, 10)}T00:00:00`).getTime()) / 86_400_000);
}

function joinWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * "every year", "every 6 months", "every 2 years", plus the months when there
 * is a preferred one: "every 6 months, in April and October".
 */
export function cadenceWords(intervalMonths: number, dueMonth: number | null): string {
  const base =
    intervalMonths === 12
      ? "every year"
      : intervalMonths === 1
        ? "every month"
        : intervalMonths % 12 === 0
          ? `every ${intervalMonths / 12} years`
          : `every ${intervalMonths} months`;
  if (!dueMonth) return base;
  return `${base}, in ${joinWords(anchorMonths(intervalMonths, dueMonth).map((m) => MONTHS[m - 1]))}`;
}

export const MONTH_NAMES = MONTHS;

export interface UpkeepTemplate {
  name: string;
  description: string;
  interval_months: number;
  due_month: number | null;
  /** Trade slug for "Find someone" (src/lib/contractors/trades.ts). */
  trade: string;
  /** Plain words for a contractor search; every word is in REPAIR_VOCABULARY. */
  searchPhrase: string;
  /** Ticked by default; unticked ones show under "Only if your building has one". */
  defaultChecked: boolean;
}

/**
 * The usual checklist for a small Chicago-style walk-up. Offered, never
 * inserted on its own; the board ticks what applies. Existing tasks match a
 * template by name, so names don't change.
 */
export const UPKEEP_TEMPLATES: UpkeepTemplate[] = [
  { name: "Boiler / furnace service", description: "Annual clean and safety check before the heating season.", interval_months: 12, due_month: 9, trade: "hvac", searchPhrase: "boiler service", defaultChecked: true },
  { name: "Gutters and downspouts cleared", description: "After the leaves are down, before the freeze.", interval_months: 12, due_month: 11, trade: "gutters", searchPhrase: "gutter cleaning", defaultChecked: true },
  { name: "Backflow preventer test", description: "Annual test by a licensed plumber. Many cities ask for the certificate; check yours.", interval_months: 12, due_month: 6, trade: "backflow", searchPhrase: "backflow testing", defaultChecked: true },
  { name: "Sewer line rodded", description: "Preventive rodding of the main line, so a clog does not become a backup.", interval_months: 12, due_month: 4, trade: "sewer", searchPhrase: "sewer rodding", defaultChecked: true },
  { name: "Roof and flashing inspection", description: "Look for lifted seams, ponding and flashing gaps after winter.", interval_months: 12, due_month: 4, trade: "roofing", searchPhrase: "roof inspection", defaultChecked: true },
  { name: "Smoke and CO detector batteries", description: "Common-area detectors; remind owners about theirs.", interval_months: 6, due_month: null, trade: "fire_safety", searchPhrase: "smoke detector service", defaultChecked: true },
  { name: "Fire extinguisher inspection", description: "Annual tag; replace or recharge as needed.", interval_months: 12, due_month: null, trade: "fire_safety", searchPhrase: "fire extinguisher inspection", defaultChecked: true },
  { name: "Dryer vent cleaning", description: "Lint in a shared vent is a fire risk.", interval_months: 12, due_month: null, trade: "dryer_vent", searchPhrase: "dryer vent cleaning", defaultChecked: true },
  { name: "Sump / ejector pump check", description: "Run it, check the float, before spring rains.", interval_months: 12, due_month: 3, trade: "plumbing", searchPhrase: "sump pump service", defaultChecked: true },
  { name: "Water heater flush", description: "Drain sediment; check the relief valve.", interval_months: 12, due_month: null, trade: "plumbing", searchPhrase: "water heater service", defaultChecked: true },
  { name: "Tuckpointing and masonry check", description: "Walk the exterior for open joints and spalling brick.", interval_months: 24, due_month: 5, trade: "masonry", searchPhrase: "tuckpointing", defaultChecked: true },
  { name: "Exterior wood and paint check", description: "Porches, trim, railings: catch rot early.", interval_months: 36, due_month: 6, trade: "painting", searchPhrase: "exterior painting", defaultChecked: true },
  { name: "Snow removal arranged", description: "Confirm the contract or rota before the first snow.", interval_months: 12, due_month: 10, trade: "snow", searchPhrase: "snow removal", defaultChecked: true },
  { name: "Landscaping / lawn arranged", description: "Confirm the season's service before it starts.", interval_months: 12, due_month: 3, trade: "landscaping", searchPhrase: "lawn care", defaultChecked: true },
  { name: "Chimney and flue inspection", description: "Sweep and check the flues before the heating season.", interval_months: 12, due_month: 8, trade: "chimney", searchPhrase: "chimney inspection", defaultChecked: false },
  { name: "Tree trimming check", description: "Look for dead limbs over the roof, wires and walkways while the leaves are down.", interval_months: 24, due_month: 2, trade: "tree", searchPhrase: "tree trimming", defaultChecked: false },
  { name: "Elevator maintenance check", description: "Confirm the service visits happened and the inspection certificate is current.", interval_months: 12, due_month: null, trade: "elevator", searchPhrase: "elevator maintenance", defaultChecked: false },
  { name: "Window washing", description: "Outside glass the owners can't reach safely.", interval_months: 12, due_month: 5, trade: "windows", searchPhrase: "window washing", defaultChecked: false },
];

/** The template a task was made from, matched by name (case-insensitive), or null. */
export function templateForName(name: string): UpkeepTemplate | null {
  const key = name.trim().toLowerCase();
  return UPKEEP_TEMPLATES.find((t) => t.name.toLowerCase() === key) ?? null;
}
