# REVIEW 1: migrations 0051 to 0059 (hostile Postgres/Supabase review)

Reviewer: hostile security pass over `supabase/migrations/0051` to `0059`, read-only on the repo.
Date: 2026-10-14. Reviewed against the working tree as it stood at 21:12 CDT. Migrations 0052, 0055, 0056 and
0059 were edited while this review ran (REVIEW-4 fixes; 0059 was rewritten to a parity-of-reversals rule).
Every reproduction below was re-run after the last edit. Findings that the edits already closed are listed
under "Checked and fine", not as findings.

## Method

- Every migration was read in full, then compared with `docs/specs/insurance-repairs-overhaul.md` section 4,
  `docs/DECISIONS.md` #6 #17 #20 #21 #22 #23 #26 #28 #31 (and #35 to #37), `docs/security/ATTACK-REPORT-1.md`
  and the area specs.
- Experiments ran in a scratch PGlite database outside the repo
  (`/private/tmp/claude-501/-Users-dougsmart-Desktop-Claude-Code/1b96944a-acd7-43cd-9ccd-ed28497e667d/scratchpad/review-a`,
  scripts `e1.mts` to `e27.mts`, `fixtest.mts`, `fixtest2.mts`; the repo's `tests/db/harness.ts` and fixtures,
  copied). All 59 migrations were applied from the working tree.
- One deliberate difference from the repo harness: before the migrations ran I executed
  `alter default privileges in schema public grant execute on functions to anon, authenticated, service_role`.
  That is what a real Supabase project does and the repo harness does not (see finding 18). Without it, a
  function that was only revoked from `public, anon` looks locked to `authenticated` in tests and is not in
  production.
- Fixtures: Damen (Cy board_admin, Bo owner and, where stated, board_member, Ada owner, Nia accountant),
  Hoyne (Zara). "aal1/aal2" is the harness's JWT claim.
- The repo's own `tests/db` suite for these migrations (390 tests in the 10 files covering them) passes
  against the working tree. None of the findings below is caught by it.
- Not reviewed: application code (except where a DB claim depends on it), real Supabase Storage and PostgREST
  behaviour (DECISIONS #21: grant and storage-policy changes still need an HTTP check with a real JWT), true
  concurrency (PGlite has one connection; races below are argued from the SQL and shown with the state a race
  leaves behind).

## Summary

| # | Rank | Migration | One line |
|---|---|---|---|
| 1 | **Blocker** (pre-existing, live in prod) | 0054 (+0027, 0002) | A `board_member` can become `board_admin` two ways: mint a `board_admin` invite, or repoint the admin's `persons.auth_user_id` |
| 2 | Major | 0051 | A board member can refund their own AI claim as `not_started` while the model call runs: the daily quota is unbounded |
| 3 | Major | 0053 | `NOT VALID` length checks still apply to every later UPDATE: legacy tickets (and comments, drafts, reviews, log rows) with odd lengths can never be edited or closed again |
| 4 | Major | 0059 / 0036 | Two reversals of one entry (double click) leave the tax views counting +100 while the ledger says -100; no lock, no unique index |
| 5 | Major | 0057 | The new guards run on every UPDATE, so an existing cross-association grant or ownership row (the very rows ATTACK-REPORT-1 #4/#5 created) cannot be revoked or end-dated |
| 6 | Minor | 0052 | Decision 35(g) "archive is board_admin only" is enforced only in the RPC; a board member sets `archived_at` directly |
| 7 | Minor | 0052 | Insurance reads and field provenance are client-writable by any board member (provenance forgery; board_member delete) |
| 8 | Minor | 0052 / 0053 | A sent message's `approved_by` and `sent_at` can be rewritten after the fact |
| 9 | Minor (dev only) | 0054 | `withdraw_payment_report` calls `session_is_aal2()` directly: it errors on the dev project |
| 10 | Minor | 0056 | `payee_map` with a blank key writes another association's vendor id into the ledger; root cause is no guard on `expenses.vendor_id` |
| 11 | Minor (pre-existing) | 0020 / 0051 | `documents.storage_path` is not tied to the row's association: a forged row reads another building's object if its path is known |
| 12 | Minor | 0051 | Four helper functions were never revoked from `public, anon` |
| 13 | Minor | 0053 | `record_ticket_triage` lets the reporter write arbitrary "Walkup's suggestion" text for the board |
| 14 | Minor | 0053 | Owners can read `actor_user_id` and `actor_person_id` of board members from `ticket_events` |
| 15 | Minor | 0053 / 0056 | `vendors.website_url` and `source_urls` have no scheme check; the import writes raw cells |
| 16 | Minor | 0051 | `attach_ticket_photo` dedupe is a content-existence oracle; the "30 a day" unregistered-upload cap does not bound storage |
| 17 | Minor | various | Soft gates: decision-7 category check, claim-invite not bound to an email, staged import PII never expires |
| 18 | Minor | tests | Gaps and over-claims in `tests/db` (list) |

Counts: 1 blocker, 4 major, 13 minor. Findings 1 and 11 exist in production today, independent of this release.
Rows that can be changed or lost on apply are called out per finding.

---

## 1. BLOCKER: a board_member can become board_admin (two independent routes)

Pre-existing (0002, 0027) and live on production now; this release rewrites both objects (0054
`redeem_invite`, `tg_persons_self_edit_guard`) without closing them. The brief's rule, "board_member writing
where only board_admin may", is broken for the two most valuable writes in the system.

### 1a. Invites

- Where: `0027_signup_and_invites.sql:67` `invites_insert ... with check (public.is_board(association_id))`;
  redeemed by `0054_owner_portal.sql:81-146` `redeem_invite`, which grants whatever role the invite names.
- What is wrong: `role_grants_insert` is board_admin only, but a board member can insert an invite naming any
  role, including `board_admin`, and hand the link to any account.
- Reproduction (ran): Bo is a `board_member`; Eve is a fresh login with no person.

```sql
-- as Bo, aal2
insert into role_grants (association_id, person_id, role, granted_on)
  values ('<damen>','<ada person>','board_admin',current_date);
--> ERROR 42501 (refused, as designed)
insert into invites (association_id, role, email) values ('<damen>','board_admin','eve@example.test') returning token;
--> succeeds
-- as Eve
select public.redeem_invite('<token>','Eve Evil');          --> succeeds
select g.role from role_grants g join persons p on p.id=g.person_id where p.auth_user_id='<eve>';
--> [ { role: 'board_admin' } ]
```

### 1b. Repointing the admin's login

- Where: `0002_rls.sql:315` `persons_update ... using (is_board(association_id) or auth_user_id = auth.uid())`;
  `0054_owner_portal.sql:156-177` `tg_persons_self_edit_guard` deliberately skips everyone who is a board member
  (`and not public.is_board(old.association_id)`).
- What is wrong: any board member may UPDATE any `persons` row in the building, including `auth_user_id`.
  `has_role_in` resolves roles through `persons.auth_user_id`, so changing it hands the admin's roles to another login
  and locks the real admin out (DECISIONS #6: identity is `persons` + `role_grants`).
- Reproduction (ran):

```sql
-- as Bo (board_member)
update persons set auth_user_id = '<eve>' where id = '<Cy person>' returning id;      --> 1 row
select has_role_in('<damen>', array['board_admin']::app_role[]);  -- as Eve --> true;  as Cy --> false
```

### Fix (verified in scratch: both routes refused; owner phone edits, board edits of others' phones and admin
invites all still work)

```sql
create or replace function public.tg_persons_self_edit_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if (new.auth_user_id is distinct from old.auth_user_id
        or new.association_id is distinct from old.association_id)
       and not public.has_role_in(old.association_id, array['board_admin']::public.app_role[]) then
      raise exception 'only a board admin can change who a person signs in as' using errcode = '42501';
    end if;
    if not public.is_board(old.association_id)
       and (new.full_name is distinct from old.full_name or new.email is distinct from old.email) then
      raise exception 'ask the board to change your name or email' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop policy invites_insert on public.invites;
create policy invites_insert on public.invites
  for insert to authenticated
  with check (
    public.has_role_in(association_id, array['board_admin']::public.app_role[])
    or (public.is_board(association_id) and role = 'owner')
  );
```

Definer functions (`redact_person`, `redeem_invite`, deprovisioning) run as the owner, so `current_user` is not
`authenticated` and they are unaffected. Add DB tests for both routes (none exist).

Production data on apply: none (policy and function bodies only). Before applying, run
`select count(*) from invites where role in ('board_admin','board_member') and redeemed_at is null and expires_at > now();`
and look at any open admin invite a board member created.

---

## 2. MAJOR: the AI quota can be refunded by the caller (`not_started`)

- Where: `0051_ai_and_uploads.sql:156-170` `ai_usage_counts` (attempts exclude `error_code = 'not_started'`, line 164),
  `:224-233` (the owner's personal cap excludes it too, line 232), `:258-300` `finish_ai_call` (any caller-chosen
  `p_error_code` for a row they claimed). `finish_ai_call` is granted to `authenticated`, and `ai_calls_select`
  lets every board member read the id of the in-flight row.
- What is wrong: the limit is meant to be enforced "in the database before the call" (DECISIONS #35.10). The
  server claims a row, then calls the model. While the model call runs (seconds), the browser of a board member
  can read that in-flight row and call `finish_ai_call(id, false, 'not_started')`. A `not_started` row counts
  neither as used nor as an attempt, so the next claim sees an empty day. Platform-failure codes (`timeout`,
  `busy`) are bounded by the 2x attempts cap; `not_started` is not bounded at all. The app's own `finish` then
  returns false. Result: unlimited web-search and Opus calls per day per building from a compromised or hostile
  board account (the threat model 0055's header uses).
- Reproduction (ran, Bo = board_member, kind `insurance_market`, limit 6):

```sql
select public.claim_ai_call('<damen>','insurance_market');             -- repeat 40 times
select public.finish_ai_call('<claim id>', false, 'not_started');      -- after each claim
--> 40 claims granted, no refusal                     (limit is 6)
-- same loop with 'timeout' on insurance_summary (limit 20):
--> 40 claims granted, then "too many AI attempts today"   (2x cap holds for ordinary failure codes)
```

  An owner cannot do this to the server's claim: `ai_calls_select` is board-only, so an owner never sees the id.
- Fix (verified: the same loop now stops after 12 claims = 2x the limit):

```sql
create or replace function public.ai_usage_counts(p_association_id uuid, p_kind text)
returns table (used integer, attempts integer)
language sql stable set search_path = '' as $$
  select
    (count(*) filter (where c.ok
                         or c.error_code in ('refused', 'too_long', 'bad_request')
                         or (c.error_code = 'in_flight'
                             and c.created_at > now() - interval '330 seconds')))::integer,
    (count(*))::integer                       -- every claim is an attempt, however it was released
    from public.ai_calls c
   where c.association_id = p_association_id and c.kind = p_kind and c.step = 'main'
     and c.created_at >= public.ai_day_start()
$$;
-- and in claim_ai_call, drop "and c.error_code is distinct from 'not_started'" from the v_mine count (line 232).
```

  This still lets a hostile board member reach 2x the limit by refunding with `timeout`; if that is too loose,
  halve `v_attempts >= 2 * v_limit` to `v_attempts >= v_limit + 2`. A hard fix needs the refund to be a
  service-side act, which DECISIONS #18 rules out; say so in the decision text instead of claiming
  "concurrent requests can't exceed the limit".
- Production data on apply: none (function body only).

---

## 3. MAJOR: `NOT VALID` length checks make legacy rows uneditable

- Where: `0053_repairs_v2.sql:386-389` `tickets_title_len` (4 to 120 after trim) and `tickets_description_len`
  (<= 4000); `:181` `ticket_comments_body_length`; `:721-722` `contractor_messages_subject_len/body_len`;
  `:1495` `contractor_reviews_body_len`; `:1819-1820` `upkeep_log_done_on_sane` / `upkeep_log_note_len`.
- What is wrong: the migration's own comment (line 382) knows "a not-valid check still applies to an UPDATE of an
  old row", and uses that only to order the backfill. It is permanent: Postgres checks every constraint,
  validated or not, on each new row version. Any ticket whose title is under 4 characters ("Gas", "AC", "Leak"
  is fine, "Gas" is not) or over 120, or whose description is over 4000, can never again be closed, reassigned,
  prioritised or edited: `close_out_ticket`, `set_ticket_plan`, the board's status buttons and
  `tg_ticket_events` all UPDATE the row.
- Reproduction (ran): legacy data loaded on the 0050 schema, then 0051 to 0059 applied (they apply cleanly), then:

```sql
-- as Cy (board_admin)
update tickets set status='closed' where id = '<ticket titled "Gas">';
--> 23514 new row for relation "tickets" violates check constraint "tickets_title_len"
update tickets set priority='low' where id = '<ticket with a 6000-char description>';
--> 23514 ... "tickets_description_len"
select * from close_out_ticket('<Gas>','closed',null,null,'done',false);   --> 23514
```

- Fix (verified: legacy "Gas" closes again; a new 3-character title and renaming a legacy ticket to 3
  characters are still refused). Replace each of the checks above with a trigger that looks only at what is being
  written; same shape for the other tables:

```sql
alter table public.tickets drop constraint tickets_title_len, drop constraint tickets_description_len;
create or replace function public.tg_tickets_text_limits()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.title is distinct from old.title then
    if char_length(btrim(new.title)) not between 4 and 120 then
      raise exception 'the title must be 4 to 120 characters' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' or new.description is distinct from old.description then
    if char_length(new.description) > 4000 then
      raise exception 'the description must be 4000 characters or fewer' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger tickets_12_text_limits before insert or update on public.tickets
  for each row execute function public.tg_tickets_text_limits();
```

- Production data on apply: the migration applies; rows violating the limits become read-only in effect. Count
  first: `select count(*) from tickets where char_length(btrim(title)) not between 4 and 120 or char_length(description) > 4000;`
  and the same for `ticket_comments` (empty or > 4000), `contractor_messages`, `contractor_reviews`,
  `upkeep_log`. If production has none today the exposure is only future data; if it has any, fix before applying.

Backfill safety, tested on odd legacy shapes (3-character and padded titles, a 6000-character description, an
empty and an over-long comment, a Hoyne comment injected onto a Damen ticket, duplicate drafts for one
contractor/ticket and several with no ticket, blank agency, malformed broker email, case-differing agency
names, policies marked replaced with no successor, same-day duplicate policies, seasonal tasks with interval 1
and 5, 1999 log rows): 0051 to 0059 applied without error. Observed effects: the injected comment was deleted
(2 of 3 comments remain), 2 of 4 drafts were cancelled (newest per contractor/ticket/kind kept), seasonal tasks
moved to month end, invalid-interval `due_month`s were nulled. These are the documented, audited changes.

---

## 4. MAJOR: two reversals of one entry make the tax views and the ledger disagree

- Where: `0036_bank_feed_posting_functions.sql:225-273` `reverse_journal_entry` (reads the entry without
  `FOR UPDATE`, then a plain `exists` check, no unique index on `reverses_entry_id`); `0059_tax_views_net_reversals.sql:82,116,184,218`
  (`count(*) of the reversal chain % 2 = 1`).
- Context: the earlier 0059 skipped any entry that had a reversal, so a reversal of a reversal hid income
  (reproduced against that version, 100.00 ledger income vs 0.00 in `form_1120h_figures`; REVIEW-4 #3 found the
  same). The rewritten parity rule fixes that: I re-ran it, deposit 100.00 shows 100 / 0 / 100 in the 1120-H
  figures after post / reverse / re-reverse, matching the ledger. The parity rule is now wrong in one case it
  cannot see: more than one direct reversal of the same entry. A chain `E, R1, R2` has length 3, so `E` counts.
- What is wrong: nothing stops two reversals of `E`. `reverse_journal_entry` has no row lock and no unique
  constraint, so a double click or two board members clicking at once both pass `exists (... reverses_entry_id = e.id)`.
  The ledger then nets `E - E - E = -100`, while the tax views count `+100`.
- Reproduction (ran; the second reversal inserted as a superuser to leave the exact state the race leaves):

```text
tax receipts view: 100.00
ledger income net (credit-debit): -100.00
indexes mentioning journal_entries.reverses_entry_id: 0
```

- Fix (verified: reversal-of-a-reversal still works, the second direct reversal is impossible):

```sql
-- check first: must return no rows, or resolve them before creating the index
select reverses_entry_id, count(*) from public.journal_entries
 where reverses_entry_id is not null group by 1 having count(*) > 1;

create unique index journal_entries_one_reversal on public.journal_entries (reverses_entry_id)
  where reverses_entry_id is not null;
-- in reverse_journal_entry:  select * into e from public.journal_entries where id = p_entry_id for update;
```

  A chain stays linear (R2 reverses R1, never a second reversal of E), so the parity rule is then exact.
  I measured the new views at 3000 entries: 0.65 s for `cash_basis_receipts` and 2 s for `form_1120h_figures` in
  PGlite; an index on `reverses_entry_id` did not change that, so I am not raising performance.
- Production data on apply: the unique index fails if duplicate reversals already exist (run the check above on
  production; the live 0036 function allowed the race since 0036).

---

## 5. MAJOR: the 0057 guards break remediation of the rows they were written for

- Where: `0057_integrity_guards.sql:22-61` `tg_role_grant_same_association` / `tg_unit_owner_same_association`,
  `BEFORE INSERT OR UPDATE`, unconditional.
- What is wrong: the header says "existing rows are not rewritten" and a notice counts bad rows. But the guard
  re-validates the pointers on every UPDATE, including `set revoked_at = now()` and `set effective_to = ...`.
  If a cross-association grant or ownership row already exists (ATTACK-REPORT-1 says #4 is exploitable on
  production today), the board cannot revoke or end-date it through the app or API: the revoke raises 42501. The
  other guards in this release (e.g. `tg_tickets_same_association`) correctly check only on insert or when the
  column changes.
- Reproduction (ran): legacy cross-association grant (Zara, a Hoyne person, holding `board_member` in Damen) created
  before 0057, then:

```sql
-- as Cy (board_admin of Damen)
update role_grants set revoked_at = now() where person_id = '<zara person>' and association_id = '<damen>';
--> ERROR 42501 person belongs to a different association
```

- Fix (verified: the revoke now succeeds; a new cross-association insert is still refused). Same edit for
  `tg_unit_owner_same_association` using `unit_id`, `person_id` and `association_id`:

```sql
create or replace function public.tg_role_grant_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.person_id = old.person_id and new.association_id = old.association_id then
    return new;
  end if;
  if not exists (select 1 from public.persons p where p.id = new.person_id and p.association_id = new.association_id) then
    raise exception 'person belongs to a different association' using errcode = '42501';
  end if;
  return new;
end $$;
```

- Production data on apply: none; but run the notice's two counts on production before and after. A non-zero
  count means someone outside the building may hold a role there, and the rows should be revoked as part of
  the release.

---

## 6. Minor: "archive is board_admin only" is enforced in the RPC, not the table

- Where: decision 35(g); `0052_insurance_v2.sql:1454-1473` `archive_insurance_policy` checks `board_admin`;
  `insurance_policies_update` (0013 loop, reused) is `is_board` and the new `archived_at/archived_by` columns
  (`:188-200`) have no guard.
- Reproduction (ran, Bo = board_member):

```text
RPC archive_insurance_policy by Bo        -> "Only a board admin can archive a policy."
update insurance_policies set archived_at = now() where id = ... (direct) -> 1 row
update vendors set archived_at = now() ...  (direct)                      -> 1 row
```
- Fix (verified; admin RPC archive and restore, and a board member's ordinary policy edit through
  `save_insurance_policy`, still work):

```sql
create or replace function public.tg_insurance_policies_archive_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by)
     and current_user in ('authenticated', 'anon')
     and not public.has_role_in(old.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'Only a board admin can archive or restore a policy.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger insurance_policies_archive_guard before update on public.insurance_policies
  for each row execute function public.tg_insurance_policies_archive_guard();
```
  Decide separately whether archiving a contractor is admin-only; 35(i) says deletes only.
- Production data: none.

## 7. Minor: insurance reads and provenance are client-writable (the "rebuilt from the stored read" contract is not enforced)

- Where: `0052_insurance_v2.sql:772-777` (select/insert/update/delete on `insurance_document_reads` for any board
  member); `0041` field-source insert policy; decision 35(i): "clients never send snippets or pages".
- What is wrong: a board member can write the read's `result` and `state` directly, then
  `save_insurance_policy` rebuilds "extracted, page 2, confidence 0.99, snippet ..." from that forged JSON. They can
  also delete reads (the table is not audited and CLAUDE.md says board_member has no deletes).
- Reproduction (ran, Bo = board_member):

```sql
insert into insurance_document_reads (association_id, document_id, mode) values ('<damen>','<insurance doc>','policy') returning id;
update insurance_document_reads set state='done', result='{"policies":[{"fields":[{"name":"building_limit","confidence":0.99,
  "candidates":[{"value":"9999999","page":2,"snippet":"Building limit $9,999,999"}]}]}]}' where id = '<id>';
select save_insurance_policy('<damen>', null, '{"coverage":"property","carrier_name":"Forged Mutual", ... ,"building_limit":9999999}',
  '[{"field_name":"building_limit","source":"extracted","candidate_index":0}]', '{"document_id":"<doc>","read_id":"<id>","read_index":0}');
select field_name, source, page_number, confidence, raw_text_snippet from insurance_policy_field_sources where field_name='building_limit';
--> building_limit | extracted | 2 | 0.9900 | Building limit $9,999,999
delete from insurance_document_reads where id = '<id>' returning id;     --> 1 row
```
- Fix: at minimum change the `insurance_document_reads` delete policy to `board_admin` (and add `tg_audit`). To make
  the contract real, drop the insert/update policies and move the three writes (create, finish, skip) into
  definer RPCs that set `result` only from the app's server context; the current design writes `result` from a
  user session, so the database cannot tell the model's output from a person's edit. State the limit in
  decision 35(i) if you accept it.
- Production data: none.

## 8. Minor: `approved_by` and `sent_at` can be rewritten after a message is sent

- Where: `0052_insurance_v2.sql:401-425` `tg_insurance_messages_lock`; `0053_repairs_v2.sql:735-785` `tg_contractor_messages_defaults`.
  Both promise "a sent message is a record" and "the approver is always the caller", but only pin subject, body,
  recipient, kind and status.
- Reproduction (ran, both tables): Bo marks a message sent, then `update ... set approved_by = '<Cy>', sent_at = sent_at - interval '40 days'`
  succeeds; the audit log keeps the old values but the row now says Cy approved it.
- Fix (insurance shown, verified; same two lines in the contractor trigger inside the `old.status = 'sent'` branch):

```sql
-- inside tg_insurance_messages_lock, in the "old.status in ('sent','cancelled')" branch, after the raise:
new.approved_by := old.approved_by;
new.sent_at     := old.sent_at;
```
- Production data: none.

## 9. Minor (dev project only): `withdraw_payment_report` fails without 0025

- Where: `0054_owner_portal.sql:919` `... or not public.session_is_aal2() then`. Quality bar: new code calls the
  helpers, not `session_is_aal2()`, because dev lacks 0025.
- Reproduction (ran): with 0025's three helpers replaced by their 0002 versions and `session_is_aal2()` dropped (the dev
  state), `select public.withdraw_payment_report('<id>')` as Ada fails with `42883 function public.session_is_aal2() does not exist`;
  with 0025 present it succeeds. Nothing else in 0051 to 0059 calls `session_is_aal2`, `to_regprocedure`, or any 0026 object
  (`bank_connections.plaid_item_removed_at`). 0058 only needs `plaid_item_id` and status `'error'`, both older.
- Fix (verified; `current_person_id` carries the AAL2 test on production and exists on dev):

```sql
-- replace the condition with
if not found or r.reported_by is distinct from auth.uid() or public.current_person_id(r.association_id) is null then
```
- Production data: none.

## 10. Minor: `payee_map` blank key writes a foreign vendor id; `expenses.vendor_id` has no association guard

- Where: `0056_imports.sql:672-674` (the check runs only `if m->>'payee' <> ''`), `:992` (commit looks the vendor up by
  `payee_map ->> ''`, with no association check). Root cause: `record_expense` (0015) and the `expenses` table never
  verified `vendor_id`.
- Reproduction (ran): a Hoyne vendor, then as Cy (Damen admin) a `transactions` import with one row whose `payee` is
  blank and `payee_map = {"": "<hoyne vendor>"}`: validation reports 0 errors, commit succeeds, and
  `expenses.vendor_id` points at the Hoyne vendor (`vendor_assoc` = Hoyne). A plain
  `record_expense(..., p_vendor_id => '<hoyne vendor>')` also succeeds. Impact is bounded: Hoyne's
  `vendor_1099_totals` stays empty (RLS hides Damen's expense), but a board admin can probe whether any UUID is a
  vendor anywhere (FK error vs success) and can pin another building's vendor undeletable.
- Fix (guard verified: both paths now refused):

```sql
create or replace function public.tg_expenses_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.vendor_id is not null and (tg_op = 'INSERT' or new.vendor_id is distinct from old.vendor_id) then
    if not exists (select 1 from public.vendors v where v.id = new.vendor_id and v.association_id = new.association_id) then
      raise exception 'contractor belongs to a different association' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger expenses_same_association before insert or update on public.expenses
  for each row execute function public.tg_expenses_same_association();
```
  and in `import_validate` test the key unconditionally:
  `if (o -> 'payee_map') ? lower(btrim(coalesce(m ->> 'payee', ''))) and not exists (select 1 from public.vendors v where v.association_id = b.association_id and v.id = public.import_uuid(o -> 'payee_map' ->> lower(btrim(coalesce(m ->> 'payee', ''))))) then ...`.
- Production data: none. Check existing rows: `select count(*) from expenses e join vendors v on v.id = e.vendor_id where v.association_id <> e.association_id;`.

## 11. Minor (pre-existing): a document row can point at another association's storage object

- Where: `0001_core_schema.sql:270` `unique (association_id, storage_path)` (not unique on path alone);
  `0020_document_hub.sql:463-471` storage `documents_read`: "a visible `documents` row has this name", with no tie between
  the object's first folder and the row's association. 0051's new policies and functions do check the path's
  association, but only for their own paths.
- Reproduction (ran; the storage policy replicated on the stub `storage.objects` with RLS on):

```text
Zara (Hoyne admin) can read the Damen object before: 0
insert into documents (association_id='<hoyne>', storage_path='<damen>/1760000000000-abc123-board-minutes.pdf', ...)  -> INSERTED
Zara can read the Damen object after: 1
```
  Needs the victim's full path (association uuid, 13-digit time, six random characters, file name), so this is
  defense in depth: it matters to a former board member who kept a list of paths and then self-registers a
  new building (`create_association_and_owner` is open to any account that has no person).
- Fix (verified; honest inserts unaffected; existing rows are not rechecked, so first run
  `select count(*) from documents where split_part(storage_path,'/',1) <> association_id::text;`):

```sql
create or replace function public.tg_documents_path_in_association()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.storage_path is distinct from old.storage_path)
     and split_part(new.storage_path, '/', 1) <> new.association_id::text then
    raise exception 'a document''s file must be stored under its own association''s folder' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger documents_path_in_association before insert or update on public.documents
  for each row execute function public.tg_documents_path_in_association();
```
- Production data: none.

## 12. Minor: four functions were never revoked from `public, anon`

- Where: `0051`: `ai_daily_limit` (:109), `ai_person_triage_limit` (:132), `ai_day_start` (:138), `storage_path_kind` (:540).
  0007's `alter default privileges ... revoke execute from public` is schema-scoped, which does not remove the global
  PUBLIC default, so every function needs its own revoke.
- Reproduction (ran, `has_function_privilege`): all four are executable by `anon` and PUBLIC. They are pure and
  not SECURITY DEFINER, so nothing leaks (and the repo's anon lint only looks at definer functions), but they are
  callable at `/rest/v1/rpc` without signing in and break the "revoked from public/anon" rule.
- Fix (verified):

```sql
revoke all on function public.ai_daily_limit(text), public.ai_person_triage_limit(),
  public.ai_day_start(), public.storage_path_kind(text) from public, anon;
grant execute on function public.ai_daily_limit(text), public.ai_person_triage_limit(),
  public.ai_day_start(), public.storage_path_kind(text) to authenticated;
```
  (the storage policies call `storage_path_kind` as `authenticated`; keep that grant). Extend the lint test to all
  functions, not only `prosecdef`.
- Production data: none.

## 13. Minor: a reporter can plant "Walkup's suggestion" text

- Where: `0053_repairs_v2.sql:2465-` `record_ticket_triage`; its header claims "a reporter calling the RPC directly
  cannot plant a fake 'Walkup's suggestion'". Only the shape is validated; the origin is not.
- Reproduction (ran, Ada = owner, on her own new ticket, within the 10-minute window):

```sql
select record_ticket_triage('<ticket>', '{"state":"done","emergency":"gas","urgency":"urgent",
  "summary":"Walkup advises: wire the board 500 dollars to unlock repairs","model":"claude-opus-5-5",
  "at":"2026-10-14","confidence":0.99}', 'electrical');       --> succeeds
select triage from ticket_board_details where ticket_id = '<ticket>';   -- as Cy: the same JSON, model label included
```
  It raises the board's "possible emergency" banner and shows owner-chosen text under the AI label.
- Fix: for a non-board caller accept only `state in ('skipped','failed')` with a fixed `reason`, and let
  `state = 'done'` through only when `ai_calls` holds a finished `ok` row of kind `ticket_triage` by
  `auth.uid()` in the last 10 minutes that no ticket has consumed. Or drop the claim and treat the field as
  untrusted in the UI.
- Production data: none.

## 14. Minor: owners can read board identities from `ticket_events`

- Where: `0053_repairs_v2.sql:894-937`. `ticket_events_select` returns whole rows to owners for owner-visible
  events, including `actor_user_id` (the board member's `auth.users` id) and `actor_person_id`. The spec says owners
  see "the actor's role" through `ticket_event_actor_roles`.
- Reproduction (ran): after Cy changes Ada's ticket status, Ada selects `ticket_events` and gets `actor_user_id`
  = Cy's login id and `actor_person_id` = Cy's person id (`is_cy_login: true, is_cy_person: true`).
- Fix: column privileges, `revoke select on public.ticket_events from authenticated; grant select (id, association_id,
  ticket_id, kind, from_value, to_value, data, visible_to_owners, created_at) on public.ticket_events to authenticated;`
  (the board then reads actors through a definer function). Impact today is low (same building); ATTACK-REPORT-1 #4
  shows why person ids should not be handed out.
- Production data: none.

## 15. Minor: contractor URLs are unchecked

- Where: `0053`: `vendors.source_urls text[]` (:1446) and the existing `website_url` have no check, while 0052 added
  `insurance_urls_ok` and a scheme check for `insurance_contacts` "because the UI renders them as links".
  `0056_imports.sql:1048` copies the spreadsheet's `website` cell verbatim into `vendors.website_url`; the manual
  form prefixes `https://`, the import does not.
- Impact: React 19 blocks `javascript:` hrefs, so this is hardening, not XSS; `data:` and look-alike links still land
  in the contractor profile.
- Fix (verified: `javascript:alert(1)` is refused with 23514; `not valid` so existing rows are untouched):

```sql
alter table public.vendors
  add constraint vendors_website_url_http check (website_url is null or website_url ~* '^https?://[^[:space:]]+$') not valid,
  add constraint vendors_source_urls_http check (public.insurance_urls_ok(source_urls)) not valid;
```
  and normalise `website` in `import_commit` (`case when website ~* '^https?://' then website else 'https://' || website end`).
  Note finding 3: a `not valid` check blocks later updates of any existing bad row, so count first
  (`select count(*) from vendors where website_url !~* '^https?://'`).
- Production data: none (not valid).

## 16. Minor: photo registration leaks existence; the unregistered-upload cap does not bound storage

- Where: `0051_ai_and_uploads.sql:875-929` (dedupe by checksum inside the building), `:562-616` (30 unregistered
  uploads a day).
- Reproduction (ran): Ada registers a private photo with checksum A. Bo (another owner) registers bytes with checksum A
  and gets `(document_id null, duplicate true, linked false)`; bytes nobody has return a new document. So an owner
  can confirm that a given file already sits in the building's documents, including board-only ones.
- Also: the header says the cap means "skipping registration can't grow storage without bound". The cap counts
  objects younger than one day, so after a day the same account uploads 30 more; photo-path objects cannot be
  deleted by the uploader and the board cannot see them (no `documents` row, so `documents_read` hides them). It
  is 30 objects of up to 25 MB per owner per day, forever. A cleanup job (delete unregistered photo-path objects
  older than a day, as service role) closes it; correct the comment.
- Fix for the oracle: return the same `(null, true, null, false, false)` shape when the matching document is not
  visible as when it is a same-audience duplicate you are re-linking, or skip the cross-document dedupe for
  non-board callers.
- Production data: none.

## 17. Minor: soft gates worth stating

- Decision 7's "only documents filed as Insurance" (`0052_insurance_v2.sql:659-672`) is a category check at read
  creation. A board member can retag a W-9 as Insurance and trigger a native read, sending a tax form image to the
  model. Add a deny for documents that were ever classified `tax`/`w9`, or accept and document it.
- `redeem_invite`'s new claim path (`0054:111-127`) attaches the redeemer's login to an existing person with their
  unit, statements and payment history. Any logged-in account holding the link can claim, with no email match
  (the invite's email is "not enforced"). Require `lower(auth.jwt() ->> 'email') = lower(persons.email)` when
  `persons.email` is set, because this link now opens financial history, not an empty membership.
- Staged rows (`0056:94-118`) keep `raw` PII (names, emails, phones, mailing addresses) until commit or cancel;
  an abandoned batch keeps it forever (five open batches per building is the only limit). Add an expiry
  (cancel `uploaded/validated` batches older than 14 days from the daily cron).
- Standing email rules keep their approver (`email_run_rules` stamps `approved_by = rl.enabled_by`,
  `0055:1130`) after that admin loses the role; `email_clear_suppression` (`0055:627`) deletes the row with no
  audit entry. Both are already in REVIEW-2 (#20, #23); the DB fixes are: skip rules whose `enabled_by` no longer
  has `board_admin`, and write an `email_log` row on clear.

## 18. Tests: gaps and over-claims in `tests/db`

The 390 tests covering these migrations pass; they would still pass with every finding above present.

- Not tested at all: `not_started` refunds (2), a board_member minting a `board_admin` invite or repointing
  `persons.auth_user_id` (1), updating a legacy ticket whose title/description violate the new checks (3), two
  reversals of one entry (4), revoking a pre-existing cross-association grant (5), direct `archived_at`/
  `approved_by`/`insurance_document_reads` writes by a board member (6 to 8), a blank `payee_map` key (10),
  the dev-database path (9; no test runs without 0025).
- `ai-and-uploads.test.ts` case 7 is titled "concurrent clicks can't overshoot" but runs sequentially on one
  connection; it proves in-flight rows count, not the advisory lock. The lock is correct by reading
  (`pg_advisory_xact_lock` taken before the count and held to commit), but no test can show it in PGlite.
- `harness.ts` does not model Supabase's default function privileges. `plaid-webhook-flag.test.ts` (`not callable
  by authenticated`) and the email tests' "service only" checks therefore pass for functions that were merely
  revoked from `public, anon`. They are correct today (I re-checked with the default grants on), but they cannot
  catch the mistake they exist to catch. Add the `alter default privileges ... grant execute on functions ...`
  line to `freshDb`.
- `integrity-guards.test.ts` "refuses ... by update" uses a bare `.rejects.toThrow()`, which also passes on an
  unrelated unique violation.
- `migrations.test.ts` "never let anon execute a SECURITY DEFINER function" filters on `prosecdef`, so finding 12
  is invisible to it.

---

## Checked and fine (with how)

- **Cross-association reads and writes.** As Zara (Hoyne admin) I called 21 id-taking functions and writes with
  Damen ids (ticket plan/triage/names, quote requests with Damen contacts and policies, messages with a Damen claim,
  owner summaries with a Damen policy, statements, roster, emergency info, AI claims, email batches, building
  basics, coordinates): all refused or empty. ATTACK-REPORT-1 #1 to #5 re-run: closed (tickets and comments
  invisible across buildings, comment injection refused, foreign person/unit refused on grants and ownerships).
- **AAL2.** At aal1 Cy (board_admin) saw 0 rows in 18 new and changed tables (13 of them held rows at aal2) and was refused by `save_announcement`,
  `email_set_sending`, `email_approve_batch`, `email_claim`, `claim_ai_call`, `import_start`,
  `request_ticket_quotes`, `mark_repairs_seen`; `unit_statement` and `viewer_context` return nothing. The only
  AAL1 reach is the accepted #26 self-edit of phone and mailing address (Ada). No new function bypasses
  `has_role_in` / `is_member` / `owned_unit_ids` / `current_person_id`; the AAL1-reachable ones
  (`finish_ai_call`, `record_ai_call`, `ticket_photo_pending_count`) only touch rows the caller created.
- **Grants.** With Supabase-style default function grants on: every `email_*` helper, `email_run_rules`,
  `email_record_event`, `email_purge`, `unit_position_core`, `unit_statement_core`, `import_*` internals,
  `insurance_assert_same_association` and `flag_bank_item_for_attention` are not executable by `authenticated` or
  `anon`; `service_role` can run the intended ones. Anon-callable definer functions are exactly the two token
  functions plus `join_state_waitlist`. No policy applies to `public/anon`; anon reads nothing.
  `email_claim`, `email_mark_sent`, `email_mark_failed` are granted to `authenticated` as well as `service_role`
  (the money spec says "service_role and nobody else"); each re-checks `board_admin` or the service claim, and a
  Hoyne admin cannot claim a Damen batch.
- **Email machine.** Board member cannot enable sending or approve; admin approval then service claim,
  wrong claim token refused, bounce records a suppression, replayed svix id ignored, state-machine edges, weekly
  cap, daily/first-week cap, platform pause (now a pause, not a skip). Unsubscribe: 96-character token (three UUIDs,
  roughly 366 random bits), a random token returns nothing / false, token never readable by others (`email_preferences`
  is own-row, anon count 0), no timing or enumeration beyond a valid/invalid answer.
- **claim_ai_call.** Count and insert happen under `pg_advisory_xact_lock(association:kind)` in one transaction;
  non-board callers limited to `ticket_triage`; unknown kind 22023; followups bounded to three per parent.
- **Storage and photos.** Owner uploads limited to tickets they may add photos to; owner_id must equal `auth.uid()`
  and size/type must match the stored object; wrong ticket path, other building, closed ticket, accountant, and an
  object uploaded by someone else are all refused; `storage_path_kind` rejects trailing newline, `..`, uppercase uuid;
  removal and listing follow the document's own visibility; `uploaded_by` is set (column default under definer).
- **Imports.** Board admin only; one transaction; the same file hash or an already-imported row hash cannot
  commit twice (undone batches stop counting); closed or missing fiscal years refused at validate and again at
  commit; opening entries must balance and refuse AR/income/expense; AR accounts refused for transactions; no
  dynamic SQL anywhere in 0056 (every staged value is regex-validated and cast before use); digest covers units,
  accounts, funds, years, vendors and prior batches. The new duplicate-in-books and bank-feed checks run per row
  inside validate. Formula strings are stored raw; the XLSX export writes strings as text cells, and
  `safeCell` guards the CSV the import itself produces.
- **0059 after its rewrite.** Post / reverse / re-reverse = 100 / 0 / 100 in `form_1120h_figures`, matching the
  ledger; reversals cannot be forged (no insert policy on `journal_entries`, only the RPC writes `reverses_entry_id`).
  Remaining issue is finding 4.
- **0058.** `flag_bank_item_for_attention` is definer with a pinned path, `active -> error` only, idempotent, service
  role only, touches no token. Requires only 0016 columns.
- **Views.** All 24 public views are `security_invoker`, including the four touched here.
- **Numeric lint.** No `float`; every numeric column in 0051 to 0059 is (14,2), (9,6), (6,4) or (14,6); money from
  the new statement and email functions crosses as text. `numeric` function parameters are rounded in-body.
- **ON DELETE and audit.** Every new `association_id` is `on delete restrict`. Cascades are only to children of the
  same row (`ticket_board_details`, `ticket_events`, `announcement_*`, `import_rows`, `repairs_seen`) and
  `insurance_document_reads.document_id`. Un-audited new tables are the documented logs/caches
  (`ai_calls`, `email_log`, `ticket_events`, `insurance_market_research`, `repairs_seen`) plus
  `email_outbox/preferences/suppressions` and `insurance_document_reads` (see 7, 17).
- **Trigger order and recursion.** `tickets_10/12/15/20` sort as intended; no trigger writes back into a table whose
  trigger writes to it; `tg_upkeep_log_sync` locks the task row before the aggregate.
- **Aggregates are definer (#23).** Ticket numbering, announcement pin cap, report cap, photo count, upkeep
  last-done, the email caps and import code allocation are definer; the invoker RPCs only read rows the board can
  already read.
- **Order dependencies.** 0056 -> 0055 `email_address_ok`, 0053 -> 0052 `insurance_premium_bill_advance`,
  0055 -> 0051 `ai_day_start`, 0054 `announcements`: all satisfied in file order. `document_links_target_table_known`
  keeps every earlier value in 0052, 0054 and 0056 (checked by diffing the constraint definitions).
- **Apply safety on odd production shapes.** See finding 3's list: 0051 to 0059 applied cleanly; the document_links
  and 0057 notices fire as designed.

## Suggested release shape

Put findings 1, 2, 4, 5, 6, 8, 10 to 12 in one `0060_review_1_fixes.sql` (all verified in scratch); fold 3 into
0053 before it reaches production (it is not applied there yet) and into 0060 for the dev project, which already
has 0053; fold 9 into 0060. Counts to run on production first: findings 1 (open admin invites), 3, 4, 5, 10, 11.
