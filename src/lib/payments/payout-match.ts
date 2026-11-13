/**
 * Pairs Stripe payouts with the bank deposits they became (DECISIONS #57,
 * plan Phase 5). Pure. A deposit matches a payout when the amounts are equal
 * to the cent and it posted within a week either side of Stripe's arrival
 * date. Each deposit pairs with at most one payout, nearest date first, so
 * two same-size payouts never claim the same deposit.
 */

export interface PayoutForMatch {
  id: string;
  amountCents: number;
  arrivalDate: string | null;
}

export interface DepositForMatch {
  id: string;
  amountCents: number;
  postedOn: string;
  description: string;
}

const WINDOW_DAYS = 7;
const dayNum = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);

export function matchPayouts(payouts: PayoutForMatch[], deposits: DepositForMatch[]): Map<string, DepositForMatch> {
  const taken = new Set<string>();
  const out = new Map<string, DepositForMatch>();
  const ordered = [...payouts].sort((a, b) => (a.arrivalDate ?? "").localeCompare(b.arrivalDate ?? "") || a.id.localeCompare(b.id));
  for (const p of ordered) {
    if (!p.arrivalDate) continue;
    const target = dayNum(p.arrivalDate);
    const best = deposits
      .filter((d) => !taken.has(d.id) && d.amountCents === p.amountCents && Math.abs(dayNum(d.postedOn) - target) <= WINDOW_DAYS)
      .sort((a, b) => {
        // Prefer a deposit the bank labels as Stripe, then the closest date.
        const s = Number(/stripe/i.test(b.description)) - Number(/stripe/i.test(a.description));
        return s || Math.abs(dayNum(a.postedOn) - target) - Math.abs(dayNum(b.postedOn) - target) || a.id.localeCompare(b.id);
      })[0];
    if (best) {
      taken.add(best.id);
      out.set(p.id, best);
    }
  }
  return out;
}
