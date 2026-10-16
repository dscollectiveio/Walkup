import { CONTACT_EMAIL, SECURITY_EMAIL } from "@/lib/site-config";
import Link from "next/link";
import { Lockup } from "@/components/mark";

export const metadata = {
  title: "Security & Privacy | Walkup",
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

      <h1 className="mt-8 text-[22px] font-bold tracking-tight text-ink">
        Security &amp; Privacy
      </h1>
      <p className="mt-2 text-[13px] text-mute-soft">
        Last updated 2026-10-16. Reviewed at least every 6 months, and after
        any incident or new integration.
      </p>

      <p className="mt-6 text-[13px] leading-relaxed text-mute">
        Walkup is built and run by one person, Doug Smart. That&rsquo;s stated
        here up front rather than hidden, because it changes what
        &ldquo;secure&rdquo; can honestly mean: there&rsquo;s no security team, but
        there&rsquo;s also no gap between the person who wrote the access controls
        and the person accountable for them. What follows is a plain
        description of what&rsquo;s actually in place, not aspirational language.
      </p>

      <Section title="Who can see what">
        <p>
          Every table in the database enforces row-level security scoped to
          your association, a board member, accountant, or owner logging in
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
          Every Walkup user, not just board admins, must enroll in
          authenticator-app-based two-factor authentication before reaching
          any page, including connecting a bank account. This is enforced at
          the database level, not just in the app&rsquo;s screens, so it holds even
          against a direct API call that tried to skip the usual flow.
        </p>
      </Section>

      <Section title="Bank connections">
        <p>
          Bank data comes through Plaid, a financial data
          provider. Walkup never sees or stores your bank password, only a
          read-only token, scoped to transaction data, issued by your bank
          through Plaid. That token is encrypted by Walkup before it is
          stored, with a key kept only on the server, in a database table with no
          read access granted to anyone, reachable only through narrow, audited
          functions built for exactly that purpose. Even a board administrator
          calling them receives only the encrypted value. Disconnecting a
          bank calls Plaid to formally close the connection, not just deletes
          a local record.
        </p>
        <p className="mt-3">
          Plaid also tells Walkup when a bank needs attention, such as a
          sign-in that has expired. Walkup checks Plaid&rsquo;s digital signature
          and the freshness of each of those messages before it reads anything
          in them, and discards any that fail. The only thing such a message can
          do is mark a bank connection as needing to be reconnected; it cannot
          read a token, fetch transactions or touch the books.
        </p>
      </Section>

      <Section title="Encryption">
        <p>
          Data is encrypted in transit (TLS) between your browser, Walkup&rsquo;s
          servers, and its database, and encrypted at rest in the database.
          This is provided by Walkup&rsquo;s infrastructure providers, Supabase for
          the database and Vercel for hosting, rather than built separately.
        </p>
      </Section>

      <Section title="Audit trail">
        <p>
          Actions that change who has access or what&rsquo;s recorded in the books (granting a role, editing financial records, changing building
          settings) are written to an append-only log that a board admin can
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

      <Section title="Service providers">
        <p>
          Walkup runs on Supabase (database and authentication), Vercel
          (hosting), Plaid (bank data), Resend (email delivery) and Stripe
          (payment for Walkup&rsquo;s own plan). Each provider publishes its own security documentation:{" "}
          <a href="https://supabase.com/security" className="underline underline-offset-2" rel="noopener noreferrer">Supabase</a>,{" "}
          <a href="https://vercel.com/security" className="underline underline-offset-2" rel="noopener noreferrer">Vercel</a>,{" "}
          <a href="https://plaid.com/safety/" className="underline underline-offset-2" rel="noopener noreferrer">Plaid</a>,{" "}
          <a href="https://resend.com/security" className="underline underline-offset-2" rel="noopener noreferrer">Resend</a> and{" "}
          <a href="https://docs.stripe.com/security" className="underline underline-offset-2" rel="noopener noreferrer">Stripe</a>.
          Walkup relies on them for
          infrastructure-level security rather than duplicating it, and
          focuses its own controls on how those services are configured and
          who can reach them.
        </p>
        <p className="mt-3">
          Resend delivers the emails a board administrator has approved, and
          the account emails Walkup sends. It receives the recipient&rsquo;s name
          and email address and the text of the message, including a statement
          PDF when one is attached, and reports back whether each message was
          delivered, bounced or was marked as spam. Its sending key is scoped to
          sending only, and it is held in the server&rsquo;s environment.
        </p>
        <p className="mt-3">
          Stripe takes payment for Walkup&rsquo;s own plan, on Stripe&rsquo;s
          own pages, when a board administrator chooses one. Walkup never sees
          or stores card or bank account numbers. Stripe&rsquo;s updates about a
          plan are accepted only after their digital signature checks out, and
          they can call five named database functions that record the plan and
          nothing else. They never touch an association&rsquo;s books, bank
          feed or dues. The{" "}
          <Link href="/privacy" className="text-ink underline-offset-2 hover:underline">
            Privacy Policy
          </Link>{" "}
          lists what Walkup and Stripe share.
        </p>
        <p className="mt-3">
          Walkup&rsquo;s AI features use Anthropic, the company that makes the
          Claude models, only when someone uses them and only from Walkup&rsquo;s
          servers. Anthropic is used for four things: reading documents your
          board uploads (tax ID numbers are removed first), suggesting the kind
          of work a reported problem needs, writing drafts and policy summaries
          your board edits before anything is sent, and searching the web for
          insurers, agencies and contractors using only the building&rsquo;s
          location and general facts. If a board asks for help matching the columns
          of a spreadsheet it is importing, only the column names and a
          character-by-character mask of a few sample cells (letters shown as x,
          digits as 9) are sent, never the values. How Anthropic handles what Walkup sends is set out in{" "}
          <a href="https://www.anthropic.com/legal/commercial-terms" className="underline underline-offset-2" rel="noopener noreferrer">its commercial terms</a>. Every request is
          logged without its content and counted against a daily limit per
          building. The{" "}
          <Link href="/privacy" className="text-ink underline-offset-2 hover:underline">
            Privacy Policy
          </Link>{" "}
          lists exactly what is sent.
        </p>
      </Section>

      <Section title="Email from Walkup">
        <p>
          Walkup sends no email to anyone unless a board administrator has
          approved it, either by pressing Send on a batch they reviewed or by
          switching on a standing reminder rule that they can pause at any time.
          Sending is off until an administrator turns it on. The limits are
          enforced in the database, not only in the app: one email per person
          per week for each kind of message, no more than 20 a day for the first
          week and then the board&rsquo;s own daily limit (never above 200), 300 an
          hour across all of Walkup, nothing to an address that bounced or
          reported spam, nothing to someone who unsubscribed, and a reminder is
          skipped if the balance in it is no longer what the books show. An
          email is built from a template and facts read from the books, plus an
          optional short note the board typed. No AI model writes any email that Walkup itself sends, and
          no email contains bank account details. Every message carries an
          unsubscribe link and the standard one-click unsubscribe header, and a record of what was sent is kept for
          24 months.
        </p>
        <p>
          Three kinds of request reach Walkup without a signed-in person: the
          scheduled jobs, the delivery reports from Resend and Plaid, and
          Stripe&rsquo;s updates about Walkup&rsquo;s own plans. They run
          with a more powerful credential than any user has, so each proves who it
          is before it does anything and is kept as small as possible. The email
          jobs and Resend&rsquo;s delivery reports can call six named database
          functions and nothing else, Plaid&rsquo;s status messages can call
          one, and Stripe&rsquo;s updates can call five. Only the daily bank sync reads bank connection records directly,
          and only to fetch transactions. The only functions a
          signed-out visitor can call are the waitlist sign-up and the two that
          let an owner view and change their own email choices from an
          unsubscribe link.
        </p>
      </Section>

      <Section title="If something goes wrong">
        <p>
          If a credential is exposed or unauthorized access is suspected, the
          response is: revoke or rotate the affected credential immediately,
          review the audit log and provider access logs for what was actually
          reached, and directly notify any association whose financial data
          was involved. This is a real, written procedure, not an
          afterthought, a version with more operational detail exists
          internally for exactly that reason.
        </p>
      </Section>

      <Section title="Reporting a vulnerability">
        <div id="reporting" />
        <p>
          If you find a security problem in Walkup, please tell us privately before sharing it: email{" "}
          <a href={`mailto:${SECURITY_EMAIL}?subject=${encodeURIComponent("Security report")}`} className="text-ink underline-offset-2 hover:underline">
            {SECURITY_EMAIL}
          </a>{" "}
          with what you found and how to reproduce it. We&rsquo;ll acknowledge it within three business days and keep
          you updated until it&rsquo;s fixed.
        </p>
        <p>
          Please test only with accounts you created, don&rsquo;t read or change anyone else&rsquo;s data, don&rsquo;t
          disrupt the service, and leave Supabase, Vercel and Plaid&rsquo;s own systems alone. Research that follows these
          rules is welcome, and we won&rsquo;t take action against you for it.
        </p>
      </Section>

      <Section title="Questions">
        <p>
          For anything not covered here, including a request to see the full
          internal security policy, email{" "}
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
