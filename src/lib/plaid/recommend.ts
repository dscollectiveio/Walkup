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

export interface HistoryRow {
  description: string;
  amount: string | number;
  posting_kind: PostingKind | null;
  account_id: string | null;
  matched_unit_id: string | null;
}

interface Tally {
  kind: PostingKind;
  accountId: string | null;
  unitId: string | null;
  count: number;
}

export type HistoryIndex = Map<string, Tally>;

const payeeKey = (description: string, amount: number): string | null => {
  const norm = normalizeDescription(description);
  if (!isMatchableDescription(norm)) return null;
  return `${Math.sign(amount)}:${norm}`;
};

/** Most-used categorization per payee+direction, from rows a human already filed. */
export function buildHistoryIndex(rows: HistoryRow[]): HistoryIndex {
  const perPayee = new Map<string, Map<string, Tally>>();
  for (const r of rows) {
    if (!r.posting_kind) continue;
    const key = payeeKey(r.description, Number(r.amount));
    if (!key) continue;
    const choice = `${r.posting_kind}:${r.account_id ?? ""}:${r.matched_unit_id ?? ""}`;
    const tallies = perPayee.get(key) ?? new Map<string, Tally>();
    const t = tallies.get(choice) ?? {
      kind: r.posting_kind,
      accountId: r.account_id,
      unitId: r.matched_unit_id,
      count: 0,
    };
    t.count += 1;
    tallies.set(choice, t);
    perPayee.set(key, tallies);
  }
  const index: HistoryIndex = new Map();
  for (const [key, tallies] of perPayee) {
    let best: Tally | null = null;
    for (const t of tallies.values()) if (!best || t.count > best.count) best = t;
    if (best) index.set(key, best);
  }
  return index;
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
