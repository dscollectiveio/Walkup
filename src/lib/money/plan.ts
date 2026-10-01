import { budgetStatus, type BudgetStatus, type Forecast } from "./budget";
import { monthKey, monthsBetween } from "./months";

/**
 * Pure helpers for the Budget & spending page's main list. Integer cents in,
 * plain words out; nothing here reads the database.
 */

export interface PlanRow {
  accountId: string;
  name: string;
  spentCents: number;
  /** This period's share of the annual budget. */
  targetCents: number;
  annualCents: number;
  status: BudgetStatus;
  pctOver: number;
  /** Target minus spent; negative when over. */
  leftCents: number;
}

const RANK: Record<BudgetStatus, number> = { over: 0, watch: 1, on_track: 2 };

/**
 * One row per budgeted category, worst first: over budget (most over first),
 * then watch, then on track by how much of the target is used, then
 * untouched categories alphabetically. Good news goes last.
 */
export function buildPlanRows(
  annualByAccount: Map<string, number>,
  spentByAccount: Map<string, number>,
  nameOf: (accountId: string) => string,
  budgetShare: number,
): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const [accountId, annualCents] of annualByAccount) {
    const targetCents = Math.round(annualCents * budgetShare);
    const spentCents = spentByAccount.get(accountId) ?? 0;
    const { status, pctOver } = budgetStatus(spentCents, targetCents);
    rows.push({
      accountId,
      name: nameOf(accountId),
      spentCents,
      targetCents,
      annualCents,
      status,
      pctOver,
      leftCents: targetCents - spentCents,
    });
  }
  return rows.sort((a, b) => {
    if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status];
    if (a.status !== "on_track") return b.pctOver - a.pctOver;
    const aUsed = a.targetCents > 0 ? a.spentCents / a.targetCents : 0;
    const bUsed = b.targetCents > 0 ? b.spentCents / b.targetCents : 0;
    if (a.spentCents > 0 !== b.spentCents > 0) return a.spentCents > 0 ? -1 : 1;
    if (aUsed !== bUsed) return bUsed - aUsed;
    return a.name.localeCompare(b.name);
  });
}

/**
 * How far through the period we are, 0..1 — where the pace marker sits on
 * each bar. A finished period is 1; a period that hasn't started is 0.
 */
export function paceShare(startKey: string, endKey: string, today: Date): number {
  const months = monthsBetween(startKey, endKey);
  if (months.length === 0) return 1;
  const current = monthKey(today);
  if (current > endKey) return 1;
  if (current < startKey) return 0;
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const fractionOfMonth = today.getDate() / daysInMonth;
  const before = months.filter((m) => m < current).length;
  return Math.min(1, (before + fractionOfMonth) / months.length);
}

const dollars = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Math.round(cents / 100),
  );

export interface PlanHeadlineInput {
  periodLabel: string;
  isFiscalYear: boolean;
  spentCents: number;
  targetCents: number;
  forecast: Forecast | null;
  rows: PlanRow[];
}

/** The one sentence at the top: are we spending what we planned, and if not, where. */
export function planHeadline(input: PlanHeadlineInput): {
  status: "good" | "attention" | "bad";
  headline: string;
  detail?: string;
} {
  const { status } = budgetStatus(input.spentCents, input.targetCents);
  const tone: "good" | "attention" | "bad" = status === "over" ? "bad" : status === "watch" ? "attention" : "good";
  const worst = input.rows.find((r) => r.status !== "on_track");
  const watchWord = worst
    ? `${worst.name} is the one to watch — ${dollars(-worst.leftCents)} over its share.`
    : undefined;

  if (input.isFiscalYear && input.forecast) {
    const f = input.forecast;
    const near = Math.abs(f.overUnderCents) < 10000;
    const headline = near
      ? `${input.periodLabel} so far: ${dollars(input.spentCents)} spent of ${dollars(input.targetCents)} planned — on pace to finish right on budget.`
      : `${input.periodLabel} so far: ${dollars(input.spentCents)} spent of ${dollars(input.targetCents)} planned — on pace to finish about ${dollars(Math.abs(f.overUnderCents))} ${f.overUnderCents > 0 ? "over" : "under"}.`;
    const driver = f.driver
      ? `${f.driverIsMost ? (f.overUnderCents > 0 ? "Almost all of it" : "Most of the room") : "The biggest part"} is ${f.driver.name.toLowerCase()}.`
      : undefined;
    return {
      status: near ? "good" : f.overUnderCents > 0 ? (tone === "good" ? "attention" : tone) : "good",
      headline,
      detail: driver ?? watchWord,
    };
  }

  const diff = input.spentCents - input.targetCents;
  const tail =
    status === "on_track"
      ? diff < -100
        ? `${dollars(-diff)} under plan`
        : "on plan"
      : `${dollars(diff)} over plan`;
  return {
    status: tone,
    headline: `${input.periodLabel}: ${dollars(input.spentCents)} spent of ${dollars(input.targetCents)} planned — ${tail}.`,
    detail: watchWord,
  };
}

/** Categories past the 10% band, for Home's "Worth a minute" strip. */
export function overBudgetAlerts(rows: PlanRow[]): { name: string; overCents: number }[] {
  return rows
    .filter((r) => r.status === "over" && r.leftCents < 0)
    .map((r) => ({ name: r.name, overCents: -r.leftCents }))
    .sort((a, b) => b.overCents - a.overCents);
}

/** A whole-dollar annual figure to propose when a category was spent on with no plan. */
export function suggestAnnualFromSpend(spentCents: number, budgetShare: number): number {
  if (spentCents <= 0 || budgetShare <= 0) return 0;
  const annual = spentCents / budgetShare;
  return Math.round(annual / 1000) * 1000; // nearest $10
}
