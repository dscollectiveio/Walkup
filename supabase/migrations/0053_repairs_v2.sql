-- ============================================================================
-- Walkup — migration 0053: repairs v2
--
-- Security first. tickets_select let any signed-in user read every
-- association's shared-area tickets (the `unit_id is null` branch had no
-- membership check), ticket_comments inherited that, and a member of one
-- building could post a note onto another building's ticket. Reporter and
-- author were whatever the client sent, and for board members the app sent
-- a random person. This file repairs those legacy rows from the audit log,
-- closes all three holes, adds a same-association guard to every repairs
-- foreign key, sets timestamps on the server, and numbers tickets under a
-- per-association advisory lock.
--
-- Board-only ticket fields (assignee, target date, estimate, final cost,
-- payment link, AI triage) move to ticket_board_details, readable by the
-- board and accountant only, so an owner reading tickets directly gets
-- exactly what the owner view shows.
--
-- Then the v2 model: tickets gain trade, location, access notes, a visit
-- date, a resolution note, duplicates and a link to the upkeep task they came
-- from; ticket_events is a timeline written only by triggers; ticket_bids
-- records quotes; contractor_notes is a dated notes log; vendors can be
-- archived and carry rates and a second contact; upkeep gets corrected
-- schedule maths in SQL (upkeep_next_due), add and mark-done RPCs and a log
-- trigger that keeps the task in step; recurring bills can be paused and
-- marked paid once per period (a bill tracking an insurance premium advances
-- through 0052's insurance_premium_bill_advance instead); the building's
-- emergency facts get a home.
--
-- Owners see more, through narrow paths: their tickets' timeline (events
-- marked visible_to_owners) with the actor's role, photos via the
-- foundation's ticket_photos(), the assigned contractor's name via
-- ticket_contractor_names(), and building_emergency_info(). They still never
-- read vendors (W-9 data), bids or board details.
--
-- One visibility rule: ticket_visible_to_caller(association, unit). The
-- tickets_select policy calls it on the row's columns; 0051's
-- can_see_ticket(id) now delegates to it, and the comment and timeline
-- policies go through 0051's ticket_association_id(id), which is non-null
-- only when can_see_ticket() is true.
--
-- Spec: docs/specs/repairs-spec.md section 3 (and insurance-spec R-2 for
-- mark_bill_paid).
-- ============================================================================

-- ============================================================================
-- 1. LEGACY DATA REPAIR (runs before any policy gives a reporter or author
--    new rights)
-- ============================================================================

-- createTicket and addComment sent "the first person I can see" as the
-- reporter or author. For an owner RLS made that right; for a board member it
-- was whoever sorted first. The audit log recorded the real signed-in user of
-- every insert. A row with no recorded actor (seed, migration, service task)
-- is left alone; an actor with no person in the row's association becomes
-- null. The audit triggers record each correction (actor null).

-- (a) tickets.reported_by
with ins as (
  select distinct on (a.record_id) a.record_id, a.actor_user_id
    from public.audit_log a
   where a.table_name = 'tickets' and a.action = 'insert' and a.actor_user_id is not null
   order by a.record_id, a.occurred_at
), fix as (
  select t.id,
         (select p.id from public.persons p
           where p.auth_user_id = ins.actor_user_id
             and p.association_id = t.association_id
           limit 1) as person_id
    from public.tickets t
    join ins on ins.record_id = t.id
)
update public.tickets t
   set reported_by = fix.person_id
  from fix
 where fix.id = t.id
   and t.reported_by is distinct from fix.person_id;

-- (b) ticket_comments.person_id, same rule
with ins as (
  select distinct on (a.record_id) a.record_id, a.actor_user_id
    from public.audit_log a
   where a.table_name = 'ticket_comments' and a.action = 'insert' and a.actor_user_id is not null
   order by a.record_id, a.occurred_at
), fix as (
  select c.id,
         (select p.id from public.persons p
           where p.auth_user_id = ins.actor_user_id
             and p.association_id = c.association_id
           limit 1) as person_id
    from public.ticket_comments c
    join ins on ins.record_id = c.id
)
update public.ticket_comments c
   set person_id = fix.person_id
  from fix
 where fix.id = c.id
   and c.person_id is distinct from fix.person_id;

-- (c) Comments injected across associations (the 0013 hole): a row whose
-- association is not its ticket's association. Deleted; the audit trigger
-- keeps the full row in audit_log.before_data, so nothing is lost to an
-- investigation, and the owning board no longer sees text a stranger wrote.
delete from public.ticket_comments c
 using public.tickets t
 where t.id = c.ticket_id
   and t.association_id <> c.association_id;

-- ============================================================================
-- 2. TICKET VISIBILITY: one rule, two entry points
-- ============================================================================

-- The column-level rule. tickets_select must use this form, not
-- can_see_ticket(id): for INSERT ... RETURNING (createTicket returns id and
-- reference) Postgres checks the SELECT policy against the new row before
-- the row exists, so an id lookup would find nothing and refuse every
-- report.
create or replace function public.ticket_visible_to_caller(p_association_id uuid, p_unit_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.can_read_financials(p_association_id)
      or (p_unit_id is null and public.is_member(p_association_id))
      or (p_unit_id is not null
          and p_unit_id in (select public.owned_unit_ids(p_association_id)))
$$;

revoke all on function public.ticket_visible_to_caller(uuid, uuid) from public, anon;
grant execute on function public.ticket_visible_to_caller(uuid, uuid) to authenticated;

comment on function public.ticket_visible_to_caller(uuid, uuid) is
  'The one ticket-visibility rule: board or accountant, any member for a shared-area ticket, the owner for a unit ticket. tickets_select and can_see_ticket() both call it.';

-- 0051's can_see_ticket(uuid) keeps its signature, grants and meaning; its
-- body now delegates, so the policy and every RPC cannot drift apart.
create or replace function public.can_see_ticket(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tickets t
     where t.id = p_ticket_id
       and public.ticket_visible_to_caller(t.association_id, t.unit_id)
  )
$$;

revoke all on function public.can_see_ticket(uuid) from public, anon;
grant execute on function public.can_see_ticket(uuid) to authenticated;

drop policy tickets_select on public.tickets;
create policy tickets_select on public.tickets
  for select to authenticated
  using (public.ticket_visible_to_caller(association_id, unit_id));

-- Reporting is for owners and the board. The accountant reads Repairs but
-- does not file problems (CLAUDE.md: "financials + linked docs").
drop policy tickets_insert on public.tickets;
create policy tickets_insert on public.tickets
  for insert to authenticated
  with check (
    public.has_role_in(association_id, array['board_admin', 'board_member', 'owner']::public.app_role[])
    and (
      public.is_board(association_id)
      or unit_id is null
      or unit_id in (select public.owned_unit_ids(association_id))
    )
  );

-- tickets_update (board) is kept. There is still no delete policy: tickets
-- are never deleted (duplicates are closed and linked instead).

-- ============================================================================
-- 3. TICKET COMMENTS: internal notes, kinds, replacement policies, guard
-- ============================================================================

alter table public.ticket_comments
  add column is_internal boolean not null default false,
  add column kind        text not null default 'note'
    check (kind in ('note', 'me_too', 'visit_feedback')),
  add column edited_at   timestamptz;

-- Length limits are triggers, not CHECK ... NOT VALID (REVIEW-1 #3): Postgres
-- applies even a not-valid check to every later UPDATE of an old row, so a
-- legacy row outside the limit could never be edited or closed again. These
-- look only at what is being written: every insert, and an update only when
-- the limited column itself changes.
create or replace function public.tg_ticket_comments_text_limits()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.body is distinct from old.body)
     and char_length(btrim(new.body)) not between 1 and 4000 then
    raise exception 'a comment must be 1 to 4000 characters' using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function public.tg_ticket_comments_text_limits() from public, anon;
grant execute on function public.tg_ticket_comments_text_limits() to authenticated;

create trigger ticket_comments_12_text_limits
  before insert or update on public.ticket_comments
  for each row execute function public.tg_ticket_comments_text_limits();

-- One "I'm seeing this too" per person per ticket.
create unique index ticket_comments_one_me_too
  on public.ticket_comments (ticket_id, person_id) where kind = 'me_too';

comment on column public.ticket_comments.is_internal is
  'Board-only note. Hidden from owners and from the accountant (ticket_comments_select), and its timeline event is board-only too. Fixed at insert.';
comment on column public.ticket_comments.kind is
  'note: an ordinary note. me_too: another member says they see the same shared-area problem. visit_feedback: the reporter''s "How did the visit go?" on a fixed or closed ticket, which the board may turn into a contractor review.';

drop policy ticket_comments_select on public.ticket_comments;
drop policy ticket_comments_insert on public.ticket_comments;

-- Board sees every note. Anyone else sees non-internal notes on tickets they
-- can see, and only when the note's association is the ticket's association
-- (ticket_association_id is null unless can_see_ticket; the injected-comment
-- case fails this even before the guard trigger).
create policy ticket_comments_select on public.ticket_comments
  for select to authenticated
  using (
    public.is_board(association_id)
    or (
      not is_internal
      and public.ticket_association_id(ticket_id) = association_id
    )
  );

create policy ticket_comments_insert on public.ticket_comments
  for insert to authenticated
  with check (
    public.has_role_in(association_id, array['board_admin', 'board_member', 'owner']::public.app_role[])
    and public.ticket_association_id(ticket_id) = association_id
    and (not is_internal or public.is_board(association_id))
  );

-- Authors may correct their own note (body only; the guard trigger pins the
-- rest, including is_internal). Board admins may delete a note; nobody else.
create policy ticket_comments_update on public.ticket_comments
  for update to authenticated
  using (
    person_id = public.current_person_id(association_id)
    and public.has_role_in(association_id, array['board_admin', 'board_member', 'owner']::public.app_role[])
  )
  with check (
    person_id = public.current_person_id(association_id)
    and public.has_role_in(association_id, array['board_admin', 'board_member', 'owner']::public.app_role[])
  );

create policy ticket_comments_delete on public.ticket_comments
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

-- Author and time from the server, same association, kind rules.
create or replace function public.tg_ticket_comments_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_ticket record;
begin
  if tg_op = 'UPDATE' then
    -- Only the body may change after the fact. is_internal is fixed so a
    -- note's timeline event can never disagree with it.
    new.association_id := old.association_id;
    new.ticket_id      := old.ticket_id;
    new.person_id      := old.person_id;
    new.created_at     := old.created_at;
    new.is_internal    := old.is_internal;
    new.kind           := old.kind;
    new.edited_at      := case when new.body is distinct from old.body then now() else old.edited_at end;
    return new;
  end if;

  -- The author and the time are the server's, whatever the client sent.
  -- With no signed-in user (migrations, seeds, service tasks) the given
  -- values stand.
  if auth.uid() is not null then
    new.person_id  := public.current_person_id(new.association_id);
    new.created_at := now();
    new.edited_at  := null;
  end if;

  select t.id, t.association_id, t.unit_id, t.status
    into v_ticket
    from public.tickets t
   where t.id = new.ticket_id and t.association_id = new.association_id;
  if not found then
    raise exception 'ticket belongs to a different association' using errcode = '42501';
  end if;

  if new.person_id is not null and not exists (
    select 1 from public.persons p
     where p.id = new.person_id and p.association_id = new.association_id
  ) then
    raise exception 'person belongs to a different association' using errcode = '42501';
  end if;

  if new.kind <> 'note' and new.is_internal then
    raise exception 'only ordinary notes can be internal' using errcode = '22023';
  end if;
  if new.kind = 'me_too' and v_ticket.unit_id is not null then
    raise exception '"I''m seeing this too" is for shared-area problems' using errcode = '22023';
  end if;
  if new.kind = 'visit_feedback' and v_ticket.status not in ('resolved', 'closed') then
    raise exception 'feedback on the visit comes after it is fixed' using errcode = '22023';
  end if;

  return new;
end $$;

revoke all on function public.tg_ticket_comments_guard() from public, anon;
grant execute on function public.tg_ticket_comments_guard() to authenticated;

create trigger ticket_comments_10_guard
  before insert or update on public.ticket_comments
  for each row execute function public.tg_ticket_comments_guard();

-- ============================================================================
-- 4. TICKETS: v2 columns and the two data backfills
-- ============================================================================

alter table public.tickets
  add column trade              text,
  add column location_detail    text,
  add column access_notes       text,
  add column scheduled_for      date,
  add column scheduled_window   text,
  add column resolution_note    text,
  add column emergency_kind     text,
  add column upkeep_task_id     uuid references public.upkeep_tasks(id) on delete set null,
  add column duplicate_of_id    uuid references public.tickets(id) on delete restrict,
  add column client_key         uuid,
  add column updated_at         timestamptz not null default now(),
  add constraint tickets_trade_slug
    check (trade is null or trade ~ '^[a-z][a-z_]{1,30}$'),
  add constraint tickets_location_detail_len
    check (location_detail is null or char_length(location_detail) <= 200),
  add constraint tickets_access_notes_len
    check (access_notes is null or char_length(access_notes) <= 1000),
  add constraint tickets_scheduled_window_len
    check (scheduled_window is null or char_length(scheduled_window) <= 60),
  add constraint tickets_resolution_note_len
    check (resolution_note is null or char_length(resolution_note) <= 2000),
  add constraint tickets_emergency_kind check (emergency_kind is null or emergency_kind in
    ('gas', 'carbon_monoxide', 'fire', 'flooding', 'electrical', 'no_heat', 'sewage', 'elevator_entrapment')),
  add constraint tickets_not_own_duplicate
    check (duplicate_of_id is null or duplicate_of_id <> id);

create index tickets_assoc_vendor_idx    on public.tickets (association_id, assigned_vendor_id) where assigned_vendor_id is not null;
create index tickets_assoc_scheduled_idx on public.tickets (association_id, scheduled_for) where scheduled_for is not null;
create index tickets_assoc_reporter_idx  on public.tickets (association_id, reported_by);
create index tickets_assoc_created_idx   on public.tickets (association_id, created_at desc);

-- A retried report (dropped connection, double tap) carries the same key and
-- finds the ticket it already made.
create unique index tickets_client_key on public.tickets (association_id, client_key) where client_key is not null;

-- At most one open ticket per upkeep task ("Turn into a problem" twice
-- returns the same ticket).
create unique index tickets_one_open_per_upkeep_task
  on public.tickets (upkeep_task_id)
  where upkeep_task_id is not null and status in ('open', 'in_progress', 'waiting_on_contractor');

comment on column public.tickets.trade is
  'Trade slug from src/lib/contractors/trades.ts. Not an enum so a new trade is a code change, not a migration.';
comment on column public.tickets.access_notes is
  'How a contractor gets in and when. Visible to everyone who can see the ticket (for a shared-area ticket, every member); the edit form makes the board confirm or clear it when a unit ticket becomes shared.';
comment on column public.tickets.emergency_kind is
  'Set by the deterministic emergency rules (src/lib/repairs/emergency.ts) at report time when the reporter confirms it is happening now, or by the board (including from an AI suggestion). Drives the static safety banner.';
comment on column public.tickets.client_key is
  'Idempotency key generated by the report form; a retried submit returns the existing ticket.';

-- Backfill, in one statement so each legacy ticket gets one audit row and no
-- timeline event (no ticket trigger from this file exists yet):
--  * updated_at: the last thing we know happened, not migration time.
--  * trade: from the title and description, with word boundaries
--    (\m start of word, \M end of word; a stem without \M matches longer
--    words: "roof" matches "roofing"). Same keyword order as
--    guessTradeFromText() in src/lib/contractors/trades.ts.
update public.tickets t
   set updated_at = coalesce(t.resolved_at, t.created_at),
       trade = case
    when x.txt ~* '\mbackflow\M'                                                                  then 'backflow'
    when x.txt ~* '\msewer\M|\msewage\M|\mmain line\M|\mrodd'                                     then 'sewer'
    when x.txt ~* '\mroof|\mflashing\M|\mskylights?\M'                                            then 'roofing'
    when x.txt ~* '\mboilers?\M|\mfurnaces?\M|\mradiators?\M|\mheat(ing)?\M|\mthermostats?\M|\mhvac\M|\mair condition' then 'hvac'
    when x.txt ~* '\mleak(s|ing|ed|y)?\M|\mtaps?\M|\mfaucets?\M|\mtoilets?\M|\mdrains?\M|\mpipes?\M|\mwater heaters?\M|\mplumb|\msump\M' then 'plumbing'
    when x.txt ~* '\moutlets?\M|\mbreakers?\M|\mwiring\M|\melectric|\mlights?\M|\mspark'        then 'electrical'
    when x.txt ~* '\mbricks?\M|\mtuckpoint|\mmason|\mmortar\M'                                    then 'masonry'
    when x.txt ~* '\mgutters?\M|\mdownspouts?\M'                                                  then 'gutters'
    when x.txt ~* '\mlocks?\M|\mlocked\M|\mkeys?\M|\mbuzzers?\M|\mintercom\M'                    then 'locksmith'
    when x.txt ~* '\mmice\M|\mmouse\M|\mrats?\M|\mroach(es)?\M|\mbed ?bugs?\M|\mpests?\M'         then 'pest'
    when x.txt ~* '\mwindows?\M|\mglass\M'                                                        then 'windows'
    when x.txt ~* '\mgarage doors?\M'                                                             then 'garage_door'
    when x.txt ~* '\msnow\M|\mice\M|\micy\M'                                                      then 'snow'
    else null end
  from (select id, coalesce(title, '') || ' ' || coalesce(description, '') as txt from public.tickets) x
 where x.id = t.id;

-- Limits as a trigger, created after the backfill (REVIEW-1 #3). A CHECK ...
-- NOT VALID would still be applied to every later UPDATE of a legacy row (a
-- "Gas" ticket could never be closed again). The trigger checks a new row, and
-- an old one only when the limited column itself changes.
create or replace function public.tg_tickets_text_limits()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.title is distinct from old.title)
     and char_length(btrim(new.title)) not between 4 and 120 then
    raise exception 'the title must be 4 to 120 characters' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.description is distinct from old.description)
     and new.description is not null and char_length(new.description) > 4000 then
    raise exception 'the description must be 4000 characters or fewer' using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function public.tg_tickets_text_limits() from public, anon;
grant execute on function public.tg_tickets_text_limits() to authenticated;

create trigger tickets_12_text_limits
  before insert or update on public.tickets
  for each row execute function public.tg_tickets_text_limits();

-- ============================================================================
-- 5. TICKET BOARD DETAILS: what only the board and accountant read
-- ============================================================================

create table public.ticket_board_details (
  ticket_id          uuid primary key references public.tickets(id) on delete cascade,
  association_id     uuid not null references public.associations(id) on delete restrict,
  assignee_person_id uuid references public.persons(id) on delete restrict,
  due_on             date,
  estimated_cost     numeric(14,2) check (estimated_cost is null or estimated_cost >= 0),
  actual_cost        numeric(14,2) check (actual_cost is null or actual_cost >= 0),
  expense_id         uuid references public.expenses(id) on delete restrict,
  triage             jsonb check (triage is null or octet_length(triage::text) <= 8192),
  emergency_suggestion_dismissed_at timestamptz,   -- the board said the AI's "possible emergency" isn't one
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index ticket_board_details_due_idx      on public.ticket_board_details (association_id, due_on) where due_on is not null;
create index ticket_board_details_assignee_idx on public.ticket_board_details (association_id, assignee_person_id) where assignee_person_id is not null;
create index ticket_board_details_expense_idx  on public.ticket_board_details (expense_id) where expense_id is not null;

comment on table public.ticket_board_details is
  'One row per ticket the board has planned or costed: assignee, target date, estimate, final cost, payment link, AI triage. Board writes, board and accountant read; owners never see it (brief decision 9). Absent row = nothing recorded.';
comment on column public.ticket_board_details.triage is
  'Last AI triage, written only by record_ticket_triage() (the guard trigger pins it otherwise). Shape validated there: {state, trade, secondary_trade, urgency, emergency, search_phrase, summary, questions, confidence, model, at, reason}.';

-- Move the two legacy board-only columns off tickets (owners could read them).
insert into public.ticket_board_details (ticket_id, association_id, estimated_cost, expense_id, created_at, updated_at)
select t.id, t.association_id, t.estimated_cost, t.expense_id, t.created_at, t.created_at
  from public.tickets t
 where t.estimated_cost is not null or t.expense_id is not null;

alter table public.tickets
  drop column estimated_cost,
  drop column expense_id;

alter table public.ticket_board_details enable row level security;

create policy ticket_board_details_select on public.ticket_board_details
  for select to authenticated using (public.can_read_financials(association_id));
create policy ticket_board_details_insert on public.ticket_board_details
  for insert to authenticated with check (public.is_board(association_id));
create policy ticket_board_details_update on public.ticket_board_details
  for update to authenticated
  using (public.is_board(association_id)) with check (public.is_board(association_id));
-- No delete policy: the row goes with its ticket, and tickets are never deleted.

-- walkup.triage_write is a transaction-local setting that only
-- record_ticket_triage() sets (set_config(..., true)). A client cannot set
-- it: PostgREST runs each request in its own transaction and does not expose
-- pg_catalog.set_config.
create or replace function public.tg_ticket_board_details_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_triage_ok boolean := coalesce(current_setting('walkup.triage_write', true), '') = 'on';
begin
  if tg_op = 'UPDATE' then
    new.ticket_id      := old.ticket_id;
    new.association_id := old.association_id;
    new.created_at     := old.created_at;
    if not v_triage_ok then
      new.triage := old.triage;
    end if;
  else
    if not v_triage_ok then
      new.triage := null;
    end if;
    new.created_at := now();
  end if;

  if not exists (
    select 1 from public.tickets t where t.id = new.ticket_id and t.association_id = new.association_id
  ) then
    raise exception 'ticket belongs to a different association' using errcode = '42501';
  end if;

  -- Nested ifs: plpgsql may evaluate both sides of OR, and OLD is null on INSERT.
  if new.expense_id is not null then
    if tg_op = 'INSERT' or new.expense_id is distinct from old.expense_id then
      if not exists (
        select 1 from public.expenses e where e.id = new.expense_id and e.association_id = new.association_id
      ) then
        raise exception 'expense belongs to a different association' using errcode = '42501';
      end if;
    end if;
  end if;

  -- The board assignee must be a current board member of this association.
  if new.assignee_person_id is not null then
    if tg_op = 'INSERT' or new.assignee_person_id is distinct from old.assignee_person_id then
      if not exists (
        select 1 from public.role_grants g
         where g.person_id = new.assignee_person_id
           and g.association_id = new.association_id
           and g.role in ('board_admin', 'board_member')
           and g.revoked_at is null
           and (g.expires_on is null or g.expires_on >= current_date)
      ) then
        raise exception 'assignee is not on this association''s board' using errcode = '42501';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

revoke all on function public.tg_ticket_board_details_guard() from public, anon;
grant execute on function public.tg_ticket_board_details_guard() to authenticated;

create trigger ticket_board_details_10_guard
  before insert or update on public.ticket_board_details
  for each row execute function public.tg_ticket_board_details_guard();

create trigger audit_ticket_board_details
  after insert or update or delete on public.ticket_board_details
  for each row execute function public.tg_audit();

-- ============================================================================
-- 6. TICKET TRIGGERS: before insert (reporter, times, owner-safe fields,
--    numbering), before update (pinned columns, resolved_at), same-association
--    guard. Names sort so defaults run before the guard (10 < 15 < 20).
-- ============================================================================

drop trigger tickets_reference on public.tickets;
drop function public.tg_ticket_reference();

-- SECURITY DEFINER because it computes max(reference) across the
-- association (DECISIONS #23). VOLATILE (the plpgsql default) matters: the
-- max() below takes a fresh snapshot *after* the advisory lock is granted,
-- so a second concurrent insert waits for the first to commit and then sees
-- its reference. The unique (association_id, reference) constraint stays as
-- the backstop.
create or replace function public.tg_tickets_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null then
    -- Reporter, reference and times are the server's, never the client's.
    new.reported_by := public.current_person_id(new.association_id);
    new.reference   := null;
    new.created_at  := now();
    new.opened_on   := (now() at time zone 'America/Chicago')::date;

    -- Owners report problems; they do not plan them.
    if not public.is_board(new.association_id) then
      new.status             := 'open';
      new.assigned_vendor_id := null;
      new.scheduled_for      := null;
      new.scheduled_window   := null;
      new.resolution_note    := null;
      new.duplicate_of_id    := null;
      new.upkeep_task_id     := null;
      -- trade and emergency_kind are allowed: the server action sets them
      -- from the deterministic rules, and both are suggestions the board can
      -- change. priority is the reporter's own choice.
    end if;
  end if;

  if new.status in ('resolved', 'closed') then
    new.resolved_at := coalesce(new.resolved_at, now());
  else
    new.resolved_at := null;
  end if;
  new.updated_at := now();

  perform pg_advisory_xact_lock(
    hashtextextended('public.tickets.reference:' || new.association_id::text, 0));
  if new.reference is null then
    select coalesce(max(t.reference), 0) + 1 into new.reference
      from public.tickets t
     where t.association_id = new.association_id;
  end if;

  return new;
end $$;

revoke all on function public.tg_tickets_before_insert() from public, anon;
grant execute on function public.tg_tickets_before_insert() to authenticated;

create trigger tickets_10_before_insert
  before insert on public.tickets
  for each row execute function public.tg_tickets_before_insert();

-- SECURITY INVOKER: reads nothing. Only the board can update tickets
-- directly (tickets_update); owners change status only through
-- reopen_ticket()/confirm_ticket_fixed(), which run as definer.
create or replace function public.tg_tickets_before_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.association_id := old.association_id;
  new.reference      := old.reference;
  new.reported_by    := old.reported_by;
  new.opened_on      := old.opened_on;
  new.created_at     := old.created_at;
  new.client_key     := old.client_key;

  -- resolved_at is the moment it was first marked done, kept across
  -- resolved <-> closed and cleared on reopen. The client's value is ignored.
  if new.status in ('resolved', 'closed') then
    if old.status in ('resolved', 'closed') then
      new.resolved_at := old.resolved_at;
    else
      new.resolved_at := now();
    end if;
  else
    new.resolved_at := null;
  end if;

  new.updated_at := now();
  return new;
end $$;

revoke all on function public.tg_tickets_before_update() from public, anon;
grant execute on function public.tg_tickets_before_update() to authenticated;

create trigger tickets_15_before_update
  before update on public.tickets
  for each row execute function public.tg_tickets_before_update();

create or replace function public.tg_tickets_same_association()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  is_insert boolean := (tg_op = 'INSERT');
begin
  -- Each check runs on insert or when its column changes. Nested ifs:
  -- plpgsql may evaluate both sides of OR, and OLD is null on INSERT.
  if new.unit_id is not null then
    if is_insert or new.unit_id is distinct from old.unit_id then
      if not exists (
        select 1 from public.units u where u.id = new.unit_id and u.association_id = new.association_id
      ) then
        raise exception 'unit belongs to a different association' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.reported_by is not null then
    if is_insert or new.reported_by is distinct from old.reported_by then
      if not exists (
        select 1 from public.persons p where p.id = new.reported_by and p.association_id = new.association_id
      ) then
        raise exception 'reporter belongs to a different association' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.assigned_vendor_id is not null then
    if is_insert or new.assigned_vendor_id is distinct from old.assigned_vendor_id then
      if not exists (
        select 1 from public.vendors v where v.id = new.assigned_vendor_id and v.association_id = new.association_id
      ) then
        raise exception 'contractor belongs to a different association' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.upkeep_task_id is not null then
    if is_insert or new.upkeep_task_id is distinct from old.upkeep_task_id then
      if not exists (
        select 1 from public.upkeep_tasks k where k.id = new.upkeep_task_id and k.association_id = new.association_id
      ) then
        raise exception 'upkeep task belongs to a different association' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.duplicate_of_id is not null then
    if is_insert or new.duplicate_of_id is distinct from old.duplicate_of_id then
      if not exists (
        select 1 from public.tickets d where d.id = new.duplicate_of_id and d.association_id = new.association_id
      ) then
        raise exception 'duplicate belongs to a different association' using errcode = '42501';
      end if;
      -- No chains and no loops: the original must not itself be a duplicate,
      -- and nothing may already point at this ticket as its original.
      if exists (select 1 from public.tickets d where d.id = new.duplicate_of_id and d.duplicate_of_id is not null) then
        raise exception 'that problem is itself closed as a duplicate; point at its original' using errcode = '22023';
      end if;
      if not is_insert then
        if exists (select 1 from public.tickets c where c.duplicate_of_id = new.id) then
          raise exception 'other problems are closed as duplicates of this one' using errcode = '22023';
        end if;
      end if;
    end if;
  end if;

  return new;
end $$;

revoke all on function public.tg_tickets_same_association() from public, anon;
grant execute on function public.tg_tickets_same_association() to authenticated;

create trigger tickets_20_same_association
  before insert or update on public.tickets
  for each row execute function public.tg_tickets_same_association();

-- ============================================================================
-- 7. CONTRACTOR MESSAGES: defaults from the caller, frozen once sent, guard,
--    kinds
-- ============================================================================

alter table public.contractor_messages
  add column kind       text not null default 'general'
    check (kind in ('general', 'job', 'quote_request', 'w9_request', 'coi_request', 'paperwork_request')),
  add column updated_at timestamptz not null default now();

-- Before the one-draft index: legacy DraftPanel could leave several drafts
-- for the same contractor and ticket (all kind 'general' now). Keep the
-- newest, cancel the rest (audited). Runs before the length checks below,
-- which a not-valid check would still apply to this update.
update public.contractor_messages m
   set status = 'cancelled'
 where m.status = 'draft'
   and m.id not in (
     select distinct on (d.vendor_id, d.ticket_id, d.kind) d.id
       from public.contractor_messages d
      where d.status = 'draft'
      order by d.vendor_id, d.ticket_id, d.kind, d.created_at desc
   );

create or replace function public.tg_contractor_messages_text_limits()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.subject is distinct from old.subject)
     and char_length(new.subject) > 200 then
    raise exception 'the subject must be 200 characters or fewer' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.body is distinct from old.body)
     and char_length(new.body) > 10000 then
    raise exception 'the message must be 10000 characters or fewer' using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function public.tg_contractor_messages_text_limits() from public, anon;
grant execute on function public.tg_contractor_messages_text_limits() to authenticated;

create trigger contractor_messages_12_text_limits
  before insert or update on public.contractor_messages
  for each row execute function public.tg_contractor_messages_text_limits();

-- One open draft per contractor, ticket and kind; a second "create draft"
-- returns the first (the action maps 23505 to "use the existing row").
create unique index contractor_messages_one_draft
  on public.contractor_messages (vendor_id, ticket_id, kind) nulls not distinct
  where status = 'draft';

-- created_by and approved_by come from the caller; approving or marking sent
-- stamps the time. A sent message is frozen. Editing an approved message
-- sends it back to draft. The 0013 checks (sent needs sent_at and an
-- approver) still hold, and now cannot be satisfied with someone else's id.
-- DEFINER, like every trigger function here that calls auth.uid().
create or replace function public.tg_contractor_messages_defaults()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.created_at := now();
    end if;
    if new.status in ('approved', 'sent') and auth.uid() is not null then
      new.approved_by := auth.uid();
    end if;
  else
    new.association_id := old.association_id;
    new.vendor_id      := old.vendor_id;
    new.ticket_id      := old.ticket_id;
    new.kind           := old.kind;
    new.created_by     := old.created_by;
    new.created_at     := old.created_at;

    if old.status = 'sent' and (
         new.status    is distinct from old.status
      or new.subject   is distinct from old.subject
      or new.body      is distinct from old.body
      or new.to_email  is distinct from old.to_email) then
      raise exception 'a sent message is a record and can''t be changed' using errcode = '42501';
    end if;
    -- The approver and the send time are part of that record too (REVIEW-1 #8).
    if old.status = 'sent' then
      new.approved_by := old.approved_by;
      new.sent_at     := old.sent_at;
    end if;

    if old.status = 'approved' and new.status = 'approved' and (
         new.subject  is distinct from old.subject
      or new.body     is distinct from old.body
      or new.to_email is distinct from old.to_email) then
      new.status      := 'draft';
      new.approved_by := null;
    end if;

    if new.status is distinct from old.status and new.status in ('approved', 'sent') and auth.uid() is not null then
      new.approved_by := auth.uid();
    end if;
  end if;

  if new.status = 'sent' and new.sent_at is null then
    new.sent_at := now();
  end if;
  if new.status <> 'sent' then
    new.sent_at := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.tg_contractor_messages_defaults() from public, anon;
grant execute on function public.tg_contractor_messages_defaults() to authenticated;

create trigger contractor_messages_10_defaults
  before insert or update on public.contractor_messages
  for each row execute function public.tg_contractor_messages_defaults();

create or replace function public.tg_contractor_messages_same_association()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- A null vendor_id is left to the column's NOT NULL constraint.
  if new.vendor_id is not null and not exists (
    select 1 from public.vendors v where v.id = new.vendor_id and v.association_id = new.association_id
  ) then
    raise exception 'contractor belongs to a different association' using errcode = '42501';
  end if;
  if new.ticket_id is not null and not exists (
    select 1 from public.tickets t where t.id = new.ticket_id and t.association_id = new.association_id
  ) then
    raise exception 'ticket belongs to a different association' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_contractor_messages_same_association() from public, anon;
grant execute on function public.tg_contractor_messages_same_association() to authenticated;

create trigger contractor_messages_20_same_association
  before insert or update on public.contractor_messages
  for each row execute function public.tg_contractor_messages_same_association();

-- What "marked as sent" means elsewhere, in the same transaction as the
-- status change (no second client call that can fail):
--  * a quote request: the bid it belongs to records the date it was asked;
--  * a go-ahead for the assigned contractor: an open ticket becomes
--    "being worked on" (only now is "{name} is handling this" true).
-- The trigger is created in section 10, after ticket_bids exists.
create or replace function public.tg_contractor_messages_sent()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'sent' or old.status = 'sent' then
    return null;
  end if;

  if new.kind = 'quote_request' then
    update public.ticket_bids b
       set requested_on = coalesce(b.requested_on, (new.sent_at at time zone 'America/Chicago')::date)
     where b.message_id = new.id
       and b.association_id = new.association_id;
  elsif new.kind = 'job' and new.ticket_id is not null then
    update public.tickets t
       set status = 'in_progress'
     where t.id = new.ticket_id
       and t.association_id = new.association_id
       and t.status = 'open'
       and t.assigned_vendor_id = new.vendor_id;
  end if;
  return null;
end $$;

revoke all on function public.tg_contractor_messages_sent() from public, anon;
grant execute on function public.tg_contractor_messages_sent() to authenticated;

-- ============================================================================
-- 8. RECURRING BILLS: same-association guard
--    (0052's recurring_bills_insurance_v2_same_association stays; the two
--    agree, and 0052's covers Insurance's RPCs on its own.)
-- ============================================================================

create or replace function public.tg_recurring_bills_same_association()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.vendor_id is not null and not exists (
    select 1 from public.vendors v where v.id = new.vendor_id and v.association_id = new.association_id
  ) then
    raise exception 'contractor belongs to a different association' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.accounts a where a.id = new.account_id and a.association_id = new.association_id
  ) then
    raise exception 'category belongs to a different association' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.funds f where f.id = new.fund_id and f.association_id = new.association_id
  ) then
    raise exception 'fund belongs to a different association' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_recurring_bills_same_association() from public, anon;
grant execute on function public.tg_recurring_bills_same_association() to authenticated;

create trigger recurring_bills_20_same_association
  before insert or update on public.recurring_bills
  for each row execute function public.tg_recurring_bills_same_association();

-- ============================================================================
-- 9. TICKET TIMELINE: ticket_events
-- ============================================================================

create table public.ticket_events (
  id                uuid primary key default gen_random_uuid(),
  association_id    uuid not null references public.associations(id) on delete restrict,
  ticket_id         uuid not null references public.tickets(id) on delete cascade,
  kind              text not null check (kind in (
                      'created', 'status_changed', 'reopened', 'priority_changed',
                      'contractor_assigned', 'contractor_removed', 'assignee_changed',
                      'scheduled', 'schedule_cleared', 'due_changed', 'trade_changed',
                      'details_edited', 'estimate_changed', 'final_cost_recorded',
                      'expense_linked', 'resolution_noted', 'marked_duplicate',
                      'note_added', 'photo_added',
                      'quote_requested', 'quote_received', 'quote_accepted', 'quote_declined')),
  from_value        text,
  to_value          text,
  data              jsonb not null default '{}'::jsonb,
  visible_to_owners boolean not null,
  actor_user_id     uuid references auth.users(id),
  actor_person_id   uuid references public.persons(id) on delete set null,
  created_at        timestamptz not null default now(),
  check (octet_length(data::text) <= 4096)
);

create index ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at);
create index ticket_events_assoc_idx  on public.ticket_events (association_id, created_at desc);

comment on table public.ticket_events is
  'Timeline of a ticket, written only by triggers (no write policies). A log, so not audited. visible_to_owners decides what owners see. Costs, quotes, assignee and target date are board and accountant only; internal-note events are board only (the accountant cannot read internal notes either).';

alter table public.ticket_events enable row level security;

create policy ticket_events_select on public.ticket_events
  for select to authenticated
  using (
    case
      when kind = 'note_added' and coalesce((data->>'internal')::boolean, false)
        then public.is_board(association_id)
      else
        public.can_read_financials(association_id)
        or (
          visible_to_owners
          and public.ticket_association_id(ticket_id) = association_id
        )
    end
  );
-- No insert/update/delete policies: only the SECURITY DEFINER triggers write.

-- "When did anything last happen on this ticket", for sort=updated. Under the
-- caller's RLS, so an owner's "last activity" ignores board-only events.
create view public.ticket_last_activity
with (security_invoker = true) as
select e.ticket_id, max(e.created_at) as last_activity_at
  from public.ticket_events e
 group by e.ticket_id;

grant select on public.ticket_last_activity to authenticated;

-- Event-writing triggers. Two sources: the ticket row (owner-visible facts
-- and the board's edits) and the board-details row (always board-only).
create or replace function public.tg_ticket_events()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_person uuid := case when auth.uid() is null then null
                        else public.current_person_id(new.association_id) end;
  v_name   text;
  v_fields text[] := '{}';
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_events (association_id, ticket_id, kind, to_value, visible_to_owners, actor_user_id, actor_person_id, created_at)
    values (new.association_id, new.id, 'created', new.status::text, true, v_actor, v_person, new.created_at);
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.ticket_events (association_id, ticket_id, kind, from_value, to_value, visible_to_owners, actor_user_id, actor_person_id)
    values (new.association_id, new.id,
            case when old.status in ('resolved', 'closed') and new.status not in ('resolved', 'closed')
                 then 'reopened' else 'status_changed' end,
            old.status::text, new.status::text, true, v_actor, v_person);
  end if;

  if new.priority is distinct from old.priority then
    insert into public.ticket_events (association_id, ticket_id, kind, from_value, to_value, visible_to_owners, actor_user_id, actor_person_id)
    values (new.association_id, new.id, 'priority_changed', old.priority::text, new.priority::text, true, v_actor, v_person);
  end if;

  if new.assigned_vendor_id is distinct from old.assigned_vendor_id then
    if new.assigned_vendor_id is null then
      insert into public.ticket_events (association_id, ticket_id, kind, visible_to_owners, actor_user_id, actor_person_id)
      values (new.association_id, new.id, 'contractor_removed', true, v_actor, v_person);
    else
      select v.name into v_name from public.vendors v where v.id = new.assigned_vendor_id;
      insert into public.ticket_events (association_id, ticket_id, kind, data, visible_to_owners, actor_user_id, actor_person_id)
      values (new.association_id, new.id, 'contractor_assigned',
              jsonb_build_object('vendor_id', new.assigned_vendor_id, 'contractor_name', v_name),
              true, v_actor, v_person);
    end if;
  end if;

  if new.scheduled_for is distinct from old.scheduled_for
     or new.scheduled_window is distinct from old.scheduled_window then
    insert into public.ticket_events (association_id, ticket_id, kind, from_value, to_value, data, visible_to_owners, actor_user_id, actor_person_id)
    values (new.association_id, new.id,
            case when new.scheduled_for is null then 'schedule_cleared' else 'scheduled' end,
            old.scheduled_for::text, new.scheduled_for::text,
            jsonb_build_object('window', new.scheduled_window), true, v_actor, v_person);
  end if;

  if new.trade is distinct from old.trade then
    insert into public.ticket_events (association_id, ticket_id, kind, from_value, to_value, visible_to_owners, actor_user_id, actor_person_id)
    values (new.association_id, new.id, 'trade_changed', old.trade, new.trade, false, v_actor, v_person);
  end if;

  -- array_append, not ||: text[] || 'title' reads the literal as an array.
  if new.title is distinct from old.title then v_fields := array_append(v_fields, 'title'); end if;
  if new.description is distinct from old.description then v_fields := array_append(v_fields, 'description'); end if;
  if new.location_detail is distinct from old.location_detail then v_fields := array_append(v_fields, 'location_detail'); end if;
  if new.access_notes is distinct from old.access_notes then v_fields := array_append(v_fields, 'access_notes'); end if;
  if new.unit_id is distinct from old.unit_id then v_fields := array_append(v_fields, 'unit'); end if;
  if cardinality(v_fields) > 0 then
    insert into public.ticket_events (association_id, ticket_id, kind, data, visible_to_owners, actor_user_id, actor_person_id)
    values (new.association_id, new.id, 'details_edited', jsonb_build_object('fields', to_jsonb(v_fields)), true, v_actor, v_person);
  end if;

  if new.resolution_note is distinct from old.resolution_note and new.resolution_note is not null then
    insert into public.ticket_events (association_id, ticket_id, kind, visible_to_owners, actor_user_id, actor_person_id)
    values (new.association_id, new.id, 'resolution_noted', true, v_actor, v_person);
  end if;

  if new.duplicate_of_id is distinct from old.duplicate_of_id and new.duplicate_of_id is not null then
    insert into public.ticket_events (association_id, ticket_id, kind, data, visible_to_owners, actor_user_id, actor_person_id)
    select new.association_id, new.id, 'marked_duplicate',
           jsonb_build_object('duplicate_of_id', d.id, 'duplicate_of_reference', d.reference),
           true, v_actor, v_person
      from public.tickets d where d.id = new.duplicate_of_id;
  end if;

  return null;
end $$;

revoke all on function public.tg_ticket_events() from public, anon;
grant execute on function public.tg_ticket_events() to authenticated;

create trigger tickets_events
  after insert or update on public.tickets
  for each row execute function public.tg_ticket_events();

-- Board-only facts. Insert compares against "nothing recorded".
create or replace function public.tg_ticket_board_details_events()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_person uuid := case when auth.uid() is null then null
                        else public.current_person_id(new.association_id) end;
  o_assignee uuid;  o_due date;  o_est numeric;  o_act numeric;  o_exp uuid;
begin
  if tg_op = 'UPDATE' then
    o_assignee := old.assignee_person_id; o_due := old.due_on;
    o_est := old.estimated_cost; o_act := old.actual_cost; o_exp := old.expense_id;
  end if;

  if new.assignee_person_id is distinct from o_assignee then
    insert into public.ticket_events (association_id, ticket_id, kind, data, visible_to_owners, actor_user_id, actor_person_id)
    values (new.association_id, new.ticket_id, 'assignee_changed',
            jsonb_build_object('person_id', new.assignee_person_id), false, v_actor, v_person);
  end if;
  if new.due_on is distinct from o_due then
    insert into public.ticket_events (association_id, ticket_id, kind, from_value, to_value, visible_to_owners, actor_user_id, actor_person_id)
    values (new.association_id, new.ticket_id, 'due_changed', o_due::text, new.due_on::text, false, v_actor, v_person);
  end if;
  if new.estimated_cost is distinct from o_est then
    insert into public.ticket_events (association_id, ticket_id, kind, from_value, to_value, visible_to_owners, actor_user_id, actor_person_id)
    values (new.association_id, new.ticket_id, 'estimate_changed', o_est::text, new.estimated_cost::text, false, v_actor, v_person);
  end if;
  if new.actual_cost is distinct from o_act then
    insert into public.ticket_events (association_id, ticket_id, kind, from_value, to_value, visible_to_owners, actor_user_id, actor_person_id)
    values (new.association_id, new.ticket_id, 'final_cost_recorded', o_act::text, new.actual_cost::text, false, v_actor, v_person);
  end if;
  if new.expense_id is distinct from o_exp and new.expense_id is not null then
    insert into public.ticket_events (association_id, ticket_id, kind, data, visible_to_owners, actor_user_id, actor_person_id)
    values (new.association_id, new.ticket_id, 'expense_linked', jsonb_build_object('expense_id', new.expense_id), false, v_actor, v_person);
  end if;
  return null;
end $$;

revoke all on function public.tg_ticket_board_details_events() from public, anon;
grant execute on function public.tg_ticket_board_details_events() to authenticated;

create trigger ticket_board_details_events
  after insert or update on public.ticket_board_details
  for each row execute function public.tg_ticket_board_details_events();

create or replace function public.tg_ticket_comment_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.ticket_events (association_id, ticket_id, kind, data, visible_to_owners, actor_user_id, actor_person_id, created_at)
  values (new.association_id, new.ticket_id, 'note_added',
          jsonb_build_object('comment_id', new.id, 'internal', new.is_internal, 'comment_kind', new.kind),
          not new.is_internal, auth.uid(), new.person_id, new.created_at);
  return null;
end $$;

revoke all on function public.tg_ticket_comment_event() from public, anon;
grant execute on function public.tg_ticket_comment_event() to authenticated;

create trigger ticket_comments_event
  after insert on public.ticket_comments
  for each row execute function public.tg_ticket_comment_event();

-- Backfill: one created event per existing ticket, a status_changed for
-- tickets already done, one note_added per surviving comment, so old tickets
-- do not show an empty timeline. These write ticket_events directly (as the
-- migration owner), so no trigger fires. The join is belt and braces: part 1
-- already deleted every cross-association comment.
insert into public.ticket_events (association_id, ticket_id, kind, to_value, visible_to_owners, actor_person_id, created_at)
select t.association_id, t.id, 'created', 'open', true, t.reported_by, t.created_at from public.tickets t;

insert into public.ticket_events (association_id, ticket_id, kind, from_value, to_value, visible_to_owners, created_at)
select t.association_id, t.id, 'status_changed', 'open', t.status::text, true, t.resolved_at
  from public.tickets t where t.resolved_at is not null;

insert into public.ticket_events (association_id, ticket_id, kind, data, visible_to_owners, actor_person_id, created_at)
select c.association_id, c.ticket_id, 'note_added',
       jsonb_build_object('comment_id', c.id, 'internal', false, 'comment_kind', 'note'), true, c.person_id, c.created_at
  from public.ticket_comments c
  join public.tickets t on t.id = c.ticket_id and t.association_id = c.association_id;

-- ============================================================================
-- 10. QUOTES: ticket_bids
-- ============================================================================

create table public.ticket_bids (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  ticket_id      uuid not null references public.tickets(id) on delete restrict,
  vendor_id      uuid not null references public.vendors(id) on delete restrict,
  -- requested: we asked; received: they quoted; accepted: chosen;
  -- declined: not chosen by us; withdrawn: no quote from them (or we stopped asking).
  status         text not null default 'requested'
                   check (status in ('requested', 'received', 'accepted', 'declined', 'withdrawn')),
  requested_by_phone boolean not null default false,
  requested_on   date,
  message_id     uuid references public.contractor_messages(id) on delete set null,
  amount         numeric(14,2) check (amount is null or amount >= 0),
  amount_kind    text not null default 'fixed' check (amount_kind in ('fixed', 'estimate', 'not_to_exceed')),
  received_on    date,
  valid_until    date,
  can_start_on   date,
  duration_text  text check (duration_text is null or char_length(duration_text) <= 120),
  scope_text     text check (scope_text is null or char_length(scope_text) <= 2000),
  warranty_text  text check (warranty_text is null or char_length(warranty_text) <= 300),
  exclusions_text text check (exclusions_text is null or char_length(exclusions_text) <= 600),
  payment_terms_text text check (payment_terms_text is null or char_length(payment_terms_text) <= 200),
  notes          text check (notes is null or char_length(notes) <= 2000),
  document_id    uuid references public.documents(id) on delete set null,
  decided_at     timestamptz,
  decided_by     uuid references auth.users(id),
  decline_reason text check (decline_reason is null or char_length(decline_reason) <= 300),
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (status in ('requested', 'withdrawn') or amount is not null),
  check ((status in ('accepted', 'declined')) = (decided_at is not null))
);

create unique index ticket_bids_one_live_per_contractor
  on public.ticket_bids (ticket_id, vendor_id) where status in ('requested', 'received', 'accepted');
create unique index ticket_bids_one_accepted
  on public.ticket_bids (ticket_id) where status = 'accepted';
create index ticket_bids_assoc_ticket_idx on public.ticket_bids (association_id, ticket_id);
create index ticket_bids_assoc_vendor_idx on public.ticket_bids (association_id, vendor_id);
create index ticket_bids_message_idx      on public.ticket_bids (message_id) where message_id is not null;

comment on table public.ticket_bids is
  'Quotes for a ticket: who was asked (by email draft or by phone), what they quoted, which was accepted. Recording offers, not placing work: accepting assigns the contractor and estimate in Walkup only; the board tells the contractor themselves.';
comment on column public.ticket_bids.payment_terms_text is
  'Deposit and payment terms as the contractor stated them ("50% deposit, balance on completion"). Shown in the comparison because a large up-front deposit is the main risk with small contractors.';

alter table public.ticket_bids enable row level security;

create policy ticket_bids_select on public.ticket_bids
  for select to authenticated using (public.can_read_financials(association_id));
create policy ticket_bids_insert on public.ticket_bids
  for insert to authenticated with check (public.is_board(association_id));
create policy ticket_bids_update on public.ticket_bids
  for update to authenticated
  using (public.is_board(association_id)) with check (public.is_board(association_id));
create policy ticket_bids_delete on public.ticket_bids
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create or replace function public.tg_ticket_bids_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.association_id := old.association_id;
    new.ticket_id      := old.ticket_id;
    new.vendor_id      := old.vendor_id;
    new.created_by     := old.created_by;
    new.created_at     := old.created_at;
  elsif auth.uid() is not null then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;

  if not exists (select 1 from public.tickets t where t.id = new.ticket_id and t.association_id = new.association_id) then
    raise exception 'ticket belongs to a different association' using errcode = '42501';
  end if;
  if not exists (select 1 from public.vendors v where v.id = new.vendor_id and v.association_id = new.association_id) then
    raise exception 'contractor belongs to a different association' using errcode = '42501';
  end if;
  if new.message_id is not null and not exists (
    select 1 from public.contractor_messages m
     where m.id = new.message_id and m.association_id = new.association_id and m.vendor_id = new.vendor_id
  ) then
    raise exception 'message belongs to a different association or contractor' using errcode = '42501';
  end if;
  if new.document_id is not null and not exists (
    select 1 from public.documents d where d.id = new.document_id and d.association_id = new.association_id
  ) then
    raise exception 'document belongs to a different association' using errcode = '42501';
  end if;

  -- Decision stamps follow the status, whatever the client sent.
  if new.status in ('accepted', 'declined') then
    if tg_op = 'INSERT' then
      new.decided_at := now();
      new.decided_by := auth.uid();
    elsif old.status <> new.status then
      new.decided_at := now();
      new.decided_by := auth.uid();
    else
      new.decided_at := old.decided_at;
      new.decided_by := old.decided_by;
    end if;
  else
    new.decided_at := null;
    new.decided_by := null;
    new.decline_reason := null;
  end if;
  if new.status = 'received' and new.received_on is null then
    new.received_on := (now() at time zone 'America/Chicago')::date;
  end if;
  -- A phone request was "asked" the day it was recorded.
  if tg_op = 'INSERT' and new.requested_by_phone and new.requested_on is null then
    new.requested_on := (now() at time zone 'America/Chicago')::date;
  end if;
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.tg_ticket_bids_guard() from public, anon;
grant execute on function public.tg_ticket_bids_guard() to authenticated;

create trigger ticket_bids_10_guard
  before insert or update on public.ticket_bids
  for each row execute function public.tg_ticket_bids_guard();

create trigger audit_ticket_bids
  after insert or update or delete on public.ticket_bids
  for each row execute function public.tg_audit();

create or replace function public.tg_ticket_bid_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_kind text;
  v_name text;
begin
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then
      return null;
    end if;
  end if;
  v_kind := case new.status
              when 'requested' then 'quote_requested'
              when 'received'  then 'quote_received'
              when 'accepted'  then 'quote_accepted'
              when 'declined'  then 'quote_declined'
              else null end;
  if v_kind is null then return null; end if;
  select v.name into v_name from public.vendors v where v.id = new.vendor_id;
  insert into public.ticket_events (association_id, ticket_id, kind, data, visible_to_owners, actor_user_id, actor_person_id)
  values (new.association_id, new.ticket_id, v_kind,
          jsonb_build_object('bid_id', new.id, 'vendor_id', new.vendor_id, 'contractor_name', v_name,
                             'amount', new.amount::text, 'by_phone', new.requested_by_phone),
          false, auth.uid(),
          case when auth.uid() is null then null else public.current_person_id(new.association_id) end);
  return null;
end $$;

revoke all on function public.tg_ticket_bid_event() from public, anon;
grant execute on function public.tg_ticket_bid_event() to authenticated;

create trigger ticket_bids_event
  after insert or update of status on public.ticket_bids
  for each row execute function public.tg_ticket_bid_event();

-- Now that ticket_bids exists: the "marked as sent" follow-ups from part 7.
create trigger contractor_messages_30_sent
  after update of status on public.contractor_messages
  for each row execute function public.tg_contractor_messages_sent();

-- Accept a quote (SECURITY INVOKER: the board can already write all three
-- tables; the function makes the writes one transaction). It chooses the
-- contractor and records the estimate. It does not change the ticket's
-- status: nobody has told the contractor yet. The status moves to
-- in_progress when the go-ahead email is marked sent or the board sets it.
create or replace function public.accept_ticket_bid(p_bid_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_bid public.ticket_bids%rowtype;
begin
  select * into v_bid from public.ticket_bids b where b.id = p_bid_id;
  if not found or not public.is_board(v_bid.association_id) then
    raise exception 'only a board member can accept a quote' using errcode = '42501';
  end if;
  if v_bid.amount is null then
    raise exception 'record the amount before accepting this quote' using errcode = '22023';
  end if;

  -- Serialise with any other accept or close-out on this ticket.
  perform 1 from public.tickets t where t.id = v_bid.ticket_id for update;

  -- Anything else still live for this ticket is "not chosen". Done first so
  -- the one-accepted index is never violated mid-statement. A request that
  -- never got an amount becomes "no quote" (withdrawn): the table refuses a
  -- declined row without an amount.
  update public.ticket_bids
     set status = case when amount is null then 'withdrawn' else 'declined' end,
         decline_reason = case when amount is null then null else 'Another quote was accepted.' end
   where ticket_id = v_bid.ticket_id and id <> v_bid.id and status in ('requested', 'received', 'accepted');

  update public.ticket_bids set status = 'accepted' where id = v_bid.id;

  update public.tickets
     set assigned_vendor_id = v_bid.vendor_id
   where id = v_bid.ticket_id;

  insert into public.ticket_board_details (ticket_id, association_id, estimated_cost)
  values (v_bid.ticket_id, v_bid.association_id, v_bid.amount)
  on conflict (ticket_id) do update set estimated_cost = excluded.estimated_cost;
end $$;

revoke all on function public.accept_ticket_bid(uuid) from public, anon;
grant execute on function public.accept_ticket_bid(uuid) to authenticated;

-- Request quotes in one transaction: every bid, every draft, and the link
-- between them, or nothing. The email text is built in TypeScript from the
-- deterministic templates and passed in; the function validates and writes.
-- p_requests: [{ "vendor_id": uuid, "by_phone": bool,
--                "to_email": text|null, "subject": text|null, "body": text|null }]
-- by_phone = true records a "requested" bid with no message (the board calls).
create or replace function public.request_ticket_quotes(p_ticket_id uuid, p_requests jsonb)
returns table (vendor_id uuid, bid_id uuid, message_id uuid, outcome text)
language plpgsql security invoker set search_path = ''
as $$
#variable_conflict use_column
declare
  v_ticket  public.tickets%rowtype;
  r         jsonb;
  v_vendor  uuid;
  v_phone   boolean;
  v_bid     uuid;
  v_msg     uuid;
begin
  select * into v_ticket from public.tickets t where t.id = p_ticket_id;
  if not found or not public.is_board(v_ticket.association_id) then
    raise exception 'only a board member can ask for quotes' using errcode = '42501';
  end if;
  if p_requests is null or jsonb_typeof(p_requests) <> 'array' then
    raise exception 'choose between one and five contractors' using errcode = '22023';
  end if;
  if jsonb_array_length(p_requests) not between 1 and 5 then
    raise exception 'choose between one and five contractors' using errcode = '22023';
  end if;

  perform 1 from public.tickets t where t.id = p_ticket_id for update;

  for r in select * from jsonb_array_elements(p_requests) loop
    v_vendor := (r->>'vendor_id')::uuid;
    v_phone  := coalesce((r->>'by_phone')::boolean, false);

    if not exists (
      select 1 from public.vendors v
       where v.id = v_vendor and v.association_id = v_ticket.association_id
         and v.archived_at is null and v.status <> 'do_not_use'
    ) then
      return query select v_vendor, null::uuid, null::uuid, 'not_available'::text;
      continue;
    end if;
    if exists (
      select 1 from public.ticket_bids b
       where b.ticket_id = p_ticket_id and b.vendor_id = v_vendor
         and b.status in ('requested', 'received', 'accepted')
    ) then
      return query select v_vendor, null::uuid, null::uuid, 'already_asked'::text;
      continue;
    end if;

    v_msg := null;
    if not v_phone then
      if nullif(btrim(coalesce(r->>'subject', '')), '') is null
         or nullif(btrim(coalesce(r->>'body', '')), '') is null then
        raise exception 'each email needs a subject and a message' using errcode = '22023';
      end if;
      insert into public.contractor_messages (association_id, vendor_id, ticket_id, kind, subject, body, to_email, status)
      values (v_ticket.association_id, v_vendor, p_ticket_id, 'quote_request',
              left(r->>'subject', 200), left(r->>'body', 10000), nullif(btrim(coalesce(r->>'to_email', '')), ''), 'draft')
      on conflict do nothing
      returning id into v_msg;
      if v_msg is null then
        -- An open quote-request draft for this contractor and ticket already
        -- exists (one-draft index): reuse it.
        select m.id into v_msg from public.contractor_messages m
         where m.vendor_id = v_vendor and m.ticket_id = p_ticket_id
           and m.kind = 'quote_request' and m.status = 'draft';
      end if;
    end if;

    insert into public.ticket_bids (association_id, ticket_id, vendor_id, status, requested_by_phone, message_id)
    values (v_ticket.association_id, p_ticket_id, v_vendor, 'requested', v_phone, v_msg)
    returning id into v_bid;

    return query select v_vendor, v_bid, v_msg, case when v_phone then 'by_phone' else 'drafted' end;
  end loop;
end $$;

revoke all on function public.request_ticket_quotes(uuid, jsonb) from public, anon;
grant execute on function public.request_ticket_quotes(uuid, jsonb) to authenticated;

-- ============================================================================
-- 11. CONTRACTORS: vendors v2, reviews, notes log
-- ============================================================================

alter table public.vendors
  add column archived_at            timestamptz,
  add column archived_reason        text check (archived_reason is null or char_length(archived_reason) <= 300),
  add column emergency_service      boolean not null default false,
  add column job_tags               text[] not null default '{}'
    check (job_tags <@ array['condo_work', 'small_jobs', 'free_estimates']::text[]),
  add column source_urls            text[] not null default '{}',
  add column google_business_status text,
  add column rate_hourly            numeric(14,2) check (rate_hourly is null or rate_hourly >= 0),
  add column rate_trip_fee          numeric(14,2) check (rate_trip_fee is null or rate_trip_fee >= 0),
  add column rate_after_hours       numeric(14,2) check (rate_after_hours is null or rate_after_hours >= 0),
  add column rates_as_of            date,
  add column payment_methods        text check (payment_methods is null or char_length(payment_methods) <= 120),
  add column other_contact_name     text check (other_contact_name is null or char_length(other_contact_name) <= 120),
  add column other_contact_role     text check (other_contact_role is null or char_length(other_contact_role) <= 60),
  add column other_contact_phone    text check (other_contact_phone is null or char_length(other_contact_phone) <= 40),
  add column other_contact_email    text check (other_contact_email is null or char_length(other_contact_email) <= 200),
  add column updated_at             timestamptz not null default now();

alter table public.vendors drop constraint vendors_source_check;
alter table public.vendors add constraint vendors_source_check
  check (source in ('manual', 'google', 'web'));

comment on column public.vendors.archived_at is
  'Archived contractors are hidden from lists and pickers but keep their history, payments and 1099s.';
comment on column public.vendors.emergency_service is
  'The board says this contractor takes emergency or after-hours calls. Board-entered, not verified; the UI says so.';
comment on column public.vendors.job_tags is
  'Board-entered facts used by "What matters for this job" on the find page: condo_work, small_jobs, free_estimates.';
comment on column public.vendors.rate_hourly is
  'Rates the board was quoted, as of rates_as_of. Board-entered; never shown to owners.';
comment on column public.vendors.source_urls is
  'For source = web: the cited pages the contractor was found on (anti-fabrication record, brief decision 5).';

create or replace function public.tg_vendors_touch()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.tg_vendors_touch() from public, anon;
grant execute on function public.tg_vendors_touch() to authenticated;

-- The UI renders these as links, so they must be http(s) (REVIEW-1 #15), like
-- insurance_contacts in 0052. A trigger, not CHECK ... NOT VALID, so a legacy
-- row with an odd URL stays editable (see finding 3): the URLs are checked on
-- insert and when they change.
create or replace function public.tg_vendors_urls_ok()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.website_url is distinct from old.website_url)
     and new.website_url is not null and new.website_url !~* '^https?://[^[:space:]]+$' then
    raise exception 'the website must start with http:// or https://' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.source_urls is distinct from old.source_urls)
     and not public.insurance_urls_ok(new.source_urls) then
    raise exception 'source links must start with http:// or https://' using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function public.tg_vendors_urls_ok() from public, anon;
grant execute on function public.tg_vendors_urls_ok() to authenticated;

create trigger vendors_urls_ok
  before insert or update on public.vendors
  for each row execute function public.tg_vendors_urls_ok();

create trigger vendors_touch
  before update on public.vendors
  for each row execute function public.tg_vendors_touch();

alter table public.contractor_reviews
  add column edited_at timestamptz,
  add column tags      text[] not null default '{}'
    check (tags <@ array['on_time', 'left_clean', 'price_matched', 'would_hire_again']::text[]),
  add column upkeep_log_id uuid references public.upkeep_log(id) on delete set null;

create or replace function public.tg_contractor_reviews_text_limits()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.body is distinct from old.body)
     and new.body is not null and char_length(new.body) > 4000 then
    raise exception 'a review must be 4000 characters or fewer' using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function public.tg_contractor_reviews_text_limits() from public, anon;
grant execute on function public.tg_contractor_reviews_text_limits() to authenticated;

create trigger contractor_reviews_12_text_limits
  before insert or update on public.contractor_reviews
  for each row execute function public.tg_contractor_reviews_text_limits();

comment on column public.contractor_reviews.tags is
  'Quick tags chosen on a phone: on_time, left_clean, price_matched, would_hire_again. Counted on the find page ("Your board: would hire again (3)").';

-- CLAUDE.md: board_member has no deletes. 0040 let the author delete their
-- own review; that becomes board_admin only, like every other delete here.
drop policy contractor_reviews_delete on public.contractor_reviews;
create policy contractor_reviews_delete on public.contractor_reviews
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create or replace function public.tg_contractor_reviews_edit()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.association_id := old.association_id;
  new.vendor_id      := old.vendor_id;
  new.created_by     := old.created_by;
  new.created_at     := old.created_at;
  if new.rating is distinct from old.rating or new.body is distinct from old.body
     or new.ticket_id is distinct from old.ticket_id or new.tags is distinct from old.tags then
    new.edited_at := now();
  end if;
  return new;
end $$;

revoke all on function public.tg_contractor_reviews_edit() from public, anon;
grant execute on function public.tg_contractor_reviews_edit() to authenticated;

-- Fires after 0040's contractor_review_association guard (Postgres fires
-- same-timing triggers in name order and "_" sorts before "s"). That is fine:
-- the guard refuses a cross-association vendor_id outright, and this trigger
-- then pins vendor_id to its old value for any same-association change.
create trigger contractor_reviews_05_edit
  before update on public.contractor_reviews
  for each row execute function public.tg_contractor_reviews_edit();

-- The new upkeep_log link needs the same guard as the 0040 ticket link.
create or replace function public.tg_contractor_reviews_upkeep_link()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_at := now();
  end if;
  if new.upkeep_log_id is not null and not exists (
    select 1 from public.upkeep_log l where l.id = new.upkeep_log_id and l.association_id = new.association_id
  ) then
    raise exception 'upkeep entry belongs to a different association' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_contractor_reviews_upkeep_link() from public, anon;
grant execute on function public.tg_contractor_reviews_upkeep_link() to authenticated;

create trigger contractor_reviews_20_upkeep_link
  before insert or update on public.contractor_reviews
  for each row execute function public.tg_contractor_reviews_upkeep_link();

create table public.contractor_notes (
  id               uuid primary key default gen_random_uuid(),
  association_id   uuid not null references public.associations(id) on delete restrict,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  body             text not null check (char_length(btrim(body)) between 1 and 4000),
  created_by       uuid references auth.users(id) default auth.uid(),
  author_person_id uuid references public.persons(id) on delete set null,
  created_at       timestamptz not null default now(),
  edited_at        timestamptz
);

create index contractor_notes_vendor_idx on public.contractor_notes (association_id, vendor_id, created_at desc);

comment on table public.contractor_notes is
  'Dated, attributed notes about a contractor ("called Tuesday, quoted $400 by phone"). Board-only like reviews; vendors.notes stays as the one-paragraph summary. Authors edit their own; only a board admin deletes.';

alter table public.contractor_notes enable row level security;

create policy contractor_notes_select on public.contractor_notes
  for select to authenticated using (public.is_board(association_id));
create policy contractor_notes_insert on public.contractor_notes
  for insert to authenticated with check (public.is_board(association_id) and created_by = auth.uid());
create policy contractor_notes_update on public.contractor_notes
  for update to authenticated
  using (created_by = auth.uid() and public.is_board(association_id))
  with check (created_by = auth.uid() and public.is_board(association_id));
create policy contractor_notes_delete on public.contractor_notes
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create or replace function public.tg_contractor_notes_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.association_id   := old.association_id;
    new.vendor_id        := old.vendor_id;
    new.created_by       := old.created_by;
    new.author_person_id := old.author_person_id;
    new.created_at       := old.created_at;
    new.edited_at        := case when new.body is distinct from old.body then now() else old.edited_at end;
    return new;
  end if;
  if auth.uid() is not null then
    new.author_person_id := public.current_person_id(new.association_id);
    new.created_at       := now();
    new.edited_at        := null;
  end if;
  if not exists (select 1 from public.vendors v where v.id = new.vendor_id and v.association_id = new.association_id) then
    raise exception 'contractor belongs to a different association' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_contractor_notes_guard() from public, anon;
grant execute on function public.tg_contractor_notes_guard() to authenticated;

create trigger contractor_notes_10_guard
  before insert or update on public.contractor_notes
  for each row execute function public.tg_contractor_notes_guard();

create trigger audit_contractor_notes
  after insert or update or delete on public.contractor_notes
  for each row execute function public.tg_audit();

-- ============================================================================
-- 12. SEARCH CACHE v2 (with background-run status), Google call budget,
--     building coordinates
-- ============================================================================

alter table public.contractor_search_cache
  drop constraint contractor_search_cache_association_id_trade_key,
  add column provider       text  not null default 'google' check (provider in ('google', 'web')),
  add column query_key      text  not null default '',
  add column location_key   text  not null default '',
  add column sources_json   jsonb not null default '[]'::jsonb,
  add column dropped_count  integer not null default 0 check (dropped_count >= 0),
  -- Foundation 5.3 status-row columns, so web research runs in after() and
  -- the page polls (jobs.ts claimAiRun / finishAiRun work on this table).
  add column ai_state       text not null default 'done' check (ai_state in ('idle', 'running', 'done', 'failed')),
  add column ai_started_at  timestamptz,
  add column ai_finished_at timestamptz,
  add column ai_error       text check (ai_error is null or length(ai_error) <= 500),
  add constraint contractor_search_cache_key unique (association_id, provider, trade, query_key, location_key);

comment on table public.contractor_search_cache is
  'Cached contractor search results per (association, provider, trade, query, location). Google rows live 24 hours (brief decision 10), web-research rows 7 days. location_key changes when the building moves, so an address change misses the cache. Web rows double as the background-run status (ai_state). A cache, so not audited.';
comment on column public.contractor_search_cache.dropped_count is
  'Web research only: how many businesses the model listed that verification dropped because their details could not be confirmed from the cited sources.';

create policy contractor_search_cache_delete on public.contractor_search_cache
  for delete to authenticated using (public.is_board(association_id));

-- Count of Google calls today (America/Chicago, the same day boundary as the
-- foundation's ai_calls_today) for the soft daily cap. DEFINER because it is
-- a count across the table (DECISIONS #23); returns 0 for non-board callers.
create or replace function public.google_calls_today(p_association_id uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select case when public.is_board(p_association_id)
              then (select count(*)::int from public.google_api_calls g
                     where g.association_id = p_association_id
                       and g.called_at >= (date_trunc('day', now() at time zone 'America/Chicago')
                                           at time zone 'America/Chicago'))
              else 0 end
$$;

revoke all on function public.google_calls_today(uuid) from public, anon;
grant execute on function public.google_calls_today(uuid) to authenticated;

-- A board member's search geocodes the building once and stores the result.
-- associations_update is board_admin-only, so without this every
-- board_member search geocoded again. Only fills empty coordinates; an admin
-- changing the address re-geocodes in Building Info.
create or replace function public.set_association_coordinates(
  p_association_id uuid, p_latitude numeric, p_longitude numeric)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_board(p_association_id) then
    raise exception 'only a board member can do this' using errcode = '42501';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'coordinates out of range' using errcode = '22023';
  end if;
  update public.associations
     set latitude = round(p_latitude, 6), longitude = round(p_longitude, 6)
   where id = p_association_id and latitude is null and longitude is null;
  return found;
end $$;

revoke all on function public.set_association_coordinates(uuid, numeric, numeric) from public, anon;
grant execute on function public.set_association_coordinates(uuid, numeric, numeric) to authenticated;

-- ============================================================================
-- 13. UPKEEP v2
-- ============================================================================

-- The schedule rule, in SQL so the log trigger and the mark-done RPC agree
-- with each other. src/lib/upkeep/schedule.ts mirrors it exactly; a DB test
-- runs the same case table (tests/fixtures/upkeep-cases.ts) through both.
--
-- Without a preferred month: done + interval (Postgres clamps to the end of
-- a shorter month: Jan 31 + 1 month = Feb 28/29).
-- With a preferred month: the due dates are month-ends of the "anchor"
-- months (the preferred month, and every interval after it when the
-- interval divides a year: every 6 months anchored April = April and
-- October). The next due date is the first anchor month-end on or after
-- done + interval - half a cycle, where a cycle is min(interval, 12) months.
-- That picks the anchor nearest to done + interval, so an early or late
-- completion keeps the task on its season instead of drifting.
create or replace function public.upkeep_next_due(p_done date, p_interval integer, p_due_month integer)
returns date
language plpgsql immutable set search_path = ''
as $$
declare
  v_step   integer;
  v_lower  date;
  v_anchor date;
  v_due    date;
begin
  if p_done is null or p_interval is null or p_interval < 1 then
    return null;
  end if;
  if p_due_month is null then
    return (p_done + make_interval(months => p_interval))::date;
  end if;
  v_step  := least(p_interval, 12);
  v_lower := (p_done + make_interval(months => p_interval - v_step / 2))::date;
  v_anchor := make_date(extract(year from v_lower)::int - 1, p_due_month, 1);
  v_due := (v_anchor + interval '1 month' - interval '1 day')::date;
  while v_due < v_lower loop
    v_anchor := (v_anchor + make_interval(months => v_step))::date;
    v_due := (v_anchor + interval '1 month' - interval '1 day')::date;
  end loop;
  return v_due;
end $$;

revoke all on function public.upkeep_next_due(date, integer, integer) from public, anon;
grant execute on function public.upkeep_next_due(date, integer, integer) to authenticated;

alter table public.upkeep_tasks
  add column trade      text check (trade is null or trade ~ '^[a-z][a-z_]{1,30}$'),
  add column updated_at timestamptz not null default now();

-- Backfill 1: a preferred month only makes sense when the interval divides a
-- year or is whole years. Anything else (none in the UI's interval list, but
-- the column allowed it) drops the month rather than producing a schedule
-- nobody can explain.
update public.upkeep_tasks
   set due_month = null
 where due_month is not null
   and not (interval_months in (2, 3, 4, 6) or interval_months % 12 = 0);

alter table public.upkeep_tasks
  add constraint upkeep_tasks_due_month_fits_interval
    check (due_month is null or interval_months in (2, 3, 4, 6) or interval_months % 12 = 0);

-- Backfill 2: seasonal tasks are now "due by the end of the month", not the
-- 1st (a task added in its own month was overdue the moment it was created).
update public.upkeep_tasks
   set next_due_on = (date_trunc('month', next_due_on) + interval '1 month' - interval '1 day')::date
 where due_month is not null;

-- Backfill 3: sub-annual seasonal tasks that the old rule rolled forward a
-- whole year are recomputed from their last completion.
update public.upkeep_tasks
   set next_due_on = public.upkeep_next_due(last_done_on, interval_months, due_month)
 where due_month is not null and interval_months < 12 and last_done_on is not null;

-- Backfill 4: trade from the task name, with word boundaries (\m start of
-- word, \M end of word; a stem without \M matches longer words). A subset of
-- the keywords in guessTradeFromText() in src/lib/contractors/trades.ts,
-- which the app uses for tasks added later.
update public.upkeep_tasks set trade = case
    when name ~* '\mbackflow\M'                                                     then 'backflow'
    when name ~* '\msewer\M|\mrodd'                                                 then 'sewer'
    when name ~* '\mdryer vents?\M'                                                 then 'dryer_vent'
    when name ~* '\mextinguishers?\M|\msmoke\M|\mcarbon monoxide\M|\mco\M|\mfire alarms?\M|\msprinklers?\M' then 'fire_safety'
    when name ~* '\mgutters?\M|\mdownspouts?\M'                                     then 'gutters'
    when name ~* '\mchimneys?\M|\mflues?\M'                                         then 'chimney'
    when name ~* '\melevators?\M'                                                   then 'elevator'
    when name ~* '\mboilers?\M|\mfurnaces?\M|\mhvac\M|\mheat(ing)?\M|\mair condition' then 'hvac'
    when name ~* '\mroof|\mflashing\M'                                              then 'roofing'
    when name ~* '\mtuckpoint|\mmason|\mbricks?\M'                                  then 'masonry'
    when name ~* '\msump\M|\mejector\M|\mwater heaters?\M|\mplumb|\mpipes?\M'       then 'plumbing'
    when name ~* '\mpaint|\mwood\M|\mporch(es)?\M|\mtrim\M'                         then 'painting'
    when name ~* '\msnow\M'                                                         then 'snow'
    when name ~* '\mlandscap|\mlawns?\M|\mgardens?\M'                               then 'landscaping'
    when name ~* '\mtrees?\M'                                                       then 'tree'
    when name ~* '\mwindows?\M'                                                     then 'windows'
    when name ~* '\mclean'                                                          then 'cleaning'
    when name ~* '\mpests?\M|\mextermin'                                            then 'pest'
    else null end
 where trade is null;

create or replace function public.tg_upkeep_tasks_touch()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.association_id := old.association_id;
  new.created_by     := old.created_by;
  new.created_at     := old.created_at;
  new.updated_at     := now();
  return new;
end $$;

revoke all on function public.tg_upkeep_tasks_touch() from public, anon;
grant execute on function public.tg_upkeep_tasks_touch() to authenticated;

create trigger upkeep_tasks_05_touch
  before update on public.upkeep_tasks
  for each row execute function public.tg_upkeep_tasks_touch();

alter table public.upkeep_log
  add column edited_at timestamptz;

create or replace function public.tg_upkeep_log_limits()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' or new.done_on is distinct from old.done_on)
     and (new.done_on < date '2000-01-01' or new.done_on > current_date + 1) then
    raise exception 'the date done is out of range' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.note is distinct from old.note)
     and new.note is not null and char_length(new.note) > 1000 then
    raise exception 'a note must be 1000 characters or fewer' using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function public.tg_upkeep_log_limits() from public, anon;
grant execute on function public.tg_upkeep_log_limits() to authenticated;

create trigger upkeep_log_12_limits
  before insert or update on public.upkeep_log
  for each row execute function public.tg_upkeep_log_limits();

-- Deletes: board_admin only (CLAUDE.md: board_member has no deletes).
-- Log rows become editable by the board.
drop policy upkeep_tasks_delete on public.upkeep_tasks;
create policy upkeep_tasks_delete on public.upkeep_tasks
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

drop policy upkeep_log_delete on public.upkeep_log;
create policy upkeep_log_delete on public.upkeep_log
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create policy upkeep_log_update on public.upkeep_log
  for update to authenticated
  using (public.is_board(association_id)) with check (public.is_board(association_id));

create or replace function public.tg_upkeep_log_pin()
returns trigger
language plpgsql security definer set search_path = ''  -- calls auth.uid()
as $$
begin
  if tg_op = 'UPDATE' then
    new.association_id := old.association_id;
    new.task_id        := old.task_id;
    new.created_by     := old.created_by;
    new.created_at     := old.created_at;
    new.edited_at      := now();
  elsif auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end $$;

revoke all on function public.tg_upkeep_log_pin() from public, anon;
grant execute on function public.tg_upkeep_log_pin() to authenticated;

-- Sorts before 0045's upkeep_log_same_association guard.
create trigger upkeep_log_05_pin
  before insert or update on public.upkeep_log
  for each row execute function public.tg_upkeep_log_pin();

-- Keeps the task in step with its log: last_done_on is the latest done_on,
-- and next_due_on is recomputed whenever that latest date changes (a new
-- completion, an edited date, a deleted row). A backdated completion older
-- than the latest one changes nothing. DEFINER: it computes max() across the
-- log (DECISIONS #23).
--
-- The task row is locked first. Two concurrent mark-done calls then run this
-- one after the other, and under READ COMMITTED the second max() (a new
-- statement after the lock is granted) sees the first one's committed row,
-- so an older snapshot can never write an earlier date back.
create or replace function public.tg_upkeep_log_sync()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_task_id uuid := coalesce(new.task_id, old.task_id);
  v_task    record;
  v_last    date;
begin
  select k.id, k.interval_months, k.due_month, k.last_done_on
    into v_task
    from public.upkeep_tasks k where k.id = v_task_id
     for update;
  if not found then
    return null; -- the task itself is being deleted (cascade)
  end if;

  select max(l.done_on) into v_last from public.upkeep_log l where l.task_id = v_task_id;

  if v_last is distinct from v_task.last_done_on then
    update public.upkeep_tasks
       set last_done_on = v_last,
           next_due_on  = case when v_last is null then next_due_on
                               else public.upkeep_next_due(v_last, v_task.interval_months, v_task.due_month) end
     where id = v_task_id;
  end if;
  return null;
end $$;

revoke all on function public.tg_upkeep_log_sync() from public, anon;
grant execute on function public.tg_upkeep_log_sync() to authenticated;

create trigger upkeep_log_sync
  after insert or update of done_on or delete on public.upkeep_log
  for each row execute function public.tg_upkeep_log_sync();

-- Mark done in one call: the log row (the trigger rolls the schedule), and
-- "who usually does it" when a contractor is given. INVOKER: RLS already
-- limits both writes to the board.
create or replace function public.mark_upkeep_done(
  p_task_id   uuid,
  p_done_on   date,
  p_cost      numeric default null,
  p_vendor_id uuid    default null,
  p_note      text    default null,
  p_ticket_id uuid    default null)
returns table (log_id uuid, task_last_done_on date, task_next_due_on date)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_task public.upkeep_tasks%rowtype;
  v_log  uuid;
begin
  select * into v_task from public.upkeep_tasks k where k.id = p_task_id;
  if not found or not public.is_board(v_task.association_id) then
    raise exception 'only a board member can mark upkeep done' using errcode = '42501';
  end if;
  if p_done_on is null or p_done_on > current_date + 1 or p_done_on < date '2000-01-01' then
    raise exception 'pick the date it was done' using errcode = '22023';
  end if;
  if p_cost is not null and p_cost < 0 then
    raise exception 'the cost can''t be negative' using errcode = '22023';
  end if;

  insert into public.upkeep_log (association_id, task_id, done_on, vendor_id, cost, note, ticket_id)
  values (v_task.association_id, p_task_id, p_done_on, p_vendor_id, round(p_cost, 2),
          nullif(btrim(p_note), ''), p_ticket_id)
  returning id into v_log;

  if p_vendor_id is not null then
    update public.upkeep_tasks set vendor_id = p_vendor_id
     where id = p_task_id and vendor_id is distinct from p_vendor_id;
  end if;

  return query
    select v_log, k.last_done_on, k.next_due_on from public.upkeep_tasks k where k.id = p_task_id;
end $$;

revoke all on function public.mark_upkeep_done(uuid, date, numeric, uuid, text, uuid) from public, anon;
grant execute on function public.mark_upkeep_done(uuid, date, numeric, uuid, text, uuid) to authenticated;

-- A problem logs its upkeep at most once (closing the same ticket twice, or
-- a double submit, cannot log the job twice). upkeep_log.ticket_id has never
-- been written by the app, so no legacy row can collide.
create unique index upkeep_log_one_per_ticket
  on public.upkeep_log (ticket_id) where ticket_id is not null;

-- Add a task in one transaction, including its first history entry.
-- Which next-due date wins, in order:
--   1. p_next_due_on, when the board typed one (explicit always wins);
--   2. otherwise, when p_last_done_on is given, upkeep_next_due() from it
--      (the log trigger computes it when the history row is written);
--   3. otherwise p_initial_next_due, which the action computes with
--      initialNextDue(buildingTodayIso(), interval, month).
create or replace function public.add_upkeep_task(
  p_association_id  uuid,
  p_name            text,
  p_description     text,
  p_interval_months integer,
  p_due_month       integer,
  p_trade           text,
  p_vendor_id       uuid,
  p_estimated_cost  numeric,
  p_initial_next_due date,
  p_last_done_on    date default null,
  p_next_due_on     date default null)
returns table (task_id uuid, task_next_due_on date)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_board(p_association_id) then
    raise exception 'only a board member can add upkeep jobs' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null or char_length(p_name) > 120 then
    raise exception 'give the job a name under 120 characters' using errcode = '22023';
  end if;
  if p_interval_months is null or p_interval_months not in (1, 2, 3, 4, 6, 12, 24, 36, 60) then
    raise exception 'choose how often it''s done' using errcode = '22023';
  end if;
  if p_initial_next_due is null then
    raise exception 'missing next due date' using errcode = '22023';
  end if;
  if p_last_done_on is not null
     and (p_last_done_on > (now() at time zone 'America/Chicago')::date or p_last_done_on < date '2000-01-01') then
    raise exception 'the last-done date can''t be in the future' using errcode = '22023';
  end if;

  insert into public.upkeep_tasks (association_id, name, description, interval_months, due_month,
                                   trade, vendor_id, estimated_cost, next_due_on, created_by)
  values (p_association_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
          p_interval_months, p_due_month, p_trade, p_vendor_id, round(p_estimated_cost, 2),
          coalesce(p_next_due_on, p_initial_next_due), auth.uid())
  returning id into v_id;

  if p_last_done_on is not null then
    insert into public.upkeep_log (association_id, task_id, done_on)
    values (p_association_id, v_id, p_last_done_on);
    if p_next_due_on is not null then
      update public.upkeep_tasks set next_due_on = p_next_due_on where id = v_id;
    end if;
  end if;

  return query select k.id, k.next_due_on from public.upkeep_tasks k where k.id = v_id;
end $$;

revoke all on function public.add_upkeep_task(uuid, text, text, integer, integer, text, uuid, numeric, date, date, date) from public, anon;
grant execute on function public.add_upkeep_task(uuid, text, text, integer, integer, text, uuid, numeric, date, date, date) to authenticated;

-- ============================================================================
-- 14. BILLS v2
-- ============================================================================

alter table public.recurring_bills
  add column paused_at   timestamptz,
  add column paused_note text check (paused_note is null or char_length(paused_note) <= 200),
  add column last_paid_on date,
  add column updated_at  timestamptz not null default now();

comment on column public.recurring_bills.paused_at is
  'Paused bills stay listed but leave reminders (a seasonal contract, a disputed bill). is_active=false archives the bill.';

create table public.recurring_bill_payments (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  bill_id        uuid not null references public.recurring_bills(id) on delete restrict,
  paid_on        date not null check (paid_on >= date '2000-01-01'),
  due_on         date,
  amount         numeric(14,2) check (amount is null or amount >= 0),
  note           text check (note is null or char_length(note) <= 300),
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now()
);

create index recurring_bill_payments_bill_idx on public.recurring_bill_payments (bill_id, paid_on desc);

comment on table public.recurring_bill_payments is
  'A board member noting that a bill was paid (by them, at the provider). Walkup never pays; this records it and advances the next due date.';

alter table public.recurring_bill_payments enable row level security;

create policy recurring_bill_payments_select on public.recurring_bill_payments
  for select to authenticated using (public.can_read_financials(association_id));
create policy recurring_bill_payments_insert on public.recurring_bill_payments
  for insert to authenticated with check (public.is_board(association_id));
create policy recurring_bill_payments_update on public.recurring_bill_payments
  for update to authenticated
  using (public.is_board(association_id)) with check (public.is_board(association_id));
create policy recurring_bill_payments_delete on public.recurring_bill_payments
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create or replace function public.tg_recurring_bill_payments_same_association()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.recurring_bills b where b.id = new.bill_id and b.association_id = new.association_id
  ) then
    raise exception 'bill belongs to a different association' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_recurring_bill_payments_same_association() from public, anon;
grant execute on function public.tg_recurring_bill_payments_same_association() to authenticated;

create trigger recurring_bill_payments_20_same_association
  before insert or update on public.recurring_bill_payments
  for each row execute function public.tg_recurring_bill_payments_same_association();

create trigger audit_recurring_bill_payments
  after insert or update or delete on public.recurring_bill_payments
  for each row execute function public.tg_audit();

create or replace function public.tg_recurring_bills_touch()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.tg_recurring_bills_touch() from public, anon;
grant execute on function public.tg_recurring_bills_touch() to authenticated;

create trigger recurring_bills_05_touch
  before update on public.recurring_bills
  for each row execute function public.tg_recurring_bills_touch();

-- A bill with a next due date always has a due day (REVIEW-4 #14). Without one the
-- date was chained from the previous due date, so a bill first due on the 31st
-- slid to the 28th after February and stayed there for good. When the board
-- leaves the day blank it is taken from the date: the day the bill is due now.
-- On an update the day comes from the date the row had BEFORE the update, which is the
-- date the bill was anchored to (mark_bill_paid moves next_due_on in the same statement).
create or replace function public.tg_recurring_bills_due_day()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.due_day is null and new.next_due_on is not null then
    new.due_day := extract(day from
      case when tg_op = 'UPDATE' then coalesce(old.next_due_on, new.next_due_on) else new.next_due_on end)::smallint;
  end if;
  return new;
end $$;

revoke all on function public.tg_recurring_bills_due_day() from public, anon;
grant execute on function public.tg_recurring_bills_due_day() to authenticated;

create trigger recurring_bills_03_due_day
  before insert or update on public.recurring_bills
  for each row execute function public.tg_recurring_bills_due_day();

-- Next due date after one billing period, landing on due_day (clamped to the
-- month's last day: due_day 31 in April is April 30). Mirrored by
-- billNextDue() in src/lib/upkeep/bills.ts (tests/fixtures/bill-cases.ts).
create or replace function public.bill_next_due(p_from date, p_frequency public.bill_frequency, p_due_day smallint)
returns date
language plpgsql immutable set search_path = ''
as $$
declare
  v_months integer := case p_frequency
                        when 'monthly'    then 1
                        when 'quarterly'  then 3
                        when 'semiannual' then 6
                        else 12 end;
  v_next date;
  v_last integer;
begin
  if p_from is null then return null; end if;
  v_next := (p_from + make_interval(months => v_months))::date;
  if p_due_day is null then return v_next; end if;
  v_last := extract(day from (date_trunc('month', v_next) + interval '1 month' - interval '1 day'))::int;
  return make_date(extract(year from v_next)::int, extract(month from v_next)::int, least(p_due_day, v_last));
end $$;

revoke all on function public.bill_next_due(date, public.bill_frequency, smallint) from public, anon;
grant execute on function public.bill_next_due(date, public.bill_frequency, smallint) to authenticated;

-- One payment per bill per period: a double click or two board members at
-- once cannot record the same due date twice (the action maps 23505 to
-- "Already marked paid").
create unique index recurring_bill_payments_one_per_period
  on public.recurring_bill_payments (bill_id, due_on);

-- Who recorded it is the caller, not a client-sent value.
create or replace function public.tg_recurring_bill_payments_defaults()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.association_id := old.association_id;
    new.bill_id        := old.bill_id;
    new.created_by     := old.created_by;
    new.created_at     := old.created_at;
  elsif auth.uid() is not null then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end $$;

revoke all on function public.tg_recurring_bill_payments_defaults() from public, anon;
grant execute on function public.tg_recurring_bill_payments_defaults() to authenticated;

create trigger recurring_bill_payments_10_defaults
  before insert or update on public.recurring_bill_payments
  for each row execute function public.tg_recurring_bill_payments_defaults();

-- p_due_on is the due date the board was looking at when they clicked
-- (the form sends the bill's next_due_on as rendered). A second click, or a
-- second board member, finds next_due_on already moved on and is refused,
-- instead of quietly marking the following period paid.
--
-- A bill that tracks an insurance premium (recurring_bills.insurance_policy_id,
-- 0052) does not step by its frequency: 0052's
-- insurance_premium_bill_advance() sets the next installment from the
-- policy's own schedule, or retires the bill (is_active = false) when the
-- renewal's bill has taken over. Its return (a date, or null when retired)
-- is what bill_next_due_on reports. (insurance-spec R-2.)
create or replace function public.mark_bill_paid(
  p_bill_id uuid, p_due_on date, p_paid_on date, p_amount numeric default null, p_note text default null)
returns table (payment_id uuid, bill_next_due_on date)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_bill public.recurring_bills%rowtype;
  v_covers date;
  v_pay uuid;
  v_next date;
begin
  -- Locked: a second call for the same bill waits, then sees the advanced
  -- next_due_on and is refused (p_due_on no longer matches); the unique
  -- index is the backstop.
  select * into v_bill from public.recurring_bills b where b.id = p_bill_id for update;
  if not found or not public.is_board(v_bill.association_id) then
    raise exception 'only a board member can mark a bill paid' using errcode = '42501';
  end if;
  if not v_bill.is_active then
    raise exception 'this bill is archived; restore it first' using errcode = '22023';
  end if;
  if v_bill.paused_at is not null then
    raise exception 'this bill is paused; resume it first' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'America/Chicago')::date + 1
     or p_paid_on < date '2000-01-01' then
    raise exception 'pick the date it was paid' using errcode = '22023';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'the amount can''t be negative' using errcode = '22023';
  end if;

  if v_bill.next_due_on is not null and p_due_on is distinct from v_bill.next_due_on then
    raise exception 'that due date is already marked paid' using errcode = '23505';
  end if;
  v_covers := coalesce(v_bill.next_due_on, p_paid_on);

  insert into public.recurring_bill_payments (association_id, bill_id, paid_on, due_on, amount, note)
  values (v_bill.association_id, p_bill_id, p_paid_on, v_covers, round(p_amount, 2), nullif(btrim(p_note), ''))
  returning id into v_pay;

  if v_bill.insurance_policy_id is not null then
    update public.recurring_bills
       set last_paid_on = greatest(coalesce(last_paid_on, p_paid_on), p_paid_on)
     where id = p_bill_id;
    v_next := public.insurance_premium_bill_advance(p_bill_id, v_covers);
  else
    update public.recurring_bills
       set last_paid_on = greatest(coalesce(last_paid_on, p_paid_on), p_paid_on),
           next_due_on  = public.bill_next_due(v_covers, frequency, due_day)
     where id = p_bill_id
    returning next_due_on into v_next;
  end if;

  return query select v_pay, v_next;
end $$;

revoke all on function public.mark_bill_paid(uuid, date, date, numeric, text) from public, anon;
grant execute on function public.mark_bill_paid(uuid, date, date, numeric, text) to authenticated;

-- upcoming_bills (0013 view) is left unchanged; the Bills view reads
-- recurring_bills directly.

-- ============================================================================
-- 15. PHOTOS, OWNER READ PATHS AND TICKET RPCs
-- ============================================================================

-- Photos are read through 0051's ticket_photos(p_ticket_id) (owners
-- included) and added through attach_ticket_photo(); there is no Repairs
-- policy on document_links and no image proxy. This adds the timeline event
-- and keeps each photo's audience in step with its ticket.
create or replace function public.tg_ticket_photo_event()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.target_table = 'tickets' and new.relation = 'photo' and exists (
    select 1 from public.tickets t where t.id = new.target_id and t.association_id = new.association_id
  ) then
    insert into public.ticket_events (association_id, ticket_id, kind, data, visible_to_owners, actor_user_id, actor_person_id)
    values (new.association_id, new.target_id, 'photo_added', jsonb_build_object('document_id', new.document_id), true,
            auth.uid(),
            case when auth.uid() is null then null else public.current_person_id(new.association_id) end);
  end if;
  return null;
end $$;

revoke all on function public.tg_ticket_photo_event() from public, anon;
grant execute on function public.tg_ticket_photo_event() to authenticated;

create trigger document_links_ticket_photo_event
  after insert on public.document_links
  for each row execute function public.tg_ticket_photo_event();

-- attach_ticket_photo (0051) pins a photo to the ticket's audience when it is
-- attached: all_owners for a shared-area ticket, the unit (board_only +
-- restricted_to_unit_id) for a unit ticket. When the board moves a ticket
-- between a unit and a shared area, its photos follow, in the same
-- transaction (foundation hand-off, section 14). Only documents whose sole
-- link is this ticket's photo link are re-pinned: a document also linked
-- elsewhere (checksum dedupe in attach_ticket_photo, or a board link in the
-- hub) keeps its audience, because the other link may be the reason it has
-- it.
create or replace function public.tg_tickets_repin_photos()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.unit_id is not distinct from old.unit_id then
    return null;
  end if;
  update public.documents d
     set restricted_to_unit_id = new.unit_id,
         visibility = case when new.unit_id is null then 'all_owners' else 'board_only' end
   where d.association_id = new.association_id
     and exists (
       select 1 from public.document_links l
        where l.document_id = d.id and l.association_id = new.association_id
          and l.target_table = 'tickets' and l.target_id = new.id and l.relation = 'photo'
     )
     and not exists (
       select 1 from public.document_links o
        where o.document_id = d.id
          and not (o.target_table = 'tickets' and o.target_id = new.id and o.relation = 'photo')
     );
  return null;
end $$;

revoke all on function public.tg_tickets_repin_photos() from public, anon;
grant execute on function public.tg_tickets_repin_photos() to authenticated;

create trigger tickets_30_repin_photos
  after update of unit_id on public.tickets
  for each row execute function public.tg_tickets_repin_photos();

-- The assigned contractor's name, for tickets the caller can see. The only
-- vendors field an owner ever receives (brief decision 9).
create or replace function public.ticket_contractor_names(p_ticket_ids uuid[])
returns table (ticket_id uuid, contractor_name text)
language sql stable security definer set search_path = ''
as $$
  select t.id, v.name
    from public.tickets t
    join public.vendors v on v.id = t.assigned_vendor_id and v.association_id = t.association_id
   where t.id = any(p_ticket_ids[1:200])
     and public.ticket_visible_to_caller(t.association_id, t.unit_id)
$$;

revoke all on function public.ticket_contractor_names(uuid[]) from public, anon;
grant execute on function public.ticket_contractor_names(uuid[]) to authenticated;

-- Who did each thing on the timeline, as a role the caller may know: the
-- caller themselves, the board, the accountant, another owner, or unknown.
-- Owners cannot read persons or role_grants, so without this every other
-- actor was "Someone from the building". The role is the one the person held
-- when the event happened. Only events the caller could read anyway
-- (ticket_events_select, restated because this bypasses RLS).
create or replace function public.ticket_event_actor_roles(p_ticket_id uuid)
returns table (event_id uuid, actor_role text)
language sql stable security definer set search_path = ''
as $$
  select e.id,
         case
           when e.actor_person_id is null then 'unknown'
           when e.actor_person_id = public.current_person_id(e.association_id) then 'you'
           when exists (
             select 1 from public.role_grants g
              where g.person_id = e.actor_person_id and g.association_id = e.association_id
                and g.role in ('board_admin', 'board_member')
                and g.granted_on <= (e.created_at at time zone 'America/Chicago')::date
                and (g.revoked_at is null or g.revoked_at > e.created_at)
                and (g.expires_on is null or g.expires_on >= (e.created_at at time zone 'America/Chicago')::date))
             then 'board'
           when exists (
             select 1 from public.role_grants g
              where g.person_id = e.actor_person_id and g.association_id = e.association_id
                and g.role = 'accountant'
                and g.granted_on <= (e.created_at at time zone 'America/Chicago')::date
                and (g.revoked_at is null or g.revoked_at > e.created_at))
             then 'accountant'
           else 'owner'
         end
    from public.ticket_events e
    join public.tickets t on t.id = e.ticket_id and t.association_id = e.association_id
   where e.ticket_id = p_ticket_id
     and public.ticket_visible_to_caller(t.association_id, t.unit_id)
     and case
           when e.kind = 'note_added' and coalesce((e.data->>'internal')::boolean, false)
             then public.is_board(e.association_id)
           else public.can_read_financials(e.association_id) or e.visible_to_owners
         end
$$;

revoke all on function public.ticket_event_actor_roles(uuid) from public, anon;
grant execute on function public.ticket_event_actor_roles(uuid) to authenticated;

-- "It's not fixed": the board any time; the reporter within 30 days of it
-- being marked fixed. Writes a non-internal note with the reason.
create or replace function public.reopen_ticket(p_ticket_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.tickets%rowtype;
begin
  select * into v from public.tickets t where t.id = p_ticket_id for update;
  if not found or not public.ticket_visible_to_caller(v.association_id, v.unit_id) then
    raise exception 'that problem isn''t visible to you' using errcode = '42501';
  end if;
  if not (
    public.is_board(v.association_id)
    or (v.reported_by is not null
        and v.reported_by = public.current_person_id(v.association_id)
        and v.status = 'resolved'
        and v.resolved_at > now() - interval '30 days')
  ) then
    raise exception 'only the board or the person who reported it can reopen it' using errcode = '42501';
  end if;
  if v.status not in ('resolved', 'closed') then
    return;
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null or char_length(p_reason) > 2000 then
    raise exception 'say what is still wrong' using errcode = '22023';
  end if;

  update public.tickets set status = 'open' where id = p_ticket_id;
  insert into public.ticket_comments (association_id, ticket_id, body, is_internal)
  values (v.association_id, p_ticket_id, 'Reopened: ' || btrim(p_reason), false);
end $$;

revoke all on function public.reopen_ticket(uuid, text) from public, anon;
grant execute on function public.reopen_ticket(uuid, text) to authenticated;

-- "Yes, it's fixed": the reporter (or the board) closes a fixed ticket.
create or replace function public.confirm_ticket_fixed(p_ticket_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.tickets%rowtype;
begin
  select * into v from public.tickets t where t.id = p_ticket_id for update;
  if not found or not public.ticket_visible_to_caller(v.association_id, v.unit_id) then
    raise exception 'that problem isn''t visible to you' using errcode = '42501';
  end if;
  if not (public.is_board(v.association_id)
          or (v.reported_by is not null and v.reported_by = public.current_person_id(v.association_id))) then
    raise exception 'only the board or the person who reported it can confirm it' using errcode = '42501';
  end if;
  if v.status <> 'resolved' then
    return;
  end if;
  update public.tickets set status = 'closed' where id = p_ticket_id;
end $$;

revoke all on function public.confirm_ticket_fixed(uuid) from public, anon;
grant execute on function public.confirm_ticket_fixed(uuid) to authenticated;

-- AI triage is written here because the reporter (often an owner) cannot
-- write ticket_board_details. The reporter may write it once, within 10
-- minutes of creating the ticket; the board may overwrite it. Sets the
-- ticket's trade only when it has none. The payload is validated here, not
-- only in TypeScript, so a reporter calling the RPC directly cannot plant a
-- fake "Walkup's suggestion". It never sets emergency_kind: a model-detected
-- emergency is shown to the board as a suggestion, and only the board's
-- click sets it.
create or replace function public.record_ticket_triage(p_ticket_id uuid, p_triage jsonb, p_trade text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v        public.tickets%rowtype;
  v_old    jsonb;
  v_state  text;
  k        text;
begin
  select * into v from public.tickets t where t.id = p_ticket_id for update;
  if not found then
    raise exception 'that problem isn''t visible to you' using errcode = '42501';
  end if;
  select d.triage into v_old from public.ticket_board_details d where d.ticket_id = p_ticket_id;
  if not (
    public.is_board(v.association_id)
    or (v.reported_by is not null
        and v.reported_by = public.current_person_id(v.association_id)
        and v_old is null
        and v.created_at > now() - interval '10 minutes')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Shape. Nested ifs so a wrong type is a 22023, never a cast error.
  if p_triage is null or jsonb_typeof(p_triage) <> 'object' or octet_length(p_triage::text) > 8192 then
    raise exception 'bad triage payload' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_triage) loop
    if k not in ('state', 'trade', 'secondary_trade', 'urgency', 'emergency', 'search_phrase',
                 'summary', 'questions', 'confidence', 'model', 'at', 'reason') then
      raise exception 'bad triage payload: %', k using errcode = '22023';
    end if;
  end loop;
  v_state := p_triage->>'state';
  if v_state is null or v_state not in ('done', 'skipped', 'failed') then
    raise exception 'bad triage state' using errcode = '22023';
  end if;
  if p_triage ? 'reason' then
    if coalesce(p_triage->>'reason', '') not in ('not_configured', 'quota', 'error', 'reporter_limit') then
      raise exception 'bad triage reason' using errcode = '22023';
    end if;
  end if;
  if p_triage ? 'urgency' then
    if coalesce(p_triage->>'urgency', '') not in ('low', 'normal', 'urgent') then
      raise exception 'bad triage urgency' using errcode = '22023';
    end if;
  end if;
  if p_triage ? 'emergency' then
    if coalesce(p_triage->>'emergency', '') not in
       ('none', 'gas', 'carbon_monoxide', 'fire', 'flooding', 'electrical', 'no_heat', 'sewage', 'elevator_entrapment') then
      raise exception 'bad triage emergency' using errcode = '22023';
    end if;
  end if;
  if p_triage ? 'trade' and jsonb_typeof(p_triage->'trade') <> 'null' then
    if jsonb_typeof(p_triage->'trade') <> 'string' or (p_triage->>'trade') !~ '^[a-z][a-z_]{1,30}$' then
      raise exception 'bad triage trade' using errcode = '22023';
    end if;
  end if;
  if p_triage ? 'secondary_trade' and jsonb_typeof(p_triage->'secondary_trade') <> 'null' then
    if jsonb_typeof(p_triage->'secondary_trade') <> 'string'
       or (p_triage->>'secondary_trade') !~ '^[a-z][a-z_]{1,30}$' then
      raise exception 'bad triage trade' using errcode = '22023';
    end if;
  end if;
  if p_triage ? 'search_phrase' then
    if jsonb_typeof(p_triage->'search_phrase') <> 'string' or (p_triage->>'search_phrase') !~ '^[a-z &-]{0,60}$' then
      raise exception 'bad triage phrase' using errcode = '22023';
    end if;
  end if;
  if (p_triage ? 'summary' and (jsonb_typeof(p_triage->'summary') <> 'string' or char_length(p_triage->>'summary') > 200))
     or (p_triage ? 'model' and (jsonb_typeof(p_triage->'model') <> 'string' or char_length(p_triage->>'model') > 60))
     or (p_triage ? 'at' and (jsonb_typeof(p_triage->'at') <> 'string' or char_length(p_triage->>'at') > 40)) then
    raise exception 'bad triage text' using errcode = '22023';
  end if;
  if p_triage ? 'confidence' then
    if jsonb_typeof(p_triage->'confidence') <> 'number' then
      raise exception 'bad triage confidence' using errcode = '22023';
    end if;
    if (p_triage->>'confidence')::numeric not between 0 and 1 then
      raise exception 'bad triage confidence' using errcode = '22023';
    end if;
  end if;
  if p_triage ? 'questions' then
    if jsonb_typeof(p_triage->'questions') <> 'array' then
      raise exception 'bad triage questions' using errcode = '22023';
    end if;
    if jsonb_array_length(p_triage->'questions') > 3
       or exists (select 1 from jsonb_array_elements(p_triage->'questions') q
                   where jsonb_typeof(q) <> 'string' or char_length(q #>> '{}') > 140) then
      raise exception 'bad triage questions' using errcode = '22023';
    end if;
  end if;
  if p_trade is not null and p_trade !~ '^[a-z][a-z_]{1,30}$' then
    raise exception 'bad trade' using errcode = '22023';
  end if;

  -- A reporter's "done" triage must follow a model call that was actually
  -- claimed and finished ok by the same login in the last 10 minutes
  -- (claim_ai_call is rate limited per person and per building). Without
  -- that, the reporter could plant any text under Walkup's name and set the
  -- board's emergency banner (REVIEW-1 #13). The check cannot prove the text
  -- came from the model (finish_ai_call takes the caller's word for ok), so
  -- the screens still label the field a suggestion; skipped and failed need
  -- no model call.
  if v_state = 'done' and not public.is_board(v.association_id) and not exists (
    select 1 from public.ai_calls c
     where c.association_id = v.association_id
       and c.kind = 'ticket_triage'
       and c.step = 'main'
       and c.ok
       and c.called_by = auth.uid()
       and c.finished_at > now() - interval '10 minutes'
  ) then
    raise exception 'triage can only be recorded after a finished AI call' using errcode = '42501';
  end if;

  perform set_config('walkup.triage_write', 'on', true);
  insert into public.ticket_board_details (ticket_id, association_id, triage)
  values (p_ticket_id, v.association_id, p_triage)
  on conflict (ticket_id) do update set triage = excluded.triage;
  perform set_config('walkup.triage_write', '', true);

  if p_trade is not null and v.trade is null then
    update public.tickets set trade = p_trade where id = p_ticket_id;
  end if;
end $$;

revoke all on function public.record_ticket_triage(uuid, jsonb, text) from public, anon;
grant execute on function public.record_ticket_triage(uuid, jsonb, text) to authenticated;

-- Close-out in one transaction: status and resolution note on the ticket,
-- final cost and payment link in the board details, and (once only) the
-- upkeep log entry when the ticket came from an upkeep task. INVOKER: RLS
-- already limits every write to the board; the lock makes a double submit
-- wait and then find the log entry already written.
create or replace function public.close_out_ticket(
  p_ticket_id       uuid,
  p_status          text,
  p_actual_cost     numeric,
  p_expense_id      uuid,
  p_resolution_note text,
  p_log_upkeep      boolean)
returns table (upkeep_logged boolean, task_next_due_on date)
language plpgsql security invoker set search_path = ''
as $$
declare
  v        public.tickets%rowtype;
  v_logged boolean := false;
begin
  select * into v from public.tickets t where t.id = p_ticket_id for update;
  if not found or not public.is_board(v.association_id) then
    raise exception 'only a board member can mark a problem fixed' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('resolved', 'closed') then
    raise exception 'choose fixed or closed' using errcode = '22023';
  end if;
  if p_actual_cost is not null and p_actual_cost < 0 then
    raise exception 'the cost can''t be negative' using errcode = '22023';
  end if;
  if p_resolution_note is not null and char_length(p_resolution_note) > 2000 then
    raise exception 'keep what was done under 2,000 characters' using errcode = '22023';
  end if;

  update public.tickets
     set status = p_status::public.ticket_status,
         resolution_note = coalesce(nullif(btrim(coalesce(p_resolution_note, '')), ''), resolution_note)
   where id = p_ticket_id;

  insert into public.ticket_board_details (ticket_id, association_id, actual_cost, expense_id)
  values (p_ticket_id, v.association_id, round(p_actual_cost, 2), p_expense_id)
  on conflict (ticket_id) do update
    set actual_cost = excluded.actual_cost, expense_id = excluded.expense_id;

  if coalesce(p_log_upkeep, false) and v.upkeep_task_id is not null then
    if not exists (select 1 from public.upkeep_log l where l.ticket_id = p_ticket_id) then
      perform public.mark_upkeep_done(
        v.upkeep_task_id, (now() at time zone 'America/Chicago')::date, round(p_actual_cost, 2),
        v.assigned_vendor_id, 'From problem #' || v.reference, p_ticket_id);
      v_logged := true;
    else
      -- Closed again with a corrected cost (REVIEW-4 #9): the history follows the ticket,
      -- so the task page and the problem never show two different costs.
      update public.upkeep_log set cost = round(p_actual_cost, 2) where ticket_id = p_ticket_id;
    end if;
  end if;

  return query
    select v_logged, (select k.next_due_on from public.upkeep_tasks k where k.id = v.upkeep_task_id);
end $$;

revoke all on function public.close_out_ticket(uuid, text, numeric, uuid, text, boolean) from public, anon;
grant execute on function public.close_out_ticket(uuid, text, numeric, uuid, text, boolean) to authenticated;

-- Close as a duplicate in one transaction: the link, the status, both notes.
create or replace function public.mark_ticket_duplicate(p_ticket_id uuid, p_original_reference integer)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v public.tickets%rowtype;
  o public.tickets%rowtype;
begin
  select * into v from public.tickets t where t.id = p_ticket_id for update;
  if not found or not public.is_board(v.association_id) then
    raise exception 'only a board member can do this' using errcode = '42501';
  end if;
  select * into o from public.tickets t
   where t.association_id = v.association_id and t.reference = p_original_reference;
  if not found then
    raise exception 'there is no problem #% in this building', p_original_reference using errcode = '22023';
  end if;
  if o.id = v.id then
    raise exception 'a problem can''t be a duplicate of itself' using errcode = '22023';
  end if;

  update public.tickets
     set duplicate_of_id = o.id,
         status = 'closed',
         resolution_note = 'Same problem as #' || o.reference || '.'
   where id = v.id;  -- the guard refuses chains and loops

  insert into public.ticket_comments (association_id, ticket_id, body, is_internal) values
    (v.association_id, v.id, 'Closed as a duplicate of #' || o.reference || '. Follow that one for updates.', false),
    (v.association_id, o.id, '#' || v.reference || ' was closed as the same problem.', false);
  return o.id;
end $$;

revoke all on function public.mark_ticket_duplicate(uuid, integer) from public, anon;
grant execute on function public.mark_ticket_duplicate(uuid, integer) to authenticated;

-- "This is the owner's to fix": a unit problem the declaration puts on the
-- unit owner. Closes it with a resolution note and posts the board's
-- (edited) explanation as a non-internal note the reporter sees.
create or replace function public.close_ticket_for_owner(p_ticket_id uuid, p_note text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v public.tickets%rowtype;
begin
  select * into v from public.tickets t where t.id = p_ticket_id for update;
  if not found or not public.is_board(v.association_id) then
    raise exception 'only a board member can do this' using errcode = '42501';
  end if;
  if v.unit_id is null then
    raise exception 'this is for problems inside a unit' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null or char_length(p_note) > 2000 then
    raise exception 'write a short note to the owner' using errcode = '22023';
  end if;

  update public.tickets
     set status = 'closed',
         resolution_note = 'The board decided this is the unit owner''s to fix.'
   where id = p_ticket_id;
  insert into public.ticket_comments (association_id, ticket_id, body, is_internal)
  values (v.association_id, p_ticket_id, btrim(p_note), false);
end $$;

revoke all on function public.close_ticket_for_owner(uuid, text) from public, anon;
grant execute on function public.close_ticket_for_owner(uuid, text) to authenticated;

-- The board's "who and when" in one transaction: ticket fields
-- (contractor, visit) and board-detail fields (assignee, target date,
-- estimate). Only keys present in p_fields change; a key with JSON null
-- clears that field.
create or replace function public.set_ticket_plan(p_ticket_id uuid, p_fields jsonb)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v public.tickets%rowtype;
  k text;
  v_vendor uuid;
begin
  select * into v from public.tickets t where t.id = p_ticket_id for update;
  if not found or not public.is_board(v.association_id) then
    raise exception 'only a board member can plan this' using errcode = '42501';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'nothing to save' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_fields) loop
    if k not in ('assigned_vendor_id', 'scheduled_for', 'scheduled_window', 'assignee_person_id', 'due_on', 'estimated_cost') then
      raise exception 'unknown field %', k using errcode = '22023';
    end if;
  end loop;

  if p_fields ? 'assigned_vendor_id' and jsonb_typeof(p_fields->'assigned_vendor_id') <> 'null' then
    v_vendor := (p_fields->>'assigned_vendor_id')::uuid;
    if exists (select 1 from public.vendors x where x.id = v_vendor
                and (x.status = 'do_not_use' or x.archived_at is not null)) then
      raise exception 'that contractor is archived or marked do not use' using errcode = '22023', hint = 'do_not_use';
    end if;
  end if;

  update public.tickets t
     set assigned_vendor_id = case when p_fields ? 'assigned_vendor_id' then (p_fields->>'assigned_vendor_id')::uuid else t.assigned_vendor_id end,
         scheduled_for      = case when p_fields ? 'scheduled_for'      then (p_fields->>'scheduled_for')::date      else t.scheduled_for end,
         scheduled_window   = case when p_fields ? 'scheduled_window'   then nullif(btrim(coalesce(p_fields->>'scheduled_window', '')), '') else t.scheduled_window end
   where t.id = p_ticket_id
     and (p_fields ? 'assigned_vendor_id' or p_fields ? 'scheduled_for' or p_fields ? 'scheduled_window');

  if p_fields ? 'assignee_person_id' or p_fields ? 'due_on' or p_fields ? 'estimated_cost' then
    insert into public.ticket_board_details (ticket_id, association_id, assignee_person_id, due_on, estimated_cost)
    values (p_ticket_id, v.association_id,
            (p_fields->>'assignee_person_id')::uuid, (p_fields->>'due_on')::date,
            round((p_fields->>'estimated_cost')::numeric, 2))
    on conflict (ticket_id) do update set
      assignee_person_id = case when p_fields ? 'assignee_person_id' then excluded.assignee_person_id else public.ticket_board_details.assignee_person_id end,
      due_on             = case when p_fields ? 'due_on'             then excluded.due_on             else public.ticket_board_details.due_on end,
      estimated_cost     = case when p_fields ? 'estimated_cost'     then excluded.estimated_cost     else public.ticket_board_details.estimated_cost end;
  end if;
end $$;

revoke all on function public.set_ticket_plan(uuid, jsonb) from public, anon;
grant execute on function public.set_ticket_plan(uuid, jsonb) to authenticated;

-- Change the urgency; when the board lowers the urgency of something an
-- owner reported, the reason is required and posted as a note the reporter
-- reads, in the same transaction.
create or replace function public.set_ticket_priority(p_ticket_id uuid, p_priority text, p_reason text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v public.tickets%rowtype;
  v_rank_old int;
  v_rank_new int;
  v_reporter_is_board boolean;
begin
  select * into v from public.tickets t where t.id = p_ticket_id for update;
  if not found or not public.is_board(v.association_id) then
    raise exception 'only a board member can change the urgency' using errcode = '42501';
  end if;
  if p_priority is null or p_priority not in ('low', 'normal', 'urgent') then
    raise exception 'choose an urgency' using errcode = '22023';
  end if;
  if p_priority = v.priority::text then
    return;
  end if;
  v_rank_old := case v.priority::text when 'urgent' then 0 when 'normal' then 1 else 2 end;
  v_rank_new := case p_priority      when 'urgent' then 0 when 'normal' then 1 else 2 end;
  v_reporter_is_board := v.reported_by is null or exists (
    select 1 from public.role_grants g
     where g.person_id = v.reported_by and g.association_id = v.association_id
       and g.role in ('board_admin', 'board_member') and g.revoked_at is null
       and (g.expires_on is null or g.expires_on >= current_date));

  if v_rank_new > v_rank_old and not v_reporter_is_board
     and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'say why, so the person who reported it understands' using errcode = '22023', hint = 'reason_required';
  end if;
  if p_reason is not null and char_length(p_reason) > 300 then
    raise exception 'keep the reason under 300 characters' using errcode = '22023';
  end if;

  update public.tickets set priority = p_priority::public.ticket_priority where id = p_ticket_id;

  if nullif(btrim(coalesce(p_reason, '')), '') is not null then
    insert into public.ticket_comments (association_id, ticket_id, body, is_internal)
    values (v.association_id, p_ticket_id,
            'Urgency changed to "' ||
            case p_priority when 'urgent' then 'Needs attention now' when 'normal' then 'Should be looked at' else 'Can wait' end
            || '": ' || btrim(p_reason), false);
  end if;
end $$;

revoke all on function public.set_ticket_priority(uuid, text, text) from public, anon;
grant execute on function public.set_ticket_priority(uuid, text, text) to authenticated;

-- ============================================================================
-- 16. THE BUILDING'S EMERGENCY FACTS, AND "LAST SEEN" FOR REPAIRS
-- ============================================================================

create table public.building_emergency_info (
  association_id           uuid primary key references public.associations(id) on delete restrict,
  water_shutoff_location   text check (water_shutoff_location   is null or char_length(water_shutoff_location)   <= 200),
  gas_utility_name         text check (gas_utility_name         is null or char_length(gas_utility_name)         <= 80),
  gas_emergency_phone      text check (gas_emergency_phone      is null or char_length(gas_emergency_phone)      <= 40),
  electric_panel_location  text check (electric_panel_location  is null or char_length(electric_panel_location)  <= 200),
  electric_utility_name    text check (electric_utility_name    is null or char_length(electric_utility_name)    <= 80),
  electric_emergency_phone text check (electric_emergency_phone is null or char_length(electric_emergency_phone) <= 40),
  elevator_company_name    text check (elevator_company_name    is null or char_length(elevator_company_name)    <= 120),
  elevator_company_phone   text check (elevator_company_phone   is null or char_length(elevator_company_phone)   <= 40),
  other_notes              text check (other_notes              is null or char_length(other_notes)              <= 600),
  updated_by               uuid references auth.users(id) default auth.uid(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.building_emergency_info is
  'Facts the board entered about this building for an emergency: where the shut-offs are, the utilities'' and elevator company''s emergency numbers. Shown under "In your building" in the safety banner. Owners read it through building_emergency_info(); Walkup never fills gaps.';

create table public.building_emergency_contacts (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  person_id      uuid references public.persons(id) on delete set null,
  name           text not null check (char_length(btrim(name)) between 1 and 120),
  label          text check (label is null or char_length(label) <= 60),
  phone          text not null check (char_length(btrim(phone)) between 7 and 40),
  show_to_owners boolean not null default true,
  sort_order     smallint not null default 0,
  created_at     timestamptz not null default now()
);

create index building_emergency_contacts_assoc_idx on public.building_emergency_contacts (association_id, sort_order);

comment on table public.building_emergency_contacts is
  'Board members (or others) the board chose to list for urgent problems, with the number they want owners to call or text. The board types the number; it is not read from persons.';

alter table public.building_emergency_info     enable row level security;
alter table public.building_emergency_contacts enable row level security;

create policy building_emergency_info_select on public.building_emergency_info
  for select to authenticated using (public.can_read_financials(association_id));
create policy building_emergency_info_insert on public.building_emergency_info
  for insert to authenticated with check (public.is_board(association_id));
create policy building_emergency_info_update on public.building_emergency_info
  for update to authenticated
  using (public.is_board(association_id)) with check (public.is_board(association_id));

create policy building_emergency_contacts_select on public.building_emergency_contacts
  for select to authenticated using (public.can_read_financials(association_id));
create policy building_emergency_contacts_insert on public.building_emergency_contacts
  for insert to authenticated with check (public.is_board(association_id));
create policy building_emergency_contacts_update on public.building_emergency_contacts
  for update to authenticated
  using (public.is_board(association_id)) with check (public.is_board(association_id));
create policy building_emergency_contacts_delete on public.building_emergency_contacts
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create or replace function public.tg_building_emergency_info_touch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.association_id := old.association_id;
    new.created_at     := old.created_at;
  end if;
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.tg_building_emergency_info_touch() from public, anon;
grant execute on function public.tg_building_emergency_info_touch() to authenticated;

create trigger building_emergency_info_10_touch
  before insert or update on public.building_emergency_info
  for each row execute function public.tg_building_emergency_info_touch();

create or replace function public.tg_building_emergency_contacts_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.association_id := old.association_id;
    new.created_at     := old.created_at;
  end if;
  if new.person_id is not null and not exists (
    select 1 from public.persons p where p.id = new.person_id and p.association_id = new.association_id
  ) then
    raise exception 'person belongs to a different association' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_building_emergency_contacts_guard() from public, anon;
grant execute on function public.tg_building_emergency_contacts_guard() to authenticated;

create trigger building_emergency_contacts_20_guard
  before insert or update on public.building_emergency_contacts
  for each row execute function public.tg_building_emergency_contacts_guard();

create trigger audit_building_emergency_info
  after insert or update or delete on public.building_emergency_info
  for each row execute function public.tg_audit();
create trigger audit_building_emergency_contacts
  after insert or update or delete on public.building_emergency_contacts
  for each row execute function public.tg_audit();

-- The owner-facing read (decision 9 pattern): members get the facts and the
-- contacts marked show_to_owners; board and accountant get every contact.
create or replace function public.building_emergency_info(p_association_id uuid)
returns table (
  water_shutoff_location text,
  gas_utility_name text, gas_emergency_phone text,
  electric_panel_location text, electric_utility_name text, electric_emergency_phone text,
  elevator_company_name text, elevator_company_phone text, other_notes text,
  updated_at timestamptz, contacts jsonb)
language sql stable security definer set search_path = ''
as $$
  select i.water_shutoff_location,
         i.gas_utility_name, i.gas_emergency_phone,
         i.electric_panel_location, i.electric_utility_name, i.electric_emergency_phone,
         i.elevator_company_name, i.elevator_company_phone, i.other_notes,
         i.updated_at,
         coalesce((
           select jsonb_agg(jsonb_build_object('name', c.name, 'label', c.label, 'phone', c.phone)
                            order by c.sort_order, c.name)
             from public.building_emergency_contacts c
            where c.association_id = p_association_id
              and (c.show_to_owners or public.can_read_financials(p_association_id))
         ), '[]'::jsonb)
    from (select p_association_id as association_id) a
    left join public.building_emergency_info i on i.association_id = a.association_id
   where public.is_member(p_association_id)
$$;

revoke all on function public.building_emergency_info(uuid) from public, anon;
grant execute on function public.building_emergency_info(uuid) to authenticated;

-- When each person last opened /repairs, for "New since your last visit"
-- (board) and the owner's "updates since you last looked". A visit is a
-- 30-minute window: refreshing inside it keeps showing what was new when the
-- visit started. A per-person preference row, so not audited; its only
-- foreign keys are the association and the person's own login.
create table public.repairs_seen (
  association_id uuid not null references public.associations(id) on delete restrict,
  user_id        uuid not null references auth.users(id) on delete cascade,
  seen_at        timestamptz not null default now(),
  prev_seen_at   timestamptz,
  primary key (association_id, user_id)
);

comment on table public.repairs_seen is
  'Per person: when they last opened Repairs (seen_at) and the visit before (prev_seen_at). Drives "New since your last visit". Each person reads and writes only their own row. Not audited (a preference, not a record).';

alter table public.repairs_seen enable row level security;

create policy repairs_seen_select on public.repairs_seen
  for select to authenticated using (user_id = auth.uid() and public.is_member(association_id));
create policy repairs_seen_insert on public.repairs_seen
  for insert to authenticated with check (user_id = auth.uid() and public.is_member(association_id));
create policy repairs_seen_update on public.repairs_seen
  for update to authenticated
  using (user_id = auth.uid() and public.is_member(association_id))
  with check (user_id = auth.uid() and public.is_member(association_id));

-- Returns the "since" moment for this visit, then records the visit.
create or replace function public.mark_repairs_seen(p_association_id uuid)
returns timestamptz
language plpgsql security invoker set search_path = ''
as $$
declare
  v_row public.repairs_seen%rowtype;
  v_since timestamptz;
begin
  if auth.uid() is null or not public.is_member(p_association_id) then
    raise exception 'members only' using errcode = '42501';
  end if;
  select * into v_row from public.repairs_seen s
   where s.association_id = p_association_id and s.user_id = auth.uid() for update;
  if not found then
    insert into public.repairs_seen (association_id, user_id) values (p_association_id, auth.uid());
    return null;  -- first visit: the page shows the last 7 days instead
  end if;
  if v_row.seen_at > now() - interval '30 minutes' then
    v_since := v_row.prev_seen_at;              -- same visit
    update public.repairs_seen set seen_at = now()
     where association_id = p_association_id and user_id = auth.uid();
  else
    v_since := v_row.seen_at;                   -- new visit
    update public.repairs_seen set prev_seen_at = v_row.seen_at, seen_at = now()
     where association_id = p_association_id and user_id = auth.uid();
  end if;
  return v_since;
end $$;

revoke all on function public.mark_repairs_seen(uuid) from public, anon;
grant execute on function public.mark_repairs_seen(uuid) to authenticated;
