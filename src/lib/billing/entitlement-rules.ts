import { GRACE_DAYS } from "./config";

/**
 * The one set of rules for whether a building has full use of Walkup
 * (subscriptions plan 2.4). Pure, so it is table-tested; the database only
 * supplies facts (billing_status / billing_admin_overview, 0062).
 *
 *   comped     an active complimentary grant from a platform admin
 *   active     a paid Stripe subscription in good standing
 *   trialing   Walkup's own free trial (no card), or a Stripe trial
 *   past_due   a payment failed; Stripe is retrying; still fully working
 *              until GRACE_DAYS after the first failure
 *   grace      the trial or the paid plan has ended; still fully working
 *              until GRACE_DAYS after that
 *   read_only  past all of the above: everything stays viewable and
 *              downloadable, adding pauses (only when enforced)
 *
 * Two switches sit on top (src/lib/billing/config.ts), both off by default:
 * BILLING_ENABLED off means status "not_enabled" and everyone is entitled;
 * BILLING_ENFORCE off means the honest status is shown but nothing becomes
 * read-only.
 */

export type ComputedStatus = "comped" | "trialing" | "active" | "past_due" | "grace" | "read_only";
export type BillingStatus = ComputedStatus | "not_enabled";

export interface BillingFacts {
  trialEndsAt: string | null;
  subscriptionStatus: string | null;
  planKey: string | null;
  billingInterval: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  paymentFailedAt: string | null;
  compActive: boolean;
  compKind: string | null;
  compExpiresOn: string | null;
  unitCount: number;
  hasSubscription: boolean;
  stripeCustomerId: string | null;
}

export interface Entitlement {
  /** What the app acts on: "not_enabled" while BILLING_ENABLED is off. */
  status: BillingStatus;
  /** The honest answer from the facts, whatever the switches say. */
  computed: ComputedStatus;
  /** Full use of Walkup. Always true unless BILLING_ENFORCE is on. */
  entitled: boolean;
  readOnly: boolean;
  enabled: boolean;
  enforced: boolean;
  /** For past_due and grace: when read-only would begin. */
  readOnlyFrom: Date | null;
}

const DAY = 86_400_000;
const time = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

export function computeStatus(
  facts: BillingFacts | null,
  now: Date = new Date(),
  graceDays: number = GRACE_DAYS,
): { status: ComputedStatus; readOnlyFrom: Date | null } {
  if (!facts) return { status: "read_only", readOnlyFrom: null };
  const t = now.getTime();
  const grace = graceDays * DAY;

  if (facts.compActive) return { status: "comped", readOnlyFrom: null };

  const sub = facts.subscriptionStatus;
  if (sub === "active") return { status: "active", readOnlyFrom: null };
  if (sub === "trialing") return { status: "trialing", readOnlyFrom: null };

  if (sub === "past_due" || sub === "unpaid") {
    const from = time(facts.paymentFailedAt) ?? time(facts.currentPeriodEnd) ?? t;
    const until = from + grace;
    return t < until ? { status: "past_due", readOnlyFrom: new Date(until) } : { status: "read_only", readOnlyFrom: null };
  }

  const trialEnd = time(facts.trialEndsAt);
  if (trialEnd !== null && t < trialEnd) return { status: "trialing", readOnlyFrom: null };

  // A lapse: the trial ended with no plan, or a plan ended (canceled after its
  // paid period, incomplete_expired, paused). Grace counts from the later one.
  const ended = sub ? time(facts.currentPeriodEnd) : null;
  const lapse = Math.max(trialEnd ?? -Infinity, ended ?? -Infinity);
  if (Number.isFinite(lapse) && t < lapse + grace) {
    return { status: "grace", readOnlyFrom: new Date(lapse + grace) };
  }
  return { status: "read_only", readOnlyFrom: null };
}

export function computeEntitlement(
  facts: BillingFacts | null,
  opts: { enabled: boolean; enforced: boolean; now?: Date; graceDays?: number },
): Entitlement {
  const { status: computed, readOnlyFrom } = computeStatus(facts, opts.now, opts.graceDays);
  const enabled = opts.enabled;
  const enforced = enabled && opts.enforced;
  if (!enabled) {
    return { status: "not_enabled", computed, entitled: true, readOnly: false, enabled, enforced, readOnlyFrom: null };
  }
  const readOnly = enforced && computed === "read_only";
  return { status: computed, computed, entitled: !readOnly, readOnly, enabled, enforced, readOnlyFrom };
}

/** Maps a billing_status / billing_admin_overview row to facts. */
export function factsFromRow(row: Record<string, unknown> | null | undefined): BillingFacts | null {
  if (!row) return null;
  const s = (k: string) => (typeof row[k] === "string" ? (row[k] as string) : null);
  return {
    trialEndsAt: s("trial_ends_at"),
    subscriptionStatus: s("subscription_status"),
    planKey: s("plan_key"),
    billingInterval: s("billing_interval"),
    currentPeriodEnd: s("current_period_end"),
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    paymentFailedAt: s("payment_failed_at"),
    compActive: row.comp_active === true,
    compKind: s("comp_kind"),
    compExpiresOn: s("comp_expires_on"),
    unitCount: typeof row.unit_count === "number" ? row.unit_count : Number(row.unit_count ?? 0) || 0,
    hasSubscription: row.has_subscription === true || typeof row.stripe_subscription_id === "string",
    stripeCustomerId: s("stripe_customer_id"),
  };
}
