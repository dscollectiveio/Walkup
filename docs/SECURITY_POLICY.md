# Information Security Policy

**Organization:** dscollectiveio (Doug Smart, sole operator of Walkup)
**Scope:** The Walkup application, its infrastructure, and the credentials
that control both.
**Effective:** 2026-08-05. **Last reviewed:** 2026-09-26 (remediation of
Plaid's security review findings, due 2027-03-27 — see §4, §5, §9, §10,
§11). **Review cadence:** every 6 months, or
immediately after any incident, new vendor integration, or change in who
has access to production systems.

This is a one-person operation. The policy below is sized to that reality —
it describes what one person can actually keep up, not a paper process
copied from a larger org. Where a control is not yet in place, that is
stated explicitly rather than implied.

## 1. Purpose

Walkup handles condominium association financial records and, via Plaid, a
read-only feed of bank transaction data. This policy exists to identify
where that data and the credentials protecting it are at risk, keep the
risk mitigated on an ongoing basis, and define what happens if something
goes wrong.

## 2. Roles and responsibilities

Doug Smart is the sole person with access to source code, infrastructure
dashboards (Supabase, Vercel, Plaid, GitHub), and all credentials. There is
no other staff, contractor, or shared account. One person holds all
responsibilities below:

- Granting/revoking access to infrastructure
- Reviewing and applying security-relevant dependency updates
- Responding to any suspected incident
- Reviewing this policy on the cadence above

## 3. Data classification

| Data | Sensitivity | Where it lives |
|---|---|---|
| Plaid access tokens | Critical — a live credential that can read a real bank account | `bank_connection_secrets` table, RLS enabled with zero policies; reachable only through `SECURITY DEFINER` functions (`store_bank_connection`, `get_bank_access_token`). See `docs/DECISIONS.md` #24, #27. |
| Supabase service role key, Anthropic API key, Plaid client secret | Critical — full backend or paid-API access | Server-only env vars (`.env.local` locally, Vercel project settings in production). Never sent to the browser, never committed — `.env.local` is gitignored. |
| Association financial records (ledger, tax figures, bank transactions) | Sensitive — financial/PII-adjacent | Postgres, protected by row-level security scoped to `association_id` on every table. |
| Application source code | Low — no secrets committed | GitHub, `dscollectiveio/Walkup`, private repo. |

## 4. Access control

- All infrastructure accounts (GitHub, Vercel, Supabase, Plaid dashboard,
  Anthropic console) are single-owner, no shared logins.
- **Required baseline (tracked as open items — see §8):** unique passwords
  via a password manager, and two-factor authentication enabled on every
  account listed above.
- No credential is ever pasted into chat tools, tickets, or committed to
  git. If one is exposed accidentally, it is treated as a security incident
  (§6), not just "rotate and move on."
- Application-level roles (`board_admin`, `board_member`, `accountant`,
  `owner`) are enforced by Postgres RLS, not by application code — see
  `docs/DECISIONS.md` and the invariants in `CLAUDE.md`. This limits what a
  compromised end-user session, as opposed to a compromised infrastructure
  credential, can reach.
- **Consumer MFA:** every Walkup user (not just board_admin) must complete
  TOTP-based MFA before reaching any page, including the Plaid-connect flow
  — `docs/DECISIONS.md` #26. Enforced twice: `src/proxy.ts` redirects a
  session that hasn't cleared MFA before it can render anything, and
  migration `0025_mfa_enforcement.sql` makes AAL2 a real database
  requirement via `session_is_aal2()`, so the same access is refused even
  to a direct API call that skips the UI entirely. One known, accepted gap:
  a user can still read/edit their own contact details (not financial data)
  at AAL1 via `persons_select`/`persons_update`'s
  `auth_user_id = auth.uid()` path — documented in #26 rather than closed
  silently.

### 4a. Periodic access reviews

Every 90 days a board admin reviews who holds access to their association
and records it on the Building page ("Access review"). Recording a review
(`record_access_review()`, migration 0037) writes an append-only row with a
snapshot of every active grant that day — evidence of the review, not a
claim that one happened — and first runs the automated deprovisioning in
§4b. The home page reminds a board admin when a review is due or overdue.

Infrastructure access (GitHub, Vercel, Supabase, Plaid, Google/Anthropic)
is reviewed on this policy's own 6-month cadence: confirm no account other
than the operator's exists, confirm each account's second factors, and
remove any that are no longer needed.

### 4b. Deprovisioning

Walkup has no employees or contractors — the operator is the only person
with infrastructure access, so there is no staff offboarding to automate.
The equivalent control is on the people who hold access to association
data, and it is automated (`deprovision_stale_access()`, 0037):

- **Transferred owners.** When a unit sale or transfer closes (the
  ownership record's end date passes) and that person owns no other unit,
  their owner access is revoked automatically. Owners who have not yet been
  assigned a unit are left alone — that access is pending, not stale.
- **Time-boxed access.** Accountant grants expire after 90 days by default;
  access checks refuse an expired grant immediately (`has_role_in`, 0025),
  and the revocation is then recorded as an event.
- **When it runs.** Daily, from the scheduled bank-sync job, and at the
  start of every recorded access review. Revocations by the system carry no
  `revoked_by`, which is how the audit log tells them apart from a person's.
- **Manual removal** of any role is immediate from the People section.

### 4c. Multi-factor authentication on infrastructure

Every infrastructure account has MFA and a registered passkey. The target
is that no account still accepts SMS as a second factor, since SMS is
phishable and SIM-swappable — tracked in §8 until done on GitHub and the
Google account.

## 5. Risk identification and mitigation

Ongoing, not one-time:

- **Dependency vulnerabilities** — see "Vulnerability and patch
  management" below.
- **Schema/access changes:** every schema change is a reviewed migration
  file, never a dashboard edit (`CLAUDE.md` invariant #10), so there is a
  durable record of every change to who-can-read-what.
- **New third-party integrations** (e.g. Plaid, future Anthropic document
  intake) are evaluated for what credential they require and what they can
  reach before being added — the existing bank-feed integration is
  deliberately read-only; see `docs/DECISIONS.md` #22 and #24 for the
  reasoning against wider access.
- **Secrets architecture** follows a consistent pattern across the app:
  secrets stay server-side, sensitive tables are RLS-locked with access
  only through narrow `SECURITY DEFINER` functions, and those functions
  pin `search_path` to prevent privilege-escalation (`CLAUDE.md` invariant
  #11).

### Vulnerability and patch management

**Scanning.** Three independent sources, all automated:

- `.github/workflows/security.yml` runs `npm audit --audit-level=high`
  against the full dependency tree on every push to `main`, every pull
  request, and weekly (Mondays). A failure emails the repository owner.
- Dependabot alerts and security updates on the GitHub repository flag
  known-vulnerable dependencies and open patch pull requests
  automatically; `.github/dependabot.yml` additionally keeps npm packages
  and GitHub Actions current weekly.
- The same workflow runs `scripts/check-eol.mjs` weekly, checking Node.js
  (`.nvmrc`), Next.js (`package.json`), and the Supabase Postgres major
  version against endoflife.date.

Walkup runs on managed platforms with no servers or VMs of its own —
Vercel and Supabase patch the operating system and database engine; there
is no separately managed production host to scan. The one workstation with
production access has automatic update checks and automatic installation of
macOS and security updates turned on, and FileVault on (verified
2026-09-26). Updates that need a restart are applied within the SLA above
by their own severity.

**Patch SLA,** measured from the first alert or failing scan:

| Severity | Patched in production within |
|---|---|
| Critical | 7 days |
| High | 14 days |
| Moderate | 30 days |
| Low | Next routine update |

If a fix isn't available upstream within the SLA, the exposure is
assessed and mitigated (disable the affected feature, pin away from the
vulnerable code path) and the decision is written down in `docs/`.
First application: on 2026-09-26 a critical Next.js advisory
(GHSA-2xp9-vwfh-vxw4) and three high-severity advisories were patched the
same day they were found (commit `0e3001d`).

**End-of-life software.** A runtime within 90 days of end of support fails
the weekly check; the upgrade is planned then and completed before the
end-of-support date. Nothing in use may run past end of support.

## 6. Incident response

If a credential is exposed, a security bug is found, or unexpected access
is observed:

1. **Contain:** rotate the affected credential immediately (Plaid
   client secret/access tokens, Supabase service role key, Anthropic key,
   or account password) at the source dashboard. **Rotating the Plaid
   client secret does not invalidate existing access tokens** — those are
   per-Item and independent of the secret used to obtain them. If a token
   itself is the suspected exposure, containment means calling
   `/item/remove` for every affected connection (the app's `disconnectBank`
   action does this — see `docs/DECISIONS.md` #27), or removing the Item by
   `plaid_item_id` directly in the Plaid dashboard if the stored token is
   already gone.
2. **Assess:** check `audit_log` (append-only, per `CLAUDE.md` invariant
   #7) for what was read or written using the exposed access, and the
   relevant provider's own access logs (Supabase logs, Plaid dashboard
   activity, Vercel deployment logs).
3. **Notify:** if association financial data was actually exposed to
   someone unauthorized, the affected association's board is told what
   happened and what data was involved.
4. **Remediate:** fix the root cause (revoked credential, patched
   dependency, corrected RLS policy) and add a migration or policy update
   so the same class of issue can't recur silently.
5. **Record:** write up what happened, even briefly, in this repo's
   `docs/` so there's a durable history — this policy is not considered
   "operationalized" if incidents go undocumented.

## 7. Vendor risk

Walkup depends on Supabase (database/auth/storage), Vercel (hosting),
Plaid (bank data, read-only), and Anthropic (AI features, not yet in this
slice). Each is a mainstream provider with its own security/compliance
program (Supabase and Vercel are SOC 2 Type II; Plaid maintains SOC 2 and
is itself running this same kind of vendor review). Walkup does not
attempt to duplicate their infrastructure security — it relies on them for
that layer and focuses this policy on what Walkup controls: how
credentials for those services are handled, and what each integration is
scoped to do.

## 8. Open items (as of 2026-08-05)

These are gaps, not claims — tracked here so the policy doesn't overstate
what's actually in place:

- [x] Enable 2FA on GitHub, Vercel, Supabase, Plaid dashboard, and
      Anthropic console. GitHub, Vercel, and Supabase have 2FA enabled
      directly. Plaid dashboard and Anthropic Console are accessed via
      "Sign in with Google," so their security is inherited from the
      Google account's 2-Step Verification, which is enabled.
- [x] Adopt a password manager for all infrastructure account credentials.
      Using macOS iCloud Keychain / Passwords app.
- [x] Enable disk encryption (FileVault) on the development machine, since
      `.env.local` with live secrets lives there. Confirmed on via
      `fdesetup status`.
- [x] Dependency monitoring: automated `npm audit` + end-of-life checks in
      CI (`.github/workflows/security.yml`), Dependabot version updates
      (`.github/dependabot.yml`). **Correction, 2026-09-26:** earlier
      versions of this policy said Dependabot alerts were enabled; the
      repository settings showed alerts and security updates were off.
      Tracked below until turned on.
- [x] Consumer MFA before Plaid Link is reachable. `docs/DECISIONS.md` #26,
      `supabase/migrations/0025_mfa_enforcement.sql`, `src/proxy.ts`,
      `tests/db/mfa-enforcement.test.ts`. Doug's own account still needs to
      complete enrollment on first login after this deploys — the page
      (`/account/mfa`) forces that automatically.
- [x] Plaid production readiness: `PLAID_ENV` fails closed instead of
      defaulting to sandbox, `disconnectBank` calls Plaid's `/item/remove`
      before revoking locally, and OAuth institutions are supported via a
      dedicated redirect route. `docs/DECISIONS.md` #27,
      `supabase/migrations/0026_bank_connection_item_removal.sql`.
- [ ] No Plaid webhook, so a stale connection (`ITEM_LOGIN_REQUIRED`)
      surfaces only as a sync error, not a proactive notice — a manual
      check, not automated monitoring. Tracked, not yet built.
- [ ] Live deployment (Vercel project, production Supabase project, Plaid
      production credentials actually in use) — this policy's controls
      apply to the code as written; §2's "review immediately after any...
      new vendor integration" trigger fires again once the deployment
      itself is live, to confirm the controls above actually hold in that
      environment.
- [ ] Turn on Dependabot alerts and Dependabot security updates in the
      GitHub repository settings (Settings → Advanced Security).
- [ ] Remove SMS as a second factor on GitHub and on the Google account
      (§4c), leaving passkeys and an authenticator app.
- [ ] Confirm the Vercel project's Node.js version matches `.nvmrc` (24).
- [ ] Install the pending macOS Sequoia 15.8 and Safari 27 updates on the
      workstation (found 2026-09-26: auto-install is on, but both are
      waiting on a restart).
- [ ] Confirm `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are set in
      Vercel so the daily job — bank sync and automated deprovisioning
      (§4b) — actually runs.

## 9. Data retention and deletion

What is kept, for how long, and how it is removed:

| Data | Retention | Deletion |
|---|---|---|
| Ledger, payments, charges, budgets, tax filings, bank transactions | For the life of the association's account, then 7 years after the account is closed (tax-record retention) | Purged by the operator at the end of that period. Never altered in the meantime — mistakes are corrected with a reversing entry. |
| Plaid access tokens | Only while the bank connection is active | Deleted the moment the bank is disconnected, after Plaid is told to close the connection (`disconnectBank`, #27). |
| A person's name, email, phone, mailing address | While they hold access or own a unit | Removed on request, or by a board admin once the person has no access and no current ownership — "Remove personal data" (`redact_person()`, 0037). The name becomes "Former member"; payment and ownership history stays attached. The same fields are scrubbed from the audit log (DECISIONS #30). |
| Audit log | Same as the financial records it describes | Personal fields scrubbed as above; the events themselves are kept. |
| Pending invites | Until redeemed or expired | An invite's email is cleared when that person's data is removed. |

**Requests.** Anyone can ask for their data to be removed or corrected by
emailing the address on `/privacy`. The operator handles it within 30
days: removing personal data through the same mechanism a board admin
uses, and telling the requester what was removed and what must be kept
(financial records, for the reason above).

**Review.** This section is reviewed on the policy's 6-month cadence,
against the privacy laws that apply to the associations using Walkup
(currently Illinois).

## 10. Access architecture

Walkup does not rely on network location for trust. There is no internal
network, VPN, or "inside" — every request, from the app's own pages or
directly against the API, is authenticated and then authorized row by row
by the database (row-level security), with MFA required at the database
level (0025). Service-to-service calls use scoped credentials over TLS,
and the only elevated credential is confined to one scheduled job (#28).

That is the substance of a zero-trust approach, and it is what Walkup
claims. It is not a formally certified zero-trust architecture — there is
no device-posture checking or identity-aware proxy in front of the
infrastructure dashboards, which rely on those vendors' own controls plus
the MFA in §4c.

## 11. Remediation tracker (Plaid security review, due 2027-03-27)

| Finding | Status |
|---|---|
| Patch vulnerabilities within a defined SLA | Done — SLA and scanning in §5 |
| Monitor end-of-life software | Done — weekly check, §5 |
| Periodic access reviews and audits | Done — §4a |
| Automated deprovisioning | Done — §4b |
| Zero-trust access architecture | Written statement, §10 |
| Data deletion and retention policy | Done — §9 |
| Robust MFA on the consumer app | In place since 0025 (TOTP, enforced in the database) |
| Robust MFA on internal systems | Passkeys on every account; SMS removal pending (§8) |
