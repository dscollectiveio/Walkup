# F1-migration: migration 0051, its DB tests, harness additions

Step owner: Foundation. Date: 2026-10-14. No git commands run; nothing
applied to any Supabase project.

## Built

| File | What |
|---|---|
| `supabase/migrations/0051_ai_and_uploads.sql` | foundation-spec §3 verbatim, plus the §17 SQL changes below. `ai_calls` + `claim_ai_call` / `finish_ai_call` / `record_ai_call` / `ai_calls_today` / `ai_quota_status` / `ai_daily_limit` / `ai_person_triage_limit` / `ai_day_start` / `ai_usage_counts`; `can_see_ticket`, `can_add_ticket_photo`, `ticket_photo_permission`, `ticket_association_id`, `storage_path_kind`, `ticket_photo_pending_count`, `ticket_photo_upload_allowed`, `pending_upload_allowed`; the three storage policies (skipped under PGlite); `document_links` same-association trigger + warning block; `attach_ticket_photo`, `remove_ticket_photo`, `ticket_photos`. |
| `tests/db/ai-and-uploads.test.ts` | Every test 1 to 60 of foundation-spec §12.1 (numbered comments), plus: the agreed limits table, `coi_read` claimable, the narrower-audience case, and a migration-path test (0051 applied on top of seeded data with an existing link). 67 tests. |
| `tests/db/harness.ts` | Additive: `freshDb({ before })`, `applyMigrations(db, { from })` (repairs-spec §17.1), `addStorageStub(db)` (the exact `storage.objects` stub from §12.1). Default `freshDb()` unchanged. |
| `tests/fixtures/storage-paths.ts` | `STORAGE_PATH_CASES: { name, expected }[]`, shared by DB test 28 and (later) `tests/unit/upload-paths.test.ts`. `expected` is `{ kind: "document", associationId }`, `{ kind: "ticket_photo", associationId, ticketId }` or `null`. |

### §17 changes applied in SQL

- `ai_daily_limit`: `insurance_read 20`, `insurance_summary 20`,
  `insurance_market 6`, `insurance_draft 40` (insurance-spec §7, replacing the
  25/20/4/30 in §3's draft), `coi_read 25` (Repairs (d)). Others as §3:
  `ticket_triage 60`, `contractor_search 12`, `contractor_draft 40`,
  `bid_read 25`, `document_classify 200`.
- `ai_calls.kind` check and the `ai_quota_status` kind list both include
  `coi_read` (10 kinds).
- `attach_ticket_photo` returns a fifth column `narrower_audience boolean`
  (Repairs (e)).

## Deliberate differences from the spec, and why

1. **`narrower_audience` semantics** (spec says only "true when dedupe matched
   a document with a narrower audience"). It is true only when the caller can
   already see the matched document (`v_visible`) and that document reaches
   fewer people than the ticket: a non-`all_owners` document on a shared-area
   ticket, or an unrestricted `board_only` document on a unit ticket. A caller
   who can't see the match still gets `(null, true, null, false, false)`, so
   the flag can't be used to learn about documents you can't read. Different
   unit (Bo re-using Ada's unit photo on his unit) is not "narrower", it is
   disjoint: `false`. Every other return path returns `false`.
2. **§12.1 tests 6, 7, 8, 9, 10, 21 numbers.** Their literal numbers (`4/4`,
   eight `busy`, 9 rows) were written for the old `insurance_market` limit of
   4 and 9 kinds. The tests read the limit from `ai_daily_limit` and assert
   `${L}/${L}`, `2L` busy attempts, `L - 3` ok calls after the three
   request-caused failures, and 10 rows. A separate test pins the actual
   values of every kind.
3. **Test 12** finishes Cy's boundary claim as `busy` before inserting the row
   at `ai_day_start() + 1 minute`, so `ai_calls_today = 1` holds (an
   unfinished claim is in flight and would count). Also asserts the boundary
   is 00:00 in `America/Chicago`.
4. **Tests 44, 57, 58** use their own new shared Damen tickets (…044, …057,
   …058) so counts and closing don't leak into other tests. Test 41's second
   shared ticket (…006) is inserted with `on conflict do nothing` and reused
   by test 53.
5. A few extra assertions inside named tests: a non-existent ticket gets the
   same 42501 as "not yours" (35); a hub path is refused as a photo path (37);
   exactly 15 MB is accepted and a malformed checksum refused (38); removing
   via the wrong ticket is refused (51).

## Left undone / for the lead engineer

- Not applied to dev (`xhrivmdkrcfkhjyhkhye`); the lead applies it. When
  applying, read the notices: `0051: % document_links rows point at another
  association's document` should not appear, and the storage-policy block must
  not print the PGlite "skipping" notice. Build checks 12.3 #5 (`owner_id` set
  on signed uploads) and #6 (`postgres` has `rolbypassrls`) still need doing on
  dev before the photo UI ships.
- `0051` creates `can_see_ticket`. If Repairs' `0053` also redefines it, it
  must keep the signature `(uuid) returns boolean` and the members-only rule.

## Cross-workstream requests

- **Foundation (usage.ts step):** `AI_DAILY_LIMITS` must equal the SQL values
  above (20/20/6/40 for insurance, `coi_read: 25`), `AiKind` gains `coi_read`
  with label "reading insurance certificates"; the §12.2 unit test parses the
  `ai_daily_limit` case arms and the `ai_calls.kind` check from this file
  (formatting kept as in §3 so the regexes still apply).
- **Foundation (upload actions step):** `attach_ticket_photo` now returns
  `narrower_audience`; `registerUpload` should pass it through for ticket
  photos so Repairs can show "This photo is already on another problem with a
  smaller audience."
- **Foundation (upload-paths step):** `tests/unit/upload-paths.test.ts` should
  import `STORAGE_PATH_CASES` from `tests/fixtures/storage-paths.ts` and expect
  `parseStoragePath(name)` to equal `expected` for every row.
- **Repairs / Insurance:** `freshDb({ before })` and `applyMigrations(db, { from })`
  are in `tests/db/harness.ts` and ready for migration-path tests.

## Commands run

- `npx vitest run tests/db/migrations.test.ts tests/db/rls.test.ts` (after
  writing 0051): 2 files, 18 tests passed. No exception lists changed.
- `npx vitest run tests/db/ai-and-uploads.test.ts`: 67 passed.
- `npx tsc --noEmit`: no errors (whole project).
- `npx eslint tests/db/ai-and-uploads.test.ts tests/db/harness.ts tests/fixtures/storage-paths.ts`: clean.
- `npx vitest run tests/db` (whole DB suite, migrations 0001 to 0051 only at
  the time): 32 files, 348 tests passed (before the migration-path test was
  added; that file was re-run afterwards, 67 passed).
