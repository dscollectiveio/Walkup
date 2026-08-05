-- ============================================================================
-- Walkup — migration 0019: document storage, in version control
--
-- Three gaps in the existing document feature, none of them visible from the
-- repo alone.
--
-- 1. THE BUCKET WAS NEVER A MIGRATION. The `documents` bucket and its three
--    storage.objects policies were created by hand in the Supabase dashboard.
--    They are correct — private, capped at 25 MB, restricted to a MIME
--    allowlist, and the policies mirror the table policies in 0002 exactly.
--    But nothing in this repo could rebuild them, which is precisely what
--    CLAUDE.md invariant 10 forbids, and src/app/documents/actions.ts carries
--    a comment asserting a tenancy guarantee that no file here could prove.
--
--    Adopted below, idempotently: a no-op against the live project, a faithful
--    rebuild against an empty one.
--
--    Guarded on storage.objects existing, because the test harness is PGlite,
--    which has no storage schema. The guard is what lets one file be both the
--    production source of truth and offline-testable.
--
-- 2. DOCUMENTS WERE NEVER AUDITED. Every other table whose change carries
--    financial or access-control consequence has been audited since 0004 —
--    vendors and insurance_policies included, both lower-stakes than the
--    recorded declaration. A board_admin could hard-delete the declaration and
--    leave no trace whatsoever.
--
-- 3. uploaded_by HAS NEVER BEEN POPULATED. The column has existed since 0001
--    and every row is null. A column default is harder to forget than an
--    assignment in application code — same reasoning as board_tasks.created_by
--    in 0017.
-- ============================================================================

-- ============================================================================
-- 1. STORAGE
-- ============================================================================

do $$
begin
  -- PGlite has no storage schema. Everything in this block is Supabase-only.
  if to_regclass('storage.objects') is null then
    raise notice 'no storage schema — skipping bucket setup (expected under PGlite)';
    return;
  end if;

  -- The bucket. `public = false` is the load-bearing setting: it means there
  -- is no permanent unauthenticated URL for any file, so a leaked path is
  -- worth nothing without a freshly minted signed URL.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'documents', 'documents', false, 26214400,
    array[
      'application/pdf',
      'image/png', 'image/jpeg', 'image/heic',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv'
    ]
  )
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- The object path is `<association_id>/<timestamp>-<filename>`, so the first
  -- path segment IS the tenancy boundary and these three policies are the same
  -- predicates 0002 puts on the `documents` table. They must stay in step: a
  -- reader who can see the row but not the object gets a broken download, and
  -- one who can see the object but not the row bypasses the table entirely.
  drop policy if exists documents_read   on storage.objects;
  drop policy if exists documents_write  on storage.objects;
  drop policy if exists documents_delete on storage.objects;

  create policy documents_read on storage.objects
    for select to authenticated
    using (
      bucket_id = 'documents'
      and public.can_read_financials(((storage.foldername(name))[1])::uuid)
    );

  create policy documents_write on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'documents'
      and public.is_board(((storage.foldername(name))[1])::uuid)
    );

  create policy documents_delete on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'documents'
      and public.has_role_in(
            ((storage.foldername(name))[1])::uuid,
            array['board_admin']::public.app_role[])
    );
end $$;

-- ============================================================================
-- 2. AUDIT
-- ============================================================================

-- A dedicated function rather than the shared tg_audit().
--
-- tg_audit() serializes the whole row into audit_log. Slice 2 adds the
-- extracted text of every document to this table, and auditing that verbatim
-- would make audit_log a second, permanent copy of every document's contents —
-- read-only to board_admin, never deletable, and for a W-9 containing a full
-- Social Security number. DECISIONS #4 keeps full TINs out of this database
-- deliberately; routing them into the append-only log through the back door
-- would undo that without anyone noticing.
--
-- Stripping the two content columns records what changed ABOUT a document
-- without duplicating the document. Removing a jsonb key that does not exist
-- yet is a no-op, so this is already correct before those columns land in 0020.
--
-- One deliberate consequence: when a background extraction writes only
-- extracted_text, before and after are equal after stripping and no row is
-- logged. That is the intent — an extraction is not an access-control event.
-- Anything a person did (retag, move, share, change visibility) touches a
-- different column and is logged normally.
create or replace function public.tg_audit_document()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_assoc  uuid;
  v_record uuid;
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new) - 'extracted_text' - 'extraction';
  elsif tg_op = 'DELETE' then
    v_before := to_jsonb(old) - 'extracted_text' - 'extraction';
  else
    v_before := to_jsonb(old) - 'extracted_text' - 'extraction';
    v_after  := to_jsonb(new) - 'extracted_text' - 'extraction';
    if v_before = v_after then
      return new;
    end if;
  end if;

  v_record := coalesce((v_after->>'id')::uuid, (v_before->>'id')::uuid);
  v_assoc  := coalesce(
    (v_after->>'association_id')::uuid,
    (v_before->>'association_id')::uuid);

  if v_assoc is null then
    raise exception 'document audit trigger on % could not determine association_id',
      tg_table_name;
  end if;

  insert into public.audit_log (
    association_id, actor_user_id, table_name, record_id,
    action, before_data, after_data
  ) values (
    v_assoc, auth.uid(), tg_table_name, v_record,
    lower(tg_op), v_before, v_after
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- Same posture as every other trigger function since 0007: not callable over
-- the API. Revoking EXECUTE does not stop the trigger firing.
revoke all on function public.tg_audit_document() from public, anon, authenticated;

create trigger audit_documents
  after insert or update or delete on public.documents
  for each row execute function public.tg_audit_document();

-- document_links carries no content, so the shared function is right for it.
-- Worth auditing on its own: a link is how a document becomes evidence for a
-- journal entry, and silently removing one changes what a transaction appears
-- to be supported by.
create trigger audit_document_links
  after insert or update or delete on public.document_links
  for each row execute function public.tg_audit();

-- ============================================================================
-- 3. UPLOADER AND INDEX
-- ============================================================================

alter table public.documents
  alter column uploaded_by set default auth.uid();

-- The documents list has always ordered by uploaded_at desc with nothing to
-- serve it but a sequential scan.
create index if not exists documents_association_uploaded_idx
  on public.documents (association_id, uploaded_at desc);
