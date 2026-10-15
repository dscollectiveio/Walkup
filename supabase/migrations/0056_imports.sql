-- ============================================================================
-- Walkup — migration 0056: import from spreadsheets
--
-- Units and owners, past transactions, opening balances and contractors come
-- in through one pipeline: the file is parsed by the application, the rows are
-- STAGED here, validated here, previewed, and committed here in one
-- transaction through the same ledger paths a person uses (post_journal_entry,
-- record_expense, record_assessment_charge, record_ownership_amendment).
--
-- Rules this migration enforces rather than hopes for:
--   * Nothing is categorized by guess. Every category in a file must be mapped
--     to an account by the board; an unmapped row is an error, not a default.
--     New income and expense accounts need an explicit exempt / not exempt
--     answer (import_create_account has no default).
--   * What each unit owed on the cutover date is NOT part of the opening
--     balance entry. It becomes one charge per unit crediting an income
--     account the board picks, because the 1120-H traces a payment through its
--     charge to the income account that charge credited (0006, branch 1). An
--     equity-credited receivable would make those payments vanish from the 60%
--     test. Assessments Receivable (1200, 1250) is refused in the opening entry.
--   * Posted entries are immutable (#9). Undo is a reversal, only while the
--     entries' fiscal years are open.
--   * Re-uploading a file adds nothing: a committed file hash cannot be
--     committed twice, and every row carries a hash that matches against rows
--     already imported.
--   * Staging holds only the columns the board mapped. A column nobody mapped
--     (a Social Security number in a spare column) never reaches the database,
--     and raw values are cleared the moment a batch is committed or cancelled.
--
-- board_admin only, MFA-gated through has_role_in. Money crosses the API as
-- text (#20).
--
-- Differences from the draft in docs/specs/import-spec.md section 3, each one
-- recorded in docs/specs/progress/N1-import.md:
--   * It uses 0055's email_address_ok() for addresses, so it applies after 0055.
--   * Duplicate detection keys come from one function (import_row_key) and
--     occurrence numbers from one window query, so validating 5,000 rows is
--     linear, not quadratic.
--   * The preview digest also covers the association's units, accounts, funds,
--     fiscal years and contractors, so a change to any of them since the
--     preview makes the commit refuse (preview_stale), as section 3.2 says.
--   * Contractor duplicates (in the file or already on file) are marked
--     'duplicate' by the validator, not found out at commit.
--   * A co-owner pair where one is already on file is not an owner conflict,
--     and replacing owners keeps a co-owner who is in the file (section 9.4).
--   * A fund named in a file must be matched to a fund (fund_unmapped); only a
--     blank fund cell takes the default, so nothing is silently filed under it.
--   * Existing units are matched case-insensitively at commit, as at validation.
--   * Undo restores the ownership links that "replace the current owner" closed.
--   * Ownership shares count for every row that stays in the import, including
--     a row already imported earlier, so a re-upload can still set them.
--   * Contractors may carry trade_slug (the shared trade list's slug) beside
--     the trade text; vendors.trades takes the slug.
--   * Undo also treats restrict_violation (23001) as "something depends on it".
--   * import_create_account also stamps the income classification as confirmed
--     by the board (0042), because the board answered it in the dialog.
-- ============================================================================

create table public.import_batches (
  id                 uuid primary key default gen_random_uuid(),
  association_id     uuid not null references public.associations(id) on delete restrict,
  kind               text not null check (kind in ('units_owners', 'transactions', 'opening_accounts', 'opening_units', 'contractors')),
  status             text not null default 'uploaded' check (status in ('uploaded', 'validated', 'committed', 'undone', 'cancelled')),
  filename           text not null check (char_length(filename) between 1 and 200),
  file_sha256        text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  source_document_id uuid references public.documents(id) on delete restrict,
  row_count          integer not null check (row_count between 1 and 5000),
  mapping            jsonb not null default '{}',
  options            jsonb not null default '{}',
  summary            jsonb not null default '{}',
  digest             text,
  created_by         uuid references auth.users(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  committed_at       timestamptz,
  committed_by       uuid references auth.users(id),
  undone_at          timestamptz,
  undone_by          uuid references auth.users(id),
  check ((status in ('committed', 'undone')) = (committed_at is not null)),
  check ((status = 'undone') = (undone_at is not null))
);

-- The same file cannot be committed twice, and there is one opening balance
-- (accounts) and one set of unit balances at a time: undo the first to redo it.
create unique index import_batches_file_once on public.import_batches (association_id, kind, file_sha256)
  where status = 'committed';
create unique index import_batches_opening_once on public.import_batches (association_id, kind)
  where status = 'committed' and kind in ('opening_accounts', 'opening_units');
create index import_batches_assoc_idx on public.import_batches (association_id, created_at desc);
create index import_batches_document_idx on public.import_batches (source_document_id) where source_document_id is not null;

comment on table public.import_batches is
  'One uploaded spreadsheet and what became of it. Written only by the import_* functions (board_admin).';

create table public.import_rows (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  batch_id       uuid not null references public.import_batches(id) on delete cascade,
  row_number     integer not null check (row_number >= 1),
  raw            jsonb,
  mapped         jsonb not null default '{}',
  row_hash       text,
  status         text not null default 'pending' check (status in ('pending', 'ok', 'error', 'duplicate', 'skipped', 'committed', 'undone')),
  errors         jsonb not null default '[]',
  decision       text not null default 'import' check (decision in ('import', 'skip')),
  created_table  text check (created_table is null or created_table in ('journal_entries', 'expenses', 'assessment_charges', 'unit_owners', 'vendors')),
  created_id     uuid,
  -- units_owners only: what this row itself created, so undo removes exactly that.
  created_unit_id     uuid,
  created_person_id   uuid,
  created_schedule_id uuid,
  unique (batch_id, row_number)
);

create index import_rows_hash_idx on public.import_rows (association_id, row_hash) where status = 'committed';
create index import_rows_assoc_idx on public.import_rows (association_id);

comment on table public.import_rows is
  'One spreadsheet row: the mapped columns only (raw), the normalised values (mapped), a hash for duplicate detection, problems found, and what it created. raw is cleared at commit or cancel.';

create or replace function public.tg_import_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'import_batches' then
    if new.source_document_id is not null and not exists (
         select 1 from public.documents d where d.id = new.source_document_id and d.association_id = new.association_id) then
      raise exception 'document belongs to a different association' using errcode = '42501';
    end if;
  else
    if not exists (select 1 from public.import_batches b where b.id = new.batch_id and b.association_id = new.association_id) then
      raise exception 'batch belongs to a different association' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.tg_import_same_association() from public, anon;
grant execute on function public.tg_import_same_association() to authenticated;

create trigger import_batches_same_association before insert or update on public.import_batches
  for each row execute function public.tg_import_same_association();
create trigger import_rows_same_association before insert or update on public.import_rows
  for each row execute function public.tg_import_same_association();
-- Batches are audited. Rows are staging data (they hold the file's text until
-- commit) and are not copied into the audit log.
create trigger audit_import_batches after insert or update or delete on public.import_batches
  for each row execute function public.tg_audit();

alter table public.import_batches enable row level security;
alter table public.import_rows    enable row level security;

create policy import_batches_select on public.import_batches
  for select to authenticated using (public.is_board(association_id));
create policy import_rows_select on public.import_rows
  for select to authenticated using (public.is_board(association_id));

-- The Document Hub may link the uploaded file to its batch.
alter table public.document_links drop constraint document_links_target_table_known;
alter table public.document_links
  add constraint document_links_target_table_known
  check (target_table in (
    'associations', 'units', 'persons', 'vendors',
    'journal_entries', 'expenses', 'assessment_charges', 'payments',
    'insurance_policies', 'tickets', 'recurring_bills', 'fiscal_years',
    'tax_forms', 'insurance_quotes', 'insurance_claims',
    'announcements', 'import_batches'
  ));

-- ----------------------------------------------------------------------------
-- Small pure helpers
-- ----------------------------------------------------------------------------

create or replace function public.import_num(p text)
returns numeric language sql immutable set search_path = ''
as $$ select case when p ~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$' then p::numeric(14,2) end $$;

-- Percentages carry up to six decimals (numeric(9,6)).
create or replace function public.import_pct(p text)
returns numeric language sql immutable set search_path = ''
as $$ select case when p ~ '^[0-9]{1,3}(\.[0-9]{1,6})?$' then p::numeric(9,6) end $$;

create or replace function public.import_date(p text)
returns date language plpgsql immutable set search_path = ''
as $$
begin
  if p is null or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end $$;

revoke all on function public.import_num(text) from public, anon;
revoke all on function public.import_pct(text) from public, anon;
revoke all on function public.import_date(text) from public, anon;
grant execute on function public.import_num(text) to authenticated;
grant execute on function public.import_pct(text) to authenticated;
grant execute on function public.import_date(text) to authenticated;

-- A text to uuid that returns null instead of failing on a bad value.
create or replace function public.import_uuid(p text)
returns uuid language plpgsql immutable set search_path = ''
as $$
begin
  if p is null or p !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  return p::uuid;
exception when others then return null;
end $$;
revoke all on function public.import_uuid(text) from public, anon, authenticated;

-- The text a row is compared on to find a repeat of it. One definition, used by
-- the validator for the occurrence count and for the hash.
create or replace function public.import_row_key(p_kind text, m jsonb)
returns text language sql immutable set search_path = ''
as $$
  select case p_kind
    when 'transactions' then concat_ws('|', 'tx', m ->> 'date', m ->> 'amount',
      lower(btrim(coalesce(m ->> 'description', ''))), lower(btrim(coalesce(m ->> 'payee', ''))),
      lower(btrim(coalesce(m ->> 'unit_label', ''))))
    when 'units_owners' then concat_ws('|', 'uo', lower(btrim(coalesce(m ->> 'unit_label', ''))),
      lower(btrim(coalesce(nullif(m ->> 'email', ''), m ->> 'owner_name', ''))))
    when 'opening_accounts' then concat_ws('|', 'oa', lower(btrim(coalesce(m ->> 'account_key', ''))),
      lower(btrim(coalesce(m ->> 'fund_key', ''))))
    when 'opening_units' then concat_ws('|', 'ou', lower(btrim(coalesce(m ->> 'unit_label', ''))), m ->> 'amount')
    else concat_ws('|', 'vn', lower(btrim(coalesce(m ->> 'name', '')))) end
$$;
revoke all on function public.import_row_key(text, jsonb) from public, anon, authenticated;

-- The fiscal year that holds a date, if any, and whether it is open.
create or replace function public.import_fiscal_year(p_assoc uuid, p_date date)
returns table (id uuid, is_open boolean)
language sql stable security definer set search_path = ''
as $$
  select f.id, f.status = 'open'
    from public.fiscal_years f
   where f.association_id = p_assoc and p_date between f.starts_on and f.ends_on
$$;
revoke all on function public.import_fiscal_year(uuid, date) from public, anon, authenticated;

create or replace function public.import_err(p_errs jsonb, p_field text, p_code text, p_message text)
returns jsonb language sql immutable set search_path = ''
as $$ select p_errs || jsonb_build_array(jsonb_build_object('field', p_field, 'code', p_code, 'message', p_message)) $$;
revoke all on function public.import_err(jsonb, text, text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Explicit accounts and fiscal years
-- ----------------------------------------------------------------------------

-- Like create_expense_account (0032), except the exempt answer is mandatory:
-- an import must never decide a tax classification by default.
create or replace function public.import_create_account(
  p_association_id uuid, p_name text, p_type text, p_is_exempt boolean)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(p_name);
  v_code text;
  v_max  integer;
  v_id   uuid;
begin
  if not public.has_role_in(p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board admin can add a category' using errcode = '42501';
  end if;
  if p_type is null or p_type not in ('expense', 'income') then
    raise exception 'imports can add expense or income categories only' using errcode = '22023';
  end if;
  if p_is_exempt is null then
    raise exception 'say whether this counts toward the association''s tax-exempt activity' using errcode = '22023', hint = 'exempt_required';
  end if;
  if v_name is null or v_name = '' or char_length(v_name) > 80 then
    raise exception 'the name must be 1 to 80 characters' using errcode = '22023';
  end if;
  if p_type = 'expense' then
    select max(s.c) into v_max from (
      select case when a.code ~ '^[0-9]{1,6}$' then a.code::int end as c
        from public.accounts a where a.association_id = p_association_id and a.type = 'expense') s
     where s.c < 5900;
    v_code := to_char(coalesce(v_max, 4990) + 10, 'FM0000');
    if v_code::int >= 5900 then
      raise exception 'there is no room for another expense category' using errcode = '22023';
    end if;
    insert into public.accounts (association_id, code, name, type, is_cash_account, is_exempt_expenditure)
    values (p_association_id, v_code, v_name, 'expense', false, p_is_exempt) returning id into v_id;
  else
    select max(s.c) into v_max from (
      select case when a.code ~ '^[0-9]{1,6}$' then a.code::int end as c
        from public.accounts a where a.association_id = p_association_id and a.type = 'income') s
     where s.c between 4100 and 4899;
    v_code := to_char(coalesce(v_max, 4090) + 10, 'FM0000');
    if v_code::int > 4899 then
      raise exception 'there is no room for another income category' using errcode = '22023';
    end if;
    insert into public.accounts (association_id, code, name, type, is_cash_account, is_exempt_function_income,
                                 tax_classification_confirmed_at, tax_classification_confirmed_by)
    values (p_association_id, v_code, v_name, 'income', false, p_is_exempt, now(), auth.uid()) returning id into v_id;
  end if;
  return v_id;
end $$;

revoke all on function public.import_create_account(uuid, text, text, boolean) from public, anon;
grant execute on function public.import_create_account(uuid, text, text, boolean) to authenticated;

-- A calendar-year fiscal year for history older than the books. Refuses when
-- the association's year does not end in December or the year overlaps.
create or replace function public.import_ensure_fiscal_year(p_association_id uuid, p_year integer)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.has_role_in(p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board admin can add a fiscal year' using errcode = '42501';
  end if;
  if p_year is null or p_year < 1990 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'that year is out of range' using errcode = '22023';
  end if;
  select f.id into v_id from public.fiscal_years f
   where f.association_id = p_association_id and f.starts_on = make_date(p_year, 1, 1) and f.ends_on = make_date(p_year, 12, 31);
  if v_id is not null then return v_id; end if;
  if (select a.fiscal_year_end_month from public.associations a where a.id = p_association_id) <> 12 then
    raise exception 'add this fiscal year by hand: your year does not end in December' using errcode = '22023', hint = 'fy_not_december';
  end if;
  begin
    insert into public.fiscal_years (association_id, label, starts_on, ends_on)
    values (p_association_id, p_year::text, make_date(p_year, 1, 1), make_date(p_year, 12, 31))
    returning id into v_id;
  exception when exclusion_violation or unique_violation then
    raise exception 'that year overlaps a fiscal year you already have; add it by hand' using errcode = '22023', hint = 'fy_overlap';
  end;
  return v_id;
end $$;

revoke all on function public.import_ensure_fiscal_year(uuid, integer) from public, anon;
grant execute on function public.import_ensure_fiscal_year(uuid, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- Batch lifecycle
-- ----------------------------------------------------------------------------

create or replace function public.import_start(
  p_association_id uuid, p_kind text, p_filename text, p_file_sha256 text,
  p_source_document_id uuid, p_row_count integer)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_prev uuid;
begin
  if not public.has_role_in(p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board admin can import' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('units_owners', 'transactions', 'opening_accounts', 'opening_units', 'contractors') then
    raise exception 'unknown kind of import' using errcode = '22023';
  end if;
  select b.id into v_prev from public.import_batches b
   where b.association_id = p_association_id and b.kind = p_kind and b.file_sha256 = p_file_sha256 and b.status = 'committed';
  if v_prev is not null then
    raise exception 'this file was already imported' using errcode = '23505', hint = 'already_imported:' || v_prev::text;
  end if;
  if (select count(*) from public.import_batches b
       where b.association_id = p_association_id and b.status in ('uploaded', 'validated')) >= 5 then
    raise exception 'finish or cancel an earlier import first' using errcode = '53400', hint = 'too_many_open';
  end if;
  insert into public.import_batches (association_id, kind, filename, file_sha256, source_document_id, row_count)
  values (p_association_id, p_kind, left(p_filename, 200), p_file_sha256, p_source_document_id, p_row_count)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.import_start(uuid, text, text, text, uuid, integer) from public, anon;
grant execute on function public.import_start(uuid, text, text, text, uuid, integer) to authenticated;

-- Rows are [{row_number, raw, mapped, errors}], at most 500 per call.
create or replace function public.import_stage_rows(p_batch_id uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = ''
as $$
declare b public.import_batches%rowtype; v_n integer;
begin
  select * into b from public.import_batches where id = p_batch_id for update;
  if not found or not public.has_role_in(b.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if b.status not in ('uploaded', 'validated') then
    raise exception 'this import is closed' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'send at most 500 rows at a time' using errcode = '22023';
  end if;
  if (select count(*) from public.import_rows r where r.batch_id = b.id) + jsonb_array_length(p_rows) > b.row_count then
    raise exception 'more rows than the file had' using errcode = '22023';
  end if;
  insert into public.import_rows (association_id, batch_id, row_number, raw, mapped, errors)
  select b.association_id, b.id, (x ->> 'row_number')::int, x -> 'raw', coalesce(x -> 'mapped', '{}'::jsonb), coalesce(x -> 'errors', '[]'::jsonb)
    from jsonb_array_elements(p_rows) x;
  get diagnostics v_n = row_count;
  update public.import_batches set status = 'uploaded', digest = null where id = b.id and status = 'validated';
  return v_n;
end $$;

revoke all on function public.import_stage_rows(uuid, jsonb) from public, anon;
grant execute on function public.import_stage_rows(uuid, jsonb) to authenticated;

create or replace function public.import_set_options(p_batch_id uuid, p_mapping jsonb, p_options jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare b public.import_batches%rowtype;
begin
  select * into b from public.import_batches where id = p_batch_id for update;
  if not found or not public.has_role_in(b.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if b.status not in ('uploaded', 'validated') then
    raise exception 'this import is closed' using errcode = '22023';
  end if;
  update public.import_batches
     set mapping = coalesce(p_mapping, mapping), options = coalesce(p_options, options), status = 'uploaded', digest = null
   where id = b.id;
  update public.import_rows set status = 'pending', row_hash = null where batch_id = b.id and status in ('ok', 'error', 'duplicate');
end $$;

revoke all on function public.import_set_options(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.import_set_options(uuid, jsonb, jsonb) to authenticated;

-- A fix typed into the error table: replaces some mapped values of one row.
create or replace function public.import_update_row(p_row_id uuid, p_mapped jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.import_rows%rowtype;
begin
  select * into r from public.import_rows where id = p_row_id for update;
  if not found or not public.has_role_in(r.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.import_batches b where b.id = r.batch_id and b.status in ('uploaded', 'validated')) then
    raise exception 'this import is closed' using errcode = '22023';
  end if;
  -- A fix typed into the table supersedes the parser's complaint about the old value.
  update public.import_rows set mapped = mapped || coalesce(p_mapped, '{}'::jsonb), status = 'pending', row_hash = null, errors = '[]'::jsonb where id = r.id;
  update public.import_batches set status = 'uploaded', digest = null where id = r.batch_id;
end $$;

revoke all on function public.import_update_row(uuid, jsonb) from public, anon;
grant execute on function public.import_update_row(uuid, jsonb) to authenticated;

create or replace function public.import_set_row_decision(p_row_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.import_rows%rowtype;
begin
  select * into r from public.import_rows where id = p_row_id for update;
  if not found or not public.has_role_in(r.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('import', 'skip') then raise exception 'unknown decision' using errcode = '22023'; end if;
  if not exists (select 1 from public.import_batches b where b.id = r.batch_id and b.status in ('uploaded', 'validated')) then
    raise exception 'this import is closed' using errcode = '22023';
  end if;
  update public.import_rows set decision = p_decision, status = 'pending', row_hash = null where id = r.id;
  update public.import_batches set status = 'uploaded', digest = null where id = r.batch_id;
end $$;

revoke all on function public.import_set_row_decision(uuid, text) from public, anon;
grant execute on function public.import_set_row_decision(uuid, text) to authenticated;

-- "Skip every row that has a problem": one click instead of one per row.
create or replace function public.import_skip_problem_rows(p_batch_id uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare b public.import_batches%rowtype; v_n integer;
begin
  select * into b from public.import_batches where id = p_batch_id for update;
  if not found or not public.has_role_in(b.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if b.status not in ('uploaded', 'validated') then
    raise exception 'this import is closed' using errcode = '22023';
  end if;
  update public.import_rows set decision = 'skip', status = 'pending', row_hash = null where batch_id = b.id and status = 'error';
  get diagnostics v_n = row_count;
  update public.import_batches set status = 'uploaded', digest = null where id = b.id;
  return v_n;
end $$;

revoke all on function public.import_skip_problem_rows(uuid) from public, anon;
grant execute on function public.import_skip_problem_rows(uuid) to authenticated;

create or replace function public.import_cancel(p_batch_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare b public.import_batches%rowtype;
begin
  select * into b from public.import_batches where id = p_batch_id for update;
  if not found or not public.has_role_in(b.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if b.status not in ('uploaded', 'validated') then
    raise exception 'only an import that has not been committed can be cancelled' using errcode = '22023';
  end if;
  update public.import_rows set raw = null, mapped = '{}'::jsonb where batch_id = b.id;
  update public.import_batches set status = 'cancelled', digest = null where id = b.id;
end $$;

revoke all on function public.import_cancel(uuid) from public, anon;
grant execute on function public.import_cancel(uuid) to authenticated;

-- Staged rows hold names, emails, phones and addresses until commit or cancel.
-- An abandoned batch would keep them forever, so any batch still uploaded or
-- validated after p_days days is cancelled the way import_cancel does it
-- (REVIEW-1 #17). Called by email_purge, which the daily cron already runs.
create or replace function public.import_expire_stale(p_days integer default 14)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if not public.email_is_service() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_days < 1 then
    raise exception 'p_days must be at least 1' using errcode = '22023';
  end if;
  update public.import_rows set raw = null, mapped = '{}'::jsonb
   where batch_id in (select id from public.import_batches
                       where status in ('uploaded', 'validated')
                         and created_at < now() - make_interval(days => p_days));
  update public.import_batches set status = 'cancelled', digest = null
   where status in ('uploaded', 'validated')
     and created_at < now() - make_interval(days => p_days);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.import_expire_stale(integer) from public, anon, authenticated;
grant execute on function public.import_expire_stale(integer) to service_role;

-- ----------------------------------------------------------------------------
-- Validation (the dry run). Re-run by import_commit, so a stale preview cannot
-- be committed.
-- ----------------------------------------------------------------------------

create or replace function public.import_validate(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  b      public.import_batches%rowtype;
  r      record;
  o      jsonb;
  m      jsonb;
  errs   jsonb;
  v_key  text;
  v_hash text;
  v_amt  numeric;
  v_date date;
  v_acct public.accounts%rowtype;
  v_fy   record;
  v_unit uuid;
  v_cash public.accounts%rowtype;
  v_cnt  jsonb := '{}'::jsonb;
  v_ok   integer := 0; v_bad integer := 0; v_dup integer := 0; v_skip integer := 0;
  v_in   numeric := 0; v_out numeric := 0;
  v_deb  numeric := 0; v_cre numeric := 0;
  v_by   jsonb := '{}'::jsonb;
  v_pct_total numeric := 0; v_pct_units integer := 0;
  v_batch_errors jsonb := '[]'::jsonb;
  v_digest text;
  v_ctx  text;
  v_acc_key text;
  v_pct numeric;
  v_unit_pct jsonb := '{}'::jsonb;
  v_as_of date;
  v_new_units integer := 0; v_existing_units integer := 0; v_new_people integer := 0;
  v_owners integer := 0; v_dues integer := 0; v_dues_no_fund integer := 0;
  v_open_date date;
  v_operating_fund boolean;
  v_dup_existing boolean;
  v_prior boolean;
  v_exist integer;
  v_label text;
  v_live boolean;
begin
  select * into b from public.import_batches where id = p_batch_id for update;
  if not found or not public.has_role_in(b.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if b.status not in ('uploaded', 'validated') then
    raise exception 'this import is closed' using errcode = '22023';
  end if;
  if (select count(*) from public.import_rows x where x.batch_id = b.id) <> b.row_count then
    raise exception 'the file has not been fully loaded' using errcode = '22023', hint = 'rows_missing';
  end if;
  o := b.options;

  -- Options that apply to a whole kind --------------------------------------
  if b.kind = 'transactions' then
    select * into v_cash from public.accounts a
     where a.id = public.import_uuid(o ->> 'cash_account_id') and a.association_id = b.association_id and a.is_cash_account and a.is_active;
    if v_cash.id is null then
      v_batch_errors := public.import_err(v_batch_errors, 'cash_account_id', 'cash_account_missing', 'Choose the bank or cash account these transactions went through.');
    end if;
    if not exists (select 1 from public.funds f where f.id = public.import_uuid(o ->> 'default_fund_id') and f.association_id = b.association_id) then
      v_batch_errors := public.import_err(v_batch_errors, 'default_fund_id', 'fund_missing', 'Choose the fund these transactions belong to.');
    end if;
    if coalesce(o ->> 'mapping_confirmed', '') <> 'true' then
      v_batch_errors := public.import_err(v_batch_errors, 'account_map', 'mapping_unconfirmed', 'Confirm that each category is matched to the right account. Walkup does not guess what counts toward your tax-exempt activity.');
    end if;
    select public.import_date(b2.options ->> 'as_of') into v_open_date from public.import_batches b2
     where b2.association_id = b.association_id and b2.kind = 'opening_accounts' and b2.status = 'committed';
  elsif b.kind in ('opening_accounts', 'opening_units') then
    v_as_of := public.import_date(o ->> 'as_of');
    if v_as_of is null then
      v_batch_errors := public.import_err(v_batch_errors, 'as_of', 'as_of_missing', 'Enter the date these balances are as of.');
    else
      select * into v_fy from public.import_fiscal_year(b.association_id, v_as_of);
      if v_fy.id is null then
        v_batch_errors := public.import_err(v_batch_errors, 'as_of', 'fiscal_year_missing', 'No fiscal year covers that date. Add the year first.');
      elsif not v_fy.is_open then
        v_batch_errors := public.import_err(v_batch_errors, 'as_of', 'fiscal_year_closed', 'That fiscal year is closed, so nothing can be added to it.');
      end if;
    end if;
    if b.kind = 'opening_accounts' and v_as_of is not null and exists (
         select 1 from public.journal_entries je where je.association_id = b.association_id and je.entry_date <= v_as_of) then
      v_batch_errors := public.import_err(v_batch_errors, 'as_of', 'entries_exist', 'There are already entries on or before that date. An opening balance has to come before everything else, or it counts them twice. Choose an earlier date.');
    end if;
    if b.kind = 'opening_units' then
      if not exists (select 1 from public.accounts a where a.id = public.import_uuid(o ->> 'income_account_id') and a.association_id = b.association_id and a.type = 'income' and a.is_active) then
        v_batch_errors := public.import_err(v_batch_errors, 'income_account_id', 'income_account_missing', 'Choose the income account these dues were counted under. The tax return uses it when the owner pays.');
      end if;
      if not exists (select 1 from public.accounts a where a.id = public.import_uuid(o ->> 'ar_account_id') and a.association_id = b.association_id and a.code in ('1200', '1250') and a.is_active) then
        v_batch_errors := public.import_err(v_batch_errors, 'ar_account_id', 'ar_account_missing', 'Choose the Assessments Receivable account.');
      end if;
      if not exists (select 1 from public.funds f where f.id = public.import_uuid(o ->> 'fund_id') and f.association_id = b.association_id) then
        v_batch_errors := public.import_err(v_batch_errors, 'fund_id', 'fund_missing', 'Choose the fund.');
      end if;
    end if;
  elsif b.kind = 'units_owners' then
    if public.import_date(o ->> 'effective_from') is null then
      v_batch_errors := public.import_err(v_batch_errors, 'effective_from', 'date_missing', 'Enter the date these owners took ownership (use the earliest date you are sure of).');
    end if;
    if o ->> 'dues_frequency' is not null and o ->> 'dues_frequency' not in ('monthly', 'quarterly', 'annual') then
      v_batch_errors := public.import_err(v_batch_errors, 'dues_frequency', 'frequency_unknown', 'Choose how often the dues amount is paid.');
    end if;
    select exists (select 1 from public.funds f where f.association_id = b.association_id and f.kind = 'operating') into v_operating_fund;
  end if;

  -- Rows ----------------------------------------------------------------------
  -- occ: which repeat of the same key this row is among the rows being imported.
  for r in
    select x.*, coalesce(k.occ, 1) as occ
      from public.import_rows x
      left join (
        select s.id, row_number() over (partition by s.k order by s.row_number) as occ
          from (select y.id, y.row_number, public.import_row_key(b.kind, y.mapped) as k
                  from public.import_rows y where y.batch_id = b.id and y.decision = 'import') s
      ) k on k.id = x.id
     where x.batch_id = b.id
     order by x.row_number
  loop
    m := r.mapped;
    errs := '[]'::jsonb;
    v_key := null;
    v_dup_existing := false;
    v_live := false;

    if r.decision = 'skip' then
      update public.import_rows set status = 'skipped', errors = '[]'::jsonb, row_hash = null where id = r.id;
      v_skip := v_skip + 1;
      continue;
    end if;
    -- Problems the parser already saw (an unreadable formula, a long cell).
    errs := coalesce((select jsonb_agg(e) from jsonb_array_elements(r.errors) e where e ->> 'code' like 'parse_%'), '[]'::jsonb);

    if b.kind = 'transactions' then
      v_date := public.import_date(m ->> 'date');
      v_amt  := public.import_num(m ->> 'amount');
      if v_date is null then errs := public.import_err(errs, 'date', 'date_bad', 'The date is missing or not a real date.'); end if;
      if v_amt is null or v_amt = 0 then errs := public.import_err(errs, 'amount', 'amount_bad', 'The amount is missing, zero, or not a number with at most two decimals.'); end if;
      if coalesce(btrim(m ->> 'description'), '') = '' then errs := public.import_err(errs, 'description', 'description_missing', 'Add a short description.'); end if;
      if v_date is not null and v_open_date is not null and v_date <= v_open_date then
        errs := public.import_err(errs, 'date', 'before_opening', 'Your opening balance is as of ' || v_open_date::text || '. Anything on or before that day is already in it, so importing it would count it twice. Skip this row.');
      end if;
      if v_date is not null then
        select * into v_fy from public.import_fiscal_year(b.association_id, v_date);
        if v_fy.id is null then errs := public.import_err(errs, 'date', 'fiscal_year_missing', 'No fiscal year covers this date. Add the year first.');
        elsif not v_fy.is_open then errs := public.import_err(errs, 'date', 'fiscal_year_closed', 'That fiscal year is closed.'); end if;
      end if;
      v_acc_key := lower(btrim(coalesce(m ->> 'category_key', '')));
      select * into v_acct from public.accounts a
       where a.id = public.import_uuid(o -> 'account_map' ->> v_acc_key) and a.association_id = b.association_id and a.is_active;
      if v_acc_key = '' then errs := public.import_err(errs, 'category', 'category_missing', 'This row has no category.');
      elsif v_acct.id is null then errs := public.import_err(errs, 'category', 'category_unmapped', 'Choose which of your accounts "' || left(m ->> 'category_key', 60) || '" belongs to.');
      else
        if v_acct.is_cash_account then errs := public.import_err(errs, 'category', 'transfer_not_supported', 'Moves between your own bank accounts are not imported. Skip this row; the bank feed handles transfers.');
        elsif v_acct.code in ('1200', '1250') then errs := public.import_err(errs, 'category', 'ar_not_allowed', 'Dues owed by units are tracked per unit. Import them under Opening balances, or choose an income account for money received.');
        elsif v_acct.type = 'expense' and v_amt > 0 then errs := public.import_err(errs, 'amount', 'sign_expense', 'Money coming in cannot go to an expense category.');
        elsif v_acct.type = 'income' and v_amt < 0 then errs := public.import_err(errs, 'amount', 'sign_income', 'Money going out cannot go to an income category.');
        end if;
      end if;
      -- A fund named in the file must be matched to a fund; only a blank cell uses the default.
      if not exists (select 1 from public.funds f where f.association_id = b.association_id
           and f.id = case when btrim(coalesce(m ->> 'fund_key', '')) = '' then public.import_uuid(o ->> 'default_fund_id')
                           else public.import_uuid(o -> 'fund_map' ->> lower(btrim(m ->> 'fund_key'))) end) then
        errs := public.import_err(errs, 'fund', 'fund_unmapped', 'Choose which fund "' || left(coalesce(m ->> 'fund_key', ''), 60) || '" is.');
      end if;
      if coalesce(m ->> 'unit_label', '') <> '' and not exists (
           select 1 from public.units u where u.association_id = b.association_id and lower(u.label) = lower(btrim(m ->> 'unit_label'))) then
        errs := public.import_err(errs, 'unit', 'unit_unknown', 'There is no unit called "' || left(m ->> 'unit_label', 40) || '".');
      end if;
      -- The key is tested even when the row's payee is blank: commit looks the
      -- vendor up by the same key, blank included (REVIEW-1 #10).
      if (o -> 'payee_map') ? lower(btrim(coalesce(m ->> 'payee', '')))
         and not exists (select 1 from public.vendors v where v.association_id = b.association_id
                          and v.id = public.import_uuid(o -> 'payee_map' ->> lower(btrim(coalesce(m ->> 'payee', ''))))) then
        errs := public.import_err(errs, 'payee', 'payee_unknown', 'That contractor does not exist.');
      end if;

    elsif b.kind = 'units_owners' then
      if coalesce(btrim(m ->> 'unit_label'), '') = '' then errs := public.import_err(errs, 'unit_label', 'unit_missing', 'Every row needs a unit.');
      elsif char_length(btrim(m ->> 'unit_label')) > 60 then errs := public.import_err(errs, 'unit_label', 'unit_long', 'Unit names can be at most 60 characters.'); end if;
      if coalesce(btrim(m ->> 'owner_name'), '') = '' and (coalesce(m ->> 'email', '') <> '' or coalesce(m ->> 'phone', '') <> '') then
        errs := public.import_err(errs, 'owner_name', 'owner_name_missing', 'An owner needs a name.');
      end if;
      if coalesce(m ->> 'email', '') <> '' and not public.email_address_ok(lower(btrim(m ->> 'email'))) then
        errs := public.import_err(errs, 'email', 'email_bad', 'That does not look like an email address.');
      end if;
      v_pct := public.import_pct(m ->> 'ownership_percent');
      if coalesce(m ->> 'ownership_percent', '') <> '' and (v_pct is null or v_pct <= 0 or v_pct > 100) then
        errs := public.import_err(errs, 'ownership_percent', 'percent_bad', 'Ownership must be a number above 0 and at most 100.');
      end if;
      if coalesce(m ->> 'dues_amount', '') <> '' and (public.import_num(m ->> 'dues_amount') is null or public.import_num(m ->> 'dues_amount') <= 0) then
        errs := public.import_err(errs, 'dues_amount', 'dues_bad', 'Dues must be an amount above 0.');
      end if;
      -- A different current owner is a conflict, unless the file keeps someone
      -- who is already the owner (a new co-owner added next to a current one).
      if coalesce(btrim(m ->> 'owner_name'), '') <> '' and coalesce(btrim(m ->> 'unit_label'), '') <> ''
         and not coalesce((o ->> 'replace_owners')::boolean, false)
         and exists (
           select 1 from public.units u
             join public.unit_owners uo on uo.unit_id = u.id and (uo.effective_to is null or uo.effective_to >= current_date)
            where u.association_id = b.association_id and lower(u.label) = lower(btrim(m ->> 'unit_label')))
         and not exists (
           select 1 from public.units u
             join public.unit_owners uo on uo.unit_id = u.id and (uo.effective_to is null or uo.effective_to >= current_date)
             join public.persons p on p.id = uo.person_id
             join public.import_rows y on y.batch_id = b.id and y.decision = 'import'
                  and lower(btrim(coalesce(y.mapped ->> 'unit_label', ''))) = lower(u.label)
            where u.association_id = b.association_id and lower(u.label) = lower(btrim(m ->> 'unit_label'))
              and ((coalesce(p.email, '') <> '' and lower(p.email) = lower(coalesce(y.mapped ->> 'email', '')))
                   or lower(p.full_name) = lower(btrim(coalesce(y.mapped ->> 'owner_name', ''))))) then
        errs := public.import_err(errs, 'owner_name', 'owner_conflict', 'This unit already has a different owner. Use Change owner on Building Info, or turn on "replace the current owner".');
      end if;

    elsif b.kind = 'opening_accounts' then
      v_acc_key := lower(btrim(coalesce(m ->> 'account_key', '')));
      select * into v_acct from public.accounts a
       where a.association_id = b.association_id and a.is_active
         and (lower(a.code) = v_acc_key or lower(a.name) = v_acc_key)
       order by (lower(a.code) = v_acc_key) desc limit 1;
      if v_acct.id is null then errs := public.import_err(errs, 'account', 'account_unknown', 'No account is called "' || left(coalesce(m ->> 'account_key', ''), 60) || '".');
      elsif v_acct.type in ('income', 'expense') then errs := public.import_err(errs, 'account', 'account_type', 'Opening balances are for assets, liabilities and fund balances, not income or expenses.');
      elsif v_acct.code in ('1200', '1250') then errs := public.import_err(errs, 'account', 'ar_not_allowed', 'What each unit owes goes in the Unit balances file, not here.');
      end if;
      if not exists (select 1 from public.funds f where f.association_id = b.association_id and lower(f.name) = lower(btrim(coalesce(m ->> 'fund_key', '')))) then
        errs := public.import_err(errs, 'fund', 'fund_unknown', 'No fund is called "' || left(coalesce(m ->> 'fund_key', ''), 60) || '".');
      end if;
      v_amt := coalesce(public.import_num(nullif(m ->> 'debit', '')), 0) - coalesce(public.import_num(nullif(m ->> 'credit', '')), 0);
      if (coalesce(m ->> 'debit', '') <> '' and public.import_num(m ->> 'debit') is null)
         or (coalesce(m ->> 'credit', '') <> '' and public.import_num(m ->> 'credit') is null)
         or (coalesce(public.import_num(nullif(m ->> 'debit', '')), 0) > 0 and coalesce(public.import_num(nullif(m ->> 'credit', '')), 0) > 0)
         or coalesce(public.import_num(nullif(m ->> 'debit', '')), 0) < 0 or coalesce(public.import_num(nullif(m ->> 'credit', '')), 0) < 0
         or v_amt = 0 then
        errs := public.import_err(errs, 'amount', 'amount_bad', 'Give either a debit or a credit above zero, not both.');
      end if;

    elsif b.kind = 'opening_units' then
      select u.id into v_unit from public.units u where u.association_id = b.association_id and lower(u.label) = lower(btrim(coalesce(m ->> 'unit_label', '')));
      if v_unit is null then errs := public.import_err(errs, 'unit_label', 'unit_unknown', 'There is no unit called "' || left(coalesce(m ->> 'unit_label', ''), 40) || '".'); end if;
      v_amt := public.import_num(m ->> 'amount');
      if v_amt is null or v_amt <= 0 then errs := public.import_err(errs, 'amount', 'amount_bad', 'Enter what the unit owed, above zero. Credits are not imported here.'); end if;

    elsif b.kind = 'contractors' then
      if coalesce(btrim(m ->> 'name'), '') = '' then errs := public.import_err(errs, 'name', 'name_missing', 'Every contractor needs a name.');
      elsif char_length(btrim(m ->> 'name')) > 120 then errs := public.import_err(errs, 'name', 'name_long', 'Names can be at most 120 characters.'); end if;
      if coalesce(m ->> 'email', '') <> '' and not public.email_address_ok(lower(btrim(m ->> 'email'))) then
        errs := public.import_err(errs, 'email', 'email_bad', 'That does not look like an email address.');
      end if;
      if m ? 'tin' then errs := public.import_err(errs, 'tin', 'tin_not_accepted', 'Tax ID numbers are never imported. Walkup keeps the last four digits from the W-9.'); end if;
      -- A contractor already on file, or named twice in this file, is left alone.
      v_dup_existing := r.occ > 1 or exists (
        select 1 from public.vendors v where v.association_id = b.association_id and lower(btrim(v.name)) = lower(btrim(coalesce(m ->> 'name', ''))));
    end if;

    -- Duplicates: the Nth identical row in this file, and anything already imported.
    v_key := public.import_row_key(b.kind, m);
    v_hash := encode(sha256(convert_to(v_key || '#' || r.occ::text, 'UTF8')), 'hex');

    v_prior := b.kind not in ('opening_accounts', 'opening_units') and exists (
             select 1 from public.import_rows z join public.import_batches zb on zb.id = z.batch_id
              where zb.association_id = b.association_id and zb.kind = b.kind and zb.status = 'committed'
                and z.status = 'committed' and z.row_hash = v_hash);

    -- A transaction already in the books or waiting in the bank feed (REVIEW-4 #2):
    -- importing it again would count the same money twice in the 60% and 90% tests.
    -- Same date and amount on the chosen cash account, an entry not undone (an
    -- entry with an odd number of reversals is undone; an even number is live
    -- again). A row the board knows is a second, separate payment says so with
    -- confirmed_separate = 'true' (set through import_update_row).
    if b.kind = 'transactions' and jsonb_array_length(errs) = 0 and not v_prior
       and v_date is not null and v_amt is not null and coalesce(m ->> 'confirmed_separate', '') <> 'true' then
      -- How many such transactions the books already hold. This row is flagged
      -- when they cover its occurrence number, so a real second payment of the
      -- same amount on the same day (the Nth identical row) is still allowed.
      select count(*) into v_exist
        from public.journal_entries je
        join public.journal_lines l on l.journal_entry_id = je.id
        join public.accounts ca on ca.id = l.account_id and ca.is_cash_account
       where je.association_id = b.association_id and je.is_posted and je.entry_date = v_date
         and je.reverses_entry_id is null
         and (v_cash.id is null or l.account_id = v_cash.id)
         and ((v_amt > 0 and l.debit = v_amt) or (v_amt < 0 and l.credit = -v_amt))
         and (with recursive chain(id) as (
                select je.id
                union all
                select rv.id from public.journal_entries rv join chain on rv.reverses_entry_id = chain.id where rv.is_posted)
              select count(*) from chain) % 2 = 1;
      if v_exist >= r.occ then
        errs := public.import_err(errs, 'amount', 'already_in_books',
          'A transaction for this date and amount is already in your books. Skip this row, or mark it as a separate transaction if it is a second one.');
      else
        select count(*) into v_exist from public.bank_transactions bt
         where bt.association_id = b.association_id and bt.posted_on = v_date and bt.amount = v_amt
           and bt.journal_entry_id is null and bt.excluded_at is null and bt.removed_at is null;
        if v_exist >= r.occ then
          errs := public.import_err(errs, 'amount', 'already_in_bank_feed',
            'The bank feed already has a transaction for this date and amount. Post it from the bank feed and skip this row, or mark this one as a separate transaction.');
        end if;
      end if;
    end if;

    if jsonb_array_length(errs) > 0 then
      update public.import_rows set status = 'error', errors = errs, row_hash = v_hash where id = r.id;
      v_bad := v_bad + 1;
    elsif v_dup_existing or v_prior then
      update public.import_rows set status = 'duplicate', errors = '[]'::jsonb, row_hash = v_hash where id = r.id;
      v_dup := v_dup + 1;
      v_live := true;
    else
      update public.import_rows set status = 'ok', errors = '[]'::jsonb, row_hash = v_hash where id = r.id;
      v_ok := v_ok + 1;
      v_live := true;
      if b.kind = 'transactions' then
        if v_amt > 0 then v_in := v_in + v_amt; else v_out := v_out - v_amt; end if;
        v_by := jsonb_set(v_by, array[v_acct.id::text], jsonb_build_object(
          'account', v_acct.code || ' ' || v_acct.name, 'type', v_acct.type,
          'exempt', case v_acct.type when 'income' then v_acct.is_exempt_function_income when 'expense' then v_acct.is_exempt_expenditure when 'asset' then v_acct.is_exempt_expenditure else null end,
          'count', coalesce((v_by -> v_acct.id::text ->> 'count')::int, 0) + 1,
          'total', (coalesce((v_by -> v_acct.id::text ->> 'total')::numeric, 0) + abs(v_amt))::numeric(14,2)::text));
      elsif b.kind = 'opening_accounts' then
        if v_amt > 0 then v_deb := v_deb + v_amt; else v_cre := v_cre - v_amt; end if;
      elsif b.kind = 'opening_units' then
        v_in := v_in + v_amt;
      elsif b.kind = 'units_owners' then
        if coalesce(btrim(m ->> 'owner_name'), '') <> '' then v_owners := v_owners + 1; end if;
        if coalesce(m ->> 'dues_amount', '') <> '' then
          select u.id into v_unit from public.units u where u.association_id = b.association_id and lower(u.label) = lower(btrim(m ->> 'unit_label'));
          if not v_operating_fund then
            v_dues_no_fund := v_dues_no_fund + 1;
          elsif v_unit is null or not exists (select 1 from public.assessment_schedules sc where sc.unit_id = v_unit and sc.ends_on is null and not sc.is_special) then
            v_dues := v_dues + 1;
          end if;
        end if;
      end if;
    end if;

    -- Ownership shares count for every row that stays in the import, including
    -- a row already imported earlier (the share still has to be recorded).
    if b.kind = 'units_owners' and v_live then
      v_pct := public.import_pct(m ->> 'ownership_percent');
      if v_pct is not null and v_pct > 0 and v_pct <= 100 then
        v_label := lower(btrim(m ->> 'unit_label'));
        if v_unit_pct ? v_label and (v_unit_pct ->> v_label)::numeric <> v_pct then
          v_batch_errors := public.import_err(v_batch_errors, 'ownership_percent', 'percent_conflict', 'Unit "' || (m ->> 'unit_label') || '" has two different ownership percentages.');
        end if;
        v_unit_pct := jsonb_set(v_unit_pct, array[v_label], to_jsonb(v_pct::text));
      end if;
    end if;
  end loop;

  -- Whole-batch checks ---------------------------------------------------------
  if b.kind = 'opening_accounts' then
    if v_deb <> v_cre then
      v_batch_errors := public.import_err(v_batch_errors, 'balance', 'unbalanced', 'Debits are ' || v_deb::numeric(14,2)::text || ' and credits are ' || v_cre::numeric(14,2)::text || '. They must be equal. Fund balance usually makes up the difference.');
    end if;
    if v_ok < 2 then v_batch_errors := public.import_err(v_batch_errors, 'rows', 'too_few', 'An opening balance needs at least two lines.'); end if;
  end if;
  if b.kind = 'units_owners' and v_unit_pct <> '{}'::jsonb and not coalesce((o ->> 'skip_percentages')::boolean, false) then
    select count(*), coalesce(sum((value #>> '{}')::numeric), 0) into v_pct_units, v_pct_total from jsonb_each(v_unit_pct);
    -- Every unit that will exist after the import must have a share.
    if exists (
         select 1 from (
           select lower(u.label) l from public.units u where u.association_id = b.association_id
           union
           select lower(btrim(x.mapped ->> 'unit_label')) from public.import_rows x
            where x.batch_id = b.id and x.status in ('ok', 'duplicate')) s
          where not v_unit_pct ? s.l) then
      v_batch_errors := public.import_err(v_batch_errors, 'ownership_percent', 'percent_incomplete', 'Give an ownership percentage for every unit, or for none. Percentages must cover all units.');
    elsif v_pct_total <> 100 then
      v_batch_errors := public.import_err(v_batch_errors, 'ownership_percent', 'percent_sum', 'Ownership percentages add up to ' || v_pct_total::text || ', not 100.');
    end if;
  end if;
  if b.kind = 'units_owners' then
    select count(distinct lower(btrim(x.mapped ->> 'unit_label'))) into v_new_units from public.import_rows x
     where x.batch_id = b.id and x.status = 'ok'
       and not exists (select 1 from public.units u where u.association_id = b.association_id and lower(u.label) = lower(btrim(x.mapped ->> 'unit_label')));
    select count(distinct lower(btrim(x.mapped ->> 'unit_label'))) into v_existing_units from public.import_rows x
     where x.batch_id = b.id and x.status = 'ok'
       and exists (select 1 from public.units u where u.association_id = b.association_id and lower(u.label) = lower(btrim(x.mapped ->> 'unit_label')));
    -- People with an email already on file are reused; every other named row is a new person.
    select count(*) into v_new_people from public.import_rows x
     where x.batch_id = b.id and x.status = 'ok' and coalesce(btrim(x.mapped ->> 'owner_name'), '') <> ''
       and not exists (select 1 from public.persons p where p.association_id = b.association_id
                        and coalesce(x.mapped ->> 'email', '') <> '' and lower(p.email) = lower(btrim(x.mapped ->> 'email')))
       and (coalesce(x.mapped ->> 'email', '') = ''
            or not exists (select 1 from public.import_rows w
                            where w.batch_id = b.id and w.status = 'ok' and w.row_number < x.row_number
                              and lower(w.mapped ->> 'email') = lower(x.mapped ->> 'email')));
  end if;

  v_cnt := jsonb_build_object('rows', b.row_count, 'ok', v_ok, 'errors', v_bad, 'duplicates', v_dup, 'skipped', v_skip);

  -- A fingerprint of what the rows were checked against, so a unit, account,
  -- fund, year or contractor changing after the preview makes the commit stale.
  v_ctx := encode(sha256(convert_to(concat_ws('#',
      (select coalesce(string_agg(u.id::text || lower(u.label), ',' order by u.id), '') from public.units u where u.association_id = b.association_id),
      (select coalesce(string_agg(a.id::text || a.is_active::text || a.type::text || coalesce(a.is_exempt_function_income::text, '') || coalesce(a.is_exempt_expenditure::text, '') || a.is_cash_account::text, ',' order by a.id), '')
         from public.accounts a where a.association_id = b.association_id),
      (select coalesce(string_agg(f.id::text, ',' order by f.id), '') from public.funds f where f.association_id = b.association_id),
      (select coalesce(string_agg(y.id::text || y.status::text, ',' order by y.id), '') from public.fiscal_years y where y.association_id = b.association_id),
      (select coalesce(string_agg(v.id::text || lower(btrim(v.name)), ',' order by v.id), '') from public.vendors v where v.association_id = b.association_id),
      (select coalesce(string_agg(i.id::text, ',' order by i.id), '') from public.import_batches i
        where i.association_id = b.association_id and i.status = 'committed')), 'UTF8')), 'hex');

  v_digest := encode(sha256(convert_to(
      coalesce((select string_agg(x.id::text || coalesce(x.row_hash, '') || x.decision, ',' order by x.row_number) from public.import_rows x where x.batch_id = b.id and x.status = 'ok'), '')
      || b.options::text || v_batch_errors::text || v_ctx, 'UTF8')), 'hex');

  update public.import_batches set status = 'validated', digest = v_digest,
    summary = jsonb_build_object('counts', v_cnt, 'batch_errors', v_batch_errors,
      'money_in', v_in::numeric(14,2)::text, 'money_out', v_out::numeric(14,2)::text,
      'debits', case when b.kind = 'opening_accounts' then v_deb::numeric(14,2)::text end,
      'credits', case when b.kind = 'opening_accounts' then v_cre::numeric(14,2)::text end,
      'unit_total', case when b.kind = 'opening_units' then v_in::numeric(14,2)::text end,
      'by_account', v_by, 'new_units', v_new_units, 'existing_units', v_existing_units, 'new_people', v_new_people,
      'owners_assigned', v_owners, 'dues_plans', v_dues, 'dues_plans_skipped_no_fund', v_dues_no_fund,
      'percent_total', case when v_unit_pct <> '{}'::jsonb then v_pct_total::text end)
   where id = b.id;

  return (select summary || jsonb_build_object('digest', digest) from public.import_batches where id = b.id);
end $$;

revoke all on function public.import_validate(uuid) from public, anon;
grant execute on function public.import_validate(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Commit: one transaction, the same ledger paths a person uses
-- ----------------------------------------------------------------------------

create or replace function public.import_commit(p_batch_id uuid, p_digest text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  b   public.import_batches%rowtype;
  s   jsonb;
  r   record;
  m   jsonb;
  o   jsonb;
  v_fy uuid;
  v_date date;
  v_amt numeric;
  v_acct public.accounts%rowtype;
  v_fund uuid;
  v_unit uuid;
  v_vendor uuid;
  v_entry uuid;
  v_created uuid;
  v_person uuid;
  v_cash uuid;
  v_n integer := 0;
  v_lines jsonb;
  v_pct jsonb := '{}'::jsonb;
  v_amend uuid;
  v_lines_pct jsonb;
  v_freq text;
  v_total numeric;
  v_start date;
  v_new_unit uuid; v_new_person uuid; v_new_sched uuid;
  v_closed jsonb := '[]'::jsonb;
  c record;
begin
  select * into b from public.import_batches where id = p_batch_id for update;
  if not found or not public.has_role_in(b.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if b.status <> 'validated' or b.digest is distinct from p_digest then
    raise exception 'the preview is out of date; review it again' using errcode = '22023', hint = 'preview_stale';
  end if;
  -- Re-validate inside this transaction: the ledger may have changed since the preview.
  s := public.import_validate(b.id);
  if (s ->> 'digest') is distinct from p_digest then
    raise exception 'something changed since the preview; review it again' using errcode = '22023', hint = 'preview_stale';
  end if;
  if jsonb_array_length(s -> 'batch_errors') > 0 then
    raise exception 'fix the problems at the top of the preview first' using errcode = '22023', hint = 'batch_errors';
  end if;
  if (s -> 'counts' ->> 'ok')::int = 0 then
    raise exception 'there is nothing to import' using errcode = '22023', hint = 'nothing';
  end if;
  o := b.options;

  if b.kind = 'transactions' then
    v_cash := public.import_uuid(o ->> 'cash_account_id');
    for r in select * from public.import_rows x where x.batch_id = b.id and x.status = 'ok' order by x.row_number loop
      m := r.mapped;
      v_date := (m ->> 'date')::date;
      v_amt := (m ->> 'amount')::numeric;
      select f.id into v_fy from public.import_fiscal_year(b.association_id, v_date) f;
      select * into v_acct from public.accounts where id = public.import_uuid(o -> 'account_map' ->> lower(btrim(m ->> 'category_key')));
      v_fund := case when btrim(coalesce(m ->> 'fund_key', '')) = '' then public.import_uuid(o ->> 'default_fund_id')
                     else public.import_uuid(o -> 'fund_map' ->> lower(btrim(m ->> 'fund_key'))) end;
      v_unit := (select u.id from public.units u where u.association_id = b.association_id and lower(u.label) = lower(btrim(coalesce(m ->> 'unit_label', ''))));
      v_vendor := public.import_uuid(o -> 'payee_map' ->> lower(btrim(coalesce(m ->> 'payee', ''))));
      if v_acct.type = 'expense' or (v_acct.type = 'asset' and v_amt < 0) then
        -- Money out to an expense or a capital item: the same path as typing an expense.
        v_created := public.record_expense(b.association_id, v_fy, v_date, abs(v_amt), v_fund, v_cash, v_acct.id, v_vendor,
                                           true, v_acct.type = 'asset', left(m ->> 'description', 300));
        update public.import_rows set status = 'committed', created_table = 'expenses', created_id = v_created where id = r.id;
      else
        v_lines := jsonb_build_array(
          jsonb_build_object('account_id', v_cash, 'fund_id', v_fund, 'unit_id', v_unit, 'debit', case when v_amt > 0 then v_amt else 0 end, 'credit', case when v_amt < 0 then -v_amt else 0 end),
          jsonb_build_object('account_id', v_acct.id, 'fund_id', v_fund, 'unit_id', v_unit, 'debit', case when v_amt < 0 then -v_amt else 0 end, 'credit', case when v_amt > 0 then v_amt else 0 end));
        v_entry := public.post_journal_entry(b.association_id, v_fy, v_date, left(m ->> 'description', 300), 'import', v_lines, b.id, b.source_document_id);
        update public.import_rows set status = 'committed', created_table = 'journal_entries', created_id = v_entry where id = r.id;
      end if;
      v_n := v_n + 1;
    end loop;

  elsif b.kind = 'opening_accounts' then
    v_date := (o ->> 'as_of')::date;
    select f.id into v_fy from public.import_fiscal_year(b.association_id, v_date) f;
    select jsonb_agg(jsonb_build_object(
             'account_id', a.id,
             'fund_id', (select f.id from public.funds f where f.association_id = b.association_id and lower(f.name) = lower(btrim(x.mapped ->> 'fund_key'))),
             'debit', coalesce(public.import_num(nullif(x.mapped ->> 'debit', '')), 0),
             'credit', coalesce(public.import_num(nullif(x.mapped ->> 'credit', '')), 0)) order by x.row_number)
      into v_lines
      from public.import_rows x
      join lateral (select a2.* from public.accounts a2 where a2.association_id = b.association_id and a2.is_active
                       and (lower(a2.code) = lower(btrim(x.mapped ->> 'account_key')) or lower(a2.name) = lower(btrim(x.mapped ->> 'account_key')))
                     order by (lower(a2.code) = lower(btrim(x.mapped ->> 'account_key'))) desc limit 1) a on true
     where x.batch_id = b.id and x.status = 'ok';
    v_entry := public.post_journal_entry(b.association_id, v_fy, v_date, 'Opening balances', 'import', v_lines, b.id, b.source_document_id);
    update public.import_rows set status = 'committed', created_table = 'journal_entries', created_id = v_entry
     where batch_id = b.id and status = 'ok';
    v_n := (s -> 'counts' ->> 'ok')::int;

  elsif b.kind = 'opening_units' then
    v_date := (o ->> 'as_of')::date;
    select f.id into v_fy from public.import_fiscal_year(b.association_id, v_date) f;
    for r in select * from public.import_rows x where x.batch_id = b.id and x.status = 'ok' order by x.row_number loop
      m := r.mapped;
      v_unit := (select u.id from public.units u where u.association_id = b.association_id and lower(u.label) = lower(btrim(m ->> 'unit_label')));
      v_created := public.record_assessment_charge(b.association_id, v_fy, v_unit, 'other', v_date, v_date, (m ->> 'amount')::numeric,
                     public.import_uuid(o ->> 'fund_id'), public.import_uuid(o ->> 'ar_account_id'), public.import_uuid(o ->> 'income_account_id'), null, 'Balance carried forward');
      update public.import_rows set status = 'committed', created_table = 'assessment_charges', created_id = v_created where id = r.id;
      v_n := v_n + 1;
    end loop;

  elsif b.kind = 'contractors' then
    for r in select * from public.import_rows x where x.batch_id = b.id and x.status = 'ok' order by x.row_number loop
      m := r.mapped;
      v_created := null;
      insert into public.vendors (association_id, name, trade, trades, email, phone, contact_name, notes, website_url)
      values (b.association_id, btrim(m ->> 'name'), nullif(btrim(m ->> 'trade'), ''),
              case when nullif(btrim(m ->> 'trade'), '') is null then '{}'::text[]
                   else array[coalesce(nullif(lower(btrim(m ->> 'trade_slug')), ''), lower(btrim(m ->> 'trade')))] end,
              nullif(lower(btrim(m ->> 'email')), ''), nullif(btrim(m ->> 'phone'), ''), nullif(btrim(m ->> 'contact_name'), ''),
              nullif(btrim(m ->> 'notes'), ''),
              -- http(s) links only (REVIEW-1 #15): add https:// to a bare domain, drop anything else.
              case when btrim(coalesce(m ->> 'website', '')) ~* '^https?://[^[:space:]]+$' then btrim(m ->> 'website')
                   when btrim(coalesce(m ->> 'website', '')) ~* '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]+)?(/[^[:space:]]*)?$'
                     then 'https://' || btrim(m ->> 'website')
                   else null end)
      on conflict (association_id, name) do nothing
      returning id into v_created;
      if v_created is null then
        update public.import_rows set status = 'duplicate' where id = r.id;
      else
        update public.import_rows set status = 'committed', created_table = 'vendors', created_id = v_created where id = r.id;
        v_n := v_n + 1;
      end if;
    end loop;

  elsif b.kind = 'units_owners' then
    v_start := (o ->> 'effective_from')::date;
    for r in select * from public.import_rows x where x.batch_id = b.id and x.status = 'ok' order by x.row_number loop
      m := r.mapped;
      v_new_unit := null; v_new_person := null; v_new_sched := null; v_created := null; v_person := null;
      select u.id into v_unit from public.units u where u.association_id = b.association_id and lower(u.label) = lower(btrim(m ->> 'unit_label'));
      if v_unit is null then
        insert into public.units (association_id, label, sort_order)
        values (b.association_id, btrim(m ->> 'unit_label'),
                coalesce((select max(u.sort_order) from public.units u where u.association_id = b.association_id), 0) + 1)
        returning id into v_new_unit;
        v_unit := v_new_unit;
      end if;

      if coalesce(btrim(m ->> 'owner_name'), '') <> '' then
        if coalesce(m ->> 'email', '') <> '' then
          select p.id into v_person from public.persons p
           where p.association_id = b.association_id and lower(p.email) = lower(btrim(m ->> 'email')) limit 1;
        end if;
        if v_person is null then
          insert into public.persons (association_id, full_name, email, phone, mailing_address)
          values (b.association_id, btrim(m ->> 'owner_name'), nullif(lower(btrim(m ->> 'email')), ''),
                  nullif(btrim(m ->> 'phone'), ''), nullif(btrim(m ->> 'mailing_address'), ''))
          returning id into v_person;
          v_new_person := v_person;
        end if;
        if coalesce((o ->> 'replace_owners')::boolean, false) then
          -- End the previous owners the day before, except anyone this file keeps on the unit.
          for c in
            select uo.id, uo.effective_to, uo.effective_from
              from public.unit_owners uo join public.persons p on p.id = uo.person_id
             where uo.unit_id = v_unit and uo.person_id <> v_person
               and (uo.effective_to is null or uo.effective_to >= v_start) and uo.effective_from < v_start
               and not exists (
                 select 1 from public.import_rows y
                  where y.batch_id = b.id and y.status in ('ok', 'committed')
                    and lower(btrim(coalesce(y.mapped ->> 'unit_label', ''))) = lower(btrim(m ->> 'unit_label'))
                    and ((coalesce(p.email, '') <> '' and lower(p.email) = lower(coalesce(y.mapped ->> 'email', '')))
                         or lower(p.full_name) = lower(btrim(coalesce(y.mapped ->> 'owner_name', '')))))
          loop
            update public.unit_owners set effective_to = greatest(v_start - 1, c.effective_from + 1) where id = c.id;
            v_closed := v_closed || jsonb_build_array(jsonb_build_object('id', c.id, 'was', c.effective_to));
          end loop;
        end if;
        if not exists (select 1 from public.unit_owners uo where uo.unit_id = v_unit and uo.person_id = v_person
                        and (uo.effective_to is null or uo.effective_to >= current_date)) then
          insert into public.unit_owners (association_id, unit_id, person_id, effective_from)
          values (b.association_id, v_unit, v_person, v_start) returning id into v_created;
        end if;
      end if;

      if coalesce(m ->> 'dues_amount', '') <> '' then
        v_freq := coalesce(o ->> 'dues_frequency', 'monthly');
        -- The amount in the file is what the unit pays each time, at the chosen frequency.
        v_total := (m ->> 'dues_amount')::numeric;
        insert into public.assessment_schedules
          (association_id, unit_id, name, frequency, fund_id, allocation_method, starts_on, is_special, total_amount, annual_amount, note)
        select b.association_id, v_unit, btrim(m ->> 'unit_label') || ' dues', v_freq,
               (select f.id from public.funds f where f.association_id = b.association_id and f.kind = 'operating' order by f.name limit 1),
               'fixed_per_unit', coalesce(public.import_date(o ->> 'dues_starts_on'), date_trunc('month', current_date)::date + interval '1 month')::date,
               false, v_total, v_total * case v_freq when 'monthly' then 12 when 'quarterly' then 4 else 1 end, 'Imported'
         where not exists (select 1 from public.assessment_schedules sc where sc.unit_id = v_unit and sc.ends_on is null and not sc.is_special)
           and exists (select 1 from public.funds f where f.association_id = b.association_id and f.kind = 'operating')
        returning id into v_new_sched;
      end if;

      update public.import_rows set status = 'committed',
             created_table = case when v_created is not null then 'unit_owners' end, created_id = v_created,
             created_unit_id = v_new_unit, created_person_id = v_new_person, created_schedule_id = v_new_sched
       where id = r.id;
      v_n := v_n + 1;
    end loop;

    -- Ownership percentages: one amendment covering every unit, or none.
    select jsonb_object_agg(k, pct) into v_pct from (
      select distinct on (lower(btrim(x.mapped ->> 'unit_label'))) lower(btrim(x.mapped ->> 'unit_label')) as k, x.mapped ->> 'ownership_percent' as pct
        from public.import_rows x
       where x.batch_id = b.id and x.status in ('committed', 'duplicate') and coalesce(x.mapped ->> 'ownership_percent', '') <> ''
       order by lower(btrim(x.mapped ->> 'unit_label')), x.row_number) q;
    if v_pct is not null and not coalesce((o ->> 'skip_percentages')::boolean, false) then
      select jsonb_agg(jsonb_build_object('unit_id', u.id, 'percentage', (v_pct ->> lower(u.label))::numeric) order by u.sort_order, u.label)
        into v_lines_pct from public.units u where u.association_id = b.association_id;
      v_amend := public.record_ownership_amendment(b.association_id, v_start, v_lines_pct,
                   coalesce(nullif(btrim(o ->> 'amendment_reason'), ''), 'Imported from a spreadsheet'), null);
      update public.import_batches set summary = summary || jsonb_build_object('amendment_id', v_amend) where id = b.id;
    end if;
    update public.import_batches set summary = summary || jsonb_build_object('closed_links', v_closed) where id = b.id;
  end if;

  -- Clear what was typed into the file: PII goes, the ids stay.
  update public.import_rows set raw = null,
         mapped = case when b.kind in ('units_owners', 'contractors') then jsonb_build_object('unit_label', mapped -> 'unit_label', 'name', mapped -> 'name') else mapped end
   where batch_id = b.id;
  update public.import_batches set status = 'committed', committed_at = now(), committed_by = auth.uid(),
         summary = summary || jsonb_build_object('created', v_n)
   where id = b.id;
  return (select summary from public.import_batches where id = b.id);
end $$;

revoke all on function public.import_commit(uuid, text) from public, anon;
grant execute on function public.import_commit(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Undo: reversals only, only while the years are open (DECISIONS #9)
-- ----------------------------------------------------------------------------

create or replace function public.import_undo(p_batch_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  b public.import_batches%rowtype;
  r record;
  v_entry uuid;
  v_amend uuid;
  v_link jsonb;
begin
  select * into b from public.import_batches where id = p_batch_id for update;
  if not found or not public.has_role_in(b.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if b.status <> 'committed' then
    raise exception 'only a committed import can be undone' using errcode = '22023';
  end if;

  if b.kind in ('transactions', 'opening_accounts', 'opening_units') then
    if exists (
         select 1
           from public.import_rows x
           left join public.expenses ex on x.created_table = 'expenses' and ex.id = x.created_id
           left join public.assessment_charges ch on x.created_table = 'assessment_charges' and ch.id = x.created_id
           join public.journal_entries je on je.id = coalesce(case when x.created_table = 'journal_entries' then x.created_id end, ex.journal_entry_id, ch.journal_entry_id)
           join public.fiscal_years fy on fy.id = je.fiscal_year_id
          where x.batch_id = b.id and x.status = 'committed' and fy.status <> 'open') then
      raise exception 'a fiscal year these entries are in has closed, so they can no longer be reversed' using errcode = '22023', hint = 'year_closed';
    end if;
    if b.kind = 'opening_units' and exists (
         select 1 from public.import_rows x join public.payment_allocations pa on pa.charge_id = x.created_id
          where x.batch_id = b.id and x.status = 'committed') then
      raise exception 'a payment has been applied to one of these balances; remove that payment first' using errcode = '22023', hint = 'in_use';
    end if;
    for r in select * from public.import_rows x where x.batch_id = b.id and x.status = 'committed' order by x.row_number desc loop
      v_entry := case r.created_table
        when 'journal_entries' then r.created_id
        when 'expenses' then (select e.journal_entry_id from public.expenses e where e.id = r.created_id)
        when 'assessment_charges' then (select c.journal_entry_id from public.assessment_charges c where c.id = r.created_id) end;
      if v_entry is not null and not exists (select 1 from public.journal_entries where reverses_entry_id = v_entry) then
        perform public.reverse_journal_entry(v_entry);
      end if;
      begin
        if r.created_table = 'expenses' then delete from public.expenses where id = r.created_id;
        elsif r.created_table = 'assessment_charges' then delete from public.assessment_charges where id = r.created_id; end if;
      exception when foreign_key_violation or restrict_violation then
        raise exception 'one of these is used elsewhere (a repair, for example); remove that link first' using errcode = '22023', hint = 'in_use';
      end;
      update public.import_rows set status = 'undone' where id = r.id;
    end loop;

  elsif b.kind = 'contractors' then
    for r in select * from public.import_rows x where x.batch_id = b.id and x.status = 'committed' and x.created_table = 'vendors' loop
      begin
        delete from public.vendors where id = r.created_id;
      exception when foreign_key_violation or restrict_violation then
        raise exception 'a contractor from this import is already used (a repair or a payment)' using errcode = '22023', hint = 'in_use';
      end;
      update public.import_rows set status = 'undone' where id = r.id;
    end loop;

  elsif b.kind = 'units_owners' then
    v_amend := nullif(b.summary ->> 'amendment_id', '')::uuid;
    begin
      if v_amend is not null then
        if exists (select 1 from public.ownership_amendments a
                    where a.association_id = b.association_id and a.id <> v_amend
                      and (a.effective_from > (select a2.effective_from from public.ownership_amendments a2 where a2.id = v_amend)
                           or (a.effective_from = (select a2.effective_from from public.ownership_amendments a2 where a2.id = v_amend)
                               and a.created_at > (select a2.created_at from public.ownership_amendments a2 where a2.id = v_amend)))) then
          raise exception 'a later ownership amendment exists; undo is not possible' using errcode = '22023', hint = 'in_use';
        end if;
        delete from public.ownership_amendment_lines where amendment_id = v_amend;
        delete from public.ownership_amendments where id = v_amend;
      end if;
      for r in select * from public.import_rows x where x.batch_id = b.id and x.status = 'committed' order by x.row_number desc loop
        if r.created_table = 'unit_owners' then delete from public.unit_owners where id = r.created_id; end if;
        if r.created_schedule_id is not null then delete from public.assessment_schedules where id = r.created_schedule_id; end if;
        if r.created_person_id is not null then delete from public.persons where id = r.created_person_id; end if;
        if r.created_unit_id is not null then delete from public.units where id = r.created_unit_id; end if;
        update public.import_rows set status = 'undone' where id = r.id;
      end loop;
      -- Owners "replace the current owner" ended come back as they were.
      for v_link in select * from jsonb_array_elements(coalesce(b.summary -> 'closed_links', '[]'::jsonb)) loop
        update public.unit_owners set effective_to = nullif(v_link ->> 'was', '')::date where id = (v_link ->> 'id')::uuid;
      end loop;
    exception when foreign_key_violation or restrict_violation then
      raise exception 'something now depends on these units or owners (a charge or a repair); remove that first' using errcode = '22023', hint = 'in_use';
    end;
  end if;

  update public.import_batches set status = 'undone', undone_at = now(), undone_by = auth.uid() where id = b.id;
end $$;

revoke all on function public.import_undo(uuid) from public, anon;
grant execute on function public.import_undo(uuid) to authenticated;
