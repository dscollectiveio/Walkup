-- 0081: three changes the product owner approved after the access audit (docs/specs/access-audit-2026-10-20.md,
-- DECISIONS #49). NOT yet applied anywhere.
--
--   A. The accountant can add documents, in five accounting categories only, and remove their own for 30 days.
--        * Document writes were board only (documents insert and update policies, the storage write policy).
--          Those policies are NOT touched. The accountant gets three narrow storage policies for their own
--          uploads under the association path, one SECURITY DEFINER function to register an upload
--          (register_accountant_document) and one to remove their own (remove_accountant_upload).
--        * Categories: tax_form, financial_statement, bank_statement, invoice, receipt. Never pinned to a unit,
--          always board_only, always filed as a person's choice (tag_source 'manual').
--        * No update path at all: the accountant cannot rename, refile, change visibility, bin anyone else's
--          document, or have a file read again. Reading by the AI needs a board member (claim_ai_call is board
--          only), so these are stored 'skipped' and a board member can press "Read it again".
--        * Reading them already works: accountant_document_category (0074) covers all five.
--
--   B. Board members and admins adding a document for any unit needs no database change: 0079's
--      unit_document_association_id() and register_unit_document() already accept any unit for the board.
--
--   C. A property manager no longer reads the vendors table. It carries each contractor's tax identity
--      (entity_type, tin_last4, w9_on_file, w9_received_on, is_1099_exempt). vendors_select becomes
--      can_read_financials only (board and accountant), and a manager reads contractors through
--      vendors_manager, a definer view with every column except those five. The two invoker functions that
--      look a contractor up for a manager (request_ticket_quotes, set_ticket_plan) are pointed at the view.

-- ----------------------------------------------------------------------------
-- A1. Which categories, and which path
-- ----------------------------------------------------------------------------

-- The five categories an accountant may add to. Mirrored by ACCOUNTANT_UPLOAD_CATEGORIES in
-- src/lib/documents/accountant-uploads.ts; tests/unit checks the two agree.
create or replace function public.accountant_upload_category(p_slug text)
returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_slug in ('tax_form', 'financial_statement', 'bank_statement', 'invoice', 'receipt'), false)
$$;

revoke all on function public.accountant_upload_category(text) from public, anon;
grant execute on function public.accountant_upload_category(text) to authenticated;

-- The association of a hub document path (<association>/<file>) when the caller holds an active accountant
-- grant there (aal2, through has_role_in); null for anything else. Ticket photo and unit paths are not hub
-- paths, so they never match.
create or replace function public.accountant_upload_association_id(p_name text)
returns uuid
language sql stable security definer set search_path = '' as $$
  select k.association_id
    from public.storage_path_kind(p_name) k
   where k.kind = 'document'
     and public.has_role_in(k.association_id, array['accountant']::public.app_role[])
$$;

revoke all on function public.accountant_upload_association_id(text) from public, anon;
grant execute on function public.accountant_upload_association_id(text) to authenticated;

-- Unregistered hub-path objects the caller uploaded in this building in the last day (0 where there is no
-- storage schema, as under PGlite). A rate limit like unit_document_pending_count(), not a bound on storage.
create or replace function public.accountant_upload_pending_count(p_association_id uuid)
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
        and o.name not like $3
        and not exists (select 1 from public.documents d where d.storage_path = o.name)'
    into v_count
    using auth.uid()::text, p_association_id::text || '/%', p_association_id::text || '/%/%';
  return coalesce(v_count, 0);
end $$;

revoke all on function public.accountant_upload_pending_count(uuid) from public, anon;
grant execute on function public.accountant_upload_pending_count(uuid) to authenticated;

-- May the caller upload this path? A well-formed hub path in a building where they are the accountant, with no
-- documents row at it yet, and fewer than 30 unregistered uploads in the last day.
create or replace function public.accountant_upload_allowed(p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.accountant_upload_association_id(p_name) is not null
     and not exists (select 1 from public.documents d where d.storage_path = p_name)
     and public.accountant_upload_pending_count(public.accountant_upload_association_id(p_name)) < 30
$$;

revoke all on function public.accountant_upload_allowed(text) from public, anon;
grant execute on function public.accountant_upload_allowed(text) to authenticated;

-- May the caller read or delete this object while it has no documents row? The storage policies add
-- owner_id = the caller, so only the uploader ever matches.
create or replace function public.accountant_upload_pending_allowed(p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.accountant_upload_association_id(p_name) is not null
     and not exists (select 1 from public.documents d where d.storage_path = p_name)
$$;

revoke all on function public.accountant_upload_pending_allowed(text) from public, anon;
grant execute on function public.accountant_upload_pending_allowed(text) to authenticated;

-- ----------------------------------------------------------------------------
-- A2. Storage policies (Supabase only; PGlite has no storage schema)
-- ----------------------------------------------------------------------------
-- Added next to the board's (0019, 0051): policies are permissive, so nothing the board can do changes.

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'no storage schema, skipping 0081 storage policies (expected under PGlite)';
    return;
  end if;

  drop policy if exists documents_write_accountant       on storage.objects;
  drop policy if exists documents_read_pending_accountant   on storage.objects;
  drop policy if exists documents_delete_pending_accountant on storage.objects;

  create policy documents_write_accountant on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'documents'
      and public.accountant_upload_allowed(name)
    );

  -- Lets the upload action read the caller's own just-uploaded object back to check its bytes before the row
  -- exists. Uploader only, one day.
  create policy documents_read_pending_accountant on storage.objects
    for select to authenticated
    using (
      bucket_id = 'documents'
      and owner_id = (select auth.uid())::text
      and created_at > now() - interval '1 day'
      and public.accountant_upload_pending_allowed(name)
    );

  -- Lets the upload action throw away a rejected or duplicate upload that was never registered.
  create policy documents_delete_pending_accountant on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'documents'
      and owner_id = (select auth.uid())::text
      and public.accountant_upload_pending_allowed(name)
    );
end $$;

-- ----------------------------------------------------------------------------
-- A3. Register an upload
-- ----------------------------------------------------------------------------

-- Result: document_id, duplicate
--   (new id, false)   added
--   (id, false)       a retried registration of the same path
--   (id, true)        the identical file is already filed in a category the accountant reads
--   (null, true)      the identical file is stored somewhere the accountant does not read; nothing is linked
--                     and nothing about the other document is returned
create or replace function public.register_accountant_document(
  p_storage_path  text,
  p_filename      text,
  p_mime_type     text,
  p_byte_size     bigint,
  p_checksum      text,
  p_category_slug text,
  p_title         text default null
)
returns table (document_id uuid, duplicate boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_assoc    uuid;
  v_category uuid;
  v_existing record;
  v_doc      uuid;
  v_stored   boolean;
  v_count    integer;
begin
  select k.association_id into v_assoc
    from public.storage_path_kind(p_storage_path) k
   where k.kind = 'document';
  if v_assoc is null then
    raise exception 'that upload doesn''t belong here' using errcode = '22023';
  end if;
  if not public.has_role_in(v_assoc, array['accountant']::public.app_role[]) then
    raise exception 'you can''t add documents here' using errcode = '42501';
  end if;

  if not public.accountant_upload_category(p_category_slug) then
    raise exception 'choose a category for this document' using errcode = '22023', hint = 'category';
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
   where c.association_id = v_assoc and c.slug = p_category_slug;
  if v_category is null then
    raise exception 'that category is missing' using errcode = 'P0001';
  end if;

  -- One registration at a time per building for accountant uploads, so the counts and the duplicate check
  -- below cannot race.
  perform pg_advisory_xact_lock(hashtextextended('accountant_documents:' || v_assoc::text, 0));

  -- A retried registration of this very path (the response was lost on the way back). Only the uploader.
  select d.id, d.uploaded_by into v_existing
    from public.documents d
   where d.association_id = v_assoc and d.storage_path = p_storage_path;
  if found then
    if v_existing.uploaded_by is distinct from auth.uid() then
      raise exception 'that upload doesn''t belong here' using errcode = '22023';
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

  -- 20 a day per person, so one account cannot fill the building's storage.
  select count(*) into v_count
    from public.documents d
   where d.association_id = v_assoc
     and d.uploaded_by = auth.uid()
     and d.uploaded_at > now() - interval '1 day';
  if v_count >= 20 then
    raise exception 'you have added 20 documents today' using errcode = 'P0001', hint = 'daily_limit';
  end if;

  -- Identical bytes are one document (documents_checksum_key, 0020).
  select d.id, d.category_id into v_existing
    from public.documents d
   where d.association_id = v_assoc and d.checksum = p_checksum and d.deleted_at is null;
  if found then
    if public.accountant_document_category(v_existing.category_id) then
      return query select v_existing.id, true;
    else
      return query select null::uuid, true;
    end if;
    return;
  end if;

  begin
    insert into public.documents (
      association_id, storage_path, filename, title, mime_type, byte_size, checksum,
      category_id, tag_source, review_state, visibility, restricted_to_unit_id,
      source, extraction_state, extraction_error, uploaded_by
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
      'board_only',
      null,
      'upload',
      'skipped',
      'Added by the accountant. A board member can have it read.',
      auth.uid()
    )
    returning id into v_doc;
  exception when unique_violation then
    return query select null::uuid, true;
    return;
  end;

  return query select v_doc, false;
end $$;

revoke all on function public.register_accountant_document(text, text, text, bigint, text, text, text) from public, anon;
grant execute on function public.register_accountant_document(text, text, text, bigint, text, text, text) to authenticated;

comment on function public.register_accountant_document(text, text, text, bigint, text, text, text) is
  'Register a file the accountant uploaded under the association path. Only tax_form, financial_statement, bank_statement, invoice and receipt; board_only, never pinned to a unit, never read by the AI at upload. Same checksum, duplicate, size, type and stored-object checks as register_unit_document.';

-- ----------------------------------------------------------------------------
-- A4. Remove your own upload
-- ----------------------------------------------------------------------------

-- A soft delete, like binning it in the hub (the board still sees it there). Only the accountant who uploaded
-- it, only while they still hold the role, only in the five categories, only unpinned, for 30 days.
create or replace function public.remove_accountant_upload(p_document_id uuid)
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
  if v_doc.deleted_at is not null
     or v_doc.uploaded_by is distinct from auth.uid()
     or v_doc.restricted_to_unit_id is not null
     or not public.accountant_upload_category(v_slug)
     or not public.has_role_in(v_doc.association_id, array['accountant']::public.app_role[]) then
    raise exception 'you can''t remove this document' using errcode = '42501';
  end if;
  if v_doc.uploaded_at <= now() - interval '30 days' then
    raise exception 'you can only remove a document within 30 days of adding it'
      using errcode = '42501', hint = 'window_closed';
  end if;

  update public.documents set deleted_at = now() where id = v_doc.id;
end $$;

revoke all on function public.remove_accountant_upload(uuid) from public, anon;
grant execute on function public.remove_accountant_upload(uuid) to authenticated;

comment on function public.remove_accountant_upload(uuid) is
  'The accountant removes (soft deletes) a document they uploaded themselves in one of the five accounting categories, within 30 days. Nothing else.';

-- ----------------------------------------------------------------------------
-- C1. Contractors without their tax identity
-- ----------------------------------------------------------------------------

-- Every vendors column except entity_type, tin_last4, w9_on_file, w9_received_on and is_1099_exempt. A definer
-- view (not security_invoker) that applies its own check: the board, the accountant and a property manager.
-- security_barrier keeps a caller's own predicates from running before that check. Column list is explicit on
-- purpose, so a column added to vendors later is NOT readable by a manager until someone adds it here.
create or replace view public.vendors_manager with (security_barrier = true) as
  select v.id, v.association_id, v.name, v.address, v.email, v.created_at,
         v.trade, v.phone, v.contact_name, v.notes, v.is_preferred, v.last_used_on, v.insured_until, v.license_number,
         v.trades, v.website_url, v.status, v.do_not_use_reason, v.board_rating, v.license_expires_on,
         v.source, v.google_place_id, v.google_rating, v.google_review_count, v.google_fetched_at, v.created_by,
         v.archived_at, v.archived_reason, v.emergency_service, v.job_tags, v.source_urls, v.google_business_status,
         v.rate_hourly, v.rate_trip_fee, v.rate_after_hours, v.rates_as_of, v.payment_methods,
         v.other_contact_name, v.other_contact_role, v.other_contact_phone, v.other_contact_email, v.updated_at
    from public.vendors v
   where public.can_read_financials(v.association_id) or public.can_manage_repairs(v.association_id);

revoke all on public.vendors_manager from public, anon;
grant select on public.vendors_manager to authenticated;
-- Supabase's default privileges can leave write rights on a new view for the signed-in role; a simple view is
-- writable as its owner, past row security. This one is read only.
revoke insert, update, delete, truncate, references, trigger on public.vendors_manager from public, anon, authenticated;

comment on view public.vendors_manager is
  'Contractors as a property manager reads them: every column of vendors except entity_type, tin_last4, w9_on_file, w9_received_on and is_1099_exempt. Board and accountant read the table itself.';

-- The table is for the people who file the 1099s.
drop policy if exists vendors_select on public.vendors;
create policy vendors_select on public.vendors
  for select to authenticated
  using (public.can_read_financials(association_id));

-- The two invoker functions that look a contractor up for a manager. Same technique as 0080: the function in
-- force, with one piece of text swapped, and the migration stops if the text is gone.
do $$
declare
  r     record;
  v_def text;
begin
  for r in
    select * from (values
      ('public.request_ticket_quotes(uuid, jsonb)', 'select 1 from public.vendors v', 'select 1 from public.vendors_manager v'),
      ('public.set_ticket_plan(uuid, jsonb)',       'select 1 from public.vendors x', 'select 1 from public.vendors_manager x')
    ) as t(sig, from_text, to_text)
  loop
    v_def := pg_get_functiondef(r.sig::regprocedure);
    if position(r.from_text in v_def) = 0 then
      raise exception '0081: % no longer contains the text this migration replaces: %', r.sig, r.from_text;
    end if;
    execute replace(v_def, r.from_text, r.to_text);
  end loop;
end $$;
