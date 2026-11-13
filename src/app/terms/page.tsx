import Link from "next/link";
import { PolicyList, PolicyPage, PolicySection } from "@/components/policy-page";
import { CONTACT_EMAIL, DUES_PAYMENTS_ENABLED, FOUNDING, PLANS, SALES_EMAIL, SUPPORT_EMAIL, operatorName } from "@/lib/site-config";
import { GRACE_DAYS, MAX_SELF_SERVE_UNITS, TRIAL_DAYS } from "@/lib/billing/config";

export const metadata = { title: "Terms of Service | Walkup" };

const link = "text-ink underline-offset-2 hover:underline";

/**
 * The terms for using Walkup. Plain English on purpose, and every statement
 * here has to stay true of the app as it ships (it never moves money, sends
 * email only when a board administrator has approved it, gives no tax, legal or insurance advice). Prices and
 * early-access wording come from src/lib/site-config.ts so they can't drift
 * from the landing page. Reviewed by Doug, not yet by a lawyer: see
 * docs/DECISIONS.md (#44, #58). Public (PUBLIC_PATHS in src/lib/supabase/proxy.ts) and
 * linked from sign-up.
 */
export default function TermsPage() {
  return (
    <PolicyPage
      title="Terms of Service"
      subtitle="Last updated 2026-11-12."
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
            "Accountants, attorneys, property managers and other professionals the board invites use Walkup at the board's direction. Their own engagement with the association is separate, and Walkup is not a party to it.",
            "If you accept these terms for an association and you are not authorized to bind it, you accept them for yourself and are personally responsible for them.",
            "You may not use Walkup if the law of the United States bars you from doing so.",
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
            // DECISIONS #57: online dues go owner -> the association's own Stripe account -> its bank. Lawyer review pending.
            DUES_PAYMENTS_ENABLED
              ? "Walkup never holds the association's money. Bank access through Plaid is read-only. If a board administrator turns on online payments, owners can pay dues by bank transfer through Stripe: the payment goes to the association's own Stripe account and from there to the association's bank. The association, not Walkup, is the merchant, and its agreement with Stripe covers those payments. Stripe's fee is charged to the association; Walkup takes no part of any payment. Each payment starts only when an owner presses Pay. The only money Walkup receives is its own subscription fee, paid through Stripe."
              : "Walkup never holds or moves the association's money. Bank access through Plaid is read-only, and owners pay the association the way they do today. The only money Walkup receives is its own subscription fee, paid through Stripe.",
            "Walkup sends email only after a board administrator has approved it, either by pressing Send on a batch they reviewed or by switching on a standing reminder rule that they can pause at any time. Each email says who it is from, can be unsubscribed from, and is recorded in a log the board can read. Walkup does not send email to anyone who has unsubscribed, and never puts bank account details in an email. Everything else, such as messages to contractors or insurance agents, opens as a draft in your own email app.",
            "Walkup is not a tax adviser, accountant, lawyer, or insurance broker, and nothing in it is tax, legal, accounting or insurance advice. Tax figures, forms, deadlines and coverage notes are prepared from the information you give us and from sources we link to. Rules change and our information can be out of date or wrong. Have a qualified professional review anything before you file it, sign it, or rely on it.",
            "Walkup does not file anything with the IRS, the State of Illinois, or anyone else. Filing is yours to do.",
            "Walkup is not a bank, money transmitter, payment processor, collection agency, law firm, property manager, or insurer, and it does not act as your association's fiduciary or agent. Reminders, statements and notices are drafts that your board reviews and sends. The board decides who is sent what, and what is owed.",
            "What is in Walkup is a working record. Your board remains responsible for the official books and records that your declaration, bylaws and Illinois law require, and should keep its own copies of anything it must keep.",
            "Insurers, agencies and contractors that Walkup shows you are found from public sources or saved by your board. Showing one is not an endorsement, a recommendation to buy, or a check of their licence, insurance, or quality. Check them yourself.",
          ]}
        />
      </PolicySection>

      <PolicySection title="4. Your association's responsibilities">
        <p>
          Walkup helps your board do its work. It does not take over the board&rsquo;s duties. If you use Walkup for
          an association, you agree for the association that:
        </p>
        <PolicyList
          items={[
            "The board is responsible for following the association's declaration, bylaws and rules and the laws that apply to it, including the Illinois Condominium Property Act. That covers assessments, late fees, notices to owners, collection and lien steps, meetings, votes, budgets, reserves, insurance, and records. Walkup's features, defaults and wording are not a statement that any of those are right for your association.",
            "The board is responsible for every message, statement, reminder and notice it sends through Walkup or from a draft Walkup prepared, and for having the right to send it. Check the amounts, dates, names and wording first.",
            "The board decides what each owner owes, whether to charge a late fee, and whether to start any collection step. Walkup does not decide these things, does not contact owners about debts on its own, and does not act as a debt collector.",
            "The board is responsible for the accuracy of unit, owner, charge, payment and bank information in Walkup, and for fixing mistakes it finds.",
            "The board is responsible for its tax and information returns and filings, and for any other filing or deadline. Walkup does not file anything for you.",
            "The board is responsible for who it invites and what access each person gets, and for removing access when someone leaves the board or the association.",
            "Anyone who accepts a role, a plan or these terms for the association confirms that the association has given them authority to do so.",
          ]}
        />
      </PolicySection>

      <PolicySection title="5. Your information">
        <PolicyList
          items={[
            "Your association's records are yours. We don't claim ownership of anything you put into Walkup.",
            "Documents and information you upload or enter must be yours to share. If an upload contains other people's personal information, you confirm that the association is allowed to hold it and to put it into Walkup. We may remove content that breaks these terms or the law.",
            "You give us permission to store, process and display that information only as needed to run Walkup for you, including with the service providers named in the Privacy Policy.",
            "You are responsible for the accuracy of what you enter, and for having the right to enter it. That includes personal information about owners and contractors.",
            "Your board is responsible for what it sends through Walkup and for having a reason to contact each person. Every email has an unsubscribe link at the bottom that works without signing in.",
            "You can download your financial statements, budget, tax forms and documents at any time, ask us for a copy of the rest of your association's records, and ask us to delete your information. What we keep and for how long is in the Data Retention and Deletion Policy under Policies.",
          ]}
        />
      </PolicySection>

      <PolicySection title="6. Automated features and outside services">
        <p>
          Some features use outside services, such as Plaid to read bank transactions, Google to find nearby
          contractors and suggest addresses, and Anthropic&rsquo;s Claude to read uploaded documents, suggest
          categories, and draft text. Those services have their own terms. Results from automated features can be
          wrong or incomplete. Check them before you act on them. You are always the one who approves a posting, a
          figure, or a message. Resend delivers the emails a board administrator approves, and the account emails Walkup sends.
        </p>
        <p>
          We choose these services with care, but we don&rsquo;t control them. If one is slow, down, changes, or
          refuses something, parts of Walkup may stop working, and we are not responsible for what that service does
          or fails to do. Banks, payment processors and email providers can also delay or refuse what passes through
          them for reasons of their own.
        </p>
      </PolicySection>

      {/*
        Online dues payments (DECISIONS #57, #58). Shown as a real section only
        when DUES_PAYMENTS_ENABLED is true, so the Terms never describe a feature
        that is not live. Off, the section says so in two sentences and keeps the
        numbering stable. LAWYER: review the whole of this section with Stripe's
        Connect Standard terms, NACHA authorization rules for web debits, and the
        association's own authority to take electronic dues.
      */}
      <PolicySection title="7. Paying dues online">
        {DUES_PAYMENTS_ENABLED ? (
          <>
            <p>
              Online payment of dues is optional. It exists only for an association whose board administrator has
              turned it on. These terms apply to the board administrator who turns it on, and to every owner who uses
              it.
            </p>
            <PolicyList
              items={[
                "Who is who. The association is the payee and the merchant. Stripe, Inc. and its affiliates process the payment. Walkup supplies the software that starts the payment and shows its status. Walkup is not the payee, is not a party to the payment, does not collect dues for the association, and does not hold, receive, transmit or settle the funds. The payment goes from the owner's bank to the association's own Stripe account and from there to the association's bank.",
                "The association's Stripe account. The board administrator connects the association's own Stripe account to Walkup. By doing so, the association accepts Stripe's terms for that account, including Stripe's services agreement, and is responsible for keeping the account in good standing, for the information Stripe asks for, for the bank account that receives the payouts, and for any tax forms Stripe issues. Walkup keeps only the account's reference number, not its credentials.",
                "Fees. Stripe charges its fee to the association. Stripe sets and may change the fee, and the association's Stripe account shows it. Walkup adds no fee and takes no share of any payment. Whether to charge an owner anything beyond the dues, and whether that is allowed, is up to the association and its governing documents and the law. The Pay button asks only for the owner's full open balance.",
                "The owner's authorization. When an owner presses Pay, they go to Stripe's own page, link their bank account there, and authorize Stripe to debit the account for the amount shown. The owner confirms they are authorized to use that bank account and that it holds enough to cover the payment. Every payment starts only when an owner presses Pay. Walkup does not set up automatic or repeating debits.",
                "Timing, failure and return. A bank transfer usually takes about 4 business days to clear. It can fail or be returned later, for example for insufficient funds, a closed account, or a dispute with the owner's bank. Until it clears it shows as pending, never as paid. A failed or returned payment counts as not paid, and the owner still owes what the association's records say is owed.",
                "Records. A payment's status in Walkup is information from Stripe. It is not the association's official book or a receipt, and it does not change the ledger by itself. A board member records a payout in the books by confirming the matching deposit in the bank feed. If Stripe's records, the bank's records and Walkup's differ, Stripe's and the bank's records control, and the board is responsible for reconciling them.",
                "Refunds, returns and disputes. Walkup cannot refund, reverse, or dispute a payment. The association handles refunds in its Stripe account, and the association and its owners deal with each other and with Stripe about returned payments, chargebacks and disputes. Stripe may take returned amounts, disputed amounts and fees from the association's Stripe balance or bank account. Walkup is not responsible for any of that.",
                "Holds and closures. Stripe may delay, hold, limit or refuse a payment or a payout, or close an account, under its own rules. Walkup has no control over those decisions and is not liable for them.",
                "The association's own compliance. The association is responsible for making sure that taking dues electronically, and how it applies, posts and reports them, follows its declaration, bylaws, board resolutions and the law. Questions about whether an owner owes something go to the board, not to Walkup.",
                "Turning it off. A board administrator can turn off online payments at any time. Payments already started still finish. We may also turn off online payments for an association, for example if Stripe closes or limits its account, if payments are being misused, or if the law or a court requires it.",
                "Privacy. What Walkup sends to and receives from Stripe is described in the Privacy Policy. The owner gives their bank details, name and email to Stripe directly, and Walkup never sees or stores bank account or routing numbers.",
              ]}
            />
          </>
        ) : (
          <p>
            Walkup does not take dues payments today. Owners pay the association the way they do now, and the board
            records what it receives. If we add online dues payments, we will put the terms for them here before
            they are available, and a board administrator will have to agree to them before turning the feature on.
          </p>
        )}
      </PolicySection>

      <PolicySection title="8. Acceptable use">
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
      <PolicySection title="9. Plans and payment">
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

      <PolicySection title="10. Changes, suspension and ending your account">
        <PolicyList
          items={[
            "We are improving Walkup all the time. Features may change, and early-access features may be added, changed or removed.",
            "You can stop using Walkup whenever you like. Export what you need first.",
            "We may suspend or close an account that breaks these terms, puts others at risk, or is used unlawfully. Where we reasonably can, we will tell you why and give you time to export your information.",
            // DECISIONS #44: amounts owed under section 9 survive.
            "Sections that by their nature should continue after an account ends (such as 3, 4, 5, 9 for any amount owed, 11, 12, 13, 14, 16 and 17) do.",
          ]}
        />
      </PolicySection>

      <PolicySection title="11. Intellectual property">
        <PolicyList
          items={[
            "Walkup, including its software, design, text, and the Walkup name and logo, belongs to us and our licensors. These terms give you the right to use Walkup while your account is active, and nothing more. The right is limited, non-exclusive, non-transferable and can be withdrawn under these terms. They do not give you ownership of anything of ours.",
            "Your association's information stays yours (section 5). You give us only the permission described there.",
            "If you send us ideas or suggestions about Walkup, we may use them freely and without payment or credit. They do not include your association's records.",
            "Some parts of Walkup are built from software that others have licensed to the public. Those licenses apply to those parts.",
          ]}
        />
      </PolicySection>

      <PolicySection title="12. No warranty">
        <p>
          Walkup is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. We work hard to keep it accurate and
          running, but we don&rsquo;t promise that it will be uninterrupted, secure, error-free, or fit for a particular
          purpose, or that any figure, deadline, form, reminder or suggestion it shows is correct or complete. To the
          extent the law allows, we disclaim all other warranties, whether stated or implied, including any warranty
          of merchantability, fitness for a particular purpose, accuracy and non-infringement. Some places don&rsquo;t
          allow these limits, so they may apply to you only to the extent the law permits.
        </p>
      </PolicySection>

      <PolicySection title="13. Limit of liability">
        <p>
          To the extent the law allows, Walkup, {operatorName}, and the people who work for it will not be liable for
          indirect, incidental, special, consequential or punitive losses, or for lost profits, lost data, penalties,
          interest, late fees or other charges from a missed or late filing, payment, notice or deadline, or for
          decisions made on the strength of information in Walkup.
        </p>
        <p>
          That includes anything that goes wrong with a payment: its amount, its timing, a failure, a return, a
          dispute, a hold, or a decision by Stripe, Plaid, a bank or any other outside service. It also includes loss
          caused by someone using an account whose sign-in details were not kept private.
        </p>
        <p>
          Our total liability for all claims relating to Walkup is limited to the greater of what you paid us in the
          twelve months before the first claim arose, or $500. These limits apply whatever the legal theory, including
          negligence, and even if we were told a loss was possible. They are a basic part of the deal, and our prices
          reflect them. Nothing in these terms limits liability for fraud or willful misconduct, or any liability that
          can&rsquo;t be limited by law.
        </p>
      </PolicySection>

      <PolicySection title="14. If someone makes a claim against us">
        <p>
          If a claim or demand from someone outside these terms (an owner, a contractor, a tenant, a government
          body or anyone else) arises from any of the following, the association agrees, to the extent the law allows,
          to defend us against it and to pay the resulting losses, costs and reasonable attorneys&rsquo; fees:
        </p>
        <PolicyList
          items={[
            "the association's use of Walkup in breach of these terms;",
            "information or documents the association entered or uploaded, or messages it sent;",
            "the association's decisions about assessments, late fees, collection, liens, owner records or any other governance matter, and how it deals with its owners;",
            "the association's Stripe account and the payments it accepts.",
          ]}
        />
        <p>
          This promise is the association&rsquo;s. A board member or officer who accepts these terms for the association
          in its name, with authority to do so, is not personally bound by it. This does not apply to the extent we
          caused the claim by our own willful misconduct. We will tell you
          promptly about a claim, let you control its defense, and cooperate reasonably, and you may not settle it in
          a way that admits fault for us or limits what we can do without our written consent. Each person is
          responsible for their own breach of these terms.
        </p>
      </PolicySection>

      <PolicySection title="15. Changes to these terms">
        <p>
          We may update these terms. For a change that matters, we will tell you by email or inside Walkup before it
          takes effect. If you keep using Walkup after that, you accept the new terms. The date at the top shows when
          they were last updated.
        </p>
      </PolicySection>

      <PolicySection title="16. Governing law and disputes">
        <p>
          These terms are governed by the laws of the State of Illinois, without regard to its conflict-of-law rules.
          If we have a disagreement, please write to us first at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
            {CONTACT_EMAIL}
          </a>{" "}
          and we will try to sort it out. Please describe the problem and what you would like us to do, and give us
          30 days from your message before you start a case. If that doesn&rsquo;t work, the state and federal courts
          in Cook County, Illinois are the only place to bring it, and you and we both agree to that and to their
          authority over us. To the extent the law allows, any claim relating to Walkup must be brought within one
          year after it arose, or it is lost, and each side may bring claims only for itself and not as a member of
          a class or group.
        </p>
      </PolicySection>

      {/*
        LAWYER: choices Doug made for counsel to confirm (DECISIONS #58). (1) No
        binding arbitration and no jury waiver: our customers are volunteer
        boards, and arbitration fees and mass filings cost more than they save.
        A class-action waiver is included. (2) The indemnity binds the
        association only, never a board member personally, and the one-year claim
        period stays. (3) Liability cap is the greater of 12 months of fees or
        $500, with payments and outside services named in section 13. (4) Stripe
        is named only as "Stripe's services agreement", the agreement a Standard
        connected account accepts; confirm current Stripe wording and the ACH
        debit authorization shown on Stripe's page.
      */}
      <PolicySection title="17. General terms">
        <PolicyList
          items={[
            "Notices. We may give you notice by email to the address on your account, or by a notice inside Walkup. You may write to us at the contact address below. You agree to receive notices and records from us electronically, and that your electronic agreement to these terms and to anything else in Walkup counts as your signature.",
            "These terms, together with the Privacy Policy and the other policies on our site, are the whole agreement between you and us about Walkup. They replace anything said or agreed earlier about it.",
            "If a court finds that part of these terms can't be enforced, the rest stays in force, and the part is applied as far as the law allows.",
            "If we don't enforce a term right away, that doesn't give up our right to enforce it later.",
            "You may not transfer your rights or duties under these terms without our written consent. We may transfer ours in a merger, a sale of the business or its assets, or similar change.",
            "Neither of us is liable for a delay or failure caused by something beyond our reasonable control, such as an outage of an outside service, a power or network failure, a strike, a natural event, or an act of government. This does not excuse a payment owed.",
            "These terms don't create a partnership, agency, employment or fiduciary relationship between you and us. They give no rights to anyone else, apart from the people and businesses named in sections 13 and 14.",
          ]}
        />
      </PolicySection>

      <PolicySection title="18. Contact">
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
