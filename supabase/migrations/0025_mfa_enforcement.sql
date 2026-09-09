-- ============================================================================
-- Walkup — migration 0025: require MFA (AAL2) for role- and unit-scoped access
--
-- Plaid's production security review asks whether MFA is in place before a
-- consumer can reach Plaid Link. The application gates that in the UI (see
-- src/proxy.ts), but a UI gate alone is not real authorization — anyone who
-- still holds a password-only (AAL1) session could call PostgREST directly
-- and skip the redirect. The database has to refuse it too.
--
-- One new helper, wired into the three functions nearly every policy already
-- calls (has_role_in, owned_unit_ids, current_person_id) rather than editing
-- every policy individually. This automatically covers:
--   - every can_read_financials/is_board/is_member policy (0002 and later)
--   - post_journal_entry() (0003), which checks is_board()
--   - store_bank_connection() / get_bank_access_token() (0016), which check
--     has_role_in() directly — the exact path DECISIONS #24 and Plaid's
--     question are both about
--
-- Known residual gap, accepted rather than silently left: persons_select and
-- persons_update (0002) also allow `auth_user_id = auth.uid()` directly, for
-- a person reading/editing their own contact details — that path does not
-- run through any of the three functions below, so it stays reachable at
-- AAL1. It exposes only a person's own name/contact info, never financial
-- data, so it is left as-is rather than pulled into this migration's scope.
-- Tracked in docs/SECURITY_POLICY.md.
-- ============================================================================

create or replace function public.session_is_aal2()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
$$;

revoke all on function public.session_is_aal2() from public, anon;
grant execute on function public.session_is_aal2() to authenticated;

create or replace function public.has_role_in(assoc uuid, roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.session_is_aal2() and exists (
    select 1
      from public.role_grants g
      join public.persons p on p.id = g.person_id
     where p.auth_user_id = auth.uid()
       and g.association_id = assoc
       and g.role = any(roles)
       and g.revoked_at is null
       and (g.expires_on is null or g.expires_on >= current_date)
  )
$$;

create or replace function public.owned_unit_ids(assoc uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select uo.unit_id
    from public.unit_owners uo
    join public.persons p on p.id = uo.person_id
   where p.auth_user_id = auth.uid()
     and uo.association_id = assoc
     and (uo.effective_to is null or uo.effective_to >= current_date)
     and public.session_is_aal2()
$$;

create or replace function public.current_person_id(assoc uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.id
    from public.persons p
   where p.auth_user_id = auth.uid()
     and p.association_id = assoc
     and public.session_is_aal2()
   limit 1
$$;
