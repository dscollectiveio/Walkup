import { PLANS, SALES_EMAIL } from "@/lib/site-config";

/**
 * Walkup's own subscription (docs/specs/subscriptions-plan.md). Pure
 * configuration: the plan tiers come from the same PLANS list the landing page
 * renders, and Stripe price ids come from the environment, one per tier and
 * interval, so test-mode and live-mode prices are a Vercel setting, not code.
 *
 * Billing is Walkup's fee only. Nothing in src/lib/billing reads or writes the
 * association's books, bank feed or dues (a unit test enforces it).
 */

export type PlanKey = "starter" | "building" | "association";
export type BillingInterval = "month" | "year";

export interface PlanTier {
  key: PlanKey;
  name: string;
  /** Inclusive unit range. Starter also covers a building with fewer than 2 units on file. */
  minUnits: number;
  maxUnits: number;
  /** Whole dollars, for display only. Stripe holds the real price. */
  month: number;
  year: number;
}

const KEYS: PlanKey[] = ["starter", "building", "association"];
const RANGES: [number, number][] = [
  [0, 6],
  [7, 12],
  [13, 20],
];

export const PLAN_TIERS: PlanTier[] = PLANS.map((p, i) => ({
  key: KEYS[i],
  name: p.name,
  minUnits: RANGES[i][0],
  maxUnits: RANGES[i][1],
  month: p.month,
  year: p.year,
}));

export const MAX_SELF_SERVE_UNITS = 20;

/** Days of free trial a new association gets. Must match the trigger in 0064_trial_14_days.sql. */
export const TRIAL_DAYS = 14;

/** Days after a failed payment (or a lapse) during which everything keeps working. */
export const GRACE_DAYS = 14;

export const TOO_MANY_UNITS_MESSAGE = `Walkup's plans cover up to ${MAX_SELF_SERVE_UNITS} units. Email ${SALES_EMAIL} and we'll set you up.`;

/** The tier for a unit count, or null above the largest tier. */
export function tierForUnits(unitCount: number): PlanTier | null {
  const n = Math.max(0, Math.floor(unitCount));
  return PLAN_TIERS.find((t) => n >= t.minUnits && n <= t.maxUnits) ?? null;
}

export function planByKey(key: string | null | undefined): PlanTier | null {
  return PLAN_TIERS.find((t) => t.key === key) ?? null;
}

/** Env var holding the Stripe price id for a tier and interval, e.g. STRIPE_PRICE_STARTER_MONTH. */
export function priceEnvName(key: PlanKey, interval: BillingInterval): string {
  return `STRIPE_PRICE_${key.toUpperCase()}_${interval.toUpperCase()}`;
}

export function priceIdFor(key: PlanKey, interval: BillingInterval, env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env[priceEnvName(key, interval)]?.trim();
  return v && /^price_[A-Za-z0-9_]+$/.test(v) ? v : null;
}

/** Reverse lookup for the webhook: which tier and interval a Stripe price id is. */
export function planForPriceId(
  priceId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { key: PlanKey; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const key of KEYS) {
    for (const interval of ["month", "year"] as const) {
      if (priceIdFor(key, interval, env) === priceId) return { key, interval };
    }
  }
  return null;
}

const on = (v: string | undefined) => v === "1" || v?.toLowerCase() === "true" || v?.toLowerCase() === "on";

/**
 * BILLING_ENABLED: billing pages show real status and the Choose a plan /
 * Manage billing buttons work. Off by default: everyone is treated as entitled.
 */
export function billingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return on(env.BILLING_ENABLED);
}

/**
 * BILLING_ENFORCE: a building whose access has lapsed becomes read-only. Off
 * by default, and meaningless unless BILLING_ENABLED is also on.
 */
export function billingEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return billingEnabled(env) && on(env.BILLING_ENFORCE);
}

/** Why Stripe cannot be used right now, in plain words, or null when it can. */
export function stripeConfigProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) return "Payments are not set up yet.";
  if (!/^(sk|rk)_(test|live)_/.test(key)) return "Payments are not set up correctly.";
  // A live key anywhere but production would charge real cards from a preview or laptop.
  if (/^(sk|rk)_live_/.test(key) && env.VERCEL_ENV !== "production") return "Live payments only run on walkuphoa.com.";
  return null;
}

/** Whether the configured key is a live-mode key (events must then be livemode too). */
export function stripeIsLive(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY?.trim() ?? "");
}
