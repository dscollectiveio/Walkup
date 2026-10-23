import { Answer, Card } from "@/components/ui";
import type { Viewer } from "@/lib/owner/viewer";
import type { BillingView } from "@/lib/billing/entitlement";
import { billingCopy, billingDate } from "@/lib/billing/copy";
import { activeNotices } from "@/lib/billing/notices";
import { BillingNotices } from "@/components/home/billing-notices";
import { PLAN_TIERS, TOO_MANY_UNITS_MESSAGE, TRIAL_DAYS, planByKey, tierForUnits } from "@/lib/billing/config";
import { AutoRenewSwitch, ManageBillingButton, RefundRequest, UpgradeToYearly } from "@/app/billing/billing-buttons";
import { PlanPicker } from "../plan-picker";
import { Pill, dtClass, ddClass } from "./shared";

const DAY = 86_400_000;

/** Whole days left until an instant, never below zero. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const now = Date.now();
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.ceil((t - now) / DAY));
}

/**
 * Plan and billing (subscriptions plan 2.9), for the board. Board admins
 * choose, change and manage Walkup's plan here; other board members see the
 * status only. Owners and the accountant never see this tab. Walkup's fee is
 * separate from the association's money.
 */
export function BillingTab({ viewer, view, checkout }: { viewer: Viewer; view: BillingView | null; checkout?: string }) {
  if (!view) {
    return (
      <Card navy title="Your plan">
        <p className="text-[13px] text-mute">We couldn&rsquo;t load your building&rsquo;s plan. Reload the page in a minute.</p>
      </Card>
    );
  }
  const { facts, entitlement } = view;
  const copy = billingCopy(facts, entitlement);
  const tier = tierForUnits(facts.unitCount);
  const currentPlan = planByKey(facts.planKey);
  const enabled = entitlement.enabled;
  const isAdmin = viewer.isBoardAdmin;
  const canAct = isAdmin && enabled;
  const onWalkupTrial = enabled && entitlement.status === "trialing" && !facts.hasSubscription;
  const trialLeft = onWalkupTrial ? daysUntil(facts.trialEndsAt) : null;
  const freeUntil = onWalkupTrial ? facts.trialEndsAt : facts.compActive ? facts.compExpiresOn : null;
  const freeDaysLeft = daysUntil(freeUntil);
  const chargeNote =
    freeUntil && freeDaysLeft !== null && freeDaysLeft > 2
      ? `You won't be charged until ${billingDate(freeUntil)}, when your free time ends.`
      : "Your first payment is taken today.";

  const showPicker = enabled && copy.action === "choose";
  const showYearly =
    canAct && currentPlan && facts.hasSubscription && facts.subscriptionStatus === "active" && facts.billingInterval === "month" && !facts.cancelAtPeriodEnd;
  const intervalWord = facts.billingInterval === "year" ? "Yearly" : facts.billingInterval === "month" ? "Monthly" : null;
  const price = currentPlan ? (facts.billingInterval === "year" ? `$${currentPlan.year} a year` : `$${currentPlan.month} a month`) : null;

  return (
    <>
      {checkout === "done" ? (
        <Answer status="good" headline="Thanks. Stripe is confirming your plan." detail="It shows here within a minute. Reload the page if it hasn't." />
      ) : checkout === "cancelled" ? (
        <Answer status="neutral" headline="Checkout was cancelled." detail="Nothing was charged." />
      ) : null}

      <BillingNotices notices={activeNotices(view.notices, entitlement.computed)} />

      <Card navy title="Your plan" hint={`Walkup's own plan for ${viewer.associationName}. Owners never pay for Walkup.`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[20px] font-bold tracking-tight text-ink">{copy.label}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-mute">
              {copy.headline === copy.label ? null : <>{copy.headline} </>}
              {copy.detail}
            </p>
          </div>
          <Pill tone={copy.tone === "neutral" ? "brand" : copy.tone}>
            {entitlement.status === "not_enabled" ? "Free" : entitlement.status === "trialing" ? "Trial" : copy.label}
          </Pill>
        </div>

        {trialLeft !== null ? (
          <div className="mt-4">
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="font-semibold text-ink">
                {trialLeft === 0 ? "Your free trial ends today" : `${trialLeft} ${trialLeft === 1 ? "day" : "days"} left of your free trial`}
              </span>
              <span className="text-mute">Ends {billingDate(facts.trialEndsAt)}</span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-fill"
              role="progressbar"
              aria-label="Free trial used"
              aria-valuemin={0}
              aria-valuemax={TRIAL_DAYS}
              aria-valuenow={Math.max(0, TRIAL_DAYS - Math.min(trialLeft, TRIAL_DAYS))}
            >
              <div
                className="h-full rounded-full bg-brass transition-[width] duration-700"
                style={{ width: `${Math.round((Math.max(0, TRIAL_DAYS - Math.min(trialLeft, TRIAL_DAYS)) / TRIAL_DAYS) * 100)}%` }}
              />
            </div>
          </div>
        ) : null}

        <dl className="mt-5 grid gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-4">
          <div>
            <dt className={dtClass}>Plan</dt>
            <dd className={ddClass}>{currentPlan ? currentPlan.name : tier ? `${tier.name} (fits)` : "Custom"}</dd>
          </div>
          <div>
            <dt className={dtClass}>Price</dt>
            <dd className={ddClass}>{price ?? (tier ? `$${tier.month} a month` : "Ask us")}</dd>
          </div>
          <div>
            <dt className={dtClass}>Units on file</dt>
            <dd className={ddClass}>{facts.unitCount}</dd>
          </div>
          <div>
            <dt className={dtClass}>
              {facts.hasSubscription && facts.currentPeriodEnd
                ? facts.cancelAtPeriodEnd
                  ? "Ends on"
                  : facts.subscriptionStatus === "trialing"
                    ? "First payment"
                    : "Next payment"
                : onWalkupTrial
                  ? "Trial ends"
                  : "Billing"}
            </dt>
            <dd className={ddClass}>
              {facts.hasSubscription && facts.currentPeriodEnd
                ? billingDate(facts.currentPeriodEnd)
                : onWalkupTrial
                  ? billingDate(facts.trialEndsAt)
                  : !enabled
                    ? "Free for now"
                    : (intervalWord ?? "None")}
            </dd>
          </div>
        </dl>

        {isAdmin && enabled && facts.stripeCustomerId ? (
          <div className="mt-5 border-t border-line pt-5">
            <ManageBillingButton />
          </div>
        ) : !isAdmin ? (
          <p className="mt-5 border-t border-line pt-5 text-[13px] text-mute">
            Only a board admin can choose or change Walkup&rsquo;s plan{viewer.boardContact.name ? `. Ask ${viewer.boardContact.name}.` : "."}
          </p>
        ) : null}
      </Card>

      {facts.hasSubscription && facts.currentPeriodEnd && enabled && ["active", "trialing"].includes(facts.subscriptionStatus ?? "") ? (
        <Card navy title="Auto-renew" hint="Plans renew by themselves. You can turn that off here.">
          {isAdmin ? (
            <AutoRenewSwitch
              renewing={!facts.cancelAtPeriodEnd}
              date={billingDate(facts.currentPeriodEnd)}
              interval={facts.billingInterval === "year" ? "year" : "month"}
            />
          ) : (
            <p className="text-[13px] text-mute">
              Auto-renew is {facts.cancelAtPeriodEnd ? "off" : "on"}. Only a board admin can change it.
            </p>
          )}
        </Card>
      ) : null}

      {isAdmin && enabled && facts.billingInterval === "year" && view.refund && (view.refund.eligible || view.refund.openKind) ? (
        <Card navy title="Refund" hint="A yearly charge can be refunded in full for 14 days.">
          {view.refund.openKind ? (
            <p className="text-[13px] text-ink" role="status">
              {view.refund.openKind === "offer"
                ? "You took our offer of 2 free months. We'll email you to confirm it."
                : "Your refund request is with us. We'll email you when it is done."}
            </p>
          ) : view.refund.until ? (
            <RefundRequest until={billingDate(view.refund.until)} />
          ) : null}
        </Card>
      ) : null}

      {showYearly && currentPlan ? (
        <UpgradeToYearly
          planName={currentPlan.name}
          month={currentPlan.month}
          year={currentPlan.year}
          renewsOn={facts.currentPeriodEnd ? billingDate(facts.currentPeriodEnd) : "its next date"}
        />
      ) : null}

      {showPicker || !enabled ? (
        <Card
          navy
          title={!enabled ? "Prices when paid plans start" : "Choose your plan"}
          hint={!enabled ? "Nothing to choose yet. You'll get plenty of notice first." : "One flat price per building, set by its unit count."}
        >
          {tier ? (
            <PlanPicker tiers={PLAN_TIERS} fitKey={tier.key} unitCount={facts.unitCount} canChoose={canAct} chargeNote={chargeNote} />
          ) : (
            <p className="text-[13px] text-ink">{TOO_MANY_UNITS_MESSAGE}</p>
          )}
          {showPicker && !isAdmin ? <p className="mt-3 text-[12px] text-mute">A board admin chooses the plan.</p> : null}
        </Card>
      ) : null}

      <Card navy title="How Walkup's fee works">
        <dl className="divide-y divide-line">
          {[
            ["What do I get?", "Every feature on every plan: bank feed, statements, dues, taxes, insurance, repairs, documents and owner access. Plans differ only by building size."],
            ["What if we add units?", "Your building moves to the plan for its size at the next renewal, never in the middle of a term."],
            ["Monthly or yearly?", "Yearly costs the same as 10 months. You can switch from monthly to yearly here any time, and the unused part of the month is credited."],
            ["Whose money pays for it?", "The association's, like any other bill. The charge shows in your bank feed from Walkup; file it there. Walkup never moves dues, bills or reserves."],
            ["How do I cancel?", "Manage billing opens Stripe, where you can cancel. The plan runs to the end of the period you paid for."],
            ["What happens to our records?", "They're always yours to view and download, whatever happens with the plan."],
          ].map(([q, a]) => (
            <div key={q} className="py-3 first:pt-0 last:pb-0">
              <dt className="text-[14px] font-semibold text-ink">{q}</dt>
              <dd className="mt-0.5 text-[13px] leading-relaxed text-mute">{a}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}
