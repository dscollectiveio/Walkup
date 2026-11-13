import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchPayouts } from "@/lib/payments/payout-match";
import { payoutSuggestion } from "@/lib/payments/board-view";

/**
 * Stripe payouts of online dues not yet in the books, each with the bank
 * deposit it matches (DECISIONS #57, plan Phase 5). Read in the signed-in
 * person's own session: RLS limits it to the board and the accountant.
 * Used by the bank feed (to confirm them) and the Dues tab (so a payout's
 * deposit is never offered as one unit's dues).
 */

export interface StripePayoutView {
  payoutId: string;
  /** "Stripe payout: 3 online dues payments, $1,200 less $9.60 in fees" */
  text: string;
  /** "Unit 1 $400 · Unit 2 $400 · Unit 3 $400" */
  detail: string;
  /** The bank deposit it matched, if one has arrived. */
  deposit: { id: string; postedOnLabel: string; amountLabel: string } | null;
  /** Fees known and the sums agree, so posting can succeed. */
  ready: boolean;
  /** "Stripe expects it to reach the bank Nov 18.", while Stripe is still paying it out. */
  waitingLabel: string | null;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortIso = (iso: string) => `${MONTH_SHORT[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const usd = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: c % 100 === 0 ? 0 : 2 }).format(c / 100);

/** Stripe payouts of online dues not yet in the books, with the bank deposit each one matches (plan Phase 5). */
export async function loadStripePayouts(supabase: SupabaseClient, associationId: string): Promise<StripePayoutView[]> {
  const { data: payouts } = await supabase
    .from("stripe_payouts")
    .select("id, amount, arrival_date, status, online_dues_payments(unit_id, amount, fee, status)")
    .eq("association_id", associationId)
    .is("journal_entry_id", null)
    .in("status", ["pending", "in_transit", "paid"])
    .order("arrival_date", { ascending: true })
    .limit(50);
  type Row = {
    id: string;
    amount: string;
    arrival_date: string | null;
    status: string;
    online_dues_payments: { unit_id: string; amount: string; fee: string | null; status: string }[] | null;
  };
  const rows = ((payouts ?? []) as unknown as Row[]).filter((p) => (p.online_dues_payments ?? []).some((x) => x.status === "succeeded"));
  if (rows.length === 0) return [];

  const toCents = (v: string | number) => Math.round(Number(v) * 100);
  const earliest = rows.map((r) => r.arrival_date).filter((d): d is string => !!d).sort()[0];
  const from = earliest ? new Date(Date.parse(`${earliest}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10) : null;
  const [{ data: deposits }, { data: units }] = await Promise.all([
    from
      ? supabase
          .from("bank_transactions")
          .select("id, amount, posted_on, description")
          .eq("association_id", associationId)
          .is("journal_entry_id", null)
          .is("removed_at", null)
          .eq("pending", false)
          .gt("amount", 0)
          .gte("posted_on", from)
          .in("amount", rows.map((r) => Number(r.amount)))
          .limit(200)
      : Promise.resolve({ data: [] }),
    supabase.from("units").select("id, label").eq("association_id", associationId),
  ]);
  const label = new Map((units ?? []).map((u) => [u.id as string, u.label as string]));
  const matched = matchPayouts(
    rows.filter((r) => r.status === "paid").map((r) => ({ id: r.id, amountCents: toCents(r.amount), arrivalDate: r.arrival_date })),
    ((deposits ?? []) as { id: string; amount: string; posted_on: string; description: string }[]).map((d) => ({
      id: d.id,
      amountCents: toCents(d.amount),
      postedOn: d.posted_on,
      description: d.description,
    })),
  );

  return rows.map((r) => {
    const pays = (r.online_dues_payments ?? []).filter((x) => x.status === "succeeded");
    const s = payoutSuggestion(
      {
        payoutId: r.id,
        amountCents: toCents(r.amount),
        arrivalDate: r.arrival_date,
        payments: pays.map((x) => ({ unitId: x.unit_id, amountCents: toCents(x.amount), feeCents: x.fee === null ? null : toCents(x.fee) })),
      },
      (id) => label.get(id) ?? "A unit",
    );
    const dep = matched.get(r.id);
    return {
      payoutId: r.id,
      text: s.text,
      detail: s.detail,
      ready: s.ready,
      deposit: dep ? { id: dep.id, postedOnLabel: shortIso(dep.postedOn), amountLabel: usd(dep.amountCents) } : null,
      waitingLabel: r.status !== "paid" && r.arrival_date ? `Stripe expects it to reach the bank ${shortIso(r.arrival_date)}.` : null,
    };
  });
}

