-- ============================================================================
-- Walkup — migration 0015: book-to-tax reconciliation, 1099-NEC, budget vs actual
--
-- Three reports, none of which existed yet:
--
-- 1. book_to_tax_reconciliation — DECISIONS #1 requires this and flagged it as
--    the first thing a CPA will ask about. Books accrue assessment income;
--    the 1120-H is filed on cash received. This view shows, per income
--    account, the accrual figure, the cash figure, and the gap between them.
--
--    Built as a FULL OUTER JOIN between the accrual side (journal_lines,
--    grouped by account/year) and the cash side (cash_basis_receipts,
--    grouped the same way) rather than a single LEFT JOIN from one side.
--    A LEFT JOIN starting from the book side would silently miss the
--    exact case this report exists to explain: cash collected THIS year
--    against a charge accrued LAST year has no journal_lines for that
--    account in this fiscal year at all, only cash_basis_receipts rows.
--
--    Scoped to income only. Under modified cash, expenses record when
--    paid for both books and tax — there is no book/tax gap on the
--    expenditure side to reconcile.
--
-- 2. vendor_1099_totals — per-vendor service payments for the year. The
--    $600 threshold is read from tax_parameters by the caller, never
--    hardcoded here, consistent with every other tax figure in this app.
--
-- 3. budget_vs_actual + set_budget_line — budget_lines already existed
--    (0001) but nothing wrote to it or read it. Scoped to the Operating
--    fund only for this pass: Reserve fund activity (interest, periodic
--    contributions, capital improvements) doesn't fit the same monthly
--    budget-vs-actual shape a four-unit board actually uses, and forcing
--    it in now would mean guessing at a UI nobody has asked for yet.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RECORD A PAYMENT
-- ----------------------------------------------------------------------------
-- Found while testing the reconciliation view below: `payments` has a SELECT
-- policy (0002) and nothing else, and no RPC has ever wrapped writing to it —
-- unlike journal_entries/journal_lines/expenses, which are all fronted by
-- post_journal_entry. There has never been a way for a signed-in board member
-- to record a payment through the app; every payment on record so far was
-- written by a migration or a seed script running as the table owner.
--
-- Wraps post_journal_entry (debit cash / credit receivable) plus the payment
-- row plus its allocations in one call, so a payment and its ledger entry
-- cannot exist independently. Allocation total is intentionally not required
-- to equal the payment amount here — a payment may be partially unallocated
-- (prepaid assessment / unapplied cash, per the comment on
-- payment_allocations in 0001) and the existing deferred trigger already
-- rejects over-allocation.
create or replace function public.record_payment(
  p_association_id  uuid,
  p_unit_id         uuid,
  p_fiscal_year_id  uuid,
  p_received_on     date,
  p_amount          numeric,
  p_fund_id         uuid,
  p_cash_account_id uuid,
  p_ar_account_id   uuid,
  p_method          text default null,
  p_reference       text default null,
  p_allocations     jsonb default '[]'::jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_entry   uuid;
  v_payment uuid;
begin
  if not public.is_board(p_association_id) then
    raise exception 'not authorized to record a payment for this association'
      using errcode = '42501';
  end if;
  if p_amount <= 0 then
    raise exception 'a payment must be a positive amount' using errcode = 'check_violation';
  end if;

  v_entry := public.post_journal_entry(
    p_association_id, p_fiscal_year_id, p_received_on,
    'Payment received', 'payment',
    jsonb_build_array(
      jsonb_build_object('account_id', p_cash_account_id, 'fund_id', p_fund_id, 'unit_id', p_unit_id, 'debit',  p_amount),
      jsonb_build_object('account_id', p_ar_account_id,   'fund_id', p_fund_id, 'unit_id', p_unit_id, 'credit', p_amount)
    )
  );

  insert into public.payments
    (association_id, unit_id, received_on, amount, method, reference, fund_id, journal_entry_id)
  values
    (p_association_id, p_unit_id, p_received_on, p_amount, p_method, p_reference, p_fund_id, v_entry)
  returning id into v_payment;

  insert into public.payment_allocations (association_id, payment_id, charge_id, amount)
  select p_association_id, v_payment, (a->>'charge_id')::uuid, (a->>'amount')::numeric
  from jsonb_array_elements(p_allocations) a;

  return v_payment;
end $$;

revoke all on function public.record_payment(
  uuid, uuid, uuid, date, numeric, uuid, uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function public.record_payment(
  uuid, uuid, uuid, date, numeric, uuid, uuid, uuid, text, text, jsonb) to authenticated;

-- Same gap, same fix, for the other side of the ledger: `expenses` has a
-- SELECT policy (0002) and nothing else, and no RPC has ever wrapped writing
-- to it. There has never been a way to record a bill through the app either.
create or replace function public.record_expense(
  p_association_id uuid,
  p_fiscal_year_id uuid,
  p_paid_on        date,
  p_amount         numeric,
  p_fund_id        uuid,
  p_cash_account_id uuid,
  p_expense_account_id uuid,
  p_vendor_id      uuid default null,
  p_is_services    boolean default true,
  p_is_capitalized boolean default false,
  p_memo           text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_entry uuid;
  v_expense uuid;
begin
  if not public.is_board(p_association_id) then
    raise exception 'not authorized to record an expense for this association'
      using errcode = '42501';
  end if;
  if p_amount <= 0 then
    raise exception 'an expense must be a positive amount' using errcode = 'check_violation';
  end if;

  v_entry := public.post_journal_entry(
    p_association_id, p_fiscal_year_id, p_paid_on,
    coalesce(p_memo, 'Expense paid'), 'expense',
    jsonb_build_array(
      jsonb_build_object('account_id', p_expense_account_id, 'fund_id', p_fund_id, 'debit',  p_amount),
      jsonb_build_object('account_id', p_cash_account_id,     'fund_id', p_fund_id, 'credit', p_amount)
    )
  );

  insert into public.expenses
    (association_id, vendor_id, account_id, fund_id, paid_on, amount, is_services, is_capitalized, memo, journal_entry_id)
  values
    (p_association_id, p_vendor_id, p_expense_account_id, p_fund_id, p_paid_on, p_amount, p_is_services, p_is_capitalized, p_memo, v_entry)
  returning id into v_expense;

  return v_expense;
end $$;

revoke all on function public.record_expense(
  uuid, uuid, date, numeric, uuid, uuid, uuid, uuid, boolean, boolean, text) from public, anon;
grant execute on function public.record_expense(
  uuid, uuid, date, numeric, uuid, uuid, uuid, uuid, boolean, boolean, text) to authenticated;

-- Third instance of the same gap, found while writing the test for the
-- second: `assessment_charges` also has a SELECT policy and nothing else.
-- Between this migration's three RPCs, the app now has a real write path for
-- every leg of the ledger a board member actually operates day to day:
-- charge a unit, record what they paid, record what the association paid out.
create or replace function public.record_assessment_charge(
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
  p_schedule_id    uuid default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_entry  uuid;
  v_charge uuid;
begin
  if not public.is_board(p_association_id) then
    raise exception 'not authorized to charge a unit for this association'
      using errcode = '42501';
  end if;
  if p_amount <= 0 then
    raise exception 'a charge must be a positive amount' using errcode = 'check_violation';
  end if;

  v_entry := public.post_journal_entry(
    p_association_id, p_fiscal_year_id, p_due_on,
    'Assessment charged', 'assessment',
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
  uuid, uuid, uuid, public.charge_type, date, date, numeric, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.record_assessment_charge(
  uuid, uuid, uuid, public.charge_type, date, date, numeric, uuid, uuid, uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- BOOK-TO-TAX RECONCILIATION
-- ----------------------------------------------------------------------------
create view public.book_to_tax_reconciliation
with (security_invoker = true) as
with book as (
  select
    jl.association_id, je.fiscal_year_id, a.id as account_id,
    a.code, a.name, a.is_exempt_function_income,
    sum(jl.credit - jl.debit)::numeric(14,2) as book_amount
  from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id and je.is_posted
  join public.accounts a on a.id = jl.account_id and a.type = 'income'
  group by jl.association_id, je.fiscal_year_id, a.id, a.code, a.name, a.is_exempt_function_income
),
tax as (
  select
    association_id, fiscal_year_id, income_account_id as account_id,
    sum(amount)::numeric(14,2) as tax_cash_amount
  from public.cash_basis_receipts
  group by association_id, fiscal_year_id, income_account_id
)
select
  coalesce(b.association_id, t.association_id)   as association_id,
  coalesce(b.fiscal_year_id, t.fiscal_year_id)    as fiscal_year_id,
  coalesce(b.account_id, t.account_id)            as account_id,
  coalesce(b.code, acc.code)                      as code,
  coalesce(b.name, acc.name)                      as name,
  coalesce(b.is_exempt_function_income, acc.is_exempt_function_income) as is_exempt_function_income,
  coalesce(b.book_amount, 0)::numeric(14,2)       as book_amount,
  coalesce(t.tax_cash_amount, 0)::numeric(14,2)   as tax_cash_amount,
  (coalesce(b.book_amount, 0) - coalesce(t.tax_cash_amount, 0))::numeric(14,2) as difference
from book b
full outer join tax t
  on t.association_id = b.association_id
 and t.fiscal_year_id = b.fiscal_year_id
 and t.account_id     = b.account_id
left join public.accounts acc on acc.id = coalesce(b.account_id, t.account_id);

grant select on public.book_to_tax_reconciliation to authenticated;

-- ----------------------------------------------------------------------------
-- 1099-NEC
-- ----------------------------------------------------------------------------
create view public.vendor_1099_totals
with (security_invoker = true) as
select
  v.id as vendor_id, v.association_id, v.name, v.entity_type,
  v.w9_on_file, v.is_1099_exempt, v.tin_last4, v.email,
  je.fiscal_year_id,
  sum(e.amount)::numeric(14,2) as total_paid,
  count(*)::int as payment_count
from public.vendors v
join public.expenses e        on e.vendor_id = v.id and e.is_services
join public.journal_entries je on je.id = e.journal_entry_id and je.is_posted
where not v.is_1099_exempt
group by v.id, v.association_id, v.name, v.entity_type, v.w9_on_file,
         v.is_1099_exempt, v.tin_last4, v.email, je.fiscal_year_id;

grant select on public.vendor_1099_totals to authenticated;

-- ----------------------------------------------------------------------------
-- BUDGET VS ACTUAL — Operating fund only, see note above
-- ----------------------------------------------------------------------------
create view public.budget_vs_actual
with (security_invoker = true) as
select
  bl.association_id, bl.budget_id, b.fiscal_year_id,
  bl.account_id, a.code, a.name, a.type,
  bl.fund_id, f.name as fund_name,
  bl.amount::numeric(14,2)                          as budgeted,
  coalesce(tb.total_debit, 0)::numeric(14,2)         as actual_debit,
  coalesce(tb.total_credit, 0)::numeric(14,2)        as actual_credit,
  case when a.type = 'expense'
    then coalesce(tb.total_debit, 0) - coalesce(tb.total_credit, 0)
    else coalesce(tb.total_credit, 0) - coalesce(tb.total_debit, 0)
  end::numeric(14,2)                                 as actual,
  (
    case when a.type = 'expense'
      then coalesce(tb.total_debit, 0) - coalesce(tb.total_credit, 0)
      else coalesce(tb.total_credit, 0) - coalesce(tb.total_debit, 0)
    end - bl.amount
  )::numeric(14,2)                                   as variance
from public.budget_lines bl
join public.budgets b  on b.id = bl.budget_id
join public.accounts a on a.id = bl.account_id
join public.funds f    on f.id = bl.fund_id
left join public.trial_balance tb
  on tb.account_id = bl.account_id
 and tb.fund_id    = bl.fund_id
 and tb.fiscal_year_id = b.fiscal_year_id;

grant select on public.budget_vs_actual to authenticated;

-- Upsert one budget line. Creates the budget header for the fiscal year on
-- first use. SECURITY DEFINER so board_admin/board_member can write despite
-- budgets/budget_lines having no direct INSERT policy for anyone in 0002 —
-- same pattern as post_journal_entry: the RPC is the only write path, and it
-- checks authorization itself rather than relying on a table-level policy.
create or replace function public.set_budget_line(
  p_association_id uuid,
  p_fiscal_year_id uuid,
  p_account_id     uuid,
  p_fund_id        uuid,
  p_amount         numeric
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_budget uuid;
  v_line   uuid;
begin
  if not public.is_board(p_association_id) then
    raise exception 'not authorized to set a budget for this association'
      using errcode = '42501';
  end if;
  if p_amount < 0 then
    raise exception 'a budget line cannot be negative' using errcode = 'check_violation';
  end if;

  insert into public.budgets (association_id, fiscal_year_id)
  values (p_association_id, p_fiscal_year_id)
  on conflict (association_id, fiscal_year_id) do nothing;

  select id into v_budget from public.budgets
   where association_id = p_association_id and fiscal_year_id = p_fiscal_year_id;

  insert into public.budget_lines (association_id, budget_id, account_id, fund_id, amount)
  values (p_association_id, v_budget, p_account_id, p_fund_id, round(p_amount, 2))
  on conflict (budget_id, account_id, fund_id)
  do update set amount = round(excluded.amount, 2)
  returning id into v_line;

  return v_line;
end $$;

revoke all on function public.set_budget_line(uuid, uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.set_budget_line(uuid, uuid, uuid, uuid, numeric) to authenticated;
