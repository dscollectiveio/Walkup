import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Answer, Card } from "@/components/ui";
import { ViewerUnavailable } from "@/components/owner/viewer-unavailable";
import { getViewer } from "@/lib/owner/viewer";
import { getBilling } from "@/lib/billing/entitlement";
import { billingCopy, billingDate } from "@/lib/billing/copy";
import { MAX_SELF_SERVE_UNITS, TOO_MANY_UNITS_MESSAGE, planByKey, tierForUnits } from "@/lib/billing/config";
import { ChoosePlanForm, ManageBillingButton } from "./billing-buttons";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Billing" };

/**
 * Walkup's own plan for this building (subscriptions plan 2.9). Board admins
 * see the status and the Stripe buttons; other board members see the status
 * only; owners and the accountant never see billing (sent to their account
 * page). Walkup's fee is separate from the association's money.
 */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return <ViewerUnavailable />;
  if (!viewer.isBoard) redirect("/account");
  const sp = await searchParams;

  const view = await getBilling(viewer.associationId);
  if (!view) {
    return (
      <div className="mx-auto w-full max-w-[760px] space-y-6">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Billing</h1>
        <p className="text-mute">We couldn&rsquo;t load your building&rsquo;s plan. Reload the page in a minute.</p>
      </div>
    );
  }

  const { facts, entitlement } = view;
  const copy = billingCopy(facts, entitlement);
  const tier = tierForUnits(facts.unitCount);
  const currentPlan = planByKey(facts.planKey);
  const canAct = viewer.isBoardAdmin && entitlement.enabled;

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Billing</h1>
        <p className="mt-1 text-mute">Walkup&rsquo;s plan for {viewer.associationName}.</p>
      </div>

      {sp.checkout === "done" ? (
        <Answer status="good" headline="Thanks. Stripe is confirming your plan." detail="It shows here within a minute. Reload the page if it hasn't." />
      ) : sp.checkout === "cancelled" ? (
        <Answer status="neutral" headline="Checkout was cancelled." detail="Nothing was charged." />
      ) : null}

      <Card navy title="Your plan">
        <Answer status={copy.tone} headline={copy.headline} detail={copy.detail ?? undefined} />

        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">Status</dt>
            <dd className="mt-0.5 text-[15px] text-ink">{copy.label}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">Units on file</dt>
            <dd className="mt-0.5 text-[15px] text-ink">{facts.unitCount}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">{currentPlan ? "Plan" : "Plan for that size"}</dt>
            <dd className="mt-0.5 text-[15px] text-ink">
              {currentPlan ? currentPlan.name : tier ? `${tier.name}, $${tier.month} a month or $${tier.year} a year` : `More than ${MAX_SELF_SERVE_UNITS} units`}
            </dd>
          </div>
          {facts.currentPeriodEnd && facts.hasSubscription ? (
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">
                {facts.cancelAtPeriodEnd ? "Ends on" : "Renews on"}
              </dt>
              <dd className="mt-0.5 text-[15px] text-ink">{billingDate(facts.currentPeriodEnd)}</dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-5 border-t border-line pt-5">
          {!viewer.isBoardAdmin ? (
            <p className="text-[13px] text-mute">Only a board admin can choose or change Walkup&rsquo;s plan.</p>
          ) : !entitlement.enabled ? (
            <p className="text-[13px] text-mute">
              There is nothing to set up. When paid plans start, you&rsquo;ll choose one here.
            </p>
          ) : copy.action === "manage" && facts.stripeCustomerId ? (
            <ManageBillingButton />
          ) : copy.action === "choose" && canAct ? (
            tier ? (
              <ChoosePlanForm planName={tier.name} month={tier.month} year={tier.year} />
            ) : (
              <p className="text-[13px] text-ink">{TOO_MANY_UNITS_MESSAGE}</p>
            )
          ) : facts.stripeCustomerId ? (
            <ManageBillingButton />
          ) : (
            <p className="text-[13px] text-mute">Nothing to do right now.</p>
          )}
        </div>
      </Card>

      <Card navy title="How Walkup's fee works">
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink">
          <li>
            One plan per building, sized by unit count. A building that adds units moves up at renewal, never mid-term.
          </li>
          <li>
            Walkup&rsquo;s fee is separate from your association&rsquo;s money. Walkup never moves dues, bills or reserves.
          </li>
          <li>
            The charge shows on your bank statement from Walkup. File it like any other bill when it appears in your bank
            feed.
          </li>
          <li>Owners never pay for Walkup and never see billing.</li>
          <li>Your records are always yours to view and download, whatever happens with the plan.</li>
        </ul>
      </Card>
    </div>
  );
}
