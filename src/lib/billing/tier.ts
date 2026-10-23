import { buildingTodayIso } from "@/lib/dates";
import { PLAN_TIERS, planByKey, tierForUnits, type BillingInterval, type PlanKey } from "./config";
import { NOTICE_LEAD_DAYS } from "./notices";

/**
 * Tier changes at renewal (DECISIONS #44): a building's plan follows its unit count, but only at a renewal and only
 * after at least 30 days' email. Pure: the daily run (app/api/cron/billing-notices) asks these two questions and does
 * the work. No em dashes in the words a customer reads.
 */

const DAY = 86_400_000;

export interface TierFacts {
  planKey: string | null;
  interval: BillingInterval;
  /** The end of the current paid period, an ISO instant. */
  currentPeriodEnd: string;
  unitCount: number;
  /** When the email for a tier change at this renewal went out, if it has. */
  noticeEmailedAt: string | null;
}

function addInterval(iso: string, interval: BillingInterval, times: number): Date {
  const d = new Date(iso);
  const out = new Date(d.getTime());
  if (interval === "month") out.setUTCMonth(out.getUTCMonth() + times);
  else out.setUTCFullYear(out.getUTCFullYear() + times);
  return out;
}

/**
 * The notice a building needs now, or null. The change takes effect at the first renewal at least 31 days away, so
 * the 30 days are real even for a monthly plan (whose next renewal is always close). The key names the building, the
 * new plan and the renewal day.
 */
export function tierChangeNeeded(
  facts: TierFacts,
  now: Date = new Date(),
): { toPlan: PlanKey; effectiveOn: string; detail: string } | null {
  const current = planByKey(facts.planKey);
  const target = tierForUnits(facts.unitCount);
  if (!current || !target || current.key === target.key) return null;
  let renewal: Date | null = null;
  for (let k = 0; k <= 3; k++) {
    const candidate = addInterval(facts.currentPeriodEnd, facts.interval, k);
    if (candidate.getTime() - now.getTime() >= (NOTICE_LEAD_DAYS.tier_change + 1) * DAY) {
      renewal = candidate;
      break;
    }
  }
  if (!renewal) return null;
  const price = (t: { month: number; year: number }) => (facts.interval === "year" ? `$${t.year} a year` : `$${t.month} a month`);
  const detail =
    `Your building now has ${facts.unitCount} ${facts.unitCount === 1 ? "unit" : "units"}, which fits the ${target.name} plan. ` +
    `At your renewal your plan moves from ${current.name} (${price(current)}) to ${target.name} (${price(target)}).`;
  return { toPlan: target.key, effectiveOn: buildingTodayIso(renewal), detail };
}

/**
 * Whether the plan can be moved at Stripe now: the notice for this very renewal went out at least 30 days before it,
 * and the renewal is within the next 3 days (so the new price is on the invoice Stripe is about to make).
 */
export function tierChangeReady(facts: TierFacts, now: Date = new Date()): PlanKey | null {
  const current = planByKey(facts.planKey);
  const target = tierForUnits(facts.unitCount);
  if (!current || !target || current.key === target.key || !facts.noticeEmailedAt) return null;
  const renewal = new Date(facts.currentPeriodEnd).getTime();
  const emailed = Date.parse(facts.noticeEmailedAt);
  if (Number.isNaN(renewal) || Number.isNaN(emailed)) return null;
  if (renewal - emailed < NOTICE_LEAD_DAYS.tier_change * DAY) return null;
  const until = renewal - now.getTime();
  return until > 0 && until <= 3 * DAY ? target.key : null;
}

export const TIER_KEYS = PLAN_TIERS.map((t) => t.key);
