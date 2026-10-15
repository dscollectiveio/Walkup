# FX1: database fixes for REVIEW-1 (migrations)

Source: `docs/security/REVIEW-1-migrations.md`. Rule used: objects created by the applied 0001..0050 are fixed in the new
`supabase/migrations/0060_review_hardening.sql`; objects that exist only in the unreleased 0051..0059 are fixed in place.
Regression tests: `tests/db/review-hardening.test.ts` (28 tests, one fresh database each; derived from the reviewer's
reproductions in the scratchpad `review-a/`). I could not run them against the pre-fix tree (no git checkout/stash allowed), so
"failed before" rests on the reviewer's reproductions, which each test repeats.

## Findings

1. BLOCKER board_member to board_admin.
   - 1a invites: `invites_insert` (0027) replaced in `0060`: board_admin invites any role, board_member only `owner`.
   - 1b persons: `tg_persons_self_edit_guard` rewritten in place in `0054` (only a board_admin may change `auth_user_id` or
     `association_id`, for anyone); new `tg_persons_insert_guard` in `0054` (only a board_admin may create a person with a login).
     Definer functions (`redact_person`, `redeem_invite`) are unaffected (`current_user` check).
   - Tests: "REVIEW-1 #1" (5 tests).
2. AI refund: `0051` `ai_usage_counts` counts every main row as an attempt; the owner personal cap no longer excludes `not_started`.
   Ceiling is still 2x the limit (a caller can still refund with `timeout`); comment in the migration says so. Tests: 40 claims stop at
   12 (limit 6) and at 10 for an owner's personal cap.
3. NOT VALID checks: replaced in place in `0053` by triggers firing on insert, or on update only when the limited column changes:
   tickets (title, description), ticket_comments (body), contractor_messages (subject, body), contractor_reviews (body), upkeep_log
   (done_on, note). Test builds legacy rows on the 0052 schema, applies 0053 onward, then closes/edits them.
4. Double reversal: `0060` `reverse_journal_entry` selects `FOR UPDATE`; unique partial index `journal_entries_one_reversal` created only if
   no duplicates exist, else a NOTICE with the query and instructions (migration still succeeds). Reversal of a reversal still works.
   Tests: second reversal refused, race state refused by index (23505), 1120-H figure equals ledger after post/reverse/re-reverse,
   duplicate-data case skips the index.
5. 0057 guards: in place; the update branch checks only when `person_id` / `unit_id` / `association_id` changes. Test with legacy
   cross-association rows built before 0057.
6. Archive board_admin only: `0052` trigger `insurance_policies_archive_guard`. Contractor `archived_at` left alone (reviewer: decide
   separately; 35(i) is about deletes).
7. Reads: `0052` delete policy on `insurance_document_reads` (and `insurance_market_research`) is board_admin; deletes are audited.
   NOT FIXED: a board member can still write `result` directly. The server writes it from the user session, so closing it needs the
   three writes moved into service-side RPCs (src change plus DECISIONS 35(i) wording). Comment on the table states the limit.
8. `approved_by` / `sent_at` pinned after send: `0052` `tg_insurance_messages_lock` and `0053` `tg_contractor_messages_defaults`.
9. `withdraw_payment_report` uses `current_person_id` (carries the aal2 test): `0054`. Test drops `session_is_aal2()` (dev state).
10. `0056` `import_validate` tests the `payee_map` key even for a blank payee; root cause guard `tg_expenses_same_association` in `0060`.
11. `documents.storage_path` trigger `tg_documents_path_in_association` in `0060`.
12. Revokes: `0051` (four helpers, appended at the end), `0060` (`bank_payee_key`, `tg_tax_filing_immutable`, `tg_vendors_status_sync`,
    found by widening the lint). `migrations.test.ts` now checks every public function against anon, and that every function pins `search_path`.
13. `record_ticket_triage` (`0053`): a reporter's `done` triage needs an ok `ticket_triage` `ai_calls` row of theirs from the last 10 minutes.
    Residual: `finish_ai_call(ok)` is caller-chosen, so this only rate-limits the planting (10 per person per day); the UI should keep
    labelling it a suggestion. Existing tests that record triage as a reporter were left as is only if they passed (see run results).
14. NOT FIXED: owners reading `actor_user_id` / `actor_person_id` on `ticket_events`. Column privileges would break three server reads
    (`src/app/layout.tsx`, `src/app/maintenance/[ticketId]/load.ts`, `src/app/repairs/owner-problems-view.tsx`, which select those columns
    as `authenticated` for both board and owners). Needs those reads moved to a definer function or view; low impact (same building).
15. Vendor links: `0053` trigger `vendors_urls_ok` (website_url, source_urls) on insert / change; `0056` import commit adds `https://` to a bare
    domain and drops anything else.
16. NOT FIXED: the photo-registration existence oracle (the `(association_id, checksum)` unique key means the response for an invisible
    duplicate cannot look like a new upload; the caller must already hold the exact bytes). Comment on the 30-a-day cap corrected in
    `0051`; the cleanup job (service role deletes unregistered photo-path objects older than a day) is NOT built.
17. Soft gates: claim invite now requires the login's `auth.users` email to match `persons.email` when set (`0054`, a product change: an
    owner must sign in with the email the board recorded; tests 31/33 in owner-portal updated to use matching email); standing rules already
    required an active admin (REVIEW-2); `email_clear_suppression` writes an `email_log` row, new event `suppression_cleared` (`0055`);
    `import_expire_stale(14)` in `0056`, called from `email_purge` (daily cron), so no src change. NOT FIXED: decision-7 category check
    (retagged W-9) is accepted and documented here only.
18. Tests: harness now grants default execute on functions (`freshDb`), with a test; lint widened; AI test 7 retitled; the bare `toThrow()` was
    already tightened. Tests that were found passing only because of missing default grants are listed under run results.

## src edits
None.

## Open question for Doug
The reviewer says the dev project already has 0053 applied. You said 0051..0059 are applied nowhere. If dev has 0053, the in-place 0053 / 0054
fixes will not reach it; reset dev or write the equivalent as a dev-only patch.

## Migrations to apply, in order
0051, 0052, 0053, 0054, 0055, 0056, 0057, 0058, 0059, 0060.
Before applying to production run the counts printed by 0060's final notice, plus: legacy rows outside the length limits (they stay editable now),
`select count(*) from invites where role in ('board_admin','board_member') and redeemed_at is null and expires_at > now();`,
and persons with an email who have no login but a pending claim invite (they must sign in with that email).
