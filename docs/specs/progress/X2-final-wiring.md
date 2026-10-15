# X2: final wiring (Integration, 2026-10-14)

No git write command, nothing applied to any Supabase project, no dev server touched, no secret printed.

## Changed
- **Home/nav/tour**: `/` redirects owner-only people to `/owner` (`getViewer`, falls through when null). Sidebar: `navFor(role, {ownsUnit})` built from `src/lib/owner/nav.ts` (owners get the owner navigation; staff get Announcements after Building Info, "My unit" only when they own a unit via `owned_unit_ids`), announcements badge, `/owner` active only on exact match, EXTRA_TITLES (Statement, Announcement, Import, Review emails, Owner statements, Email from Walkup, Collections). Layout loads `announcements_unread` and `owned_unit_ids`. Tour: new owner order (adds insuranceOwner before ownerBuilding, per X1), myUnit and announcements for staff, duesBoard and building bodies; tour now auto-starts on `/owner` for owners.
- **Home content**: setup-guide steps board_contact, import_units, import_opening, import_history, first_announcement, email_sending (all optional ones informational), invite and units wording; urgent items email_key_rejected/email_failed/email_bounced (board admins), delinquent actions now "Open Collections".
- **Building Info**: Import link and empty-state link, Invite to sign in mounted in `person-row.tsx`, "Who owners write to" fields (id=contact) saved by `updateAssociationProfile` (`src/lib/owner/board-contact.ts`), person select on the generic owner invite, BoardOnly for owners, invite page hint.
- **Guards**: BoardOnly on bank-feed, financial-statements, ledger, tax, building, contractor detail (delinquency already had it); `/dues` redirects owners to `/owner/pay` (inline owner branch deleted); `/units/[id]` redirects owners to `/owner/statement/[id]`. `reportOutsidePayment`: 53400 mapping, future date refusal, revalidate owner paths.
- **Entry points**: Email this to owners on posted announcements; Import contractors on the empty contractors list; dues empty state import link. Email preferences slot and Collections links were already in place from M1.
- **Docs**: DECISIONS #36 (full), #38, #39, #40 (tax views 0059 and guards 0057), notes on #22, #27 (update mode, webhook, bounded sync, hashed client_user_id), #28, #34; owner/import specs renumbered. SECURITY_POLICY (sections 3, 5, 6, 7, 8, 9, 10: Resend, Anthropic import mapping, Plaid webhook, allowlist helper, caps, 72-hour notice target, backup contact and "not exercised"). `/security`, access-controls, data-retention, Terms, Privacy, auth-shell tip, FAQ, usage tip and draft footer reworded to match #36. `.env.local.example` gained CRON_SECRET and SUPABASE_SERVICE_ROLE_KEY entries. `vercel.json` checked: both crons present and routes exist.
- **Tests**: updated tour, sidebar, setup-guide, urgent-items, privacy, money-copy; new `tests/unit/integration-wiring.test.ts` (23); two e2e import smokes in `app.spec.ts` (not run).

## Deviations
- Owner insurance nav label is "Building insurance" (spec), overriding X1's "Insurance" for owners.
- Import Undo copy restored to the spec's sentence now that 0059 nets reversals.
- `LEGAL_ADDRESS` left as the TODO placeholder. Backup contact and 72-hour target in SECURITY_POLICY are stated as not yet in place / operator target.
- Stray untracked root `tz.test.ts` (not mine) failed lint; I only removed its unused import and `any`.

## Final counts
`tsc --noEmit` 0 errors; `npm run lint` 0 errors, 4 old warnings (scripts/security/attack-rls.mjs); `npx vitest run` 210 files, 2766 tests passed; `npm run build` ok; `playwright public` 27 passed.

## Open issues
- Migrations 0051 to 0059 are not on the dev project: owner pages and Home's new queries show error states there until applied in order.
- Owner e2e (`/` to `/owner`, BoardOnly) needs a dev owner account; app.spec import smokes need 0056 on dev.
- Resend/DMARC/LEGAL_ADDRESS/PLAID_WEBHOOK_URL steps are Doug's (SECURITY_POLICY section 8).
- Plaid: dead-token Reconnect button, failed item/remove display, cron not surfacing `more`/`deadConnection` remain open.
