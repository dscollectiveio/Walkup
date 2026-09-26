import { PolicyPage, PolicySection, PolicyList, PolicyTable } from "@/components/policy-page";

export const metadata = { title: "Access Controls Policy — Walkup" };

export default function AccessControlsPolicyPage() {
  return (
    <PolicyPage
      title="Access Controls Policy"
      subtitle="Version 1.1 — effective 2026-08-05, updated 2026-09-26. Reviewed every 6 months."
      intro="Defines how access to Walkup's production systems, source code, and the association data they hold is granted, authenticated, reviewed, and removed."
    >
      <PolicySection title="Roles and responsibilities">
        <p>
          Doug Smart is the only individual with access to source code, infrastructure
          dashboards, and credentials. There are no other employees, contractors, or shared
          accounts.
        </p>
      </PolicySection>

      <PolicySection title="Infrastructure access">
        <PolicyList
          items={[
            "Supabase, Vercel, Plaid, and GitHub are single-owner accounts. No account is shared; no generic or team login exists.",
            "Every infrastructure account requires multi-factor authentication. Phishing-resistant passkeys are registered on GitHub, Vercel, and the Google account used for Plaid and Anthropic; Supabase uses an authenticator app. SMS is not accepted as a second factor on any account.",
            "Vercel team membership enforces two-factor authentication for every member.",
            "Credentials are stored in a password manager, never reused, never shared over chat or email, never committed to source control.",
            "The workstation holding production credentials has full-disk encryption and automatic security updates.",
            "Every schema change and every change to who can read what is made through a reviewed, version-controlled migration — never a direct dashboard edit.",
          ]}
        />
      </PolicySection>

      <PolicySection title="Application access (role-based)">
        <p>
          Access to association data is enforced by role-based access control implemented as
          database row-level security, so it holds regardless of application code. Each role is
          scoped to one association:
        </p>
        <PolicyTable
          headers={["Role", "Access"]}
          rows={[
            ["Board admin", "Full read and write, including granting and revoking roles"],
            ["Board member", "Full read, limited write; cannot change roles"],
            ["Accountant", "Read access to financial records; expires automatically after 90 days unless renewed"],
            ["Owner", "Read-only access to their own unit's records and the association's governance documents"],
          ]}
        />
        <p>
          No user can read or write another association&rsquo;s data, through the application or
          directly through its API.
        </p>
      </PolicySection>

      <PolicySection title="Authentication">
        <p>
          Every user must complete authenticator-app multi-factor authentication before reaching
          any page, including before a bank account can be connected through Plaid Link. This is
          enforced both in the application and independently in the database, which refuses any
          session that has not completed MFA. One documented exception: a user may view or edit
          their own name and contact details before completing MFA, so account setup remains
          possible — no financial or association data is reachable that way.
        </p>
      </PolicySection>

      <PolicySection title="Periodic access reviews">
        <PolicyList
          items={[
            "Application: every 90 days a board admin reviews everyone with access to their association and records the review. Each recorded review stores an immutable snapshot of every active grant at that moment, and the application reminds admins when a review is due.",
            "Infrastructure: every 6 months the operator confirms no account other than his own exists on each platform, confirms each account's second factors, and removes anything no longer needed.",
          ]}
        />
      </PolicySection>

      <PolicySection title="Deprovisioning">
        <p>
          With no employees or contractors, there is no staff offboarding to automate. The
          equivalent control applies to people with access to association data, and it is
          automated:
        </p>
        <PolicyList
          items={[
            "When a unit's sale or transfer closes and the former owner owns no other unit, their access is revoked automatically.",
            "Accountant access expires on its end date; the database refuses an expired grant immediately and the revocation is recorded.",
            "These checks run daily and at the start of every access review. System revocations are recorded in the audit log and distinguishable from manual ones.",
            "A board admin can revoke any role immediately at any time.",
            "Once a person has no access and no ownership, their personal details can be removed entirely — see the Data Retention and Deletion Policy.",
          ]}
        />
      </PolicySection>

      <PolicySection title="Non-human authentication and secrets">
        <p>
          All traffic between browsers, the application, its database, and third parties is
          encrypted with TLS. Bank connections use Plaid-issued tokens, scoped to read-only
          transaction data. The one elevated, non-user database credential is confined to a
          single scheduled job, authenticated by a dedicated secret on every invocation. Plaid
          access tokens are stored in a database table no user role can read, including
          administrators, reachable only through two narrow functions that check the caller&rsquo;s
          authorization first.
        </p>
      </PolicySection>

      <PolicySection title="Access architecture">
        <p>
          Walkup does not grant trust based on network location. There is no internal network or
          VPN: every request is authenticated, checked for completed MFA, and authorized row by
          row by the database, whether it comes from the application&rsquo;s own pages or directly
          against its API. This follows zero-trust principles — verify every request, least
          privilege, no implicit trust. It is not a formally certified zero-trust architecture:
          there is no device-posture check or identity-aware proxy in front of the vendors&rsquo;
          administrative dashboards, which rely on those vendors&rsquo; own controls plus the MFA
          requirements above.
        </p>
      </PolicySection>

      <PolicySection title="Audit logging and incident response">
        <p>
          Changes to access and to financial records are written to an append-only audit log
          that no role can edit — the single exception is the removal of a former member&rsquo;s
          personal details, which scrubs those fields from the log while keeping the record of
          what happened. If a credential is exposed or unauthorized access is suspected: the
          affected credential is rotated at its source, the audit log and provider logs are
          reviewed for what was reached, any affected association is told what happened, and the
          root cause is fixed and recorded.
        </p>
      </PolicySection>
    </PolicyPage>
  );
}
