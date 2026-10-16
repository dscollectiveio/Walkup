import { billingEnabled, stripeIsLive, TRIAL_DAYS } from "./config";

/**
 * Whether paid plans are really on: billing switched on AND a live Stripe key.
 * Until then (early access, or billing tested in Stripe's sandbox) the public
 * pages keep promising "free during early access"; the day both are true they
 * switch to the trial wording by themselves, so launch needs no copy change.
 * Read at render time on the server, never in a client component.
 */
export function paidPlansLive(env: NodeJS.ProcessEnv = process.env): boolean {
  return billingEnabled(env) && stripeIsLive(env);
}

/** The public pages' words about price, before and after paid plans start. No em dashes. */
export function pricingWords(live: boolean = paidPlansLive()) {
  return live
    ? {
        heroNote: `${TRIAL_DAYS}-day free trial. No card. Read-only bank access. Leave any time with your data.`,
        pricingIntro: `Start with a ${TRIAL_DAYS}-day free trial, no card needed. After that, it's one flat monthly price based on your unit count, with every feature included and no per-owner fees.`,
        calloutLead: `Try it free for ${TRIAL_DAYS} days.`,
        calloutRest: "No card to start. Choose a plan any time during the trial, and cancel whenever you like.",
        plansLabel: "Plans",
        finalLine: `Set up in an afternoon, then about 15 minutes a month. Try it free for ${TRIAL_DAYS} days`,
        authPoint: `${TRIAL_DAYS}-day free trial, no card needed`,
        signupSubtitle: `Try it free for ${TRIAL_DAYS} days. No card needed. You'll set up your building in the next two steps.`,
      }
    : {
        heroNote: "Free during early access. No card. Read-only bank access. Leave any time with your data.",
        pricingIntro:
          "Walkup is free during early access. After that, it's one flat monthly price based on your unit count, with every feature included and no per-owner fees.",
        calloutLead: "Start free today.",
        calloutRest: "We'll give you plenty of notice before paid plans begin, and nothing is ever charged unless you choose a plan.",
        plansLabel: "After early access",
        finalLine: "Set up in an afternoon, then about 15 minutes a month. Free during early access",
        authPoint: "Free during early access",
        signupSubtitle: "Free during early access. No card needed. You'll set up your building in the next two steps.",
      };
}
