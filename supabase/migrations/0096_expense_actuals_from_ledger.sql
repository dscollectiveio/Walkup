-- One source for "spent": the posted ledger.
--
-- monthly_expense_actuals used to sum the expenses table, while the budget table's
-- "Spent" column read the trial balance and the Financial Statements read posted
-- journal lines. A hand-entered journal entry to an expense account showed in two
-- of those and not the third. This rebuilds the view on income_statement_lines
-- (posted journal lines, signed to the natural direction), so the Budget page, the
-- Home dashboard and the Financial Statements all agree. Same columns, same types.
--
-- security_invoker: RLS is inherited from the ledger (board and accountant only).

create or replace view public.monthly_expense_actuals
with (security_invoker = true) as
select
  l.association_id,
  date_trunc('month', l.entry_date)::date            as month,
  l.account_id,
  l.fund_id,
  l.code,
  l.account_name,
  coalesce(sum(l.amount), 0)::numeric(14,2)::text    as total
from public.income_statement_lines l
where l.account_type = 'expense'
group by l.association_id, date_trunc('month', l.entry_date), l.account_id, l.fund_id, l.code, l.account_name;

grant select on public.monthly_expense_actuals to authenticated;
