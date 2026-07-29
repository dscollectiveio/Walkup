-- ============================================================================
-- Walkup — migration 0005: reference data and the default chart of accounts
--
-- WARNING ON THE TAX PARAMETERS BELOW.
--
-- Every row is entered with verified_on = null, deliberately. These figures
-- come from the product spec, which reflects the author's understanding and
-- has never been checked by a CPA against current-year IRS instructions
-- (DECISIONS open question A). Anything reading this table must treat a null
-- verified_on as "show the user that this is unverified", exactly as the
-- state compliance rules will in Slice 4.
--
-- Setting verified_on is a deliberate human act after checking the source. It
-- is not something a migration should do on the author's behalf.
-- ============================================================================

insert into public.tax_parameters
  (key, numeric_value, effective_from, source_url, verified_on, notes)
values
  ('form_1120h_rate_condo', 0.30, '2020-01-01',
   'https://www.irs.gov/forms-pubs/about-form-1120-h', null,
   'IRC 528(b)(1). 30% for condominium management associations. Timeshare associations are 32% — a different rate, not implemented.'),

  ('form_1120h_specific_deduction', 100.00, '2020-01-01',
   'https://www.irs.gov/forms-pubs/about-form-1120-h', null,
   'IRC 528(d)(3). Flat $100 against non-exempt taxable income.'),

  ('form_1120h_income_test', 0.60, '2020-01-01',
   'https://www.irs.gov/forms-pubs/about-form-1120-h', null,
   'IRC 528(c)(1)(B). At least 60% of gross income must be exempt function income. Computed on the CASH basis — see DECISIONS #1 and #3.'),

  ('form_1120h_expenditure_test', 0.90, '2020-01-01',
   'https://www.irs.gov/forms-pubs/about-form-1120-h', null,
   'IRC 528(c)(1)(C). At least 90% of expenditures must be for acquisition, construction, management, maintenance and care of association property. Capital expenditures count. See DECISIONS #2.'),

  ('form_1099_nec_threshold', 600.00, '2020-01-01',
   'https://www.irs.gov/forms-pubs/about-form-1099-nec', null,
   'Per vendor per calendar year, for services.');

-- ============================================================================
-- DEFAULT CHART OF ACCOUNTS
-- ============================================================================
-- Applied per association at setup, and editable afterwards — the 1120-H
-- classification of a given account is a judgment call, not a fact.
--
-- is_cash_account is the flag both tax tests are computed from. Getting it
-- wrong on one account silently changes the 60% and 90% results, so only
-- actual bank accounts carry it.

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

revoke all on function public.seed_chart_of_accounts(uuid) from public, anon;
grant execute on function public.seed_chart_of_accounts(uuid) to authenticated;

create or replace function public.seed_default_funds(p_association_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_role_in(
       p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into public.funds (association_id, name, kind, is_restricted)
  values
    (p_association_id, 'Operating', 'operating', false),
    (p_association_id, 'Reserve',   'reserve',   true);
end $$;

revoke all on function public.seed_default_funds(uuid) from public, anon;
grant execute on function public.seed_default_funds(uuid) to authenticated;
