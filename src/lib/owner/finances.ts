/**
 * The owner Finances page (migration 0079): the shape owner_finances_summary() returns, a strict parser for
 * it, and the plain words the page uses. Pure, so it is unit-tested without a database or a DOM.
 *
 * Money crosses the API as text and is only ever added or compared in integer cents (DECISIONS #20). A
 * figure that is not a plain decimal makes the whole summary unreadable (null), which the page shows as "we
 * couldn't load this", never as a guessed number. No em dashes in any copy here.
 */
import { fromCents, toCents } from "@/lib/money/cents";

export interface FinancePeriod {
  label: string;
  startsOn: string;
  endsOn: string;
  /** False when nothing was posted in the period, so the page says so instead of showing zeros. */
  hasActivity: boolean;
  income: string;
  expenses: string;
  net: string;
}

export interface FinanceCash {
  asOf: string;
  hasData: boolean;
  hasReserveFund: boolean;
  operating: string;
  reserve: string;
}

export interface FinanceBudgetLine {
  name: string;
  type: "income" | "expense";
  budget: string;
  actual: string;
}

export interface FinanceBudget {
  fiscalYear: string;
  daysElapsed: number;
  daysTotal: number;
  incomeBudget: string;
  incomeActual: string;
  expenseBudget: string;
  expenseActual: string;
  lines: FinanceBudgetLine[];
}

export interface OwnerFinances {
  asOf: string;
  postedThrough: string | null;
  yearToDate: FinancePeriod | null;
  lastYear: FinancePeriod | null;
  cash: FinanceCash | null;
  budget: FinanceBudget | null;
}

const MONEY = /^-?\d+(\.\d{1,2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const money = (v: unknown): string | null => (typeof v === "string" && MONEY.test(v) ? v : null);
const date = (v: unknown): string | null => (typeof v === "string" && ISO_DATE.test(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const wholeNumber = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

function parsePeriod(raw: unknown): FinancePeriod | null | "bad" {
  if (raw === null || raw === undefined) return null;
  const o = obj(raw);
  if (!o) return "bad";
  const label = text(o.label);
  const startsOn = date(o.starts_on);
  const endsOn = date(o.ends_on);
  const income = money(o.income);
  const expenses = money(o.expenses);
  const net = money(o.net);
  if (!label || !startsOn || !endsOn || !income || !expenses || !net || typeof o.has_activity !== "boolean") return "bad";
  return { label, startsOn, endsOn, hasActivity: o.has_activity, income, expenses, net };
}

function parseCash(raw: unknown): FinanceCash | null | "bad" {
  if (raw === null || raw === undefined) return null;
  const o = obj(raw);
  if (!o) return "bad";
  const asOf = date(o.as_of);
  const operating = money(o.operating);
  const reserve = money(o.reserve);
  if (!asOf || !operating || !reserve || typeof o.has_data !== "boolean" || typeof o.has_reserve_fund !== "boolean") return "bad";
  return { asOf, hasData: o.has_data, hasReserveFund: o.has_reserve_fund, operating, reserve };
}

function parseBudget(raw: unknown): FinanceBudget | null | "bad" {
  if (raw === null || raw === undefined) return null;
  const o = obj(raw);
  if (!o) return "bad";
  const fiscalYear = text(o.fiscal_year);
  const daysElapsed = wholeNumber(o.days_elapsed);
  const daysTotal = wholeNumber(o.days_total);
  const incomeBudget = money(o.income_budget);
  const incomeActual = money(o.income_actual);
  const expenseBudget = money(o.expense_budget);
  const expenseActual = money(o.expense_actual);
  if (!fiscalYear || daysElapsed === null || !daysTotal || !incomeBudget || !incomeActual || !expenseBudget || !expenseActual) return "bad";
  const lines: FinanceBudgetLine[] = [];
  for (const l of Array.isArray(o.lines) ? o.lines : []) {
    const lo = obj(l);
    const name = lo ? text(lo.name) : null;
    const budget = lo ? money(lo.budget) : null;
    const actual = lo ? money(lo.actual) : null;
    if (!lo || !name || !budget || !actual || (lo.type !== "income" && lo.type !== "expense")) return "bad";
    lines.push({ name, type: lo.type, budget, actual });
  }
  return { fiscalYear, daysElapsed, daysTotal, incomeBudget, incomeActual, expenseBudget, expenseActual, lines };
}

/** The summary as the page uses it, or null when the database's answer is missing or malformed. */
export function parseOwnerFinances(raw: unknown): OwnerFinances | null {
  const o = obj(raw);
  if (!o) return null;
  const asOf = date(o.as_of);
  if (!asOf) return null;
  const yearToDate = parsePeriod(o.year_to_date);
  const lastYear = parsePeriod(o.last_year);
  const cash = parseCash(o.cash);
  const budget = parseBudget(o.budget);
  if (yearToDate === "bad" || lastYear === "bad" || cash === "bad" || budget === "bad") return null;
  const through = o.posted_through === null || o.posted_through === undefined ? null : date(o.posted_through);
  if (o.posted_through !== null && o.posted_through !== undefined && through === null) return null;
  return { asOf, postedThrough: through, yearToDate, lastYear, cash, budget };
}

/** "$12,345" (whole dollars, rounded half away from zero) from a money string. */
export function dollars(amount: string): string {
  const cents = toCents(amount);
  const whole = Math.round(Math.abs(cents) / 100);
  return `${cents < 0 && whole > 0 ? "-" : ""}$${whole.toLocaleString("en-US")}`;
}

/** What the net result of a period means, in a sentence. */
export function netWords(p: FinancePeriod): string {
  const net = toCents(p.net);
  if (net === 0) return "Income and spending came out even.";
  const gap = dollars(fromCents(Math.abs(net)));
  return net > 0 ? `The association took in ${gap} more than it spent.` : `The association spent ${gap} more than it took in.`;
}

export type SpendingStatus = "no_budget" | "under" | "on_track" | "watch" | "over";

/** Spending compared with the part of the budget that should be used by now (straight-line over the year). */
export function spendingPace(b: FinanceBudget): { status: SpendingStatus; expectedCents: number; actualCents: number; budgetCents: number } {
  const budgetCents = toCents(b.expenseBudget);
  const actualCents = toCents(b.expenseActual);
  if (budgetCents <= 0) return { status: "no_budget", expectedCents: 0, actualCents, budgetCents };
  const elapsed = Math.min(b.daysElapsed, b.daysTotal);
  const expectedCents = Math.round((budgetCents * elapsed) / b.daysTotal);
  let status: SpendingStatus;
  if (actualCents > budgetCents) status = "over";
  else if (expectedCents > 0 && actualCents * 100 > expectedCents * 110) status = "watch";
  else if (expectedCents > 0 && actualCents * 100 < expectedCents * 85) status = "under";
  else status = "on_track";
  return { status, expectedCents, actualCents, budgetCents };
}

/** The budget in plain words: one sentence about spending, one about income. */
export function budgetWords(b: FinanceBudget): { spending: string; income: string | null } {
  const pace = spendingPace(b);
  const d = (cents: number) => dollars(fromCents(cents));
  let spending: string;
  switch (pace.status) {
    case "no_budget":
      spending = `No spending budget has been set for ${b.fiscalYear}.`;
      break;
    case "over":
      spending = `Spending has passed the whole ${b.fiscalYear} budget: ${d(pace.actualCents)} spent against ${d(pace.budgetCents)} planned for the year.`;
      break;
    case "watch":
      spending = `Spending is running ahead of the budget: ${d(pace.actualCents)} spent so far, where about ${d(pace.expectedCents)} would be on pace.`;
      break;
    case "under":
      spending = `Spending is below the budget so far: ${d(pace.actualCents)} spent, where about ${d(pace.expectedCents)} would be on pace.`;
      break;
    default:
      spending = `Spending is on track with the budget: ${d(pace.actualCents)} spent so far, where about ${d(pace.expectedCents)} would be on pace.`;
  }
  const incomeBudget = toCents(b.incomeBudget);
  let income: string | null = null;
  if (incomeBudget > 0) {
    const incomeActual = toCents(b.incomeActual);
    income = `Income so far is ${d(incomeActual)} of the ${d(incomeBudget)} planned for the year.`;
  }
  return { spending, income };
}

/** One budget line in words: "$1,200 of $4,000 used (30%)", or that nothing was planned. */
export function lineWords(l: FinanceBudgetLine): string {
  const budget = toCents(l.budget);
  const actual = toCents(l.actual);
  const verb = l.type === "expense" ? "used" : "received";
  if (budget <= 0) return `${dollars(l.actual)} ${verb}, nothing planned`;
  const pct = Math.round((actual * 100) / budget);
  return `${dollars(l.actual)} of ${dollars(l.budget)} ${verb} (${pct}%)`;
}

/** The share of the budget used, capped for a bar (0 to 100). */
export function lineBarPercent(l: FinanceBudgetLine): number {
  const budget = toCents(l.budget);
  if (budget <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((toCents(l.actual) * 100) / budget)));
}

export const OWNER_FINANCES_COPY = {
  title: "Finances",
  intro: "A simple look at the association's money, shared by your board. These figures come from the books the board keeps.",
  notAvailable: "The board hasn't turned this page on.",
  couldNotLoad: "We couldn't load the finances. Reload the page. If it keeps happening, tell the board.",
  noData: "There are no figures to show yet. Once the board has recorded the association's income and spending, they will appear here.",
  lastYearTitle: "Last full year",
  yearToDateTitle: "This year so far",
  noLastYear: "There is no completed year in the books yet.",
  noActivity: "Nothing has been recorded for this period yet.",
  cashTitle: "Cash and reserve",
  noCash: "No cash balances have been recorded yet.",
  operatingLabel: "Operating cash",
  reserveLabel: "Reserve fund",
  budgetTitle: "Budget compared with spending",
  noBudget: "The board hasn't entered a budget for this year yet.",
  income: "Income",
  expenses: "Spending",
  net: "Left over",
  footnote: "Figures are rounded to whole dollars and only include entries the board has posted to the books.",
  toggleTitle: "Finances page for owners",
  toggleOff: "Owners can't see the association's finances. Turn this on to show them a simple summary: income and spending, cash and reserve, and the budget.",
  toggleOn: "Owners can see a simple summary of the association's finances. It shows totals only, not individual bills, transactions or bank details.",
  toggleEnable: "Show the Finances page to owners",
  toggleDisable: "Hide the Finances page from owners",
  toggleFailed: "Couldn't change that. Try again.",
  togglePreview: "See what owners see",
} as const;
