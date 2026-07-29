-- ============================================================================
-- Walkup — migration 0008: reporting views
--
-- PostgREST cannot express GROUP BY, so every aggregate the UI needs lives
-- here. That is a better place for it than the client anyway: the definition
-- is versioned, reviewable, and identical for every caller.
--
-- Every view is security_invoker, so the 0002 policies apply to the caller.
-- An aggregate therefore sums only the rows that caller may see.
--
-- Which creates a trap worth naming: SUM over zero visible rows returns 0, and
-- a confident $0.00 next to a neighbour who is $1,000 behind is worse than
-- showing nothing (DECISIONS #17). Every view that could be RLS-filtered
-- therefore also exposes a COUNT, so the UI can tell "nothing owed" apart from
-- "not yours to see".
-- ============================================================================

-- Per-unit balance. visible_charges is the honesty column described above.
create view public.unit_balances
with (security_invoker = true) as
select
  u.id                                        as unit_id,
  u.association_id,
  u.label,
  u.sort_order,
  count(cb.id)::int                           as visible_charges,
  coalesce(sum(cb.balance) filter (
    where cb.status not in ('paid','waived','written_off')), 0) as balance_owed
from public.units u
left join public.charge_balances cb on cb.unit_id = u.id
group by u.id, u.association_id, u.label, u.sort_order;

-- Cash on hand per fund. Reads only accounts flagged is_cash_account, so it is
-- the same basis the 1120-H tests use.
create view public.fund_cash_balances
with (security_invoker = true) as
select
  f.id                as fund_id,
  f.association_id,
  f.name,
  f.kind,
  f.is_restricted,
  count(l.id)::int    as visible_lines,
  coalesce(sum(l.debit - l.credit), 0) as cash_balance
from public.funds f
left join public.journal_lines l  on l.fund_id = f.id
left join public.journal_entries e on e.id = l.journal_entry_id and e.is_posted
left join public.accounts a        on a.id = l.account_id and a.is_cash_account
group by f.id, f.association_id, f.name, f.kind, f.is_restricted;

-- Aging buckets. Derived from charge_balances, never from a cached status.
create view public.delinquency_aging
with (security_invoker = true) as
select
  u.id      as unit_id,
  u.association_id,
  u.label,
  coalesce(sum(cb.balance) filter (where cb.days_overdue = 0), 0)              as current_due,
  coalesce(sum(cb.balance) filter (where cb.days_overdue between 1 and 30), 0) as days_1_30,
  coalesce(sum(cb.balance) filter (where cb.days_overdue between 31 and 60), 0) as days_31_60,
  coalesce(sum(cb.balance) filter (where cb.days_overdue > 60), 0)             as days_60_plus,
  coalesce(sum(cb.balance), 0)                                                 as total_owed
from public.units u
join public.charge_balances cb on cb.unit_id = u.id
where cb.status not in ('paid','waived','written_off')
group by u.id, u.association_id, u.label;

-- Trial balance with the fund name resolved, so the ledger page is one read.
create view public.trial_balance_by_fund
with (security_invoker = true) as
select
  tb.association_id,
  tb.fiscal_year_id,
  tb.fund_id,
  f.name as fund_name,
  tb.account_id,
  tb.code,
  tb.name,
  tb.type,
  tb.total_debit,
  tb.total_credit,
  tb.net_debit
from public.trial_balance tb
join public.funds f on f.id = tb.fund_id;

-- Association-level totals, so the overview does not need four round trips.
create view public.association_totals
with (security_invoker = true) as
select
  a.id as association_id,
  (select count(*) from public.trial_balance tb
    where tb.association_id = a.id)                       as visible_tb_rows,
  (select coalesce(sum(tb.total_debit), 0) from public.trial_balance tb
    where tb.association_id = a.id)                       as total_debits,
  (select coalesce(sum(tb.total_credit), 0) from public.trial_balance tb
    where tb.association_id = a.id)                       as total_credits,
  (select coalesce(sum(cb.balance), 0) from public.charge_balances cb
    where cb.association_id = a.id
      and cb.status not in ('paid','waived','written_off')) as total_owed,
  (select count(distinct cb.unit_id) from public.charge_balances cb
    where cb.association_id = a.id
      and cb.status not in ('paid','waived','written_off')) as units_behind
from public.associations a;

-- The two tax breakdowns, pre-grouped.
create view public.tax_receipts_by_account
with (security_invoker = true) as
select
  association_id,
  fiscal_year_id,
  income_account_name as account_name,
  is_exempt,
  sum(amount) as total
from public.cash_basis_receipts
group by association_id, fiscal_year_id, income_account_name, is_exempt;

create view public.tax_disbursements_by_account
with (security_invoker = true) as
select
  association_id,
  fiscal_year_id,
  account_name,
  account_type,
  is_exempt,
  sum(amount) as total
from public.cash_basis_disbursements
group by association_id, fiscal_year_id, account_name, account_type, is_exempt;

grant select on
  public.unit_balances,
  public.fund_cash_balances,
  public.delinquency_aging,
  public.trial_balance_by_fund,
  public.association_totals,
  public.tax_receipts_by_account,
  public.tax_disbursements_by_account
to authenticated;
