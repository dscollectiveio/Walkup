# R1-migration: migration 0053, its DB tests

Step owner: Repairs. Date: 2026-10-14. No git commands run; nothing applied to
any Supabase project; no dev server touched; no dependencies added. 0051 and
0052 not edited.

## Built

| File | What |
|---|---|
| `supabase/migrations/0053_repairs_v2.sql` | repairs-spec §3.1 to §3.10 in the spec's order: legacy repair from the audit log; `ticket_visible_to_caller` + `can_see_ticket` delegating to it + new `tickets_select`/`tickets_insert`; `ticket_comments` v2 (internal, kinds, edit/delete policies, guard); tickets v2 columns + trade/updated_at backfill; `ticket_board_details` (moved `estimated_cost`/`expense_id` off tickets, guard, triage pin); before-insert (reporter/times/owner-safe/advisory-lock numbering), before-update, same-association guard; `contractor_messages` v2 (kinds, legacy draft cancel, one-draft index, defaults/frozen-once-sent, guard, sent follow-ups); `recurring_bills` guard; `ticket_events` + `ticket_last_activity` + event triggers + backfill; `ticket_bids` + guard/events/audit + `accept_ticket_bid` + `request_ticket_quotes`; vendors v2, reviews (edit, tags, upkeep link, admin-only delete), `contractor_notes`; search cache v2, `google_calls_today`, `set_association_coordinates`; upkeep v2 (`upkeep_next_due`, backfills, log pin/sync triggers, admin-only deletes, `mark_upkeep_done`, `add_upkeep_task`, one log per ticket); bills v2 (`recurring_bill_payments`, `bill_next_due`, `mark_bill_paid` with the R-2 premium branch); photo event + photo re-pin trigger, `ticket_contractor_names`, `ticket_event_actor_roles`, `reopen_ticket`, `confirm_ticket_fixed`, `record_ticket_triage`, `close_out_ticket`, `mark_ticket_duplicate`, `close_ticket_for_owner`, `set_ticket_plan`, `set_ticket_priority`; `building_emergency_info`/`_contacts` + reader function; `repairs_seen` + `mark_repairs_seen`. |
| `tests/db/repairs-helpers.ts` (new) | Migrated `templateDb()` (dump once per file), `seededDb()`, `queries()` (`q/one/rows/count`), `pgError()`, and the §17.1 extra fixtures: Hoyne board admin (`zaraBoard`), Damen board member (`boBoard`, optional `granted_on`), contractors (Hoyne, two Damen, Damen do-not-use, archived Damen), Hoyne ticket, Hoyne and Damen upkeep tasks, a balanced Hoyne and Damen expense, `chicagoToday()`. |
| `tests/db/repairs-security.test.ts` (new) | §17.2 #1 to #33 (1 and 4 against `freshDb({ before: "0053" })`; 32/33 the migration path) plus a check that the comment/timeline policies use 0051's `ticket_association_id`. 34 tests. |
| `tests/db/tickets-v2.test.ts` (new) | §17.2 #1 to #27 (1, 2 migration path). 27 tests. |
| `tests/db/ticket-bids.test.ts` (new) | §17.2 #1 to #12 plus 10b (the all-or-nothing case split out). 13 tests. |
| `tests/db/contractors-v2.test.ts` (new) | §17.2 #1 to #13 (11 migration path) plus 5b (review upkeep link guard). 14 tests. |
| `tests/db/upkeep-v2.test.ts` (new) | §17.2 #1 to #14 (9 and 14 migration path) plus a task-pin test. 15 tests. |
| `tests/db/bills-v2.test.ts` (new) | §17.2 #1 to #7 plus 6b (no next due date) and two R-2 tests (premium bill advances by the policy's installments; retires when the renewal has taken over, returning null). 10 tests. |
| `tests/fixtures/upkeep-cases.ts` (new) | `UPKEEP_CASES`: the 14 §4.13 rows `{ doneOn, interval, month, expected, why }`. |
| `tests/fixtures/bill-cases.ts` (new) | `BILL_CASES`: the four §4.14 rows. |
| `tests/db/migrations.test.ts` | +2 tests: `authenticated` can execute every function an INVOKER RPC/trigger calls (bill_next_due, upkeep_next_due, is_board, current_person_id, ticket_visible_to_caller, ticket_association_id, mark_upkeep_done, insurance_premium_bill_advance); `anon` can execute none of the functions named in 0053 (parsed from the file) and `authenticated` all of them. |
| `tests/db/operations.test.ts` | §17.4: "keeps resolved_at and status in agreement" rewritten as "resolved_at follows status" (set on resolve, cleared on open, client value ignored). |

`tests/db/contractors.test.ts` and `tests/db/upkeep.test.ts` needed no change
(contractors.test has no review-delete expectation; upkeep.test passes as §3.7
predicted). Harness: nothing to add, F1 already shipped `freshDb({ before })`
and `applyMigrations(db, { from })`.

## Deliberately different from the spec, and why

1. **Bug fix in the spec's `tg_ticket_events`:** `v_fields := v_fields || 'title'`
   parses the literal as an array (`malformed array literal: "unit"`), so any
   board edit of title, description, location, access notes or unit would have
   failed. Now `array_append(v_fields, 'title')`. Caught by tickets-v2 #15;
   #4 now also asserts the `details_edited` fields.
2. **Not-valid length checks added after the updates that touch old rows.**
   Postgres applies a `not valid` check to an UPDATE of a legacy row, so the
   spec's order (constraints, then the trade backfill / draft cancel in the same
   section) would abort the migration on any legacy ticket title outside 4 to
   120 characters, description over 4000, or message subject over 200 / body over
   10000. `tickets_title_len`/`tickets_description_len` now follow the backfill;
   `contractor_messages_subject_len`/`_body_len` follow the draft cancel.
3. **Comment and timeline policies reuse 0051's helper** (foundation-spec §14:
   "Reuse `can_see_ticket()` in the fixed `ticket_comments_*` policies"):
   `ticket_comments_select`, `ticket_comments_insert` and `ticket_events_select`
   use `public.ticket_association_id(ticket_id) = association_id` (non-null only
   when `can_see_ticket`) instead of an RLS-filtered `exists (select from tickets
   ...)`. Same meaning (visible ticket, same association), one definition.
   `tickets_select` keeps the column-level rule (spec §21: `INSERT ... RETURNING`).
4. **`tg_contractor_messages_same_association` skips a null `vendor_id`**, leaving
   it to NOT NULL, so a malformed insert reports the real constraint rather than
   "contractor belongs to a different association" (operations.test relies on it).
5. **`mark_bill_paid` R-2 branch** (insurance-spec §12 R-2): a bill with
   `insurance_policy_id` sets `last_paid_on`, then calls
   `insurance_premium_bill_advance(p_bill_id, v_covers)` instead of the
   `bill_next_due` step; its result (date, or null when retired) is
   `bill_next_due_on`. 0052's `recurring_bills_insurance_v2_same_association`,
   `recurring_bills_insurance_policy_key` and the `document_links` target list
   are untouched.
6. **`tg_ticket_bids_guard`**: an update that keeps an accepted/declined status
   now pins `decided_at`/`decided_by` to the old values (the spec left the
   client's values in that case; "decision stamps follow the status, whatever
   the client sent").
7. **Robustness in validation** (same rules, error codes made deterministic):
   `record_ticket_triage` checks types before casts in nested ifs (a string
   `confidence` or a non-array `questions` is 22023, not a cast error; `trade`
   and `search_phrase` must be strings); `request_ticket_quotes` checks
   `jsonb_typeof` before `jsonb_array_length`; `close_out_ticket`,
   `set_ticket_priority` and `add_upkeep_task` refuse a null status / priority /
   interval with 22023 (`null not in (...)` would have passed); the guards that
   compare with `OLD` use nested ifs (OLD is null on insert).
8. **Tests**: tickets-v2 #8 backdates Bo's note event and grants his board role
   from 2026-02-01, so "before his board grant" is real (`ticket_event_actor_roles`
   is date-based). reopen tests move `resolved_at` with
   `session_replication_role = replica` (the update trigger pins it). Suites use a
   per-file migrated template (like insurance-v2) for speed.

## Left undone / for the lead engineer

- **Not applied to dev.** Do not apply 0053 to dev/prod before the Repairs app
  steps land: these Repairs files still read columns 0053 removes or rely on the
  old cache key, and would break at runtime:
  `src/app/repairs/problems-view.tsx`, `src/app/maintenance/[ticketId]/page.tsx`,
  `src/app/contractors/[vendorId]/page.tsx` (select `tickets.estimated_cost`, now
  in `ticket_board_details`), and `src/app/contractors/vendor-actions.ts`
  (`contractor_search_cache` upsert `onConflict: "association_id,trade"`; the
  constraint is now `contractor_search_cache_key (association_id, provider, trade,
  query_key, location_key)`, so the write would fail silently).
- Before applying on dev, check legacy data the not-valid checks will hold
  against later updates:
  `select count(*) from tickets where char_length(btrim(title)) not between 4 and 120 or char_length(description) > 4000;`
  and the same for `contractor_messages` subject/body and `ticket_comments` body
  (1 to 4000 after trim). Any hit can't be edited until fixed. 0053 emits no
  notices of its own.
- Audit rows for `ticket_board_details` and `building_emergency_info` have
  `record_id` null (`tg_audit` reads an `id` column; their keys are `ticket_id` /
  `association_id`, which are in `before_data`/`after_data`). Accepted as the
  spec wrote it.
- §17.5 manual checks (PostgREST with real JWTs, advisors) need dev.

## Cross-workstream notes

- **Foundation:** 0053 redefines `can_see_ticket(uuid)` (same signature, grants
  and meaning; body delegates to `ticket_visible_to_caller`). ai-and-uploads
  (0051) tests all pass against it.
- **Insurance:** R-2 is in `mark_bill_paid` as asked; insurance-v2 suite passes
  with 0053 applied.
- **Repairs (later steps):** use `UPKEEP_CASES` / `BILL_CASES` from
  `tests/fixtures/*` in the `nextDueAfter` / `billNextDue` unit tests. Problem
  page and timeline: a board edit of title/description/location/access/unit
  writes `details_edited` with `data.fields` (`["title", "description",
  "location_detail", "access_notes", "unit"]`).

## Commands run

- `npx vitest run tests/db/migrations.test.ts tests/db/rls.test.ts` (right after
  writing 0053): 2 files, 18 passed.
- `npx vitest run tests/db/operations.test.ts tests/db/contractors.test.ts tests/db/upkeep.test.ts tests/db/ai-and-uploads.test.ts tests/db/document-hub.test.ts`:
  1 expected failure (operations "keeps resolved_at and status in agreement",
  §17.4), rewritten; 111 others passed.
- `npx vitest run tests/db/repairs-security.test.ts`: first 2 failures in my
  fixtures (expense account classification, unbalanced journal entry), fixed;
  34 passed.
- `npx vitest run tests/db/tickets-v2.test.ts`: first run 1 failure (the
  `v_fields ||` bug in the spec SQL, deviation 1), fixed in 0053; 27 passed.
- `npx vitest run tests/db/ticket-bids.test.ts`: 13 passed.
- `npx vitest run tests/db/contractors-v2.test.ts`: 14 passed.
- `npx vitest run tests/db/upkeep-v2.test.ts`: 15 passed.
- `npx vitest run tests/db/bills-v2.test.ts`: first run 1 failure (my test's
  expectation ignored due_day 31), fixed; 10 passed.
- `npx vitest run tests/db/migrations.test.ts tests/db/operations.test.ts`: 19 passed.
- `npx tsc --noEmit`: one error in my test (literal-typed default parameter),
  fixed; then exit 0 for the whole project.
- `npx eslint` on every test/fixture file above: clean.
- `npx vitest run tests/db` (migrations 0001 to 0053, whole DB suite): 39 files,
  589 tests passed, 0 skipped, 352 s.
