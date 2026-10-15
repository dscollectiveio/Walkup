# M1: money and reminders (2026-10-14)

Built from `docs/specs/money-and-reminders-spec.md`. Uncommitted. Nothing applied to any Supabase project, no real Resend call
(every test mocks `fetch`), no dev server started or stopped (the one on :3100 was only read with curl). Migration is
`supabase/migrations/0055_email_reminders.sql`. Decision #36 text and the other shared-file changes are in "Integration tasks" below.

## What was built

### Database
- `supabase/migrations/0055_email_reminders.sql` from the spec's draft SQL: `email_settings`, `reminder_rules`, `email_preferences`,
  `email_suppressions`, `email_batches`, `email_outbox`, `email_log`; same-association guards, outbox state machine and weekly backstop
  trigger, audit on settings, rules and batches, RLS select-only, 38 functions (34 SECURITY DEFINER) with pinned `search_path` and the spec's
  revoke/grant matrix (anon gets exactly `email_preference_for_token` and `email_unsubscribe`), `redact_person` extended.
- `tests/db/email-reminders.test.ts`: the spec's 13.1 list (tests 1 to 45, 47, 48; 46 is the lint in `migrations.test.ts`) plus 49 and 50
  (the cron's claim rules), a service-JWT check and a malformed-address check. 51 tests.
- `tests/db/harness.ts`: additive `asService()` (role `service_role` plus `role` JWT claim).
- `tests/db/migrations.test.ts`: the anon exception list now names the two unsubscribe functions (spec 13.4).

### Libraries (`src/lib/email-outbox/`, as assigned instead of `src/lib/email/`)
`config.ts` (sendConfig, not-set-up copy, constants), `facts.ts` (zod facts, kind labels), `format.ts` (money text to dollars, exact sums),
`sanitize.ts` (header, from, html, filename, tag), `templates/` (types, layout, dues-reminder, dues-upcoming, late-fee-notice, statement,
announcement, index: one document model rendered to both text and HTML), `resend.ts` (fetch client, classification, idempotency key),
`svix.ts` (signature check), `service-rpc.ts` (the six-function allowlist), `send-batch.ts` (the worker loop), `deps.ts` (board-session wiring),
`actions-core.ts` (rule schema, error mapping, note and unit validation), `status.ts`, `reasons.ts`, `review.ts`, `unsubscribe.ts`,
`webhook-events.ts` (address scrub).
`src/lib/statements/` (`period.ts`, `summary.ts`, `data.ts`, `pdf-document.tsx`, `late-fee-letter.tsx`) and `src/lib/collections/`
(`suggest.ts`, `build.ts`, `data.ts`, `rule-preview.ts`).
`src/lib/site-config.ts`: `LEGAL_ADDRESS` placeholder (`TODO(doug)`) and `legalAddressIsSet`.

### Server actions, pages, routes
- `src/app/dues/email-actions.ts`: prepare (reminders, statements, late fee notice, announcement email), save note, leave out, cancel, approve
  (`after()` runs the sender under the admin's session), resume, mark sent by hand, sending switch, daily limit, rules, pause, clear a
  block, and the read-only rule preview.
- `/delinquency` rewritten as Collections (`page.tsx`, `collections-table.tsx`; `reminder-letter-button.tsx` deleted; `payment-form.tsx` kept).
- `/dues/send/[batchId]` review (`page.tsx`, `review-list`, `approve-bar`, `progress-card`, `manual-drafts`, `loading`; `maxDuration = 300`).
- `/dues/statements` (`page.tsx`, `statements-form.tsx`) and `/dues/email` (`page.tsx`, `settings-client.tsx`): status, daily limit, rules,
  blocked addresses, opt-outs, send log with filters and paging.
- `/unsubscribe/[token]` (page, form, `actions.ts`) and `/unsubscribe/[token]/one-click` (RFC 8058 POST, GET redirects).
- `GET /statements/[unitId]/pdf` and `GET /statements/late-fee/[chargeId]/pdf` (board only).
- `GET /api/cron/email-reminders` and `POST /api/email/webhook`.
- Owner side: `src/app/owner/profile/email-preferences-slot.tsx` now renders the card (`email-preferences-card.tsx`, `email-preferences-actions.ts`).
- `src/components/email/email-announcement-button.tsx`: ready to drop into the announcements board row (Integration task 8).
- Shared files edited (each re-read first, additive): `src/lib/supabase/proxy.ts` (`/api/email/webhook`, `/unsubscribe` public, and
  `/unsubscribe/` exempt from the two-step and onboarding redirects), `tests/unit/proxy-public-paths.test.ts`, `src/app/layout.tsx`
  (`/unsubscribe` in `BARE_PATHS`), `vercel.json` (second cron `0 15 * * *`), `.env.local.example`, `src/app/dues/page.tsx` (three links),
  `src/app/dues/needs-you.tsx` (`Prepare reminder` button), `src/lib/owner/flags.ts` (`STATEMENT_PDF_ENABLED = true`) and
  `tests/unit/owner-misc.test.ts` (that test pinned `false` "until the route ships"; now pins `true`).

## Deviations from the spec, and why

1. **Paths** (your ownership list): libs in `src/lib/email-outbox/`, cron `/api/cron/email-reminders`, webhook `/api/email/webhook`
   (exact public path) instead of `/api/cron/send-reminders` and `/api/webhooks/resend`. The Resend endpoint to register is
   `https://www.walkuphoa.com/api/email/webhook`.
2. **Bug in the spec's SQL, fixed: redacting anyone who had been emailed would have failed.** `tg_email_outbox_guard` freezes `to_email`
   and `facts` after approval, and `email_redact_person` rewrites both. Test 44 proves it now works after a send. The guard honours a
   transaction-local setting (`walkup.email_redaction`) that only `email_redact_person` sets; no UPDATE policy exists for anyone else.
3. **`redact_person` base body is 0048's**, not 0037's (0048 added the "recorded as your tax accountant" refusal; the spec's copy would have
   silently dropped it). Test 48 and `access-reviews-redaction.test.ts` pass.
4. **`email_today()`** (Chicago date) replaces `current_date` in the business logic of 0055. After about 7 p.m. Chicago time UTC is already
   tomorrow, which would turn "due today" into "overdue" between prepare and send and skip the reminder as `balance_changed`.
5. **The cron only claims `dues_reminder` and `late_fee_notice` rows** (`email_claim(null, ...)`). The cron has no session to read a statement
   PDF or an announcement body (and `serviceRpc` cannot read tables), so a statement or announcement batch whose sender died waits for
   "Resume sending" on the review page. Spec 5.2 said "any approved batch".
6. **Dues reminder wording.** The spec says "$X of this was due on or before {oldest overdue date}", which is false when two charges are
   overdue. Now: "$X of this is past due. The oldest unpaid charge was due on {date}." Also added: an "Other open charges" row when the facts hold
   only the first twelve lines, and a sentence when the unit has an unapplied payment (credit), so the figure is never overstated.
7. **`List-Unsubscribe` is https only**, and points at the one-click POST URL. The spec's optional `mailto:support@` form lands in Doug's
   inbox via ImprovMX with nobody processing it, which would break the "honour opt-outs promptly" promise.
8. **Webhook** returns 500 (Resend retries) when our database call fails, and when the secret is unset; 400 for a bad signature. The spec said
   "always 200 after a valid signature". Events for messages Walkup did not send still get 200.
9. **A Resend key rejection** (401/403) stops the loop and marks the current row retryable with `last_error` starting `rejected_key`, so no message is lost once the key is fixed
   (the row goes back to `queued`, not `failed`). Home's nudge should read any outbox row with that prefix (see task 4).
10. **Rule preview** is a read-only TypeScript evaluation of the same conditions (`rule-preview.ts`), not `prepareReminders` plus cancel (that
    would not apply a rule's days or amounts). SQL still decides what is actually emailed.
11. **Statement PDF route**: no `from` means all activity on record ("Everything" in the owner portal's period choice); the PDF title says
    "Through {date}". Needed because `StatementDownload` links without dates for that choice.
12. **Empty batches** (nobody overdue, no current owner) are cancelled at once and the action returns a sentence instead of a review page with nothing on it.
13. Accountants may open Owner statements and Collections (balances only; no history, no buttons). Everything else is board only.
14. **`tests/unit/money-copy.test.ts`** checks no dash in the new files, no payment fields in templates and a clean unsubscribe page. Its
    Terms and Privacy assertions (spec 13.2) wait for the text to land (Integration task 3), because I may not edit those pages.

## Tests and commands (results at the end of the session)

| Command | Result |
|---|---|
| `npx vitest run tests/db/email-reminders.test.ts tests/db/migrations.test.ts tests/db/rls.test.ts tests/db/access-reviews-redaction.test.ts tests/unit/proxy-public-paths.test.ts` | 5 files, 88 tests passed |
| 19 unit files: `email-*` (sanitize, facts, resend, templates, send-batch, svix, config, service-rpc, routes, actions, ui-helpers), `statement-period`, `statement-pdf`, `collections-suggest`, `money-copy`, `owner-misc`, `proxy-public-paths`, `email-mailto`, `draft-email-state` | 226 tests passed |
| `npx tsc --noEmit` (whole project) | 0 errors (other engineers' files were clean at that moment) |
| `npx eslint` on every file listed above, `tests/unit`, `tests/db/email-reminders.test.ts`, `tests/db/harness.ts` | clean |

What the tests pin: every limit in the spec's table 3.2 (recipient and address, weekly cap in prepare, approve, claim and the trigger,
daily cap and the 20-a-day warm-up, hourly platform cap, suspension, opt-out, bounce and complaint suppression, `balance_changed`,
`address_changed`, frozen content, single send, claim token, stuck row release at 10 minutes and "outcome unknown" at 20 hours, retry
counts), cross-association isolation on every table, same-association triggers, direct writes refused for every role, anon sees nothing but
the two unsubscribe functions, service-only functions closed to `authenticated` and `anon`, webhook replay (`svix_id`), redaction after a
send, purge, header injection (CR, LF, NUL, U+2028 through every field and the From header), the six-function allowlist and a scan that
fails if any other file imports `serviceRpc` or reads `SUPABASE_SERVICE_ROLE_KEY` (the bank cron and the Plaid webhook keep their own),
the no-key fallback (`approveBatch` makes no database call and `createClient` is never reached), Resend request shape and every status class.

Curl against `http://localhost:3100` (dev DB does not have 0055, nothing applied):
`/unsubscribe/<bad token>` 200 with "This link isn't valid" and `robots noindex`, `referrer no-referrer`; `/unsubscribe/<96 hex>` 200
("Something went wrong", because the dev database has no `email_preference_for_token` yet); `/unsubscribe/<token>/one-click` GET 303;
POST with a malformed token 200; `/delinquency`, `/dues/email`, `/dues/statements`, `/dues/send/<id>` and `/statements/<id>/pdf` 307 to `/login` signed out.
Expected non-200s, by design and only because the dev env has no secrets set: `/api/cron/email-reminders` and `POST /api/email/webhook`
return 500 "not configured" (as the bank cron does), and the one-click POST with a well-formed token returns 500 until 0055 is on the
dev database (its RPC does not exist yet). No unhandled 500 anywhere.

PDFs were rendered to files and read: banner, header block, summary strip, zebra table, closing "How to pay" box, footer on each page,
a 60-line statement over three pages with the box on the last page, an annual statement and a credit balance.

## Integration tasks (exact; I did not touch these files)

1. **`docs/DECISIONS.md`** Append #36 (spec 1.1, with these two path changes: the reminder cron is `/api/cron/email-reminders`, the Resend
   webhook is `/api/email/webhook`). Under #22 add `(No automatic sending is relaxed by #36.)`, under #28 add `(Two further narrow entry
   points: #36. PL3 adds the Plaid webhook as another.)`, under #34 add `(Two further anon functions: #36.)`. Note for #36: the redaction
   exception to "an approved message cannot be changed" (deviation 2) and the cron's plain-kinds rule (deviation 5).
2. **`docs/SECURITY_POLICY.md`**
   - New subsection after the Anthropic paragraph in section 7: `Resend (subprocessor for outbound email).` Resend delivers the account
     emails and the reminders, statements and notices a board administrator approves. It receives the recipient's name and address and the
     message text, including a statement PDF when attached, and reports delivery, bounces and spam reports through a signed webhook. The API key is scoped to sending for walkuphoa.com.
   - New paragraph `Outbound email` (section 5 or 10), listing the controls: nothing is sent without a board admin's approval (batch or
     standing rule, MFA-gated); limits enforced in SQL (one per person per week per kind, 20 a day for the first week then the board's
     limit up to 200, 300 an hour platform wide, no send to a bounced or opted-out address, balances re-checked at send); content is a
     template plus ledger facts plus a 500-character note with no links or addresses, and no model writes any email; no payment details in any email;
     three service-key or signed-out entry points (bank sync cron, reminder cron, Resend webhook through a six-function allowlist; the
     signed-out unsubscribe functions behind a 48-byte token); platform-admin suspension per association; 24-month history, cleared by
     "Remove personal data".
   - Secrets list in the vulnerability-management policy: add `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`, rotated on suspicion; the key is
     scoped to sending.
   - Section 9 table: row `Email history (who, which kind, when, delivery result)` | `24 months, then removed by the daily job` | `Addresses are blanked by "Remove personal data" (redact_person, 0055).`
   - Section 8 open items: verify walkuphoa.com in Resend (DKIM, return-path), publish DMARC, set `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `LEGAL_ADDRESS`.
3. **Terms, Privacy, data retention** (spec 12, verbatim there). `src/app/terms/page.tsx`: update the comment on line 11 (`never sends email
   on its own` becomes `sends email only when a board administrator has approved it`), replace the second bullet of section 3, add the Resend
   sentence to section 5 and the new bullet to section 4, set `Last updated`. `src/app/privacy/page.tsx`: add the two "What we collect"
   paragraphs, change the Resend sharing entry (line ~122 `Resend (account emails)`), replace the line ~196 sentence, add the "Email from Walkup" block, and reword line ~159 `Walkup
   never sends email for you; you edit each draft and send it from your own mail app.` to `Drafts to contractors and agents open in your own mail app; Walkup does not send those for you.`
   `src/app/policies/data-retention/page.tsx`: add the row `Email history (who, which kind, when, delivery result)` to `24 months, then removed`.
   Then add to `tests/unit/privacy-page.test.ts` and `tests/unit/money-copy.test.ts`: Privacy mentions "unsubscribe" and "24 months", Terms
   no longer contains "never sends email on your behalf", and neither contains "never sends email for you".
   Other public copy that now reads wrong, for the same pass: `src/components/auth/auth-shell.tsx` POINTS `Nothing is sent on your behalf without you`
   (suggest `Nothing goes out without a board admin's approval`), and the `src/lib/site-config.ts` FAQ answer `drafts reminders for you to send` (suggest `prepares reminders for a board admin to approve and send`).
4. **Home** (`src/lib/home/urgent-items.ts`, `src/app/page.tsx`; board admins only): `email_key_rejected` (severity 1, bad): title `Walkup couldn't send your last email`,
   why `The email service rejected Walkup's key. Reminders are paused until it's fixed.`, action `Check` to `/dues/email`; set when any
   `email_outbox` row in the last 7 days has `last_error` starting `rejected_key` (it stays `queued`, deviation 9). `email_failed` (severity 2, warning):
   `{n} email(s) failed to send in the last 7 days`, why `Check the address or try again.`, action `See the log` to `/dues/email#log`.
   `email_bounced` (severity 2): `{n} owner(s) didn't get an email (bounced)`, why `Their address may be wrong. Fix it so reminders reach them.`, action `See who` to `/dues/email`.
   The two `delinquent` items: action labels `Send a reminder` and `Send reminders` become `Open Collections` (`/delinquency`).
   Update `tests/unit/urgent-items*.test.ts`.
5. **Sidebar and titles** (`src/components/sidebar/config.tsx`): line 131 `{ prefix: "/delinquency", label: "Who owes money" }` becomes `label: "Collections"`; add to `EXTRA_TITLES`
   `{ prefix: "/dues/send", label: "Review emails" }`, `{ prefix: "/dues/statements", label: "Owner statements" }`, `{ prefix: "/dues/email", label: "Email from Walkup" }`
   (`pageTitleFor` checks `EXTRA_TITLES` before nav items, so no special case is needed). Find the nav item labelled `Who owes money`, if any, and rename it.
6. **Setup guide** (`src/lib/home/setup-guide.ts`, section `money`, after `dues_payment`): `{ key: "email_sending", name: "Turn on email from Walkup (optional)",
   detail: enabled ? "Sending is on." : "So reminders and statements can go out after you approve them.", href: "/dues/email", done: sendingEnabled, informational: true,
   instructions: ["Add the board contact email on Building Info first; replies go there.", "On Email & reminders, turn sending on. Nothing is sent until a board admin approves it."] }`;
   add `emailSendingEnabled: boolean` to `SetupInputs` (read `email_settings.sending_enabled`, board only). Update `tests/unit/setup-guide.test.ts`.
7. **Tour** (`src/lib/tour/steps.ts` line 56): `duesBoard.body` becomes `Who owes what, reminders you review and send, and statements for every owner.`
8. **Announcements** (`src/app/announcements/board-row.tsx`): for `status === "published"` render `<EmailAnnouncementButton announcementId={id} />`
   (from `@/components/email/email-announcement-button`) next to Pin and Archive. It prepares the drafts and opens the review page.
9. **Owner portal**: nothing else needed; the profile page already renders the slot I filled. `STATEMENT_PDF_ENABLED` is now true.
10. **Env vars (Vercel Production, and Preview if wanted)**: `RESEND_API_KEY` (sending access for walkuphoa.com only), `RESEND_WEBHOOK_SECRET`
    (`whsec_...` from the Resend webhook endpoint), optional `EMAIL_FROM_ADDRESS` (verified sender; default `notifications@walkuphoa.com`), optional
    `EMAIL_SENDING_DISABLED=1` kill switch. The reminder cron reuses `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` (already Production only).
    `LEGAL_ADDRESS` in `src/lib/site-config.ts` is a code constant: replace the placeholder with DS Collective LLC's real postal address.

## What Doug has to do (once, before any owner is emailed)

1. Set `LEGAL_ADDRESS`. Until then `sendConfig()` says `no_legal_address`, every page says "Emails stay drafts until it is", and `approveBatch` refuses before any database call.
2. Resend: add and verify walkuphoa.com (DKIM, `send.` return path; check against the ImprovMX records), publish `_dmarc` (`p=none`), create the sending key, create the webhook endpoint
   `https://www.walkuphoa.com/api/email/webhook` for `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`, `email.failed`, copy the signing secret.
3. Confirm in Resend's webhook reference that a hard bounce carries `data.bounce.type === "Permanent"` (the spec's decision 4; the route treats anything else as temporary, so the safe failure
   is "not suppressed", never "suppressed wrongly"), and the plan's rate limit (the sender waits 600 ms between sends and backs off on 429).
4. After "General Kenobi" applies 0055: run the spec's 13.3 manual checks (two test mailboxes, headers, the PDF, one-click unsubscribe in Gmail, a bounce address, kill the dev server mid-batch and Resume, unset the key, a phone, a spam check).

## Open issues and notes

- **0055 is not applied to the dev project** (I may not). Authenticated pages were therefore checked by tests, types, lint and signed-out curl only, not by a browser session against live data.
- The review page previews with a placeholder unsubscribe link (`/unsubscribe/your-personal-link`); the real token never reaches the board's browser. In the no-Resend path the draft body drops the Walkup footer (it would be false, the board sends it).
- `email_facts_current` re-checks `owed` and `overdue` per unit, not line dates. A `dues_upcoming` rule email whose charge was paid and replaced by a later one between queue and send fails with "This email could not be built." (not retried); the next daily run picks the unit up again.
- Vercel request logs hold the unsubscribe token (it is in the path). Accepted in the spec: the token can only change that person's email preferences.
- Joint owners are separate people: each gets their own email and their own weekly limit. A person who owns two units gets one email listing both.
- `email_preferences` has no audit trigger (the spec did not ask; the log records every unsubscribe).
- The 2-minute "Resume sending" delay and the 3-second page refresh are in the client (`progress-card.tsx`); the daily run (10 a.m. Central, 9 in winter) also finishes plain reminders.
- Migration numbering: 0056 (imports) did not exist yet; 0057 and 0058 are on disk. 0055 depends only on 0054 and earlier.
- Unrelated to this work, seen on the way: `StatementDownload` in the owner portal links without dates for "Everything"; my route handles it (deviation 11).
