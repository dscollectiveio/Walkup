-- ============================================================================
-- 0066: property managers for individual units, and a main contact per unit
-- ============================================================================
-- A unit can have one property manager: a person record (name, email, phone;
-- no login) linked to the unit, with an optional company. Each unit also has a
-- "main contact", the person Walkup's own emails (dues reminders, statements,
-- announcements, the standing reminder rules) go to by default. It starts as
-- the owner, so nothing changes until a board member chooses the manager for
-- that unit. If the manager has no email, the owner is used instead.
--
-- Walkup's email already works on person records, so the manager gets the same
-- protections as anyone: an unsubscribe link, bounce and complaint blocking, the
-- one-email-a-week limit and the daily limits.

create table public.unit_property_managers (
  unit_id         uuid primary key references public.units(id) on delete restrict,
  association_id  uuid not null references public.associations(id) on delete restrict,
  person_id       uuid not null references public.persons(id) on delete restrict,
  company         text check (company is null or char_length(company) <= 120),
  main_contact    text not null default 'owner' check (main_contact in ('owner', 'manager')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on public.unit_property_managers (association_id);
create index on public.unit_property_managers (person_id);

comment on table public.unit_property_managers is
  'One property manager per unit (a persons row with no login) and which of owner or manager is the unit''s main contact for Walkup email.';

alter table public.unit_property_managers enable row level security;

-- The board and the accountant read them; an owner reads only their own unit's.
create policy unit_property_managers_select on public.unit_property_managers
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or unit_id in (select public.owned_unit_ids(association_id))
  );

create policy unit_property_managers_insert on public.unit_property_managers
  for insert to authenticated
  with check (public.is_board(association_id));

create policy unit_property_managers_update on public.unit_property_managers
  for update to authenticated
  using (public.is_board(association_id))
  with check (public.is_board(association_id));

create policy unit_property_managers_delete on public.unit_property_managers
  for delete to authenticated
  using (public.is_board(association_id));

-- The unit and the person must belong to the association on the row (the same
-- guard 0040 gave every other table that points at a unit or a person).
create or replace function public.tg_unit_manager_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.units u where u.id = new.unit_id and u.association_id = new.association_id)
     or not exists (select 1 from public.persons p where p.id = new.person_id and p.association_id = new.association_id) then
    raise exception 'unit or person belongs to a different association' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.tg_unit_manager_same_association() from public, anon, authenticated;

create trigger unit_property_managers_same_association
  before insert or update on public.unit_property_managers
  for each row execute function public.tg_unit_manager_same_association();

create trigger audit_unit_property_managers after insert or update or delete on public.unit_property_managers
  for each row execute function public.tg_audit();

-- Who Walkup's email goes to for a unit: the manager when the board made the
-- manager the main contact and the manager has an email address, otherwise the
-- owner. Used by the two functions that choose recipients, below.
create or replace function public.email_contact_person(p_unit uuid, p_owner uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select m.person_id
      from public.unit_property_managers m
      join public.persons mp on mp.id = m.person_id
     where m.unit_id = p_unit
       and m.main_contact = 'manager'
       and mp.email is not null and btrim(mp.email) <> ''
  ), p_owner)
$$;

revoke all on function public.email_contact_person(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- The two functions that choose recipients, as in 0055 with one change each:
-- they ask email_contact_person instead of always using the owner.
-- ----------------------------------------------------------------------------

create or replace function public.email_prepare_batch(
  p_association_id uuid,
  p_kind           text,
  p_unit_ids       uuid[],
  p_period_start   date default null,
  p_period_end     date default null,
  p_announcement_id uuid default null,
  p_fee_charge_id  uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_batch uuid;
  v_units uuid[] := coalesce(p_unit_ids, '{}');
  v_id    uuid;
  r       record;
  v_facts jsonb;
  v_skip  text;
  v_template text;
begin
  if not public.is_board(p_association_id) then
    raise exception 'only the board can prepare email' using errcode = '42501';
  end if;
  if p_kind not in ('dues_reminder', 'late_fee_notice', 'statement', 'annual_statement', 'announcement') then
    raise exception 'unknown kind' using errcode = '22023';
  end if;
  if cardinality(v_units) > 100 then
    raise exception 'at most 100 units in one batch' using errcode = '22023';
  end if;
  if p_kind in ('dues_reminder', 'statement', 'annual_statement') and cardinality(v_units) = 0 then
    raise exception 'choose at least one unit' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_units) x where not exists (
       select 1 from public.units u where u.id = x and u.association_id = p_association_id)) then
    raise exception 'unit belongs to a different association' using errcode = '42501';
  end if;
  if p_kind in ('statement', 'annual_statement') and (p_period_start is null or p_period_end is null) then
    raise exception 'a statement needs a period' using errcode = '22023';
  end if;

  if p_kind = 'late_fee_notice' then
    select array[c.unit_id] into v_units from public.assessment_charges c
     where c.id = p_fee_charge_id and c.association_id = p_association_id and c.charge_type = 'late_fee'
       and c.waived_at is null and c.written_off_at is null
       and c.amount - coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.charge_id = c.id), 0) > 0;
    if v_units is null then
      raise exception 'that late fee is not charged or is already settled' using errcode = '22023', hint = 'fee_not_open';
    end if;
  end if;
  if p_kind = 'announcement' and not exists (
       select 1 from public.announcements a
        where a.id = p_announcement_id and a.association_id = p_association_id and a.status = 'published') then
    raise exception 'that announcement is not posted' using errcode = '22023';
  end if;

  insert into public.email_batches (association_id, kind, period_start, period_end)
  values (p_association_id, p_kind, p_period_start, p_period_end)
  returning id into v_batch;

  v_template := p_kind;

  for r in
    select p.id as person_id, lower(p.email) as email, p.full_name,
           array_agg(distinct uo.unit_id) as owned
      from public.unit_owners uo
      join public.persons p on p.id = public.email_contact_person(uo.unit_id, uo.person_id)
     where uo.association_id = p_association_id
       and uo.effective_from <= public.email_today()
       and (uo.effective_to is null or uo.effective_to >= public.email_today())
       and (
         (p_kind = 'announcement' and exists (
            select 1 from public.announcements a
             where a.id = p_announcement_id
               and (a.audience = 'all' or exists (
                     select 1 from public.announcement_units au
                      where au.announcement_id = a.id and au.unit_id = uo.unit_id))))
         or (p_kind <> 'announcement' and uo.unit_id = any (v_units)))
     group by p.id, p.email, p.full_name
  loop
    if p_kind = 'dues_reminder' then
      select jsonb_build_object('units', coalesce(jsonb_agg(public.email_unit_facts(x, public.email_today())), '[]'::jsonb))
        into v_facts
        from unnest(r.owned) x
       where x = any (v_units)
          -- THE NET RULE (REVIEW-4 #5): a unit is dunned for what is past due after its
          -- unapplied payments are counted, the same figure the statement ends on.
          and greatest((public.email_unit_facts(x, public.email_today()) ->> 'overdue')::numeric
                       - (public.email_unit_facts(x, public.email_today()) ->> 'credit')::numeric, 0) > 0;
      if jsonb_array_length(v_facts -> 'units') = 0 then continue; end if;
    elsif p_kind = 'late_fee_notice' then
      v_facts := jsonb_build_object(
        'units', jsonb_build_array(public.email_unit_facts(v_units[1], public.email_today())),
        'fee_charge_id', p_fee_charge_id,
        'fee_amount', (select c.amount::numeric(14,2)::text from public.assessment_charges c where c.id = p_fee_charge_id),
        'fee_charged_on', (select c.due_on from public.assessment_charges c where c.id = p_fee_charge_id));
    elsif p_kind in ('statement', 'annual_statement') then
      select jsonb_build_object('units', jsonb_agg(public.email_statement_facts(x, p_period_start, p_period_end)))
        into v_facts from unnest(r.owned) x where x = any (v_units);
    else
      v_facts := jsonb_build_object('announcement_id', p_announcement_id);
    end if;

    perform public.email_ensure_preferences(r.person_id);
    v_skip := public.email_skip_reason(p_association_id, r.person_id, r.email, p_kind);
    v_id := gen_random_uuid();
    insert into public.email_outbox
      (id, association_id, batch_id, kind, person_id, unit_ids, to_email, to_name, facts,
       template_key, status, skip_reason, idempotency_key)
    values
      (v_id, p_association_id, v_batch, p_kind, r.person_id,
       case when p_kind = 'announcement' then r.owned else (select coalesce(array_agg(x), '{}') from unnest(r.owned) x where x = any (v_units)) end,
       coalesce(nullif(r.email, ''), 'invalid@invalid.invalid'), left(r.full_name, 120), v_facts,
       v_template, case when v_skip is null then 'draft' else 'skipped' end, v_skip, 'wk-' || v_id::text);
  end loop;

  return v_batch;
end $$;

revoke all on function public.email_prepare_batch(uuid, text, uuid[], date, date, uuid, uuid) from public, anon;
grant execute on function public.email_prepare_batch(uuid, text, uuid[], date, date, uuid, uuid) to authenticated;

create or replace function public.email_run_rules(p_today date)
returns table (association_id uuid, batch_id uuid, queued integer)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  rl record;
  v_batch uuid;
  v_n integer;
  c record;
  v_id uuid;
  v_facts jsonb;
  v_skip text;
begin
  if not public.email_is_service() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  for rl in
    select r.* from public.reminder_rules r
      join public.email_settings s on s.association_id = r.association_id
     where r.enabled and r.paused_at is null and s.sending_enabled and s.suspended_at is null
       and (r.last_run_on is null or r.last_run_on < p_today)
       -- A standing rule carries its enabler's approval. Once that person no longer holds an active
       -- board_admin grant here, the rule does not run until a current admin turns it on again.
       and exists (
         select 1 from public.role_grants g join public.persons gp on gp.id = g.person_id
          where gp.auth_user_id = r.enabled_by and g.association_id = r.association_id
            and g.role = 'board_admin' and g.revoked_at is null
            and (g.expires_on is null or g.expires_on >= p_today))
  loop
    v_batch := null; v_n := 0;

    for c in
      with owned as (
        select distinct uo.unit_id, p.id as person_id, lower(p.email) as email, p.full_name
          from public.unit_owners uo join public.persons p on p.id = public.email_contact_person(uo.unit_id, uo.person_id)
         where uo.association_id = rl.association_id and uo.effective_from <= p_today
           and (uo.effective_to is null or uo.effective_to >= p_today)
      ), pos as (
        select o.*, f as facts
          from owned o, lateral public.email_unit_facts(o.unit_id, p_today) f
      ), due as (
        select pos.*,
               -- net rule: what is owed after unapplied payments, never below zero
               greatest((pos.facts ->> 'owed')::numeric - (pos.facts ->> 'credit')::numeric, 0) as owed_n,
               greatest((pos.facts ->> 'overdue')::numeric - (pos.facts ->> 'credit')::numeric, 0) as overdue_n,
               (pos.facts ->> 'oldest_overdue_on')::date as oldest,
               (select min(ch.due_on) from public.assessment_charges ch
                 where ch.unit_id = pos.unit_id and ch.waived_at is null and ch.written_off_at is null
                   and ch.due_on >= p_today
                   and ch.amount - coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.charge_id = ch.id), 0) > 0) as next_due
          from pos
      )
      select d.person_id, d.email, d.full_name,
             array_agg(d.unit_id) as unit_ids,
             jsonb_agg(d.facts) as unit_facts
        from due d
       where d.owed_n >= rl.min_amount
         and (
           (rl.kind = 'dues_overdue' and d.overdue_n > 0 and d.oldest is not null and p_today - d.oldest >= rl.days
              and (select count(*) from public.email_outbox ob
                    where d.unit_id = any (ob.unit_ids) and ob.kind = 'dues_reminder' and ob.batch_id in (
                          select bb.id from public.email_batches bb where bb.rule_id = rl.id)
                      and ob.status in ('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained')
                      and (ob.created_at at time zone 'America/Chicago')::date >= d.oldest) < rl.max_reminders
              and not exists (select 1 from public.email_outbox ob
                    where d.unit_id = any (ob.unit_ids) and ob.kind = 'dues_reminder'
                      and ob.batch_id in (select bb.id from public.email_batches bb where bb.rule_id = rl.id)
                      and ob.status in ('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained')
                      and (ob.created_at at time zone 'America/Chicago')::date > p_today - rl.repeat_every_days))
           or (rl.kind = 'dues_upcoming' and d.next_due is not null and d.next_due - p_today <= rl.days
               and d.overdue_n = 0)
         )
       group by d.person_id, d.email, d.full_name
    loop
      v_skip := public.email_skip_reason(rl.association_id, c.person_id, c.email, 'dues_reminder');
      if v_skip is not null then continue; end if;
      if v_batch is null then
        insert into public.email_batches (association_id, kind, source, rule_id, status, created_by, approved_by, approved_at)
        values (rl.association_id, 'dues_reminder', 'rule', rl.id, 'approved', rl.enabled_by, rl.enabled_by, now())
        returning id into v_batch;
      end if;
      perform public.email_ensure_preferences(c.person_id);
      v_id := gen_random_uuid();
      insert into public.email_outbox
        (id, association_id, batch_id, kind, person_id, unit_ids, to_email, to_name, facts,
         template_key, status, queued_at, idempotency_key)
      values
        (v_id, rl.association_id, v_batch, 'dues_reminder', c.person_id, c.unit_ids, c.email, left(c.full_name, 120),
         jsonb_build_object('units', c.unit_facts, 'rule_kind', rl.kind, 'rule_days', rl.days),
         case rl.kind when 'dues_upcoming' then 'dues_upcoming' else 'dues_reminder' end, 'queued', now(), 'wk-' || v_id::text);
      perform public.email_log_event(rl.association_id, v_id, c.person_id, c.email, 'dues_reminder', 'queued', 'rule ' || rl.kind);
      v_n := v_n + 1;
    end loop;

    update public.reminder_rules set last_run_on = p_today where id = rl.id;
    if v_batch is not null then
      association_id := rl.association_id; batch_id := v_batch; queued := v_n;
      return next;
    end if;
  end loop;
end $$;

revoke all on function public.email_run_rules(date) from public, anon, authenticated;
grant execute on function public.email_run_rules(date) to service_role;
