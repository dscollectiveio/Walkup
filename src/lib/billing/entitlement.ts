import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { billingEnabled, billingEnforced } from "./config";
import { computeEntitlement, factsFromRow, type BillingFacts, type Entitlement } from "./entitlement-rules";

/**
 * The single entitlement helper (subscriptions plan 2.7). Reads the board's
 * billing facts once per request (billing_status, 0062, which answers only to
 * the association's board) and applies BILLING_ENABLED / BILLING_ENFORCE.
 * Both switches are off by default, so today everyone is entitled and nothing
 * is read-only.
 */
export interface BillingView {
  facts: BillingFacts;
  entitlement: Entitlement;
}

/** Billing facts and entitlement for a board member of the association; null for anyone else. */
export const getBilling = cache(async (associationId: string): Promise<BillingView | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_status", { p_association_id: associationId });
  if (error) {
    console.error("[walkup-billing] status_failed", error.code ?? "-");
    return null;
  }
  const facts = factsFromRow((Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined);
  if (!facts) return null;
  return { facts, entitlement: computeEntitlement(facts, { enabled: billingEnabled(), enforced: billingEnforced() }) };
});

export const READ_ONLY_MESSAGE =
  "Your building is in read-only mode because the Walkup subscription has lapsed. Choose a plan on the Billing page to start adding again.";

export class BillingReadOnlyError extends Error {
  constructor() {
    super(READ_ONLY_MESSAGE);
    this.name = "BillingReadOnlyError";
  }
}

/**
 * For write actions, once enforcement is wired in (Phase 3). A no-op unless
 * BILLING_ENFORCE is on. Never call it from an export or download route.
 */
export async function assertCanWrite(associationId: string): Promise<void> {
  if (!billingEnforced()) return;
  const view = await getBilling(associationId);
  // Non-board callers (owners) are never the customer and are never blocked.
  if (view?.entitlement.readOnly) throw new BillingReadOnlyError();
}
