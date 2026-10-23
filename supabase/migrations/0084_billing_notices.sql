-- ============================================================================
-- 0084: billing notices (DECISIONS #44, "Every promise of notice above is a promise Doug keeps by hand
-- until the notices are built")
-- ============================================================================
-- The Terms promise the board admins notice before four things happen:
--
--   price_change       a new price applies to them          30 days before, by email and in Walkup
--   read_only          the account becomes read-only        7 days before, on top of the 14-day grace
--   early_access_end   free early access ends               90 days before
--   founding_charge    the free first year of the founding  30 days before the first charge
--                      offer ends
--
-- (Tier changes at renewal are not built yet, so there is no notice for them.)
--
-- Each notice is a row in billing_notices. It is made by one of four things, none of which needs a person
-- to click "send":
--   * a platform admin schedules a price change (billing_schedule_price_change),
--   * a platform admin sets an end date on an early-access comp (billing_end_early_access) or grants a
--     founding comp (billing_grant_comp), and the daily run turns that date into a notice
--     (billing_generate_comp_notices),
--   * the daily run sees a building heading for read-only (billing_open_read_only_notice).
-- The daily run then emails every active board admin (billing_notice_claim / billing_notice_mark) and the
-- board sees the notice in Walkup (billing_notices_for).
--
-- The notice dates are enforced where they can be: an early-access end date has to be at least 90 days
-- away, a founding comp at least 30, a price change at least 30, and (in the app) a building does not go
-- read-only until a read-only notice has been emailed at least 7 days earlier.

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

create table public.billing_notices (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  kind           text not null check (kind in ('price_change', 'read_only', 'early_access_end', 'founding_charge')),
  -- The day the change takes effect.
  effective_on   date not null,
  -- Price changes carry the platform admin's words about the new price.
  detail         text check (detail is null or char_length(btrim(detail)) between 1 and 600),
  -- Makes every way of creating a notice safe to repeat.
  dedupe_key     text not null unique check (char_length(dedupe_key) between 1 and 200),
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  -- When the first email for this notice went out. The read-only guard counts its 7 days from here.
  emailed_at     timestamptz
);

create index billing_notices_association_idx on public.billing_notices (association_id, effective_on);

alter table public.billing_notices enable row level security;

-- The board reads its own building's notices. Nothing writes here except the functions below.
create policy billing_notices_select on public.billing_notices
  for select to authenticated using (public.is_board(association_id));

revoke all on public.billing_notices from anon;
revoke insert, update, delete, truncate, references, trigger on public.billing_notices from authenticated;

create trigger billing_notices_audit
  after insert or update or delete on public.billing_notices
  for each row execute function public.tg_audit();

comment on table public.billing_notices is
  'Notices the Terms promise before a price change, read-only, the end of early access or the first charge after a founding year. Read by the building''s board; written only by the billing_* functions.';

-- One row per board admin per notice, so a failed address is retried without sending the others twice.
create table public.billing_notice_deliveries (
  id              uuid primary key default gen_random_uuid(),
  notice_id       uuid not null references public.billing_notices(id) on delete cascade,
  association_id  uuid not null references public.associations(id) on delete restrict,
  person_id       uuid references public.persons(id) on delete set null,
  to_email        text not null,
  to_name         text,
  attempts        integer not null default 0,
  last_attempt_at timestamptz,
  sent_at         timestamptz,
  last_error      text check (last_error is null or char_length(last_error) <= 500),
  created_at      timestamptz not null default now(),
  unique (notice_id, to_email)
);

create index billing_notice_deliveries_open_idx on public.billing_notice_deliveries (created_at) where sent_at is null;

alter table public.billing_notice_deliveries enable row level security;
revoke all on public.billing_notice_deliveries from anon, authenticated;

comment on table public.billing_notice_deliveries is
  'One email per board admin per billing notice. No policy and no grant: only the service functions touch it.';

-- ----------------------------------------------------------------------------
-- 2. Comps: a "founding" kind, and the notice periods on the dates a platform admin sets
-- ----------------------------------------------------------------------------

alter table public.billing_comps drop constraint if exists billing_comps_kind_check;
alter table public.billing_comps
  add constraint billing_comps_kind_check
  check (kind in ('early_access', 'founding', 'friend', 'pilot', 'nonprofit', 'other'));

create or replace function public.billing_grant_comp(
  p_association_id uuid,
  p_kind text,
  p_reason text,
  p_expires_on date
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can give complimentary access.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.associations a where a.id = p_association_id) then
    raise exception 'No such association.' using errcode = 'P0002';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;
  if p_expires_on is not null and p_expires_on < current_date then
    raise exception 'The end date must be today or later.' using errcode = '22023';
  end if;
  -- The Terms promise 90 days' notice before early access ends and 30 days before the first charge after a
  -- founding year. The notice goes out as soon as the end date is set, so the date has to leave that long.
  if p_kind = 'early_access' and p_expires_on is not null and p_expires_on < current_date + 90 then
    raise exception 'Early access needs at least 90 days'' notice, so it can''t end before %.', (current_date + 90)::text
      using errcode = '22023';
  end if;
  if p_kind = 'founding' and (p_expires_on is null or p_expires_on < current_date + 30) then
    raise exception 'A founding comp needs an end date at least 30 days away: the day the free year ends.' using errcode = '22023';
  end if;

  insert into public.billing_accounts (association_id) values (p_association_id)
  on conflict (association_id) do nothing;

  update public.billing_comps
     set revoked_at = now(), revoked_by = auth.uid()
   where association_id = p_association_id and revoked_at is null;

  insert into public.billing_comps (association_id, kind, reason, expires_on, granted_by)
  values (p_association_id, p_kind, btrim(p_reason), p_expires_on, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.billing_grant_comp(uuid, text, text, date) from public, anon;
grant execute on function public.billing_grant_comp(uuid, text, text, date) to authenticated;

-- Sets the day an early-access building's free use ends (at least 90 days away). The daily run then notices it.
create or replace function public.billing_end_early_access(p_association_id uuid, p_ends_on date)
returns date
language plpgsql security definer set search_path = ''
as $$
declare
  v_rows integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can end early access.' using errcode = '42501';
  end if;
  if p_ends_on is null or p_ends_on < current_date + 90 then
    raise exception 'Early access needs at least 90 days'' notice, so it can''t end before %.', (current_date + 90)::text
      using errcode = '22023';
  end if;
  update public.billing_comps
     set expires_on = p_ends_on
   where association_id = p_association_id and revoked_at is null and kind = 'early_access' and starts_on <= p_ends_on;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'This building has no early-access comp to end.' using errcode = 'P0002';
  end if;
  return p_ends_on;
end $$;

revoke all on function public.billing_end_early_access(uuid, date) from public, anon;
grant execute on function public.billing_end_early_access(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Platform admin: schedule a price change
-- ----------------------------------------------------------------------------

-- One notice per building, effective on the date given (at least 30 days away). The detail is the platform
-- admin's plain words about what changes. Safe to repeat: a building already told about that date is skipped.
create or replace function public.billing_schedule_price_change(p_effective_on date, p_detail text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can schedule a price change.' using errcode = '42501';
  end if;
  if p_effective_on is null or p_effective_on < current_date + 30 then
    raise exception 'A price change needs at least 30 days'' notice, so it can''t start before %.', (current_date + 30)::text
      using errcode = '22023';
  end if;
  if p_detail is null or char_length(btrim(p_detail)) = 0 or char_length(btrim(p_detail)) > 600 then
    raise exception 'Say what is changing, in 600 characters or fewer.' using errcode = '22023';
  end if;

  insert into public.billing_notices (association_id, kind, effective_on, detail, dedupe_key, created_by)
  select a.id, 'price_change', p_effective_on, btrim(p_detail), 'price_change:' || a.id || ':' || p_effective_on, auth.uid()
    from public.associations a
   where a.deleted_at is null
  on conflict (dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.billing_schedule_price_change(date, text) from public, anon;
grant execute on function public.billing_schedule_price_change(date, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Reads
-- ----------------------------------------------------------------------------

-- What the board sees in Walkup, and what the read-only guard checks. Board only (an owner gets no rows).
create or replace function public.billing_notices_for(p_association_id uuid)
returns table (
  id           uuid,
  kind         text,
  effective_on date,
  detail       text,
  created_at   timestamptz,
  emailed_at   timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select n.id, n.kind, n.effective_on, n.detail, n.created_at, n.emailed_at
    from public.billing_notices n
   where n.association_id = p_association_id
     and public.is_board(p_association_id)
     and n.created_at > now() - interval '400 days'
   order by n.effective_on desc, n.created_at desc
$$;

revoke all on function public.billing_notices_for(uuid) from public, anon;
grant execute on function public.billing_notices_for(uuid) to authenticated;

-- The notices a platform admin has sent, for the admin page.
create or replace function public.billing_admin_notices()
returns table (
  association_id uuid,
  display_name   text,
  kind           text,
  effective_on   date,
  detail         text,
  created_at     timestamptz,
  emailed_at     timestamptz,
  recipients     integer,
  delivered      integer
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can see every building''s notices.' using errcode = '42501';
  end if;
  return query
  select n.association_id, a.display_name, n.kind, n.effective_on, n.detail, n.created_at, n.emailed_at,
         (select count(*)::integer from public.billing_notice_deliveries d where d.notice_id = n.id),
         (select count(*)::integer from public.billing_notice_deliveries d where d.notice_id = n.id and d.sent_at is not null)
    from public.billing_notices n
    join public.associations a on a.id = n.association_id
   order by n.created_at desc
   limit 200;
end $$;

revoke all on function public.billing_admin_notices() from public, anon;
grant execute on function public.billing_admin_notices() to authenticated;

-- ----------------------------------------------------------------------------
-- 5. The daily run (service role only)
-- ----------------------------------------------------------------------------

-- Comp end dates become notices: early access (90 days) and the end of a founding year (30 days).
create or replace function public.billing_generate_comp_notices(p_today date)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.billing_notices (association_id, kind, effective_on, dedupe_key)
  select c.association_id,
         case c.kind when 'founding' then 'founding_charge' else 'early_access_end' end,
         c.expires_on,
         'comp:' || c.id || ':' || c.expires_on
    from public.billing_comps c
    join public.associations a on a.id = c.association_id and a.deleted_at is null
   where c.revoked_at is null
     and c.kind in ('early_access', 'founding')
     and c.expires_on is not null
     and c.expires_on >= p_today
  on conflict (dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.billing_generate_comp_notices(date) from public, anon, authenticated;
grant execute on function public.billing_generate_comp_notices(date) to service_role;

-- The facts the app uses to decide whether a building is heading for read-only. Billing facts only.
create or replace function public.billing_notice_candidates()
returns table (
  association_id       uuid,
  trial_ends_at        timestamptz,
  stripe_customer_id   text,
  has_subscription     boolean,
  subscription_status  text,
  plan_key             text,
  billing_interval     text,
  current_period_end   timestamptz,
  cancel_at_period_end boolean,
  payment_failed_at    timestamptz,
  comp_active          boolean,
  comp_kind            text,
  comp_expires_on      date,
  unit_count           integer
)
language sql stable security definer set search_path = ''
as $$
  select b.association_id,
         b.trial_ends_at,
         b.stripe_customer_id,
         b.stripe_subscription_id is not null,
         b.subscription_status,
         b.plan_key,
         b.billing_interval,
         b.current_period_end,
         b.cancel_at_period_end,
         b.payment_failed_at,
         c.id is not null,
         c.kind,
         c.expires_on,
         (select count(*)::integer from public.units u where u.association_id = b.association_id)
    from public.billing_accounts b
    join public.associations a on a.id = b.association_id and a.deleted_at is null
    left join public.billing_comps c
      on c.association_id = b.association_id
     and c.revoked_at is null
     and c.starts_on <= current_date
     and (c.expires_on is null or c.expires_on >= current_date)
$$;

revoke all on function public.billing_notice_candidates() from public, anon, authenticated;
grant execute on function public.billing_notice_candidates() to service_role;

-- Opens the read-only notice for a building. The key names the lapse it is about, so it is made once.
create or replace function public.billing_open_read_only_notice(p_association_id uuid, p_effective_on date, p_key text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_key is null or p_key !~ '^read_only:[0-9a-f-]{36}:[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'bad notice key' using errcode = '22023';
  end if;
  insert into public.billing_notices (association_id, kind, effective_on, dedupe_key)
  select a.id, 'read_only', p_effective_on, p_key
    from public.associations a
   where a.id = p_association_id and a.deleted_at is null
  on conflict (dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;

revoke all on function public.billing_open_read_only_notice(uuid, date, text) from public, anon, authenticated;
grant execute on function public.billing_open_read_only_notice(uuid, date, text) to service_role;

-- Hands the sender the emails still to go: one per active board admin with an address, three tries each,
-- ten minutes apart. A notice with no recipients yet gets its delivery rows made here.
create or replace function public.billing_notice_claim(p_limit integer)
returns table (
  delivery_id      uuid,
  notice_id        uuid,
  kind             text,
  effective_on     date,
  detail           text,
  association_name text,
  to_email         text,
  to_name          text,
  attempts         integer
)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  insert into public.billing_notice_deliveries (notice_id, association_id, person_id, to_email, to_name)
  select distinct on (n.id, lower(btrim(p.email))) n.id, n.association_id, p.id, lower(btrim(p.email)), p.full_name
    from public.billing_notices n
    join public.role_grants g
      on g.association_id = n.association_id and g.role = 'board_admin' and g.revoked_at is null
     and (g.expires_on is null or g.expires_on >= current_date)
    join public.persons p on p.id = g.person_id and p.email is not null and position('@' in p.email) > 1
   where not exists (select 1 from public.billing_notice_deliveries d where d.notice_id = n.id)
     and n.created_at > now() - interval '30 days'
  on conflict (notice_id, to_email) do nothing;

  return query
  with picked as (
    select d.id
      from public.billing_notice_deliveries d
     where d.sent_at is null
       and d.attempts < 3
       and (d.last_attempt_at is null or d.last_attempt_at < now() - interval '10 minutes')
     order by d.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
       for update skip locked
  ),
  upd as (
    update public.billing_notice_deliveries d
       set attempts = d.attempts + 1, last_attempt_at = now()
      from picked
     where d.id = picked.id
    returning d.id, d.notice_id, d.to_email, d.to_name, d.attempts
  )
  select upd.id, n.id, n.kind, n.effective_on, n.detail, a.display_name, upd.to_email, upd.to_name, upd.attempts
    from upd
    join public.billing_notices n on n.id = upd.notice_id
    join public.associations a on a.id = n.association_id;
end $$;

revoke all on function public.billing_notice_claim(integer) from public, anon, authenticated;
grant execute on function public.billing_notice_claim(integer) to service_role;

create or replace function public.billing_notice_mark(p_delivery_id uuid, p_ok boolean, p_error text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_notice uuid;
begin
  if p_ok then
    update public.billing_notice_deliveries
       set sent_at = now(), last_error = null
     where id = p_delivery_id
    returning notice_id into v_notice;
    update public.billing_notices set emailed_at = coalesce(emailed_at, now()) where id = v_notice;
  else
    update public.billing_notice_deliveries
       set last_error = left(coalesce(p_error, 'The email could not be sent.'), 500)
     where id = p_delivery_id;
  end if;
end $$;

revoke all on function public.billing_notice_mark(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.billing_notice_mark(uuid, boolean, text) to service_role;
