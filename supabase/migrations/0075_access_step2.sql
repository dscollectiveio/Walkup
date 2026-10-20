-- 0075: access plan step 2 (docs/specs/access-audit-2026-10-20.md).
--   1. Board admin, board member, accountant and outside-helper (property manager, attorney, observer)
--      invites need an email, expire after 3 days, and only redeem for that email. Owner invites are
--      unchanged (7 days; person-bound ones already check). Accountant and outside-helper grants made by
--      an invite end after 90 days, like the ones ticked on Building & Owners.
--   2. Only a board admin can revoke an invite.
--   3. A former owner's access ends when their ownership is closed, not at the next daily run.
--   4. A login cannot be removed from the last board admin who can sign in.

-- ----------------------------------------------------------------------------
-- 1. Staff invites
-- ----------------------------------------------------------------------------

create or replace function public.tg_invite_staff_rules()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.role <> 'owner' then
    if new.email is null or btrim(new.email) = '' or position('@' in new.email) < 2 then
      raise exception 'an invite for anyone but an owner needs the email address it is for'
        using errcode = 'check_violation';
    end if;
    if tg_op = 'INSERT' then
      new.expires_at := least(new.expires_at, now() + interval '3 days');
    end if;
  end if;
  return new;
end $$;

revoke all on function public.tg_invite_staff_rules() from public, anon;
grant execute on function public.tg_invite_staff_rules() to authenticated;

drop trigger if exists invites_staff_rules on public.invites;
create trigger invites_staff_rules
  before insert or update on public.invites
  for each row execute function public.tg_invite_staff_rules();

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
    -- Any link for a role other than owner only works for the email it was made for.
    if v_invite.role <> 'owner' and not exists (
      select 1 from auth.users u
       where u.id = v_uid
         and v_invite.email is not null and btrim(v_invite.email) <> ''
         and lower(btrim(u.email)) = lower(btrim(v_invite.email))
    ) then
      raise exception 'sign in with the email address this invite was sent to'
        using errcode = '42501';
    end if;
    insert into public.persons (association_id, full_name, email, auth_user_id)
    values (v_invite.association_id, p_full_name, v_invite.email, v_uid);

    insert into public.role_grants (association_id, person_id, role, granted_by, expires_on)
    select v_invite.association_id, p.id, v_invite.role, v_invite.created_by,
           -- The accountant and the three outside helpers (0077, 0080) have access that ends by itself.
           case when v_invite.role in ('accountant', 'property_manager', 'attorney', 'observer') then current_date + 90 end
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
-- 2. Revoking an invite
-- ----------------------------------------------------------------------------

drop policy if exists invites_delete on public.invites;
create policy invites_delete on public.invites
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

-- ----------------------------------------------------------------------------
-- 3. Former owners
-- ----------------------------------------------------------------------------

create or replace function public.tg_unit_owners_deprovision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.deprovision_stale_access(coalesce(new.association_id, old.association_id));
  return null;
end $$;

revoke all on function public.tg_unit_owners_deprovision() from public, anon, authenticated;

drop trigger if exists unit_owners_deprovision on public.unit_owners;
create trigger unit_owners_deprovision
  after update of effective_to or delete on public.unit_owners
  for each row execute function public.tg_unit_owners_deprovision();

-- ----------------------------------------------------------------------------
-- 4. The last admin's login
-- ----------------------------------------------------------------------------
-- Removing a login (persons.auth_user_id goes null when an auth user is deleted) must not leave a
-- building with no admin who can sign in.

create or replace function public.tg_keep_admin_login()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.auth_user_id is not null and new.auth_user_id is null
     and exists (
       select 1 from public.role_grants g
        where g.person_id = old.id and g.role = 'board_admin' and g.revoked_at is null
          and (g.expires_on is null or g.expires_on >= current_date)
     )
     and exists (select 1 from public.associations where id = old.association_id)
     and not exists (
       select 1 from public.role_grants g
         join public.persons p on p.id = g.person_id and p.auth_user_id is not null and p.id <> old.id
        where g.association_id = old.association_id and g.role = 'board_admin' and g.revoked_at is null
          and (g.expires_on is null or g.expires_on >= current_date)
     ) then
    raise exception 'This login belongs to the last board admin who can sign in. Make someone else an admin first.'
      using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function public.tg_keep_admin_login() from public, anon, authenticated;

drop trigger if exists persons_keep_admin_login on public.persons;
create trigger persons_keep_admin_login
  before update of auth_user_id on public.persons
  for each row execute function public.tg_keep_admin_login();
