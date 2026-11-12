-- Credit card payments.
--
-- A payment to the association's credit card used to have nowhere to go: a transfer
-- needed a cash account on the other side, so the only choices were its own bank
-- accounts. This adds a liability account, 2200 Credit Card Payable, and lets a
-- transfer that is money going out land there: debit the payable, credit cash.
--
-- 1. Existing associations get the account (if the code is free).
-- 2. New associations get it from the default chart.
-- 3. post_bank_transaction (as of 0076) learns the card-payment case.

insert into public.accounts (association_id, code, name, type, is_cash_account)
select a.id, '2200', 'Credit Card Payable', 'liability', false
  from public.associations a
 where not exists (
   select 1 from public.accounts x where x.association_id = a.id and x.code = '2200');

create or replace function public.seed_chart_of_accounts(p_association_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_role_in(
       p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not authorized to seed accounts for this association'
      using errcode = '42501';
  end if;

  insert into public.accounts
    (association_id, code, name, type, is_cash_account,
     is_exempt_function_income, is_exempt_expenditure)
  values
    -- Assets. Only the two bank accounts are cash.
    (p_association_id, '1000', 'Operating Cash',            'asset',  true,  null, false),
    (p_association_id, '1010', 'Reserve Cash',              'asset',  true,  null, false),
    (p_association_id, '1200', 'Assessments Receivable',    'asset',  false, null, false),
    (p_association_id, '1250', 'Late Fees Receivable',      'asset',  false, null, false),
    -- Capitalized improvements are an asset, but the outlay still counts
    -- toward the 90% numerator. Hence is_exempt_expenditure on an asset.
    (p_association_id, '1500', 'Building Improvements',     'asset',  false, null, true),

    (p_association_id, '2000', 'Accounts Payable',          'liability', false, null, null),
    (p_association_id, '2100', 'Prepaid Assessments',       'liability', false, null, null),
    -- Where a credit-card payment goes: the card's balance goes down, and the purchases
    -- on it are not an expense a second time. Offered by the bank feed's card-payment choices.
    (p_association_id, '2200', 'Credit Card Payable',       'liability', false, null, null),

    (p_association_id, '3000', 'Operating Fund Balance',    'equity', false, null, null),
    (p_association_id, '3100', 'Reserve Fund Balance',      'equity', false, null, null),

    -- Exempt function income.
    (p_association_id, '4000', 'Regular Assessments',       'income', false, true,  null),
    (p_association_id, '4010', 'Special Assessments',       'income', false, true,  null),
    (p_association_id, '4020', 'Late Fees',                 'income', false, true,  null),
    -- Non-exempt. Reserve interest is the common one, and it is why an
    -- association with healthy reserves can still fail the 60% test.
    (p_association_id, '4100', 'Interest Income',           'income', false, false, null),
    (p_association_id, '4110', 'Laundry Income',            'income', false, false, null),
    (p_association_id, '4120', 'Common Area Rental',        'income', false, false, null),
    (p_association_id, '4130', 'Vending Income',            'income', false, false, null),

    -- Exempt expenditures: care of association property.
    (p_association_id, '5000', 'Insurance',                 'expense', false, null, true),
    (p_association_id, '5010', 'Utilities',                 'expense', false, null, true),
    (p_association_id, '5020', 'Repairs & Maintenance',     'expense', false, null, true),
    (p_association_id, '5030', 'Landscaping / Snow Removal','expense', false, null, true),
    (p_association_id, '5040', 'Janitorial',                'expense', false, null, true),
    (p_association_id, '5050', 'Professional Fees',         'expense', false, null, true),
    (p_association_id, '5060', 'Bank & Merchant Fees',      'expense', false, null, true),
    (p_association_id, '5070', 'State Filing Fees',         'expense', false, null, true),
    -- Below the capitalization threshold. Above it, use 1500.
    (p_association_id, '5080', 'Minor Capital Repairs',     'expense', false, null, true),

    -- Non-exempt expenditures. Income tax paid on reserve interest lands
    -- here and mildly depresses the 90% ratio — see DECISIONS #13.
    (p_association_id, '5900', 'Income Tax Expense',        'expense', false, null, false),
    -- Writing off an uncollectible assessment is contra-income, not an
    -- expense (DECISIONS #14), so this account exists only for the book
    -- entry and is excluded from the 90% numerator.
    (p_association_id, '4090', 'Assessments Written Off',   'income', false, true,  null);
end $$;

create or replace function public.post_bank_transaction(p_transaction_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t             public.bank_transactions%rowtype;
  c             public.bank_connections%rowtype;
  v_target      public.accounts%rowtype;
  v_fy          uuid;
  v_amount      numeric(14,2);
  v_entry       uuid;
  v_sub_id      uuid;
  v_ar          uuid;
  v_income      uuid;
  v_target_fund uuid;
  v_allocs      jsonb := '[]'::jsonb;
  v_remaining   numeric(14,2);
  v_apply       numeric(14,2);
  v_open        record;
begin
  select * into t from public.bank_transactions where id = p_transaction_id;
  if not found then
    raise exception 'bank transaction not found';
  end if;

  if not public.has_duty(t.association_id, 'books') then
    raise exception 'not authorized to post bank transactions for this association'
      using errcode = '42501';
  end if;

  if t.journal_entry_id is not null then
    raise exception 'this transaction is already in the books';
  end if;
  if t.pending then
    raise exception 'a pending transaction can''t be posted until the bank settles it';
  end if;
  if t.removed_at is not null then
    raise exception 'the bank retracted this transaction, so it can''t be posted';
  end if;
  if t.posting_kind is null then
    raise exception 'categorize this transaction before posting it';
  end if;

  if t.posting_kind = 'excluded' then
    update public.bank_transactions
       set excluded_at = coalesce(excluded_at, now())
     where id = t.id;
    return null;
  end if;

  select * into c from public.bank_connections where id = t.bank_connection_id;
  if c.cash_account_id is null or c.fund_id is null then
    raise exception 'this bank connection isn''t linked to a ledger cash account yet';
  end if;

  v_fy := public.ensure_fiscal_year(t.association_id, t.posted_on);
  v_amount := abs(t.amount);
  if v_amount = 0 then
    raise exception 'a zero-amount transaction has nothing to post';
  end if;

  if t.posting_kind = 'expense' then
    if t.amount >= 0 then
      raise exception 'money coming in can''t be posted as an expense';
    end if;
    select * into v_target from public.accounts where id = t.account_id;
    if v_target.type <> 'expense' then
      raise exception 'an expense posting needs an expense account';
    end if;
    v_sub_id := public.record_expense(
      t.association_id, v_fy, t.posted_on, v_amount, c.fund_id,
      c.cash_account_id, t.account_id, t.vendor_id, true, false, t.description);
    select journal_entry_id into v_entry from public.expenses where id = v_sub_id;

  elsif t.posting_kind = 'income' then
    if t.amount <= 0 then
      raise exception 'money going out can''t be posted as income';
    end if;
    select * into v_target from public.accounts where id = t.account_id;
    if v_target.type <> 'income' then
      raise exception 'an income posting needs an income account';
    end if;
    v_entry := public.post_journal_entry(
      t.association_id, v_fy, t.posted_on, t.description, 'import',
      jsonb_build_array(
        jsonb_build_object('account_id', c.cash_account_id, 'fund_id', c.fund_id, 'debit',  v_amount),
        jsonb_build_object('account_id', t.account_id,      'fund_id', c.fund_id, 'credit', v_amount)),
      t.id);

  elsif t.posting_kind = 'dues' then
    if t.amount <= 0 then
      raise exception 'money going out can''t be posted as dues';
    end if;

    v_remaining := v_amount;
    for v_open in
      select cb.id, cb.balance
        from public.charge_balances cb
       where cb.unit_id = t.matched_unit_id
         and cb.status in ('open', 'partial')
       order by cb.due_on, cb.id
    loop
      exit when v_remaining <= 0;
      v_apply := least(v_open.balance, v_remaining);
      v_allocs := v_allocs || jsonb_build_object('charge_id', v_open.id, 'amount', v_apply);
      v_remaining := v_remaining - v_apply;
    end loop;

    if jsonb_array_length(v_allocs) > 0 then
      select id into v_ar from public.accounts
       where association_id = t.association_id and code = '1200' and is_active
       limit 1;
      if v_ar is null then
        raise exception 'no Assessments Receivable (1200) account on file';
      end if;
      v_sub_id := public.record_payment(
        t.association_id, t.matched_unit_id, v_fy, t.posted_on, v_amount, c.fund_id,
        c.cash_account_id, v_ar, 'ach', t.plaid_transaction_id, v_allocs);
      select journal_entry_id into v_entry from public.payments where id = v_sub_id;
    else
      select id into v_income from public.accounts
       where association_id = t.association_id and code = '4000' and is_active
       limit 1;
      if v_income is null then
        raise exception 'no Regular Assessments (4000) account on file';
      end if;
      v_entry := public.post_journal_entry(
        t.association_id, v_fy, t.posted_on, t.description, 'import',
        jsonb_build_array(
          jsonb_build_object('account_id', c.cash_account_id, 'fund_id', c.fund_id,
                             'unit_id', t.matched_unit_id, 'debit',  v_amount),
          jsonb_build_object('account_id', v_income,          'fund_id', c.fund_id,
                             'unit_id', t.matched_unit_id, 'credit', v_amount)),
        t.id);
    end if;

  elsif t.posting_kind = 'transfer' then
    select * into v_target from public.accounts where id = t.account_id;

    -- A credit card payment: money out, on the way to the card. The card's payable
    -- account goes down (debit) and cash goes down (credit); it is not an expense.
    if v_target.type = 'liability' and v_target.code = '2200' then
      if t.amount >= 0 then
        raise exception 'a credit card payment has to be money going out';
      end if;
      v_entry := public.post_journal_entry(
        t.association_id, v_fy, t.posted_on, t.description, 'transfer',
        jsonb_build_array(
          jsonb_build_object('account_id', v_target.id,       'fund_id', c.fund_id, 'debit',  v_amount),
          jsonb_build_object('account_id', c.cash_account_id, 'fund_id', c.fund_id, 'credit', v_amount)),
        t.id);
      update public.bank_transactions set journal_entry_id = v_entry where id = t.id;
      return v_entry;
    end if;

    if not v_target.is_cash_account then
      raise exception 'a transfer needs a cash account on the other side';
    end if;
    if v_target.id = c.cash_account_id then
      raise exception 'a transfer can''t go to the same account it came from';
    end if;

    -- The other side's fund: the fund of whichever connection that cash
    -- account is linked to, else Reserve for an account named as such,
    -- else Operating.
    select fund_id into v_target_fund
      from public.bank_connections
     where cash_account_id = v_target.id and fund_id is not null
     order by created_at desc
     limit 1;
    if v_target_fund is null then
      select id into v_target_fund
        from public.funds
       where association_id = t.association_id
         and kind = (case when v_target.name ilike '%reserve%' then 'reserve' else 'operating' end)::public.fund_type
       limit 1;
    end if;
    if v_target_fund is null then
      raise exception 'no fund found for the other side of this transfer';
    end if;

    if t.amount < 0 then
      v_entry := public.post_journal_entry(
        t.association_id, v_fy, t.posted_on, t.description, 'transfer',
        jsonb_build_array(
          jsonb_build_object('account_id', v_target.id,       'fund_id', v_target_fund, 'debit',  v_amount),
          jsonb_build_object('account_id', c.cash_account_id, 'fund_id', c.fund_id,     'credit', v_amount)),
        t.id);
    else
      v_entry := public.post_journal_entry(
        t.association_id, v_fy, t.posted_on, t.description, 'transfer',
        jsonb_build_array(
          jsonb_build_object('account_id', c.cash_account_id, 'fund_id', c.fund_id,     'debit',  v_amount),
          jsonb_build_object('account_id', v_target.id,       'fund_id', v_target_fund, 'credit', v_amount)),
        t.id);
    end if;
  end if;

  update public.bank_transactions set journal_entry_id = v_entry where id = t.id;
  return v_entry;
end $$;

revoke all on function public.post_bank_transaction(uuid) from public, anon;
