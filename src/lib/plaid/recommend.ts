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
  /** "duplicate": the deposit matches a payment someone already recorded by hand on Dues. */
  source: "history" | "keyword" | "duplicate";
  /** Plain words for the line under the chip. */
  reason: string;
  needsPick: boolean;
}

/**
 * A payment recorded by hand on the Dues page ("Record a payment") — check,
 * cash or other, never a bank-feed posting. If a deposit in the feed is the
 * same money, posting it would count the dues twice.
 */
export interface ManualPayment {
  unit_id: string;
  amount: string | number;
  /** ISO date. */
  received_on: string;
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
 *
 * `alreadyFiled`: the row has a category, so the trigger-kept tally already
 * counts it. Its own amount is taken back out so a $900 bill is compared with
 * the earlier $250 ones, not with a mean it has pulled up itself; with no
 * earlier filing left, that is a first-time payee and the answer is null.
 */
export function typicalAmountCents(
  t: { description: string; amount: string | number },
  history: HistoryIndex,
  options: { alreadyFiled?: boolean } = {},
): number | null {
  const key = payeeKey(t.description, Number(t.amount));
  const past = key ? history.get(key) : undefined;
  if (!past || past.typicalAmountCents <= 0) return null;
  if (!options.alreadyFiled) return past.typicalAmountCents;
  const others = past.count - 1;
  if (others <= 0) return null;
  const centsWithoutSelf = past.typicalAmountCents * past.count - Math.abs(cents(t.amount));
  return centsWithoutSelf > 0 ? Math.round(centsWithoutSelf / others) : null;
}

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayNumber = (iso: string) => Math.round(new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime() / 86_400_000);
const cents = (v: string | number) => Math.round(Number(v) * 100);
const dollars = (c: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: c % 100 === 0 ? 0 : 2,
  }).format(c / 100);

/** How far apart a bank deposit and a hand-recorded payment may land and still be the same money. */
const DUPLICATE_WINDOW_DAYS = 10;

/**
 * The hand-recorded payment this deposit most likely IS: same unit, same
 * amount, received within ten days either side. A check written on the 1st,
 * recorded on Dues the same day and clearing at the bank on the 6th is the
 * common case; the window is wide enough for a slow deposit, narrow enough
 * that next month's identical dues don't match.
 */
function manualTwin(
  t: { amount: string | number; posted_on: string },
  unitId: string,
  payments: ManualPayment[],
): ManualPayment | null {
  const want = cents(t.amount);
  const day = dayNumber(t.posted_on);
  let best: ManualPayment | null = null;
  let bestGap = Infinity;
  for (const p of payments) {
    if (p.unit_id !== unitId || cents(p.amount) !== want) continue;
    const gap = Math.abs(dayNumber(p.received_on) - day);
    if (gap <= DUPLICATE_WINDOW_DAYS && gap < bestGap) {
      best = p;
      bestGap = gap;
    }
  }
  return best;
}

export function recommend(
  t: { description: string; amount: string | number; posted_on?: string },
  history: HistoryIndex,
  accounts: { expense: SuggestableAccount[]; income: SuggestableAccount[] },
  extras: { manualPayments?: ManualPayment[] } = {},
): Recommendation | null {
  const amount = Number(t.amount);
  const key = payeeKey(t.description, amount);
  const past = key ? history.get(key) : undefined;
  if (past) {
    const needsPick =
      (past.kind === "dues" && !past.unitId) ||
      (["expense", "income", "transfer"].includes(past.kind) && !past.accountId);
    // Duplicate guard: the board already recorded this money by hand on
    // Dues. Recommend keeping it out of the books rather than posting the
    // same dues twice. A distinct source so the UI can say so plainly.
    const twin =
      past.kind === "dues" && past.unitId && amount > 0 && t.posted_on && extras.manualPayments?.length
        ? manualTwin({ amount: t.amount, posted_on: t.posted_on }, past.unitId, extras.manualPayments)
        : null;
    if (twin) {
      const [, m, d] = twin.received_on.slice(0, 10).split("-").map(Number);
      return {
        kind: "excluded",
        accountId: null,
        unitId: null,
        source: "duplicate",
        reason: `looks like the ${dollars(cents(twin.amount))} you recorded by hand on ${MONTHS[m - 1]} ${d} — already in the books`,
        needsPick: false,
      };
    }
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
    reason: "a guess from the description",
    needsPick: !guess.accountId,
  };
}
