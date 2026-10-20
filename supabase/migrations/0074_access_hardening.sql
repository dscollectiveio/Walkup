-- 0074: access hardening, step 1 of the access plan (docs/specs/access-audit-2026-10-20.md).
--
--   1. Invites for an existing person: a board member can no longer send one for a person who holds
--      any role other than owner (it would hand that role to whoever redeems it).
--   2. Documents: only governing documents, minutes and financial statements can be made visible to
--      all owners; the accountant sees accounting and tax records (plus what every member sees),
--      not the board's legal notices, contracts or correspondence.
--   3. Upkeep: owners and the other non-financial members read the schedule and history through
--      member views that leave out estimates, costs and contractors.

-- ----------------------------------------------------------------------------
-- 1. Invites for an existing person
-- ----------------------------------------------------------------------------

create or replace function public.tg_invite_person_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.person_id is not null then
    if not exists (
      select 1 from public.persons p
       where p.id = new.person_id and p.association_id = new.association_id
    ) then
      raise exception 'person belongs to a different association' using errcode = '42501';
    end if;
    if new.role <> 'owner' then
      raise exception 'an invite for an existing person can only grant the owner role'
        using errcode = 'check_violation';
    end if;
    -- A board member can edit a person's email, so an invite for someone who is already (or is about
    -- to be) a board admin, board member or accountant would give the redeemer that role. Only an
    -- admin sends those.
    -- (this function is a definer, so current_user is its owner: the caller is told apart by the login in the request)
    if auth.uid() is not null
       and not public.has_role_in(new.association_id, array['board_admin']::public.app_role[])
       and exists (
         select 1 from public.role_grants g
          where g.person_id = new.person_id
            and g.association_id = new.association_id
            and g.role <> 'owner'
            and g.revoked_at is null
            and (g.expires_on is null or g.expires_on >= current_date)
       ) then
      raise exception 'only a board admin can invite someone who already holds a board or accountant role'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Documents
-- ----------------------------------------------------------------------------

-- The categories an owner may be shown without a unit pin.
create or replace function public.owner_shareable_category(p_category_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.document_categories c
     where c.id = p_category_id
       and c.slug in ('governing', 'minutes', 'financial_statement')
  )
$$;

-- The categories the accountant reads: accounting, tax, and the vendor paperwork the 1099s need.
create or replace function public.accountant_document_category(p_category_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.document_categories c
     where c.id = p_category_id
       and c.slug in ('financial_statement', 'tax_form', 'invoice', 'receipt', 'bank_statement', 'insurance', 'vendor_document')
  )
$$;

revoke all on function public.owner_shareable_category(uuid) from public, anon;
revoke all on function public.accountant_document_category(uuid) from public, anon;
grant execute on function public.owner_shareable_category(uuid) to authenticated;
grant execute on function public.accountant_document_category(uuid) to authenticated;

create or replace function public.tg_document_visibility_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Direct edits through the API only. The definer functions that file a shared-area problem's photos
  -- for all owners (0051, 0053) run as their owner and are not touched.
  if current_user in ('authenticated', 'anon')
     and new.visibility = 'all_owners'
     and new.restricted_to_unit_id is null
     and not public.owner_shareable_category(new.category_id)
     and (tg_op = 'INSERT'
          or new.visibility is distinct from old.visibility
          or new.category_id is distinct from old.category_id
          or new.restricted_to_unit_id is distinct from old.restricted_to_unit_id) then
    raise exception 'only governing documents, minutes and financial statements can be shared with all owners'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.tg_document_visibility_guard() from public, anon;
grant execute on function public.tg_document_visibility_guard() to authenticated;

drop trigger if exists documents_visibility_guard on public.documents;
create trigger documents_visibility_guard
  before insert or update on public.documents
  for each row execute function public.tg_document_visibility_guard();

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (
    public.is_board(association_id)
    or (
      deleted_at is null
      and public.has_role_in(association_id, array['accountant']::public.app_role[])
      and public.accountant_document_category(category_id)
    )
    or (
      deleted_at is null
      and (
        (
          restricted_to_unit_id is not null
          and restricted_to_unit_id in (select public.owned_unit_ids(association_id))
        )
        or (
          restricted_to_unit_id is null
          and visibility = 'all_owners'
          and public.is_member(association_id)
        )
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 3. Upkeep: money and contractors stay with the financial roles
-- ----------------------------------------------------------------------------

drop policy if exists upkeep_tasks_select on public.upkeep_tasks;
create policy upkeep_tasks_select on public.upkeep_tasks
  for select to authenticated using (public.can_read_financials(association_id));

drop policy if exists upkeep_log_select on public.upkeep_log;
create policy upkeep_log_select on public.upkeep_log
  for select to authenticated using (public.can_read_financials(association_id));

-- Definer views (not security_invoker) that apply their own member check, so a member who can't read
-- the tables still reads the calendar. Only the columns that are not money or contractors.
create or replace view public.upkeep_tasks_member as
  select t.id, t.association_id, t.name, t.description, t.interval_months, t.due_month,
         t.last_done_on, t.next_due_on, t.trade, t.is_active, t.created_at, t.updated_at
    from public.upkeep_tasks t
   where public.is_member(t.association_id);

create or replace view public.upkeep_log_member as
  select l.id, l.association_id, l.task_id, t.name as task_name, l.done_on, l.note, l.ticket_id, l.created_at
    from public.upkeep_log l
    join public.upkeep_tasks t on t.id = l.task_id
   where public.is_member(l.association_id);

revoke all on public.upkeep_tasks_member from public, anon;
revoke all on public.upkeep_log_member from public, anon;
grant select on public.upkeep_tasks_member to authenticated;
grant select on public.upkeep_log_member to authenticated;

comment on view public.upkeep_tasks_member is
  'The upkeep calendar for every member, without estimates or contractors (those are for board and accountant, through upkeep_tasks).';
comment on view public.upkeep_log_member is
  'Upkeep history for every member, without cost or contractor.';

-- ----------------------------------------------------------------------------
-- 4. The association's EIN moves out of the row every member can read
-- ----------------------------------------------------------------------------
-- associations_select is is_member, so an owner could read the EIN straight from the table. It now
-- lives in its own table: board and accountant read it, a board admin writes it.

create table public.association_tax_ids (
  association_id uuid primary key references public.associations(id) on delete restrict,
  ein            text,
  updated_at     timestamptz not null default now()
);

alter table public.association_tax_ids enable row level security;

create policy association_tax_ids_select on public.association_tax_ids
  for select to authenticated using (public.can_read_financials(association_id));
create policy association_tax_ids_insert on public.association_tax_ids
  for insert to authenticated with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));
create policy association_tax_ids_update on public.association_tax_ids
  for update to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]))
  with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create trigger audit_association_tax_ids after insert or update or delete on public.association_tax_ids
  for each row execute function public.tg_audit();

insert into public.association_tax_ids (association_id, ein)
select id, ein from public.associations where ein is not null;

alter table public.associations drop column ein;

comment on table public.association_tax_ids is
  'The association''s EIN, kept apart from associations so owners (who can read that row) cannot read it.';
