import type { SupabaseClient } from "@supabase/supabase-js";
import { money } from "@/components/ui";
import { loadStatement, type Statement } from "./data";
import { mergeRows, parseSelection, type MergedRow } from "./summary";
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
}

export type ReportMode = "full" | "expenses";

export function buildReport(statements: Statement[]): Report | null {
  const periods = statements.filter((s) => s.bounds !== null);
  if (periods.length === 0) return null;
  const labels = periods.map((p) => p.bounds!.label);
  return {
    associationName: periods[0].association.display_name,
    rangeLabel: labels.length === 1 ? labels[0] : `${labels[0]} – ${labels[labels.length - 1]}`,
    labels,
    income: mergeRows(periods.map((p) => ({ rows: p.incomeRows })), "account"),
    expenses: mergeRows(periods.map((p) => ({ rows: p.expenseRows })), "account"),
    incomeTotals: periods.map((p) => p.totalIncome),
    expenseTotals: periods.map((p) => p.totalExpenses),
    netTotals: periods.map((p) => p.netIncome),
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** The email body: a plain-text table, one line per account, a column per period (with a total when there are several). */
export function emailDraft(report: Report, mode: ReportMode): string {
  const multi = report.labels.length > 1;
  const title = mode === "full" ? "Profit & Loss" : "Expenses";
  const cells = (amounts: number[], total: number) =>
    multi ? report.labels.map((l, i) => `${l} ${money(amounts[i])}`).join("  |  ") + `  |  Total ${money(total)}` : money(total);
  const line = (r: MergedRow) => `  ${r.account_name}: ${cells(r.amounts, r.total)}`;
  const lines: string[] = [
    report.associationName,
    `${title} — ${report.rangeLabel}`,
    "",
    "A PDF of this report is available from the Financial Statements page — download it and attach it here if you'd like to include it.",
    "",
  ];
  if (mode === "full") {
    lines.push("INCOME", ...report.income.map(line));
    lines.push(`  Total income: ${cells(report.incomeTotals, sum(report.incomeTotals))}`, "");
  }
  lines.push("EXPENSES", ...report.expenses.map(line));
  lines.push(`  Total expenses: ${cells(report.expenseTotals, sum(report.expenseTotals))}`);
  if (mode === "full") {
    lines.push("", `NET INCOME: ${cells(report.netTotals, sum(report.netTotals))}`);
  }
  return lines.join("\n");
}

export function emailHref(report: Report, mode: ReportMode): string {
  const title = mode === "full" ? "Profit & Loss" : "Expenses";
  const subject = `${report.associationName} — ${title} — ${report.rangeLabel}`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailDraft(report, mode))}`;
}

/** Loads whatever the URL asks for: ?periods=… (several) or period/offset (one). Used by the PDF route. */
export async function loadForReport(
  supabase: SupabaseClient,
  params: { periods?: string | null; period: PeriodGrain; offset: number },
): Promise<Statement[] | "restricted"> {
  const base = await loadStatement(supabase, "total", params.period, params.offset);
  if ("restricted" in base) return "restricted";
  const selection = params.periods ? parseSelection(params.periods, base.fiscalYears, new Date().toISOString().slice(0, 10)) : null;
  if (!selection) return [base];
  const loaded = await Promise.all(selection.items.map((i) => loadStatement(supabase, "total", selection.grain, i.offset)));
  if (loaded.some((l) => "restricted" in l)) return "restricted";
  return loaded as Statement[];
}
