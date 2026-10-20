-- 0080: the three outside roles, step 2 (enum values are in 0077; docs/specs/access-audit-2026-10-20.md,
-- Round 2: "Outside roles (property manager login, attorney, observer): build now"; DECISIONS #43).
--
-- Who they are, and the deliberately small reach of each:
--
--   observer          A member (reads what an owner reads: announcements, the budget plan, the published
--                     insurance summary, documents shared with all owners, emergency info) plus the
--                     association's Finances summary page, whether or not the board switched that page on for
--                     owners (0079 owner_finances_enabled). Read only. Cannot report a problem.
--   property_manager  A management company for the whole building. A member plus, on REPAIRS only, the powers
--                     a board member has (problems, notes, photos, upkeep, quotes, visits; read contractors),
--                     and read access to units and people WITH contact details, to the documents in the
--                     maintenance, permit, vendor, contract, insurance and unit record categories, and to each
--                     unit's dues standing through manager_unit_standing(). No finance table, no statements,
--                     no bank feed, no taxes, no budget actuals, no announcements, no email.
--   attorney          A member plus the documents in the legal notice, contract and correspondence categories
--                     that a board admin shared with them (attorney_shares: one unit, or the whole building),
--                     and, for the units shared with them, the owners' contact details and the collections
--                     standing, through two narrow functions.
--
-- All three: invited by a board admin only (invites_insert, 0060, already requires an admin for any role but
-- owner), invites need the invitee's email and last 3 days (0075), the login must use that email (0075), the
-- grant must carry an end date (below) and is 90 days when it comes from an invite or from the role checkboxes,
-- MFA applies to everyone (has_role_in), and the daily deprovision_stale_access() already stamps any role
-- whose expires_on has passed. None of them can approve email, change roles, connect banks or read the ledger
-- or bank feed: those policies are is_board / can_read_financials / board admin and none of those include
-- these roles.

-- ----------------------------------------------------------------------------
-- 1. An outside grant always has an end date
-- ----------------------------------------------------------------------------

alter table public.role_grants
  add constraint role_grants_outside_role_ends
  check (role not in ('property_manager', 'attorney', 'observer') or expires_on is not null);

-- ----------------------------------------------------------------------------
-- 2. Helpers
-- ----------------------------------------------------------------------------

-- Everyone with a live grant in the association: the three outside roles read what an owner reads.
create or replace function public.is_member(assoc uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_role_in(
    assoc, array['board_admin','board_member','accountant','owner','property_manager','attorney','observer']::public.app_role[])
$$;

-- Who runs the repairs: the board, and a property manager. Used by the repairs policies and functions only;
-- it is not a finance check.
create or replace function public.can_manage_repairs(assoc uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_role_in(assoc, array['board_admin','board_member','property_manager']::public.app_role[])
$$;

revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.can_manage_repairs(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.can_manage_repairs(uuid) to authenticated;

-- viewer_context gains can_manage_repairs (a new column, so the function is dropped and made again).
drop function if exists public.viewer_context(uuid);
create function public.viewer_context(p_association_id uuid)
returns table (
  person_id           uuid,
  full_name           text,
  roles               text[],
  is_board            boolean,
  is_board_admin      boolean,
  can_read_financials boolean,
  owned_unit_ids      uuid[],
  can_manage_repairs  boolean
)
language sql stable security definer set search_path = ''
as $$
  select p.id,
         p.full_name,
         coalesce((
           select array_agg(distinct g.role::text order by g.role::text)
             from public.role_grants g
            where g.person_id = p.id and g.revoked_at is null
              and (g.expires_on is null or g.expires_on >= current_date)
         ), '{}'::text[]),
         public.is_board(p_association_id),
         public.has_role_in(p_association_id, array['board_admin']::public.app_role[]),
         public.can_read_financials(p_association_id),
         coalesce((select array_agg(u) from public.owned_unit_ids(p_association_id) u), '{}'::uuid[]),
         public.can_manage_repairs(p_association_id)
    from public.persons p
   where p.id = public.current_person_id(p_association_id)
$$;

revoke all on function public.viewer_context(uuid) from public, anon;
grant execute on function public.viewer_context(uuid) to authenticated;

comment on function public.viewer_context(uuid) is
  'The caller''s own person, active roles and owned units in one call. Zero rows when the caller has no person here or the session is not aal2.';

-- ----------------------------------------------------------------------------
-- 3. The attorney's shares
-- ----------------------------------------------------------------------------

create table public.attorney_shares (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  person_id      uuid not null references public.persons(id) on delete cascade,
  -- null: shared building-wide (documents that belong to no unit); otherwise one unit.
  unit_id        uuid references public.units(id) on delete cascade,
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now()
);

create unique index attorney_shares_once
  on public.attorney_shares (association_id, person_id, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index attorney_shares_person_idx on public.attorney_shares (person_id);

comment on table public.attorney_shares is
  'What the board shared with an attorney: one unit (unit_id set), or the whole building (unit_id null). Read by the board and by the attorney named on the row; written by a board admin only. Inert once the attorney''s grant ends.';

create or replace function public.tg_attorney_shares_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.persons p where p.id = new.person_id and p.association_id = new.association_id
  ) then
    raise exception 'person belongs to a different association' using errcode = '42501';
  end if;
  if new.unit_id is not null and not exists (
    select 1 from public.units u where u.id = new.unit_id and u.association_id = new.association_id
  ) then
    raise exception 'unit belongs to a different association' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    -- Only someone who holds the attorney role can be given a share.
    if not exists (
      select 1 from public.role_grants g
       where g.person_id = new.person_id
         and g.association_id = new.association_id
         and g.role = 'attorney'
         and g.revoked_at is null
         and (g.expires_on is null or g.expires_on >= current_date)
    ) then
      raise exception 'only someone with the attorney role can be given a share' using errcode = 'check_violation';
    end if;
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    new.created_at := now();
  end if;
  return new;
end $$;

revoke all on function public.tg_attorney_shares_guard() from public, anon;
grant execute on function public.tg_attorney_shares_guard() to authenticated;

create trigger attorney_shares_guard before insert or update on public.attorney_shares
  for each row execute function public.tg_attorney_shares_guard();
create trigger audit_attorney_shares after insert or update or delete on public.attorney_shares
  for each row execute function public.tg_audit();

alter table public.attorney_shares enable row level security;

create policy attorney_shares_select on public.attorney_shares
  for select to authenticated
  using (
    public.is_board(association_id)
    or person_id = public.current_person_id(association_id)
  );
create policy attorney_shares_insert on public.attorney_shares
  for insert to authenticated
  with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));
create policy attorney_shares_delete on public.attorney_shares
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));
-- No update policy: a share is made or taken away, never edited.

-- ----------------------------------------------------------------------------
-- 4. Documents
-- ----------------------------------------------------------------------------

-- The categories a property manager reads (on top of everything visible to all owners).
create or replace function public.manager_document_category(p_category_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.document_categories c
     where c.id = p_category_id
       and c.slug in ('maintenance', 'permit', 'vendor_document', 'contract', 'insurance', 'unit_record')
  )
$$;

-- The categories an attorney can be shown, when the board has shared them.
create or replace function public.attorney_document_category(p_category_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.document_categories c
     where c.id = p_category_id
       and c.slug in ('legal_notice', 'contract', 'correspondence')
  )
$$;

-- A property manager reads a document in one of their categories.
create or replace function public.manager_can_read_document(p_association_id uuid, p_category_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role_in(p_association_id, array['property_manager']::public.app_role[])
     and public.manager_document_category(p_category_id)
$$;

-- An attorney reads a legal notice, contract or correspondence document only if it is pinned to a unit the
-- board shared with them, or pinned to no unit and the board shared the whole building.
create or replace function public.attorney_can_read_document(p_association_id uuid, p_unit_id uuid, p_category_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role_in(p_association_id, array['attorney']::public.app_role[])
     and public.attorney_document_category(p_category_id)
     and exists (
       select 1 from public.attorney_shares s
        where s.association_id = p_association_id
          and s.person_id = public.current_person_id(p_association_id)
          and s.unit_id is not distinct from p_unit_id
     )
$$;

revoke all on function public.manager_document_category(uuid) from public, anon;
revoke all on function public.attorney_document_category(uuid) from public, anon;
revoke all on function public.manager_can_read_document(uuid, uuid) from public, anon;
revoke all on function public.attorney_can_read_document(uuid, uuid, uuid) from public, anon;
grant execute on function public.manager_document_category(uuid) to authenticated;
grant execute on function public.attorney_document_category(uuid) to authenticated;
grant execute on function public.manager_can_read_document(uuid, uuid) to authenticated;
grant execute on function public.attorney_can_read_document(uuid, uuid, uuid) to authenticated;

-- documents_select (0074) plus a property manager branch and an attorney branch. The accountant branch and
-- the owner branches are unchanged; every member (the three outside roles included) reads what is visible to
-- all owners, and a unit-pinned document is read only by that unit's owners and the board.
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
      and public.manager_can_read_document(association_id, category_id)
    )
    or (
      deleted_at is null
      and public.attorney_can_read_document(association_id, restricted_to_unit_id, category_id)
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
-- 5. Units and people, with contact details, for a property manager
-- ----------------------------------------------------------------------------

drop policy if exists persons_select on public.persons;
create policy persons_select on public.persons
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or public.has_role_in(association_id, array['property_manager']::public.app_role[])
    or auth_user_id = auth.uid()
  );

drop policy if exists unit_owners_select on public.unit_owners;
create policy unit_owners_select on public.unit_owners
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or public.has_role_in(association_id, array['property_manager']::public.app_role[])
    or unit_id in (select public.owned_unit_ids(association_id))
  );

drop policy if exists unit_property_managers_select on public.unit_property_managers;
create policy unit_property_managers_select on public.unit_property_managers
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or public.has_role_in(association_id, array['property_manager']::public.app_role[])
    or unit_id in (select public.owned_unit_ids(association_id))
  );

-- Each unit's dues standing, read only, for the property manager. Summary figures only (as text): what is
-- owed, what is overdue, any unapplied credit, the net, how many charges are open and the oldest overdue
-- day. No charge, payment or ledger row is readable.
create or replace function public.manager_unit_standing(p_association_id uuid)
returns table (
  unit_id           uuid,
  unit_label        text,
  as_of             date,
  owed              text,
  overdue           text,
  credit            text,
  net               text,
  open_charges      integer,
  oldest_overdue_on date,
  next_due_on       date
)
language sql stable security definer set search_path = ''
as $$
  select c.unit_id, c.unit_label, c.as_of, c.owed, c.overdue, c.credit, c.net,
         c.open_charges, c.oldest_overdue_on, c.next_due_on
    from public.units u
   cross join lateral public.unit_position_core(u.id, current_date) c
   where u.association_id = p_association_id
     and public.has_role_in(p_association_id, array['property_manager']::public.app_role[])
   order by u.sort_order, u.label
$$;

revoke all on function public.manager_unit_standing(uuid) from public, anon;
grant execute on function public.manager_unit_standing(uuid) to authenticated;

comment on function public.manager_unit_standing(uuid) is
  'Per-unit dues standing (owed, overdue, credit, net, open charges, oldest overdue day) for a property manager. Text money, summary only. Nobody else gets rows.';

-- ----------------------------------------------------------------------------
-- 6. The attorney's shared units: collections standing and owner contact details
-- ----------------------------------------------------------------------------

-- The units the board shared with the calling attorney (not the building-wide share, which is for documents
-- that belong to no unit), with their dues and collections standing. Summary figures as text.
create or replace function public.attorney_shared_units(p_association_id uuid)
returns table (
  unit_id             uuid,
  unit_label          text,
  as_of               date,
  owed                text,
  overdue             text,
  credit              text,
  net                 text,
  open_charges        integer,
  oldest_overdue_on   date,
  last_payment_on     date,
  last_payment_amount text
)
language sql stable security definer set search_path = ''
as $$
  select c.unit_id, c.unit_label, c.as_of, c.owed, c.overdue, c.credit, c.net,
         c.open_charges, c.oldest_overdue_on, c.last_payment_on, c.last_payment_amount
    from public.attorney_shares s
    join public.units u on u.id = s.unit_id and u.association_id = s.association_id
   cross join lateral public.unit_position_core(u.id, current_date) c
   where s.association_id = p_association_id
     and s.unit_id is not null
     and s.person_id = public.current_person_id(p_association_id)
     and public.has_role_in(p_association_id, array['attorney']::public.app_role[])
   order by u.sort_order, u.label
$$;

-- The current owners of those same units, with their contact details.
create or replace function public.attorney_shared_owners(p_association_id uuid)
returns table (
  unit_id         uuid,
  unit_label      text,
  full_name       text,
  email           text,
  phone           text,
  mailing_address text,
  owner_since     date
)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.label, p.full_name, p.email, p.phone, p.mailing_address, uo.effective_from
    from public.attorney_shares s
    join public.units u on u.id = s.unit_id and u.association_id = s.association_id
    join public.unit_owners uo
      on uo.unit_id = u.id
     and uo.association_id = u.association_id
     and (uo.effective_to is null or uo.effective_to >= current_date)
    join public.persons p on p.id = uo.person_id and p.association_id = u.association_id
   where s.association_id = p_association_id
     and s.unit_id is not null
     and s.person_id = public.current_person_id(p_association_id)
     and public.has_role_in(p_association_id, array['attorney']::public.app_role[])
   order by u.sort_order, u.label, p.full_name
$$;

revoke all on function public.attorney_shared_units(uuid) from public, anon;
revoke all on function public.attorney_shared_owners(uuid) from public, anon;
grant execute on function public.attorney_shared_units(uuid) to authenticated;
grant execute on function public.attorney_shared_owners(uuid) to authenticated;

comment on function public.attorney_shared_units(uuid) is
  'Collections standing for the units a board admin shared with the calling attorney. Nobody else gets rows.';
comment on function public.attorney_shared_owners(uuid) is
  'Current owners (name, email, phone, mailing address) of the units a board admin shared with the calling attorney. Nobody else gets rows.';

-- ----------------------------------------------------------------------------
-- 7. Repairs: a property manager has a board member's powers, on repairs only
-- ----------------------------------------------------------------------------
-- Policies first. Every policy below is the existing one with can_manage_repairs() (board or property
-- manager) where it said is_board(), and, for the reads, "or can_manage_repairs" next to can_read_financials.
-- Finance tables are deliberately NOT here: ticket_expenses (payments tied to a problem), expenses,
-- recurring_bills, the ledger, the bank feed. Deleting stays with a board admin.

-- Problems
drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets
  for insert to authenticated
  with check (
    public.has_role_in(association_id, array['board_admin', 'board_member', 'owner', 'property_manager']::public.app_role[])
    and (
      public.can_manage_repairs(association_id)
      or unit_id is null
      or unit_id in (select public.owned_unit_ids(tickets.association_id))
    )
  );

drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets
  for update to authenticated
  using (public.can_manage_repairs(association_id))
  with check (public.can_manage_repairs(association_id));

-- Notes (internal notes are the board's and the manager's)
drop policy if exists ticket_comments_select on public.ticket_comments;
create policy ticket_comments_select on public.ticket_comments
  for select to authenticated
  using (
    public.can_manage_repairs(association_id)
    or ((not is_internal) and public.ticket_association_id(ticket_id) = association_id)
  );

drop policy if exists ticket_comments_insert on public.ticket_comments;
create policy ticket_comments_insert on public.ticket_comments
  for insert to authenticated
  with check (
    public.has_role_in(association_id, array['board_admin', 'board_member', 'owner', 'property_manager']::public.app_role[])
    and public.ticket_association_id(ticket_id) = association_id
    and ((not is_internal) or public.can_manage_repairs(association_id))
  );

drop policy if exists ticket_comments_update on public.ticket_comments;
create policy ticket_comments_update on public.ticket_comments
  for update to authenticated
  using (
    person_id = public.current_person_id(association_id)
    and public.has_role_in(association_id, array['board_admin', 'board_member', 'owner', 'property_manager']::public.app_role[])
  )
  with check (
    person_id = public.current_person_id(association_id)
    and public.has_role_in(association_id, array['board_admin', 'board_member', 'owner', 'property_manager']::public.app_role[])
  );

-- Plan, schedule, estimate and triage details
drop policy if exists ticket_board_details_select on public.ticket_board_details;
create policy ticket_board_details_select on public.ticket_board_details
  for select to authenticated
  using (public.can_read_financials(association_id) or public.can_manage_repairs(association_id));
drop policy if exists ticket_board_details_insert on public.ticket_board_details;
create policy ticket_board_details_insert on public.ticket_board_details
  for insert to authenticated with check (public.can_manage_repairs(association_id));
drop policy if exists ticket_board_details_update on public.ticket_board_details;
create policy ticket_board_details_update on public.ticket_board_details
  for update to authenticated
  using (public.can_manage_repairs(association_id)) with check (public.can_manage_repairs(association_id));

-- The timeline
drop policy if exists ticket_events_select on public.ticket_events;
create policy ticket_events_select on public.ticket_events
  for select to authenticated
  using (
    case
      when kind = 'note_added' and coalesce((data ->> 'internal')::boolean, false)
        then public.can_manage_repairs(association_id)
      else public.can_read_financials(association_id)
        or public.can_manage_repairs(association_id)
        or (visible_to_owners and public.ticket_association_id(ticket_id) = association_id)
    end
  );

-- Quotes
drop policy if exists ticket_bids_select on public.ticket_bids;
create policy ticket_bids_select on public.ticket_bids
  for select to authenticated
  using (public.can_read_financials(association_id) or public.can_manage_repairs(association_id));
drop policy if exists ticket_bids_insert on public.ticket_bids;
create policy ticket_bids_insert on public.ticket_bids
  for insert to authenticated with check (public.can_manage_repairs(association_id));
drop policy if exists ticket_bids_update on public.ticket_bids;
create policy ticket_bids_update on public.ticket_bids
  for update to authenticated
  using (public.can_manage_repairs(association_id)) with check (public.can_manage_repairs(association_id));

-- Contractors: the manager reads the contractor list, reviews, the board's notes and the messages to
-- contractors (quote requests). Adding, editing and archiving a contractor stays with the board. Messages
-- are drafted and marked sent by hand, so the manager may create and update them.
drop policy if exists vendors_select on public.vendors;
create policy vendors_select on public.vendors
  for select to authenticated
  using (public.can_read_financials(association_id) or public.can_manage_repairs(association_id));

drop policy if exists contractor_reviews_select on public.contractor_reviews;
create policy contractor_reviews_select on public.contractor_reviews
  for select to authenticated using (public.can_manage_repairs(association_id));

drop policy if exists contractor_notes_select on public.contractor_notes;
create policy contractor_notes_select on public.contractor_notes
  for select to authenticated using (public.can_manage_repairs(association_id));

drop policy if exists contractor_messages_select on public.contractor_messages;
create policy contractor_messages_select on public.contractor_messages
  for select to authenticated
  using (public.can_read_financials(association_id) or public.can_manage_repairs(association_id));
drop policy if exists contractor_messages_insert on public.contractor_messages;
create policy contractor_messages_insert on public.contractor_messages
  for insert to authenticated with check (public.can_manage_repairs(association_id));
drop policy if exists contractor_messages_update on public.contractor_messages;
create policy contractor_messages_update on public.contractor_messages
  for update to authenticated
  using (public.can_manage_repairs(association_id)) with check (public.can_manage_repairs(association_id));

-- Upkeep
drop policy if exists upkeep_tasks_select on public.upkeep_tasks;
create policy upkeep_tasks_select on public.upkeep_tasks
  for select to authenticated
  using (public.can_read_financials(association_id) or public.can_manage_repairs(association_id));
drop policy if exists upkeep_tasks_insert on public.upkeep_tasks;
create policy upkeep_tasks_insert on public.upkeep_tasks
  for insert to authenticated with check (public.can_manage_repairs(association_id));
drop policy if exists upkeep_tasks_update on public.upkeep_tasks;
create policy upkeep_tasks_update on public.upkeep_tasks
  for update to authenticated
  using (public.can_manage_repairs(association_id)) with check (public.can_manage_repairs(association_id));

drop policy if exists upkeep_log_select on public.upkeep_log;
create policy upkeep_log_select on public.upkeep_log
  for select to authenticated
  using (public.can_read_financials(association_id) or public.can_manage_repairs(association_id));
drop policy if exists upkeep_log_insert on public.upkeep_log;
create policy upkeep_log_insert on public.upkeep_log
  for insert to authenticated with check (public.can_manage_repairs(association_id));
drop policy if exists upkeep_log_update on public.upkeep_log;
create policy upkeep_log_update on public.upkeep_log
  for update to authenticated
  using (public.can_manage_repairs(association_id)) with check (public.can_manage_repairs(association_id));

-- Functions. Each is the version in force today with a named piece of text swapped, taken from the catalog
-- (pg_get_functiondef) so nothing is retyped. If a piece is not found the migration stops, so a later change
-- to one of these functions can never be silently skipped. Where a function is about money (set_ticket_payments,
-- mark_bill_paid) it is not in the list: those stay with the board.
do $$
declare
  r     record;
  v_def text;
begin
  for r in
    select * from (values
      -- Quotes
      ('public.accept_ticket_bid(uuid)',
       'public.is_board(v_bid.association_id)', 'public.can_manage_repairs(v_bid.association_id)'),
      ('public.request_ticket_quotes(uuid, jsonb)',
       'public.is_board(v_ticket.association_id)', 'public.can_manage_repairs(v_ticket.association_id)'),
      -- Working a problem
      ('public.set_ticket_priority(uuid, text, text)',
       'public.is_board(v.association_id)', 'public.can_manage_repairs(v.association_id)'),
      ('public.set_ticket_plan(uuid, jsonb)',
       'public.is_board(v.association_id)', 'public.can_manage_repairs(v.association_id)'),
      ('public.mark_ticket_duplicate(uuid, integer)',
       'public.is_board(v.association_id)', 'public.can_manage_repairs(v.association_id)'),
      ('public.record_ticket_triage(uuid, jsonb, text)',
       'public.is_board(v.association_id)', 'public.can_manage_repairs(v.association_id)'),
      ('public.reopen_ticket(uuid, text)',
       'public.is_board(v.association_id)', 'public.can_manage_repairs(v.association_id)'),
      ('public.confirm_ticket_fixed(uuid)',
       'public.is_board(v.association_id)', 'public.can_manage_repairs(v.association_id)'),
      ('public.close_ticket_for_owner(uuid, text)',
       'public.is_board(v.association_id)', 'public.can_manage_repairs(v.association_id)'),
      ('public.close_out_ticket(uuid, text, numeric, uuid, text, boolean)',
       'public.is_board(v.association_id)', 'public.can_manage_repairs(v.association_id)'),
      -- Linking a payment to a problem is a finance step: a property manager can close a problem out, not link
      -- a payment to it.
      ('public.close_out_ticket(uuid, text, numeric, uuid, text, boolean)',
       $f$  if p_status is null or p_status not in ('resolved', 'closed') then$f$,
       $t$  if p_expense_id is not null and not public.is_board(v.association_id) then
    raise exception 'only a board member can link a payment' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('resolved', 'closed') then$t$),
      ('public.tg_tickets_before_insert()',
       'public.is_board(new.association_id)', 'public.can_manage_repairs(new.association_id)'),
      -- Seeing every problem
      ('public.ticket_visible_to_caller(uuid, uuid)',
       'select public.can_read_financials(p_association_id)',
       'select public.can_read_financials(p_association_id) or public.can_manage_repairs(p_association_id)'),
      -- Who did it, as an owner reads it (a manager acts for the board)
      ('public.ticket_event_actor_roles(uuid)',
       'g.role in (''board_admin'', ''board_member'')', 'g.role in (''board_admin'', ''board_member'', ''property_manager'')'),
      ('public.ticket_event_actor_roles(uuid)',
       'then public.is_board(e.association_id)', 'then public.can_manage_repairs(e.association_id)'),
      ('public.ticket_event_actor_roles(uuid)',
       'else public.can_read_financials(e.association_id) or e.visible_to_owners',
       'else public.can_read_financials(e.association_id) or public.can_manage_repairs(e.association_id) or e.visible_to_owners'),
      -- Photos
      ('public.can_add_ticket_photo(uuid)',
       'public.is_board(t.association_id)', 'public.can_manage_repairs(t.association_id)'),
      ('public.remove_ticket_photo(uuid, uuid)',
       'public.is_board(v_row.association_id)', 'public.can_manage_repairs(v_row.association_id)'),
      ('public.ticket_photos(uuid)',
       'g.role in (''board_admin'', ''board_member'')', 'g.role in (''board_admin'', ''board_member'', ''property_manager'')'),
      ('public.ticket_photos(uuid)',
       'public.is_board(t.association_id)', 'public.can_manage_repairs(t.association_id)'),
      ('public.ticket_photos(uuid)',
       E'       public.can_read_financials(d.association_id)\n       or (d.restricted_to_unit_id is not null',
       E'       public.can_read_financials(d.association_id)\n       or public.manager_can_read_document(d.association_id, d.category_id)\n       or (d.restricted_to_unit_id is not null'),
      ('public.attach_ticket_photo(uuid, text, text, text, bigint, text, text)',
       'select d.id, d.storage_path, d.restricted_to_unit_id, d.visibility',
       'select d.id, d.storage_path, d.restricted_to_unit_id, d.visibility, d.category_id'),
      ('public.attach_ticket_photo(uuid, text, text, text, bigint, text, text)',
       'v_visible := public.can_read_financials(v_ticket.association_id)',
       'v_visible := public.can_read_financials(v_ticket.association_id)
      or public.manager_can_read_document(v_ticket.association_id, v_existing.category_id)'),
      -- Upkeep
      ('public.add_upkeep_task(uuid, text, text, integer, integer, text, uuid, numeric, date, date, date)',
       'public.is_board(p_association_id)', 'public.can_manage_repairs(p_association_id)'),
      ('public.mark_upkeep_done(uuid, date, numeric, uuid, text, uuid)',
       'public.is_board(v_task.association_id)', 'public.can_manage_repairs(v_task.association_id)'),
      -- Asking for a certificate of insurance is an owner's request to the board (the accountant may too). The
      -- outside roles are members who read; they do not file requests.
      ('public.request_insurance_proof(uuid, text, text)',
       'not public.is_member(p_association)',
       'not public.has_role_in(p_association, array[''board_admin'', ''board_member'', ''accountant'', ''owner'']::public.app_role[])'),
      -- In an emergency: a manager sees every emergency contact, not only the ones marked for owners
      ('public.building_emergency_info(uuid)',
       '(c.show_to_owners or public.can_read_financials(p_association_id))',
       '(c.show_to_owners or public.can_read_financials(p_association_id) or public.can_manage_repairs(p_association_id))')
    ) as t(sig, from_text, to_text)
  loop
    v_def := pg_get_functiondef(r.sig::regprocedure);
    if position(r.from_text in v_def) = 0 then
      raise exception '0080: % no longer contains the text this migration replaces: %', r.sig, r.from_text;
    end if;
    execute replace(v_def, r.from_text, r.to_text);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 8. The observer's Finances page
-- ----------------------------------------------------------------------------
-- owner_finances_enabled() (0079) says whether the summary page is on for this caller. An observer always has
-- it, whatever the board's switch says; owner_finances_summary() asks this function, so one change covers the
-- page and the figures. Still a member's read: summary figures from a SECURITY DEFINER function, never the
-- ledger, bank or budget tables.
create or replace function public.owner_finances_enabled(p_association_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (a.owner_finances_enabled and public.is_member(a.id))
        or public.has_role_in(a.id, array['observer']::public.app_role[])
      from public.associations a
     where a.id = p_association_id
  ), false)
$$;

revoke all on function public.owner_finances_enabled(uuid) from public, anon;
grant execute on function public.owner_finances_enabled(uuid) to authenticated;
