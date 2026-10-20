-- Announcement importance: Normal, Important or Urgent, picked when composing.
-- Shown as a badge wherever the post appears; it changes nothing about who
-- sees it or when.

alter table public.announcements
  add column importance text not null default 'normal'
  check (importance in ('normal', 'important', 'urgent'));

comment on column public.announcements.importance is
  'How much attention the board is asking for: normal, important or urgent. Display only.';

-- Replace the 10-argument version: a second signature with a defaulted
-- argument would make calls with ten arguments ambiguous.
drop function public.save_announcement(uuid, uuid, text, text, text, uuid[], boolean, uuid, date, boolean);

create or replace function public.save_announcement(
  p_association_id uuid,
  p_id             uuid,
  p_title          text,
  p_body           text,
  p_audience       text,
  p_unit_ids       uuid[],
  p_pinned         boolean,
  p_attachment_document_id uuid,
  p_expires_on     date,
  p_publish        boolean,
  p_importance     text default 'normal'
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id     uuid;
  v_status text;
  v_units  uuid[] := coalesce(p_unit_ids, '{}');
  v_doc    public.documents%rowtype;
begin
  if not public.is_board(p_association_id) then
    raise exception 'only the board can post announcements' using errcode = '42501';
  end if;
  if p_importance not in ('normal', 'important', 'urgent') then
    raise exception 'importance must be normal, important or urgent' using errcode = '22023';
  end if;
  if p_audience not in ('all', 'units') then
    raise exception 'audience must be all or units' using errcode = '22023';
  end if;
  if p_audience = 'units' and cardinality(v_units) = 0 then
    raise exception 'choose at least one unit' using errcode = '22023', hint = 'no_units';
  end if;
  if p_audience = 'all' then v_units := '{}'; end if;
  if exists (select 1 from unnest(v_units) x where not exists (
       select 1 from public.units u where u.id = x and u.association_id = p_association_id)) then
    raise exception 'unit belongs to a different association' using errcode = '42501';
  end if;
  if p_expires_on is not null and p_expires_on < current_date then
    raise exception 'the end date is in the past' using errcode = '22023', hint = 'expires_past';
  end if;

  -- An attachment must already be readable by exactly this audience (the
  -- Document Hub decides who can open a file; the announcement cannot widen it).
  if p_attachment_document_id is not null then
    select * into v_doc from public.documents
     where id = p_attachment_document_id and association_id = p_association_id and deleted_at is null;
    if not found then
      raise exception 'attachment not found' using errcode = '22023', hint = 'attachment_missing';
    end if;
    if not (
      (v_doc.restricted_to_unit_id is null and v_doc.visibility = 'all_owners')
      or (p_audience = 'units' and cardinality(v_units) = 1 and v_doc.restricted_to_unit_id = v_units[1])
    ) then
      raise exception 'owners cannot open that file yet' using errcode = '22023', hint = 'attachment_not_shared';
    end if;
  end if;

  v_status := case when p_publish then 'published' else 'draft' end;

  if p_id is null then
    insert into public.announcements
      (association_id, title, body, audience, pinned, status, attachment_document_id, expires_on, importance)
    values
      (p_association_id, btrim(p_title), btrim(p_body), p_audience,
       coalesce(p_pinned, false) and p_publish, v_status, p_attachment_document_id, p_expires_on, p_importance)
    returning id into v_id;
  else
    select a.id, a.status into v_id, v_status from public.announcements a
     where a.id = p_id and a.association_id = p_association_id for update;
    if v_id is null then
      raise exception 'announcement not found' using errcode = '22023';
    end if;
    if v_status = 'archived' then
      raise exception 'restore it before editing' using errcode = '22023';
    end if;
    update public.announcements set
      title = btrim(p_title), body = btrim(p_body), audience = p_audience,
      pinned = coalesce(p_pinned, false) and (p_publish or v_status = 'published'),
      attachment_document_id = p_attachment_document_id, expires_on = p_expires_on,
      importance = p_importance,
      status = case when v_status = 'draft' and p_publish then 'published' else v_status end
     where id = v_id;
  end if;

  delete from public.announcement_units where announcement_id = v_id;
  insert into public.announcement_units (association_id, announcement_id, unit_id)
  select p_association_id, v_id, x from unnest(v_units) x;

  return v_id;
end $$;

revoke all on function public.save_announcement(uuid, uuid, text, text, text, uuid[], boolean, uuid, date, boolean, text) from public, anon;
grant execute on function public.save_announcement(uuid, uuid, text, text, text, uuid[], boolean, uuid, date, boolean, text) to authenticated;

