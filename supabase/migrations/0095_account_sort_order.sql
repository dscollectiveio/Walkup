-- A fixed reading order for the lines on the financial statements: recurring
-- contracts first, then variable costs, then one-offs. Boards read the budget
-- in the same sequence every month, so rows must not move.
-- Chart-of-accounts codes stay as they are (books, exports and the tax mapping use them).

alter table public.accounts add column if not exists sort_order integer;

create or replace function public.default_account_sort_order(p_name text, p_type text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'income' then case p_name
      when 'Regular Assessments'      then 10
      when 'Special Assessments'      then 15
      when 'Late Fees'                then 20
      when 'Laundry Income'           then 30
      when 'Common Area Rental'       then 40
      when 'Vending Income'           then 50
      when 'Interest Income'          then 60
      when 'Assessments Written Off'  then 90
      else 100 end
    when 'expense' then case p_name
      when 'Insurance'                  then 10
      when 'Utilities'                  then 20
      when 'Professional Fees'          then 30
      when 'State Filing Fees'          then 35
      when 'Landscaping / Snow Removal' then 40
      when 'Janitorial'                 then 50
      when 'Repairs & Maintenance'      then 60
      when 'Minor Capital Repairs'      then 70
      when 'Bank & Merchant Fees'       then 80
      when 'Income Tax Expense'         then 90
      else 100 end
    else null
  end
$$;

update public.accounts
   set sort_order = public.default_account_sort_order(name, type::text)
 where sort_order is null and type in ('income', 'expense');

-- New accounts (the seed function, "add a category") get a position too.
create or replace function public.accounts_set_sort_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sort_order is null and new.type in ('income', 'expense') then
    new.sort_order := public.default_account_sort_order(new.name, new.type::text);
  end if;
  return new;
end $$;

drop trigger if exists accounts_sort_order on public.accounts;
create trigger accounts_sort_order
  before insert on public.accounts
  for each row execute function public.accounts_set_sort_order();

-- Internal helpers: nobody signed out (or signed in) calls these directly.
revoke all on function public.default_account_sort_order(text, text) from public, anon;
revoke all on function public.accounts_set_sort_order() from public, anon;
