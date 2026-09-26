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
 * what the app actually does before being written down - in particular
 * retention/deletion is stated honestly as a known gap (DECISIONS.md: soft
 * deletes and immutable journal entries are deliberate for audit integrity,
 * and there is no consumer-initiated deletion flow yet) rather than glossed
 * over. Public (PUBLIC_PATHS in src/lib/supabase/proxy.ts) and linked from
 * signup - consent to this page is required to create an account.
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
          Financial records are kept indefinitely by design &mdash; an
          association&rsquo;s books and tax history need to remain available
          for years, and Walkup&rsquo;s ledger is built to never silently
          lose or alter a posted record (mistakes are corrected with a
          visible reversal, not a deletion).
        </p>
        <p>
          <strong className="text-ink">Known gap, stated plainly:</strong>{" "}
          there is currently no self-service way to delete your personal data
          from Walkup. If you want your information removed or corrected,
          email us (below) and we&rsquo;ll handle it by hand &mdash; this is
          manual today, not automated, and we&rsquo;re telling you that
          rather than implying otherwise.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can ask to see what information we hold about you, correct it,
          or request its deletion, subject to the retention needs described
          above (an association&rsquo;s financial and tax records generally
          can&rsquo;t be deleted while the association is active, for the
          same audit-integrity reasons). Contact us using the email below and
          we&rsquo;ll respond directly.
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
