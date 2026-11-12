import type { SupabaseClient } from "@supabase/supabase-js";
import { money } from "@/components/ui";
import { mailtoHref } from "@/lib/email/mailto";
import { loadStatement, type Statement } from "./data";
import { mergeRows, type MergedRow } from "./summary";
import { boundsOf, resolveView, type StatementView } from "./range";
import type { PeriodGrain } from "./periods";

/** One or more loaded periods lined up as columns: what the PDF and the email draft are built from. */
export interface Report {
  associationName: string;
  /** "Oct 2026" or "Jan 2026 – Mar 2026" */
  rangeLabel: string;
  labels: string[];
  income: MergedRow[];
  expenses: MergedRow[];
  incomeTotals: number[];
  expenseTotals: number[];
  netTotals: number[];
  /** Compare view: the last column is Period 1 minus Period 2 instead of a sum. */
  compare: boolean;
  /** A period with nothing posted: shown blank, never as zeros. */
  blank: boolean[];
}

/** The last column for a row of per-period amounts: the sum, or the difference when comparing. Null when it can't be worked out. */
export function lastColumn(report: Pick<Report, "compare" | "blank">, amounts: number[]): number | null {
  if (!report.compare) return amounts.reduce((a, b) => a + b, 0);
  if (report.blank.some(Boolean)) return null;
  return amounts[0] - amounts[1];
}
export const lastColumnLabel = (report: Pick<Report, "compare">) => (report.compare ? "Difference" : "Total");
/** One period's figure, or null when that period has nothing posted. */
export const shownAmount = (report: Pick<Report, "blank">, i: number, n: number): number | null => (report.blank[i] ? null : n);

export type ReportMode = "full" | "expenses";

export function buildReport(statements: Statement[], opts: { compare?: boolean; blank?: boolean[] } = {}): Report | null {
  const periods = statements.filter((s) => s.bounds !== null);
  if (periods.length === 0) return null;
  const labels = periods.map((p) => p.bounds!.label);
  return {
    associationName: periods[0].association.display_name,
    rangeLabel: opts.compare ? `${labels[0]} vs. ${labels[1]}` : labels.length === 1 ? labels[0] : `${labels[0]} – ${labels[labels.length - 1]}`,
    compare: opts.compare ?? false,
    blank: opts.blank ?? periods.map(() => false),
    labels,
    income: mergeRows(periods.map((p) => ({ rows: p.incomeRows }))),
    expenses: mergeRows(periods.map((p) => ({ rows: p.expenseRows }))),
    incomeTotals: periods.map((p) => p.totalIncome),
    expenseTotals: periods.map((p) => p.totalExpenses),
    netTotals: periods.map((p) => p.netIncome),
  };
}

/**
 * The email body: plain text (a mailto link can't carry formatting), laid out so it reads well in any mail app.
 * A summary first, the month-by-month totals when there are several periods, then one line per account.
 */
export function emailDraft(report: Report, mode: ReportMode): string {
  const multi = report.labels.length > 1;
  const title = mode === "full" ? "Profit & Loss" : "Expenses";
  const fmt = (n: number | null) => (n === null ? "—" : money(n));
  const signed = (n: number | null) => (n === null ? "—" : n < 0 ? `−${money(-n)}` : n > 0 ? `+${money(n)}` : money(0));
  const rule = "────────────────────────";

  /** One figure for a row: the total, or "P1 vs. P2 (Difference …)" when comparing. */
  const figure = (amounts: number[]) => {
    if (report.compare) {
      const diff = lastColumn(report, amounts);
      if (diff === null) return `${fmt(shownAmount(report, 0, amounts[0]))} (no posted data for ${report.labels[1]})`;
      return `${fmt(shownAmount(report, 0, amounts[0]))} vs. ${fmt(shownAmount(report, 1, amounts[1]))} (difference ${signed(diff)})`;
    }
    return fmt(lastColumn(report, amounts));
  };
  const net = report.compare ? report.netTotals[0] : (lastColumn(report, report.netTotals) ?? 0);
  const netWord = net < 0 ? "Deficit" : "Excess";
  const netDiff = lastColumn(report, report.netTotals);
  const netFigure = report.compare
    ? netDiff === null
      ? `${fmt(Math.abs(report.netTotals[0]))} (no posted data for ${report.labels[1]})`
      : `${fmt(Math.abs(report.netTotals[0]))} vs. ${fmt(shownAmount(report, 1, Math.abs(report.netTotals[1])))} (difference ${signed(netDiff)})`
    : fmt(Math.abs(net));

  const out: string[] = [report.associationName, `${title} · ${report.rangeLabel}`, rule, ""];

  out.push("AT A GLANCE");
  if (report.compare) out.push(`${report.labels[0]} vs. ${report.labels[1]}`);
  if (mode === "full") out.push(`Total income: ${figure(report.incomeTotals)}`);
  out.push(`Total expenses: ${figure(report.expenseTotals)}`);
  if (mode === "full") out.push(`${netWord}: ${netFigure}`);
  out.push("");

  if (multi && !report.compare) {
    out.push("BY PERIOD");
    report.labels.forEach((l, i) => {
      const parts =
        mode === "full"
          ? [`Income ${fmt(report.incomeTotals[i])}`, `Expenses ${fmt(report.expenseTotals[i])}`, `${report.netTotals[i] < 0 ? "Deficit" : "Excess"} ${fmt(Math.abs(report.netTotals[i]))}`]
          : [`Expenses ${fmt(report.expenseTotals[i])}`];
      out.push(`${l}: ${parts.join(" · ")}`);
    });
    out.push("");
  }

  const block = (heading: string, rows: MergedRow[]) => {
    out.push(heading);
    if (rows.length === 0) out.push("  (nothing posted)");
    for (const r of rows) out.push(`  • ${r.account_name}: ${figure(r.amounts)}`);
    out.push("");
  };
  if (mode === "full") block("INCOME", report.income);
  block("EXPENSES", report.expenses);

  out.push(rule, "Prepared with Walkup from posted bank transactions.", "A PDF copy is available from the Financial Statements page if you'd like to attach it.");
  return out.join("\n");
}

export function emailHref(report: Report, mode: ReportMode): string {
  const title = mode === "full" ? "Profit & Loss" : "Expenses";
  const subject = `${report.associationName}: ${title}, ${report.rangeLabel}`;
  return mailtoHref(null, subject, emailDraft(report, mode));
}

export interface LoadedView {
  statements: Statement[];
  compare: boolean;
  blank: boolean[];
}

const hasPosted = (s: Statement) => s.incomeRows.length + s.expenseRows.length > 0;

/** Loads the statements a view needs, one per column. Shared by the page and the PDF / Excel routes. */
export async function loadView(supabase: SupabaseClient, view: StatementView): Promise<LoadedView | "restricted"> {
  let loaded: (Statement | { restricted: true })[];
  if (view.kind === "columns") {
    loaded = await Promise.all(view.selection.items.map((i) => loadStatement(supabase, "total", view.selection.grain, i.offset)));
  } else if (view.kind === "combined") {
    loaded = [await loadStatement(supabase, "total", "monthly", 0, boundsOf(view.range))];
  } else {
    loaded = await Promise.all([view.p1, view.p2].map((p) => loadStatement(supabase, "total", "monthly", 0, boundsOf(p))));
  }
  if (loaded.some((l) => "restricted" in l)) return "restricted";
  const statements = (loaded as Statement[]).filter((l) => l.bounds !== null);
  return {
    statements,
    compare: view.kind === "compare",
    blank: view.kind === "compare" ? statements.map((s) => !hasPosted(s)) : statements.map(() => false),
  };
}

/** Loads whatever the URL asks for: a date range, a comparison, ?periods=… (several) or period/offset (one). Used by the PDF and Excel routes. */
export async function loadForReport(
  supabase: SupabaseClient,
  params: { query: URLSearchParams; period: PeriodGrain; offset: number },
): Promise<LoadedView | "restricted"> {
  const base = await loadStatement(supabase, "total", params.period, params.offset);
  if ("restricted" in base) return "restricted";
  const view = resolveView(params.query, base.fiscalYears, new Date().toISOString().slice(0, 10));
  if (view) return loadView(supabase, view);
  return { statements: [base], compare: false, blank: [false] };
}
