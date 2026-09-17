/**
 * Plaid transaction IDs are scoped to an Item. Disconnect a bank and
 * reconnect it and every transaction comes back under a brand-new ID, so
 * dedup on plaid_transaction_id alone double-counts the whole history
 * (this happened in production on 2026-09-16). The stable identity of a
 * bank transaction is what the bank itself printed: date, amount,
 * description. That's the fingerprint.
 *
 * Adoption, not insertion: when an incoming transaction fingerprints to a
 * row from a *prior* connection, the old row is re-pointed at the new Plaid
 * ID and connection. Its categorization and journal_entry_id ride along, so
 * a reconnect never un-posts anything.
 *
 * Two genuinely identical transactions on the same day (two $51 ComEd
 * autopays) pair off one-to-one: each incoming row claims at most one prior
 * row, in order.
 */

export interface IncomingTransaction {
  transaction_id: string;
  date: string;
  amount: number; // Plaid sign: positive = money out
  name: string;
  pending: boolean;
  account_id?: string | null;
  pending_transaction_id?: string | null;
  category?: string[] | null;
}

export interface PriorRow {
  id: string;
  posted_on: string;
  amount: string | number; // Walkup sign: positive = money in
  description: string;
}

export function fingerprint(postedOn: string, walkupAmount: number, description: string): string {
  return `${postedOn}|${walkupAmount.toFixed(2)}|${description.trim().toLowerCase()}`;
}

export function walkupAmount(plaidAmount: number): number {
  // Inverted once at the boundary — see the migration 0016 comment.
  return -1 * plaidAmount;
}

export interface SyncPlan {
  /** Existing rows for this connection: plain upsert on plaid_transaction_id. */
  upserts: IncomingTransaction[];
  /** Rows from a prior connection that this incoming transaction IS. */
  adoptions: { priorId: string; incoming: IncomingTransaction }[];
  /** Genuinely new. */
  inserts: IncomingTransaction[];
}

export function planSyncWrites(
  incoming: IncomingTransaction[],
  existingIdsForThisConnection: Set<string>,
  priorRows: PriorRow[],
): SyncPlan {
  const unclaimed = new Map<string, string[]>();
  for (const row of priorRows) {
    const key = fingerprint(row.posted_on, Number(row.amount), row.description);
    const list = unclaimed.get(key) ?? [];
    list.push(row.id);
    unclaimed.set(key, list);
  }

  const plan: SyncPlan = { upserts: [], adoptions: [], inserts: [] };
  for (const t of incoming) {
    if (existingIdsForThisConnection.has(t.transaction_id)) {
      plan.upserts.push(t);
      continue;
    }
    const key = fingerprint(t.date, walkupAmount(t.amount), t.name);
    const candidates = unclaimed.get(key);
    if (candidates && candidates.length > 0) {
      plan.adoptions.push({ priorId: candidates.shift() as string, incoming: t });
      continue;
    }
    plan.inserts.push(t);
  }
  return plan;
}

export interface CategorizationRule {
  id: string;
  pattern: string;
  posting_kind: string;
  account_id: string | null;
  matched_unit_id: string | null;
  vendor_id: string | null;
  auto_post: boolean;
}

/** First rule whose pattern appears in the description, case-insensitively. */
export function matchRule(description: string, rules: CategorizationRule[]): CategorizationRule | null {
  const haystack = description.toLowerCase();
  for (const r of rules) {
    if (haystack.includes(r.pattern.trim().toLowerCase())) return r;
  }
  return null;
}
