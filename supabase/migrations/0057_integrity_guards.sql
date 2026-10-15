-- ============================================================================
-- Walkup — migration 0057: grants and ownership must stay inside one association
--
-- WHY. A security review of the live schema (docs/security/ATTACK-REPORT-1.md,
-- findings 4 and 5) found two rows that RLS alone doesn't tie together:
--   * role_grants: a board_admin could insert a grant for THEIR association
--     whose person_id belongs to ANOTHER association (any login whose person id
--     they learn), making that outsider a member of their building.
--   * unit_owners: an insert could pair a unit from one association with a
--     person or association_id from another.
-- RLS checks the row's own association_id for the caller, but nothing checked
-- that the ids it points at live in that same association.
--
-- WHAT. A guard trigger on each table, in the same shape as the other
-- same-association guards (tg_upkeep_same_association, 0045): SECURITY DEFINER
-- so it can read the referenced rows whatever the caller's RLS allows, pinned
-- search_path, raising 42501. Inserts and updates only; existing rows are not
-- rewritten, and an update is checked only when person_id, unit_id or
-- association_id changes, so old bad rows can still be revoked. A notice reports any existing rows that already break the rule,
-- so they can be looked at by hand.
-- ============================================================================

create or replace function public.tg_role_grant_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- On update, only when a pointer changes (REVIEW-1 #5): a row that already
  -- crosses associations (ATTACK-REPORT-1 #4 was exploitable) must still be
  -- revoked or end-dated, and that update touches neither column.
  if tg_op = 'UPDATE'
     and new.person_id = old.person_id and new.association_id = old.association_id then
    return new;
  end if;
  if not exists (
    select 1 from public.persons p
     where p.id = new.person_id and p.association_id = new.association_id
  ) then
    raise exception 'person belongs to a different association' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.tg_unit_owner_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and new.unit_id = old.unit_id and new.person_id = old.person_id
     and new.association_id = old.association_id then
    return new;
  end if;
  if not exists (
    select 1 from public.units u
     where u.id = new.unit_id and u.association_id = new.association_id
  ) then
    raise exception 'unit belongs to a different association' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.persons p
     where p.id = new.person_id and p.association_id = new.association_id
  ) then
    raise exception 'person belongs to a different association' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_role_grant_same_association() from public, anon;
grant execute on function public.tg_role_grant_same_association() to authenticated;
revoke all on function public.tg_unit_owner_same_association() from public, anon;
grant execute on function public.tg_unit_owner_same_association() to authenticated;

create trigger role_grants_same_association
  before insert or update on public.role_grants
  for each row execute function public.tg_role_grant_same_association();

create trigger unit_owners_same_association
  before insert or update on public.unit_owners
  for each row execute function public.tg_unit_owner_same_association();

do $$
declare
  v_grants integer;
  v_owners integer;
begin
  select count(*) into v_grants
    from public.role_grants g
    join public.persons p on p.id = g.person_id
   where p.association_id <> g.association_id;
  select count(*) into v_owners
    from public.unit_owners o
    left join public.units u on u.id = o.unit_id
    left join public.persons p on p.id = o.person_id
   where u.association_id is distinct from o.association_id
      or p.association_id is distinct from o.association_id;
  if v_grants > 0 or v_owners > 0 then
    raise notice 'existing rows that cross associations: role_grants %, unit_owners %', v_grants, v_owners;
  end if;
end $$;
