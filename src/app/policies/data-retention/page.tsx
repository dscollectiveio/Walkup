import Link from "next/link";
import { PolicyPage, PolicySection, PolicyList, PolicyTable } from "@/components/policy-page";

export const metadata = { title: "Data Retention and Deletion Policy — Walkup" };

export default function DataRetentionPolicyPage() {
  return (
    <PolicyPage
      title="Data Retention and Deletion Policy"
      subtitle="Effective 2026-09-26. Reviewed every 6 months, against the privacy laws applicable to the associations using Walkup."
      intro={
        <>
          States what Walkup keeps, for how long and why, how it&rsquo;s deleted, and how a
          person can have their own data removed. See also the{" "}
          <Link href="/privacy" className="text-ink underline-offset-2 hover:underline">
            Privacy Policy
          </Link>
          .
        </>
      }
    >
      <PolicySection title="Retention schedule">
        <PolicyTable
          headers={["Data", "Retention period", "How it ends"]}
          rows={[
            [
              "Financial records: ledger, payments, charges, budgets, tax filings, and bank transactions",
              "Life of the account, then 7 years after closure (tax-record retention)",
              "Purged by the operator at the end of the period. Never altered in the meantime — errors are corrected with a reversing entry, not a deletion.",
            ],
            [
              "Plaid access tokens",
              "Only while the bank connection is active",
              "Deleted immediately when the bank is disconnected, after Plaid is told to close the connection.",
            ],
            [
              "Personal details: name, email, phone, mailing address",
              "While the person holds access or owns a unit",
              "Removed on request, or by a board admin once the person has no access and no current ownership.",
            ],
            [
              "Audit log",
              "Same period as the financial records it describes",
              "Personal-data fields scrubbed with the person's other data; the record of events is kept.",
            ],
            [
              "Invitations",
              "Until redeemed or expired",
              "An invitation's email is cleared when that person's data is removed.",
            ],
          ]}
        />
        <p>
          Financial records are retained because associations are legally required to keep their
          books and tax records, and because their reliability depends on nothing being silently
          changed or removed.
        </p>
      </PolicySection>

      <PolicySection title="Deleting personal data">
        <p>When a person&rsquo;s data is removed:</p>
        <PolicyList
          items={[
            'Their name is replaced with "Former member," and their email, phone, mailing address, and login link are erased.',
            "The same fields are erased from every audit-log entry about them and from any invitation sent to their email.",
            'Their payment and ownership history is kept, attributed to "Former member," because the association\'s financial records must remain complete.',
          ]}
        />
        <p>
          Removal is refused while the person still holds access or still owns a unit, so data is
          never deleted out from under an active relationship — access ends first, and access
          that should have ended is ended automatically (see the{" "}
          <Link href="/policies/access-controls" className="text-ink underline-offset-2 hover:underline">
            Access Controls Policy
          </Link>
          ).
        </p>
      </PolicySection>

      <PolicySection title="Requests from individuals">
        <p>
          Anyone may ask to see, correct, or remove their personal data by emailing the address
          published on the{" "}
          <Link href="/privacy" className="text-ink underline-offset-2 hover:underline">
            Privacy Policy
          </Link>
          . Requests are completed within 30 days; the requester is told what was removed and,
          where financial records must be kept, what was retained and why.
        </p>
      </PolicySection>

      <PolicySection title="Consent">
        <p>
          Every account is created only after the user affirmatively agrees to the privacy notice
          describing this collection, use, and retention, enforced on the server. Bank
          connections additionally require the user&rsquo;s explicit authorization in Plaid&rsquo;s own
          consent screen.
        </p>
      </PolicySection>

      <PolicySection title="Where data lives">
        <p>
          All association and bank data is stored in a single managed Postgres database
          (Supabase), encrypted at rest, and transmitted only over TLS. Walkup does not sell data,
          share it for marketing, or copy it to any system other than its infrastructure
          providers (Supabase, Vercel, Plaid).
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
