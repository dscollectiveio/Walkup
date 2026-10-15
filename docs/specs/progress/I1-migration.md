# I1-migration: migration 0052, its DB tests

Step owner: Insurance. Date: 2026-10-14. No git commands run; nothing
applied to any Supabase project; no dev server touched; no dependencies added.

## Built

| File | What |
|---|---|
| `supabase/migrations/0052_insurance_v2.sql` | insurance-spec §5 parts 1 to 23 (enum values, contacts, shared coverage columns on policies and quotes, provenance for quotes, document reads, claims, quote requests to any contact, messages + lock trigger, building facts, dismissals, owner summary, market research cache, owner requests, premium bill link, document_links widened, v2 same-association guard, RLS, editable-column allowlists, `track_insurance_premium`, `insurance_premium_bill_advance`, `insurance_resolve_sources`, `save_insurance_policy`, `save_insurance_quote`, archive/delete/claim/skip/create-requests/mark-sent/current-agent/building-basics/proof-request/publish/owner-summary RPCs, the view, every backfill, the unique bill index). Taken from the spec verbatim except the changes listed below. |
| `tests/db/insurance-v2.test.ts` | Every §13.1 test (migration and lint, reads, save_insurance_policy incl. idempotency, replaces and cross-association, track/advance, save_insurance_quote, lifecycle and RPCs, owner summary, owner requests, a parameterised RLS loop over the five audited tables, the view) plus a backfill `describe` that runs 0001 to 0051, writes 0041-era rows, then applies 0052. 124 tests (2 skipped until the Insurance lib lands, see below). |
| `tests/fixtures/premium-cases.ts` | `PREMIUM_ADVANCE_CASES`: the four §6.6 installment cases, shared by the DB test and (later) the `premiumSchedule` unit test. |
| `tests/db/insurance.test.ts` | Kept; one test added: a quote request needs a partner or a contact (`insurance_quote_requests_has_recipient`), and either alone is accepted. No existing expectation changed (there were no board_member archive assertions). |
| `tests/db/harness.ts` | One additive line in `freshDb()`: `grant usage on schema auth to anon, authenticated, service_role` (see deviation 5). |

## Deliberate differences from the spec, and why

1. **`save_insurance_quote` update branch uses `get diagnostics` instead of
   `found`.** In PL/pgSQL `EXECUTE` does not set `FOUND`, so the spec's
   `if not found` after the dynamic `update` read the previous `select`
   (the unknown-key check, which leaves `FOUND` false): every quote edit would
   have raised "That quote was not found." Now `v_n = row_count`.
2. **`insurance_premium_bill_advance` raises 42501 when the bill isn't
   visible.** It is SECURITY INVOKER, so an owner's (or another association's
   board's) `select ... for update` finds nothing and the spec's
   `if not found then return null` would return null silently, while §13.1
   requires "by an owner raises 42501". A visible bill with no
   `insurance_policy_id` still returns null. Repairs' `mark_bill_paid` only
   calls it for a linked bill it already loaded, so nothing changes there.
3. **Backfill hardening** (part 23): agent names are `nullif(btrim(..), '')`
   (a blank `agency_name` would otherwise become an empty contact name and
   fail the `length(btrim(name)) > 0` check, aborting the migration); emails are
   kept only when they match the contacts check (also for partner
   `contact_email`, which 0041 never validated); partners with a blank name are
   skipped. The distinct key is the contact's own identity (name, kept email).
4. **Cross-association "quote" case.** Through `save_insurance_policy`, a hoyne
   `accepted_quote_id` is caught by the RPC's own lookup (`P0002 That quote was
   not found.`) before the guard can run, exactly like the replaced policy. The
   test asserts P0002 for both through the RPC, and 42501 "... belongs to a
   different association" from the v2 guard when `accepted_quote_id` /
   `replaced_by_policy_id` are written directly. Contact and document give
   42501 through the RPC as the spec says.
5. **Harness: `grant usage on schema auth`.** Supabase grants it; the harness
   didn't, so any SECURITY INVOKER function that calls `auth.uid()` in its body
   or in dynamic SQL failed with "permission denied for schema auth" under
   PGlite only (defaults and policies worked because they are stored parsed).
   0052's invoker RPCs are the first such functions. `auth.users` stays
   unreadable (no table grant). Whole DB suite still green.
6. **Harness API names.** §13.1 names `freshDb({ until })` and
   `applyMigration(file)`; F1 already shipped repairs-spec §17.1's
   `freshDb({ before: "0052" })` + `applyMigrations(db, { from: "0052" })`,
   which do the same thing, so the backfill tests use those.
7. **`fields-match-sql`** runs in two forms: (a) now, against the 89-column
   field table of §6.2 typed into the test (plus the 7 policy extras; for
   quotes the quote columns plus `included_sections, endorsements, exclusions,
   premium_breakdown, notes, quoted_on, valid_until, contact_id,
   quote_request_id`), and also checks every allowlisted name is a real column;
   (b) against `FIELD_DEFS` from `src/lib/insurance/fields.ts`, via a guarded
   dynamic import that is `skipIf` the file doesn't exist yet. Same for
   **`premium advance matches premiumSchedule`** (`premium.ts`). Both activate
   automatically when the Insurance lib step writes those files; no edit needed.
8. **Test speed.** The main suite replays the migrations once and starts each
   test from a `dumpDataDir()` copy (`templateDb()` in the test file), so 124
   tests take about 47 s instead of about 140 s. The backfill `describe` uses
   `freshDb({ before })` as normal.
9. The test that a request with neither partner nor contact is refused lives in
   `insurance.test.ts` (where §13.1 asks for it), not in the v2 file.
10. Extra assertions inside named tests: unknown `p_kind`, zero premium,
    archived policy for tracking, invalid owner-summary version, a read id
    without an index, policy-only keys refused on quotes, updating a missing
    quote (P0002), building-basics column checks still apply, the unique bill
    index refuses a direct duplicate, `updated_at` backfill.

0051 dependency check: 0052 calls nothing defined in 0051. The one interaction
is 0051's `document_links` same-association trigger, which fires on the save
RPCs' link inserts and the delete RPCs; covered by the save/delete tests (a
hoyne document is refused by 0052's guard on the policy row first).

## Left undone / for the lead engineer

- Not applied to dev. When applying, sanity-check the backfill on real data:
  `select count(*) from insurance_contacts where source in ('policy','partner')`,
  exactly one `is_current_agent` per association with an in-force agent, and
  `recurring_bills` with `insurance_policy_id` set only where a 0041 premium bill
  existed. The migration has no notices of its own.
- The two skipped tests (fields-match against `FIELD_DEFS`, premium advance vs
  `premiumSchedule`) wait for `src/lib/insurance/fields.ts` and `premium.ts`.

## Cross-workstream requests

- **Insurance lib step:** `FIELD_DEFS` must produce exactly the SQL allowlists
  (the DB test will check as soon as `fields.ts` exists). `tests/unit` premium
  test should import `PREMIUM_ADVANCE_CASES` from `tests/fixtures/premium-cases.ts`
  (with `todayIso` = the day after `paidDueOn`; see the file's comment).
  `premiumSchedule` / `premiumBillRetires` signatures as §6.6.
- **Insurance actions step:** a 23505 from either save RPC carries the saved row
  id in `details`; `save_insurance_quote` refuses policy-only keys (22023);
  `accepted_quote_id` from another association surfaces as P0002 "That quote
  was not found."
- **Repairs (0053):** keep `insurance_quotes` and `insurance_claims` in
  `document_links_target_table_known`; don't drop
  `recurring_bills_insurance_v2_same_association` or
  `recurring_bills_insurance_policy_key`. `insurance_premium_bill_advance(bill,
  paid)` returns the next date or null (retired) and raises 42501 for a bill the
  caller can't see.
- **Foundation (harness owner):** the `grant usage on schema auth` line in
  `tests/db/harness.ts` (deviation 5); it mirrors Supabase and is needed by any
  invoker function that calls `auth.uid()`.

## Commands run

- `npx vitest run tests/db/migrations.test.ts tests/db/rls.test.ts tests/db/insurance.test.ts`
  right after writing 0052: 3 files, 28 passed (no lint exception lists changed).
- `npx vitest run tests/db/insurance-v2.test.ts`: first run 112 failed, all
  "permission denied for schema auth" (deviation 5); after the harness grant
  122 passed, 2 skipped (138 s); after `templateDb()` 122 passed, 2 skipped (47 s).
- `npx tsc --noEmit`: one error in my test (literal-typed default parameter),
  fixed; then clean for the whole project.
- `npx eslint tests/db/insurance-v2.test.ts tests/db/insurance.test.ts tests/db/harness.ts tests/fixtures/premium-cases.ts`: clean.
- A throwaway probe (`tests/unit/zz-i1-probe.test.ts`, deleted) confirmed a
  `/* @vite-ignore */` dynamic import by absolute path works under vitest.
- `npx vitest run tests/db` (migrations 0001 to 0052): 33 files, 472 passed,
  2 skipped (the two above), 260 s.
