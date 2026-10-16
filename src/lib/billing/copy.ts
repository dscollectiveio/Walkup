import { buildingTodayIso, longDate } from "@/lib/dates";
import { planByKey } from "./config";
import type { BillingFacts, Entitlement } from "./entitlement-rules";

/**
 * Plain words for a building's plan (subscriptions plan 2.9). Pure, shared
 * by /billing, /account and /admin/billing. No em dashes.
 */

export type BillingAction = "choose" | "manage" | null;
export type BillingTone = "good" | "attention" | "bad" | "neutral";

export interface BillingCopy {
  /** Short label, e.g. "Complimentary" or "Free trial". */
  label: string;
  headline: string;
  detail: string | null;
  action: BillingAction;
  tone: BillingTone;
}

/** A timestamp or date as "October 14, 2026", in the building's zone. */
export function billingDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return longDate(value);
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "" : longDate(buildingTodayIso(d));
}

const intervalWord = (i: string | null) => (i === "year" ? "yearly" : "monthly");

export function billingCopy(facts: BillingFacts | null, ent: Entitlement): BillingCopy {
  if (ent.status === "not_enabled") {
    const comped = facts?.compActive;
    return {
      label: "Early access: free",
      headline: comped && facts?.compKind !== "early_access"
        ? "Your building has complimentary access from Walkup."
        : "Walkup is free during early access.",
      detail:
        "Every feature is included. Paid plans aren't switched on yet. You'll get plenty of notice before they are, and nothing is ever charged unless you choose a plan.",
      action: null,
      tone: "good",
    };
  }

  const plan = planByKey(facts?.planKey)?.name ?? "Walkup";
  switch (ent.status) {
    case "comped": {
      const until = facts?.compExpiresOn ? billingDate(facts.compExpiresOn) : "";
      return {
        label: "Complimentary",
        headline: until
          ? `Your building has complimentary access from Walkup until ${until}.`
          : "Your building has complimentary access from Walkup.",
        detail: until ? "To keep going after that date, choose a plan any time before it." : null,
        action: until ? "choose" : null,
        tone: "good",
      };
    }
    case "active":
      if (facts?.cancelAtPeriodEnd) {
        return {
          label: "Ending",
          headline: `Your plan ends on ${billingDate(facts.currentPeriodEnd)}.`,
          detail: "Everything stays available to view and download after that.",
          action: "manage",
          tone: "attention",
        };
      }
      return {
        label: `${plan} plan`,
        headline: `${plan} plan, billed ${intervalWord(facts?.billingInterval ?? null)}.${
          facts?.currentPeriodEnd ? ` Next charge on ${billingDate(facts.currentPeriodEnd)}.` : ""
        }`,
        detail: null,
        action: "manage",
        tone: "good",
      };
    case "trialing":
      if (facts?.hasSubscription && facts.subscriptionStatus === "trialing") {
        return {
          label: `${plan} plan`,
          headline: `${plan} plan, trial until ${billingDate(facts.currentPeriodEnd)}.`,
          detail: null,
          action: "manage",
          tone: "good",
        };
      }
      return {
        label: "Free trial",
        headline: `Your free trial ends on ${billingDate(facts?.trialEndsAt)}.`,
        detail: "No card is needed for the trial. Choose a plan any time to keep going after it ends.",
        action: "choose",
        tone: "neutral",
      };
    case "past_due":
      return {
        label: "Payment problem",
        headline: `We couldn't process Walkup's payment. Update your payment details by ${billingDate(ent.readOnlyFrom)} to avoid an interruption.`,
        detail: "Everything keeps working in the meantime.",
        action: "manage",
        tone: "bad",
      };
    case "grace":
      return {
        label: "Plan ended",
        headline: `Your trial or plan has ended. Choose a plan by ${billingDate(ent.readOnlyFrom)} to keep adding to your records.`,
        detail: "Everything keeps working until then, and your records are always yours to view and download.",
        action: "choose",
        tone: "attention",
      };
    case "read_only":
    default:
      return {
        label: ent.enforced ? "Read-only" : "No plan",
        headline: ent.enforced
          ? "Your building is in read-only mode. Everything is still here, and you can view and download it any time. Owners are not affected."
          : "Your building has no active plan.",
        detail: ent.enforced ? null : "Choose a plan to keep using Walkup. Nothing has been switched off.",
        action: facts?.subscriptionStatus === "past_due" || facts?.subscriptionStatus === "unpaid" ? "manage" : "choose",
        tone: ent.enforced ? "bad" : "attention",
      };
  }
}
