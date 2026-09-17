-- ============================================================================
-- Walkup — migration 0034: income statement, at line-item grain
--
-- Every existing income/expense view (trial_balance, tax_receipts_by_account,
-- monthly_expense_actuals) is either fiscal-year-scoped or expense-only —
-- none supports an arbitrary monthly/quarterly/annual P&L. This adds one
-- view at the finest useful grain (one row per posted journal line against
-- an income or expense account, signed to its natural positive direction),
-- so the Financial Statements page can group it into whatever period it
-- needs without a new view per grain.
--
-- Deliberately built from journal_lines/accounts — the real, reconciled,
-- double-entry ledger — not from bank_transactions. See DECISIONS #24: the
-- bank feed is informational only, has no link to the chart of accounts,
-- and using it as a ledger source is explicitly flagged there as a separate
-- decision this migration does not make.
--
-- security_invoker = true: RLS is inherited from journal_lines/journal_entries
-- /accounts (all can_read_financials-gated per 0002), so this view is exactly
-- as restricted as the ledger it reads — board_admin, board_member, and
-- accountant, never a plain owner.
-- ============================================================================

create view public.income_statement_lines
with (security_invoker = true) as
select
  je.association_id,
  je.fiscal_year_id,
  jl.fund_id,
  a.id   as account_id,
  a.code,
  a.name as account_name,
  a.type as account_type,
  je.entry_date,
  (case
     when a.type = 'income'  then jl.credit - jl.debit
     when a.type = 'expense' then jl.debit - jl.credit
   end)::numeric(14,2) as amount
from public.journal_lines jl
join public.journal_entries je on je.id = jl.journal_entry_id
join public.accounts a         on a.id = jl.account_id
where je.is_posted
  and a.type in ('income', 'expense');

grant select on public.income_statement_lines to authenticated;
