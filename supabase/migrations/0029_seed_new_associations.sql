-- ============================================================================
-- Walkup — migration 0029: seed a real starting point for self-serve signups
--
-- create_association_and_owner (0027) only ever inserted associations,
-- persons, and role_grants — a brand-new building had zero funds, zero
-- accounts, and zero fiscal years. seed_default_funds/seed_chart_of_accounts
-- already existed (0005), built for the old manual-setup path, but signup
-- never called them. The result: a self-serve building's home page rendered
-- almost entirely empty fallback states, which looked like a permissions bug
-- but was actually missing data.
--
-- Fixed forward, not by editing 0027: create_association_and_owner now also
-- seeds funds and the chart of accounts, and opens a calendar-year fiscal
-- year (matching associations.fiscal_year_end_month's own default of 12).
-- The nested calls to seed_default_funds/seed_chart_of_accounts see the
-- board_admin role_grant this same function just inserted, in the same
-- transaction, so their own is_board() checks pass normally.
-- ============================================================================

create or replace function public.create_association_and_owner(
  p_legal_name   text,
  p_display_name text,
  p_state_code   text,
  p_full_name    text,
  p_email        text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid          uuid := auth.uid();
  v_association  uuid;
  v_year         text := extract(year from now())::text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if exists (select 1 from public.persons where auth_user_id = v_uid) then
    raise exception 'this account already belongs to a building'
      using errcode = '23505';
  end if;

  insert into public.associations (legal_name, display_name, state_code)
  values (p_legal_name, p_display_name, p_state_code)
  returning id into v_association;

  insert into public.persons (association_id, full_name, email, auth_user_id)
  values (v_association, p_full_name, p_email, v_uid);

  insert into public.role_grants (association_id, person_id, role, granted_by)
  select v_association, p.id, 'board_admin', v_uid
    from public.persons p
   where p.association_id = v_association and p.auth_user_id = v_uid;

  perform public.seed_default_funds(v_association);
  perform public.seed_chart_of_accounts(v_association);

  insert into public.fiscal_years (association_id, label, starts_on, ends_on)
  values (
    v_association, v_year,
    make_date(extract(year from now())::int, 1, 1),
    make_date(extract(year from now())::int, 12, 31)
  );

  return v_association;
end $$;

revoke all on function public.create_association_and_owner(text, text, text, text, text) from public, anon;
grant execute on function public.create_association_and_owner(text, text, text, text, text) to authenticated;
