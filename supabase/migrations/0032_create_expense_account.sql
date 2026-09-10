-- ============================================================================
-- Walkup — migration 0032: board-created custom budget categories
--
-- Every expense account today comes from seed_chart_of_accounts (0005) —
-- there was no way for a board to add a category of their own (e.g. "Pool
-- Maintenance", "Snow Removal Contract") without a support request. This adds
-- one RPC a board_admin can call from the budget page.
--
-- Code assignment: the seeded chart uses '5000'-'5080' for operating
-- expenses and reserves '5900' for the (non-exempt) income tax line, so a
-- new category takes the next free code in steps of 10 above the current
-- expense max. Not a general-purpose account-numbering scheme — just enough
-- to keep custom codes out of '5900's neighborhood for the ordinary case.
--
-- is_exempt_expenditure defaults to true (the 1120-H "care of association
-- property" bucket) because every custom category a board is likely to add
-- from this page — a maintenance contract, a service line, a utility split
-- out — belongs there, matching the pattern of every seeded expense account
-- except the one tax-specific line (5900). This is a simplifying assumption,
-- not a tax opinion; a genuinely non-exempt custom expense would need its
-- classification corrected by hand. See DECISIONS.md #1 and the accounts
-- table's own check constraints (0001) for why this can't be left null.
-- ============================================================================

create or replace function public.create_expense_account(
  p_association_id uuid,
  p_name text
)
returns public.accounts
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := trim(p_name);
  v_next_code text;
  v_account public.accounts;
begin
  if not public.has_role_in(
       p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not authorized to add a budget category for this association'
      using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'category name is required';
  end if;

  select to_char(coalesce(max(code::int), 4990) + 10, 'FM0000')
    into v_next_code
  from public.accounts
  where association_id = p_association_id
    and type = 'expense'
    and code ~ '^[0-9]+$'
    and code::int < 5900;

  insert into public.accounts
    (association_id, code, name, type, is_cash_account, is_exempt_expenditure)
  values
    (p_association_id, v_next_code, v_name, 'expense', false, true)
  returning * into v_account;

  return v_account;
end $$;

revoke all on function public.create_expense_account(uuid, text) from public, anon;
grant execute on function public.create_expense_account(uuid, text) to authenticated;
