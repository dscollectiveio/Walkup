import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface TxRow {
  id: string;
  posted_on: string;
  description: string;
  amount: number;
  posting_kind: string | null;
  account_id: string | null;
  matched_unit_id: string | null;
  journal_entry_id: string | null;
  excluded_at: string | null;
  pending: boolean;
}

export interface TxFilter {
  startDate: string;
  endDate: string;
  /** An expense/income account id, or "needs" for uncategorized. */
  category: string | null;
  query: string | null;
  limit: number;
}

const COLUMNS =
  "id, posted_on, description, amount, posting_kind, account_id, matched_unit_id, journal_entry_id, excluded_at, pending";

/** "Needs a category": synced, settled, not yet categorized or set aside. */
export function isNeedsCategory(t: Pick<TxRow, "posting_kind" | "excluded_at" | "journal_entry_id" | "pending">) {
  return t.posting_kind === null && t.excluded_at === null && t.journal_entry_id === null && !t.pending;
}

/**
 * The transactions behind the Budget & spending page and its Excel export —
 * one loader so the file can't disagree with the screen. Uncategorized rows
 * always come first; they're the thing to act on.
 */
export async function loadTransactions(
  supabase: SupabaseClient,
  filter: TxFilter,
): Promise<{ needs: TxRow[]; rows: TxRow[]; hasMore: boolean }> {
  // The query ends up inside a PostgREST filter string, where commas, dots in
  // operators, parentheses and quotes are syntax — keep only plain text.
  const text = (filter.query ?? "").replace(/[^A-Za-z0-9 &'\-]/g, " ").trim();
  const amount = Number((filter.query ?? "").replace(/[$,\s]/g, ""));
  const isAmount = (filter.query ?? "").trim() !== "" && Number.isFinite(amount);

  const base = () => {
    let q = supabase
      .from("bank_transactions")
      .select(COLUMNS)
      .is("removed_at", null)
      .gte("posted_on", filter.startDate)
      .lte("posted_on", filter.endDate);
    if (isAmount) q = q.or(`amount.eq.${amount},amount.eq.${-amount}`);
    else if (text) q = q.ilike("description", `%${text}%`);
    return q;
  };

  const wantNeeds = filter.category === null || filter.category === "needs";
  const wantRest = filter.category !== "needs";

  const [needsRes, restRes] = await Promise.all([
    wantNeeds
      ? base()
          .is("posting_kind", null)
          .is("excluded_at", null)
          .is("journal_entry_id", null)
          .eq("pending", false)
          .order("posted_on", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] as TxRow[] }),
    wantRest
      ? (() => {
          let q = base().or(
            "posting_kind.not.is.null,excluded_at.not.is.null,journal_entry_id.not.is.null,pending.eq.true",
          );
          if (filter.category) q = q.eq("account_id", filter.category);
          return q.order("posted_on", { ascending: false }).limit(filter.limit + 1);
        })()
      : Promise.resolve({ data: [] as TxRow[] }),
  ]);

  const norm = (rows: unknown[] | null) =>
    ((rows ?? []) as (Omit<TxRow, "amount"> & { amount: string | number })[]).map((r) => ({
      ...r,
      amount: Number(r.amount),
    }));
  const rest = norm(restRes.data);
  return { needs: norm(needsRes.data), rows: rest.slice(0, filter.limit), hasMore: rest.length > filter.limit };
}
