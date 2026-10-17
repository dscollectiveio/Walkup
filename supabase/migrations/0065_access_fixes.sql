-- ============================================================================
-- 0065: access control, phase 1 (docs/specs/access-control-plan.md)
-- ============================================================================
--   1. An accountant who joins by invite link gets the same 90-day access as
--      one ticked on Building Info. redeem_invite set no end date, so those
--      accountants never expired (the promise made to Plaid and in the spec).
--   2. Accountant access that already has no end date gets one.
--   3. A building can never be left without a signed-in board admin.

-- ----------------------------------------------------------------------------
-- 1. redeem_invite: accountant grants end after 90 days
-- ----------------------------------------------------------------------------
-- Same signature and body as 0054; the only change is expires_on on the
-- new-person insert.
create or replace function public.redeem_invite(
  p_token     text,
  p_full_name text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_invite public.invites%rowtype;
  v_person public.persons%rowtype;
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
    raise exception 'this account already belongs to a building' using errcode = '23505';
  end if;

  if v_invite.person_id is not null then
    select * into v_person from public.persons
     where id = v_invite.person_id and association_id = v_invite.association_id
     for update;
    if not found then
      raise exception 'this invite link is not valid' using errcode = 'no_data_found';
    end if;
    if v_person.auth_user_id is not null then
      raise exception 'this person already has an account' using errcode = '23505';
    end if;
    if v_person.email is not null and btrim(v_person.email) <> '' and not exists (
      select 1 from auth.users u
       where u.id = v_uid and lower(btrim(u.email)) = lower(btrim(v_person.email))
    ) then
      raise exception 'sign in with the email address the board has on file for you to use this link'
        using errcode = '42501';
    end if;
    update public.persons set auth_user_id = v_uid where id = v_person.id;
    insert into public.role_grants (association_id, person_id, role, granted_by)
    values (v_invite.association_id, v_person.id, 'owner', v_invite.created_by)
    on conflict (association_id, person_id, role)
    do update set revoked_at = null, revoked_by = null, expires_on = null;
  else
    insert into public.persons (association_id, full_name, email, auth_user_id)
    values (v_invite.association_id, p_full_name, v_invite.email, v_uid);

    insert into public.role_grants (association_id, person_id, role, granted_by, expires_on)
    select v_invite.association_id, p.id, v_invite.role, v_invite.created_by,
           case when v_invite.role = 'accountant' then current_date + 90 end
      from public.persons p
     where p.association_id = v_invite.association_id and p.auth_user_id = v_uid;
  end if;

  update public.invites
     set redeemed_at = now(), redeemed_by = v_uid
   where id = v_invite.id;

  return v_invite.association_id;
end $$;

revoke all on function public.redeem_invite(text, text) from public, anon;
grant execute on function public.redeem_invite(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Accountants with no end date get one
-- ----------------------------------------------------------------------------
-- 90 days from when they were given access, but never sooner than two weeks
-- from now, so nobody is cut off the day this ships.
update public.role_grants
   set expires_on = greatest(granted_on + 90, current_date + 14)
 where role = 'accountant' and revoked_at is null and expires_on is null;

-- ----------------------------------------------------------------------------
-- 3. Never leave a building without a board admin
-- ----------------------------------------------------------------------------
-- Fires when an active board_admin grant is revoked, ended, changed to another
-- role, or deleted, and no other active admin who can sign in would remain.
-- System clean-up (revoked_by null: deprovision_stale_access) is exempt, and
-- so is deleting the whole association.

create or replace function public.tg_keep_one_board_admin()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old_active boolean;
  v_new_active boolean;
begin
  v_old_active := old.role = 'board_admin' and old.revoked_at is null
                  and (old.expires_on is null or old.expires_on >= current_date);
  if not v_old_active then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    v_new_active := new.role = 'board_admin' and new.revoked_at is null
                    and (new.expires_on is null or new.expires_on >= current_date);
    if v_new_active then return new; end if;
    -- System clean-up records no actor.
    if new.revoked_by is null and new.revoked_at is not null then return new; end if;
  end if;

  if not exists (select 1 from public.associations where id = old.association_id) then
    return coalesce(new, old);
  end if;

  if not exists (
    select 1
      from public.role_grants g
      join public.persons p on p.id = g.person_id and p.auth_user_id is not null
     where g.association_id = old.association_id
       and g.id <> old.id
       and g.role = 'board_admin'
       and g.revoked_at is null
       and (g.expires_on is null or g.expires_on >= current_date)
  ) then
    raise exception 'A building needs at least one board admin who can sign in. Make someone else an admin first.'
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end $$;

revoke all on function public.tg_keep_one_board_admin() from public, anon, authenticated;

drop trigger if exists role_grants_keep_one_admin on public.role_grants;
create trigger role_grants_keep_one_admin
  before update or delete on public.role_grants
  for each row execute function public.tg_keep_one_board_admin();
