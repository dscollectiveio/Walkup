import Link from "next/link";
import { Lockup } from "@/components/mark";

export const metadata = {
  title: "Security & Privacy — Walkup",
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
 * The public-facing summary of docs/SECURITY_POLICY.md - same facts, written
 * for a board member or owner deciding whether to trust the app, not for
 * internal operations. Deliberately leaves out operational specifics (which
 * password manager, which migration file, device-level controls) that belong
 * in the internal policy but add nothing for this audience. Kept honest: no
 * claim here that isn't also true in the internal document, and no vague
 * "bank-level security" marketing language - every claim names the actual
 * mechanism.
 *
 * Listed in PUBLIC_PATHS (src/lib/supabase/proxy.ts) so it's reachable
 * signed out - a prospective board deciding whether to use Walkup shouldn't
 * need an account to read this first.
 */
export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <Link href="/">
        <Lockup />
      </Link>

      <h1 className="mt-8 text-[22px] font-semibold tracking-tight text-ink">
        Security &amp; Privacy
      </h1>
      <p className="mt-2 text-[13px] text-mute-soft">
        Last updated 2026-09-26. Reviewed at least every 6 months, and after
        any incident or new integration.
      </p>

      <p className="mt-6 text-[13px] leading-relaxed text-mute">
        Walkup is built and run by one person &mdash; Doug Smart. That&rsquo;s stated
        here up front rather than hidden, because it changes what
        &ldquo;secure&rdquo; can honestly mean: there&rsquo;s no security team, but
        there&rsquo;s also no gap between the person who wrote the access controls
        and the person accountable for them. What follows is a plain
        description of what&rsquo;s actually in place, not aspirational language.
      </p>

      <Section title="Who can see what">
        <p>
          Every table in the database enforces row-level security scoped to
          your association &mdash; a board member, accountant, or owner logging in
          can only ever reach their own building&rsquo;s records, and within that,
          only what their role permits. This is enforced by the database
          itself, not by application code that could have a bug in it. An
          owner sees their own unit; a board member sees the building&rsquo;s books;
          an accountant&rsquo;s access expires automatically after 90 days unless
          renewed.
        </p>
      </Section>

      <Section title="Two-factor authentication">
        <p>
          Every Walkup user &mdash; not just board admins &mdash; must enroll in
          authenticator-app-based two-factor authentication before reaching
          any page, including connecting a bank account. This is enforced at
          the database level, not just in the app&rsquo;s screens, so it holds even
          against a direct API call that tried to skip the usual flow.
        </p>
      </Section>

      <Section title="Bank connections">
        <p>
          Bank data comes through Plaid, a widely used financial data
          provider. Walkup never sees or stores your bank password &mdash; only a
          read-only token, scoped to transaction data, issued by your bank
          through Plaid. That token is stored in a database table with no
          read access granted to anyone, reachable only through two narrow,
          audited functions built for exactly that purpose. Disconnecting a
          bank calls Plaid to formally close the connection, not just deletes
          a local record.
        </p>
      </Section>

      <Section title="Encryption">
        <p>
          Data is encrypted in transit (TLS) between your browser, Walkup&rsquo;s
          servers, and its database, and encrypted at rest in the database.
          This is provided by Walkup&rsquo;s infrastructure vendors &mdash; Supabase for
          the database and Vercel for hosting &mdash; rather than built separately,
          since both are purpose-built for it.
        </p>
      </Section>

      <Section title="Audit trail">
        <p>
          Actions that change who has access or what&rsquo;s recorded in the books
          &mdash; granting a role, editing financial records, changing building
          settings &mdash; are written to an append-only log that a board admin can
          read but no one, including Doug, can edit or delete through the
          application.
        </p>
      </Section>

      <Section title="Access reviews and removal">
        <p>
          Every 90 days a board admin reviews who has access to their
          association&rsquo;s books, and each review is recorded with a
          snapshot of who had access that day. Access that should have ended
          is removed automatically: an owner&rsquo;s access ends once their
          sale closes, and an accountant&rsquo;s ends when their grant
          expires. The full{" "}
          <Link href="/policies/access-controls" className="text-ink underline-offset-2 hover:underline">
            Access Controls Policy
          </Link>{" "}
          has the detail.
        </p>
      </Section>

      <Section title="Keeping software patched">
        <p>
          Every dependency Walkup uses is scanned for known vulnerabilities
          automatically, on every change and weekly. Critical issues are
          patched within 7 days and high-severity ones within 14. The
          platforms Walkup runs on are also checked weekly against their
          end-of-support dates, so nothing runs on software that no longer
          gets security fixes. The full{" "}
          <Link href="/policies/vulnerability-management" className="text-ink underline-offset-2 hover:underline">
            Vulnerability and Patch Management Policy
          </Link>{" "}
          has the detail.
        </p>
      </Section>

      <Section title="Vendors">
        <p>
          Walkup runs on Supabase (database and authentication), Vercel
          (hosting), and Plaid (bank data). All three are mainstream
          providers with their own independent security programs &mdash; Supabase
          and Vercel are SOC 2 Type II audited, and Plaid maintains its own
          SOC 2 program and runs this same kind of security review on
          companies that connect to it. Walkup relies on them for
          infrastructure-level security rather than duplicating it, and
          focuses its own controls on how those services are configured and
          who can reach them.
        </p>
      </Section>

      <Section title="If something goes wrong">
        <p>
          If a credential is exposed or unauthorized access is suspected, the
          response is: revoke or rotate the affected credential immediately,
          review the audit log and provider access logs for what was actually
          reached, and directly notify any association whose financial data
          was involved. This is a real, written procedure, not an
          afterthought &mdash; a version with more operational detail exists
          internally for exactly that reason.
        </p>
      </Section>

      <Section title="Questions">
        <p>
          For anything not covered here &mdash; including a request to see the full
          internal security policy &mdash; email{" "}
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
