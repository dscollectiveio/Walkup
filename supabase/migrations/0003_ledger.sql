-- ============================================================================
-- Walkup — migration 0003: the ledger
--
-- This is the migration the product stands on. Everything else is reporting.
--
-- Four invariants, all enforced in the database:
--   1. A journal entry balances, or the transaction does not commit.
--   2. A posted entry is immutable. Corrections are reversing entries.
--   3. A closed fiscal year takes no writes at all.
--   4. Ownership percentages sum to exactly 100% within an amendment.
-- ============================================================================

-- ============================================================================
-- BALANCE
-- ============================================================================
-- Deferred to commit, because the lines do not exist yet when the entry is
-- inserted. That deferral is exactly why ledger writes cannot go through
-- PostgREST directly: each REST request is its own transaction, so an entry
-- inserted by one request would reach commit with no lines and be rejected.
-- post_journal_entry() below does the whole thing in one call.

create or replace function public.check_entry_balanced(p_entry uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_lines  integer;
  v_debit  numeric(14,2);
  v_credit numeric(14,2);
begin
  -- The entry itself was deleted in this transaction. Nothing to balance.
  if not exists (select 1 from public.journal_entries where id = p_entry) then
    return;
  end if;

  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_lines, v_debit, v_credit
    from public.journal_lines
   where journal_entry_id = p_entry;

  if v_lines < 2 then
    raise exception
      'journal entry % has % line(s); double-entry requires at least two',
      p_entry, v_lines
      using errcode = 'check_violation';
  end if;

  if v_debit <> v_credit then
    raise exception
      'journal entry % is unbalanced: debits %, credits %, difference %',
      p_entry, v_debit, v_credit, v_debit - v_credit
      using errcode = 'check_violation';
  end if;
end $$;

create or replace function public.tg_lines_balanced()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform public.check_entry_balanced(
    coalesce(new.journal_entry_id, old.journal_entry_id));
  return null;
end $$;

create or replace function public.tg_entry_balanced()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform public.check_entry_balanced(coalesce(new.id, old.id));
  return null;
end $$;

create constraint trigger journal_lines_balanced
  after insert or update or delete on public.journal_lines
  deferrable initially deferred
  for each row execute function public.tg_lines_balanced();

create constraint trigger journal_entries_balanced
  after insert or update on public.journal_entries
  deferrable initially deferred
  for each row execute function public.tg_entry_balanced();

-- ============================================================================
-- IMMUTABILITY
-- ============================================================================
-- Stricter than the original spec, which only froze closed periods. A posted
-- entry is frozen the moment it is posted — there is no legitimate reason to
-- edit one in a four-unit building, and "immutable at close" leaves months in
-- which the audit log is the only evidence anything changed. (DECISIONS #9)

create or replace function public.tg_entry_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.is_posted then
    raise exception
      'journal entry % is posted and cannot be %; post a reversing entry instead',
      old.id, lower(tg_op)
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger journal_entries_immutable
  before update or delete on public.journal_entries
  for each row execute function public.tg_entry_immutable();

create or replace function public.tg_line_immutable()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_entry uuid := coalesce(new.journal_entry_id, old.journal_entry_id);
begin
  if exists (select 1 from public.journal_entries
              where id = v_entry and is_posted) then
    raise exception
      'journal entry % is posted; its lines cannot be %',
      v_entry, lower(tg_op)
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger journal_lines_immutable
  before insert or update or delete on public.journal_lines
  for each row execute function public.tg_line_immutable();

-- ============================================================================
-- CLOSED PERIODS
-- ============================================================================

create or replace function public.tg_period_open()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_fy     uuid := coalesce(new.fiscal_year_id, old.fiscal_year_id);
  v_status public.period_status;
begin
  select status into v_status from public.fiscal_years where id = v_fy;
  if v_status = 'closed' then
    raise exception
      'fiscal year % is closed; corrections go in the open year as reversing entries',
      v_fy
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger journal_entries_period_open
  before insert or update or delete on public.journal_entries
  for each row execute function public.tg_period_open();

-- Reopening a closed year is not a thing. Closing is one-way.
create or replace function public.tg_fiscal_year_close_is_final()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'closed' and new.status <> 'closed' then
    raise exception 'fiscal year % is closed; it cannot be reopened', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger fiscal_years_close_is_final
  before update on public.fiscal_years
  for each row execute function public.tg_fiscal_year_close_is_final();

-- ============================================================================
-- OWNERSHIP SUMS TO 100
-- ============================================================================

create or replace function public.tg_ownership_sums_to_100()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_amendment uuid := coalesce(new.amendment_id, old.amendment_id);
  v_total numeric(12,6);
begin
  if not exists (select 1 from public.ownership_amendments where id = v_amendment) then
    return null;
  end if;

  select coalesce(sum(percentage), 0) into v_total
    from public.ownership_amendment_lines where amendment_id = v_amendment;

  if v_total <> 100 then
    raise exception
      'ownership amendment % allocates %%%, not 100%%', v_amendment, v_total
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

create constraint trigger ownership_amendment_lines_sum_100
  after insert or update or delete on public.ownership_amendment_lines
  deferrable initially deferred
  for each row execute function public.tg_ownership_sums_to_100();

-- ============================================================================
-- PAYMENTS MAY NOT BE OVER-ALLOCATED
-- ============================================================================

create or replace function public.tg_allocation_within_payment()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_payment uuid := coalesce(new.payment_id, old.payment_id);
  v_allocated numeric(14,2);
  v_amount numeric(14,2);
begin
  select amount into v_amount from public.payments where id = v_payment;
  if v_amount is null then return null; end if;

  select coalesce(sum(amount), 0) into v_allocated
    from public.payment_allocations where payment_id = v_payment;

  if v_allocated > v_amount then
    raise exception
      'payment % allocates % against a payment of %',
      v_payment, v_allocated, v_amount
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

create constraint trigger payment_allocations_within_payment
  after insert or update or delete on public.payment_allocations
  deferrable initially deferred
  for each row execute function public.tg_allocation_within_payment();

-- ============================================================================
-- THE ONLY WRITE PATH INTO THE LEDGER
-- ============================================================================
-- SECURITY DEFINER, so it is not subject to the RLS policies in 0002 — which
-- deliberately grant no INSERT on journal_entries or journal_lines to anyone.
-- Authorization is therefore checked here, explicitly, once.

create or replace function public.post_journal_entry(
  p_association_id     uuid,
  p_fiscal_year_id     uuid,
  p_entry_date         date,
  p_memo               text,
  p_source             text,
  p_lines              jsonb,
  p_source_id          uuid default null,
  p_source_document_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_entry uuid;
begin
  if not public.is_board(p_association_id) then
    raise exception 'not authorized to post entries for this association'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'a journal entry needs at least two lines'
      using errcode = 'check_violation';
  end if;

  -- Unposted first, so the line-immutability trigger permits the inserts.
  insert into public.journal_entries (
    association_id, fiscal_year_id, entry_date, memo, source,
    source_id, source_document_id, is_posted, created_by
  ) values (
    p_association_id, p_fiscal_year_id, p_entry_date, p_memo, p_source,
    p_source_id, p_source_document_id, false, auth.uid()
  ) returning id into v_entry;

  insert into public.journal_lines (
    association_id, journal_entry_id, account_id, fund_id, unit_id,
    debit, credit, line_memo
  )
  select
    p_association_id,
    v_entry,
    (l->>'account_id')::uuid,
    (l->>'fund_id')::uuid,
    nullif(l->>'unit_id', '')::uuid,
    round(coalesce((l->>'debit')::numeric, 0), 2),
    round(coalesce((l->>'credit')::numeric, 0), 2),
    l->>'line_memo'
  from jsonb_array_elements(p_lines) l;

  update public.journal_entries
     set is_posted = true, posted_at = now(), posted_by = auth.uid()
   where id = v_entry;

  -- Balance is verified by the deferred trigger at COMMIT, not here. A caller
  -- that swallows the commit error will believe this succeeded.
  return v_entry;
end $$;

revoke all on function public.post_journal_entry(
  uuid, uuid, date, text, text, jsonb, uuid, uuid) from public, anon;
grant execute on function public.post_journal_entry(
  uuid, uuid, date, text, text, jsonb, uuid, uuid) to authenticated;

-- ============================================================================
-- VIEWS
-- ============================================================================
-- security_invoker = true is mandatory. Without it a view runs with its
-- OWNER's privileges and silently bypasses every policy in 0002 — an owner
-- querying charge_balances would see the whole building.

create view public.charge_balances
with (security_invoker = true) as
select
  c.id,
  c.association_id,
  c.unit_id,
  c.charge_type,
  c.period_start,
  c.due_on,
  c.amount,
  coalesce(a.allocated, 0)                      as amount_applied,
  c.amount - coalesce(a.allocated, 0)           as balance,
  case
    when c.written_off_at is not null                 then 'written_off'
    when c.waived_at is not null                      then 'waived'
    when coalesce(a.allocated, 0) >= c.amount         then 'paid'
    when coalesce(a.allocated, 0) > 0                 then 'partial'
    else 'open'
  end::public.charge_status                     as status,
  greatest(0, current_date - c.due_on)          as days_overdue
from public.assessment_charges c
left join lateral (
  select sum(pa.amount) as allocated
    from public.payment_allocations pa
   where pa.charge_id = c.id
) a on true;

create view public.payment_unapplied
with (security_invoker = true) as
select
  p.id,
  p.association_id,
  p.unit_id,
  p.received_on,
  p.amount,
  coalesce(a.allocated, 0)            as amount_allocated,
  p.amount - coalesce(a.allocated, 0) as amount_unapplied
from public.payments p
left join lateral (
  select sum(pa.amount) as allocated
    from public.payment_allocations pa
   where pa.payment_id = p.id
) a on true;

create view public.trial_balance
with (security_invoker = true) as
select
  l.association_id,
  e.fiscal_year_id,
  l.fund_id,
  l.account_id,
  acc.code,
  acc.name,
  acc.type,
  sum(l.debit)                as total_debit,
  sum(l.credit)               as total_credit,
  sum(l.debit) - sum(l.credit) as net_debit
from public.journal_lines l
join public.journal_entries e on e.id = l.journal_entry_id
join public.accounts acc      on acc.id = l.account_id
where e.is_posted
group by l.association_id, e.fiscal_year_id, l.fund_id, l.account_id,
         acc.code, acc.name, acc.type;

grant select on public.charge_balances, public.payment_unapplied,
                public.trial_balance to authenticated;
