-- ============================================================================
-- 0067: a board admin can delete a former member
-- ============================================================================
-- "Remove personal data" (redact_person, 0037) clears a person's name, email,
-- phone and address and leaves a row called "Former member", because payments,
-- ownership and repair history point at it. Until now nothing could remove that
-- row. This lets a board admin delete one, but only when nothing still refers
-- to it. If anything does, the delete is refused with a sentence that counts
-- each kind of record and says where it shows in Walkup, and the row stays:
-- those records need someone to be attributed to. (A board admin can delete a mistaken owner
-- record first, then the former member.)
--
-- Only a person whose details were already removed can be deleted: name
-- "Former member", no email, phone, address or login. Anyone else goes through
-- "Remove personal data" first.

create or replace function public.delete_former_member(p_person_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.persons%rowtype;
  r record;
  n bigint;
  v_uses text[] := '{}';
begin
  select * into p from public.persons where id = p_person_id;
  if not found then
    raise exception 'that person isn''t on file' using errcode = '22023';
  end if;
  if not public.has_role_in(p.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board admin can delete a former member' using errcode = '42501';
  end if;
  if p.full_name <> 'Former member' or p.email is not null or p.phone is not null
     or p.mailing_address is not null or p.auth_user_id is not null then
    raise exception 'remove this person''s personal data first; only a former member can be deleted' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.role_grants g
     where g.person_id = p.id and g.revoked_at is null
       and (g.expires_on is null or g.expires_on >= current_date)) then
    raise exception 'this person still has access; revoke it first' using errcode = '22023';
  end if;

  -- Say exactly what still refers to them, and where in Walkup, so the board knows what to resolve.
  -- Each row is (table, column, singular, plural, where it shows in the app). Their ended access and
  -- email choices are not listed: those go with them.
  for r in
    select * from (values
      ('unit_owners', 'person_id', 'ownership record', 'ownership records', 'Building & Owners, Owner records'),
      ('unit_property_managers', 'person_id', 'property manager assignment', 'property manager assignments', 'HOA Dues, on that unit''s card'),
      ('tickets', 'reported_by', 'repair report they filed', 'repair reports they filed', 'Repairs & Upkeep, Problems'),
      ('ticket_comments', 'person_id', 'repair note they wrote', 'repair notes they wrote', 'on those repairs; notes are kept as history'),
      ('ticket_board_details', 'assignee_person_id', 'repair assigned to them', 'repairs assigned to them', 'Repairs & Upkeep, Problems'),
      ('email_outbox', 'person_id', 'email Walkup prepared or sent to them', 'emails Walkup prepared or sent to them', 'HOA Dues, Email & reminders; the email record is kept'),
      ('email_log', 'person_id', 'email delivery log entry', 'email delivery log entries', 'the email record is kept'),
      ('announcement_reads', 'person_id', 'announcement read record', 'announcement read records', 'Announcements; kept as history'),
      ('board_tasks', 'owner_person_id', 'board task', 'board tasks', 'the Dashboard, Your list'),
      ('insurance_owner_requests', 'person_id', 'insurance request', 'insurance requests', 'Insurance, owner requests'),
      ('invites', 'person_id', 'sign-in invite', 'sign-in invites', 'Building & Owners, Sign-in invites'),
      ('saved_views', 'owner_person_id', 'saved view', 'saved views', 'Repairs & Upkeep filters')
    ) as t(tbl, col, one, many, place)
  loop
    execute format('select count(*) from public.%I where %I = $1', r.tbl, r.col) into n using p.id;
    if n > 0 then
      v_uses := v_uses || (n::text || ' ' || case when n = 1 then r.one else r.many end || ' (' || r.place || ')');
    end if;
  end loop;
  if cardinality(v_uses) > 0 then
    raise exception 'this former member is still used in: %. Resolve what you can, or leave them: they keep that history attributed to someone.',
      array_to_string(v_uses, '; ')
      using errcode = '22023';
  end if;

  begin
    -- Their ended access and email choices go with them.
    delete from public.role_grants where person_id = p.id;
    delete from public.email_preferences where person_id = p.id;
    delete from public.persons where id = p.id;
  exception when foreign_key_violation then
    -- Something not listed above still refers to them; the inner deletes are undone.
    raise exception 'something in Walkup still refers to this person, so they can''t be deleted' using errcode = '22023';
  end;
end $$;

revoke all on function public.delete_former_member(uuid) from public, anon;
grant execute on function public.delete_former_member(uuid) to authenticated;

comment on function public.delete_former_member(uuid) is
  'A board admin deletes a person whose personal data was already removed, when no record still refers to them.';
