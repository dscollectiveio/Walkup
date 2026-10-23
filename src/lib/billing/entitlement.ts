import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { billingEnabled, billingEnforced } from "./config";
import { computeEntitlement, factsFromRow, type BillingFacts, type Entitlement } from "./entitlement-rules";
import { noticeFromRow, readOnlyNoticeGiven, type BillingNotice } from "./notices";

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
  /** The notices the Terms promise, newest effective date first (migration 0084). */
  notices: BillingNotice[];
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
  const noticeRows = await supabase.rpc("billing_notices_for", { p_association_id: associationId });
  if (noticeRows.error) console.error("[walkup-billing] notices_failed", noticeRows.error.code ?? "-");
  const notices = ((noticeRows.data ?? []) as Record<string, unknown>[]).map(noticeFromRow).filter((n): n is BillingNotice => n !== null);
  return {
    facts,
    notices,
    entitlement: computeEntitlement(facts, {
      enabled: billingEnabled(),
      enforced: billingEnforced(),
      // If the notices could not be read, do not make anyone read-only on a guess.
      noticeGiven: noticeRows.error ? false : readOnlyNoticeGiven(notices),
    }),
  };
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
