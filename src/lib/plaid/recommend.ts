import type { PostingKind } from "@/app/bank-feed/actions";
import { isMatchableDescription, normalizeDescription } from "./similar";
import { suggestCategorization, type SuggestableAccount } from "./suggest";

/**
 * A recommended category for a bank transaction that still needs one. Shown
 * on every waiting row with its reason; never written anywhere until a human
 * clicks it. Sources, strongest first:
 *
 *   1. history — what this association filed the same payee as before
 *      (same normalized description, same direction). The board's own past
 *      decisions beat any guess of ours.
 *   2. keyword — the calibrated pattern table and account-name overlap in
 *      suggest.ts.
 *
 * `needsPick` is true when the kind is clear but the target isn't (dues with
 * no known unit, a transfer with several possible accounts): the row still
 * shows the recommendation, and clicking it opens the form pre-set.
 */
export interface Recommendation {
  kind: PostingKind;
  accountId: string | null;
  unitId: string | null;
  source: "history" | "keyword";
  /** Plain words for the line under the chip. */
  reason: string;
  needsPick: boolean;
}

/**
 * One row of `bank_payee_history` (0046): how many times this board filed a
 * payee, in one direction, as one particular choice. Kept up to date by a
 * trigger on bank_transactions, so the page reads a few dozen rows instead
 * of re-tallying thousands of transactions.
 */
export interface PayeeHistoryRow {
  payee_key: string;
  /** -1 money out, 1 money in. */
  direction: number;
  posting_kind: PostingKind;
  account_id: string | null;
  matched_unit_id: string | null;
  count: number;
  /** Sum of abs(amount) in whole cents (a bigint, so it may arrive as a string). */
  amount_cents_total: number | string;
}

interface Tally {
  kind: PostingKind;
  accountId: string | null;
  unitId: string | null;
  /** How many times the board made this exact choice for the payee. */
  count: number;
  /** Mean abs(amount) in cents across every time the payee was filed, any choice. */
  typicalAmountCents: number;
}

export type HistoryIndex = Map<string, Tally>;

const payeeKey = (description: string, amount: number): string | null => {
  const norm = normalizeDescription(description);
  if (!isMatchableDescription(norm)) return null;
  return `${Math.sign(amount)}:${norm}`;
};

/** Most-used categorization per payee+direction, from the precomputed tally. */
export function buildHistoryIndex(rows: PayeeHistoryRow[]): HistoryIndex {
  const best = new Map<string, Tally>();
  const totals = new Map<string, { count: number; cents: number }>();
  for (const r of rows) {
    if (!isMatchableDescription(r.payee_key)) continue;
    const key = `${r.direction}:${r.payee_key}`;
    const t = totals.get(key) ?? { count: 0, cents: 0 };
    t.count += r.count;
    t.cents += Number(r.amount_cents_total);
    totals.set(key, t);
    const current = best.get(key);
    if (!current || r.count > current.count) {
      best.set(key, {
        kind: r.posting_kind,
        accountId: r.account_id,
        unitId: r.matched_unit_id,
        count: r.count,
        typicalAmountCents: 0,
      });
    }
  }
  for (const [key, t] of best) {
    const total = totals.get(key);
    t.typicalAmountCents = total && total.count > 0 ? Math.round(total.cents / total.count) : 0;
  }
  return best;
}

/**
 * What this payee usually costs, in cents, from the board's own history —
 * or null when the payee has never been filed. For "this is three times
 * what you normally pay them" style nudges; never a reason to block anything.
 */
export function typicalAmountCents(
  t: { description: string; amount: string | number },
  history: HistoryIndex,
): number | null {
  const key = payeeKey(t.description, Number(t.amount));
  const past = key ? history.get(key) : undefined;
  return past && past.typicalAmountCents > 0 ? past.typicalAmountCents : null;
}

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

export function recommend(
  t: { description: string; amount: string | number },
  history: HistoryIndex,
  accounts: { expense: SuggestableAccount[]; income: SuggestableAccount[] },
): Recommendation | null {
  const amount = Number(t.amount);
  const key = payeeKey(t.description, amount);
  const past = key ? history.get(key) : undefined;
  if (past) {
    const needsPick =
      (past.kind === "dues" && !past.unitId) ||
      (["expense", "income", "transfer"].includes(past.kind) && !past.accountId);
    return {
      kind: past.kind,
      accountId: past.accountId,
      unitId: past.unitId,
      source: "history",
      reason: `you filed this payee the same way ${times(past.count)} before`,
      needsPick,
    };
  }

  const guess = suggestCategorization(t.description, amount, accounts.expense, accounts.income);
  if (!guess) return null;

  if (guess.kind === "transfer") {
    return {
      kind: "transfer",
      accountId: null,
      unitId: null,
      source: "keyword",
      reason: "looks like a move between your own accounts",
      needsPick: true,
    };
  }
  if (guess.kind === "dues") {
    return {
      kind: "dues",
      accountId: null,
      unitId: null,
      source: "keyword",
      reason: "looks like an owner payment — pick the unit",
      needsPick: true,
    };
  }
  return {
    kind: guess.kind,
    accountId: guess.accountId,
    unitId: null,
    source: "keyword",
    reason: "based on the description",
    needsPick: !guess.accountId,
  };
}
