# Plaid production access review: Walkup readiness

**Prepared:** 2026-10-14, read-only review of the repository at that date (working tree included, so
uncommitted edits were read as they stand). Nothing was run against any Supabase project, Plaid, or
Vercel. Anything about production state is marked "needs Doug".
**Sources in the repo:** `docs/DECISIONS.md` #22, #24-#30; `docs/SECURITY_POLICY.md`; `docs/OFFBOARDING.md`;
`docs/security/STAGING.md`; `src/lib/plaid.ts`, `src/lib/plaid/*`, `src/app/bank-feed/*`,
`src/app/api/cron/sync-bank-feeds/route.ts`, `src/lib/security/secret-box.ts`, `src/lib/security/csp.ts`,
`src/lib/supabase/proxy.ts`, migrations 0016, 0025, 0026, 0035, 0037, 0050; public pages `/privacy`,
`/security`, `/terms`, `/policies/*`.
**Plaid sources fetched today:** Link OAuth guide, Link update mode, Link web, Link best practices,
Launch checklist, Webhooks overview and verification, Items API (`/item/remove`, Item webhooks),
Transactions webhooks, Balance, Plaid support pages on Production access and OAuth registration.

## 0. Read this first: three findings that change the plan

1. **The daily cron job almost certainly never runs.** `src/lib/supabase/proxy.ts` redirects every
   unauthenticated request to `/login` unless the path is in `PUBLIC_PATHS`, and `/api/cron/...` is not in
   that list (the matcher in `src/proxy.ts` covers `/api`). Vercel Cron calls the route with only a bearer
   header, no session, so it gets a 307 to `/login`. Consequences: no daily bank sync, and no automated
   deprovisioning (`deprovision_stale_access`, DECISIONS #30), which is one of the eight attestations Walkup
   gives Plaid. Fix is one line plus a test (PL1 gap 1). Doug can confirm today: Vercel, project, Logs,
   filter path `/api/cron/sync-bank-feeds`, and look for status 307 instead of 200.
2. **Raw Plaid errors are written to logs.** `balances.tsx:77,86` and `page.tsx:371` pass the whole caught
   error to `console.error/warn`. Plaid's Node SDK throws an axios error whose `config` contains the request
   headers (`PLAID-SECRET`) and body (`access_token`). Those would land in Vercel logs. Treat as a credential
   exposure risk until fixed; after the fix is deployed, check Vercel log retention and consider rotating
   `PLAID_SECRET` if production ever logged one of those errors (PL1 gap 2).
3. **The app receives no Plaid webhooks.** Plaid's Launch checklist says webhooks are "required or strongly
   recommended" for integrations that access transactions made after the user linked, which Walkup does
   every day. Polling works technically, but a reviewer will ask. Minimal safe design is in section 4.

## 1. Status summary

Counts are over the 49 rows in section 2 (A: 20, B: 8, C: 21).

| Status | Count |
|---|---|
| Met | 20 |
| Partly | 18 |
| Not met | 4 |
| Needs Doug | 7 |

"Needs Doug" means the code or text is fine but the fact lives in a dashboard or in his head. Status
meanings: **met** = verified in code or published text; **partly** = exists but a gap remains; **not met**
= absent or broken; **needs Doug** = cannot be verified from the repo.

## 2. Requirement-to-state table

Evidence paths are relative to the repo root. "Fix" is the exact change; code fixes are itemised in
`docs/specs/progress/PL1-plaid.md`.

### A. Link, OAuth, products, lifecycle

| # | Requirement | Walkup today (evidence) | Status | Fix |
|---|---|---|---|---|
| A1 | Request only the products you need | `createLinkToken` asks for `Products.Transactions` only, US only (`src/app/bank-feed/actions.ts:29-36`). Update mode passes no products (`:74-82`). | Met | None. |
| A2 | Use the current Link SDK, loaded from `cdn.plaid.com` | `react-plaid-link` 5.0.0 installed, which is the current npm release (checked with `npm view`). It injects `cdn.plaid.com/link/v2/stable/link-initialize.js`; Plaid says that script must come from the CDN, not be bundled. CSP allows exactly that origin plus `https://*.plaid.com` for connect and `https://cdn.plaid.com` for frames (`src/lib/security/csp.ts:29-35`). | Met | None. |
| A3 | Server SDK reasonably current | `plaid` 45.0.0 installed, latest on npm is 48.0.0 (`package.json:26`). `^45` will not move across majors, so Dependabot will not propose it. | Partly | Read the plaid-node changelog, bump to 48, run `tests/unit/plaid-*.test.ts` and the bank-feed tests (PL1 gap 9). |
| A4 | OAuth: redirect URI in code | `redirect_uri` comes only from `PLAID_REDIRECT_URI`, never derived (`actions.ts:42-50`); same link token is stashed in `localStorage` before `open()` and reused on return (`oauth-link-token.ts`); `/bank-feed/oauth` reinitialises Link with `receivedRedirectUri = window.location.href` (`src/app/bank-feed/oauth/page.tsx`). Matches Plaid's OAuth guide: HTTPS, no query string, no fragment, same token. Update mode also sends `redirect_uri`, as Plaid requires. | Met | None. |
| A5 | OAuth: redirect URI registered in the Dashboard, production env var set | Cannot be seen from the repo. | Needs Doug | Checklist item 3 and 5. Value: `https://www.walkuphoa.com/bank-feed/oauth`. |
| A6 | OAuth institution access approved | Plaid gates OAuth banks (Chase etc.) on company info, display info, MSA, and the security questionnaire. Per Plaid, the questionnaire is greyed out until the Production application is approved. | Needs Doug | Checklist items 1, 2, 11. |
| A7 | Handle `ITEM_LOGIN_REQUIRED` with update mode | Implemented: `isLoginRequired` covers `ITEM_LOGIN_REQUIRED`, `ITEM_LOCKED`, `ACCESS_NOT_GRANTED` (`src/lib/plaid.ts`); sync sets status `error` and the cron stops retrying (`sync.ts`); balances return `needsReconnect`; `ReconnectButton` calls `createUpdateLinkToken` (access token, no products, redirect_uri) and `reconnectBank` marks active and syncs. Plaid's guidance: run update mode when the user next opens the app. | Met | Docs are stale: DECISIONS #27 and SECURITY_POLICY section 8 still say there is no re-auth path. Update both (PL1 gap 5). |
| A8 | Proactive notice for a broken connection (webhook or email) | None. A broken bank shows only when a board admin opens the page or Home. | Partly | Webhook design, section 4. |
| A9 | Receive and verify webhooks | No route, no `webhook` parameter on `linkTokenCreate`. SECURITY_POLICY section 8 admits it. | Not met | Section 4 and PL1 gap 3. |
| A10 | Call `/item/remove` when a user disconnects | `disconnectBank` reads the token, calls `itemRemove`, then deletes the token and marks disconnected; `plaid_item_removed_at` records success (`actions.ts:192-240`, migration 0026). Fail-open by design (#27): if Plaid is unreachable the local token is still deleted and the Item stays live and billable at Plaid until removed by hand in the Dashboard. | Met | Add a monthly check for `status='disconnected' and plaid_item_removed_at is null` (checklist item 17). Optional: surface the count in the app (PL1 gap 10). |
| A11 | Billing hygiene: remove Items you stop using | Same as A10. Association closure has no code path that disconnects banks. | Partly | On closing an association, run Disconnect first; add to `docs/OFFBOARDING.md` or the data-retention process (PL1 gap 11). |
| A12 | Products enabled for the account | Transactions: code uses `transactionsSync`. Balance: `accountsBalanceGet` with graceful fallback to `accountsGet` when Plaid says the product is not enabled (`balances.tsx:40-90`, `isProductNotEnabled`). Balance is billed per successful call; the 10-minute cache limits calls. | Needs Doug | Checklist item 4: confirm Transactions is on; decide whether to pay for Balance or accept "as of last sync" balances. |
| A13 | Token never reaches the browser | Link token only is sent to the client; public token is exchanged server-side in `connectBank`; access token stays in server memory (`actions.ts:116-190`). | Met | None. |
| A14 | Stable per-user `client_user_id` | Uses the association id for everyone on a board (`actions.ts:30,75`, acknowledged in #27). Not PII, so acceptable, but Plaid expects one id per person. | Partly | Use the signed-in person id (PL1 gap 8). Low priority. |
| A15 | Sync is robust and bounded | `transactionsSync` loop is unbounded; no handling of `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`; cron route has no `maxDuration`; one thrown exception (e.g. missing env) aborts the whole run (`sync.ts`, `route.ts`). | Partly | PL1 gap 6. |
| A16 | Scheduled sync actually runs | Proxy redirects the cron call (section 0, finding 1). | Not met | Add `/api/cron` to `PUBLIC_PATHS` (PL1 gap 1). |
| A17 | Cron endpoint authenticated | Bearer `CRON_SECRET`, 500 if unset, 401 otherwise. Compared with `!==` rather than constant time. | Partly | `timingSafeEqual` (PL1 gap 7). |
| A18 | Log Plaid identifiers, never secrets | Logs dump raw axios errors (secret exposure, finding 2); `describePlaidError` drops `error_code` and `request_id`, which Plaid Support asks for. | Not met | Add `plaidErrorLog()` and use it everywhere (PL1 gap 2). |
| A19 | Access token sealed at rest | AES-256-GCM, `enc:v1:` format, key `BANK_TOKEN_KEY` in env only (`secret-box.ts`); written sealed on connect (`actions.ts:140`); legacy plain tokens resealed on use and by the daily cron; DB function `reseal_bank_access_token` refuses to overwrite with anything unsealed (0050); tests `secret-box.test.ts`, `bank-token-reseal.test.ts`. Doug says the key is now set in production. | Needs Doug | Checklist item 6: confirm 0050 is applied to production, key is Production-only and backed up, and no plaintext rows remain (SQL in item 6). Note the cron cannot reseal anything until finding 1 is fixed, so legacy tokens only reseal when an admin uses the page. |
| A20 | Token cannot be read by other roles | `bank_connection_secrets` has RLS and zero policies; only `store_bank_connection`, `get_bank_access_token`, `reseal_bank_access_token`, `revoke_bank_connection` (all `security definer`, board_admin plus AAL2) touch it (0016, 0050). Table is not audited, so the token cannot leak into `audit_log`. | Met | The published policy pages say "no user role can read" it; accurate wording is "no user role can read it directly, and an admin who calls the function receives ciphertext." See B8. |

### B. What end users must be shown

Plaid's own docs are thin here: Link best practices only say to explain why you use Plaid and what the user
will need to provide, and the Launch checklist says "it is up to you to determine how to obtain any legally
required consents", noting some customers link to Plaid's privacy policy from their own. The Developer
Policy text itself could not be retrieved in this review (page truncated), so treat the points below as the
conservative reading, and have Doug skim the Developer Policy and End User Privacy Policy at
`https://plaid.com/legal/` before submitting.

| # | Requirement | Walkup today (evidence) | Status | Fix |
|---|---|---|---|---|
| B1 | Public privacy policy URL | `/privacy` is public, dated 2026-10-14, names DS Collective LLC, names Plaid (`src/app/privacy/page.tsx`). `/terms` is public only in the uncommitted edit to `PUBLIC_PATHS` in `src/lib/supabase/proxy.ts`; make sure it ships before submission. | Partly | Deploy the `/terms` change (checklist item 20). |
| B2 | Privacy policy discloses Plaid, what is collected, how it is used | Mentions Plaid and "transaction dates, amounts, descriptions" and categories. Omits: account names and last four digits, balances (fetched live), that Plaid is an independent processor with its own policy, a link to Plaid's End User Privacy Policy, and that Plaid-derived transactions are retained after disconnect. | Partly | Copy in `PL1-plaid.md` gap 4. |
| B3 | Just-in-time notice before Link opens | `/bank-feed` shows one sentence ("Walkup uses Plaid... read-only token... Nothing here can move money", `page.tsx:493`). No link to privacy, no list of data read, no statement of how to disconnect. | Partly | Replace with the notice text in PL1 gap 4. |
| B4 | Explicit consent | Signup requires an affirmative privacy and terms checkbox, enforced server-side (`src/app/login/actions.ts:59-64`, `signup-form.tsx:76-88`). Bank access additionally needs the user's authorization inside Plaid Link's own consent pane. Only board admins can start Link (RLS + MFA). | Met | None. |
| B5 | How to disconnect | In app: board admin, Bank feed, Disconnect, Confirm (`disconnect-button.tsx`); calls `/item/remove`. Not stated on `/privacy` or `/security` beyond "disconnecting calls Plaid to close the connection". | Partly | Add a sentence in the privacy copy (PL1 gap 4). |
| B6 | Deletion on request | `redact_person()` (0037) removes personal data and scrubs the audit log; retention table in SECURITY_POLICY section 9 and `/policies/data-retention`; requests answered within 30 days. Open question: bank transactions are kept for the account life plus 7 years even after disconnect (#29, section 9). Plaid's own docs note that removing the Item causes Plaid to delete that user's data on its side; Walkup's copy is a separate, retained financial record. | Partly | Needs Doug (checklist item 14): decide and state publicly whether a disconnected bank's transactions are kept (my recommendation: yes, as books of account, disclosed plainly) and say it on `/privacy`. |
| B7 | Request channel | `/privacy` names `hello@walkuphoa.com`; `/security` names `security@walkuphoa.com` for vulnerabilities. | Met | Optional: add `privacy@walkuphoa.com` (ImprovMX catch-all already forwards) and use it for data requests (PL1 gap 4). |
| B8 | Published claims match reality | Contradictions found: (a) `/policies/access-controls` says SMS "is not accepted as a second factor on any account" and that Supabase uses an authenticator app only, while SECURITY_POLICY section 8 and 11 list SMS removal on GitHub and Google as still open; (b) policy pages say "encrypted at rest" with no mention of app-layer sealing, and "no user role can read" tokens (see A20); (c) `docs/OFFBOARDING.md` still cites `walkup-gold.vercel.app` URLs for the policy pages; (d) DECISIONS #27 says there is no `ITEM_LOGIN_REQUIRED` re-auth path and SECURITY_POLICY section 8 says a stale connection "surfaces only as a sync error"; update mode now exists (A7), so both are out of date. Plaid reviewers compare these. | Not met | Doug confirms real state, then fix the text (PL1 gap 5). Never publish "no SMS anywhere" until it is true. |

### C. Security questionnaire topics

The live questionnaire is visible only in the Dashboard after Production approval. Question wording below is
therefore **mapped by topic**, using Plaid's published description (company risk and security practices) and
the eight attestations in SECURITY_POLICY section 11 that Plaid's earlier review produced. Compare each
answer against the live form before pasting.

| # | Topic | Walkup today (evidence) | Status | Fix |
|---|---|---|---|---|
| C1 | MFA for consumers/users | TOTP required for every user before any page, enforced twice: `src/lib/supabase/proxy.ts:96-146` and database `session_is_aal2()` in 0025 wired into `has_role_in`, `owned_unit_ids`, `current_person_id`; tests `tests/db/mfa-enforcement.test.ts`. Known accepted gap: own contact details readable at AAL1 (#26). | Met | Confirm 0025 is applied in production (checklist item 17). |
| C2 | MFA for internal systems | Policy says passkeys plus authenticator on GitHub, Vercel, Supabase; Plaid and Anthropic via Google 2-Step. SMS removal on GitHub and Google open (section 8). OFFBOARDING table says Supabase uses authenticator app only. | Partly | Doug removes SMS, then updates sections 4c, 8, 11 and the access-controls page (checklist item 9). |
| C3 | Encryption in transit | TLS everywhere through Vercel and Supabase; HSTS two years with subdomains; CSP with nonces; `X-Frame-Options: DENY` (`next.config.ts`). | Met | None. |
| C4 | Encryption at rest | Database encrypted at rest by Supabase (vendor control, stated on `/security`); Plaid tokens additionally sealed with AES-256-GCM (A19); workstation FileVault. | Met | Re-verify A19 first. |
| C5 | Access control and least privilege | Roles enforced by RLS on every table scoped to `association_id`; bank writes board_admin only; secrets table has no policies; service role confined to one cron file (#28). | Met | Keep #28 true when the webhook route is added (section 4). |
| C6 | Periodic access reviews | `record_access_review()` and the 90-day reminder are built (0037, #30); infrastructure reviewed on a 6-month cadence, last confirmed 2026-09-29 (OFFBOARDING). | Needs Doug | Doug records one review in production so evidence exists (checklist item 13). |
| C7 | Deprovisioning | Automated (`deprovision_stale_access`, 0037) plus manual runbook `docs/OFFBOARDING.md`. It runs from the cron, which is currently blocked (A16). | Partly | Fix A16, then confirm a run in the cron logs. |
| C8 | Vulnerability management and patch SLA | `.github/workflows/security.yml` (npm audit high+, weekly, on push and PR); `.github/dependabot.yml`; SLA table 7/14/30 days in SECURITY_POLICY section 5 and `/policies/vulnerability-management`. Open: Dependabot alerts and security updates repository toggles; pending macOS update; Vercel Node version vs `.nvmrc` 24. | Partly | Checklist items 10, 11, 12. |
| C9 | End-of-life software | `scripts/check-eol.mjs` weekly against endoflife.date for Node (24), Next.js (16), Postgres (17 hardcoded; update when Supabase upgrades). Fails within 90 days of EOL. | Met | None. |
| C10 | Data retention and deletion policy | SECURITY_POLICY section 9, `/policies/data-retention`, `redact_person()`. See B6 for the one open wording question. | Met | Resolve B6 wording. |
| C11 | Privacy policy and consent | See B1 to B5. | Partly | PL1 gap 4. |
| C12 | Incident response | SECURITY_POLICY section 6: contain, assess (audit_log, vendor logs), notify affected board, remediate, record; Plaid-specific containment (`/item/remove`, secret rotation does not invalidate tokens). Missing: a notification deadline, a step to notify Plaid and other vendors, a named backup contact, and any rehearsal. | Partly | Add the three items to section 6 (Doug decides the deadline; common practice is 72 hours to affected customers, not verified as a Plaid requirement). |
| C13 | Zero-trust / network model | Section 10 states the position honestly: no network trust, every request authenticated and RLS-checked; explicitly not a certified zero-trust product. | Met | None. |
| C14 | Security testing / pen test | `docs/security/STAGING.md` prepares a throwaway Supabase branch for an authorized test; no completed test is recorded in the repo. | Needs Doug | State "planned, scope prepared" unless a test has happened; do not claim results. |
| C15 | Logging and monitoring | `audit_log` is append-only for ledger and access changes; bank connect and disconnect audited via `audit_bank_connections` (0016); Vercel and Supabase logs. No alerting on anomalies. | Partly | Say so. Optional: Vercel log drain or email alert on cron 5xx. |
| C16 | Secure development | Migrations reviewed and versioned, RLS invariants in `CLAUDE.md`, unit and DB tests, CI audit. Single developer, so no peer review. | Partly | State it plainly; do not claim code review. |
| C17 | Third-party risk | SECURITY_POLICY section 7; vendors Supabase, Vercel, Plaid, Anthropic, Resend, Google/Photon named on `/privacy`. | Met | None. |
| C18 | Backups and recovery | Not documented in the repo. | Needs Doug | Checklist item 18: state Supabase plan, whether point-in-time recovery is on, and last restore test (likely none). |
| C19 | Security contact and disclosure | `security.txt` route (expires 2027-10-14), `SECURITY_EMAIL`, disclosure terms on `/security`. | Met | Test that mail to `security@walkuphoa.com` arrives (checklist item 8). |
| C20 | Org and policy ownership | Single operator, policy reviewed 2026-09-26, six-month cadence, next due 2027-03-26. | Met | None. |
| C21 | Data sale and sharing | `/privacy`: not sold, not shared for marketing; vendors listed. | Met | None. |

## 3. Draft answers (ready to paste)

Tags: **[verified in code]** = checked against the repository today; **[needs Doug to confirm]** = depends
on production or dashboard state, or on a decision. Keep the tag out of the pasted text. Do not paste any
answer tagged "needs Doug" until he has confirmed it. Where a control is not implemented, the answer says so.

**1. Describe how multi-factor authentication is enforced for consumers/end users. [verified in code]**
"Every Walkup user must enroll in TOTP-based multi-factor authentication (authenticator app) and complete
it on each session before reaching any page, including the page that opens Plaid Link. Enforcement is in two
places: the application proxy redirects any session that has not completed MFA to enrollment or challenge,
and the database itself refuses reads and writes of association data unless the session's authentication
assurance level is AAL2, so a direct API call that skips the interface is also refused. Only association
board administrators can initiate a bank connection. One documented exception: a user can read and edit their
own name and contact details before completing MFA; no financial data is reachable that way."

**2. MFA for internal systems and administrative access. [needs Doug to confirm]**
"The company is operated by one person, who holds all access. GitHub, Vercel, Supabase, the Plaid
Dashboard (via Google sign-in) and the Anthropic console each require multi-factor authentication; passkeys
are registered on GitHub, Vercel and Google, and Supabase uses an authenticator app. [Add: 'SMS is not
accepted as a second factor on any account' ONLY after Doug removes SMS from GitHub and Google.] There are
no shared accounts."

**3. Encryption in transit. [verified in code]**
"All traffic between browsers, the application (Vercel), the database (Supabase) and third parties
including Plaid uses TLS. The site sends HSTS with a two-year max-age including subdomains, a
nonce-based Content-Security-Policy that allows only Plaid's origins for Link, and denies framing."

**4. Encryption at rest. [needs Doug to confirm key and migration in production]**
"The database and file storage are encrypted at rest by our infrastructure provider (Supabase). In addition,
Plaid access tokens are encrypted by the application with AES-256-GCM before being written to the database;
the key is held only in the server environment (Vercel) and never in the database, so a database copy or
backup does not expose a usable token. Tokens are stored in a table with no read policy for any role. The
development workstation uses full-disk encryption (FileVault)."

**5. Access controls and least privilege. [verified in code]**
"Application roles (board admin, board member, accountant, owner) are enforced by database row-level
security scoped to each association, not by application code alone. Bank connection, sync and disconnect are
limited to board administrators. The one elevated database credential (service role) is used by a single
scheduled job, authenticated by a dedicated secret. Accountant access expires automatically after 90 days."

**6. Periodic access reviews. [verified in code; needs Doug to record the first production review]**
"Board admins review everyone with access to their association every 90 days in the application; each
review stores an immutable snapshot of all active grants. Infrastructure access is reviewed every six months
(last confirmed 2026-09-29: sole member on all five platforms)."

**7. Automated deprovisioning. [verified in code, but see finding 1]**
"Owner access is revoked automatically when ownership ends, and time-boxed accountant access expires
automatically; this runs daily and at each access review. There are no employees or contractors; a written
offboarding checklist covers the infrastructure accounts if that changes." Do not submit this answer until the
cron fix (PL1 gap 1) is deployed and a successful run is visible in Vercel logs.

**8. Vulnerability and patch management. [needs Doug to confirm toggles]**
"Dependencies are scanned with npm audit on every push and pull request and weekly, and Dependabot is
configured for npm packages and GitHub Actions. Our patch SLA from first alert is 7 days critical, 14 days
high, 30 days moderate, next routine update for low. On 2026-09-26 a critical framework advisory and three
high advisories were patched the same day. Hosting and database operating systems are patched by Vercel and
Supabase." [Confirm Dependabot alerts and security updates are switched on in the repository before sending.]

**9. End-of-life software. [verified in code]**
"A weekly automated check compares our Node.js, Next.js and PostgreSQL major versions to
endoflife.date and fails when any is within 90 days of end of support, which triggers an upgrade planned and
completed before that date. Nothing runs past end of support."

**10. Data retention and deletion. [verified in code; B6 wording needs Doug]**
"Financial records, including bank transactions, are kept for the life of the association's account and
seven years after closure, because they are tax records; corrections are made by reversing entries.
Plaid access tokens are deleted when the bank is disconnected, after Walkup calls Plaid's /item/remove.
Personal details (name, email, phone, address) are removed on request within 30 days, or by a board admin
once a person has no access or ownership, including from the internal change log. [Decide and state whether
retained bank transactions are deleted on request; as drafted they are kept as books of account.]"

**11. Privacy policy and consent. [needs Doug to confirm after PL1 gap 4 ships]**
"Our privacy policy is at https://www.walkuphoa.com/privacy. Users affirmatively accept it and the terms at
signup (enforced server-side). Before a bank is connected the user sees a notice describing what Plaid will
share with Walkup, how it is used, and how to disconnect, and then Plaid's own consent screen."
Do not paste until the notice exists (it does not today, see B3).

**12. Incident response. [partly verified; needs Doug for additions]**
"We have a written plan: contain (rotate the affected credential; for a suspected Plaid token, call
/item/remove for each affected connection), assess (append-only audit log and provider logs), notify the
affected association boards, remediate the root cause and record the incident. [Add after Doug decides: the
notification deadline, and that Plaid and affected vendors are notified.] The plan has not been exercised."

**13. Do you receive and verify webhooks? [verified in code: no]**
"Not today. Walkup syncs transactions with /transactions/sync on a daily schedule and when a board admin
requests it, and detects ITEM_LOGIN_REQUIRED on API calls, then shows Reconnect (Link update mode). A
verified webhook receiver is planned." Replace after PL1 gap 3 ships.

**14. How do you handle ITEM_LOGIN_REQUIRED / expired consent? [verified in code]**
"When any call returns ITEM_LOGIN_REQUIRED (or ITEM_LOCKED / ACCESS_NOT_GRANTED), the connection is marked
as needing attention, the scheduled sync stops calling it, and the board admin sees a Reconnect button that
opens Link in update mode using the existing Item. No data is re-imported; on success the connection is
reactivated and synced."

**15. How do users disconnect, and what happens to the data? [verified in code]**
"A board admin chooses Disconnect on the Bank feed page. Walkup calls /item/remove, then deletes its stored
access token. Previously imported transactions remain in the association's books for the retention period
above."

**16. Do you sell or share data / have you had a security breach in the past 12 months? [needs Doug to confirm]**
Sale and marketing sharing: "No" is supported by `/privacy` [verified]. Breach history: only Doug can answer.

**17. Do you store bank credentials? [verified in code]**
"No. Link collects credentials directly with the institution; Walkup receives only a public token, which is
exchanged server-side for an access token that is encrypted at rest."

**18. Penetration testing. [needs Doug to confirm]**
"Not yet performed by a third party. A scoped, isolated test environment (throwaway database branch, sandbox
Plaid keys, no real data) is prepared." Replace if a test has been done.

**19. Backups and recovery. [needs Doug to confirm]** No verified answer in the repo.

## 4. Webhooks: current state and the minimal safe route

**Current state.** Walkup does not receive Plaid webhooks. There is no route, `linkTokenCreate` sends no
`webhook` URL, and Items created so far have none. Polling replaces it: daily cron (blocked, see finding 1)
and a sync on each manual click and page load. Plaid's docs do not make webhooks mandatory ("it treats them
as the main push channel"; polling and `/beta/webhook_events/list` are described as fallbacks), but the Launch
checklist lists integrations that "access transactions made after the end user linked" as needing them.

**Which webhooks matter.** `ITEM` / `ERROR` (e.g. `ITEM_LOGIN_REQUIRED`), `PENDING_DISCONNECT` (US, about
seven days before disconnection), `USER_PERMISSION_REVOKED`, `USER_ACCOUNT_REVOKED` (Chase, PNC, Truist),
`LOGIN_REPAIRED`, `NEW_ACCOUNTS_AVAILABLE`; `TRANSACTIONS` / `SYNC_UPDATES_AVAILABLE`.

**Minimal route** (to be built by the lead engineer, see PL1 gap 3):

1. `src/app/api/plaid/webhook/route.ts`, `POST` only, `dynamic = "force-dynamic"`, Node runtime. Add
   `/api/plaid/webhook` (and `/api/cron`) to `PUBLIC_PATHS`, otherwise the proxy redirects Plaid too.
2. Read the raw body with `await request.text()`; never re-serialise (the signature hashes exact bytes).
3. Verify before looking at the content, per Plaid's procedure: header `Plaid-Verification` is a JWT;
   reject unless `alg` is `ES256`; take `kid`; fetch the key with `plaidClient().webhookVerificationKeyGet`
   and cache by `kid` (reject expired keys); verify the signature with `node:crypto` (`createPublicKey` from
   the JWK, `dsaEncoding: "ieee-p1363"`); reject if `iat` is older than 5 minutes; compare SHA-256 of the
   raw body to `request_body_sha256` with `timingSafeEqual`. Respond 401 on any failure (Plaid does not retry
   most 4xx, which is what we want for forgeries) and 200 for everything verified, quickly.
4. Act on a small allow-list only, keyed by `item_id`, idempotent, order-independent:
   `ITEM/ERROR` with `ITEM_LOGIN_REQUIRED`, `ITEM/PENDING_DISCONNECT`, `ITEM/USER_PERMISSION_REVOKED`,
   `ITEM/USER_ACCOUNT_REVOKED` set `bank_connections.status` from `active` to `error` (the state Home and the
   Bank feed already render as "Reconnect"). Everything else, including `SYNC_UPDATES_AVAILABLE`, returns 200
   and does nothing; the daily cron remains the only unattended sync. The webhook never reads or writes a
   token, never posts to the ledger, and never trusts any body field except the item id and the code.
5. Database access without widening #28: one new `security definer` function
   `flag_bank_item_for_attention(p_item_id text)` that only updates `status` on a matching active connection,
   with execute granted to `service_role` only. The route uses the service-role client solely to call it.
   This is a second use of the service role, so it needs its own entry in `docs/DECISIONS.md` (suggested #35)
   saying so, in the same way #28 did. Doug approves that entry.
6. Configuration: env `PLAID_WEBHOOK_URL = https://www.walkuphoa.com/api/plaid/webhook`, Production only, left
   unset on Preview (same reasoning as `PLAID_REDIRECT_URI`). `createLinkToken` adds `webhook` when set.
   Existing Items need a one-off `itemWebhookUpdate` per connection (or reconnect). Plaid's docs say the
   endpoint must serve a valid HTTPS certificate and answer within 10 seconds.
7. Logging: webhook code, type and item id only. No body dump.
8. Tests: signature accepted, tampered body rejected, stale `iat` rejected, wrong `alg` rejected, unknown
   item id is a 200 no-op, replay is idempotent.

## 5. Things only Doug can do

Numbered, in a sensible order. Dashboard labels move around; Plaid's own docs currently say "Build, Keys,
Request access" for Production. If a label differs, use the closest one.

1. **Request Production access (if not already granted).** Plaid Dashboard (`dashboard.plaid.com`), Home page,
   click the "Get Production access" banner, or sidebar Build, Keys, Production section, "Request access".
   The first section is "Describe your business". Answer from facts: legal entity DS Collective LLC, what
   Walkup does (read-only bank transactions for self-managed condo associations in Illinois), products:
   Transactions only (and Balance if you decide yes, item 4).
2. **Compliance Center: company information and application display information.** Dashboard, Compliance
   Center (some banks reject apps with an empty profile). Enter: legal name DS Collective LLC exactly as
   registered; registered address; contact person, phone and email; website `https://www.walkuphoa.com`;
   privacy policy `https://www.walkuphoa.com/privacy`; terms `https://www.walkuphoa.com/terms` (deploy
   first, item 20); app name Walkup; logo from the brand package; support email `support@walkuphoa.com`;
   security contact `security@walkuphoa.com`. Plaid also asks for things only you know (employee count,
   whether you sell data: the answer on `/privacy` is no, breach in last 12 months). Accept the Plaid
   Master Services Agreement here (US/CA).
3. **Register the OAuth redirect URI.** Dashboard, the API settings page (sidebar Developers, API, or Build,
   Keys), "Allowed redirect URIs", Add new URI, paste exactly `https://www.walkuphoa.com/bank-feed/oauth`
   (HTTPS, no query, no trailing characters, no `#`), Save. Do not add preview or localhost URIs for
   production. The URI must exactly match `PLAID_REDIRECT_URI` in Vercel. Test that the apex
   `walkuphoa.com` redirects to `www` so a user never starts on a different origin (the stashed link token
   is in `localStorage`, per origin).
4. **Confirm products.** Dashboard, Team Settings or the product list for your Production account: Transactions
   enabled. Balance: either have it enabled (billed per successful call, about 3 seconds latency) or leave it
   off; the app then silently shows balances "as of last sync" via `accountsGet`.
5. **Production keys in Vercel.** Plaid Dashboard, Build, Keys, copy `client_id` and the **Production**
   secret (never paste them in chat or into a file in the repo). Vercel, project, Settings, Environment
   Variables, add for **Production only**: `PLAID_CLIENT_ID`, `PLAID_SECRET` (production value),
   `PLAID_ENV=production`, `PLAID_REDIRECT_URI=https://www.walkuphoa.com/bank-feed/oauth`. Leave all four
   unset on Preview (or sandbox values on Preview). Redeploy so the values load.
6. **BANK_TOKEN_KEY.** You say it is set in production; verify three things. (a) Vercel, Settings,
   Environment Variables: `BANK_TOKEN_KEY` exists with only "Production" ticked, and is a different value
   from any Preview or staging key. (b) A copy of the key is saved in your password manager. Losing it makes
   every sealed token unreadable and every bank must be reconnected; there is no recovery and no rotation
   procedure yet. Never change it while sealed tokens exist. (c) In the Supabase dashboard, SQL editor, for
   the **production** project, run these read-only queries and expect migration 0050 present and zero
   plaintext rows:
   `select count(*) from bank_connection_secrets where plaid_access_token not like 'enc:v1:%';`
   and `select version from supabase_migrations.schema_migrations where version like '0050%';`. A non-zero
   plaintext count just means those banks have not been used since the key was set; open the Bank feed page
   as the admin, or fix the cron (item 7), then re-run.
7. **Cron variables and a real cron run.** Vercel, Environment Variables, Production: `CRON_SECRET`
   (random, 32+ characters) and `SUPABASE_SERVICE_ROLE_KEY`. After the proxy fix ships, Vercel, project,
   Settings, Cron Jobs: "Run" the job once, and check Logs for status 200 with `synced` and `deprovisioned`
   in the output. If you see a 307, finding 1 is still live.
8. **Mailboxes.** From an outside address, send a test to `security@walkuphoa.com`, `hello@walkuphoa.com`
   and `support@walkuphoa.com` and confirm each arrives (ImprovMX forwards). Optionally add
   `privacy@walkuphoa.com` for data requests. Confirm the legal entity name and mailing address you want
   on the Terms and Privacy pages are right in `src/lib/site-config.ts` (`LEGAL_ENTITY` is DS Collective LLC).
9. **Remove SMS as a second factor** on GitHub (Settings, Password and authentication, Two-factor, remove
   SMS/text) and on the Google account (myaccount.google.com, Security, 2-Step Verification, remove phone
   number as a method, keep passkeys and authenticator). Check whether Supabase has a passkey option; if
   not, the "passkeys everywhere" sentence in SECURITY_POLICY section 4c and OFFBOARDING is slightly
   wrong. Then tell the lead engineer to align the text (PL1 gap 5).
10. **Dependabot.** GitHub, `dscollectiveio/Walkup`, Settings, Advanced Security (or Code security), enable
    "Dependabot alerts" and "Dependabot security updates".
11. **Vercel Node version.** Vercel, project, Settings, Build and Deployment, Node.js Version: 24.x to match
    `.nvmrc`. Also submit the **security questionnaire** once Plaid unlocks it: Dashboard, Compliance
    Center, Security questionnaire (greyed out until Production is approved; submit early, review takes
    time; allow 1 to 2 days after approval for institutions to register you; some banks take weeks).
12. **Workstation.** Install the pending macOS Sequoia 15.8 and Safari 27 updates and restart; then tick the
    item in SECURITY_POLICY section 8.
13. **Record a first access review in production.** Sign in as the production board admin, Building page,
    "Access review", record it. This creates the evidence row the questionnaire answer relies on.
14. **Decide the retention wording for a disconnected bank's transactions** (B6). Options: (a) keep as books
    of account for the retention period and say so (recommended, consistent with #29 and tax-record rules);
    (b) offer deletion on request, which conflicts with ledger immutability and needs a design. Tell the
    lead engineer which; the privacy copy depends on it.
15. **Questions only you can answer for Plaid:** number of staff (one), breach in the last 12 months,
    pen-test status (none recorded), backup arrangements (item 18), incident notification deadline.
16. **Read Plaid's Developer Policy and End User Privacy Policy** (`https://plaid.com/legal/`). This
    review could not retrieve the Developer Policy text. Check for anything on notifying Plaid of incidents
    and on privacy policy contents that is not covered above.
17. **Monthly sanity query** (Supabase SQL editor, production): `select id, institution_name from
    bank_connections where status = 'disconnected' and plaid_item_removed_at is null;` Each row is an Item
    still live (and billable) at Plaid; remove it in the Plaid Dashboard (Activity or Items, search by item
    id) and set `plaid_item_removed_at`. Also confirm 0025 and 0037 appear in `schema_migrations` on production.
18. **Backups.** Supabase, project, Settings, Add-ons or Database, Backups: note the plan, whether Point in
    Time Recovery is on, and the retention window. Write the facts in SECURITY_POLICY. If none, say so.
19. **Decide on webhooks** (section 4): approve the DECISIONS entry that allows a second narrow service-role
    use, then once built set `PLAID_WEBHOOK_URL` (Production only) and have the lead engineer run the
    one-off `itemWebhookUpdate` for existing connections.
20. **Ship the pending changes.** `/terms` is only public through an uncommitted edit to
    `src/lib/supabase/proxy.ts`, and `src/app/privacy/page.tsx` is dated today. Plaid reviewers will open
    both URLs; deploy through your usual process before submitting.
21. **Test in production, with a real bank, before announcing.** Sandbox never exercises OAuth, update mode
    or `/item/remove`. Connect the BMO account, confirm transactions arrive, wait for or trigger the cron,
    click Disconnect, then confirm in the Plaid Dashboard that the Item is gone.

## 6. What changed in the picture because of the token sealing

`BANK_TOKEN_KEY` being set in production changes the honest answer to the "encryption at rest" question from
"vendor encryption only" to "vendor encryption plus application-layer sealing of the credential". Three
caveats to keep the answer true: (1) tokens connected before the key was set stay plaintext until used (the
cron would seal them daily, but it does not run, finding 1); (2) there is no key rotation: the format
`enc:v1:` leaves room for a `v2`, but no code reads two keys, so do not claim rotation; (3) the staging
doc requires a different key for staging, which is correct.

## 7. Items intentionally not claimed

SOC 2 or ISO certification for Walkup itself, a completed penetration test, peer code review, tested
disaster recovery, 24/7 monitoring, and a formal zero-trust product. None exists; the policy pages already
say so for zero trust.
