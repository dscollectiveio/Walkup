-- ============================================================================
-- Walkup — migration 0060: hardening from the migration review (REVIEW-1)
--
-- WHY. docs/security/REVIEW-1-migrations.md found problems in objects that
-- 0001 to 0050 created and that are live in production. Those migrations are
-- applied and are never edited, so the fixes live here. (The findings about
-- objects that only exist in 0051 to 0059, which are unreleased, were made in
-- those files; docs/specs/progress/FX1-db-fixes.md lists every finding.)
--
-- WHAT.
--   1. invites_insert (0027, finding 1a): a board_member could mint a
--      board_admin invite and hand the link to any account. Now a board_admin
--      may invite any role; a board_member may invite owners only.
--      (The other half of finding 1, a board_member repointing a person's
--      login, is closed by tg_persons_self_edit_guard in 0054.)
--   2. reverse_journal_entry (0036, finding 4): the entry is now locked while
--      the "already reversed" check and the insert run, and a unique partial
--      index on reverses_entry_id makes a second direct reversal of the same
--      entry impossible even for a writer that skips the function. A reversal
--      of a reversal still works (0059's parity rule counts that chain).
--   3. expenses.vendor_id (0001, finding 10): a trigger refuses a contractor
--      from another association, on insert and when vendor_id changes.
--   4. documents.storage_path (0001/0020, finding 11): the first folder of a
--      stored path must be the document's own association, on insert and when
--      the path changes.
--   5. Three older functions (bank_payee_key, tg_tax_filing_immutable,
--      tg_vendors_status_sync) revoked from public and anon (finding 12).
--
-- SAFETY ON APPLY. Policies and function bodies only, plus two triggers that
-- look at new writes. Nothing is rewritten. The unique index is created ONLY
-- when no entry has two reversals; otherwise a NOTICE says so and how to
-- resolve it, and the migration still succeeds (the lock in the function still
-- prevents new duplicates). Three informational notices count existing rows
-- that the new rules would have refused.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Invites: roles at or above board_admin need a board_admin
-- ----------------------------------------------------------------------------

drop policy invites_insert on public.invites;
create policy invites_insert on public.invites
  for insert to authenticated
  with check (
    public.has_role_in(association_id, array['board_admin']::public.app_role[])
    or (public.is_board(association_id) and role = 'owner')
  );

-- ----------------------------------------------------------------------------
-- 2. One reversal per entry
-- ----------------------------------------------------------------------------

create or replace function public.reverse_journal_entry(p_entry_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  e     public.journal_entries%rowtype;
  v_new uuid;
begin
  -- FOR UPDATE: two people reversing the same entry at once queue here, and
  -- the second sees the first one's reversal below.
  select * into e from public.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'journal entry not found';
  end if;
  if not public.is_board(e.association_id) then
    raise exception 'not authorized to reverse entries for this association'
      using errcode = '42501';
  end if;
  if not e.is_posted then
    raise exception 'only a posted entry can be reversed';
  end if;
  if exists (select 1 from public.journal_entries where reverses_entry_id = e.id) then
    raise exception 'this entry has already been reversed';
  end if;

  -- Same date and fiscal year as the original, so the pair nets to zero in
  -- the period the mistake was made, not the period it was noticed.
  -- Unposted first, then lines, then post — journal_lines_immutable only
  -- permits line inserts against an unposted entry (0003).
  insert into public.journal_entries (
    association_id, fiscal_year_id, entry_date, memo, source, source_id,
    reverses_entry_id, is_posted, created_by
  ) values (
    e.association_id, e.fiscal_year_id, e.entry_date,
    'Reversal: ' || coalesce(e.memo, ''), 'reversal', e.source_id,
    e.id, false, auth.uid()
  ) returning id into v_new;

  insert into public.journal_lines (
    association_id, journal_entry_id, account_id, fund_id, unit_id, debit, credit, line_memo
  )
  select association_id, v_new, account_id, fund_id, unit_id, credit, debit, line_memo
    from public.journal_lines
   where journal_entry_id = e.id;

  update public.journal_entries
     set is_posted = true, posted_at = now(), posted_by = auth.uid()
   where id = v_new;

  return v_new;
end $$;

revoke all on function public.reverse_journal_entry(uuid) from public, anon;
grant execute on function public.reverse_journal_entry(uuid) to authenticated;

-- The index cannot be created if an entry already has two reversals (the
-- function allowed a race since 0036). Those would have to be looked at by
-- hand, so this never fails the migration.
do $$
declare
  v_dupes integer;
begin
  select count(*) into v_dupes from (
    select reverses_entry_id from public.journal_entries
     where reverses_entry_id is not null
     group by reverses_entry_id having count(*) > 1
  ) d;
  if v_dupes = 0 then
    create unique index if not exists journal_entries_one_reversal
      on public.journal_entries (reverses_entry_id) where reverses_entry_id is not null;
  else
    raise notice 'journal_entries_one_reversal NOT created: % entries have more than one reversal. Find them with: select reverses_entry_id, count(*) from public.journal_entries where reverses_entry_id is not null group by 1 having count(*) > 1; reverse the extra reversals (post the entry again, or reverse the duplicate so the chain is linear), then run: create unique index journal_entries_one_reversal on public.journal_entries (reverses_entry_id) where reverses_entry_id is not null;', v_dupes;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. An expense can only name a contractor of its own association
-- ----------------------------------------------------------------------------

create or replace function public.tg_expenses_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.vendor_id is not null
     and (tg_op = 'INSERT' or new.vendor_id is distinct from old.vendor_id) then
    if not exists (
      select 1 from public.vendors v
       where v.id = new.vendor_id and v.association_id = new.association_id
    ) then
      raise exception 'contractor belongs to a different association' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.tg_expenses_same_association() from public, anon;
grant execute on function public.tg_expenses_same_association() to authenticated;   -- 0043 convention for trigger functions

create trigger expenses_same_association
  before insert or update on public.expenses
  for each row execute function public.tg_expenses_same_association();

-- ----------------------------------------------------------------------------
-- 4. A document's file lives under its own association's folder
-- ----------------------------------------------------------------------------

create or replace function public.tg_documents_path_in_association()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.storage_path is distinct from old.storage_path)
     and split_part(new.storage_path, '/', 1) <> new.association_id::text then
    raise exception 'a document''s file must be stored under its own association''s folder'
      using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_documents_path_in_association() from public, anon;
grant execute on function public.tg_documents_path_in_association() to authenticated;   -- 0043 convention for trigger functions

create trigger documents_path_in_association
  before insert or update on public.documents
  for each row execute function public.tg_documents_path_in_association();

-- ----------------------------------------------------------------------------
-- 5. Three older functions that were never revoked from public and anon
--    (found by widening the anon lint from SECURITY DEFINER to every function,
--    REVIEW-1 #12). bank_payee_key is pure; the other two are trigger
--    functions. None leaks anything, but none should answer /rest/v1/rpc.
-- ----------------------------------------------------------------------------

revoke all on function public.bank_payee_key(text) from public, anon;
grant execute on function public.bank_payee_key(text) to authenticated;
revoke all on function public.tg_tax_filing_immutable() from public, anon;
grant execute on function public.tg_tax_filing_immutable() to authenticated;   -- 0043 convention for trigger functions
revoke all on function public.tg_vendors_status_sync() from public, anon;
grant execute on function public.tg_vendors_status_sync() to authenticated;   -- 0043 convention for trigger functions

-- ----------------------------------------------------------------------------
-- Existing rows the new rules would have refused. Informational: nothing is
-- changed. Look at any non-zero count by hand.
-- ----------------------------------------------------------------------------
do $$
declare
  v_invites   integer;
  v_expenses  integer;
  v_documents integer;
begin
  select count(*) into v_invites from public.invites
   where role in ('board_admin', 'board_member') and redeemed_at is null and expires_at > now();
  select count(*) into v_expenses
    from public.expenses e join public.vendors v on v.id = e.vendor_id
   where v.association_id <> e.association_id;
  select count(*) into v_documents from public.documents
   where split_part(storage_path, '/', 1) <> association_id::text;
  if v_invites > 0 or v_expenses > 0 or v_documents > 0 then
    raise notice 'review before relying on 0060: open board_admin/board_member invites %, expenses naming another association''s contractor %, documents stored outside their association''s folder %',
      v_invites, v_expenses, v_documents;
  end if;
end $$;
