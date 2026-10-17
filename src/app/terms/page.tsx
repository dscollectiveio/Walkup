import Link from "next/link";
import { PolicyList, PolicyPage, PolicySection } from "@/components/policy-page";
import { CONTACT_EMAIL, FOUNDING, PLANS, SALES_EMAIL, SUPPORT_EMAIL, operatorName } from "@/lib/site-config";
import { GRACE_DAYS, MAX_SELF_SERVE_UNITS, TRIAL_DAYS } from "@/lib/billing/config";

export const metadata = { title: "Terms of Service | Walkup" };

const link = "text-ink underline-offset-2 hover:underline";

/**
 * The terms for using Walkup. Plain English on purpose, and every statement
 * here has to stay true of the app as it ships (it never moves money, sends
 * email only when a board administrator has approved it, gives no tax, legal or insurance advice). Prices and
 * early-access wording come from src/lib/site-config.ts so they can't drift
 * from the landing page. Reviewed by Doug, not yet by a lawyer: see
 * docs/DECISIONS.md. Public (PUBLIC_PATHS in src/lib/supabase/proxy.ts) and
 * linked from sign-up.
 */
export default function TermsPage() {
  return (
    <PolicyPage
      title="Terms of Service"
      subtitle="Last updated 2026-10-17."
      intro={
        <>
          These terms are the agreement between you and {operatorName} (&ldquo;Walkup&rdquo;, &ldquo;we&rdquo;) about
          using Walkup, software that helps self-managed condominium associations keep their books, dues, budget and
          tax paperwork. By creating an account or using Walkup, you agree to them. If you don&rsquo;t agree, please
          don&rsquo;t use it. How we handle information is in the{" "}
          <Link href="/privacy" className={link}>
            Privacy Policy
          </Link>
          .
        </>
      }
    >
      <PolicySection title="1. Who can use Walkup">
        <PolicyList
          items={[
            "You must be at least 18 and able to enter into this agreement.",
            "If you use Walkup for a condominium association, you confirm that you are authorised to act for it (for example, as a board member, officer, or accountant the board has invited).",
            "Owners can sign in to see their own balance, statements and the notices the board posts. The board decides who is an owner of which unit.",
            "Walkup is built for associations in Illinois today. You may use it elsewhere at your own risk, but its tax and filing guidance is written for Illinois.",
          ]}
        />
      </PolicySection>

      <PolicySection title="2. Your account">
        <PolicyList
          items={[
            "Every account uses two-step sign-in. Keep your password and your authenticator app to yourself, and tell us at once if you think someone else has access.",
            "You are responsible for what happens under your account, and for who you invite. Board administrators decide who can see what inside their association.",
            "Give us accurate information and keep it up to date.",
          ]}
        />
      </PolicySection>

      <PolicySection title="3. What Walkup does, and what it doesn't">
        <p>Walkup is record-keeping software. It records, reminds, and prepares. You decide.</p>
        <PolicyList
          items={[
            // DECISIONS #44: the wording is about the association's money; Walkup's own fee is separate.
            "Walkup never holds or moves the association's money. Bank access through Plaid is read-only, and owners pay the association the way they do today. The only money Walkup receives is its own subscription fee, paid through Stripe.",
            "Walkup sends email only after a board administrator has approved it, either by pressing Send on a batch they reviewed or by switching on a standing reminder rule that they can pause at any time. Each email says who it is from, can be unsubscribed from, and is recorded in a log the board can read. Walkup does not send email to anyone who has unsubscribed, and never puts bank account details in an email. Everything else, such as messages to contractors or insurance agents, opens as a draft in your own email app.",
            "Walkup is not a tax adviser, accountant, lawyer, or insurance broker, and nothing in it is tax, legal, accounting or insurance advice. Tax figures, forms, deadlines and coverage notes are prepared from the information you give us and from sources we link to. Rules change and our information can be out of date or wrong. Have a qualified professional review anything before you file it, sign it, or rely on it.",
            "Walkup does not file anything with the IRS, the State of Illinois, or anyone else. Filing is yours to do.",
            "Insurers, agencies and contractors that Walkup shows you are found from public sources or saved by your board. Showing one is not an endorsement, a recommendation to buy, or a check of their licence, insurance, or quality. Check them yourself.",
          ]}
        />
      </PolicySection>

      <PolicySection title="4. Your information">
        <PolicyList
          items={[
            "Your association's records are yours. We don't claim ownership of anything you put into Walkup.",
            "You give us permission to store, process and display that information only as needed to run Walkup for you, including with the service providers named in the Privacy Policy.",
            "You are responsible for the accuracy of what you enter, and for having the right to enter it. That includes personal information about owners and contractors.",
            "Your board is responsible for what it sends through Walkup and for having a reason to contact each person. Every email has an unsubscribe link at the bottom that works without signing in.",
            "You can download your financial statements, budget, tax forms and documents at any time, ask us for a copy of the rest of your association's records, and ask us to delete your information. What we keep and for how long is in the Data Retention and Deletion Policy under Policies.",
          ]}
        />
      </PolicySection>

      <PolicySection title="5. Automated features and outside services">
        <p>
          Some features use outside services, such as Plaid to read bank transactions, Google to find nearby
          contractors and suggest addresses, and Anthropic&rsquo;s Claude to read uploaded documents, suggest
          categories, and draft text. Those services have their own terms. Results from automated features can be
          wrong or incomplete. Check them before you act on them. You are always the one who approves a posting, a
          figure, or a message. Resend delivers the emails a board administrator approves, and the account emails Walkup sends.
        </p>
      </PolicySection>

      <PolicySection title="6. Acceptable use">
        <p>Please don&rsquo;t:</p>
        <PolicyList
          items={[
            "use Walkup for anything unlawful, or to store information you have no right to hold;",
            "try to get into another association's information or any part of Walkup you haven't been given access to;",
            "disrupt or overload the service, or probe it for weaknesses outside the good-faith research described on our Security page;",
            "copy, resell or build a competing service from Walkup, or use it to send spam.",
          ]}
        />
        <p>
          Security researchers acting in good faith should follow the{" "}
          <Link href="/security#reporting" className={link}>
            reporting guidelines
          </Link>
          .
        </p>
      </PolicySection>

      {/*
        Billing terms (docs/specs/subscriptions-plan.md, DECISIONS #41). Draft
        for lawyer review before live billing. Numbers come from
        src/lib/billing/config.ts and PLANS so they can't drift from the app.
      */}
      <PolicySection title="7. Plans and payment">
        <p>
          This section covers paying for Walkup. A board administrator agrees to it when choosing a plan, on
          Stripe&rsquo;s checkout page, before anything is charged.
        </p>
        <PolicyList
          items={[
            // DECISIONS #44: the customer is the association; the board administrator confirms their authority at checkout.
            "Who pays. Our customer is the association. Each association has one subscription. Only a board administrator can choose, pay for, or cancel it, and by doing so they confirm they are authorized to act for the association. Owners never pay Walkup.",
            "How you pay. Payment happens on pages run by Stripe, our payment processor. The board administrator enters the payment details there, with Stripe. Walkup never sees or stores card or bank account numbers.",
            "Walkup's fee is separate from the association's own money. Section 3 still applies: Walkup never holds or moves the association's funds, and paying for Walkup gives it no access to them.",
            `Prices. ${PLANS.map((p) => `${p.name} (${p.units}): $${p.month} a month or $${p.year} a year`).join("; ")}. Prices are in US dollars and every plan includes every feature. They are the prices shown on our website, and Stripe's checkout page shows the price before you pay. For more than ${MAX_SELF_SERVE_UNITS} units, email ${SALES_EMAIL}.`,
            // DECISIONS #44: 30 days' email notice before a renewal moves to a different tier.
            "Your plan's tier follows the number of units your association has in Walkup. If that number moves you into a different tier, we will email the board administrators at least 30 days before the renewal, and the new tier's price applies from that renewal. It never changes in the middle of a period you have already paid for.",
            `Free trial. A new association gets a ${TRIAL_DAYS}-day free trial, starting when it is created in Walkup. No card is needed. If the trial ends without a plan, nothing is charged.`,
            // DECISIONS #44: renewal terms stated plainly, a yearly reminder, and cancelling online in one step.
            "Automatic renewal. A plan renews automatically at the end of each month or year, depending on what you chose, and is charged to the payment method on file at the price in effect then. It keeps renewing until a board administrator cancels it. Stripe's checkout page shows this before you pay. For a yearly plan we email the board administrators about 30 days before it renews, so you can cancel first. You can cancel online at any time, in the same place you chose the plan.",
            "Cancelling. A board administrator can cancel at any time under Manage billing on Walkup's Billing page. Cancelling stops the next renewal. Your plan keeps working until the end of the period you have paid for, then ends.",
            // DECISIONS #44: yearly charges are refundable for 14 days; monthly charges are not.
            `Refunds. If you are charged for a yearly plan, whether the first payment or a renewal, you can ask for a full refund within 14 days of the charge by emailing ${SUPPORT_EMAIL}. Monthly payments are not refundable, and we don't give partial refunds for unused time, unless the law requires it.`,
            `Failed payments. If a payment fails, Stripe will try it again and email the address on the account, and Walkup shows a notice on the Billing page. Everything keeps working for ${GRACE_DAYS} days after the first failed payment.`,
            // DECISIONS #44: at least 7 days' written notice before read-only starts, on top of the grace period. Enforcement is still off.
            `Read-only. If a payment is still unpaid ${GRACE_DAYS} days after it first failed, or ${GRACE_DAYS} days have passed since a trial or plan ended without a new plan, we may make the association's account read-only. We will email the board administrators and show a notice in Walkup at least 7 days before that starts. Read-only never stops the board from viewing or downloading the association's records, and owners keep their access. Adding new records and some features pause until a plan is paid for. Paying restores full use.`,
            "Ending a plan, or a trial, does not delete your association's records. What we keep and for how long is in the Data Retention and Deletion Policy.",
            // DECISIONS #44: 30 days, by email and in Walkup.
            "Price changes. We may change our prices. We will tell the board administrators by email, and show a notice in Walkup, at least 30 days before a new price applies to you. It starts from your next renewal after that. You can cancel before then.",
            // Still pending with the CPA (Chicago lease transaction tax, DECISIONS #44). Kept general on purpose.
            "Taxes. Prices do not include taxes. Where the law requires us to collect a tax, we will add it to the charge.",
            // DECISIONS #44: at least 90 days' notice before early-access free use ends.
            "Complimentary access. Associations that joined during early access use Walkup free, with every feature, until we tell them otherwise. We will give at least 90 days' notice by email to the board administrators before that changes, and you won't be charged unless a board administrator chooses a plan. We may also give other associations complimentary access, for a set time or until we give notice.",
            // DECISIONS #44: the founding offer is the first 12 months free, for the first 25 associations including early-access ones.
            `Founding offer. The first ${FOUNDING.associations} associations to join, counting those already in early access, use Walkup free for their first ${FOUNDING.months} months. After that the plan for their size applies, and we will email the board administrators at least 30 days before the first charge.`,
            `Questions about a charge: email ${SUPPORT_EMAIL}.`,
          ]}
        />
      </PolicySection>

      <PolicySection title="8. Changes, suspension and ending your account">
        <PolicyList
          items={[
            "We are improving Walkup all the time. Features may change, and early-access features may be added, changed or removed.",
            "You can stop using Walkup whenever you like. Export what you need first.",
            "We may suspend or close an account that breaks these terms, puts others at risk, or is used unlawfully. Where we reasonably can, we will tell you why and give you time to export your information.",
            // DECISIONS #44: amounts owed under section 7 survive.
            "Sections that by their nature should continue after an account ends (such as 3, 7 for any amount owed, 9, 10 and 12) do.",
          ]}
        />
      </PolicySection>

      <PolicySection title="9. No warranty">
        <p>
          Walkup is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. We work hard to keep it accurate and
          running, but we don&rsquo;t promise that it will be uninterrupted, error-free, or fit for a particular
          purpose, or that any figure, deadline or suggestion it shows is correct or complete. Some places don&rsquo;t
          allow these limits, so they may apply to you only to the extent the law permits.
        </p>
      </PolicySection>

      <PolicySection title="10. Limit of liability">
        <p>
          To the extent the law allows, Walkup will not be liable for indirect, incidental, special or consequential
          losses, or for lost profits, penalties, interest or fees from a missed or late filing, payment or deadline,
          or for decisions made on the strength of information in Walkup. Our total liability for any claim relating
          to Walkup is limited to the greater of what you paid us in the twelve months before the claim, or $100.
          Nothing in these terms limits liability that can&rsquo;t be limited by law.
        </p>
      </PolicySection>

      <PolicySection title="11. Changes to these terms">
        <p>
          We may update these terms. For a change that matters, we will tell you by email or inside Walkup before it
          takes effect. If you keep using Walkup after that, you accept the new terms. The date at the top shows when
          they were last updated.
        </p>
      </PolicySection>

      <PolicySection title="12. Governing law and disputes">
        <p>
          These terms are governed by the laws of the State of Illinois, without regard to its conflict-of-law rules.
          If we have a disagreement, please write to us first at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
            {CONTACT_EMAIL}
          </a>{" "}
          and we will try to sort it out. If that doesn&rsquo;t work, the state and federal courts in Cook County,
          Illinois are the place to bring it, and you and we both agree to that.
        </p>
      </PolicySection>

      <PolicySection title="13. Contact">
        <p>
          Questions about these terms:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
            {CONTACT_EMAIL}
          </a>
          . Help with your account:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className={link}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
