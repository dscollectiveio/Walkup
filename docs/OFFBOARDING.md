# Access Offboarding Checklist

**Purpose:** Remove all infrastructure access for anyone who leaves Walkup or
changes role, the same day it happens.
**Owner:** Doug Smart. **Applies to:** any future employee, contractor, or
advisor granted access to Walkup's infrastructure. **Currently applicable
to no one** — Doug Smart is the sole person with access to source code,
infrastructure dashboards, and credentials (see `docs/SECURITY_POLICY.md`
§2 and the Access Controls Policy, published at
walkup-gold.vercel.app/policies/access-controls, §2). This checklist
exists so that changes the day someone joins, not the day they leave.
**Last reviewed:** 2026-09-29.

This is the infrastructure/team side of access. It's a different thing from
how Walkup removes a board member's or owner's access to their
association's data inside the app itself — that side is automated
(`deprovision_stale_access()`, `docs/SECURITY_POLICY.md` §4b, published at
walkup-gold.vercel.app/policies/access-controls §7) and needs no manual
checklist. This document is for DS Collective's own team, if and when it
grows beyond one person.

## How access actually works today

There is no single sign-on front door. Each infrastructure account is
independent, and each requires its own multi-factor authentication:

| Service | Account type | MFA |
|---|---|---|
| GitHub | Own login | Passkey (preferred) + authenticator app |
| Vercel | Own login | Passkey + authenticator app |
| Supabase | Own login | Authenticator app |
| Plaid dashboard | "Sign in with Google" | Inherits the Google account's 2-Step Verification |
| Anthropic Console | "Sign in with Google" | Inherits the Google account's 2-Step Verification |

No shared logins exist on any of these. No password manager entry is
shared between people, because there is only one person. Walkup has no
Stripe account (dues are paid bank-to-bank directly, not through a
processor) and no Notion workspace (documentation lives in this repository).
If either of those changes, add a row to the table below the day it does —
this document should describe what's actually true, not a template.

## Same-day checklist, for when this becomes applicable

Complete every step on the day the person leaves or changes role. Record
the date and initials next to each, and log the event at the bottom of
this file.

| # | Step | Where |
|---|------|-------|
| 1 | Remove them from the GitHub organization and any repository collaborator list | GitHub → Organization settings → People |
| 2 | Remove them from the Vercel team | Vercel → Team Settings → Members |
| 3 | Remove them from the Supabase organization | Supabase → Organization Settings → Team |
| 4 | Remove them from the Plaid dashboard team | Plaid → Team Settings |
| 5 | Remove them from the Anthropic Console organization | Anthropic Console → Settings → Members |
| 6 | Suspend or remove the shared Google account they used to reach Plaid/Anthropic, if one was ever created for them | Google Account settings |
| 7 | Rotate every secret they could have read: `SUPABASE_SERVICE_ROLE_KEY`, `PLAID_SECRET`, `CRON_SECRET`, `ANTHROPIC_API_KEY` | Each service's API keys page, then update Vercel environment variables and redeploy |
| 8 | Revoke any personal access tokens, SSH keys, or deploy keys issued to them | GitHub → Settings → Developer settings; Vercel → Account → Tokens |
| 9 | If they had access to production association data, revoke any application-level role they held as a Walkup user too (People section, per association) and record it | The association's Building page |
| 10 | Confirm in each service's own audit or activity log that no session or token tied to them is still active | Each service's activity log |
| 11 | Note the date and scope of what they had access to below | This file, "Completed offboardings" |

## Role change, not departure

Run steps 1–8 for whichever access the new role no longer needs. Leave
everything else in place.

## Contractors

If a contractor is ever granted infrastructure access, they get it added
to the exact accounts they need — never a shared login, never a personal
credential pasted into chat. Run the full checklist above the day the
engagement ends.

## Verification

Every 6 months (same cadence as the rest of Walkup's security review),
confirm the member list on GitHub, Vercel, Supabase, Plaid, and Anthropic
still shows only Doug Smart. Record the review date here:

- 2026-09-29 — confirmed: sole member on all five.

## Completed offboardings

None yet — no one besides the founder has ever held infrastructure access.
