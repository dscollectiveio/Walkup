-- ============================================================================
-- Walkup — migration 0028: monthly expense actuals for budget tracking
--
-- monthly_spending_by_account (0017) already groups expenses by month and
-- account, but only exposes account_name as text — not enough to join
-- against budget_lines, which is keyed by account_id + fund_id. This adds
-- the same shape with real ids, so the /budget page can compare this
-- month's actual spend against a run-rate target (annual budget / 12)
-- per account.
-- ============================================================================

create view public.monthly_expense_actuals
with (security_invoker = true) as
select
  e.association_id,
  date_trunc('month', e.paid_on)::date           as month,
  e.account_id,
  e.fund_id,
  a.code,
  a.name                                         as account_name,
  coalesce(sum(e.amount), 0)::numeric(14,2)::text as total
from public.expenses e
join public.accounts a on a.id = e.account_id
group by e.association_id, date_trunc('month', e.paid_on), e.account_id, e.fund_id, a.code, a.name;

grant select on public.monthly_expense_actuals to authenticated;
