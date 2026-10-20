-- 0079: two owner-portal features the product owner approved (docs/specs/access-audit-2026-10-20.md,
-- Round 2 decisions and Part 4 item 5).
--
--   A. Owner unit documents. An owner (their own unit only), a board member or a board admin adds a
--      document for one unit: an HO6 insurance certificate, a lease, proof of ownership, anything else.
--      The accountant cannot add one and cannot read one.
--        * Filed under a new category, 'unit_owner_upload' ('Unit document'), board_only by default and
--          always pinned to the unit. documents_select (0074) already lets a unit-pinned document be read by
--          the unit's current owners and the board, and the accountant branch only reaches the accounting
--          categories, so nothing in the select policy changes.
--        * No 'needs review' step and no automatic reading. The board gets an in-app notice instead
--          (owner_document_notices), shown as "New from owners" on the Documents page. No email.
--        * An owner can remove their own upload for 30 days (remove_unit_document, a soft delete); the
--          board can bin any of them.
--        * The file goes browser to Storage like every other upload, at <association>/units/<unit>/<file>.
--          New storage policies let an owner upload only under a unit they own (the board: any unit), and
--          register_unit_document() checks the stored object before it writes the row.
--
--   B. Owner finances page, off by default. associations.owner_finances_enabled, switched by a board admin
--      only (set_owner_finances_enabled). While it is on, any member reads a summary through
--      owner_finances_summary(): income and expenses for the last full fiscal year and the year to date,
--      cash and reserve balances, and the budget against what has been spent. Summary figures only, as text,
--      from a SECURITY DEFINER function that checks the flag and is_member. The ledger, bank and budget
--      tables stay unreadable to owners.

-- ----------------------------------------------------------------------------
-- A1. The category
-- ----------------------------------------------------------------------------

-- Same shape as 0020, with one more row. New associations are seeded from this by
-- tg_seed_document_categories(); existing ones are backfilled below.
create or replace function public.document_category_defaults()
returns table (slug text, label text, default_visibility text, sort_order smallint)
language sql immutable set search_path = ''
as $$
  values
    ('insurance'::text,           'Insurance'::text,             'board_only'::text,  10::smallint),
    ('tax_form',                  'Tax form',                    'board_only',        20),
    ('financial_statement',       'Financial statement',         'all_owners',        30),
    ('invoice',                   'Invoice or bill',             'board_only',        40),
    ('receipt',                   'Receipt',                     'board_only',        50),
    ('bank_statement',            'Bank statement',              'board_only',        60),
    ('governing',                 'Governing document',          'all_owners',        70),
    ('minutes',                   'Meeting minutes',             'all_owners',        80),
    ('contract',                  'Contract or agreement',       'board_only',        90),
    ('correspondence',            'Correspondence',              'board_only',       100),
    ('legal_notice',              'Legal notice',                'board_only',       110),
    ('permit',                    'Permit or inspection',        'board_only',       120),
    ('maintenance',               'Maintenance record',          'board_only',       130),
    ('unit_record',               'Unit record',                 'board_only',       140),
    ('vendor_document',           'Vendor document',             'board_only',       150),
    ('other',                     'Other',                       'board_only',       160),
    ('unit_owner_upload',         'Unit document',               'board_only',       170)
$$;

revoke all on function public.document_category_defaults() from public, anon;
grant execute on function public.document_category_defaults() to authenticated;

insert into public.document_categories
  (association_id, slug, label, default_visibility, sort_order, is_system)
select a.id, d.slug, d.label, d.default_visibility, d.sort_order, true
  from public.associations a
 cross join public.document_category_defaults() d
 where d.slug = 'unit_owner_upload'
on conflict (association_id, slug) do nothing;

-- ----------------------------------------------------------------------------
-- A2. The board's "New from owners" list
-- ----------------------------------------------------------------------------

create table public.owner_document_notices (
  id                    uuid primary key default gen_random_uuid(),
  association_id        uuid not null references public.associations(id) on delete restrict,
  document_id           uuid not null references public.documents(id) on delete cascade,
  unit_id               uuid not null references public.units(id) on delete restrict,
  uploaded_by_person_id uuid references public.persons(id) on delete set null,
  created_at            timestamptz not null default now(),
  seen_at               timestamptz,
  seen_by               uuid references auth.users(id),
  unique (document_id)
);

create index owner_document_notices_unseen_idx
  on public.owner_document_notices (association_id, created_at desc)
  where seen_at is null;

alter table public.owner_document_notices enable row level security;

-- The board reads them. No write policy: register_unit_document() inserts, and the board marks them seen
-- through mark_owner_document_notices_seen().
create policy owner_document_notices_select on public.owner_document_notices
  for select to authenticated
  using (public.is_board(association_id));

comment on table public.owner_document_notices is
  'One row per document an owner added for their unit, so the board sees it on the Documents page ("New from owners"). In-app only, never emailed. Written only by register_unit_document().';

-- ----------------------------------------------------------------------------
-- A3. Storage: <association>/units/<unit>/<13-digit ms>-<6 [a-z0-9]>-<safe name>
-- ----------------------------------------------------------------------------

-- Mirrors parseUnitDocumentPath() in src/lib/documents/upload-paths.ts. storage_path_kind() (0051) is left
-- alone on purpose: it classifies hub documents and ticket photos, and a path this function recognises is
-- neither.
create or replace function public.unit_document_path(p_name text)
returns table (association_id uuid, unit_id uuid)
language plpgsql immutable set search_path = '' as $$
declare
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
  v_uuid  constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_file  constant text := '^[0-9]{13}-[a-z0-9]{6}-[A-Za-z0-9_.-]{1,120}$';
begin
  if array_length(v_parts, 1) = 4
     and v_parts[1] ~ v_uuid and v_parts[2] = 'units'
     and v_parts[3] ~ v_uuid and v_parts[4] ~ v_file then
    return query select v_parts[1]::uuid, v_parts[3]::uuid;
  end if;
  return;
end $$;

revoke all on function public.unit_document_path(text) from public, anon;
grant execute on function public.unit_document_path(text) to authenticated;

comment on function public.unit_document_path(text) is
  'Classifies a documents-bucket object name as a unit document path (association and unit); no row for anything else. Pure.';

-- The association of a unit, for a caller who may add documents for it: the board (any unit) or an owner of
-- that unit today. Null for everyone else, and for a unit that does not exist (the same answer, so it cannot
-- be used to probe for units).
create or replace function public.unit_document_association_id(p_unit_id uuid)
returns uuid
language sql stable security definer set search_path = '' as $$
  select u.association_id
    from public.units u
   where u.id = p_unit_id
     and (
       public.is_board(u.association_id)
       or u.id in (select public.owned_unit_ids(u.association_id))
     )
$$;

revoke all on function public.unit_document_association_id(uuid) from public, anon;
grant execute on function public.unit_document_association_id(uuid) to authenticated;

-- Unregistered unit-document objects the caller uploaded in this building in the last day (0 where there is
-- no storage schema, as under PGlite). A rate limit like ticket_photo_pending_count(), not a bound on storage.
create or replace function public.unit_document_pending_count(p_association_id uuid)
returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if to_regclass('storage.objects') is null or auth.uid() is null then
    return 0;
  end if;
  execute
    'select count(*)::integer
       from storage.objects o
      where o.bucket_id = ''documents''
        and o.owner_id = $1
        and o.created_at > now() - interval ''1 day''
        and o.name like $2
        and not exists (select 1 from public.documents d where d.storage_path = o.name)'
    into v_count
    using auth.uid()::text, p_association_id::text || '/units/%';
  return coalesce(v_count, 0);
end $$;

revoke all on function public.unit_document_pending_count(uuid) from public, anon;
grant execute on function public.unit_document_pending_count(uuid) to authenticated;

-- May the caller upload this path? A well-formed unit document path for a unit they may add documents for,
-- with no documents row at it yet, and fewer than 30 unregistered uploads in the last day.
create or replace function public.unit_document_upload_allowed(p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.unit_document_path(p_name) k
     where public.unit_document_association_id(k.unit_id) = k.association_id
  )
  and not exists (select 1 from public.documents d where d.storage_path = p_name)
  and coalesce((select public.unit_document_pending_count(k.association_id)
                  from public.unit_document_path(p_name) k), 0) < 30
$$;

revoke all on function public.unit_document_upload_allowed(text) from public, anon;
grant execute on function public.unit_document_upload_allowed(text) to authenticated;

-- May the caller read or delete this object while it has no documents row? The storage policies add
-- owner_id = the caller, so only the uploader ever matches.
create or replace function public.unit_document_pending_allowed(p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.documents d where d.storage_path = p_name)
     and exists (
       select 1
         from public.unit_document_path(p_name) k
        where public.unit_document_association_id(k.unit_id) = k.association_id
     )
$$;

revoke all on function public.unit_document_pending_allowed(text) from public, anon;
grant execute on function public.unit_document_pending_allowed(text) to authenticated;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'no storage schema, skipping 0079 storage policies (expected under PGlite)';
    return;
  end if;

  drop policy if exists documents_write_unit_document on storage.objects;
  drop policy if exists documents_read_pending_unit   on storage.objects;
  drop policy if exists documents_delete_pending_unit on storage.objects;

  create policy documents_write_unit_document on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'documents'
      and public.unit_document_upload_allowed(name)
    );

  -- Lets the upload action read the caller's own just-uploaded object back to check its bytes before the
  -- row exists. Uploader only, one day.
  create policy documents_read_pending_unit on storage.objects
    for select to authenticated
    using (
      bucket_id = 'documents'
      and owner_id = (select auth.uid())::text
      and created_at > now() - interval '1 day'
      and public.unit_document_pending_allowed(name)
    );

  -- Lets the upload action throw away a rejected or duplicate upload that was never registered.
  create policy documents_delete_pending_unit on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'documents'
      and owner_id = (select auth.uid())::text
      and public.unit_document_pending_allowed(name)
    );
end $$;

-- ----------------------------------------------------------------------------
-- A4. Register, list and remove
-- ----------------------------------------------------------------------------

-- Register a unit document the caller has uploaded. Result:
--   document_id, duplicate
--     (new id, false)     added
--     (id, false)         a retried registration of the same path
--     (id, true)          the identical file is already filed for this unit
--     (null, true)        the identical file is stored somewhere else in the building; nothing is linked and
--                         nothing about the other document is returned
create or replace function public.register_unit_document(
  p_unit_id      uuid,
  p_storage_path text,
  p_filename     text,
  p_mime_type    text,
  p_byte_size    bigint,
  p_checksum     text,
  p_kind         text,
  p_title        text default null
)
returns table (document_id uuid, duplicate boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_assoc    uuid;
  v_label    text;
  v_category uuid;
  v_existing record;
  v_doc      uuid;
  v_stored   boolean;
  v_count    integer;
begin
  v_assoc := public.unit_document_association_id(p_unit_id);
  if v_assoc is null then
    raise exception 'you can''t add documents for this unit' using errcode = '42501';
  end if;

  v_label := case p_kind
    when 'ho6_certificate'   then 'HO6 insurance certificate'
    when 'lease'             then 'Lease'
    when 'proof_of_ownership' then 'Proof of ownership'
    when 'other'             then 'Other'
  end;
  if v_label is null then
    raise exception 'choose what kind of document this is' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.unit_document_path(p_storage_path) k
     where k.association_id = v_assoc and k.unit_id = p_unit_id
  ) then
    raise exception 'that file was not uploaded for this unit' using errcode = '22023';
  end if;

  if p_mime_type is null or p_mime_type not in (
    'application/pdf', 'image/png', 'image/jpeg', 'image/heic',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
  ) then
    raise exception 'that file type can''t be stored' using errcode = '22023';
  end if;
  if p_byte_size is null or p_byte_size < 1 or p_byte_size > 26214400 then
    raise exception 'files must be 25 MB or smaller' using errcode = '22023';
  end if;
  if p_checksum is null or p_checksum !~ '^[0-9a-f]{64}$' then
    raise exception 'missing checksum' using errcode = '22023';
  end if;
  if p_filename is null or length(btrim(p_filename)) = 0 or length(p_filename) > 255 then
    raise exception 'missing file name' using errcode = '22023';
  end if;

  select c.id into v_category
    from public.document_categories c
   where c.association_id = v_assoc and c.slug = 'unit_owner_upload';
  if v_category is null then
    raise exception 'the Unit document category is missing' using errcode = 'P0001';
  end if;

  -- One registration at a time per unit, so the counts and the duplicate check below cannot race.
  perform pg_advisory_xact_lock(hashtextextended('unit_documents:' || p_unit_id::text, 0));

  -- A retried registration of this very path (the response was lost on the way back). Only the uploader.
  select d.id, d.uploaded_by into v_existing
    from public.documents d
   where d.association_id = v_assoc and d.storage_path = p_storage_path;
  if found then
    if v_existing.uploaded_by is distinct from auth.uid() then
      raise exception 'that file was not uploaded for this unit' using errcode = '22023';
    end if;
    return query select v_existing.id, false;
    return;
  end if;

  -- The stored object must be the caller's, with the size and type being registered. Skipped where there is
  -- no storage schema (PGlite).
  if to_regclass('storage.objects') is not null then
    execute
      'select exists (
         select 1 from storage.objects o
          where o.bucket_id = ''documents''
            and o.name = $1
            and o.owner_id = $2
            and (o.metadata->>''size'')::bigint = $3
            and lower(btrim(split_part(o.metadata->>''mimetype'', '';'', 1))) = $4)'
      into v_stored
      using p_storage_path, auth.uid()::text, p_byte_size, p_mime_type;
    if not coalesce(v_stored, false) then
      raise exception 'that file hasn''t finished uploading' using errcode = '22023', hint = 'not_uploaded';
    end if;
  end if;

  -- Limits, so one account cannot fill the building's storage: 100 live uploads per unit, 20 a day per person.
  select count(*) into v_count
    from public.documents d
   where d.association_id = v_assoc
     and d.restricted_to_unit_id = p_unit_id
     and d.category_id = v_category
     and d.deleted_at is null;
  if v_count >= 100 then
    raise exception 'this unit already has 100 uploaded documents' using errcode = 'P0001', hint = 'unit_limit';
  end if;
  select count(*) into v_count
    from public.documents d
   where d.association_id = v_assoc
     and d.uploaded_by = auth.uid()
     and d.category_id = v_category
     and d.uploaded_at > now() - interval '1 day';
  if v_count >= 20 then
    raise exception 'you have added 20 documents today' using errcode = 'P0001', hint = 'daily_limit';
  end if;

  -- Identical bytes are one document (documents_checksum_key, 0020). The id comes back only when the
  -- document is already filed for this very unit, which the caller may see.
  select d.id, d.restricted_to_unit_id into v_existing
    from public.documents d
   where d.association_id = v_assoc and d.checksum = p_checksum and d.deleted_at is null;
  if found then
    if v_existing.restricted_to_unit_id is not distinct from p_unit_id then
      return query select v_existing.id, true;
    else
      return query select null::uuid, true;
    end if;
    return;
  end if;

  begin
    insert into public.documents (
      association_id, storage_path, filename, title, mime_type, byte_size, checksum,
      category_id, tag_source, review_state, labels, visibility, restricted_to_unit_id,
      source, extraction_state, extraction_error
    ) values (
      v_assoc,
      p_storage_path,
      left(btrim(p_filename), 255),
      nullif(left(btrim(coalesce(p_title, '')), 200), ''),
      p_mime_type,
      p_byte_size,
      p_checksum,
      v_category,
      'manual',
      'ok',
      array[v_label],
      'board_only',
      p_unit_id,
      'upload',
      'skipped',
      'Documents added for a unit are not read automatically.'
    )
    returning id into v_doc;
  exception when unique_violation then
    return query select null::uuid, true;
    return;
  end;

  -- The board hears about an owner's upload, not about its own.
  if not public.is_board(v_assoc) then
    insert into public.owner_document_notices (association_id, document_id, unit_id, uploaded_by_person_id)
    values (v_assoc, v_doc, p_unit_id, public.current_person_id(v_assoc));
  end if;

  return query select v_doc, false;
end $$;

revoke all on function public.register_unit_document(uuid, text, text, text, bigint, text, text, text) from public, anon;
grant execute on function public.register_unit_document(uuid, text, text, text, bigint, text, text, text) to authenticated;

comment on function public.register_unit_document(uuid, text, text, text, bigint, text, text, text) is
  'Register a file the caller uploaded for one unit (an owner of that unit, or the board for any unit). Files it under Unit document, board_only and pinned to the unit, with the kind in labels. Never queued for review or read by the AI. Notifies the board when an owner added it.';

-- The unit documents of one unit, for the unit's owners and the board. The accountant and other owners get
-- no rows. Names are the board's to see; an owner sees "you", "board" or "owner".
create or replace function public.unit_owner_documents(p_unit_id uuid)
returns table (
  document_id   uuid,
  title         text,
  filename      text,
  mime_type     text,
  byte_size     bigint,
  kind          text,
  uploaded_at   timestamptz,
  added_by_kind text,      -- 'you' | 'board' | 'owner'
  added_by_name text,      -- null unless the caller is on the board
  can_remove    boolean
)
language sql stable security definer set search_path = '' as $$
  select d.id,
         d.title,
         d.filename,
         d.mime_type,
         d.byte_size,
         d.labels[1],
         d.uploaded_at,
         case
           when d.uploaded_by = auth.uid() then 'you'
           when exists (
             select 1
               from public.role_grants g
               join public.persons p on p.id = g.person_id
              where p.auth_user_id = d.uploaded_by
                and g.association_id = d.association_id
                and g.role in ('board_admin', 'board_member')
                and g.revoked_at is null
                and (g.expires_on is null or g.expires_on >= current_date)
           ) then 'board'
           else 'owner'
         end,
         case when public.is_board(d.association_id) then
           (select p.full_name
              from public.persons p
             where p.auth_user_id = d.uploaded_by and p.association_id = d.association_id
             limit 1)
         end,
         public.is_board(d.association_id)
           or (d.uploaded_by = auth.uid() and d.uploaded_at > now() - interval '30 days')
    from public.documents d
    join public.document_categories c on c.id = d.category_id and c.slug = 'unit_owner_upload'
   where d.restricted_to_unit_id = p_unit_id
     and d.deleted_at is null
     and d.is_current_version
     and (
       public.is_board(d.association_id)
       or p_unit_id in (select public.owned_unit_ids(d.association_id))
     )
   order by d.uploaded_at desc
$$;

revoke all on function public.unit_owner_documents(uuid) from public, anon;
grant execute on function public.unit_owner_documents(uuid) to authenticated;

-- Remove a unit document (a soft delete, like binning it in the hub). The board: any of them, any time. An
-- owner: their own upload, for 30 days, while they still own the unit.
create or replace function public.remove_unit_document(p_document_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_doc  public.documents%rowtype;
  v_slug text;
begin
  select * into v_doc from public.documents where id = p_document_id;
  if not found then
    raise exception 'you can''t remove this document' using errcode = '42501';
  end if;
  select c.slug into v_slug from public.document_categories c where c.id = v_doc.category_id;
  if v_slug is distinct from 'unit_owner_upload'
     or v_doc.deleted_at is not null
     or v_doc.restricted_to_unit_id is null then
    raise exception 'you can''t remove this document' using errcode = '42501';
  end if;

  if public.is_board(v_doc.association_id) then
    null;
  elsif v_doc.uploaded_by = auth.uid()
        and v_doc.restricted_to_unit_id in (select public.owned_unit_ids(v_doc.association_id)) then
    if v_doc.uploaded_at <= now() - interval '30 days' then
      raise exception 'you can only remove a document within 30 days of adding it'
        using errcode = '42501', hint = 'window_closed';
    end if;
  else
    raise exception 'you can''t remove this document' using errcode = '42501';
  end if;

  update public.documents set deleted_at = now() where id = v_doc.id;
  update public.owner_document_notices
     set seen_at = coalesce(seen_at, now()), seen_by = coalesce(seen_by, auth.uid())
   where document_id = v_doc.id;
end $$;

revoke all on function public.remove_unit_document(uuid) from public, anon;
grant execute on function public.remove_unit_document(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- A5. The board's notices
-- ----------------------------------------------------------------------------

create or replace function public.list_owner_document_notices(p_association_id uuid)
returns table (
  notice_id        uuid,
  document_id      uuid,
  title            text,
  filename         text,
  kind             text,
  unit_id          uuid,
  unit_label       text,
  uploaded_by_name text,
  added_at         timestamptz
)
language sql stable security definer set search_path = '' as $$
  select n.id,
         d.id,
         d.title,
         d.filename,
         d.labels[1],
         n.unit_id,
         u.label,
         p.full_name,
         n.created_at
    from public.owner_document_notices n
    join public.documents d on d.id = n.document_id
    join public.units u on u.id = n.unit_id
    left join public.persons p on p.id = n.uploaded_by_person_id
   where n.association_id = p_association_id
     and n.seen_at is null
     and d.deleted_at is null
     and public.is_board(p_association_id)
   order by n.created_at desc
   limit 50
$$;

revoke all on function public.list_owner_document_notices(uuid) from public, anon;
grant execute on function public.list_owner_document_notices(uuid) to authenticated;

-- Mark notices seen: the ones listed, or all of them when p_notice_ids is null. Board only.
create or replace function public.mark_owner_document_notices_seen(p_association_id uuid, p_notice_ids uuid[] default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if not public.is_board(p_association_id) then
    raise exception 'only the board can do that' using errcode = '42501';
  end if;
  update public.owner_document_notices n
     set seen_at = now(), seen_by = auth.uid()
   where n.association_id = p_association_id
     and n.seen_at is null
     and (p_notice_ids is null or n.id = any (p_notice_ids));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.mark_owner_document_notices_seen(uuid, uuid[]) from public, anon;
grant execute on function public.mark_owner_document_notices_seen(uuid, uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- B1. The switch
-- ----------------------------------------------------------------------------

alter table public.associations
  add column owner_finances_enabled boolean not null default false;

comment on column public.associations.owner_finances_enabled is
  'When true, every member can open the Finances page (owner_finances_summary). Off by default; a board admin switches it with set_owner_finances_enabled().';

create or replace function public.set_owner_finances_enabled(p_association_id uuid, p_enabled boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_enabled is null
     or not public.has_role_in(p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board admin can change this' using errcode = '42501';
  end if;
  update public.associations set owner_finances_enabled = p_enabled where id = p_association_id;
end $$;

revoke all on function public.set_owner_finances_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_owner_finances_enabled(uuid, boolean) to authenticated;

-- Whether the Finances page is on, for the sidebar and the page. False for a non-member, so it says nothing
-- about a building the caller is not in.
create or replace function public.owner_finances_enabled(p_association_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select a.owner_finances_enabled
      from public.associations a
     where a.id = p_association_id
       and public.is_member(a.id)
  ), false)
$$;

revoke all on function public.owner_finances_enabled(uuid) from public, anon;
grant execute on function public.owner_finances_enabled(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- B2. The summary
-- ----------------------------------------------------------------------------

-- Income and expenses over one stretch of dates, from the posted ledger. Internal.
create or replace function public.owner_finances_period(p_association_id uuid, p_label text, p_start date, p_end date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'label', p_label,
    'starts_on', p_start,
    'ends_on', p_end,
    'has_activity', count(*) > 0,
    'income', coalesce(sum(l.amount) filter (where l.account_type = 'income'), 0)::numeric(14,2)::text,
    'expenses', coalesce(sum(l.amount) filter (where l.account_type = 'expense'), 0)::numeric(14,2)::text,
    'net', (coalesce(sum(l.amount) filter (where l.account_type = 'income'), 0)
          - coalesce(sum(l.amount) filter (where l.account_type = 'expense'), 0))::numeric(14,2)::text
  )
    from public.income_statement_lines l
   where l.association_id = p_association_id
     and l.entry_date between p_start and p_end
$$;

revoke all on function public.owner_finances_period(uuid, text, date, date) from public, anon, authenticated;

-- The figures as of a day. Internal: no access check, so only the wrapper below (and tests, as the owner of the
-- database) can call it.
create or replace function public.owner_finances_core(p_association_id uuid, p_as_of date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cur       public.fiscal_years%rowtype;
  v_last      public.fiscal_years%rowtype;
  v_has_cur   boolean;
  v_has_last  boolean;
  v_budget    uuid;
  v_ytd       jsonb;
  v_prev      jsonb;
  v_cash      jsonb;
  v_budget_js jsonb;
  v_through   date;
begin
  select * into v_cur
    from public.fiscal_years fy
   where fy.association_id = p_association_id and fy.starts_on <= p_as_of and fy.ends_on >= p_as_of
   order by fy.starts_on desc
   limit 1;
  v_has_cur := found;

  select * into v_last
    from public.fiscal_years fy
   where fy.association_id = p_association_id and fy.ends_on < p_as_of
   order by fy.ends_on desc
   limit 1;
  v_has_last := found;

  if v_has_cur then
    v_ytd := public.owner_finances_period(p_association_id, v_cur.label, v_cur.starts_on, least(v_cur.ends_on, p_as_of));
  end if;
  if v_has_last then
    v_prev := public.owner_finances_period(p_association_id, v_last.label, v_last.starts_on, v_last.ends_on);
  end if;

  select max(je.entry_date) into v_through
    from public.journal_entries je
   where je.association_id = p_association_id and je.is_posted and je.entry_date <= p_as_of;

  -- Cash on hand according to the books, by kind of fund. The reserve is shown only when a reserve fund exists.
  select jsonb_build_object(
           'as_of', p_as_of,
           'has_data', count(*) > 0,
           'has_reserve_fund', exists (
             select 1 from public.funds rf where rf.association_id = p_association_id and rf.kind = 'reserve'),
           'operating', coalesce(sum(jl.debit - jl.credit) filter (where f.kind <> 'reserve'), 0)::numeric(14,2)::text,
           'reserve', coalesce(sum(jl.debit - jl.credit) filter (where f.kind = 'reserve'), 0)::numeric(14,2)::text)
    into v_cash
    from public.journal_lines jl
    join public.journal_entries je on je.id = jl.journal_entry_id
    join public.accounts a on a.id = jl.account_id
    join public.funds f on f.id = jl.fund_id
   where jl.association_id = p_association_id
     and je.is_posted
     and a.is_cash_account
     and je.entry_date <= p_as_of;

  -- The budget for the current fiscal year, operating funds only (the reserve is not budgeted line by line).
  if v_has_cur then
    select b.id into v_budget
      from public.budgets b
     where b.association_id = p_association_id and b.fiscal_year_id = v_cur.id;
  end if;

  if v_budget is not null then
    with bl as (
      select a.id as account_id, a.name, a.type::text as type, sum(l.amount) as budget
        from public.budget_lines l
        join public.accounts a on a.id = l.account_id
        join public.funds f on f.id = l.fund_id
       where l.budget_id = v_budget
         and f.kind <> 'reserve'
         and a.type in ('income', 'expense')
       group by a.id, a.name, a.type
    ),
    act as (
      select s.account_id, sum(s.amount) as actual
        from public.income_statement_lines s
        join public.funds f on f.id = s.fund_id
       where s.association_id = p_association_id
         and f.kind <> 'reserve'
         and s.entry_date between v_cur.starts_on and p_as_of
       group by s.account_id
    ),
    joined as (
      select bl.name, bl.type, bl.budget, coalesce(act.actual, 0) as actual
        from bl left join act on act.account_id = bl.account_id
    )
    select case when count(*) = 0 then null else jsonb_build_object(
             'fiscal_year', v_cur.label,
             'days_elapsed', least(p_as_of - v_cur.starts_on + 1, v_cur.ends_on - v_cur.starts_on + 1),
             'days_total', v_cur.ends_on - v_cur.starts_on + 1,
             'income_budget', coalesce(sum(budget) filter (where type = 'income'), 0)::numeric(14,2)::text,
             'income_actual', coalesce(sum(actual) filter (where type = 'income'), 0)::numeric(14,2)::text,
             'expense_budget', coalesce(sum(budget) filter (where type = 'expense'), 0)::numeric(14,2)::text,
             'expense_actual', coalesce(sum(actual) filter (where type = 'expense'), 0)::numeric(14,2)::text,
             'lines', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'name', j.name, 'type', j.type,
                        'budget', j.budget::numeric(14,2)::text, 'actual', j.actual::numeric(14,2)::text)
                      order by j.budget desc, j.name)
                 from (select * from joined order by budget desc, name limit 40) j), '[]'::jsonb))
           end
      into v_budget_js
      from joined;
  end if;

  return jsonb_build_object(
    'as_of', p_as_of,
    'posted_through', v_through,
    'year_to_date', v_ytd,
    'last_year', v_prev,
    'cash', v_cash,
    'budget', v_budget_js
  );
end $$;

revoke all on function public.owner_finances_core(uuid, date) from public, anon, authenticated;

-- What the Finances page reads. Null when the page is off or the caller is not a member of the building;
-- the page tells those apart with owner_finances_enabled().
create or replace function public.owner_finances_summary(p_association_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.owner_finances_enabled(p_association_id) then
    return null;
  end if;
  return public.owner_finances_core(p_association_id, current_date);
end $$;

revoke all on function public.owner_finances_summary(uuid) from public, anon;
grant execute on function public.owner_finances_summary(uuid) to authenticated;

comment on function public.owner_finances_summary(uuid) is
  'Summary figures for the owner Finances page: income and expenses (last full fiscal year, year to date), cash and reserve, budget against spending. Money as text. Null unless the board admin switched the page on and the caller is a member.';
