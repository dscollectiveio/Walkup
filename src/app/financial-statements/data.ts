import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fiscalYearBounds,
  monthBounds,
  quarterBounds,
  type FiscalYear,
  type PeriodBounds,
  type PeriodGrain,
  type ViewMode,
} from "./periods";
import { prorateBudget } from "./summary";

export interface AccountLine {
  account_id: string;
  code: string;
  account_name: string;
  account_type: "income" | "expense";
  amount: number;
}

/** One posted journal line behind a statement row — what "click to see the entries" shows. */
export interface LineEntry {
  entry_id: string;
  entry_date: string;
  memo: string;
  amount: number;
  /** The bank transaction this came from, when it came from the bank feed. */
  bank_description: string | null;
}

export interface PriorTotals {
  label: string;
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  hasActivity: boolean;
}

/** "Where the money sits" at the end of the period. Dues and bills are today's open balances. */
export interface Position {
  operatingCash: number;
  reserveCash: number;
  /** Net change in reserve cash within the period. */
  reserveChange: number;
  duesOwed: number;
  unitsBehind: number;
  billsOwed: number;
}

export interface Statement {
  association: { id: string; display_name: string };
  bounds: PeriodBounds | null;
  fiscalYears: FiscalYear[];
  incomeRows: AccountLine[];
  expenseRows: AccountLine[];
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  unpostedCount: number;
  canGoNewer: boolean;
  canGoOlder: boolean;
  prior: PriorTotals | null;
  position: Position | null;
  /** Budget for each account over this period, or null when no budget covers it. */
  budgetByAccount: Record<string, number> | null;
  budgetNote: string | null;
  entriesByAccount: Record<string, LineEntry[]>;
  /** The latest date with a posted entry — how current the books are. */
  postedThrough: string | null;
}

function boundsFor(period: PeriodGrain, offset: number, fiscalYears: FiscalYear[]): PeriodBounds | null {
  if (period === "annual") return fiscalYearBounds(fiscalYears, offset);
  if (period === "quarterly") return quarterBounds(offset);
  return monthBounds(offset);
}

async function sumLines(
  supabase: SupabaseClient,
  associationId: string,
  bounds: PeriodBounds,
): Promise<{ rows: AccountLine[]; totalIncome: number; totalExpenses: number }> {
  const { data: lineRows } = await supabase
    .from("income_statement_lines")
    .select("account_id, code, account_name, account_type, amount")
    .eq("association_id", associationId)
    .gte("entry_date", bounds.start)
    .lte("entry_date", bounds.end);

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
  return {
    rows,
    totalIncome: rows.filter((r) => r.account_type === "income").reduce((s, r) => s + r.amount, 0),
    totalExpenses: rows.filter((r) => r.account_type === "expense").reduce((s, r) => s + r.amount, 0),
  };
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

  const { data: fyRows } = await supabase
    .from("fiscal_years")
    .select("label, starts_on, ends_on")
    .order("starts_on", { ascending: false });
  const fiscalYears: FiscalYear[] = fyRows ?? [];

  const bounds = boundsFor(period, offset, fiscalYears);
  const empty: Statement = {
    association,
    bounds,
    fiscalYears,
    incomeRows: [],
    expenseRows: [],
    totalIncome: 0,
    totalExpenses: 0,
    netIncome: 0,
    unpostedCount: 0,
    canGoNewer: offset > 0,
    canGoOlder: period !== "annual" || offset + 1 < fiscalYears.length,
    prior: null,
    position: null,
    budgetByAccount: null,
    budgetNote: null,
    entriesByAccount: {},
    postedThrough: null,
  };
  if (!bounds) return empty;

  const priorBounds = boundsFor(period, offset + 1, fiscalYears);
  const coveringFy = fiscalYears.find((fy) => fy.starts_on <= bounds.start && fy.ends_on >= bounds.start) ?? null;

  const [
    current,
    prior,
    { count: unpostedCount },
    { data: funds },
    { data: balanceLines },
    { data: openCharges },
    { data: budgets },
    { data: latestEntry },
  ] = await Promise.all([
    sumLines(supabase, association.id, bounds),
    priorBounds ? sumLines(supabase, association.id, priorBounds) : Promise.resolve(null),
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
    supabase.from("funds").select("id, kind").eq("association_id", association.id),
    // Every posted line on a cash or liability account up to the period's
    // end — the balances "where the money sits" is built from.
    supabase
      .from("journal_lines")
      .select("fund_id, debit, credit, account:accounts!inner(type, is_cash_account), entry:journal_entries!inner(entry_date, is_posted)")
      .eq("association_id", association.id)
      .eq("entry.is_posted", true)
      .lte("entry.entry_date", bounds.end)
      .or("is_cash_account.eq.true,type.eq.liability", { referencedTable: "account" }),
    supabase
      .from("charge_balances")
      .select("unit_id, balance, days_overdue")
      .eq("association_id", association.id)
      .in("status", ["open", "partial"]),
    coveringFy
      ? supabase
          .from("budgets")
          .select("id, fiscal_year:fiscal_years!inner(label, starts_on), lines:budget_lines(account_id, amount)")
          .eq("association_id", association.id)
          .eq("fiscal_year.starts_on", coveringFy.starts_on)
          .limit(1)
      : Promise.resolve({ data: null }),
    supabase
      .from("journal_entries")
      .select("entry_date")
      .eq("association_id", association.id)
      .eq("is_posted", true)
      .order("entry_date", { ascending: false })
      .limit(1),
  ]);

  const incomeRows = current.rows.filter((r) => r.account_type === "income");
  const expenseRows = current.rows
    .filter((r) => r.account_type === "expense")
    .sort((a, b) => (view === "expenses" ? b.amount - a.amount : a.code.localeCompare(b.code)));

  // --- Position -------------------------------------------------------------
  const reserveFundIds = new Set((funds ?? []).filter((f) => f.kind === "reserve").map((f) => f.id));
  let operatingCash = 0;
  let reserveCash = 0;
  let reserveChange = 0;
  let billsOwed = 0;
  type BalanceLine = {
    fund_id: string;
    debit: string | number;
    credit: string | number;
    account: { type: string; is_cash_account: boolean } | { type: string; is_cash_account: boolean }[];
    entry: { entry_date: string } | { entry_date: string }[];
  };
  for (const raw of (balanceLines ?? []) as unknown as BalanceLine[]) {
    const account = Array.isArray(raw.account) ? raw.account[0] : raw.account;
    const entry = Array.isArray(raw.entry) ? raw.entry[0] : raw.entry;
    const net = Number(raw.debit) - Number(raw.credit);
    if (account?.is_cash_account) {
      if (reserveFundIds.has(raw.fund_id)) {
        reserveCash += net;
        if (entry && entry.entry_date >= bounds.start) reserveChange += net;
      } else {
        operatingCash += net;
      }
    } else if (account?.type === "liability") {
      billsOwed += -net;
    }
  }
  const duesOwed = (openCharges ?? []).reduce((s, c) => s + Number(c.balance), 0);
  const unitsBehind = new Set((openCharges ?? []).filter((c) => Number(c.days_overdue) > 0).map((c) => c.unit_id))
    .size;
  const position: Position = { operatingCash, reserveCash, reserveChange, duesOwed, unitsBehind, billsOwed };

  // --- Budget ---------------------------------------------------------------
  type BudgetRow = {
    fiscal_year: { label: string } | { label: string }[];
    lines: { account_id: string; amount: string | number }[];
  };
  const budgetRow = (budgets?.[0] as unknown as BudgetRow | undefined) ?? null;
  let budgetByAccount: Record<string, number> | null = null;
  let budgetNote: string | null = null;
  if (budgetRow && budgetRow.lines.length > 0) {
    const annual: Record<string, number> = {};
    for (const l of budgetRow.lines) annual[l.account_id] = (annual[l.account_id] ?? 0) + Number(l.amount);
    const { byAccount, note } = prorateBudget(annual, period);
    const fyLabel = (Array.isArray(budgetRow.fiscal_year) ? budgetRow.fiscal_year[0] : budgetRow.fiscal_year)?.label;
    budgetByAccount = byAccount;
    budgetNote = `${note} of the ${fyLabel ?? ""} budget`.replace("  ", " ");
  }

  // --- Entries behind each line --------------------------------------------
  const accountIds = current.rows.map((r) => r.account_id);
  const typeById = new Map(current.rows.map((r) => [r.account_id, r.account_type]));
  const entriesByAccount: Record<string, LineEntry[]> = {};
  if (accountIds.length > 0) {
    type EntryLine = {
      account_id: string;
      debit: string | number;
      credit: string | number;
      line_memo: string | null;
      entry: { id: string; entry_date: string; memo: string | null } | { id: string; entry_date: string; memo: string | null }[];
    };
    const { data: entryLines } = await supabase
      .from("journal_lines")
      .select("account_id, debit, credit, line_memo, entry:journal_entries!inner(id, entry_date, memo, is_posted)")
      .eq("association_id", association.id)
      .in("account_id", accountIds)
      .eq("entry.is_posted", true)
      .gte("entry.entry_date", bounds.start)
      .lte("entry.entry_date", bounds.end)
      .limit(2000);
    const lines = ((entryLines ?? []) as unknown as EntryLine[]).map((l) => ({
      ...l,
      entry: Array.isArray(l.entry) ? l.entry[0] : l.entry,
    }));
    const entryIds = [...new Set(lines.map((l) => l.entry.id))];
    const { data: bankRows } =
      entryIds.length > 0
        ? await supabase.from("bank_transactions").select("journal_entry_id, description").in("journal_entry_id", entryIds)
        : { data: [] };
    const bankByEntry = new Map((bankRows ?? []).map((b) => [b.journal_entry_id as string, b.description as string]));
    for (const l of lines) {
      const type = typeById.get(l.account_id);
      const amount = type === "income" ? Number(l.credit) - Number(l.debit) : Number(l.debit) - Number(l.credit);
      const list = entriesByAccount[l.account_id] ?? (entriesByAccount[l.account_id] = []);
      list.push({
        entry_id: l.entry.id,
        entry_date: l.entry.entry_date,
        memo: (l.entry.memo ?? l.line_memo ?? "").replace(/^\[DEMO\]\s*/, "") || "Journal entry",
        amount,
        bank_description: bankByEntry.get(l.entry.id) ?? null,
      });
    }
    for (const list of Object.values(entriesByAccount)) list.sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  }

  return {
    ...empty,
    incomeRows,
    expenseRows,
    totalIncome: current.totalIncome,
    totalExpenses: current.totalExpenses,
    netIncome: current.totalIncome - current.totalExpenses,
    unpostedCount: unpostedCount ?? 0,
    prior:
      prior && priorBounds
        ? {
            label: priorBounds.label,
            totalIncome: prior.totalIncome,
            totalExpenses: prior.totalExpenses,
            netIncome: prior.totalIncome - prior.totalExpenses,
            hasActivity: prior.rows.length > 0,
          }
        : null,
    position,
    budgetByAccount,
    budgetNote,
    entriesByAccount,
    postedThrough: latestEntry?.[0]?.entry_date ?? null,
  };
}
