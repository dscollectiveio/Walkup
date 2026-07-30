-- ============================================================================
-- Walkup — migration 0010: give every money column in a view a fixed scale
--
-- `coalesce(sum(x), 0)` yields unscaled numeric when no rows match, so the same
-- column returned "1000.00" with data and "0" without it. Harmless to
-- JavaScript's Number(), but a money column whose scale depends on whether
-- rows matched is the kind of inconsistency that eventually gets formatted
-- straight into a report.
--
-- Base tables already enforce NUMERIC(14,2) and the migration suite asserts it.
-- Views were not covered. Now they are.
--
-- DROP then CREATE, not CREATE OR REPLACE: replacing a view cannot change a
-- column's data type, and numeric -> numeric(14,2) counts as a change. The
-- local PGlite suite caught that before this reached the real project.
-- ============================================================================

drop view if exists public.fund_cash_balances;
drop view if exists public.unit_balances;
drop view if exists public.delinquency_aging;
drop view if exists public.association_totals;
drop view if exists public.tax_receipts_by_account;
drop view if exists public.tax_disbursements_by_account;

create view public.fund_cash_balances
with (security_invoker = true) as
select
  f.id as fund_id, f.association_id, f.name, f.kind, f.is_restricted,
  count(cl.line_id)::int                                as visible_lines,
  coalesce(sum(cl.debit - cl.credit), 0)::numeric(14,2) as cash_balance
from public.funds f
left join (
  select l.id as line_id, l.fund_id, l.debit, l.credit
  from public.journal_lines l
  join public.journal_entries e on e.id = l.journal_entry_id
  join public.accounts a        on a.id = l.account_id
  where e.is_posted and a.is_cash_account
) cl on cl.fund_id = f.id
group by f.id, f.association_id, f.name, f.kind, f.is_restricted;

create view public.unit_balances
with (security_invoker = true) as
select
  u.id as unit_id, u.association_id, u.label, u.sort_order,
  count(cb.id)::int as visible_charges,
  coalesce(sum(cb.balance) filter (
    where cb.status not in ('paid','waived','written_off')), 0)::numeric(14,2) as balance_owed
from public.units u
left join public.charge_balances cb on cb.unit_id = u.id
group by u.id, u.association_id, u.label, u.sort_order;

create view public.delinquency_aging
with (security_invoker = true) as
select
  u.id as unit_id, u.association_id, u.label,
  coalesce(sum(cb.balance) filter (where cb.days_overdue = 0), 0)::numeric(14,2)               as current_due,
  coalesce(sum(cb.balance) filter (where cb.days_overdue between 1 and 30), 0)::numeric(14,2)  as days_1_30,
  coalesce(sum(cb.balance) filter (where cb.days_overdue between 31 and 60), 0)::numeric(14,2) as days_31_60,
  coalesce(sum(cb.balance) filter (where cb.days_overdue > 60), 0)::numeric(14,2)              as days_60_plus,
  coalesce(sum(cb.balance), 0)::numeric(14,2)                                                  as total_owed
from public.units u
join public.charge_balances cb on cb.unit_id = u.id
where cb.status not in ('paid','waived','written_off')
group by u.id, u.association_id, u.label;

create view public.association_totals
with (security_invoker = true) as
select
  a.id as association_id,
  (select count(*) from public.trial_balance tb
    where tb.association_id = a.id)                              as visible_tb_rows,
  (select coalesce(sum(tb.total_debit), 0)::numeric(14,2) from public.trial_balance tb
    where tb.association_id = a.id)                              as total_debits,
  (select coalesce(sum(tb.total_credit), 0)::numeric(14,2) from public.trial_balance tb
    where tb.association_id = a.id)                              as total_credits,
  (select coalesce(sum(cb.balance), 0)::numeric(14,2) from public.charge_balances cb
    where cb.association_id = a.id
      and cb.status not in ('paid','waived','written_off'))      as total_owed,
  (select count(distinct cb.unit_id) from public.charge_balances cb
    where cb.association_id = a.id
      and cb.status not in ('paid','waived','written_off'))      as units_behind
from public.associations a;

create view public.tax_receipts_by_account
with (security_invoker = true) as
select association_id, fiscal_year_id, income_account_name as account_name,
       is_exempt, sum(amount)::numeric(14,2) as total
from public.cash_basis_receipts
group by association_id, fiscal_year_id, income_account_name, is_exempt;

create view public.tax_disbursements_by_account
with (security_invoker = true) as
select association_id, fiscal_year_id, account_name, account_type,
       is_exempt, sum(amount)::numeric(14,2) as total
from public.cash_basis_disbursements
group by association_id, fiscal_year_id, account_name, account_type, is_exempt;

grant select on
  public.fund_cash_balances, public.unit_balances, public.delinquency_aging,
  public.association_totals, public.tax_receipts_by_account,
  public.tax_disbursements_by_account
to authenticated;
