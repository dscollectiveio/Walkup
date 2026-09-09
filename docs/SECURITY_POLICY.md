# Information Security Policy

**Organization:** dscollectiveio (Doug Smart, sole operator of Walkup)
**Scope:** The Walkup application, its infrastructure, and the credentials
that control both.
**Effective:** 2026-08-05. **Last reviewed:** 2026-09-08 (Plaid production
readiness — see §3, §6, §8). **Review cadence:** every 6 months, or
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

## 5. Risk identification and mitigation

Ongoing, not one-time:

- **Dependency vulnerabilities:** Dependabot is enabled on the repository
  (`.github/dependabot.yml`) for npm dependencies and GitHub Actions,
  weekly. Alerts are reviewed and applied promptly for anything rated high
  or critical.
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
- [x] Dependency monitoring via Dependabot (`.github/dependabot.yml`).
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
