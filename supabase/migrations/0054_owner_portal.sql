-- ============================================================================
-- Walkup — migration 0054: the owner portal
--
-- What an owner needs to see, read through narrow SECURITY DEFINER functions
-- or ordinary RLS, never through a board table:
--
--   1. Association contact details (who to write to), readable by members.
--   2. "Claim your record": an owner invite can point at a persons row the
--      board already created, so the person who signs in IS the person the
--      units, charges and payments belong to (redeem_invite, redefined).
--   3. A guard so an owner can change their own phone and mailing address but
--      not their name or email (those are the board's records).
--   4. viewer_context(): who am I, what do I hold, which units do I own, in
--      one round trip.
--   5. Statements: unit_statement() and unit_statement_summary(). One source
--      for the portal, the PDF and the email (money-and-reminders-spec).
--   6. Announcements: board posts to all owners or chosen units, pinned,
--      optional attachment from the Document Hub, read receipts (counts to
--      the board only). Written only through RPCs.
--   7. Small owner conveniences: board_roster(), update_my_profile(),
--      withdraw_payment_report(), a cap on pending payment reports.
--
-- DECISIONS #22/#24 hold: nothing here sends anything or moves money.
-- Money crosses the API as text (#20). Aggregates are SECURITY DEFINER (#23).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Association contact details
-- ----------------------------------------------------------------------------

alter table public.associations
  add column board_contact_name  text check (board_contact_name  is null or char_length(board_contact_name)  <= 120),
  add column board_contact_email text check (board_contact_email is null or (char_length(board_contact_email) <= 254 and board_contact_email ~ '^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$')),
  add column board_contact_phone text check (board_contact_phone is null or char_length(board_contact_phone) <= 40);

comment on column public.associations.board_contact_name is
  'Who owners write to ("The board", "Maria, treasurer"). Shown to every member. Also the reply-to name on emails Walkup sends for the board.';
comment on column public.associations.board_contact_email is
  'The address owners write to. Shown to every member. The only reply-to Walkup puts on association email. Set by a board admin.';
comment on column public.associations.board_contact_phone is
  'Optional phone number owners may call for non-emergencies. Emergency numbers live in building_emergency_contacts.';

-- ----------------------------------------------------------------------------
-- 2. Claim your record: invites that point at an existing person
-- ----------------------------------------------------------------------------

alter table public.invites
  add column person_id uuid references public.persons(id) on delete restrict;

create index invites_person_idx on public.invites (person_id) where person_id is not null;

comment on column public.invites.person_id is
  'When set, redeeming this invite links the signing-in login to this existing persons row (which must have no login yet) instead of creating a new person. This is how an owner the board already entered, with their unit and history, signs in as themselves.';

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
  end if;
  return new;
end $$;

revoke all on function public.tg_invite_person_guard() from public, anon;
grant execute on function public.tg_invite_person_guard() to authenticated;

create trigger invites_person_guard
  before insert or update on public.invites
  for each row execute function public.tg_invite_person_guard();

-- Same signature as 0027, so existing callers are unaffected.
create or replace function public.redeem_invite(
  p_token     text,
  p_full_name text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_invite public.invites%rowtype;
  v_person public.persons%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_invite from public.invites where token = p_token;

  if v_invite.id is null then
    raise exception 'this invite link is not valid' using errcode = 'no_data_found';
  end if;
  if v_invite.redeemed_at is not null then
    raise exception 'this invite link has already been used' using errcode = 'no_data_found';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'this invite link has expired' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.persons where auth_user_id = v_uid) then
    raise exception 'this account already belongs to a building' using errcode = '23505';
  end if;

  if v_invite.person_id is not null then
    -- Claim an existing record. The name the board typed stays; the login is
    -- attached. A person who already has a login cannot be claimed twice.
    select * into v_person from public.persons
     where id = v_invite.person_id and association_id = v_invite.association_id
     for update;
    if not found then
      raise exception 'this invite link is not valid' using errcode = 'no_data_found';
    end if;
    if v_person.auth_user_id is not null then
      raise exception 'this person already has an account' using errcode = '23505';
    end if;
    -- The link now opens a unit, statements and payment history, so it must
    -- not work for whoever happens to hold it (REVIEW-1 #17): when the board
    -- recorded an email for this person, the login's email must match it.
    if v_person.email is not null and btrim(v_person.email) <> '' and not exists (
      select 1 from auth.users u
       where u.id = v_uid and lower(btrim(u.email)) = lower(btrim(v_person.email))
    ) then
      raise exception 'sign in with the email address the board has on file for you to use this link'
        using errcode = '42501';
    end if;
    update public.persons set auth_user_id = v_uid where id = v_person.id;
    insert into public.role_grants (association_id, person_id, role, granted_by)
    values (v_invite.association_id, v_person.id, 'owner', v_invite.created_by)
    on conflict (association_id, person_id, role)
    do update set revoked_at = null, revoked_by = null, expires_on = null;
  else
    insert into public.persons (association_id, full_name, email, auth_user_id)
    values (v_invite.association_id, p_full_name, v_invite.email, v_uid);

    insert into public.role_grants (association_id, person_id, role, granted_by)
    select v_invite.association_id, p.id, v_invite.role, v_invite.created_by
      from public.persons p
     where p.association_id = v_invite.association_id and p.auth_user_id = v_uid;
  end if;

  update public.invites
     set redeemed_at = now(), redeemed_by = v_uid
   where id = v_invite.id;

  return v_invite.association_id;
end $$;

revoke all on function public.redeem_invite(text, text) from public, anon;
grant execute on function public.redeem_invite(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Owners may edit their own phone and mailing address, nothing else
-- ----------------------------------------------------------------------------
-- persons_update (0002) lets anyone edit their own row. That was meant for
-- contact details. This trigger makes it so: when the caller is a signed-in
-- non-board user (current_user is the API role, not a definer function's
-- owner), name, email, association and login must not change.

create or replace function public.tg_persons_self_edit_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    -- Who a person signs in as (and which building the row belongs to) is the
    -- keys to the kingdom: has_role_in() resolves every role through
    -- persons.auth_user_id. Only a board_admin may change it, for anyone,
    -- themselves included (REVIEW-1 #1b). A board_member could otherwise
    -- repoint the admin's row at their own login and inherit board_admin.
    if (new.auth_user_id is distinct from old.auth_user_id
        or new.association_id is distinct from old.association_id)
       and not public.has_role_in(old.association_id, array['board_admin']::public.app_role[]) then
      raise exception 'only a board admin can change who a person signs in as'
        using errcode = '42501';
    end if;
    if not public.is_board(old.association_id)
       and (new.full_name is distinct from old.full_name
            or new.email is distinct from old.email) then
      raise exception 'ask the board to change your name or email'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.tg_persons_self_edit_guard() from public, anon;
grant execute on function public.tg_persons_self_edit_guard() to authenticated;

create trigger persons_self_edit_guard
  before update on public.persons
  for each row execute function public.tg_persons_self_edit_guard();

-- The same rule on the way in: persons_insert (0002) is is_board, so a board
-- member could otherwise create a person already bound to any login.
create or replace function public.tg_persons_insert_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.auth_user_id is not null
     and not public.has_role_in(new.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board admin can create a person with a login'
      using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_persons_insert_guard() from public, anon;
grant execute on function public.tg_persons_insert_guard() to authenticated;

create trigger persons_insert_guard
  before insert on public.persons
  for each row execute function public.tg_persons_insert_guard();

create or replace function public.update_my_profile(
  p_association_id  uuid,
  p_phone           text,
  p_mailing_address text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_person uuid := public.current_person_id(p_association_id);
  v_phone  text := nullif(btrim(p_phone), '');
  v_addr   text := nullif(btrim(p_mailing_address), '');
begin
  if v_person is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_phone is not null and char_length(v_phone) > 40 then
    raise exception 'phone number is too long' using errcode = '22023';
  end if;
  if v_addr is not null and char_length(v_addr) > 300 then
    raise exception 'mailing address is too long' using errcode = '22023';
  end if;
  update public.persons set phone = v_phone, mailing_address = v_addr where id = v_person;
end $$;

revoke all on function public.update_my_profile(uuid, text, text) from public, anon;
grant execute on function public.update_my_profile(uuid, text, text) to authenticated;

comment on function public.update_my_profile(uuid, text, text) is
  'The signed-in person edits their own phone and mailing address. Name and email are the board''s record.';

-- ----------------------------------------------------------------------------
-- 4. viewer_context
-- ----------------------------------------------------------------------------

create or replace function public.viewer_context(p_association_id uuid)
returns table (
  person_id          uuid,
  full_name          text,
  roles              text[],
  is_board           boolean,
  is_board_admin     boolean,
  can_read_financials boolean,
  owned_unit_ids     uuid[]
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
         coalesce((select array_agg(u) from public.owned_unit_ids(p_association_id) u), '{}'::uuid[])
    from public.persons p
   where p.id = public.current_person_id(p_association_id)
$$;

revoke all on function public.viewer_context(uuid) from public, anon;
grant execute on function public.viewer_context(uuid) to authenticated;

comment on function public.viewer_context(uuid) is
  'The caller''s own person, active roles and owned units in one call. Zero rows when the caller has no person here or the session is not aal2.';

-- ----------------------------------------------------------------------------
-- 5. Statements
-- ----------------------------------------------------------------------------
-- One rule everywhere: a unit's NET balance = open charge balances (what
-- unit_balances calls balance_owed) minus payments not yet applied to a
-- charge (payment_unapplied). The running balance on a statement ends at the
-- same figure. Waived and written-off charges appear as adjustment lines.
-- Gate: a financial reader, or the owner of that unit. Anyone else gets zero
-- rows, the same as a unit that does not exist (DECISIONS #17).

create or replace function public.unit_position_core(p_unit_id uuid, p_as_of date default current_date)
returns table (
  unit_id              uuid,
  unit_label           text,
  as_of                date,
  owed                 text,
  overdue              text,
  credit               text,
  net                  text,
  open_charges         integer,
  oldest_overdue_on    date,
  next_due_on          date,
  next_due_amount      text,
  last_payment_on      date,
  last_payment_amount  text
)
language sql stable security definer set search_path = ''
as $$
  with u as (
    select un.id, un.label, un.association_id
      from public.units un
     where un.id = p_unit_id
  ),
  ch as (
    select c.id, c.due_on,
           c.amount - coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.charge_id = c.id), 0) as bal
      from public.assessment_charges c
      join u on u.id = c.unit_id
     where c.waived_at is null and c.written_off_at is null
  ),
  open_ch as (select * from ch where bal > 0),
  cr as (
    select coalesce(sum(p.amount - coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.payment_id = p.id), 0)), 0) as credit
      from public.payments p join u on u.id = p.unit_id
  ),
  nd as (
    select min(due_on) as d from open_ch where due_on >= p_as_of
  ),
  lp as (
    select p.received_on, p.amount
      from public.payments p join u on u.id = p.unit_id
     order by p.received_on desc, p.created_at desc limit 1
  )
  select u.id, u.label, p_as_of,
         coalesce((select sum(bal) from open_ch), 0)::numeric(14,2)::text,
         coalesce((select sum(bal) from open_ch where due_on < p_as_of), 0)::numeric(14,2)::text,
         (select credit from cr)::numeric(14,2)::text,
         (coalesce((select sum(bal) from open_ch), 0) - (select credit from cr))::numeric(14,2)::text,
         (select count(*) from open_ch)::integer,
         (select min(due_on) from open_ch where due_on < p_as_of),
         (select d from nd),
         (select sum(bal)::numeric(14,2)::text from open_ch where due_on = (select d from nd)),
         (select received_on from lp),
         (select amount::numeric(14,2)::text from lp)
    from u
$$;

-- Internal: no access check, so it also serves the email sender (which has no
-- signed-in user). Nobody but other SECURITY DEFINER functions may call it.
revoke all on function public.unit_position_core(uuid, date) from public, anon, authenticated;

create or replace function public.unit_statement_summary(p_unit_id uuid, p_as_of date default current_date)
returns table (
  unit_id uuid, unit_label text, as_of date, owed text, overdue text, credit text, net text,
  open_charges integer, oldest_overdue_on date, next_due_on date, next_due_amount text,
  last_payment_on date, last_payment_amount text)
language sql stable security definer set search_path = ''
as $$
  select c.*
    from public.unit_position_core(p_unit_id, p_as_of) c
    join public.units un on un.id = c.unit_id
   where public.can_read_financials(un.association_id)
      or un.id in (select public.owned_unit_ids(un.association_id))
$$;

revoke all on function public.unit_statement_summary(uuid, date) from public, anon;
grant execute on function public.unit_statement_summary(uuid, date) to authenticated;

comment on function public.unit_statement_summary(uuid, date) is
  'One unit''s position as of a day: owed (open charges), overdue, unapplied credit, net, next due and last payment. Money as text. Financial readers and the unit''s owners only; anyone else gets no rows.';

create or replace function public.unit_statement_core(p_unit_id uuid, p_from date default null, p_to date default null)
returns table (
  seq         integer,
  line_date   date,
  kind        text,
  description text,
  charge      text,
  payment     text,
  adjustment  text,
  balance     text,
  charge_id   uuid,
  payment_id  uuid
)
language sql stable security definer set search_path = ''
as $$
  with u as (
    select un.id, un.association_id
      from public.units un
     where un.id = p_unit_id
  ),
  ev as (
    select c.due_on as d, 1 as ord, 'charge'::text as k,
           case c.charge_type
             when 'assessment'         then 'Dues for ' || to_char(c.period_start, 'FMMonth YYYY')
             when 'special_assessment' then 'Special assessment'
             when 'late_fee'           then 'Late fee'
             else coalesce(nullif(btrim(je.memo), ''), 'Charge')
           end as descr,
           c.amount as chg, 0::numeric as pay, 0::numeric as adj,
           c.id as cid, null::uuid as pid, c.created_at as ts
      from public.assessment_charges c
      join u on u.id = c.unit_id
      left join public.journal_entries je on je.id = c.journal_entry_id
    union all
    select p.received_on, 2, 'payment',
           'Payment received' || case p.method
             when 'check' then ' by check' when 'ach' then ' by bank transfer'
             when 'cash' then ' in cash' when 'card' then ' by card' else '' end
             || coalesce(' (' || nullif(left(btrim(p.reference), 40), '') || ')', ''),
           0, p.amount, 0, null::uuid, p.id, p.created_at
      from public.payments p join u on u.id = p.unit_id
    union all
    select (coalesce(c.waived_at, c.written_off_at) at time zone 'America/Chicago')::date, 3,
           case when c.waived_at is not null then 'waiver' else 'write_off' end,
           case when c.waived_at is not null then 'Charge waived: ' else 'Charge written off: ' end
             || case c.charge_type
                  when 'assessment' then 'dues for ' || to_char(c.period_start, 'FMMonth YYYY')
                  when 'special_assessment' then 'special assessment'
                  when 'late_fee' then 'late fee' else 'charge' end,
           0, 0,
           c.amount - coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.charge_id = c.id), 0),
           c.id, null::uuid, coalesce(c.waived_at, c.written_off_at)
      from public.assessment_charges c join u on u.id = c.unit_id
     where c.waived_at is not null or c.written_off_at is not null
  ),
  run as (
    select ev.*,
           sum(chg - pay - adj) over (order by d, ord, ts, coalesce(cid, pid)
                                      rows between unbounded preceding and current row) as bal
      from ev
  ),
  opening as (
    select coalesce(sum(chg - pay - adj) filter (where d < p_from), 0) as bal from ev where p_from is not null
  ),
  lines as (
    select 0 as s, p_from as ld, 'opening'::text as k, 'Balance before this statement'::text as descr,
           null::numeric as chg, null::numeric as pay, null::numeric as adj, o.bal as bal,
           null::uuid as cid, null::uuid as pid
      from opening o where p_from is not null
    union all
    select (row_number() over (order by d, ord, ts, coalesce(cid, pid)))::integer, d, k, descr, chg, pay, adj, bal, cid, pid
      from run
     where (p_from is null or d >= p_from) and (p_to is null or d <= p_to)
  )
  select s, ld, k, descr,
         chg::numeric(14,2)::text, pay::numeric(14,2)::text, adj::numeric(14,2)::text,
         bal::numeric(14,2)::text, cid, pid
    from lines
   order by s
$$;

revoke all on function public.unit_statement_core(uuid, date, date) from public, anon, authenticated;

create or replace function public.unit_statement(p_unit_id uuid, p_from date default null, p_to date default null)
returns table (
  seq integer, line_date date, kind text, description text, charge text, payment text,
  adjustment text, balance text, charge_id uuid, payment_id uuid)
language sql stable security definer set search_path = ''
as $$
  select c.*
    from public.unit_statement_core(p_unit_id, p_from, p_to) c
   where exists (
     select 1 from public.units un
      where un.id = p_unit_id
        and (public.can_read_financials(un.association_id)
             or un.id in (select public.owned_unit_ids(un.association_id))))
$$;

revoke all on function public.unit_statement(uuid, date, date) from public, anon;
grant execute on function public.unit_statement(uuid, date, date) to authenticated;

comment on function public.unit_statement(uuid, date, date) is
  'A unit''s charges, payments and adjustments with a running balance (owed minus unapplied credit), dates inclusive. An opening line carries the balance before p_from. Money as text. Financial readers and the unit''s owners only.';

-- ----------------------------------------------------------------------------
-- 6. Announcements
-- ----------------------------------------------------------------------------

create table public.announcements (
  id                     uuid primary key default gen_random_uuid(),
  association_id         uuid not null references public.associations(id) on delete restrict,
  title                  text not null check (char_length(btrim(title)) between 1 and 120),
  body                   text not null check (char_length(btrim(body)) between 1 and 5000),
  audience               text not null default 'all' check (audience in ('all', 'units')),
  pinned                 boolean not null default false,
  status                 text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  attachment_document_id uuid references public.documents(id) on delete restrict,
  expires_on             date,
  published_at           timestamptz,
  edited_at              timestamptz,
  archived_at            timestamptz,
  created_by             uuid references auth.users(id) default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check ((status = 'draft') = (published_at is null)),
  check ((status = 'archived') = (archived_at is not null)),
  check (not pinned or status = 'published')
);

create index announcements_assoc_idx on public.announcements (association_id, status, published_at desc);

comment on table public.announcements is
  'A board post to owners: everyone or chosen units, optionally pinned, with an optional Document Hub attachment. Plain text, no comments. Written only by save_announcement / set_announcement_status / delete_announcement_draft.';

create table public.announcement_units (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references public.associations(id) on delete restrict,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  unit_id         uuid not null references public.units(id) on delete restrict,
  unique (announcement_id, unit_id)
);

create index announcement_units_unit_idx on public.announcement_units (unit_id);

comment on table public.announcement_units is
  'The units an audience = units announcement is for. Empty for audience = all.';

create table public.announcement_reads (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references public.associations(id) on delete restrict,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  person_id       uuid not null references public.persons(id) on delete restrict,
  read_at         timestamptz not null default now(),
  unique (announcement_id, person_id)
);

comment on table public.announcement_reads is
  'Who has opened an announcement. A person reads only their own rows; the board sees counts through announcement_reader_stats(), never names.';

-- Same-association guards ----------------------------------------------------

create or replace function public.tg_announcements_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'announcements' then
    if new.attachment_document_id is not null and not exists (
      select 1 from public.documents d
       where d.id = new.attachment_document_id and d.association_id = new.association_id
    ) then
      raise exception 'document belongs to a different association' using errcode = '42501';
    end if;
  elsif tg_table_name = 'announcement_units' then
    if not exists (select 1 from public.units u where u.id = new.unit_id and u.association_id = new.association_id)
       or not exists (select 1 from public.announcements a where a.id = new.announcement_id and a.association_id = new.association_id) then
      raise exception 'unit or announcement belongs to a different association' using errcode = '42501';
    end if;
  elsif tg_table_name = 'announcement_reads' then
    if not exists (select 1 from public.persons p where p.id = new.person_id and p.association_id = new.association_id)
       or not exists (select 1 from public.announcements a where a.id = new.announcement_id and a.association_id = new.association_id) then
      raise exception 'person or announcement belongs to a different association' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.tg_announcements_same_association() from public, anon;
grant execute on function public.tg_announcements_same_association() to authenticated;

create trigger announcements_same_association before insert or update on public.announcements
  for each row execute function public.tg_announcements_same_association();
create trigger announcement_units_same_association before insert or update on public.announcement_units
  for each row execute function public.tg_announcements_same_association();
create trigger announcement_reads_same_association before insert or update on public.announcement_reads
  for each row execute function public.tg_announcements_same_association();

-- Lifecycle trigger ----------------------------------------------------------

create or replace function public.tg_announcements_lifecycle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.status = 'published' then new.published_at := coalesce(new.published_at, now()); end if;
    -- The cap applies to a post made already pinned, not only to a later pin.
    if new.pinned and new.status = 'published' and
       (select count(*) from public.announcements a
         where a.association_id = new.association_id and a.pinned and a.status = 'published') >= 3 then
      raise exception 'only three announcements can be pinned at once' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.status in ('published', 'archived') and new.status = 'draft' then
    raise exception 'a posted announcement cannot go back to a draft; archive it instead' using errcode = 'check_violation';
  end if;
  if old.status = 'draft' and new.status = 'published' then
    new.published_at := now();
  end if;
  if new.status = 'archived' then
    new.archived_at := coalesce(old.archived_at, now());
    new.pinned := false;
  elsif old.status = 'archived' and new.status = 'published' then
    new.archived_at := null;
  end if;
  if old.status <> 'draft' and (new.title is distinct from old.title
        or new.body is distinct from old.body
        or new.attachment_document_id is distinct from old.attachment_document_id) then
    new.edited_at := now();
  end if;
  if new.pinned and new.status = 'published' and
     (select count(*) from public.announcements a
       where a.association_id = new.association_id and a.pinned and a.status = 'published' and a.id <> new.id) >= 3 then
    raise exception 'only three announcements can be pinned at once' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.tg_announcements_lifecycle() from public, anon;
grant execute on function public.tg_announcements_lifecycle() to authenticated;

create trigger announcements_lifecycle before insert or update on public.announcements
  for each row execute function public.tg_announcements_lifecycle();

create trigger audit_announcements after insert or update or delete on public.announcements
  for each row execute function public.tg_audit();
create trigger audit_announcement_units after insert or update or delete on public.announcement_units
  for each row execute function public.tg_audit();

-- RLS ------------------------------------------------------------------------

alter table public.announcements       enable row level security;
alter table public.announcement_units  enable row level security;
alter table public.announcement_reads  enable row level security;

-- Board sees everything, the accountant everything posted, an owner what was
-- posted to everyone or to a unit they own, until it expires. No write
-- policies on any of the three: the RPCs below are the only way in.
create policy announcements_select on public.announcements
  for select to authenticated
  using (
    public.is_board(association_id)
    or (public.can_read_financials(association_id) and status <> 'draft')
    or (
      status = 'published'
      and (expires_on is null or expires_on >= current_date)
      and public.is_member(association_id)
      and (
        audience = 'all'
        or exists (
          select 1 from public.announcement_units au
           where au.announcement_id = announcements.id
             and au.unit_id in (select public.owned_unit_ids(announcements.association_id))
        )
      )
    )
  );

create policy announcement_units_select on public.announcement_units
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or unit_id in (select public.owned_unit_ids(association_id))
  );

create policy announcement_reads_select on public.announcement_reads
  for select to authenticated
  using (person_id = public.current_person_id(association_id));

-- save_announcement ----------------------------------------------------------

create or replace function public.save_announcement(
  p_association_id uuid,
  p_id             uuid,
  p_title          text,
  p_body           text,
  p_audience       text,
  p_unit_ids       uuid[],
  p_pinned         boolean,
  p_attachment_document_id uuid,
  p_expires_on     date,
  p_publish        boolean
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id     uuid;
  v_status text;
  v_units  uuid[] := coalesce(p_unit_ids, '{}');
  v_doc    public.documents%rowtype;
begin
  if not public.is_board(p_association_id) then
    raise exception 'only the board can post announcements' using errcode = '42501';
  end if;
  if p_audience not in ('all', 'units') then
    raise exception 'audience must be all or units' using errcode = '22023';
  end if;
  if p_audience = 'units' and cardinality(v_units) = 0 then
    raise exception 'choose at least one unit' using errcode = '22023', hint = 'no_units';
  end if;
  if p_audience = 'all' then v_units := '{}'; end if;
  if exists (select 1 from unnest(v_units) x where not exists (
       select 1 from public.units u where u.id = x and u.association_id = p_association_id)) then
    raise exception 'unit belongs to a different association' using errcode = '42501';
  end if;
  if p_expires_on is not null and p_expires_on < current_date then
    raise exception 'the end date is in the past' using errcode = '22023', hint = 'expires_past';
  end if;

  -- An attachment must already be readable by exactly this audience (the
  -- Document Hub decides who can open a file; the announcement cannot widen it).
  if p_attachment_document_id is not null then
    select * into v_doc from public.documents
     where id = p_attachment_document_id and association_id = p_association_id and deleted_at is null;
    if not found then
      raise exception 'attachment not found' using errcode = '22023', hint = 'attachment_missing';
    end if;
    if not (
      (v_doc.restricted_to_unit_id is null and v_doc.visibility = 'all_owners')
      or (p_audience = 'units' and cardinality(v_units) = 1 and v_doc.restricted_to_unit_id = v_units[1])
    ) then
      raise exception 'owners cannot open that file yet' using errcode = '22023', hint = 'attachment_not_shared';
    end if;
  end if;

  v_status := case when p_publish then 'published' else 'draft' end;

  if p_id is null then
    insert into public.announcements
      (association_id, title, body, audience, pinned, status, attachment_document_id, expires_on)
    values
      (p_association_id, btrim(p_title), btrim(p_body), p_audience,
       coalesce(p_pinned, false) and p_publish, v_status, p_attachment_document_id, p_expires_on)
    returning id into v_id;
  else
    select a.id, a.status into v_id, v_status from public.announcements a
     where a.id = p_id and a.association_id = p_association_id for update;
    if v_id is null then
      raise exception 'announcement not found' using errcode = '22023';
    end if;
    if v_status = 'archived' then
      raise exception 'restore it before editing' using errcode = '22023';
    end if;
    update public.announcements set
      title = btrim(p_title), body = btrim(p_body), audience = p_audience,
      pinned = coalesce(p_pinned, false) and (p_publish or v_status = 'published'),
      attachment_document_id = p_attachment_document_id, expires_on = p_expires_on,
      status = case when v_status = 'draft' and p_publish then 'published' else v_status end
     where id = v_id;
  end if;

  delete from public.announcement_units where announcement_id = v_id;
  insert into public.announcement_units (association_id, announcement_id, unit_id)
  select p_association_id, v_id, x from unnest(v_units) x;

  return v_id;
end $$;

revoke all on function public.save_announcement(uuid, uuid, text, text, text, uuid[], boolean, uuid, date, boolean) from public, anon;
grant execute on function public.save_announcement(uuid, uuid, text, text, text, uuid[], boolean, uuid, date, boolean) to authenticated;

create or replace function public.set_announcement_status(p_announcement_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a public.announcements%rowtype;
begin
  select * into a from public.announcements where id = p_announcement_id;
  if not found or not public.is_board(a.association_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_status not in ('archived', 'published') then
    raise exception 'status must be archived or published' using errcode = '22023';
  end if;
  if a.status = 'draft' and p_status = 'archived' then
    raise exception 'delete a draft instead' using errcode = '22023';
  end if;
  update public.announcements set status = p_status where id = a.id;
end $$;

revoke all on function public.set_announcement_status(uuid, text) from public, anon;
grant execute on function public.set_announcement_status(uuid, text) to authenticated;

create or replace function public.set_announcement_pinned(p_announcement_id uuid, p_pinned boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a public.announcements%rowtype;
begin
  select * into a from public.announcements where id = p_announcement_id;
  if not found or not public.is_board(a.association_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.status <> 'published' then
    raise exception 'only a posted announcement can be pinned' using errcode = '22023';
  end if;
  update public.announcements set pinned = p_pinned where id = a.id;
end $$;

revoke all on function public.set_announcement_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_announcement_pinned(uuid, boolean) to authenticated;

create or replace function public.delete_announcement_draft(p_announcement_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a public.announcements%rowtype;
begin
  select * into a from public.announcements where id = p_announcement_id;
  if not found or not public.is_board(a.association_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if a.status <> 'draft' then
    raise exception 'only a draft can be deleted; archive a posted announcement' using errcode = '22023';
  end if;
  delete from public.announcements where id = a.id;
end $$;

revoke all on function public.delete_announcement_draft(uuid) from public, anon;
grant execute on function public.delete_announcement_draft(uuid) to authenticated;

-- Reading ----------------------------------------------------------------------

create or replace function public.mark_announcement_read(p_announcement_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a public.announcements%rowtype;
  v_person uuid;
begin
  select * into a from public.announcements where id = p_announcement_id;
  if not found then return; end if;
  v_person := public.current_person_id(a.association_id);
  if v_person is null then return; end if;
  -- Only what the caller could see counts as read (the same rule as the policy).
  if not (
    a.status = 'published'
    and (a.expires_on is null or a.expires_on >= current_date)
    and public.is_member(a.association_id)
    and (a.audience = 'all' or exists (
          select 1 from public.announcement_units au
           where au.announcement_id = a.id
             and au.unit_id in (select public.owned_unit_ids(a.association_id))))
  ) then
    return;
  end if;
  insert into public.announcement_reads (association_id, announcement_id, person_id)
  values (a.association_id, a.id, v_person)
  on conflict (announcement_id, person_id) do nothing;
end $$;

revoke all on function public.mark_announcement_read(uuid) from public, anon;
grant execute on function public.mark_announcement_read(uuid) to authenticated;

create or replace function public.announcements_unread(p_association_id uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::integer
    from public.announcements a
   where a.association_id = p_association_id
     and public.current_person_id(p_association_id) is not null
     and a.status = 'published'
     and (a.expires_on is null or a.expires_on >= current_date)
     and a.published_at > now() - interval '90 days'
     and public.is_member(p_association_id)
     and (a.audience = 'all' or exists (
           select 1 from public.announcement_units au
            where au.announcement_id = a.id
              and au.unit_id in (select public.owned_unit_ids(p_association_id))))
     and not exists (
           select 1 from public.announcement_reads r
            where r.announcement_id = a.id and r.person_id = public.current_person_id(p_association_id))
$$;

revoke all on function public.announcements_unread(uuid) from public, anon;
grant execute on function public.announcements_unread(uuid) to authenticated;

-- Board only: for each announcement, how many owners it reaches who can sign
-- in, how many have opened it, and how many it reaches who have no login.
create or replace function public.announcement_reader_stats(p_association_id uuid)
returns table (announcement_id uuid, readers_total integer, readers_read integer, no_login integer)
language sql stable security definer set search_path = ''
as $$
  with aud as (
    select a.id as aid, p.id as pid, p.auth_user_id
      from public.announcements a
      join public.unit_owners uo
        on uo.association_id = a.association_id
       and (uo.effective_to is null or uo.effective_to >= current_date)
       and uo.effective_from <= current_date
       and (a.audience = 'all' or exists (
             select 1 from public.announcement_units au
              where au.announcement_id = a.id and au.unit_id = uo.unit_id))
      join public.persons p on p.id = uo.person_id
     where a.association_id = p_association_id
       and a.status in ('published', 'archived')
       and public.is_board(p_association_id)
  )
  select aid,
         count(distinct pid) filter (where auth_user_id is not null)::integer,
         count(distinct pid) filter (where auth_user_id is not null and exists (
           select 1 from public.announcement_reads r where r.announcement_id = aud.aid and r.person_id = aud.pid))::integer,
         count(distinct pid) filter (where auth_user_id is null)::integer
    from aud
   group by aid
$$;

revoke all on function public.announcement_reader_stats(uuid) from public, anon;
grant execute on function public.announcement_reader_stats(uuid) to authenticated;

-- The Document Hub may link a file to an announcement.
alter table public.document_links drop constraint document_links_target_table_known;
alter table public.document_links
  add constraint document_links_target_table_known
  check (target_table in (
    'associations', 'units', 'persons', 'vendors',
    'journal_entries', 'expenses', 'assessment_charges', 'payments',
    'insurance_policies', 'tickets', 'recurring_bills', 'fiscal_years',
    'tax_forms', 'insurance_quotes', 'insurance_claims',
    'announcements'
  ));

-- ----------------------------------------------------------------------------
-- 7. Owner conveniences
-- ----------------------------------------------------------------------------

-- Names of the people on the board, for "who is the board" (no contact details:
-- those are the board contact on associations and building_emergency_contacts).
create or replace function public.board_roster(p_association_id uuid)
returns table (full_name text, role text)
language sql stable security definer set search_path = ''
as $$
  select p.full_name, g.role::text
    from public.role_grants g
    join public.persons p on p.id = g.person_id
   where g.association_id = p_association_id
     and g.role in ('board_admin', 'board_member')
     and g.revoked_at is null
     and (g.expires_on is null or g.expires_on >= current_date)
     and public.is_member(p_association_id)
   order by (g.role = 'board_admin') desc, p.full_name
$$;

revoke all on function public.board_roster(uuid) from public, anon;
grant execute on function public.board_roster(uuid) to authenticated;

-- An owner takes back a report they have not had answered (wrong amount).
create or replace function public.withdraw_payment_report(p_report_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.dues_payment_reports%rowtype;
begin
  select * into r from public.dues_payment_reports where id = p_report_id;
  if not found or r.reported_by is distinct from auth.uid()
     or public.current_person_id(r.association_id) is null then   -- carries the aal2 test; exists on every project
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'the board has already answered this report' using errcode = '22023';
  end if;
  update public.dues_payment_reports
     set status = 'dismissed', resolution_note = 'Withdrawn by the person who sent it',
         resolved_at = now(), resolved_by = auth.uid()
   where id = r.id;
end $$;

revoke all on function public.withdraw_payment_report(uuid) from public, anon;
grant execute on function public.withdraw_payment_report(uuid) to authenticated;

-- At most ten reports waiting per unit, so the form cannot be used to bury the
-- treasurer's queue.
create or replace function public.tg_dues_report_pending_cap()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.dues_payment_reports r
       where r.unit_id = new.unit_id and r.status = 'pending') >= 10 then
    raise exception 'there are already ten reports waiting for this unit' using errcode = '53400', hint = 'report_cap';
  end if;
  return new;
end $$;

revoke all on function public.tg_dues_report_pending_cap() from public, anon;
grant execute on function public.tg_dues_report_pending_cap() to authenticated;

create trigger dues_payment_reports_pending_cap
  before insert on public.dues_payment_reports
  for each row execute function public.tg_dues_report_pending_cap();
