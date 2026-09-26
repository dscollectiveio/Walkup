import Link from "next/link";
import { Lockup } from "@/components/mark";

export const metadata = {
  title: "Privacy Policy — Walkup",
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
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
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

      <h1 className="mt-8 text-[22px] font-semibold tracking-tight text-ink">
        Privacy Policy
      </h1>
      <p className="mt-2 text-[13px] text-mute-soft">
        Last updated 2026-09-26.
      </p>

      <p className="mt-6 text-[13px] leading-relaxed text-mute">
        Walkup is accounting and compliance software for self-managed
        condominium associations, built and run by Doug Smart. This policy
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
          entries, budgets, vendor information, and tax filing figures.
        </p>
        <p>
          Bank transaction data, if your association connects a bank account
          through Plaid: transaction dates, amounts, descriptions, and the
          categories your board assigns to them. Walkup never sees or stores
          your bank login credentials &mdash; only a read-only token issued by
          Plaid.
        </p>
      </Section>

      <Section title="Why we collect it">
        <p>
          Solely to provide the service: keeping your association&rsquo;s
          books, tracking dues and expenses, preparing tax figures, and
          showing your board and owners the records they&rsquo;re entitled to
          see. Nothing collected here is used for advertising, profiling, or
          sold to anyone.
        </p>
      </Section>

      <Section title="Who we share it with">
        <p>
          Only the infrastructure providers Walkup runs on, each strictly to
          do their job: Supabase (database and authentication), Vercel
          (hosting), and Plaid (bank connections). Walkup does not sell data,
          share it for marketing, or give any other company access to it.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          Financial records &mdash; the ledger, payments, charges, budgets, tax
          filings, and bank transactions &mdash; are kept for the life of your
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
          Personal details &mdash; a person&rsquo;s name, email, phone, and
          mailing address &mdash; are kept only while that person has access
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
          reason above &mdash; we&rsquo;ll say so if that applies.
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
          <a href="mailto:doug.smart6@gmail.com" className="text-ink underline-offset-2 hover:underline">
            doug.smart6@gmail.com
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
