-- ============================================================================
-- 0097 Online dues payments: Stripe Connect (Standard), ACH only. DECISIONS #57.
-- Build plan: docs/specs/dues-online-payments.md (Phase 1).
--
-- Money goes from the owner to the association's own Stripe account and then
-- to its bank. Walkup never holds funds and stores no bank or card number:
-- only the connected account id (acct_...), which owners never see.
--
-- Nothing here writes the ledger except post_stripe_payout(), which a person
-- with the books duty runs by clicking "Confirm Stripe payout" against the
-- deposit in the bank feed (#29: nothing reaches the ledger without a click).
-- The webhook only moves statuses.
--
-- Tables
--   association_payment_accounts  the connected Stripe account (history kept)
--   online_dues_payments          one row per Pay press, through to deposit
--   stripe_payouts                Stripe's payouts to the association's bank
--   stripe_connect_events         webhook idempotency (service role only)
--
-- Functions
--   online_dues_status(assoc)                    any member: is Pay available
--   connect_payment_account / disconnect_...     board_admin
--   start_online_dues_payment / attach_... /
--     cancel_online_dues_payment                 the unit's owner
--   post_stripe_payout(bank_txn, payout)         books duty
--   connect_* service functions                  service role (the webhook)
--
-- No function here calls session_is_aal2() directly; the MFA gate comes from
-- has_role_in() / owned_unit_ids() / has_duty(), as in 0062.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

create table if not exists public.association_payment_accounts (
  id                 uuid primary key default gen_random_uuid(),
  association_id     uuid not null references public.associations(id) on delete restrict,
  stripe_account_id  text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]{1,250}$'),
  livemode           boolean not null,
  charges_enabled    boolean not null default false,
  payouts_enabled    boolean not null default false,
  details_submitted  boolean not null default false,
  connected_by       uuid references auth.users(id) on delete set null,
  connected_at       timestamptz not null default now(),
  disconnected_at    timestamptz,
  disconnected_by    uuid references auth.users(id) on delete set null,
  stripe_synced_at   timestamptz,
  updated_at         timestamptz not null default now()
);

-- One live connection per association, and one association per Stripe account.
create unique index if not exists association_payment_accounts_one_active
  on public.association_payment_accounts (association_id) where disconnected_at is null;
create unique index if not exists association_payment_accounts_acct_active
  on public.association_payment_accounts (stripe_account_id) where disconnected_at is null;

alter table public.association_payment_accounts enable row level security;

drop policy if exists association_payment_accounts_select on public.association_payment_accounts;
create policy association_payment_accounts_select on public.association_payment_accounts
  for select to authenticated
  using (public.can_read_financials(association_id));

revoke all on public.association_payment_accounts from anon;
revoke insert, update, delete on public.association_payment_accounts from authenticated;

drop trigger if exists association_payment_accounts_audit on public.association_payment_accounts;
create trigger association_payment_accounts_audit
  after insert or update or delete on public.association_payment_accounts
  for each row execute function public.tg_audit();

create table if not exists public.stripe_payouts (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references public.associations(id) on delete restrict,
  payment_account_id  uuid not null references public.association_payment_accounts(id) on delete restrict,
  stripe_payout_id    text not null unique check (stripe_payout_id ~ '^po_[A-Za-z0-9]{1,250}$'),
  amount              numeric(14,2) not null check (amount > 0),
  arrival_date        date,
  status              text not null check (status in ('pending', 'in_transit', 'paid', 'failed', 'canceled')),
  bank_transaction_id uuid unique references public.bank_transactions(id) on delete restrict,
  journal_entry_id    uuid references public.journal_entries(id) on delete restrict,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.stripe_payouts enable row level security;

drop policy if exists stripe_payouts_select on public.stripe_payouts;
create policy stripe_payouts_select on public.stripe_payouts
  for select to authenticated
  using (public.can_read_financials(association_id));

revoke all on public.stripe_payouts from anon;
revoke insert, update, delete on public.stripe_payouts from authenticated;

create table if not exists public.online_dues_payments (
  id                          uuid primary key default gen_random_uuid(),
  association_id              uuid not null references public.associations(id) on delete restrict,
  unit_id                     uuid not null references public.units(id) on delete restrict,
  person_id                   uuid references public.persons(id) on delete set null,
  payment_account_id          uuid not null references public.association_payment_accounts(id) on delete restrict,
  amount                      numeric(14,2) not null check (amount > 0),
  -- Stripe's fee, known once the payment succeeds. The association pays it (#57).
  fee                         numeric(14,2) check (fee is null or fee >= 0),
  status                      text not null default 'creating' check (status in (
                                'creating',    -- row made, Checkout not created yet
                                'checkout',    -- owner is on Stripe's page
                                'processing',  -- ACH started, not settled
                                'succeeded',   -- settled at Stripe, waiting for the payout
                                'deposited',   -- payout confirmed in the bank feed: in the books
                                'failed',      -- bank refused or returned it: counts as not paid
                                'canceled',    -- owner left Checkout, or it expired
                                'refunded',
                                'disputed')),
  stripe_checkout_session_id  text unique check (stripe_checkout_session_id is null or stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]{1,250}$'),
  stripe_payment_intent_id    text unique check (stripe_payment_intent_id is null or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]{1,250}$'),
  payout_id                   uuid references public.stripe_payouts(id) on delete set null,
  -- The ledger's payment row, once posted. Unposting the deposit deletes it.
  payment_id                  uuid references public.payments(id) on delete set null,
  failure_reason              text check (failure_reason is null or char_length(failure_reason) <= 300),
  livemode                    boolean not null,
  created_by                  uuid references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  succeeded_at                timestamptz,
  failed_at                   timestamptz,
  deposited_at                timestamptz
);

-- One payment in flight per unit, so a double click or a second owner can't pay twice.
create unique index if not exists online_dues_payments_one_open
  on public.online_dues_payments (unit_id) where status in ('creating', 'checkout', 'processing');
create index if not exists online_dues_payments_assoc_idx
  on public.online_dues_payments (association_id, created_at desc);
create index if not exists online_dues_payments_payout_idx
  on public.online_dues_payments (payout_id) where payout_id is not null;

alter table public.online_dues_payments enable row level security;

drop policy if exists online_dues_payments_select on public.online_dues_payments;
create policy online_dues_payments_select on public.online_dues_payments
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or unit_id in (select public.owned_unit_ids(association_id))
  );

revoke all on public.online_dues_payments from anon;
revoke insert, update, delete on public.online_dues_payments from authenticated;

drop trigger if exists online_dues_payments_audit on public.online_dues_payments;
create trigger online_dues_payments_audit
  after insert or update or delete on public.online_dues_payments
  for each row execute function public.tg_audit();

create table if not exists public.stripe_connect_events (
  stripe_event_id text primary key check (stripe_event_id ~ '^evt_[A-Za-z0-9_]{1,250}$'),
  type            text not null check (char_length(type) between 1 and 100),
  stripe_account  text check (stripe_account is null or stripe_account ~ '^acct_[A-Za-z0-9]{1,250}$'),
  -- Filled from the connected account when it is known (as billing_webhook_events, 0062).
  association_id  uuid references public.associations(id) on delete restrict,
  stripe_created  timestamptz not null,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  outcome         text check (outcome is null or outcome in ('applied', 'ignored', 'stale', 'failed'))
);

alter table public.stripe_connect_events enable row level security;
revoke all on public.stripe_connect_events from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Anyone in the building: is online payment available?
-- ----------------------------------------------------------------------------

-- 'off' (never set up or turned off), 'pending' (connected, Stripe still needs
-- details), 'ready'. Says nothing about the account itself.
create or replace function public.online_dues_status(p_association_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when public.current_person_id(p_association_id) is null then null
    when a.id is null then 'off'
    when a.charges_enabled and a.payouts_enabled then 'ready'
    else 'pending'
  end
  from (select 1) one
  left join public.association_payment_accounts a
    on a.association_id = p_association_id and a.disconnected_at is null
$$;

revoke all on function public.online_dues_status(uuid) from public, anon;
grant execute on function public.online_dues_status(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Board admin: connect and disconnect
-- ----------------------------------------------------------------------------

-- Called by the OAuth callback after it has checked the signed state and
-- exchanged the code with Stripe, in the board admin's own session.
create or replace function public.connect_payment_account(
  p_association_id    uuid,
  p_stripe_account_id text,
  p_livemode          boolean
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.has_role_in(p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board administrator can set up online payments'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.association_payment_accounts
     where stripe_account_id = p_stripe_account_id
       and disconnected_at is null
       and association_id <> p_association_id
  ) then
    raise exception 'this Stripe account is already connected to another association';
  end if;

  -- Reconnecting the same account is a no-op; a different one replaces the old.
  select id into v_id
    from public.association_payment_accounts
   where association_id = p_association_id
     and disconnected_at is null
     and stripe_account_id = p_stripe_account_id;
  if v_id is not null then
    return v_id;
  end if;

  update public.association_payment_accounts
     set disconnected_at = now(), disconnected_by = auth.uid(), updated_at = now()
   where association_id = p_association_id and disconnected_at is null;

  insert into public.association_payment_accounts
    (association_id, stripe_account_id, livemode, connected_by)
  values
    (p_association_id, p_stripe_account_id, p_livemode, auth.uid())
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.connect_payment_account(uuid, text, boolean) from public, anon;
grant execute on function public.connect_payment_account(uuid, text, boolean) to authenticated;

-- Hides the Pay button. Payments already started still finish and still show.
-- Returns the Stripe account id so the caller can deauthorize it at Stripe.
create or replace function public.disconnect_payment_account(p_association_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_acct text;
begin
  if not public.has_role_in(p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board administrator can turn off online payments'
      using errcode = '42501';
  end if;

  update public.association_payment_accounts
     set disconnected_at = now(), disconnected_by = auth.uid(), updated_at = now()
   where association_id = p_association_id and disconnected_at is null
  returning stripe_account_id into v_acct;

  return v_acct;
end $$;

revoke all on function public.disconnect_payment_account(uuid) from public, anon;
grant execute on function public.disconnect_payment_account(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. The unit's owner: start a payment
-- ----------------------------------------------------------------------------

-- What the unit owes right now: open charges less any unapplied credit.
create or replace function public.unit_open_balance(p_unit_id uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select greatest(0,
    coalesce((select sum(cb.balance) from public.charge_balances cb
               where cb.unit_id = p_unit_id and cb.status in ('open', 'partial')), 0)
  )::numeric(14,2)
$$;

revoke all on function public.unit_open_balance(uuid) from public, anon, authenticated;

-- What the Pay button says: the unit's full open balance, for its owner only.
create or replace function public.online_dues_amount(p_association_id uuid, p_unit_id uuid)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select case when p_unit_id in (select public.owned_unit_ids(p_association_id))
              then public.unit_open_balance(p_unit_id) end
$$;

revoke all on function public.online_dues_amount(uuid, uuid) from public, anon;
grant execute on function public.online_dues_amount(uuid, uuid) to authenticated;

-- Makes the row before Stripe is called, so a double click can't make two
-- Checkout sessions. The amount is the unit's full open balance, computed
-- here, never sent by the browser (#57: full balance only).
create or replace function public.start_online_dues_payment(
  p_association_id uuid,
  p_unit_id        uuid
) returns table (payment_id uuid, amount numeric, stripe_account_id text, livemode boolean)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_acct    public.association_payment_accounts%rowtype;
  v_amount  numeric(14,2);
  v_id      uuid;
begin
  if p_unit_id not in (select public.owned_unit_ids(p_association_id)) then
    raise exception 'you can only pay dues for a unit you own'
      using errcode = '42501';
  end if;

  select * into v_acct
    from public.association_payment_accounts
   where association_id = p_association_id and disconnected_at is null;
  if not found or not (v_acct.charges_enabled and v_acct.payouts_enabled) then
    raise exception 'online payments aren''t turned on for this association';
  end if;

  -- A Checkout left open past its 30-minute expiry, or a row whose Stripe call
  -- never came back, no longer blocks a new attempt.
  update public.online_dues_payments
     set status = 'canceled', updated_at = now()
   where unit_id = p_unit_id
     and ((status = 'creating' and created_at < now() - interval '10 minutes')
       or (status = 'checkout' and created_at < now() - interval '40 minutes'));

  if exists (select 1 from public.online_dues_payments
              where unit_id = p_unit_id and status in ('creating', 'checkout', 'processing')) then
    raise exception 'a payment for this unit is already in progress';
  end if;

  v_amount := public.unit_open_balance(p_unit_id);
  if v_amount <= 0 then
    raise exception 'nothing is owed on this unit right now';
  end if;

  insert into public.online_dues_payments
    (association_id, unit_id, person_id, payment_account_id, amount, livemode, created_by)
  values
    (p_association_id, p_unit_id, public.current_person_id(p_association_id), v_acct.id,
     v_amount, v_acct.livemode, auth.uid())
  returning id into v_id;

  return query select v_id, v_amount, v_acct.stripe_account_id, v_acct.livemode;
end $$;

revoke all on function public.start_online_dues_payment(uuid, uuid) from public, anon;
grant execute on function public.start_online_dues_payment(uuid, uuid) to authenticated;

create or replace function public.attach_online_dues_checkout(
  p_payment_id          uuid,
  p_checkout_session_id text
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.online_dues_payments
     set stripe_checkout_session_id = p_checkout_session_id,
         status = 'checkout',
         updated_at = now()
   where id = p_payment_id
     and created_by = auth.uid()
     and status = 'creating';
  if not found then
    raise exception 'this payment can''t be continued; start again';
  end if;
end $$;

revoke all on function public.attach_online_dues_checkout(uuid, text) from public, anon;
grant execute on function public.attach_online_dues_checkout(uuid, text) to authenticated;

-- The Stripe call failed, or the owner came back from Checkout without paying
-- (the caller has already expired the session at Stripe): free the unit for another try.
create or replace function public.cancel_online_dues_payment(p_payment_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.online_dues_payments
     set status = 'canceled', updated_at = now()
   where id = p_payment_id
     and created_by = auth.uid()
     and status in ('creating', 'checkout');
end $$;

revoke all on function public.cancel_online_dues_payment(uuid) from public, anon;
grant execute on function public.cancel_online_dues_payment(uuid) to authenticated;

-- The caller's own payments still on Stripe's Checkout page, with what the
-- server needs to ask Stripe how they ended (the return page, and a new Pay
-- press, check before anything else happens). The account id goes to
-- Walkup's server, never onto a page.
create or replace function public.my_open_online_checkouts(p_association_id uuid)
returns table (payment_id uuid, unit_id uuid, checkout_session_id text, stripe_account_id text)
language sql stable security definer set search_path = ''
as $$
  select odp.id, odp.unit_id, odp.stripe_checkout_session_id, a.stripe_account_id
    from public.online_dues_payments odp
    join public.association_payment_accounts a on a.id = odp.payment_account_id
   where odp.association_id = p_association_id
     and odp.status = 'checkout'
     and odp.stripe_checkout_session_id is not null
     and odp.unit_id in (select public.owned_unit_ids(p_association_id))
$$;

revoke all on function public.my_open_online_checkouts(uuid) from public, anon;
grant execute on function public.my_open_online_checkouts(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. The webhook (service role only)
-- ----------------------------------------------------------------------------

create or replace function public.connect_claim_event(
  p_event_id text,
  p_type     text,
  p_account  text,
  p_created  timestamptz
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_rows integer;
begin
  insert into public.stripe_connect_events (stripe_event_id, type, stripe_account, association_id, stripe_created)
  values (p_event_id, p_type, p_account,
          (select a.association_id from public.association_payment_accounts a
            where a.stripe_account_id = p_account order by a.connected_at desc limit 1),
          p_created)
  on conflict (stripe_event_id) do update
     set received_at = now(), outcome = null, processed_at = null
   where public.stripe_connect_events.outcome = 'failed'
      or (public.stripe_connect_events.outcome is null
          and public.stripe_connect_events.received_at < now() - interval '10 minutes');
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

revoke all on function public.connect_claim_event(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.connect_claim_event(text, text, text, timestamptz) to service_role;

create or replace function public.connect_finish_event(p_event_id text, p_outcome text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.stripe_connect_events
     set outcome = p_outcome, processed_at = now()
   where stripe_event_id = p_event_id;
end $$;

revoke all on function public.connect_finish_event(text, text) from public, anon, authenticated;
grant execute on function public.connect_finish_event(text, text) to service_role;

-- account.updated: whether Stripe will take payments and pay out yet.
create or replace function public.connect_apply_account(
  p_stripe_account_id text,
  p_charges_enabled   boolean,
  p_payouts_enabled   boolean,
  p_details_submitted boolean
) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  update public.association_payment_accounts
     set charges_enabled = p_charges_enabled,
         payouts_enabled = p_payouts_enabled,
         details_submitted = p_details_submitted,
         stripe_synced_at = now(),
         updated_at = now()
   where stripe_account_id = p_stripe_account_id and disconnected_at is null;
  return case when found then 'applied' else 'ignored' end;
end $$;

revoke all on function public.connect_apply_account(text, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.connect_apply_account(text, boolean, boolean, boolean) to service_role;

-- account.application.deauthorized: the association disconnected from Stripe's side.
create or replace function public.connect_account_deauthorized(p_stripe_account_id text)
returns text
language plpgsql security definer set search_path = ''
as $$
begin
  update public.association_payment_accounts
     set disconnected_at = now(), updated_at = now()
   where stripe_account_id = p_stripe_account_id and disconnected_at is null;
  return case when found then 'applied' else 'ignored' end;
end $$;

revoke all on function public.connect_account_deauthorized(text) from public, anon, authenticated;
grant execute on function public.connect_account_deauthorized(text) to service_role;

-- Moves a payment's status. The event's Stripe account must be the one the
-- payment was made on, so one association's events can't touch another's rows.
-- Only forward moves are allowed; anything else is 'stale' and changes nothing.
create or replace function public.connect_apply_payment(
  p_stripe_account_id   text,
  p_checkout_session_id text,
  p_payment_intent_id   text,
  p_status              text,
  p_fee                 numeric default null,
  p_failure_reason      text default null,
  -- Walkup's own row id, from the Checkout or payment intent metadata: matches
  -- a payment event that arrives before the payment intent id was recorded.
  p_payment_id          uuid default null
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  p       public.online_dues_payments%rowtype;
  v_ok    boolean;
begin
  select odp.* into p
    from public.online_dues_payments odp
    join public.association_payment_accounts a on a.id = odp.payment_account_id
   where a.stripe_account_id = p_stripe_account_id
     and ((p_checkout_session_id is not null and odp.stripe_checkout_session_id = p_checkout_session_id)
       or (p_payment_intent_id   is not null and odp.stripe_payment_intent_id   = p_payment_intent_id)
       or (p_payment_id          is not null and odp.id                         = p_payment_id))
   for update of odp;
  if not found then
    return 'ignored';
  end if;

  v_ok := case p_status
    when 'processing' then p.status in ('creating', 'checkout')
    when 'succeeded'  then p.status in ('checkout', 'processing')
    when 'failed'     then p.status in ('checkout', 'processing', 'succeeded')
    when 'canceled'   then p.status in ('creating', 'checkout')
    when 'refunded'   then p.status in ('succeeded', 'deposited', 'disputed')
    when 'disputed'   then p.status in ('processing', 'succeeded', 'deposited')
    else false
  end;

  -- The payment intent id can arrive on a later event than the session; keep it either way.
  update public.online_dues_payments
     set stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
         fee = coalesce(p_fee, fee),
         updated_at = now()
   where id = p.id;

  if not v_ok then
    return case when p.status = p_status then 'ignored' else 'stale' end;
  end if;

  update public.online_dues_payments
     set status = p_status,
         failure_reason = case when p_status = 'failed' then left(p_failure_reason, 300) else failure_reason end,
         succeeded_at = case when p_status = 'succeeded' then now() else succeeded_at end,
         failed_at = case when p_status = 'failed' then now() else failed_at end,
         updated_at = now()
   where id = p.id;

  return 'applied';
end $$;

revoke all on function public.connect_apply_payment(text, text, text, text, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.connect_apply_payment(text, text, text, text, numeric, text, uuid) to service_role;

-- payout.created / updated / paid / failed: the payout and which payments are in it.
create or replace function public.connect_apply_payout(
  p_stripe_account_id  text,
  p_payout_id          text,
  p_amount             numeric,
  p_arrival_date       date,
  p_status             text,
  p_payment_intent_ids text[]
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_acct  public.association_payment_accounts%rowtype;
  v_id    uuid;
begin
  select * into v_acct
    from public.association_payment_accounts
   where stripe_account_id = p_stripe_account_id
   order by connected_at desc
   limit 1;
  if not found then
    return 'ignored';
  end if;

  insert into public.stripe_payouts
    (association_id, payment_account_id, stripe_payout_id, amount, arrival_date, status)
  values
    (v_acct.association_id, v_acct.id, p_payout_id, p_amount, p_arrival_date, p_status)
  on conflict (stripe_payout_id) do update
     set amount = excluded.amount,
         arrival_date = excluded.arrival_date,
         -- A payout already posted to the books keeps its status.
         status = case when public.stripe_payouts.journal_entry_id is null then excluded.status
                       else public.stripe_payouts.status end,
         updated_at = now()
  returning id into v_id;

  update public.online_dues_payments odp
     set payout_id = v_id, updated_at = now()
   where odp.payment_account_id in (
           select id from public.association_payment_accounts where stripe_account_id = p_stripe_account_id)
     and odp.stripe_payment_intent_id = any(coalesce(p_payment_intent_ids, '{}'))
     and odp.status in ('succeeded', 'processing');

  return 'applied';
end $$;

revoke all on function public.connect_apply_payout(text, text, numeric, date, text, text[]) from public, anon, authenticated;
grant execute on function public.connect_apply_payout(text, text, numeric, date, text, text[]) to service_role;

-- ----------------------------------------------------------------------------
-- 6. The books: confirm a Stripe payout against its bank deposit
-- ----------------------------------------------------------------------------

-- One balanced entry for the whole deposit:
--   debit  the bank's cash account          net (what arrived)
--   debit  5060 Bank & Merchant Fees        total Stripe fees (#57: the association pays)
--   credit 1200 Assessments Receivable      each payment's full amount, per unit
-- plus a payments row per owner payment, applied to that unit's oldest open
-- charges, so each owner is credited exactly what they paid.
create or replace function public.post_stripe_payout(
  p_bank_transaction_id uuid,
  p_payout_id           uuid
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t           public.bank_transactions%rowtype;
  c           public.bank_connections%rowtype;
  po          public.stripe_payouts%rowtype;
  v_fy        uuid;
  v_ar        uuid;
  v_fee_acct  uuid;
  v_gross     numeric(14,2);
  v_fees      numeric(14,2);
  v_count     integer;
  v_lines     jsonb;
  v_entry     uuid;
  v_pay       record;
  v_payment   uuid;
  v_remaining numeric(14,2);
  v_apply     numeric(14,2);
  v_open      record;
begin
  select * into t from public.bank_transactions where id = p_bank_transaction_id for update;
  if not found then
    raise exception 'bank transaction not found';
  end if;
  if not public.has_duty(t.association_id, 'books') then
    raise exception 'not authorized to post bank transactions for this association'
      using errcode = '42501';
  end if;

  select * into po from public.stripe_payouts where id = p_payout_id for update;
  if not found or po.association_id <> t.association_id then
    raise exception 'Stripe payout not found';
  end if;

  if t.journal_entry_id is not null or po.journal_entry_id is not null then
    raise exception 'this deposit is already in the books';
  end if;
  if t.pending then
    raise exception 'a pending transaction can''t be posted until the bank settles it';
  end if;
  if t.removed_at is not null then
    raise exception 'the bank retracted this transaction, so it can''t be posted';
  end if;
  if po.status <> 'paid' then
    raise exception 'Stripe hasn''t finished paying this out yet';
  end if;
  if t.amount <> po.amount then
    raise exception 'the deposit (%) doesn''t match the Stripe payout (%)', t.amount, po.amount;
  end if;

  select count(*), coalesce(sum(amount), 0), coalesce(sum(fee), 0)
    into v_count, v_gross, v_fees
    from public.online_dues_payments
   where payout_id = po.id and status = 'succeeded';
  if v_count = 0 then
    raise exception 'no settled dues payments are linked to this payout yet';
  end if;
  if exists (select 1 from public.online_dues_payments
              where payout_id = po.id and status = 'succeeded' and fee is null) then
    raise exception 'Stripe hasn''t reported the fee on every payment in this payout yet';
  end if;
  -- v1 posts payouts made only of dues payments. Anything else in the payout
  -- (a refund, a dispute) shows up as a mismatch and is left for a person.
  if v_gross - v_fees <> po.amount then
    raise exception 'the payout (%) isn''t the dues collected (%) less fees (%); post it by hand',
      po.amount, v_gross, v_fees;
  end if;

  select * into c from public.bank_connections where id = t.bank_connection_id;
  if c.cash_account_id is null or c.fund_id is null then
    raise exception 'this bank connection isn''t linked to a ledger cash account yet';
  end if;

  select id into v_ar from public.accounts
   where association_id = t.association_id and code = '1200' and is_active limit 1;
  if v_ar is null then
    raise exception 'no Assessments Receivable (1200) account on file';
  end if;
  select id into v_fee_acct from public.accounts
   where association_id = t.association_id and code = '5060' and is_active limit 1;
  if v_fee_acct is null and v_fees > 0 then
    raise exception 'no Bank & Merchant Fees (5060) account on file';
  end if;

  v_fy := public.ensure_fiscal_year(t.association_id, t.posted_on);

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', c.cash_account_id, 'fund_id', c.fund_id, 'debit', po.amount,
                       'line_memo', 'Stripe payout'));
  if v_fees > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', v_fee_acct, 'fund_id', c.fund_id,
                                             'debit', v_fees, 'line_memo', 'Stripe fees');
  end if;
  v_lines := v_lines || coalesce((
    select jsonb_agg(jsonb_build_object('account_id', v_ar, 'fund_id', c.fund_id,
                                        'unit_id', odp.unit_id, 'credit', odp.amount,
                                        'line_memo', 'Dues paid online'))
      from public.online_dues_payments odp
     where odp.payout_id = po.id and odp.status = 'succeeded'), '[]'::jsonb);

  v_entry := public.post_journal_entry(
    t.association_id, v_fy, t.posted_on,
    format('Stripe payout: %s online dues payment%s', v_count, case when v_count = 1 then '' else 's' end),
    'payment', v_lines, t.id);

  for v_pay in
    select * from public.online_dues_payments
     where payout_id = po.id and status = 'succeeded'
     order by created_at, id
  loop
    insert into public.payments
      (association_id, unit_id, received_on, amount, method, reference, fund_id, journal_entry_id)
    values
      (t.association_id, v_pay.unit_id, t.posted_on, v_pay.amount, 'ach',
       v_pay.stripe_payment_intent_id, c.fund_id, v_entry)
    returning id into v_payment;

    v_remaining := v_pay.amount;
    for v_open in
      select cb.id, cb.balance
        from public.charge_balances cb
       where cb.unit_id = v_pay.unit_id and cb.status in ('open', 'partial')
       order by cb.due_on, cb.id
    loop
      exit when v_remaining <= 0;
      v_apply := least(v_open.balance, v_remaining);
      insert into public.payment_allocations (association_id, payment_id, charge_id, amount)
      values (t.association_id, v_payment, v_open.id, v_apply);
      v_remaining := v_remaining - v_apply;
    end loop;

    update public.online_dues_payments
       set status = 'deposited', deposited_at = now(), payment_id = v_payment, updated_at = now()
     where id = v_pay.id;
  end loop;

  update public.stripe_payouts
     set bank_transaction_id = t.id, journal_entry_id = v_entry, updated_at = now()
   where id = po.id;
  update public.bank_transactions set journal_entry_id = v_entry where id = t.id;

  return v_entry;
end $$;

revoke all on function public.post_stripe_payout(uuid, uuid) from public, anon;
grant execute on function public.post_stripe_payout(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Unposting a Stripe deposit puts its payments back to "settled, not deposited"
-- ----------------------------------------------------------------------------
-- Same body as 0076, plus the two Stripe updates before the payments rows go.

create or replace function public.unpost_bank_transaction(p_transaction_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t     public.bank_transactions%rowtype;
  v_rev uuid;
begin
  select * into t from public.bank_transactions where id = p_transaction_id;
  if not found then
    raise exception 'bank transaction not found';
  end if;
  if not public.has_duty(t.association_id, 'books') then
    raise exception 'not authorized to unpost bank transactions for this association'
      using errcode = '42501';
  end if;
  if t.journal_entry_id is null then
    raise exception 'this transaction isn''t in the books';
  end if;

  v_rev := public.reverse_journal_entry(t.journal_entry_id);

  update public.online_dues_payments
     set status = 'succeeded', deposited_at = null, payment_id = null, updated_at = now()
   where payment_id in (select id from public.payments where journal_entry_id = t.journal_entry_id)
     and status = 'deposited';
  update public.stripe_payouts
     set bank_transaction_id = null, journal_entry_id = null, updated_at = now()
   where journal_entry_id = t.journal_entry_id;

  -- The journal keeps both halves forever; the subsidiary rows are what the
  -- budget, delinquency, and 1099 views read, and those must reflect the
  -- corrected state, not the mistaken one.
  delete from public.payments where journal_entry_id = t.journal_entry_id;
  delete from public.expenses where journal_entry_id = t.journal_entry_id;

  update public.bank_transactions set journal_entry_id = null where id = t.id;
  return v_rev;
end $$;
revoke all on function public.unpost_bank_transaction(uuid) from public, anon;
