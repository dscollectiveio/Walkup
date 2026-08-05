-- ============================================================================
-- Walkup — migration 0020: the document hub
--
-- Turns the flat upload list into a filing system: one category per document,
-- free labels, optional folders, saved views, versions, soft delete, and a
-- visibility model that finally lets an owner read the declaration.
--
-- Four decisions worth stating before the DDL, because they are the ones a
-- reader will otherwise have to reverse-engineer.
--
-- CATEGORIES ARE A TABLE, NOT AN ENUM. Default visibility per category has to
-- be editable per association, and an enum cannot carry that. It also means
-- adding "Reserve Study" later is an INSERT rather than a migration.
--
-- VISIBILITY IS THREE RULES, NOT A FLAG. Board and accountant see everything.
-- A document pinned to a unit is visible to that unit's owner and nobody
-- else's — that is what makes a delinquency notice safe to store here. Only an
-- unpinned document marked all_owners is visible to every member. The default
-- is board_only, so a new column added later cannot accidentally widen access.
--
-- THE STORAGE POLICY NOW DEFERS TO THE TABLE. 0019 duplicated the table's
-- predicate onto storage.objects, which was correct only while both said
-- can_read_financials. The moment owners can read a governing document, two
-- copies of one rule drift and the download 403s while the row renders. The
-- read policy below asks `does a documents row I can see point at this
-- object?` — the subquery runs under the caller's own RLS, so there is exactly
-- one place visibility is decided and storage cannot fall out of step.
--
-- SOFT DELETE IS AN UPDATE, PURGE IS A DELETE. That maps onto the policies
-- 0002 already wrote: is_board can UPDATE (so board_member can bin something),
-- board_admin alone can DELETE (so only they can destroy it). Board and
-- accountant keep reading binned rows — that is the trash view. Owners never
-- see them. No new policy needed for either.
-- ============================================================================

-- ============================================================================
-- CATEGORIES
-- ============================================================================

create table public.document_categories (
  id                 uuid primary key default gen_random_uuid(),
  association_id     uuid not null references public.associations(id) on delete restrict,
  slug               text not null,
  label              text not null,
  -- Governing documents and minutes are what an owner is entitled to read;
  -- everything financial or correspondence-shaped stays with the board.
  default_visibility text not null default 'board_only'
                       check (default_visibility in ('board_only', 'all_owners')),
  sort_order         smallint not null default 0,
  -- The seeded sixteen. A board may rename or re-point these but not delete
  -- them, because documents already filed under one would be orphaned.
  is_system          boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (association_id, slug)
);

-- The seed set, defined once. Both the backfill below and the trigger that
-- catches future associations read it, so the two can never drift.
--
-- Plain SQL and IMMUTABLE rather than SECURITY DEFINER: it returns a constant
-- list and touches no table, so there is nothing for a definer to protect. It
-- has to be executable by `authenticated` because the trigger body calls it,
-- and a call from inside a trigger is an ordinary privilege-checked call —
-- the lesson from 0007/0012 and DECISIONS #21.
create or replace function public.document_category_defaults()
returns table (slug text, label text, default_visibility text, sort_order smallint)
language sql immutable
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
    ('other',                     'Other',                       'board_only',       160)
$$;

revoke all on function public.document_category_defaults() from public, anon;
grant execute on function public.document_category_defaults() to authenticated;

-- An association without categories cannot file anything, so this is not
-- optional setup a caller might forget — it belongs to creating the
-- association. A trigger rather than an RPC for the same reason uploaded_by
-- became a default in 0019.
create or replace function public.tg_seed_document_categories()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.document_categories
    (association_id, slug, label, default_visibility, sort_order, is_system)
  select new.id, d.slug, d.label, d.default_visibility, d.sort_order, true
    from public.document_category_defaults() d
  on conflict (association_id, slug) do nothing;
  return new;
end $$;

revoke all on function public.tg_seed_document_categories() from public, anon, authenticated;

create trigger associations_seed_document_categories
  after insert on public.associations
  for each row execute function public.tg_seed_document_categories();

-- Associations that already exist predate the trigger.
insert into public.document_categories
  (association_id, slug, label, default_visibility, sort_order, is_system)
select a.id, d.slug, d.label, d.default_visibility, d.sort_order, true
  from public.associations a
 cross join public.document_category_defaults() d
on conflict (association_id, slug) do nothing;

-- ============================================================================
-- FOLDERS
-- ============================================================================

create table public.folders (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  name           text not null check (length(trim(name)) > 0),
  parent_id      uuid references public.folders(id) on delete restrict,
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now()
);

-- Two folders called "2025" under different parents are fine; two under the
-- same parent are not. A plain unique constraint would allow duplicate roots,
-- because Postgres treats NULL parents as distinct from each other — so roots
-- collapse onto a fixed sentinel instead. Coalescing to `id` would not work:
-- every root would get its own value and duplicate roots would slip through.
create unique index folders_sibling_name_key
  on public.folders (
    association_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name));

create index folders_association_parent_idx on public.folders (association_id, parent_id);

-- SECURITY DEFINER because it walks the folder table, and a walk under RLS
-- means something different for each caller (DECISIONS #23). A cycle cannot
-- spin forever: it trips the depth cap and raises.
create or replace function public.tg_folder_depth()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_depth  integer := 1;
  v_parent uuid := new.parent_id;
begin
  while v_parent is not null loop
    v_depth := v_depth + 1;
    if v_depth > 3 then
      raise exception 'folders nest three deep at most'
        using errcode = 'check_violation';
    end if;
    select parent_id into v_parent from public.folders where id = v_parent;
  end loop;
  return new;
end $$;

revoke all on function public.tg_folder_depth() from public, anon, authenticated;

create trigger folders_depth_capped
  before insert or update of parent_id on public.folders
  for each row execute function public.tg_folder_depth();

-- ============================================================================
-- SAVED VIEWS AND AUTO-FILE RULES
-- ============================================================================

create table public.saved_views (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references public.associations(id) on delete restrict,
  name            text not null check (length(trim(name)) > 0),
  -- A stored filter, not a stored result set. Shape is the same object the
  -- list page builds from its own controls.
  filter          jsonb not null,
  owner_person_id uuid not null references public.persons(id) on delete restrict,
  is_shared       boolean not null default false,
  created_at      timestamptz not null default now()
);

create index saved_views_association_idx on public.saved_views (association_id);

create table public.tag_rules (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references public.associations(id) on delete restrict,
  match_type      text not null
                    check (match_type in ('sender_email', 'filename_pattern', 'text_contains')),
  match_value     text not null check (length(trim(match_value)) > 0),
  set_category_id uuid references public.document_categories(id) on delete restrict,
  set_folder_id   uuid references public.folders(id) on delete set null,
  set_links       jsonb,
  created_by      uuid references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now()
);

create index tag_rules_association_idx on public.tag_rules (association_id);

-- ============================================================================
-- DOCUMENTS
-- ============================================================================

alter table public.documents
  add column title              text,
  add column checksum           text,
  add column category_id        uuid references public.document_categories(id) on delete restrict,
  add column tag_source         text check (tag_source in ('auto', 'manual')),
  -- 0-1. numeric(6,4) rather than (4,3) because the money-scale invariant in
  -- migrations.test.ts allows only a fixed set of scales, and this is the one
  -- meant for rates.
  add column tag_confidence     numeric(6,4)
                                  check (tag_confidence is null
                                         or (tag_confidence >= 0 and tag_confidence <= 1)),
  add column review_state       text not null default 'ok'
                                  check (review_state in ('ok', 'needs_review')),
  add column labels             text[] not null default '{}',
  add column folder_id          uuid references public.folders(id) on delete set null,
  add column visibility         text not null default 'board_only'
                                  check (visibility in ('board_only', 'all_owners')),
  add column restricted_to_unit_id uuid references public.units(id) on delete restrict,
  add column extracted_text     text,
  add column extraction         jsonb,
  add column source             text not null default 'upload'
                                  check (source in ('upload', 'email', 'scan', 'import', 'request')),
  -- Extraction runs after the response is sent, so its progress has to live on
  -- the row: a job that dies silently is otherwise indistinguishable from one
  -- that never started, and nobody can re-run what nobody can see.
  add column extraction_state   text not null default 'pending'
                                  check (extraction_state in
                                         ('pending', 'running', 'done', 'failed', 'skipped')),
  add column extraction_error   text,
  add column extraction_attempts smallint not null default 0,
  add column version_group_id   uuid not null default gen_random_uuid(),
  add column version_number     smallint not null default 1 check (version_number > 0),
  add column is_current_version boolean not null default true,
  add column deleted_at         timestamptz;

-- A title always exists so the list never has to fall back mid-render, and a
-- rename never has to worry about clearing it.
create or replace function public.tg_document_title()
returns trigger
language plpgsql
as $$
begin
  new.title := coalesce(nullif(trim(new.title), ''), new.filename);
  return new;
end $$;

revoke all on function public.tg_document_title() from public, anon, authenticated;

create trigger documents_title_defaulted
  before insert or update on public.documents
  for each row execute function public.tg_document_title();

-- Identical bytes are the same document, not a new version of one. Scoped to
-- live rows so binning a file does not block re-uploading it later.
create unique index documents_checksum_key
  on public.documents (association_id, checksum)
  where checksum is not null and deleted_at is null;

-- The storage read policy joins on this.
create index documents_storage_path_idx on public.documents (storage_path);

create index documents_category_idx
  on public.documents (association_id, category_id)
  where deleted_at is null;

create index documents_review_idx
  on public.documents (association_id, uploaded_at)
  where review_state = 'needs_review' and deleted_at is null;

create index documents_version_group_idx
  on public.documents (version_group_id, version_number desc);

-- Full-text over the extracted text, the title and the original filename. A
-- filename-only search is the thing every shared folder already does badly.
create index documents_fts_idx on public.documents
  using gin (to_tsvector('english',
    coalesce(title, '') || ' ' || coalesce(filename, '') || ' ' || coalesce(extracted_text, '')));

-- Backfill: everything already uploaded is board-only and unreviewed, which is
-- what it effectively was. Category is left null — "Unfiled" is honest, and
-- guessing retroactively would be inventing a fact.
update public.documents
   set tag_source       = 'manual',
       extraction_state = 'skipped'
 where tag_source is null;

-- ============================================================================
-- DOCUMENT LINKS
-- ============================================================================

-- target_table has been free text since 0001 and every row written so far says
-- 'associations'. Constraining it now, while the polymorphic half is still
-- unused, costs nothing; doing it after the hub starts writing links would
-- mean a data migration.
--
-- No meetings table exists, so the brief's "meeting" link has nowhere to point
-- and is deliberately absent. Due dates are computed at render time (0017),
-- not stored, so they cannot be linked either.
alter table public.document_links
  add constraint document_links_target_table_known
  check (target_table in (
    'associations', 'units', 'persons', 'vendors',
    'journal_entries', 'expenses', 'assessment_charges', 'payments',
    'insurance_policies', 'tickets', 'recurring_bills', 'fiscal_years'
  ));

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.document_categories enable row level security;
alter table public.folders             enable row level security;
alter table public.saved_views         enable row level security;
alter table public.tag_rules           enable row level security;

-- Categories are labels on things an owner can already see, so every member
-- reads them. Editing them is a settings change: board_admin.
create policy document_categories_select on public.document_categories
  for select to authenticated
  using (public.is_member(association_id));

create policy document_categories_insert on public.document_categories
  for insert to authenticated
  with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create policy document_categories_update on public.document_categories
  for update to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]))
  with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

-- Deleting a system category would orphan every document filed under it.
create policy document_categories_delete on public.document_categories
  for delete to authenticated
  using (
    not is_system
    and public.has_role_in(association_id, array['board_admin']::public.app_role[])
  );

-- Folders are a board-side filing overlay. An owner reads documents by
-- category, never by folder, so there is nothing here for them.
create policy folders_select on public.folders
  for select to authenticated
  using (public.can_read_financials(association_id));

create policy folders_insert on public.folders
  for insert to authenticated
  with check (public.is_board(association_id));

create policy folders_update on public.folders
  for update to authenticated
  using (public.is_board(association_id))
  with check (public.is_board(association_id));

create policy folders_delete on public.folders
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

-- A saved view is personal unless its author shares it.
create policy saved_views_select on public.saved_views
  for select to authenticated
  using (
    owner_person_id = public.current_person_id(association_id)
    or (is_shared and public.can_read_financials(association_id))
  );

create policy saved_views_insert on public.saved_views
  for insert to authenticated
  with check (
    public.can_read_financials(association_id)
    and owner_person_id = public.current_person_id(association_id)
  );

create policy saved_views_update on public.saved_views
  for update to authenticated
  using (owner_person_id = public.current_person_id(association_id))
  with check (owner_person_id = public.current_person_id(association_id));

create policy saved_views_delete on public.saved_views
  for delete to authenticated
  using (owner_person_id = public.current_person_id(association_id));

-- Auto-filing rules decide where other people's documents land. Board_admin.
create policy tag_rules_select on public.tag_rules
  for select to authenticated
  using (public.can_read_financials(association_id));

create policy tag_rules_insert on public.tag_rules
  for insert to authenticated
  with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create policy tag_rules_update on public.tag_rules
  for update to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]))
  with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create policy tag_rules_delete on public.tag_rules
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

-- ----------------------------------------------------------------------------
-- The one that matters: who can read a document.
-- ----------------------------------------------------------------------------
--
-- Replaces the 0002 loop policy, which said can_read_financials and nothing
-- else — so no owner could read the declaration of the building they own part
-- of. Three rules, in order:
--
--   board and accountant   see everything, binned rows included (the trash)
--   a unit-pinned document its unit's owner, and no other owner
--   an unpinned all_owners any member
--
-- Pinning is checked through owned_unit_ids, not through units: an owner can
-- read the units table, so gating on it would leak by existence (DECISIONS #17).
drop policy if exists documents_select on public.documents;

create policy documents_select on public.documents
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or (
      deleted_at is null
      and (
        (
          restricted_to_unit_id is not null
          and restricted_to_unit_id in (select public.owned_unit_ids(association_id))
        )
        or (
          restricted_to_unit_id is null
          and visibility = 'all_owners'
          and public.is_member(association_id)
        )
      )
    )
  );

-- ----------------------------------------------------------------------------
-- Storage, deferring to the table above.
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'no storage schema — skipping storage policy (expected under PGlite)';
    return;
  end if;

  -- The subquery runs under the caller's own RLS, so "can I download this
  -- file" and "can I see this document" are answered by one policy instead of
  -- two that have to be kept in agreement by hand.
  drop policy if exists documents_read on storage.objects;

  create policy documents_read on storage.objects
    for select to authenticated
    using (
      bucket_id = 'documents'
      and exists (
        select 1 from public.documents d
         where d.storage_path = storage.objects.name
      )
    );
end $$;
