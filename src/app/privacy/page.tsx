import { CONTACT_EMAIL, SUPPORT_EMAIL } from "@/lib/site-config";
import Link from "next/link";
import { Lockup } from "@/components/mark";

export const metadata = {
  title: "Privacy Policy | Walkup",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-[15px] font-bold text-ink">{title}</h2>
      <div className="mt-2 space-y-3 text-[13px] leading-relaxed text-mute">{children}</div>
    </section>
  );
}

/**
 * A real privacy policy, not a restatement of docs/SECURITY_POLICY.md (which
 * covers controls, not data practices). Every claim here is checked against
 * what the app actually does before being written down; retention and
 * removal match SECURITY_POLICY.md §9 and redact_person() (0037,
 * DECISIONS #30). Public (PUBLIC_PATHS in src/lib/supabase/proxy.ts) and
 * linked from signup - consent to this page is required to create an
 * account.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <Link href="/">
        <Lockup />
      </Link>

      <h1 className="mt-8 text-[20px] font-bold tracking-tight text-ink">
        Privacy Policy
      </h1>
      <p className="mt-1 text-[13px] text-mute">
        Last updated 2026-10-16.
      </p>

      <p className="mt-6 text-[13px] leading-relaxed text-mute">
        Walkup is accounting and compliance software for self-managed
        condominium associations, built and run by DS Collective LLC. This policy
        describes what information Walkup collects, why, and what you can do
        about it. For how that information is technically protected, see{" "}
        <Link href="/security" className="text-ink underline-offset-2 hover:underline">
          Security &amp; Privacy
        </Link>
        .
      </p>

      <Section title="What we collect">
        <p>
          Account information you provide directly: your email address and
          password, and your name if you&rsquo;re added as a board member,
          accountant, or unit owner.
        </p>
        <p>
          Association records your board enters: unit information, owner
          names, contact details and mailing addresses, financial ledger
          entries, budgets, contractor information, and tax filing figures.
        </p>
        <p>
          Announcements your board posts, and a record of which owners opened
          them. The board sees how many owners opened a post, not who.
        </p>
        <p>A phone number and mailing address you add to your own profile.</p>
        <p>
          Spreadsheets your board imports are read to create records and then
          removed, unless the board keeps a copy in Documents.
        </p>
        <p>
          A record of each email Walkup sends for your board: who it went to,
          which kind it was, its subject, when it was sent and whether it was
          delivered, bounced or reported as spam. We keep it for 24 months. The
          email address of a person whose address bounces or who reports spam is
          kept on a block list for that association so Walkup does not write to
          it again.
        </p>
        <p>
          Your choices about email: which kinds of email you accept, and whether
          you unsubscribed.
        </p>
        <p>
          Bank data, if your association connects a bank account through
          Plaid: account names and the last four digits of each account,
          balances, and up to two years of transactions (dates, amounts,
          descriptions), plus the categories your board assigns to them.
          Walkup never sees or stores your bank login credentials, only
          a read-only token issued by Plaid, which Walkup keeps encrypted. Plaid
          is a separate company: it handles your information under its own{" "}
          <a
            href="https://plaid.com/legal/#end-user-privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink underline-offset-2 hover:underline"
          >
            End User Privacy Policy
          </a>
          . Plaid sends this data to Walkup at your board&rsquo;s direction, and
          Walkup sends Plaid only the connection request and the token. To
          disconnect a bank, a board admin chooses Disconnect on the Bank feed
          page.
        </p>
        <p>
          Photos and documents your board or a unit owner uploads, such as an
          insurance policy, a contractor&rsquo;s quote, or a photo of a problem
          in the building. Photos taken on a phone are resized and saved
          without their location data where your browser allows it.
        </p>
        <p>
          If you join the waitlist for a state Walkup doesn&rsquo;t support yet:
          your email address, the state you chose, and a one-way scrambled
          version of your IP address combined with the date (used only to slow
          down repeated sign-ups, never the address itself). We use it only to
          tell you when Walkup reaches your state. Email us and we&rsquo;ll
          remove it.
        </p>
        <p>
          Your association&rsquo;s plan: when its free trial ends, any
          complimentary access, and, if a board administrator chooses a paid
          plan, the details Stripe sends back (listed under &ldquo;Paying for
          Walkup&rdquo; below). Card and bank account numbers are never among
          them.
        </p>
      </Section>

      <Section title="Why we collect it">
        <p>
          Solely to provide the service: keeping your association&rsquo;s
          books, tracking dues and expenses, preparing tax figures, and
          showing your board and owners the records they&rsquo;re entitled to
          see, and, if your board chooses a paid plan, billing for Walkup.
          Nothing collected here is used for advertising, profiling, or sold
          to anyone.
        </p>
      </Section>

      <Section title="Who we share it with">
        <p>
          Only the companies named on this page, each strictly to do its job:
          Supabase (database, file storage and sign-in), Vercel (hosting), Plaid
          (bank connections), Anthropic (the AI features described below), Google
          and Photon (contractor search and address lookup, described below) and
          Resend (account emails, and the reminders, statements and notices a board
          administrator approves) and Stripe (payment for Walkup&rsquo;s own plan,
          described below). Walkup does not sell data, share it for
          marketing, or give access to it to any company beyond those named on this
          page.
        </p>
        <p>
          <strong className="font-semibold text-ink">AI features (Anthropic).</strong>{" "}
          Walkup uses Anthropic, the company that makes the Claude AI models,
          for the features below, and only when they are used. How
          Anthropic handles what Walkup sends is set out in{" "}
          <a href="https://www.anthropic.com/legal/commercial-terms" className="underline underline-offset-2" rel="noopener noreferrer">
            its commercial terms
          </a>
          .
        </p>
        <p>
          <em>Reading documents.</em> When your board uploads a document, its
          text is sent to Anthropic so Walkup can file it and pick out details
          such as an insurance policy&rsquo;s limits and dates. Numbers shaped
          like Social Security or tax ID numbers are removed before the text is
          sent. An insurance declarations page or quote with no text layer (a
          scan or a photo) is sent as the file itself so it can be read, and tax
          ID numbers are removed from what comes back before anything is saved.
          The same applies to a contractor&rsquo;s quote (from a PDF or pasted
          text) and a contractor&rsquo;s insurance certificate when your board
          asks Walkup to read them. What the AI reads is shown to your board to
          check before it is saved.
        </p>
        <p>
          <em>Reported problems.</em> When anyone in your building reports a
          problem, its title, description and where in the building it is are
          sent, as written by whoever reported it, so Walkup can suggest the kind
          of contractor it needs and flag possible emergencies. Email addresses,
          phone numbers, unit numbers and dollar amounts are removed first.
        </p>
        <p>
          <em>Writing drafts and summaries.</em> To write a policy&rsquo;s
          plain-English summary, the figures and insurer of the saved policy are
          sent, never the policy number, the named insured, the address or the
          agent&rsquo;s details. To draft an insurance email, only the kind of
          email and the coverage types are sent, never names, amounts or policy
          numbers; Walkup fills those in afterwards. Drafts to contractors and agents
          open in your own mail app; Walkup does not send those for you.
        </p>
        <p>
          <em>Importing a spreadsheet.</em> If your board asks for help matching
          columns, the column names and a character-by-character mask of a few
          sample cells (letters shown as x, digits as 9) are sent, never the
          values themselves.
        </p>
        <p>
          <em>Searching the web.</em> When your board asks Walkup to find
          insurers, insurance agencies or contractors, Anthropic runs web
          searches for Walkup. Your board is told what kinds of details will be used before a search
          runs, and sees the exact phrase for a contractor search before it runs.
          Only these details are used:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>the building&rsquo;s city, state and ZIP code</li>
          <li>the number of units and stories, the year built and the construction type</li>
          <li>the kinds of insurance coverage being looked for</li>
          <li>
            the kind of work needed, a short phrase made only of words from
            Walkup&rsquo;s own list of repair terms, and what matters for the
            job (such as emergency service or free estimates)
          </li>
        </ul>
        <p>
          Owner names, the building&rsquo;s street address, email addresses,
          phone numbers, unit numbers, financial figures and policy numbers are
          removed from searches, and what an owner wrote when reporting a problem is never searched.
          Results show the web pages they came from; Walkup shows what it found
          and does not endorse anyone.
        </p>
        <p>
          If your board uses &ldquo;Find a contractor,&rdquo; Google receives
          the building&rsquo;s street address (to place it on a map, once), the
          kind of work being searched for and, when your board chooses it, the
          same short phrase of repair terms. Nothing else about your
          association, its owners, or its finances is sent to Google.
        </p>
        <p>
          When you set up your building and type its address, what you type is
          sent to an address-lookup service (Google, or Photon, which uses
          OpenStreetMap data) to suggest matching addresses. Confirmation and
          password-reset emails, and the reminders, statements and notices a
          board administrator approves, are sent through Resend. Resend receives
          the recipient&rsquo;s name and email address and the text of the
          message, including a statement PDF when one is attached, and tells
          Walkup whether each message was delivered.
        </p>
        <p>
          <strong className="font-semibold text-ink">Paying for Walkup (Stripe).</strong>{" "}
          If a board administrator chooses a paid plan, payment happens on
          Stripe&rsquo;s own pages. Walkup sends Stripe the board
          administrator&rsquo;s sign-in email address, the plan chosen, and your
          association&rsquo;s Walkup reference number, so the payment can be
          matched to the right association. The board administrator enters the
          payment details, and any billing details Stripe asks for, directly with
          Stripe. Walkup never sees or stores card or bank account numbers.
          Stripe sends Walkup back only its own reference numbers for the
          customer and the subscription, the plan and whether it is monthly or
          yearly, its status, when the current period ends, whether it is set to
          end, when a payment failed, and when the board administrator agreed to
          the Terms. Stripe also emails the board administrator receipts and
          payment notices. Nothing about owners is sent to Stripe, and owners
          never pay Walkup. Stripe handles payment information under its own{" "}
          <a
            href="https://stripe.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink underline-offset-2 hover:underline"
          >
            Privacy Policy
          </a>
          .
        </p>
        <p>
          <strong className="font-semibold text-ink">Email from Walkup.</strong>{" "}
          Walkup sends an email only when a board administrator has approved it.
          Every message has an unsubscribe link that works without signing in.
          We stop sending the kinds of email you turn off as soon as you save
          your choices. Emails never contain bank
          account or routing numbers. If you think a message was sent in error,
          write to {SUPPORT_EMAIL}.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          Financial records (the ledger, payments, charges, budgets, tax
          filings, and bank transactions) are kept for the life of your
          association&rsquo;s account, and for 7 years after the account is
          closed, because tax records have to be. They&rsquo;re never
          silently altered in the meantime: a mistake is corrected with a
          visible reversing entry, not a deletion.
        </p>
        <p>
          Bank access tokens are deleted the moment your board disconnects a
          bank, after Plaid is told to close the connection.
        </p>
        <p>
          Personal details (a person&rsquo;s name, email, phone, and
          mailing address) are kept only while that person has access
          or owns a unit. After that, a board admin can remove them, or you
          can ask us to. Removal clears them everywhere Walkup stores them,
          including its internal change log; the person&rsquo;s payment and
          ownership history stays, attributed to &ldquo;Former
          member.&rdquo; The full{" "}
          <Link href="/policies/data-retention" className="text-ink underline-offset-2 hover:underline">
            Data Retention and Deletion Policy
          </Link>{" "}
          has the schedule for every category of data.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can ask to see what information we hold about you, correct it,
          or have your personal details removed. Email us (below) and
          we&rsquo;ll act on it within 30 days and tell you what was removed.
          Financial and tax records your association is required to keep
          can&rsquo;t be deleted while the association is active, for the
          reason above. We&rsquo;ll say so if that applies.
        </p>
      </Section>

      <Section title="Children's privacy">
        <p>Walkup is not directed at, and is not knowingly used by, children.</p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          If this policy changes in a way that matters to how your data is
          handled, the date at the top will be updated and, where practical,
          you&rsquo;ll be notified directly.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions, corrections, or a request about your data: email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-ink underline-offset-2 hover:underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>

      <p className="mt-10 text-[13px]">
        <Link href="/" className="text-ink underline-offset-2 hover:underline">
          &larr; Back to Walkup
        </Link>
      </p>
    </div>
  );
}
