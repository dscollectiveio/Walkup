-- ============================================================================
-- 0090: a property manager can pick who a problem is assigned to
-- ============================================================================
-- The problem page offers the building's board members as the assignee. It built that list from role_grants, which a
-- property manager cannot read (0080 gave them repairs, not roles), so their list was empty. This returns just the
-- board's names for anyone who works the repairs (the board and a property manager), and nothing for anyone else.

create or replace function public.repairs_assignees(p_association_id uuid)
returns table (person_id uuid, full_name text)
language sql stable security definer set search_path = ''
as $$
  select distinct p.id, p.full_name
    from public.role_grants g
    join public.persons p on p.id = g.person_id and p.association_id = g.association_id
   where g.association_id = p_association_id
     and g.role in ('board_admin', 'board_member')
     and g.revoked_at is null
     and (g.expires_on is null or g.expires_on >= current_date)
     and public.can_manage_repairs(p_association_id)
   order by p.full_name
$$;

revoke all on function public.repairs_assignees(uuid) from public, anon;
grant execute on function public.repairs_assignees(uuid) to authenticated;

comment on function public.repairs_assignees(uuid) is
  'The building''s current board members (id and name) for the assignee picker, to the board and a property manager only.';
