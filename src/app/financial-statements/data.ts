import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fiscalYearBounds, monthBounds, quarterBounds, type PeriodBounds, type PeriodGrain, type ViewMode } from "./periods";

export interface AccountLine {
  account_id: string;
  code: string;
  account_name: string;
  account_type: "income" | "expense";
  amount: number;
}

export interface Statement {
  association: { id: string; display_name: string };
  bounds: PeriodBounds | null;
  incomeRows: AccountLine[];
  expenseRows: AccountLine[];
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  unpostedCount: number;
  canGoNewer: boolean;
  canGoOlder: boolean;
}

/**
 * The query/aggregation behind the Financial Statements page, factored out
 * so the page itself, the Excel export route, and the PDF export route
 * build the exact same numbers from the exact same query — no route can
 * drift from what's on screen. Does its own access check (association
 * lookup + can_read_financials) since callers include Route Handlers,
 * which don't inherit a page's checks.
 */
export async function loadStatement(
  supabase: SupabaseClient,
  view: ViewMode,
  period: PeriodGrain,
  offset: number,
): Promise<Statement | { restricted: true }> {
  const { data: associations } = await supabase
    .from("associations")
    .select("id, display_name")
    .limit(1);
  const association = associations?.[0];
  if (!association) return { restricted: true };

  const { data: canReadFinancialsRes } = await supabase.rpc("can_read_financials", {
    assoc: association.id,
  });
  if (canReadFinancialsRes !== true) return { restricted: true };

  let bounds: PeriodBounds | null;
  let fiscalYearCount = 0;
  if (period === "annual") {
    const { data: fiscalYears } = await supabase
      .from("fiscal_years")
      .select("label, starts_on, ends_on")
      .order("starts_on", { ascending: false });
    fiscalYearCount = fiscalYears?.length ?? 0;
    bounds = fiscalYearBounds(fiscalYears ?? [], offset);
  } else if (period === "quarterly") {
    bounds = quarterBounds(offset);
  } else {
    bounds = monthBounds(offset);
  }

  const [{ data: lineRows }, { count: unpostedCount }] = bounds
    ? await Promise.all([
        supabase
          .from("income_statement_lines")
          .select("account_id, code, account_name, account_type, amount")
          .eq("association_id", association.id)
          .gte("entry_date", bounds.start)
          .lte("entry_date", bounds.end),
        supabase
          .from("bank_transactions")
          .select("id", { count: "exact", head: true })
          .eq("association_id", association.id)
          .gte("posted_on", bounds.start)
          .lte("posted_on", bounds.end)
          .is("journal_entry_id", null)
          .is("excluded_at", null)
          .is("removed_at", null)
          .eq("pending", false),
      ])
    : [{ data: [] }, { count: 0 }];

  const byAccount = new Map<string, AccountLine>();
  for (const l of lineRows ?? []) {
    const existing = byAccount.get(l.account_id);
    const amount = Number(l.amount);
    if (existing) existing.amount += amount;
    else
      byAccount.set(l.account_id, {
        account_id: l.account_id,
        code: l.code,
        account_name: l.account_name,
        account_type: l.account_type as "income" | "expense",
        amount,
      });
  }
  const rows = [...byAccount.values()].sort((a, b) => a.code.localeCompare(b.code));
  const incomeRows = rows.filter((r) => r.account_type === "income");
  const expenseRows = rows
    .filter((r) => r.account_type === "expense")
    .sort((a, b) => (view === "expenses" ? b.amount - a.amount : a.code.localeCompare(b.code)));
  const totalIncome = incomeRows.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenseRows.reduce((s, r) => s + r.amount, 0);

  return {
    association,
    bounds,
    incomeRows,
    expenseRows,
    totalIncome,
    totalExpenses,
    netIncome: totalIncome - totalExpenses,
    unpostedCount: unpostedCount ?? 0,
    canGoNewer: offset > 0,
    canGoOlder: period !== "annual" || offset + 1 < fiscalYearCount,
  };
}
