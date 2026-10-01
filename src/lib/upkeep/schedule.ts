/**
 * Pure date rules for the upkeep schedule: when a task comes due next, how
 * to describe its state, and a starter checklist for a small walk-up.
 * ISO dates in, ISO dates out; no database.
 */

export type UpkeepStatus = "overdue" | "due_soon" | "scheduled";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const parts = (s: string) => s.slice(0, 10).split("-").map(Number) as [number, number, number];

/**
 * Next due date after a task was done. Add the interval; if the task has a
 * preferred month, land on the 1st of that month in the first year it falls
 * on or after the interval date — a September boiler service done late in
 * October still comes back the following September, not in October.
 */
export function nextDueAfter(doneOn: string, intervalMonths: number, dueMonth: number | null): string {
  const [y, m, d] = parts(doneOn);
  const after = new Date(y, m - 1 + intervalMonths, Math.min(d, 28));
  if (!dueMonth) return iso(after.getFullYear(), after.getMonth(), after.getDate());
  // Snap to the preferred month nearest the interval date: a September job
  // done late in October still comes back the following September (11
  // months on), while one done early in July waits for September.
  const targetMonth = dueMonth - 1;
  const diff = targetMonth - after.getMonth();
  const year = diff < -intervalMonths / 2 ? after.getFullYear() + 1 : after.getFullYear();
  return iso(year, targetMonth, 1);
}

/** First due date for a brand-new task: the preferred month next time it comes around, else today. */
export function initialNextDue(todayIso: string, dueMonth: number | null): string {
  const [y, m] = parts(todayIso);
  if (!dueMonth) return todayIso.slice(0, 10);
  const targetMonth = dueMonth - 1;
  const year = targetMonth >= m - 1 ? y : y + 1;
  return iso(year, targetMonth, 1);
}

export function statusFor(nextDueOn: string, todayIso: string, soonDays = 60): UpkeepStatus {
  const days = Math.round((new Date(`${nextDueOn.slice(0, 10)}T00:00:00`).getTime() - new Date(`${todayIso.slice(0, 10)}T00:00:00`).getTime()) / 86_400_000);
  if (days < 0) return "overdue";
  if (days <= soonDays) return "due_soon";
  return "scheduled";
}

export function daysUntil(dateIso: string, todayIso: string): number {
  return Math.round((new Date(`${dateIso.slice(0, 10)}T00:00:00`).getTime() - new Date(`${todayIso.slice(0, 10)}T00:00:00`).getTime()) / 86_400_000);
}

/** "every year", "every 6 months", "every 2 years" — plus the month when there is one. */
export function cadenceWords(intervalMonths: number, dueMonth: number | null): string {
  const base =
    intervalMonths === 12
      ? "every year"
      : intervalMonths === 1
        ? "every month"
        : intervalMonths % 12 === 0
          ? `every ${intervalMonths / 12} years`
          : `every ${intervalMonths} months`;
  return dueMonth ? `${base}, in ${MONTHS[dueMonth - 1]}` : base;
}

export const MONTH_NAMES = MONTHS;

export interface UpkeepTemplate {
  name: string;
  description: string;
  interval_months: number;
  due_month: number | null;
}

/**
 * The usual checklist for a small Chicago-style walk-up. Offered, never
 * inserted on its own; the board ticks what applies.
 */
export const UPKEEP_TEMPLATES: UpkeepTemplate[] = [
  { name: "Boiler / furnace service", description: "Annual clean and safety check before the heating season.", interval_months: 12, due_month: 9 },
  { name: "Gutters and downspouts cleared", description: "After the leaves are down, before the freeze.", interval_months: 12, due_month: 11 },
  { name: "Backflow preventer test", description: "Annual test by a licensed plumber; the city asks for the certificate.", interval_months: 12, due_month: 6 },
  { name: "Sewer line rodded", description: "Preventive rodding of the main line — cheaper than a backup.", interval_months: 12, due_month: 4 },
  { name: "Roof and flashing inspection", description: "Look for lifted seams, ponding and flashing gaps after winter.", interval_months: 12, due_month: 4 },
  { name: "Smoke and CO detector batteries", description: "Common-area detectors; remind owners about theirs.", interval_months: 6, due_month: null },
  { name: "Fire extinguisher inspection", description: "Annual tag; replace or recharge as needed.", interval_months: 12, due_month: null },
  { name: "Dryer vent cleaning", description: "Lint in a shared vent is a fire risk.", interval_months: 12, due_month: null },
  { name: "Sump / ejector pump check", description: "Run it, check the float, before spring rains.", interval_months: 12, due_month: 3 },
  { name: "Water heater flush", description: "Drain sediment; check the relief valve.", interval_months: 12, due_month: null },
  { name: "Tuckpointing and masonry check", description: "Walk the exterior for open joints and spalling brick.", interval_months: 24, due_month: 5 },
  { name: "Exterior wood and paint check", description: "Porches, trim, railings — catch rot early.", interval_months: 36, due_month: 6 },
  { name: "Snow removal arranged", description: "Confirm the contract or rota before the first snow.", interval_months: 12, due_month: 10 },
  { name: "Landscaping / lawn arranged", description: "Confirm the season's service before it starts.", interval_months: 12, due_month: 3 },
];
