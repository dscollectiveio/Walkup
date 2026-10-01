-- ============================================================================
-- Walkup — migration 0044: the Dues tab
--
-- Two small additions, both inside DECISIONS #22/#24 (no payment initiation,
-- no automatic sending, nothing unattended writes to the ledger):
--
-- 1. A late-fee *rule* on the association: an amount and a grace period.
--    Both blank by default, so nothing is ever proposed until a board admin
--    sets them. Fees are proposed on the Dues page and a person confirms
--    each one, which then goes through record_assessment_charge() with
--    charge_type 'late_fee' — the same balanced entry as any other charge.
--
-- 2. dues_payment_reports: an owner saying "I paid $450 by Zelle on the
--    3rd". This is a *report*, not a payment. It never touches the ledger.
--    The treasurer sees it beside the bank feed, and when the matching
--    deposit lands they confirm it — which categorizes and posts that bank
--    row the ordinary way (0036). The report then records which bank
--    transaction settled it, so the two can be audited against each other.
--    Dismissing a report ("never received it") keeps the row with a note.
-- ============================================================================

alter table public.associations
  add column dues_late_fee_amount     numeric(14,2) check (dues_late_fee_amount is null or dues_late_fee_amount >= 0),
  add column dues_late_fee_grace_days smallint      check (dues_late_fee_grace_days is null or dues_late_fee_grace_days >= 0);

comment on column public.associations.dues_late_fee_amount is
  'Flat late fee the board may add once a charge is past the grace period. Null = no late fees. Proposed on the Dues page; a person confirms each one.';
comment on column public.associations.dues_late_fee_grace_days is
  'Days after the due date before a late fee may be proposed. Null = no late fees.';

create table public.dues_payment_reports (
  id                          uuid primary key default gen_random_uuid(),
  association_id              uuid not null references public.associations(id) on delete restrict,
  unit_id                     uuid not null references public.units(id) on delete restrict,
  reported_by                 uuid not null references auth.users(id),
  amount                      numeric(14,2) not null check (amount > 0),
  paid_on                     date not null,
  method                      text not null check (method in ('zelle', 'check', 'cash', 'bank_transfer', 'other')),
  note                        text,
  status                      text not null default 'pending' check (status in ('pending', 'matched', 'dismissed')),
  -- Set when the treasurer confirms the deposit that this report describes.
  matched_bank_transaction_id uuid references public.bank_transactions(id) on delete restrict,
  resolution_note             text,
  resolved_at                 timestamptz,
  resolved_by                 uuid references auth.users(id),
  created_at                  timestamptz not null default now(),
  check ((status = 'pending') = (resolved_at is null)),
  check (status <> 'matched' or matched_bank_transaction_id is not null)
);

comment on table public.dues_payment_reports is
  'An owner''s own account of a payment made outside Walkup (Zelle, check, cash). Informational: never a ledger write. Settled by the treasurer confirming the real bank deposit.';

create index on public.dues_payment_reports (association_id, status);
create index on public.dues_payment_reports (unit_id);

alter table public.dues_payment_reports enable row level security;

-- Owners see their own units' reports; board and accountant see all.
create policy dues_payment_reports_select on public.dues_payment_reports
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or unit_id in (select public.owned_unit_ids(association_id))
  );

-- An owner reports for a unit they own; a board member may also log one on
-- an owner's behalf ("Bo handed me a check"). Either way the reporter is the
-- signed-in user, and a report always starts pending.
create policy dues_payment_reports_insert on public.dues_payment_reports
  for insert to authenticated
  with check (
    reported_by = auth.uid()
    and status = 'pending'
    and (
      public.is_board(association_id)
      or unit_id in (select public.owned_unit_ids(association_id))
    )
  );

-- Only the board resolves a report, and resolving is the only update.
create policy dues_payment_reports_update on public.dues_payment_reports
  for update to authenticated
  using (public.is_board(association_id))
  with check (public.is_board(association_id) and resolved_by = auth.uid());

-- Same-association guard: the unit (and any matched bank row) must belong
-- to the association on the report. SECURITY DEFINER so it sees both rows
-- regardless of the caller's RLS view (#23); revoked from anon like 0043.
create or replace function public.tg_dues_report_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.units u where u.id = new.unit_id and u.association_id = new.association_id
  ) then
    raise exception 'unit belongs to a different association' using errcode = '42501';
  end if;
  if new.matched_bank_transaction_id is not null and not exists (
    select 1 from public.bank_transactions t
     where t.id = new.matched_bank_transaction_id and t.association_id = new.association_id
  ) then
    raise exception 'bank transaction belongs to a different association' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_dues_report_same_association() from public, anon;
grant execute on function public.tg_dues_report_same_association() to authenticated;

create trigger dues_payment_reports_same_association
  before insert or update on public.dues_payment_reports
  for each row execute function public.tg_dues_report_same_association();

create trigger audit_dues_payment_reports after insert or update or delete on public.dues_payment_reports
  for each row execute function public.tg_audit();

-- ----------------------------------------------------------------------------
-- record_assessment_charge: a memo, so a late fee or a one-off charge reads
-- as what it is on the unit's statement instead of "Assessment charged".
-- Postgres would make a second overload of the 11-argument version, and
-- PostgREST cannot pick between overloads when the extra argument is
-- defaulted — so drop the old signature and recreate with the memo. Same
-- body otherwise; same board check; same balanced entry.
-- ----------------------------------------------------------------------------

drop function public.record_assessment_charge(
  uuid, uuid, uuid, public.charge_type, date, date, numeric, uuid, uuid, uuid, uuid);

create function public.record_assessment_charge(
  p_association_id uuid,
  p_fiscal_year_id uuid,
  p_unit_id        uuid,
  p_charge_type    public.charge_type,
  p_period_start   date,
  p_due_on         date,
  p_amount         numeric,
  p_fund_id        uuid,
  p_ar_account_id     uuid,
  p_income_account_id uuid,
  p_schedule_id    uuid default null,
  p_memo           text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_entry  uuid;
  v_charge uuid;
  v_memo   text;
begin
  if not public.is_board(p_association_id) then
    raise exception 'not authorized to charge a unit for this association'
      using errcode = '42501';
  end if;
  if p_amount <= 0 then
    raise exception 'a charge must be a positive amount' using errcode = 'check_violation';
  end if;

  v_memo := coalesce(nullif(trim(p_memo), ''),
    case p_charge_type
      when 'late_fee' then 'Late fee'
      when 'special_assessment' then 'Special assessment charged'
      when 'other' then 'Charge'
      else 'Assessment charged'
    end);

  v_entry := public.post_journal_entry(
    p_association_id, p_fiscal_year_id, p_due_on,
    v_memo, 'assessment',
    jsonb_build_array(
      jsonb_build_object('account_id', p_ar_account_id,     'fund_id', p_fund_id, 'unit_id', p_unit_id, 'debit',  p_amount),
      jsonb_build_object('account_id', p_income_account_id, 'fund_id', p_fund_id, 'unit_id', p_unit_id, 'credit', p_amount)
    )
  );

  insert into public.assessment_charges
    (association_id, schedule_id, unit_id, charge_type, period_start, due_on, amount, journal_entry_id)
  values
    (p_association_id, p_schedule_id, p_unit_id, p_charge_type, p_period_start, p_due_on, p_amount, v_entry)
  returning id into v_charge;

  return v_charge;
end $$;

revoke all on function public.record_assessment_charge(
  uuid, uuid, uuid, public.charge_type, date, date, numeric, uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.record_assessment_charge(
  uuid, uuid, uuid, public.charge_type, date, date, numeric, uuid, uuid, uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Per-unit dues. In a small building the units rarely pay the same amount
-- or on the same cadence (a garden unit at $300 a month, the top floor at
-- $5,400 a year). A schedule can now belong to one unit: unit_id set,
-- allocation fixed_per_unit, total_amount = what that unit pays per period,
-- annual_amount = what the board typed. Association-wide schedules
-- (unit_id null) keep working exactly as before. Changing a unit's plan
-- only affects charges not yet posted; posted charges are ledger history.
-- ----------------------------------------------------------------------------

alter table public.assessment_schedules
  add column unit_id       uuid references public.units(id) on delete restrict,
  add column annual_amount numeric(14,2) check (annual_amount is null or annual_amount > 0),
  add column note          text,
  add constraint assessment_schedules_unit_fixed
    check (unit_id is null or allocation_method = 'fixed_per_unit');

create index on public.assessment_schedules (unit_id) where unit_id is not null;

comment on column public.assessment_schedules.unit_id is
  'Set when this schedule is one unit''s own dues plan. total_amount is then that unit''s per-period amount.';
comment on column public.assessment_schedules.annual_amount is
  'What the board entered as the unit''s dues for the year; total_amount is derived from it and the frequency.';

create or replace function public.tg_schedule_unit_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.unit_id is not null and not exists (
    select 1 from public.units u where u.id = new.unit_id and u.association_id = new.association_id
  ) then
    raise exception 'unit belongs to a different association' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_schedule_unit_same_association() from public, anon;
grant execute on function public.tg_schedule_unit_same_association() to authenticated;

create trigger assessment_schedules_unit_same_association
  before insert or update on public.assessment_schedules
  for each row execute function public.tg_schedule_unit_same_association();
