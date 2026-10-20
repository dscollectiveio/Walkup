# Information Security Policy

**Organization:** dscollectiveio (Doug Smart, sole operator of Walkup)
**Scope:** The Walkup application, its infrastructure, and the credentials
that control both.
**Effective:** 2026-08-05. **Last reviewed:** 2026-10-14 (outbound email,
the owner portal, spreadsheet import and the Plaid webhook added; see §3, §5,
§6, §7, §8, §9, §10), after 2026-09-26 (remediation of Plaid's security
review findings, due 2027-03-27 — see §4, §5, §9, §10, §11). **Review cadence:** every 6 months, or
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
dashboards (Supabase, Vercel, Plaid, Resend, Anthropic, GitHub), and all credentials. There is
no other staff, contractor, or shared account. One person holds all
responsibilities below:

- Granting/revoking access to infrastructure
- Reviewing and applying security-relevant dependency updates
- Responding to any suspected incident
- Reviewing this policy on the cadence above

## 3. Data classification

| Data | Sensitivity | Where it lives |
|---|---|---|
| Plaid access tokens | Critical — a live credential that can read a real bank account | `bank_connection_secrets` table, RLS enabled with zero policies; reachable only through `SECURITY DEFINER` functions (`store_bank_connection`, `get_bank_access_token`). The token is also sealed by the application (AES-256-GCM, key `BANK_TOKEN_KEY`, held only in the server environment) before it is stored, so even a board admin calling the function receives only ciphertext. See `docs/DECISIONS.md` #24, #27. |
| Supabase service role key, Anthropic API key, Plaid client secret, Resend API key (`RESEND_API_KEY`, scoped to sending for walkuphoa.com), Resend webhook signing secret (`RESEND_WEBHOOK_SECRET`), `CRON_SECRET`, `BANK_TOKEN_KEY` | Critical — full backend, paid-API or outbound-email access | Server-only env vars (`.env.local` locally, Vercel project settings in production). Never sent to the browser, never committed — `.env.local` is gitignored. |
| Association financial records (ledger, tax figures, bank transactions) | Sensitive — financial/PII-adjacent | Postgres, protected by row-level security scoped to `association_id` on every table. |
| Application source code | Low — no secrets committed | GitHub, `dscollectiveio/Walkup`, private repo. |

## 4. Access control

- All infrastructure accounts (GitHub, Vercel, Supabase, Plaid dashboard,
  Anthropic console, Resend) are single-owner, no shared logins.
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

### 4d. Recovery codes, idle timeout and fresh sign-in

Added 2026-10-20 (`docs/DECISIONS.md` #46, migration `0078`).

- **Recovery codes.** Ten single-use codes per account, made when an
  authenticator is enrolled and on request (Account > Sign-in and security,
  behind a fresh authenticator code). Shown once. Only salted scrypt hashes are
  stored; users cannot read hashes. A person who lost their authenticator spends
  a code on the sign-in code page, which removes their authenticator so they can
  enrol a new one. Five wrong codes lock redemption for 15 minutes (counted in
  the database). Codes are never logged.
- **Idle timeout.** 12 hours without a request ends the session; the next request
  signs out and goes to `/login` with a notice. Tracked by an httpOnly cookie
  (`walkup.activity`) refreshed at most once a minute, set in `src/proxy.ts`
  via `src/lib/supabase/proxy.ts`. No database call. The cookie is a convenience
  layer; the sign-out itself revokes the session on the server.
- **Fresh sign-in for access changes.** Changing a person's roles, creating an
  invite, and extending accountant access require an authenticator code entered
  within the last 15 minutes. Otherwise the action refuses and points to
  `/confirm-sign-in`.
- **Limits.** The fresh sign-in rule is enforced in the application, not in the
  database. Browser prefetch counts as activity. A recovery code replaces the
  second factor, so codes must be stored as carefully as a password.

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
The manual runbook for if that changes is `docs/OFFBOARDING.md`; it stays
"currently applicable to no one" until it isn't.

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
- **Outbound email** (`docs/DECISIONS.md` #36, migration 0055). Walkup sends
  no email unless a board administrator approved it: a batch they reviewed
  and sent, or a standing rule they switched on (MFA-gated like every other
  board action). The limits are enforced in SQL, not in the app: one email
  per person per week per kind; 20 a day for the first week after sending is
  switched on, then the board's daily limit (default 60, never above 200);
  300 an hour platform-wide; never to an address that bounced or reported
  spam, nor to someone who opted out; a reminder is skipped, not sent, when
  the balance in it is no longer what the ledger shows. Content is a template
  plus ledger facts plus an optional 500-character note with no links or
  addresses; no model writes any email; no account number, routing number or
  Zelle handle is ever in one. Every message carries a one-click unsubscribe
  link and header. A platform admin can suspend an association's sending. The
  history (who, which kind, when, delivery result) is kept 24 months, and the
  address is blanked by "Remove personal data" (`redact_person`, 0055). With no
  `RESEND_API_KEY` the app still works: drafts are prepared and opened with
  `mailto:`.
- **Entry points without a signed-in person.** There are four, each small and
  each proving who it is on every request: the bank-sync cron (#28), the
  email-reminder cron (`CRON_SECRET`), the Resend webhook (Svix signature) and
  the Plaid webhook (Plaid's signed JWT, #37). The two email entry points use
  the service key only through `serviceRpc()`
  (`src/lib/email-outbox/service-rpc.ts`), an allowlist wrapper that can call
  six named functions that are granted to `service_role` and nobody else; it
  cannot read or write a table, and a unit test fails if any other file imports
  it or reads `SUPABASE_SERVICE_ROLE_KEY`. The Plaid webhook calls one
  function (`flag_bank_item_for_attention`, 0058). The only functions callable
  by `anon` are `join_state_waitlist` (#34) and the two unsubscribe functions
  (`email_preference_for_token`, `email_unsubscribe`, behind a 48-byte token);
  the lint test in `tests/db/migrations.test.ts` lists all three.
- **Spreadsheet import** (#39, migration 0056). A board admin's upload is read
  server-side with caps (5 MB, 5,000 rows, 40 columns, 2,000 characters a
  cell, and a zip central-directory check before unpacking), formulas are never
  evaluated. Only the columns the board maps are kept. If the board
  asks for help matching columns, the model sees only column names and a
  character mask of a few sample cells, never the values. The file is removed
  once its rows are staged unless the board keeps a copy.
- **Owner portal** (#38, migration 0054). Everything an owner reads that is not
  already under row-level security comes through a `SECURITY DEFINER` function
  that returns nothing to anyone but the unit's owner or a financial reader;
  announcement read receipts are counts for the board only.

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

**Accepted risk: braces (GHSA-vfj7-8cjw-p6xm), development tooling only.**
`braces <= 3.0.3` is reachable only through eslint-config-next, then
@next/eslint-plugin-next, fast-glob and micromatch: the lint toolchain on
developer machines and in CI. It is not installed in production
(`npm audit --omit=dev` reports 0). The flaw is a denial of service from
pathologically nested glob patterns; our lint globs are fixed in the
repository and no untrusted input reaches them. No patched braces release
exists as of 2026-10-14, and the only remedy npm offers is a downgrade to an
older eslint-config-next, which we reject. The CI gate audits production
dependencies at high severity (`npm audit --omit=dev --audit-level=high`);
development dependencies are reported weekly but do not fail the run. Remove
this exception when braces publishes a fix.

**End-of-life software.** A runtime within 90 days of end of support fails
the weekly check; the upgrade is planned then and completed before the
end-of-support date. Nothing in use may run past end of support.

## 6. Incident response

If a credential is exposed, a security bug is found, or unexpected access
is observed:

1. **Contain:** rotate the affected credential immediately (Plaid
   client secret/access tokens, Supabase service role key, Anthropic key,
   `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `CRON_SECRET`, `BANK_TOKEN_KEY`,
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
   happened and what data was involved, **within 72 hours of confirming the
   exposure** (a target set by the operator; it is not a Plaid requirement).
   Plaid is told if a Plaid credential or an access token may have been
   exposed, and any other affected vendor (Supabase, Vercel, Resend,
   Anthropic) is told through its own security contact so it can help look
   at its side.
4. **Remediate:** fix the root cause (revoked credential, patched
   dependency, corrected RLS policy) and add a migration or policy update
   so the same class of issue can't recur silently.
5. **Record:** write up what happened, even briefly, in this repo's
   `docs/` so there's a durable history — this policy is not considered
   "operationalized" if incidents go undocumented.

**Backup contact.** Walkup has one operator, so there is a single point of
failure in responding to an incident. A named backup person who can rotate
credentials and reach the vendor dashboards if the operator is unreachable is
an open item (§8); until one is named, this policy does not claim there is one.

**Exercised or not.** This plan has not been exercised. It has not been used
for a real incident and has not been rehearsed. The first rehearsal (a
credential rotation of the Resend key and the cron secret, end to end) is an
open item in §8; the result will be recorded here.

## 7. Vendor risk

Walkup depends on Supabase (database/auth/storage), Vercel (hosting),
Plaid (bank data, read-only), Anthropic (AI features), and Resend
(outbound email). Each is a
mainstream provider with its own security/compliance program (Supabase and
Vercel are SOC 2 Type II; Plaid maintains SOC 2 and is itself running this
same kind of vendor review). Walkup does not attempt to duplicate their
infrastructure security — it relies on them for that layer and focuses this
policy on what Walkup controls: how credentials for those services are
handled, and what each integration is scoped to do.

**Anthropic (subprocessor, added 2026-10-14).** Anthropic's Claude models
are called server-side only, with a key held in the server environment,
for four uses (`docs/DECISIONS.md` #35, foundation-spec §9):

1. **Reading documents** — text from uploaded documents, with SSN- and
   tax-ID-shaped numbers removed before sending; an insurance declarations
   page or quote with no text layer is sent as the file itself, and tax
   IDs are removed from what comes back before storage (#35, brief
   decision 7). Contractor quotes and insurance certificates are read the
   same way when the board asks.
2. **Reported problems** — a problem's title, description and location
   detail, with email addresses, phone numbers, unit numbers and dollar
   amounts removed, to suggest the kind of work and flag a possible
   emergency (a suggestion the board accepts or dismisses; safety guidance
   never depends on it).
3. **Drafts and summaries** — a saved policy's figures and insurer for its
   plain-English summary (never the policy number, named insured, address or
   agent's details); insurance email drafts receive only the kind of email
   and coverage types, with names and numbers filled in afterwards.
   No model writes an email that Walkup sends (#36); drafts to contractors
   and agents open in the board's own mail app (#22).
4. **Web research** — Anthropic's server-side web search for insurers,
   agencies and contractors, given only city, state, ZIP code, unit count,
   stories, year built, construction type, coverage types, the kind of work
   and a phrase from Walkup's fixed repair vocabulary. Results are kept only
   when verified against the sources the search returned.

A fifth, narrower use is the spreadsheet import's optional column matching
(#39): only the column names and a character mask of a few sample cells
(letters shown as x, digits as 9) are sent, never the values. It runs as the
existing `document_classify` kind.

Every call is claimed and logged in `ai_calls` (no prompt or answer
content) against a per-association daily limit enforced in the database
before the call is made. Under Anthropic's commercial terms, inputs are not
used to train models. The Anthropic Console sits behind Google sign-in with
2-Step Verification (§8), and the API key is rotated on the same terms as
the other critical secrets in §3.

**Resend (subprocessor for outbound email, added 2026-10-14).** Resend
delivers the account emails and the reminders, statements and notices a
board administrator approves (#36). It receives the recipient's name and
address and the message text, including a statement PDF when attached, and
reports delivery, bounces and spam complaints back through a webhook whose
Svix signature is verified before anything is read
(`/api/email/webhook`, secret `RESEND_WEBHOOK_SECRET`). The API key is scoped
to sending for walkuphoa.com only and is held in the server environment;
without it nothing is sent and the app falls back to drafts. A hard bounce or
spam complaint puts the address on a per-association block list. Messages
never contain bank account details or links other than to Walkup.

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
- [x] Plaid webhooks: Walkup receives Plaid's item webhooks at
      `/api/plaid/webhook` (Production only). Each is verified against
      Plaid's published signing key (ES256, five-minute freshness, body
      hash) before anything is read; unverified requests are rejected and
      logged without their content. Only four item events act, and they only
      mark a bank connection as needing attention so the board sees
      "Reconnect"; the webhook never reads a token, never syncs, never
      touches the ledger. Transactions are still fetched by the daily sync
      and the board's own Sync now. The receiver uses the service role
      through a single function (`docs/DECISIONS.md` #37). A sync that finds
      a revoked or deleted connection stops retrying it and tells the board
      to disconnect and reconnect; syncs are capped at 20 pages per run and
      resume from a saved cursor. (Replaces the earlier "no Plaid webhook"
      gap, 2026-10-14; live once migration 0058 and `PLAID_WEBHOOK_URL` are
      in production.)
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
      Vercel so the daily jobs — bank sync and automated deprovisioning
      (§4b), and the email-reminder run — actually run.
- [ ] Outbound email go-live (2026-10-14): verify walkuphoa.com in Resend
      (DKIM and the return-path domain, checked against the ImprovMX
      records), publish a DMARC record (`_dmarc`, `p=none` to start), create
      the sending-only API key and set `RESEND_API_KEY`, create the webhook
      endpoint `https://www.walkuphoa.com/api/email/webhook` and set
      `RESEND_WEBHOOK_SECRET`, and replace the `LEGAL_ADDRESS` placeholder in
      `src/lib/site-config.ts` with DS Collective LLC's postal address. Until
      then every email stays a draft.
- [ ] Set `PLAID_WEBHOOK_URL` in Production and register the webhook on the
      existing bank connection (`registerBankWebhook`), after migration 0058 is
      applied to production.
- [ ] Create the Resend account with a unique password in the password
      manager and two-factor authentication, before the sending key is made
      (§4 lists it as an infrastructure account).
- [ ] Name a backup contact for incident response and rehearse §6 once (see
      §6, "Backup contact" and "Exercised or not").

## 9. Data retention and deletion

What is kept, for how long, and how it is removed:

| Data | Retention | Deletion |
|---|---|---|
| Ledger, payments, charges, budgets, tax filings, bank transactions | For the life of the association's account, then 7 years after the account is closed (tax-record retention) | Purged by the operator at the end of that period. Never altered in the meantime — mistakes are corrected with a reversing entry. |
| Plaid access tokens | Only while the bank connection is active | Deleted the moment the bank is disconnected, after Plaid is told to close the connection (`disconnectBank`, #27). |
| A person's name, email, phone, mailing address | While they hold access or own a unit | Removed on request, or by a board admin once the person has no access and no current ownership — "Remove personal data" (`redact_person()`, 0037). The name becomes "Former member"; payment and ownership history stays attached. The same fields are scrubbed from the audit log (DECISIONS #30). |
| Audit log | Same as the financial records it describes | Personal fields scrubbed as above; the events themselves are kept. |
| Pending invites | Until redeemed or expired | An invite's email is cleared when that person's data is removed. |
| Email history (who, which kind, when, delivery result) | 24 months, then removed by the daily job | Addresses are blanked by "Remove personal data" (`redact_person`, 0055). |
| A spreadsheet a board imports | Removed once its rows are staged, unless the board keeps a copy in the Document Hub | The staged rows stay with the import so it can be undone; a kept copy is deleted by the board in the Document Hub. |
| Announcement read receipts | Life of the announcement | Hold only a person id and a time; the board sees counts, never names. The person's name is cleared by "Remove personal data". |

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
and the elevated credential is confined to four small server entry points: the daily bank sync (#28), the email-reminder run and the Resend webhook (#36, through a six-function allowlist), and the Plaid webhook (#37, one function). Each authenticates itself on every request.

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
