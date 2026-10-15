-- scripts/security/cleanup-round2.sql
--
-- Removes everything attack-round2.mjs and its seeding step created on the
-- `security-test` branch (ref brwauxmdjgfrdqfbgezg). Run via the Supabase
-- MCP `execute_sql` tool (as `postgres`), not through PostgREST — several
-- of these tables have no DELETE policy for any application role by
-- design (role_grants has none at all; see scripts/security/README.md's
-- "trap" section from round 1). `postgres` bypasses RLS entirely, so this
-- script can delete what the app itself never could.
--
-- Safe to re-run: every statement is scoped to the `sectest2-%` / round-2
-- fixture markers and is a no-op once those rows are gone.
--
-- Order matters: children before parents, respecting FKs.

begin;

-- 1. Round-2 attack fixtures (tickets, comments, insurance, email, imports,
--    documents, announcements, etc.) created by attack-round2.mjs. The
--    harness tags every row it creates with a SECTEST2- prefix in a human
--    visible text column so this script (and a human) can find them by
--    inspection, independent of whatever ids the run produced.

-- Tickets have several FK-referencing children with no ON DELETE CASCADE
-- (ticket_events, ticket_board_details, document_links, ticket_bids,
-- ticket_comments) -- a plain `delete from tickets` leaves them orphaned
-- mid-delete and the statement fails, which is exactly what made
-- attack-round2.mjs's own best-effort cleanup silently leave rows behind
-- across runs (see its header comment). Children first, in FK order.
delete from public.ticket_events where ticket_id in (select id from public.tickets where title like 'SECTEST2-%');
delete from public.ticket_comments where ticket_id in (select id from public.tickets where title like 'SECTEST2-%') or body like 'SECTEST2-%';
delete from public.ticket_board_details where ticket_id in (select id from public.tickets where title like 'SECTEST2-%');
delete from public.document_links dl
  using public.documents d
  where dl.document_id = d.id and d.filename like 'SECTEST2-%';
delete from public.document_links where target_table = 'tickets' and target_id in (select id from public.tickets where title like 'SECTEST2-%');
delete from public.ticket_bids where ticket_id in (select id from public.tickets where title like 'SECTEST2-%');
delete from public.documents where filename like 'SECTEST2-%';
delete from public.tickets where title like 'SECTEST2-%';
delete from public.announcements where title like 'SECTEST2-%';
delete from public.import_rows ir
  using public.import_batches ib
  where ir.batch_id = ib.id and ib.filename like 'SECTEST2-%';
delete from public.import_batches where filename like 'SECTEST2-%';
delete from public.email_outbox where board_note like 'SECTEST2-%';
-- attack-round2.mjs's own email_prepare_batch check creates and then
-- email_cancel_batch's one draft batch per run; narrowly scoped so this
-- can't reach a real batch (kind + status + both test buildings only).
delete from public.email_batches
 where kind = 'dues_reminder' and status in ('cancelled', 'draft')
   and association_id in ('1fe83774-17bb-4b91-bfad-f168707d7ce0', '508a5403-9cff-47a6-a833-3e92b2c74016')
   and id not in (select batch_id from public.email_outbox where batch_id is not null);

-- 2. role_grants: no DELETE policy for anyone (by design). Revoke via
--    UPDATE first (what the app itself does), then have postgres actually
--    remove the rows so a re-run of either suite starts clean. Scoped to
--    the three seeded persons below plus any stray grant the attack script
--    may have managed to insert for them during the escalation checks.
update public.role_grants
   set revoked_at = now()
 where revoked_at is null
   and person_id in (
     select id from public.persons where email like 'sectest2-%@staging-walkup.example'
   );
delete from public.role_grants
 where person_id in (
   select id from public.persons where email like 'sectest2-%@staging-walkup.example'
 );

-- 2b. email_preferences rows (board_member's `set_my_email_preferences`
--     sanity check in section 5 creates one via email_ensure_preferences).
delete from public.email_preferences
 where person_id in (
   select id from public.persons where email like 'sectest2-%@staging-walkup.example'
 );

-- 3. invites created or redeemed during the escalation checks.
delete from public.invites
 where created_by in (
   select auth_user_id from public.persons where email like 'sectest2-%@staging-walkup.example'
 )
 or email like 'sectest2-%@staging-walkup.example';

-- 4. The three seeded persons.
delete from public.persons where email like 'sectest2-%@staging-walkup.example';

-- 5. Auth identities and users for the three seeded throwaway accounts.
delete from auth.identities where identity_data ->> 'email' like 'sectest2-%@staging-walkup.example';
delete from auth.mfa_factors where user_id in (
  select id from auth.users where email like 'sectest2-%@staging-walkup.example'
);
delete from auth.refresh_tokens where user_id in (
  select id::text from auth.users where email like 'sectest2-%@staging-walkup.example'
);
delete from auth.sessions where user_id in (
  select id from auth.users where email like 'sectest2-%@staging-walkup.example'
);
delete from auth.users where email like 'sectest2-%@staging-walkup.example';

-- 6. Leftover TOTP factors on the original three accounts, in case a run
--    of attack-round2.mjs was interrupted before its own cleanup ran
--    (same shape as attack-rls.mjs's own factor cleanup).
delete from auth.mfa_factors
 where friendly_name like 'security-test-%'
   and status <> 'verified';

-- 7. Safety net for the one vendor the imports check creates when the seed
--    has none (section 6, "record_expense accepts a vendor_id from another
--    building") -- the script deletes it itself as the legitimate
--    board_admin right after the check, but this covers an interrupted run.
delete from public.vendors where name = 'SECTEST2 Cross-Vendor Fixture';

-- NOT cleaned up, by design: the two posted journal entries attack-round2.mjs
-- creates when a building has none (section 9, "ensurePostedEntry", memo
-- 'SECTEST2-r2-fixture-A'/'-B') so the reversal checks have something real
-- to target. journal_entries/journal_lines are immutable once posted (0003's
-- tg_entry_immutable/tg_line_immutable forbid UPDATE and DELETE to everyone,
-- including postgres) -- the only way to remove their effect is the same
-- reversal the app itself uses, which the script already does for the
-- Building A fixture (reverses it, then reverses that reversal, netting to
-- zero) as part of the double-reversal check. The Building B fixture is left
-- posted and unreversed on purpose (so "adminA reverses Building B's entry"
-- has a real row to be refused against); it nets to a $0.01 debit/credit
-- pair with no further effect, and the whole branch is deleted after this
-- test per docs/security/STAGING.md, so it never needs to be cleaned up on
-- its own. A human re-running this on a kept branch can reverse it by hand:
--   select reverse_journal_entry(id) from journal_entries
--    where memo = 'SECTEST2-r2-fixture-B' and is_posted and reverses_entry_id is null;

commit;

-- Verification: every count below should be 0 after this script runs.
select
  (select count(*) from public.persons where email like 'sectest2-%@staging-walkup.example') as leftover_persons,
  (select count(*) from auth.users where email like 'sectest2-%@staging-walkup.example') as leftover_users,
  (select count(*) from public.role_grants rg join public.persons p on p.id = rg.person_id where p.email like 'sectest2-%@staging-walkup.example') as leftover_grants,
  (select count(*) from public.tickets where title like 'SECTEST2-%') as leftover_tickets,
  (select count(*) from public.documents where filename like 'SECTEST2-%') as leftover_documents,
  (select count(*) from public.announcements where title like 'SECTEST2-%') as leftover_announcements,
  (select count(*) from public.import_batches where filename like 'SECTEST2-%') as leftover_imports,
  (select count(*) from public.email_outbox where board_note like 'SECTEST2-%') as leftover_email;
