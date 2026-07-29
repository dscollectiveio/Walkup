-- ============================================================================
-- Walkup — migration 0002: row-level security
--
-- Authorization lives here, in the database, not in the application. A bug in
-- a React component must not be able to disclose a neighbour's delinquency.
--
-- Three things about the shape of this file:
--
-- 1. Roles are GRANTS, not a column. One person commonly holds several — in a
--    self-managed building every board member is also an owner. Every check
--    therefore asks "does this person hold ANY role permitting this", and the
--    permissive role wins. (DECISIONS #6)
--
-- 2. The ledger and the money tables get NO write policies at all. Not for
--    board_admin, not for anyone. Every write goes through post_journal_entry()
--    in 0003, which is SECURITY DEFINER and therefore not subject to these
--    policies. That makes "all ledger writes go through the RPC" a structural
--    fact rather than a convention someone can forget. (DECISIONS #5)
--
-- 3. Owners cannot read the ledger, only their own charges and payments. Raw
--    journal lines carry unit_id and would expose every other unit's activity.
-- ============================================================================

-- ============================================================================
-- HELPERS
-- ============================================================================
-- All SECURITY DEFINER, all with search_path pinned empty and every reference
-- schema-qualified. An unpinned search_path on a definer function lets a caller
-- shadow a table name and have the function operate on theirs instead — it is a
-- privilege escalation vector and Supabase's own linter flags it.
-- (CLAUDE.md invariant 11.)

create or replace function public.has_role_in(assoc uuid, roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.role_grants g
      join public.persons p on p.id = g.person_id
     where p.auth_user_id = auth.uid()
       and g.association_id = assoc
       and g.role = any(roles)
       and g.revoked_at is null
       -- Grants expire. An expired grant is no grant: the accountant who
       -- helped with last year's return does not still have the books.
       and (g.expires_on is null or g.expires_on >= current_date)
  )
$$;

create or replace function public.is_board(assoc uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_role_in(assoc, array['board_admin','board_member']::public.app_role[])
$$;

-- Board plus accountant: everyone entitled to see the association's finances
-- in full.
create or replace function public.can_read_financials(assoc uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_role_in(
    assoc, array['board_admin','board_member','accountant']::public.app_role[])
$$;

create or replace function public.is_member(assoc uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_role_in(
    assoc, array['board_admin','board_member','accountant','owner']::public.app_role[])
$$;

-- The units this caller owns in this association, as of today.
create or replace function public.owned_unit_ids(assoc uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select uo.unit_id
    from public.unit_owners uo
    join public.persons p on p.id = uo.person_id
   where p.auth_user_id = auth.uid()
     and uo.association_id = assoc
     and (uo.effective_to is null or uo.effective_to >= current_date)
$$;

create or replace function public.current_person_id(assoc uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.id
    from public.persons p
   where p.auth_user_id = auth.uid()
     and p.association_id = assoc
   limit 1
$$;

revoke all on function
  public.has_role_in(uuid, public.app_role[]),
  public.is_board(uuid),
  public.can_read_financials(uuid),
  public.is_member(uuid),
  public.owned_unit_ids(uuid),
  public.current_person_id(uuid)
from public, anon;

grant execute on function
  public.has_role_in(uuid, public.app_role[]),
  public.is_board(uuid),
  public.can_read_financials(uuid),
  public.is_member(uuid),
  public.owned_unit_ids(uuid),
  public.current_person_id(uuid)
to authenticated;

-- ============================================================================
-- ENABLE RLS EVERYWHERE
-- ============================================================================
-- Postgres denies by default once RLS is on and no policy matches, so enabling
-- it on a table nobody wrote a policy for fails closed. That is the safe
-- direction, and the test suite asserts no table in public is left without it.

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ============================================================================
-- ASSOCIATIONS
-- ============================================================================
-- Scoped by id rather than association_id, hence written out longhand.

create policy associations_select on public.associations
  for select to authenticated
  using (public.is_member(id) and deleted_at is null);

create policy associations_update on public.associations
  for update to authenticated
  using (public.has_role_in(id, array['board_admin']::public.app_role[]))
  with check (public.has_role_in(id, array['board_admin']::public.app_role[]));

-- No insert or delete policy. Associations are created by the onboarding flow
-- running as the service role, and are never hard-deleted (DECISIONS #8).

-- ============================================================================
-- CONFIGURATION TABLES
-- ============================================================================
-- Readable by everyone in the association including owners: the declaration,
-- the chart of accounts, the fiscal calendar and the budget are governance
-- documents, not private data. Writable by the board.

do $$
declare
  t text;
  config_tables text[] := array[
    'units', 'funds', 'accounts', 'fiscal_years',
    'budgets', 'budget_lines',
    'ownership_amendments', 'ownership_amendment_lines'
  ];
begin
  foreach t in array config_tables loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.is_member(association_id))',
      t || '_select', t);

    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.is_board(association_id))',
      t || '_insert', t);

    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_board(association_id))
         with check (public.is_board(association_id))',
      t || '_update', t);

    -- board_member has no delete anywhere. CLAUDE.md role table.
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.has_role_in(association_id, array[''board_admin'']::public.app_role[]))',
      t || '_delete', t);
  end loop;
end $$;

-- ============================================================================
-- FINANCIAL TABLES — BOARD AND ACCOUNTANT ONLY
-- ============================================================================
-- Owners get no visibility here. Vendor payment detail, expense memos and the
-- raw ledger are not part of "budgets and financial summaries".

do $$
declare
  t text;
  financial_tables text[] := array[
    'journal_entries', 'journal_lines',
    'vendors', 'expenses',
    'assessment_schedules', 'late_fee_rules',
    'tax_filings',
    'documents', 'document_links'
  ];
begin
  foreach t in array financial_tables loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.can_read_financials(association_id))',
      t || '_select', t);
  end loop;
end $$;

-- Vendors, schedules, rules and documents are configuration the board edits
-- directly. The ledger is not — see the note at the top of this file.
do $$
declare
  t text;
  board_writable text[] := array[
    'vendors', 'assessment_schedules', 'late_fee_rules', 'documents', 'document_links'
  ];
begin
  foreach t in array board_writable loop
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.is_board(association_id))',
      t || '_insert', t);

    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_board(association_id))
         with check (public.is_board(association_id))',
      t || '_update', t);

    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.has_role_in(association_id, array[''board_admin'']::public.app_role[]))',
      t || '_delete', t);
  end loop;
end $$;

-- journal_entries, journal_lines, expenses and tax_filings deliberately have
-- SELECT policies and nothing else. They are written only by SECURITY DEFINER
-- functions.

-- ============================================================================
-- OWNER-SCOPED TABLES
-- ============================================================================
-- The heart of it. An owner sees their own units and no others; board and
-- accountant see everything. Because roles are grants, a board_admin who also
-- owns unit 3 matches the first branch and sees all of it.

create policy assessment_charges_select on public.assessment_charges
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or unit_id in (select public.owned_unit_ids(association_id))
  );

create policy payments_select on public.payments
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or unit_id in (select public.owned_unit_ids(association_id))
  );

create policy payment_allocations_select on public.payment_allocations
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or exists (
      select 1 from public.assessment_charges c
       where c.id = charge_id
         and c.unit_id in (select public.owned_unit_ids(c.association_id))
    )
  );

create policy unit_owners_select on public.unit_owners
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or unit_id in (select public.owned_unit_ids(association_id))
  );

create policy unit_owners_insert on public.unit_owners
  for insert to authenticated
  with check (public.is_board(association_id));

create policy unit_owners_update on public.unit_owners
  for update to authenticated
  using (public.is_board(association_id))
  with check (public.is_board(association_id));

-- ============================================================================
-- PEOPLE AND ROLE GRANTS
-- ============================================================================
-- An owner sees themselves. They do not get a directory of their neighbours'
-- email addresses and mailing addresses.

create policy persons_select on public.persons
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or auth_user_id = auth.uid()
  );

create policy persons_insert on public.persons
  for insert to authenticated
  with check (public.is_board(association_id));

create policy persons_update on public.persons
  for update to authenticated
  using (
    public.is_board(association_id)
    or auth_user_id = auth.uid()   -- own contact details
  )
  with check (
    public.is_board(association_id)
    or auth_user_id = auth.uid()
  );

-- Who has access to the books is board business. Granting and revoking is
-- board_admin only, and both are audited in 0004.
create policy role_grants_select on public.role_grants
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or person_id = public.current_person_id(association_id)
  );

create policy role_grants_insert on public.role_grants
  for insert to authenticated
  with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create policy role_grants_update on public.role_grants
  for update to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]))
  with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

-- No delete policy: grants are revoked by setting revoked_at, never removed,
-- so that "who could see the books last March" remains answerable.

-- ============================================================================
-- TAX PARAMETERS
-- ============================================================================
-- Global reference data. Every authenticated user may read the rates their
-- return was computed from — that is the point of storing them with a source
-- URL. Nobody may write them through the API; they arrive by migration.
--
-- Without RLS this table would be world-writable through PostgREST, which for
-- a table of tax rates is not acceptable.

create policy tax_parameters_select on public.tax_parameters
  for select to authenticated
  using (true);

-- ============================================================================
-- AUDIT LOG
-- ============================================================================
-- Readable by board_admin. Insert happens through the SECURITY DEFINER trigger
-- in 0004.
--
-- There is deliberately no UPDATE policy and no DELETE policy, for any role,
-- ever. An audit log that board_admin can edit is not an audit log.

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));
