-- ============================================================================
-- Walkup — migration 0062: subscription billing (Walkup's own fee)
--
-- WHY. Each association can pay Walkup a subscription, and a platform admin
-- can give any association complimentary access. Built from
-- docs/specs/subscriptions-plan.md Part 2. Walkup's fee is Walkup's own
-- revenue; it never touches the association's money (DECISIONS #22, #24).
-- Nothing here reads or writes the ledger, the bank feed or dues, and no
-- amount is stored: prices live in Stripe and in src/lib/site-config.ts.
--
-- WHAT.
--   billing_accounts        one row per association: Walkup-side trial end,
--                           Stripe customer and subscription references and
--                           the subscription's status. Board can read its own
--                           row; nobody writes it except the functions below.
--                           No card data, ever (hosted Checkout and Portal).
--   billing_comps           complimentary access history. RLS on, no policies.
--                           The reason is the platform admin's own note, so
--                           this table is NOT on tg_audit() (board admins can
--                           read the audit log). Rows are never deleted.
--   billing_webhook_events  Stripe event ids already handled (idempotency).
--                           Global (an event can arrive before we know its
--                           association). RLS on, no policies. No payload.
--
--   Functions (all SECURITY DEFINER, search_path pinned, revoked from public
--   and anon, granted explicitly):
--     billing_status(assoc)                  board of that association
--     billing_admin_overview()               platform admin
--     billing_grant_comp / billing_revoke_comp / billing_extend_trial
--                                            platform admin
--     billing_apply_subscription(...)        service role, or platform admin
--                                            ("Refresh from Stripe")
--     billing_link_checkout / billing_record_payment /
--     billing_claim_event / billing_finish_event
--                                            service role only
--
--   The access rules (comped / trialing / active / past_due / grace /
--   read_only) are computed in one place, src/lib/billing/entitlement-rules.ts,
--   from the facts billing_status() returns. Enforcement is app-level and off
--   by default (BILLING_ENABLED, BILLING_ENFORCE).
--
-- BACKFILL. Every association that exists when this runs gets a
-- billing_accounts row with no trial and an "early_access" comp with no end
-- date, so nothing changes for anyone. The insert trigger that gives new
-- associations a trial is created after the backfill. Re-running the
-- backfill statements is harmless (on conflict / not exists guards).
--
-- No function here calls session_is_aal2() directly; the MFA gate comes from
-- is_board() / is_platform_admin(), which already carry it where 0025 and
-- 0048 were applied, so this migration applies on the dev project as is.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

create table if not exists public.billing_accounts (
  association_id         uuid primary key references public.associations(id) on delete restrict,
  trial_ends_at          timestamptz,
  stripe_customer_id     text unique check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,250}$'),
  stripe_subscription_id text unique check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]{1,250}$'),
  subscription_status    text check (subscription_status is null or subscription_status in
                           ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused')),
  plan_key               text check (plan_key is null or plan_key in ('starter', 'building', 'association')),
  stripe_price_id        text check (stripe_price_id is null or char_length(stripe_price_id) between 1 and 255),
  billing_interval       text check (billing_interval is null or billing_interval in ('month', 'year')),
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  payment_failed_at      timestamptz,
  terms_accepted_at      timestamptz,
  stripe_synced_at       timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.billing_accounts enable row level security;

drop policy if exists billing_accounts_select on public.billing_accounts;
create policy billing_accounts_select on public.billing_accounts
  for select to authenticated
  using (public.is_board(association_id));

revoke insert, update, delete on public.billing_accounts from anon, authenticated;
revoke all on public.billing_accounts from anon;

drop trigger if exists billing_accounts_audit on public.billing_accounts;
create trigger billing_accounts_audit
  after insert or update or delete on public.billing_accounts
  for each row execute function public.tg_audit();

create table if not exists public.billing_comps (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  kind           text not null check (kind in ('early_access', 'friend', 'pilot', 'nonprofit', 'other')),
  reason         text not null check (char_length(btrim(reason)) between 1 and 300),
  starts_on      date not null default current_date,
  expires_on     date,
  granted_by     uuid references auth.users(id) on delete set null,
  granted_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_by     uuid references auth.users(id) on delete set null,
  check (expires_on is null or expires_on >= starts_on)
);

-- At most one active comp per association.
create unique index if not exists billing_comps_one_active
  on public.billing_comps (association_id) where revoked_at is null;

alter table public.billing_comps enable row level security;
revoke all on public.billing_comps from anon, authenticated;

create table if not exists public.billing_webhook_events (
  stripe_event_id text primary key check (stripe_event_id ~ '^evt_[A-Za-z0-9_]{1,250}$'),
  type            text not null check (char_length(type) between 1 and 100),
  stripe_created  timestamptz not null,
  association_id  uuid references public.associations(id) on delete restrict,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  outcome         text check (outcome is null or outcome in ('applied', 'ignored', 'stale', 'failed'))
);

alter table public.billing_webhook_events enable row level security;
revoke all on public.billing_webhook_events from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Backfill: every existing association is comped ("Early access")
-- ----------------------------------------------------------------------------

insert into public.billing_accounts (association_id)
select a.id from public.associations a
on conflict (association_id) do nothing;

insert into public.billing_comps (association_id, kind, reason)
select a.id, 'early_access', 'Joined during early access; comped automatically at billing launch'
  from public.associations a
 where a.deleted_at is null
   and not exists (select 1 from public.billing_comps c where c.association_id = a.id);

-- ----------------------------------------------------------------------------
-- 3. New associations get a Walkup-side trial (no card, no Stripe customer)
-- ----------------------------------------------------------------------------
-- A trigger rather than an edit to create_association_and_owner so every
-- creation path is covered. Trial length: 30 days. Changing it is a new
-- migration (and src/lib/billing/config.ts TRIAL_DAYS for the copy).

create or replace function public.billing_on_association_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.billing_accounts (association_id, trial_ends_at)
  values (new.id, now() + interval '30 days')
  on conflict (association_id) do nothing;
  return new;
end $$;

revoke all on function public.billing_on_association_insert() from public, anon, authenticated;

drop trigger if exists billing_on_association_insert on public.associations;
create trigger billing_on_association_insert
  after insert on public.associations
  for each row execute function public.billing_on_association_insert();

-- ----------------------------------------------------------------------------
-- 4. Reads
-- ----------------------------------------------------------------------------

-- The billing page's facts, for the board of that association (board admin
-- and board member). Owners, accountants and outsiders get no row. The comp's
-- reason (the platform admin's note) is never returned, only its kind and end.
create or replace function public.billing_status(p_association_id uuid)
returns table (
  association_id         uuid,
  trial_ends_at          timestamptz,
  stripe_customer_id     text,
  has_subscription       boolean,
  subscription_status    text,
  plan_key               text,
  billing_interval       text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean,
  payment_failed_at      timestamptz,
  comp_active            boolean,
  comp_kind              text,
  comp_expires_on        date,
  unit_count             integer
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
    left join public.billing_comps c
      on c.association_id = b.association_id
     and c.revoked_at is null
     and c.starts_on <= current_date
     and (c.expires_on is null or c.expires_on >= current_date)
   where b.association_id = p_association_id
     and public.is_board(p_association_id)
$$;

revoke all on function public.billing_status(uuid) from public, anon;
grant execute on function public.billing_status(uuid) to authenticated;

-- Every association's billing facts, for the platform admin page. Billing
-- facts only: no financial data, no people.
create or replace function public.billing_admin_overview()
returns table (
  association_id         uuid,
  display_name           text,
  state_code             text,
  deleted                boolean,
  unit_count             integer,
  trial_ends_at          timestamptz,
  stripe_customer_id     text,
  stripe_subscription_id text,
  subscription_status    text,
  plan_key               text,
  billing_interval       text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean,
  payment_failed_at      timestamptz,
  stripe_synced_at       timestamptz,
  comp_active            boolean,
  comp_kind              text,
  comp_reason            text,
  comp_expires_on        date,
  comp_granted_at        timestamptz,
  past_comps             integer
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can see billing for every association.' using errcode = '42501';
  end if;
  return query
  select a.id,
         a.display_name,
         a.state_code,
         a.deleted_at is not null,
         (select count(*)::integer from public.units u where u.association_id = a.id),
         b.trial_ends_at,
         b.stripe_customer_id,
         b.stripe_subscription_id,
         b.subscription_status,
         b.plan_key,
         b.billing_interval,
         b.current_period_end,
         coalesce(b.cancel_at_period_end, false),
         b.payment_failed_at,
         b.stripe_synced_at,
         c.id is not null and c.starts_on <= current_date and (c.expires_on is null or c.expires_on >= current_date),
         c.kind,
         c.reason,
         c.expires_on,
         c.granted_at,
         (select count(*)::integer from public.billing_comps p where p.association_id = a.id and p.revoked_at is not null)
    from public.associations a
    left join public.billing_accounts b on b.association_id = a.id
    left join public.billing_comps c on c.association_id = a.id and c.revoked_at is null
   order by a.deleted_at is not null, a.display_name;
end $$;

revoke all on function public.billing_admin_overview() from public, anon;
grant execute on function public.billing_admin_overview() to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Platform admin: comps and trials
-- ----------------------------------------------------------------------------

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

create or replace function public.billing_revoke_comp(p_association_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_rows integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can end complimentary access.' using errcode = '42501';
  end if;
  update public.billing_comps
     set revoked_at = now(), revoked_by = auth.uid()
   where association_id = p_association_id and revoked_at is null;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

revoke all on function public.billing_revoke_comp(uuid) from public, anon;
grant execute on function public.billing_revoke_comp(uuid) to authenticated;

create or replace function public.billing_extend_trial(p_association_id uuid, p_new_end date)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_end timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can change a trial.' using errcode = '42501';
  end if;
  if p_new_end is null or p_new_end <= current_date or p_new_end > current_date + 366 then
    raise exception 'Pick a date after today and within a year.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.associations a where a.id = p_association_id) then
    raise exception 'No such association.' using errcode = 'P0002';
  end if;
  -- End of that day in Chicago, where every Walkup building is today.
  v_end := ((p_new_end + 1)::timestamp at time zone 'America/Chicago') - interval '1 second';
  insert into public.billing_accounts (association_id, trial_ends_at) values (p_association_id, v_end)
  on conflict (association_id) do update set trial_ends_at = excluded.trial_ends_at, updated_at = now();
  return v_end;
end $$;

revoke all on function public.billing_extend_trial(uuid, date) from public, anon;
grant execute on function public.billing_extend_trial(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Stripe webhook writes (service role; apply also platform admin)
-- ----------------------------------------------------------------------------

-- Records the customer and subscription from a verified checkout.session.completed.
-- The association comes from client_reference_id on a Checkout Session our
-- server created with the secret key, which is why no signed-in user can
-- ever call this (spec 2.5, "Why the customer ID is written only by the
-- webhook"). Refuses a customer already linked to a different association.
create or replace function public.billing_link_checkout(
  p_association_id    uuid,
  p_customer_id       text,
  p_subscription_id   text,
  p_terms_accepted_at timestamptz,
  p_event_created     timestamptz
) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.associations a where a.id = p_association_id) then
    return 'unknown';
  end if;
  if exists (select 1 from public.billing_accounts b
              where b.stripe_customer_id = p_customer_id and b.association_id <> p_association_id) then
    raise exception 'That Stripe customer belongs to another association.' using errcode = '23505';
  end if;
  if p_subscription_id is not null and exists (select 1 from public.billing_accounts b
              where b.stripe_subscription_id = p_subscription_id and b.association_id <> p_association_id) then
    raise exception 'That Stripe subscription belongs to another association.' using errcode = '23505';
  end if;

  insert into public.billing_accounts (association_id) values (p_association_id)
  on conflict (association_id) do nothing;

  update public.billing_accounts
     set stripe_customer_id     = p_customer_id,
         stripe_subscription_id = coalesce(p_subscription_id, stripe_subscription_id),
         terms_accepted_at      = coalesce(p_terms_accepted_at, terms_accepted_at),
         updated_at             = now()
   where association_id = p_association_id;
  return 'applied';
end $$;

revoke all on function public.billing_link_checkout(uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_link_checkout(uuid, text, text, timestamptz, timestamptz) to service_role;

-- Applies a subscription as fetched fresh from Stripe. Matched by
-- subscription id; if no row has it yet (customer.subscription.created can
-- arrive before checkout.session.completed), by the association id our
-- server put in the subscription's metadata, but only onto a row that has no
-- other subscription or customer. Older events than the last applied one are
-- ignored ('stale'), so delivery order does not matter.
create or replace function public.billing_apply_subscription(
  p_subscription_id      text,
  p_customer_id          text,
  p_association_id       uuid,
  p_status               text,
  p_plan_key             text,
  p_price_id             text,
  p_interval             text,
  p_current_period_end   timestamptz,
  p_cancel_at_period_end boolean,
  p_event_created        timestamptz
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_assoc uuid;
  v_synced timestamptz;
begin
  if not (coalesce(auth.jwt() ->> 'role', '') = 'service_role' or public.is_platform_admin()) then
    raise exception 'Only the billing webhook or a platform admin can apply a subscription.' using errcode = '42501';
  end if;

  select b.association_id, b.stripe_synced_at into v_assoc, v_synced
    from public.billing_accounts b where b.stripe_subscription_id = p_subscription_id
    for update;

  if v_assoc is null and p_association_id is not null then
    select b.association_id, b.stripe_synced_at into v_assoc, v_synced
      from public.billing_accounts b
     where b.association_id = p_association_id
       and (b.stripe_subscription_id is null or b.stripe_subscription_id = p_subscription_id)
       and (b.stripe_customer_id is null or b.stripe_customer_id = p_customer_id)
       for update;
    if v_assoc is not null and p_customer_id is not null and exists (
      select 1 from public.billing_accounts o where o.stripe_customer_id = p_customer_id and o.association_id <> v_assoc) then
      raise exception 'That Stripe customer belongs to another association.' using errcode = '23505';
    end if;
  end if;

  if v_assoc is null then
    return 'unknown';
  end if;
  if v_synced is not null and p_event_created < v_synced then
    return 'stale';
  end if;

  update public.billing_accounts
     set stripe_subscription_id = p_subscription_id,
         stripe_customer_id     = coalesce(stripe_customer_id, p_customer_id),
         subscription_status    = p_status,
         plan_key               = p_plan_key,
         stripe_price_id        = p_price_id,
         billing_interval       = p_interval,
         current_period_end     = p_current_period_end,
         cancel_at_period_end   = coalesce(p_cancel_at_period_end, false),
         payment_failed_at      = case when p_status in ('active', 'trialing') then null else payment_failed_at end,
         stripe_synced_at       = p_event_created,
         updated_at             = now()
   where association_id = v_assoc;
  return 'applied';
end $$;

revoke all on function public.billing_apply_subscription(text, text, uuid, text, text, text, text, timestamptz, boolean, timestamptz) from public, anon;
grant execute on function public.billing_apply_subscription(text, text, uuid, text, text, text, text, timestamptz, boolean, timestamptz) to authenticated, service_role;

-- invoice.paid clears the failure; invoice.payment_failed sets it once (the
-- grace period counts from the first failure in a run). A paid invoice older
-- than the recorded failure does not clear it.
create or replace function public.billing_record_payment(
  p_customer_id   text,
  p_paid          boolean,
  p_event_created timestamptz
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_paid then
    update public.billing_accounts
       set payment_failed_at = null, updated_at = now()
     where stripe_customer_id = p_customer_id
       and payment_failed_at is not null
       and payment_failed_at <= p_event_created;
  else
    update public.billing_accounts
       set payment_failed_at = p_event_created, updated_at = now()
     where stripe_customer_id = p_customer_id
       and payment_failed_at is null;
  end if;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then return 'applied'; end if;
  if exists (select 1 from public.billing_accounts where stripe_customer_id = p_customer_id) then return 'ignored'; end if;
  return 'unknown';
end $$;

revoke all on function public.billing_record_payment(text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_record_payment(text, boolean, timestamptz) to service_role;

-- Claims a Stripe event id. False means it was already handled (or is being
-- handled right now). A failed event, or one claimed more than ten minutes
-- ago and never finished, can be claimed again, so Stripe's retry is not lost.
create or replace function public.billing_claim_event(
  p_event_id text,
  p_type     text,
  p_created  timestamptz
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_rows integer;
begin
  insert into public.billing_webhook_events (stripe_event_id, type, stripe_created)
  values (p_event_id, p_type, p_created)
  on conflict (stripe_event_id) do update
     set received_at = now(), outcome = null, processed_at = null
   where public.billing_webhook_events.outcome = 'failed'
      or (public.billing_webhook_events.outcome is null
          and public.billing_webhook_events.received_at < now() - interval '10 minutes');
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

revoke all on function public.billing_claim_event(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_claim_event(text, text, timestamptz) to service_role;

create or replace function public.billing_finish_event(
  p_event_id       text,
  p_outcome        text,
  p_association_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.billing_webhook_events
     set outcome = p_outcome,
         processed_at = now(),
         association_id = coalesce(
           (select a.id from public.associations a where a.id = p_association_id),
           association_id)
   where stripe_event_id = p_event_id;
end $$;

revoke all on function public.billing_finish_event(text, text, uuid) from public, anon, authenticated;
grant execute on function public.billing_finish_event(text, text, uuid) to service_role;
