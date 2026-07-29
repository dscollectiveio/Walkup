-- ============================================================================
-- Walkup — migration 0006: cash-basis views for the 1120-H
--
-- The return is filed on the cash method; the books accrue assessments
-- (DECISIONS #1). So neither test may read the income statement, and both are
-- computed from movements across accounts flagged is_cash_account
-- (DECISIONS #3).
--
-- The subtlety that makes this more than a sum:
--
-- When an owner pays, the entry is DEBIT cash / CREDIT assessments receivable.
-- The opposite leg is an ASSET, not income — so classifying a receipt purely by
-- "the other side of the entry" would find no income at all and report a 0%
-- exempt ratio. The cash has to be traced through the payment to the charge it
-- settled, and classified by the income account that charge originally
-- credited.
--
-- Receipts of income with no receivable in between (reserve interest, laundry)
-- ARE classified directly by the opposite leg. Hence the two branches below.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- CASH RECEIPTS, classified as exempt function income or not
-- ----------------------------------------------------------------------------
create view public.cash_basis_receipts
with (security_invoker = true) as

-- Branch 1: cash received settling a receivable. Trace payment -> allocation
-- -> charge -> the income account the accrual credited.
select
  p.association_id,
  e.fiscal_year_id,
  p.received_on                      as received_on,
  inc.id                             as income_account_id,
  inc.code                           as income_account_code,
  inc.name                           as income_account_name,
  inc.is_exempt_function_income      as is_exempt,
  pa.amount                          as amount,
  'assessment'::text                 as basis
from public.payments p
join public.payment_allocations pa on pa.payment_id = p.id
join public.assessment_charges c    on c.id = pa.charge_id
join public.journal_entries e       on e.id = p.journal_entry_id
join public.journal_lines cl        on cl.journal_entry_id = c.journal_entry_id
join public.accounts inc            on inc.id = cl.account_id
                                   and inc.type = 'income'
                                   and cl.credit > 0
where e.is_posted

union all

-- Branch 2: cash received directly into an income account, with no receivable
-- in between — reserve interest, laundry, common-area rent.
select
  l_inc.association_id,
  e.fiscal_year_id,
  e.entry_date,
  inc.id,
  inc.code,
  inc.name,
  inc.is_exempt_function_income,
  l_inc.credit,
  'direct'::text
from public.journal_entries e
join public.journal_lines l_cash on l_cash.journal_entry_id = e.id
join public.accounts a_cash      on a_cash.id = l_cash.account_id
                                and a_cash.is_cash_account
                                and l_cash.debit > 0
join public.journal_lines l_inc  on l_inc.journal_entry_id = e.id
join public.accounts inc         on inc.id = l_inc.account_id
                                and inc.type = 'income'
                                and l_inc.credit > 0
where e.is_posted;

-- ----------------------------------------------------------------------------
-- CASH DISBURSEMENTS, classified as exempt expenditure or not
-- ----------------------------------------------------------------------------
-- Credits to a cash account, classified by the debit leg. Capitalized
-- improvements (an ASSET) count in the 90% numerator exactly as an expensed
-- repair does — which is why is_exempt_expenditure is allowed on asset
-- accounts (DECISIONS #2).
--
-- A transfer between operating and reserve is cash-to-cash: both legs are cash
-- accounts, so it produces no non-cash debit leg and correctly contributes
-- nothing to either side of the test.
create view public.cash_basis_disbursements
with (security_invoker = true) as
select
  l_debit.association_id,
  e.fiscal_year_id,
  e.entry_date                 as paid_on,
  acc.id                       as account_id,
  acc.code                     as account_code,
  acc.name                     as account_name,
  acc.type                     as account_type,
  coalesce(acc.is_exempt_expenditure, false) as is_exempt,
  l_debit.debit                as amount
from public.journal_entries e
join public.journal_lines l_cash  on l_cash.journal_entry_id = e.id
join public.accounts a_cash       on a_cash.id = l_cash.account_id
                                 and a_cash.is_cash_account
                                 and l_cash.credit > 0
join public.journal_lines l_debit on l_debit.journal_entry_id = e.id
                                 and l_debit.debit > 0
join public.accounts acc          on acc.id = l_debit.account_id
                                 and not acc.is_cash_account
where e.is_posted
  and acc.type in ('expense', 'asset');

grant select on public.cash_basis_receipts, public.cash_basis_disbursements
  to authenticated;

-- ----------------------------------------------------------------------------
-- WORKSHEET FIGURES
-- ----------------------------------------------------------------------------
-- Returns the raw numbers only. The ratios, the tests and the tax are computed
-- in src/lib/tax/form1120h.ts, as pure functions with their own tests, so the
-- arithmetic is verifiable without a database.

create or replace function public.form_1120h_figures(
  p_association_id uuid,
  p_fiscal_year_id uuid
)
returns table (
  exempt_income         numeric(14,2),
  nonexempt_income      numeric(14,2),
  gross_income          numeric(14,2),
  exempt_expenditures   numeric(14,2),
  total_expenditures    numeric(14,2)
)
language sql stable security invoker set search_path = ''
as $$
  select
    coalesce((select sum(amount) from public.cash_basis_receipts
               where association_id = p_association_id
                 and fiscal_year_id = p_fiscal_year_id
                 and is_exempt), 0)::numeric(14,2),
    coalesce((select sum(amount) from public.cash_basis_receipts
               where association_id = p_association_id
                 and fiscal_year_id = p_fiscal_year_id
                 and not is_exempt), 0)::numeric(14,2),
    coalesce((select sum(amount) from public.cash_basis_receipts
               where association_id = p_association_id
                 and fiscal_year_id = p_fiscal_year_id), 0)::numeric(14,2),
    coalesce((select sum(amount) from public.cash_basis_disbursements
               where association_id = p_association_id
                 and fiscal_year_id = p_fiscal_year_id
                 and is_exempt), 0)::numeric(14,2),
    coalesce((select sum(amount) from public.cash_basis_disbursements
               where association_id = p_association_id
                 and fiscal_year_id = p_fiscal_year_id), 0)::numeric(14,2);
$$;

grant execute on function public.form_1120h_figures(uuid, uuid) to authenticated;
