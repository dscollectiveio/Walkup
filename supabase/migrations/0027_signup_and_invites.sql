-- ============================================================================
-- Walkup — migration 0027: self-serve signup and invite-based account creation
--
-- Every account until now has been created by hand, directly in the database
-- — deliberate, because RLS is the only thing standing between one board's
-- financial data and a stranger's (DECISIONS #18). This migration adds the
-- first two legitimate exceptions to "every write RPC checks is_board()
-- first": there is no board yet for a brand-new signup, and no association
-- yet for someone redeeming an invite. Both are the actual chicken-and-egg —
-- associations has no INSERT policy at all (0002_rls.sql), and persons/
-- role_grants both require is_board() to already be true. Becoming board_admin
-- requires a role_grants row; inserting one requires already being
-- board_admin.
--
-- ONE ACCOUNT, ONE ASSOCIATION. The schema has always supported one person
-- belonging to several associations (DECISIONS #11), but the rest of the app
-- never got built for it — roughly ten files just do
-- `select id from associations limit(1)` with no logic for "which one". If any
-- account ever ended up in two associations, those pages would silently
-- operate on an arbitrary one, not fail loudly. So both RPCs below refuse to
-- attach a second membership to an already-onboarded account. That is a real,
-- named product limitation (one login per building, for now) — deliberately
-- carried forward from #11's own posture, not a bug to fix later by accident.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- INVITES
-- ----------------------------------------------------------------------------

create table invites (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  role           app_role not null,
  email          text,   -- optional pre-fill; not enforced against who redeems it
  -- Built from gen_random_uuid() rather than pgcrypto's gen_random_bytes(),
  -- so this migration has no extension dependency (pgcrypto isn't loadable
  -- under the PGlite test harness). Three UUIDs is 48 bytes of entropy —
  -- far more than the 24 bytes the pgcrypto version used.
  token          text not null unique default (
                    replace(gen_random_uuid()::text, '-', '') ||
                    replace(gen_random_uuid()::text, '-', '') ||
                    replace(gen_random_uuid()::text, '-', '')
                  ),
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '7 days',
  redeemed_at    timestamptz,
  redeemed_by    uuid references auth.users(id),
  check (expires_at > created_at)
);

create index on invites (association_id);
-- Redemption looks up by token alone (the recipient isn't authenticated as a
-- board member of anything yet), so the unique index on token is the lookup
-- path — no additional index needed.

alter table invites enable row level security;

-- Board manages its own invites like any other config table (vendors,
-- documents). No update policy: an invite is created, redeemed once by
-- redeem_invite() below, or left to expire — redeemed_at/redeemed_by are
-- written only by that SECURITY DEFINER function, never by a client.
create policy invites_select on invites
  for select to authenticated
  using (public.is_board(association_id));

create policy invites_insert on invites
  for insert to authenticated
  with check (public.is_board(association_id));

create policy invites_delete on invites
  for delete to authenticated
  using (public.is_board(association_id));

create trigger audit_invites
  after insert or update or delete on invites
  for each row execute function tg_audit();

-- ----------------------------------------------------------------------------
-- CREATE A BRAND-NEW ASSOCIATION, WITH THE CALLER AS ITS FIRST board_admin
-- ----------------------------------------------------------------------------
-- No is_board() check — there is no board yet. Authorization here is simply
-- "a real, authenticated Supabase session" (auth.uid() is not null), which is
-- already guaranteed by the time a caller can reach this RPC at all (RLS
-- requires the authenticated role, and proxy.ts + the /onboarding page only
-- ever call this from a signed-in, MFA-verified session). The one real gate
-- is the one-association-per-account rule below.

create or replace function create_association_and_owner(
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

  return v_association;
end $$;

revoke all on function create_association_and_owner(text, text, text, text, text) from public, anon;
grant execute on function create_association_and_owner(text, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- REDEEM AN INVITE
-- ----------------------------------------------------------------------------
-- Same "no is_board yet" reasoning as above — the caller is joining an
-- association they aren't a member of. The invite row itself is the
-- authorization: possessing a live, unredeemed, unexpired token is what
-- grants the right to join at the role that invite names.

create or replace function redeem_invite(
  p_token     text,
  p_full_name text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_invite public.invites%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_invite from public.invites where token = p_token;

  if v_invite.id is null then
    raise exception 'this invite link is not valid' using errcode = 'no_data_found';
  end if;

  if v_invite.redeemed_at is not null then
    raise exception 'this invite link has already been used' using errcode = 'no_data_found';
  end if;

  if v_invite.expires_at <= now() then
    raise exception 'this invite link has expired' using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.persons where auth_user_id = v_uid) then
    raise exception 'this account already belongs to a building'
      using errcode = '23505';
  end if;

  insert into public.persons (association_id, full_name, email, auth_user_id)
  values (v_invite.association_id, p_full_name, v_invite.email, v_uid);

  insert into public.role_grants (association_id, person_id, role, granted_by)
  select v_invite.association_id, p.id, v_invite.role, v_invite.created_by
    from public.persons p
   where p.association_id = v_invite.association_id and p.auth_user_id = v_uid;

  update public.invites
     set redeemed_at = now(), redeemed_by = v_uid
   where id = v_invite.id;

  return v_invite.association_id;
end $$;

revoke all on function redeem_invite(text, text) from public, anon;
grant execute on function redeem_invite(text, text) to authenticated;
