import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted } from "@/components/ui";
import { billingEnabled, billingEnforced, planByKey } from "@/lib/billing/config";
import { computeEntitlement, factsFromRow } from "@/lib/billing/entitlement-rules";
import { billingCopy, billingDate } from "@/lib/billing/copy";
import { AdminBillingRowActions } from "./admin-billing-forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Billing admin" };

const KIND_LABELS: Record<string, string> = {
  early_access: "Early access",
  friend: "Friend",
  pilot: "Pilot",
  nonprofit: "Nonprofit",
  other: "Other",
};

interface OverviewRow {
  association_id: string;
  display_name: string;
  state_code: string;
  deleted: boolean;
  unit_count: number;
  trial_ends_at: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  plan_key: string | null;
  billing_interval: string | null;
  comp_active: boolean;
  comp_kind: string | null;
  comp_reason: string | null;
  comp_expires_on: string | null;
  past_comps: number;
  [k: string]: unknown;
}

/**
 * Platform admin only (DECISIONS #31): every association's Walkup plan, with
 * complimentary access, trial extensions and a manual refresh from Stripe.
 * Billing facts only; no association's financial data is read here.
 */
export default async function AdminBillingPage() {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) return <Restricted what="platform settings" />;

  const { data, error } = await supabase.rpc("billing_admin_overview");
  const rows = (data ?? []) as OverviewRow[];
  const enabled = billingEnabled();
  const enforced = billingEnforced();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Billing</h1>
        <p className="mt-1 text-mute">
          Every building&rsquo;s Walkup plan. Billing is {enabled ? "on" : "off"} (BILLING_ENABLED) and read-only mode is{" "}
          {enforced ? "enforced" : "not enforced"} (BILLING_ENFORCE). The status below is the honest one, whatever the switches say.
        </p>
      </div>

      <Card navy title="Associations">
        {error ? (
          <p className="text-[13px] text-bad-text">Couldn&rsquo;t load billing: {error.message}</p>
        ) : rows.length === 0 ? (
          <Empty>No associations yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const facts = factsFromRow(r);
              const ent = computeEntitlement(facts, { enabled: true, enforced });
              const copy = billingCopy(facts, ent);
              const plan = planByKey(r.plan_key);
              return (
                <li key={r.association_id} className="space-y-2 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <span className="font-medium text-ink">{r.display_name}</span>
                      <span className="ml-2 text-[12px] text-mute">
                        {r.state_code} · {r.unit_count} {r.unit_count === 1 ? "unit" : "units"}
                        {r.deleted ? " · deleted" : ""}
                      </span>
                    </div>
                    <span className="text-[13px] font-medium text-ink">{copy.label}</span>
                  </div>
                  <dl className="grid gap-x-6 gap-y-1 text-[12px] text-mute sm:grid-cols-2">
                    <div>
                      Comp:{" "}
                      {r.comp_active || r.comp_kind
                        ? `${KIND_LABELS[r.comp_kind ?? ""] ?? r.comp_kind}${r.comp_expires_on ? ` until ${billingDate(r.comp_expires_on)}` : ", no end"}${r.comp_active ? "" : " (not started or ended)"}. ${r.comp_reason ?? ""}`
                        : "none"}
                      {r.past_comps > 0 ? ` (${r.past_comps} earlier)` : ""}
                    </div>
                    <div>Trial: {r.trial_ends_at ? `ends ${billingDate(r.trial_ends_at)}` : "none"}</div>
                    <div>
                      Stripe: {r.subscription_status ?? "no subscription"}
                      {plan ? `, ${plan.name} ${r.billing_interval === "year" ? "yearly" : "monthly"}` : ""}
                    </div>
                  </dl>
                  <AdminBillingRowActions
                    associationId={r.association_id}
                    name={r.display_name}
                    compActive={r.comp_active}
                    subscriptionId={r.stripe_subscription_id}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
