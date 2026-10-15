# Import from spreadsheets: spec

Doug, 2026-10-14: "Import from spreadsheets. Bring in units, owners and past
transactions from Excel or CSV", to cut first-run setup time ("importing last
year's data").

This spec designs an **Import wizard under Building Info** that takes five
kinds of spreadsheet: (1) units and owners, (2) past transactions, (3) opening
balances, as two files (account balances, and what each unit owes), and (4)
contractors. Download a template (CSV or XLSX), upload through the foundation's
`DirectUpload`, map the columns, fix or skip problem rows, see exactly what
will be created, commit atomically, undo if needed. board_admin only.

It follows `docs/specs/insurance-repairs-overhaul.md` section 4 (quality bar),
`docs/DECISIONS.md` #1 to #3 (cash-basis tax), #5 (all ledger writes go through
SECURITY DEFINER RPCs), #7 (ownership amendments), #9 (posted entries are
immutable, corrections are reversals), #20 (money as text), #25 (document text
is redacted before the model), #29 (how entries reach the ledger), and the
foundation's AI and upload contracts. It depends on `owner-portal-spec.md`
(migration 0054: "claim your record" invites, used after owners are imported)
and on `money-and-reminders-spec.md` only for `email_address_ok()` (0055).

Status: design only. The SQL in section 3 was applied on a scratch PGlite
database after 0001 to 0055 and exercised with the flows listed in section 3.1
(units and owners with a conflict and percentages, contractors, opening
balances with an unbalanced then fixed file, unit balances needing a fiscal
year, transactions with unmapped categories, a wrong sign, a date on or before
the opening balance, a missing year, a duplicate within the file and across
files, undo, a repeated file, a non-admin, another association, and the repo's
lint queries) before it was
written here. Migration order: **0054 owner portal, 0055 email, 0056 imports.**

---

## 0. Contents

1. Principles, what exists today, decisions
2. The wizard: routes, steps, entry points
3. Migration `0056_imports.sql` (complete draft SQL)
4. The files: templates, columns, parsing
5. Column mapping, including AI help
6. Mapping to accounts, funds and contractors
7. Validation, the fix table, the preview
8. Commit, undo, idempotency
9. Units, owners and ownership percentages
10. Cash-basis rules and opening balances
11. Libraries and server actions
12. Pages, with copy and states
13. Security and privacy notes
14. Test plan
15. Build order
16. Integration tasks (including the setup guide)
17. Deliberately left out

---

## 1. Principles, what exists today, decisions

### 1.1 What exists today

- Everything is typed one record at a time: `addUnit`, `addPerson`,
  `changeUnitOwner`, `recordOwnershipAmendment` (`src/app/building/actions.ts`),
  `saveUnitDues` (`src/app/dues/actions.ts`), `addVendor`, and the bank feed for
  transactions (#29). The first run of a 12-unit building is an afternoon.
- The ledger has exactly one write path (`post_journal_entry`) with wrappers
  `record_expense`, `record_payment`, `record_assessment_charge`,
  `reverse_journal_entry`, `record_ownership_amendment`. `journal_entries.source`
  already allows `'import'` (0001) and `documents.source` allows `'import'` (0020).
- `exceljs` is a dependency (`src/app/budget/export/route.ts` writes XLSX).
  There is no CSV parser in the repo. `redactTaxIds()` (`src/lib/documents/redact.ts`)
  exists.
- The foundation provides `DirectUpload` (`purpose: "document"`, `read: false`
  to skip AI reading), `runStructured` with quotas, and `AiKind`.
- `create_expense_account` (0032) makes a custom expense category and **defaults
  it to tax-exempt**. The import never uses it (see decision 3).
- `cash_basis_receipts` (0006) classifies a receipt either directly (cash debit,
  income credit) or by tracing payment -> allocation -> charge -> **the income
  account that charge's entry credited**. A charge that credited anything but an
  income account makes the payment on it disappear from the 60% test. This
  governs section 10.

### 1.2 Decisions (proposed DECISIONS #39)

1. **Staging holds only the columns the board mapped.** A spare column holding a
   Social Security number or a bank account never reaches the database, or the
   AI. Raw values are cleared the moment a batch is committed or cancelled.
2. **The database is the validator and the writer.** The browser and server parse
   and normalise; `import_validate` re-validates every row against the ledger;
   `import_commit` re-validates again inside its own transaction and refuses if
   the preview digest no longer matches. Nothing is written from parsed data
   directly.
3. **No silent classification.** Every category in a transactions file is mapped
   to one of the association's accounts by a person. An unmapped row is an
   error. A new income or expense category requires an explicit answer to "does
   this count toward the association's tax-exempt activity?" with no default
   (`import_create_account`). The preview shows, per mapped account, whether it
   counts as exempt function income or exempt expenditure.
4. **Transactions go in through the ledger's own paths.** Money out to an
   expense (or a capital asset) is `record_expense`, so the budget, the 1099
   totals and the tickets' expense links see it. Everything else is one balanced
   `post_journal_entry` with `source = 'import'`. Each spreadsheet row is exactly
   one entry; debits equal credits by construction.
5. **What units owed on the cutover date is a charge per unit, not part of the
   opening entry.** Section 10 explains why (the 1120-H traces payments through
   the charge's income account). `Assessments Receivable` (1200, 1250) is refused
   in the account-balances file.
6. **Past dues deposits are income received, not payments against charges.**
   Rows with a unit and an income category become cash-debit / income-credit
   with the unit on both lines (as #29 does for deposits with nothing to apply
   to). They do not change what a unit owes now. The wizard says so.
7. **Idempotent twice over.** A file (sha-256 of its bytes) can be committed once
   per kind; every row has a hash (date, amount, description, payee, unit and
   an occurrence number) matched against rows already committed, so an
   overlapping re-export adds only the new rows. One set of opening balances at
   a time.
8. **Undo is a reversal.** Only while every entry's fiscal year is open, never
   by deletion (#9). Subsidiary rows (`expenses`, `assessment_charges`) that
   the entries created are removed so the budget and balances reflect it, as
   `unpost_bank_transaction` does. If something now depends on an imported row
   (a repair linked to an expense, a payment applied to an opening balance),
   undo refuses and says what.
9. **Ownership is never replaced silently.** A unit that already has a different
   current owner is a row error unless the board turns on "replace the current
   owner" for this import. Percentages are all-or-nothing: every unit gets a
   share and they sum to 100, or none is recorded (#7).
10. **board_admin only**, MFA-gated like every other write. A board member can
    read batches (so the board can see what was imported) but cannot import.
11. **AI is optional, narrow and reviewable.** Mapping suggestions send column
    names and character-shape masks of five sample rows, never values. The result
    is a suggestion the person confirms. Without a key the wizard works by hand.

### 1.3 New DECISIONS #39 text

> **39. Imports: staged, validated in the database, committed through the
> ledger's own paths, undone by reversal.** Decided by the lead engineer on
> Doug's behalf, 2026-10-14. Units and owners, past transactions, opening
> balances and contractors can be imported from CSV or XLSX by a board admin.
> Only the columns the board maps are kept; the rest of the file never reaches
> the database. Every category must be mapped to an account by a person, and a
> new category must be declared exempt or not exempt with no default. Rows are
> staged, validated and committed by SECURITY DEFINER functions: expenses go
> through `record_expense`, other transactions through `post_journal_entry`
> with source `import`, unit receivables through `record_assessment_charge`
> crediting an income account the board chooses (so the 1120-H, which traces a
> payment to the income account its charge credited, still counts the cash),
> ownership through `record_ownership_amendment`. A file imports once; rows are
> hash-matched so overlapping files add only what is new; one opening balance
> at a time. Undo reverses the entries (#9) only while their fiscal years are
> open and refuses if anything now depends on them. Optional AI mapping sees
> column names and character masks of sample values, never the values.

### 1.4 Decisions needed from the lead engineer

| # | Question | Default taken here |
|---|---|---|
| 1 | AI kind for mapping help: a new `import_mapping` kind (needs a constraint swap and edits to `ai_daily_limit` and `ai_quota_status`, which `tests/unit/ai-usage.test.ts` parses from 0051) or reuse `document_classify` (200 a day) | reuse `document_classify`; zero foundation churn. A new kind is a later, mechanical change |
| 2 | Keep the uploaded file in the Document Hub? | No by default (it may hold columns Walkup did not import). A checkbox "Keep a copy in the Document Hub (board only)" per import. The file is purged after staging unless kept |
| 3 | Caps | 5 MB file, 5,000 rows, 40 columns, 2,000 characters per cell, 5 open batches per association |
| 4 | Is a calendar-year fiscal year the right default for history? | `import_ensure_fiscal_year` creates calendar years only and refuses when the association's year does not end in December (the board adds it by hand) |

---

## 2. The wizard

### 2.1 Routes (all board; owners and accountants get `BoardOnly`)

| Route | What |
|---|---|
| `/building/import` | Start page: four cards (what to import), unfinished imports, history with Undo |
| `/building/import/template/[kind]` | Route handler: `?format=csv|xlsx`, returns the template (section 4.1) |
| `/building/import/new` | `?kind=...&doc={documentId}`: upload done, shows mapping (step 3) |
| `/building/import/[batchId]` | Steps 4 to 6 for a staged batch: `?step=fix|preview|done` |
| `/building/import/[batchId]/errors.csv` | Route handler: the problem rows as a CSV the board can fix and re-upload (formula-injection safe) |

Files:

```
src/app/building/import/page.tsx
src/app/building/import/loading.tsx
src/app/building/import/start-cards.tsx
src/app/building/import/history.tsx                 client (Undo)
src/app/building/import/template/[kind]/route.ts
src/app/building/import/new/page.tsx
src/app/building/import/new/upload-step.tsx          client: DirectUpload
src/app/building/import/new/mapping-step.tsx         client: columns, AI suggestion
src/app/building/import/[batchId]/page.tsx
src/app/building/import/[batchId]/options-panel.tsx  client: per-kind options + account/fund/payee mapping
src/app/building/import/[batchId]/fix-table.tsx      client: inline edit, skip
src/app/building/import/[batchId]/preview.tsx        server-safe
src/app/building/import/[batchId]/commit-bar.tsx     client
src/app/building/import/[batchId]/errors.csv/route.ts
src/app/building/import/actions.ts                   "use server"
src/lib/import/kinds.ts          field definitions per kind (pure)
src/lib/import/csv.ts            RFC 4180 reader + safe writer (pure)
src/lib/import/xlsx.ts           exceljs reader (server-only)
src/lib/import/parse-file.ts     sniff, caps, sheet choice -> ParsedFile (server-only)
src/lib/import/normalize.ts      dates, money, percent, phone, email, trade (pure)
src/lib/import/columns.ts        header synonyms and auto-detect (pure)
src/lib/import/shape.ts          character masks for AI (pure)
src/lib/import/ai-mapping.ts     runStructured wrapper (server-only)
src/lib/import/templates.ts      CSV and XLSX template builders (server-only)
src/lib/import/safe-cell.ts      formula-injection guard (pure)
src/lib/import/stage.ts          ParsedFile + mapping -> rows to stage (pure)
src/lib/import/split.ts          equalShares, percent parsing (pure)
tests/db/imports.test.ts
tests/unit/import-*.test.ts
tests/fixtures/import/*           generated in the tests with exceljs, not committed binary files
```

### 2.2 Steps

1. **Choose** what to import (cards) and download the template if wanted.
2. **Upload.** `DirectUpload purpose="document" categorySlug="other" read={false} multiple={false} maxFiles={1} accept=".csv,.xlsx"`; on success `router.push("/building/import/new?kind=...&doc=...")`.
3. **Map columns.** The server parses the stored file (headers, up to 8 sample rows, row count) and the page shows the auto-detected mapping, editable, with optional "Suggest with AI". Confirming calls `stageImport`, which re-parses, keeps only mapped columns, normalises, calls `import_start` + `import_stage_rows` + `import_set_options`, then purges the uploaded file (unless "keep a copy"), then `import_validate`.
4. **Options and mapping to the books.** Per kind: dates, funds, accounts, payees, effective dates (section 6, 9, 10). Every change re-validates.
5. **Fix.** The row table: errors first, inline edit, skip.
6. **Preview and import.** Exactly what will be created; `Import {n} rows`; then the result page with Undo.

Entry points: Building Info card `Import from a spreadsheet`; setup guide steps (section 16); the empty states of Units (`No units yet. Add them one at a time, or import a spreadsheet.`) and Contractors; the Dues page when no unit has a plan.

---

## 3. Migration `supabase/migrations/0056_imports.sql`

Complete SQL (applied after 0055). Adds `import_batches`, `import_rows`; the
helpers `import_num`, `import_date` (callable), `import_fiscal_year`,
`import_err` (internal); and the board_admin functions `import_start`,
`import_stage_rows`, `import_set_options`, `import_update_row`,
`import_set_row_decision`, `import_skip_problem_rows`, `import_cancel`, `import_validate`, `import_commit`,
`import_undo`, `import_create_account`, `import_ensure_fiscal_year`. Widens the
`document_links` target check (adds `import_batches`; includes 0054's
`announcements`).

```sql
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

create or replace function public.import_date(p text)
returns date language plpgsql immutable set search_path = ''
as $$
begin
  if p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end $$;

revoke all on function public.import_num(text) from public, anon;
revoke all on function public.import_date(text) from public, anon;
grant execute on function public.import_num(text) to authenticated;
grant execute on function public.import_date(text) to authenticated;

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
  v_id   uuid;
begin
  if not public.has_role_in(p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board admin can add a category' using errcode = '42501';
  end if;
  if p_type not in ('expense', 'income') then
    raise exception 'imports can add expense or income categories only' using errcode = '22023';
  end if;
  if p_is_exempt is null then
    raise exception 'say whether this counts toward the association''s tax-exempt activity' using errcode = '22023', hint = 'exempt_required';
  end if;
  if v_name = '' or char_length(v_name) > 80 then
    raise exception 'the name must be 1 to 80 characters' using errcode = '22023';
  end if;
  if p_type = 'expense' then
    select to_char(coalesce(max(code::int), 4990) + 10, 'FM0000') into v_code
      from public.accounts
     where association_id = p_association_id and type = 'expense' and code ~ '^[0-9]+$' and code::int < 5900;
    insert into public.accounts (association_id, code, name, type, is_cash_account, is_exempt_expenditure)
    values (p_association_id, v_code, v_name, 'expense', false, p_is_exempt) returning id into v_id;
  else
    select to_char(coalesce(max(code::int), 4190) + 10, 'FM0000') into v_code
      from public.accounts
     where association_id = p_association_id and type = 'income' and code ~ '^[0-9]+$' and code::int between 4100 and 4899;
    insert into public.accounts (association_id, code, name, type, is_cash_account, is_exempt_function_income)
    values (p_association_id, v_code, v_name, 'income', false, p_is_exempt) returning id into v_id;
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
  if p_year < 1990 or p_year > extract(year from current_date)::int + 1 then
    raise exception 'that year is out of range' using errcode = '22023';
  end if;
  select f.id into v_id from public.fiscal_years f
   where f.association_id = p_association_id and f.starts_on = make_date(p_year, 1, 1);
  if v_id is not null then return v_id; end if;
  if (select a.fiscal_year_end_month from public.associations a where a.id = p_association_id) <> 12 then
    raise exception 'add this fiscal year by hand: your year does not end in December' using errcode = '22023', hint = 'fy_not_december';
  end if;
  insert into public.fiscal_years (association_id, label, starts_on, ends_on)
  values (p_association_id, p_year::text, make_date(p_year, 1, 1), make_date(p_year, 12, 31))
  returning id into v_id;
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
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'send at most 500 rows at a time' using errcode = '22023';
  end if;
  if (select count(*) from public.import_rows r where r.batch_id = b.id) + jsonb_array_length(p_rows) > b.row_count then
    raise exception 'more rows than the file had' using errcode = '22023';
  end if;
  insert into public.import_rows (association_id, batch_id, row_number, raw, mapped, errors)
  select b.association_id, b.id, (x ->> 'row_number')::int, x -> 'raw', coalesce(x -> 'mapped', '{}'::jsonb), coalesce(x -> 'errors', '[]'::jsonb)
    from jsonb_array_elements(p_rows) x;
  get diagnostics v_n = row_count;
  update public.import_batches set status = 'uploaded' where id = b.id and status = 'validated';
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
  if p_decision not in ('import', 'skip') then raise exception 'unknown decision' using errcode = '22023'; end if;
  if not exists (select 1 from public.import_batches b where b.id = r.batch_id and b.status in ('uploaded', 'validated')) then
    raise exception 'this import is closed' using errcode = '22023';
  end if;
  update public.import_rows set decision = p_decision where id = r.id;
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
  update public.import_rows set decision = 'skip' where batch_id = b.id and status = 'error';
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
  update public.import_batches set status = 'cancelled' where id = b.id;
end $$;

revoke all on function public.import_cancel(uuid) from public, anon;
grant execute on function public.import_cancel(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Validation (the dry run). Re-run by import_commit, so a stale preview cannot
-- be committed.
-- ----------------------------------------------------------------------------

create or replace function public.import_err(p_errs jsonb, p_field text, p_code text, p_message text)
returns jsonb language sql immutable set search_path = ''
as $$ select p_errs || jsonb_build_array(jsonb_build_object('field', p_field, 'code', p_code, 'message', p_message)) $$;
revoke all on function public.import_err(jsonb, text, text, text) from public, anon, authenticated;

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
  v_occ  integer;
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
  v_acc_key text;
  v_pct numeric;
  v_unit_pct jsonb := '{}'::jsonb;
  v_as_of date;
  v_new_units integer := 0; v_new_people integer := 0;
  v_open_date date;
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
    select * into v_cash from public.accounts
     where id = nullif(o ->> 'cash_account_id', '')::uuid and association_id = b.association_id and is_cash_account and is_active;
    if v_cash.id is null then
      v_batch_errors := public.import_err(v_batch_errors, 'cash_account_id', 'cash_account_missing', 'Choose the bank or cash account these transactions went through.');
    end if;
    if not exists (select 1 from public.funds f where f.id = nullif(o ->> 'default_fund_id', '')::uuid and f.association_id = b.association_id) then
      v_batch_errors := public.import_err(v_batch_errors, 'default_fund_id', 'fund_missing', 'Choose the fund these transactions belong to.');
    end if;
    if coalesce((o ->> 'mapping_confirmed')::boolean, false) is not true then
      v_batch_errors := public.import_err(v_batch_errors, 'account_map', 'mapping_unconfirmed', 'Confirm that each category is matched to the right account. Walkup does not guess what counts toward your tax-exempt activity.');
    end if;
    select (b2.options ->> 'as_of')::date into v_open_date from public.import_batches b2
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
      if not exists (select 1 from public.accounts a where a.id = nullif(o ->> 'income_account_id', '')::uuid and a.association_id = b.association_id and a.type = 'income' and a.is_active) then
        v_batch_errors := public.import_err(v_batch_errors, 'income_account_id', 'income_account_missing', 'Choose the income account these dues were counted under. The tax return uses it when the owner pays.');
      end if;
      if not exists (select 1 from public.accounts a where a.id = nullif(o ->> 'ar_account_id', '')::uuid and a.association_id = b.association_id and a.code in ('1200', '1250') and a.is_active) then
        v_batch_errors := public.import_err(v_batch_errors, 'ar_account_id', 'ar_account_missing', 'Choose the Assessments Receivable account.');
      end if;
      if not exists (select 1 from public.funds f where f.id = nullif(o ->> 'fund_id', '')::uuid and f.association_id = b.association_id) then
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
  end if;

  -- Rows ----------------------------------------------------------------------
  for r in select * from public.import_rows x where x.batch_id = b.id order by x.row_number loop
    m := r.mapped;
    errs := '[]'::jsonb;
    v_key := null;

    if r.decision = 'skip' then
      update public.import_rows set status = 'skipped', errors = '[]'::jsonb where id = r.id;
      v_skip := v_skip + 1;
      continue;
    end if;
    -- Problems the parser already saw (an unreadable date, a missing name).
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
      select * into v_acct from public.accounts
       where id = nullif(o -> 'account_map' ->> v_acc_key, '')::uuid and association_id = b.association_id and is_active;
      if v_acc_key = '' then errs := public.import_err(errs, 'category', 'category_missing', 'This row has no category.');
      elsif v_acct.id is null then errs := public.import_err(errs, 'category', 'category_unmapped', 'Choose which of your accounts "' || left(m ->> 'category_key', 60) || '" belongs to.');
      else
        if v_acct.is_cash_account then errs := public.import_err(errs, 'category', 'transfer_not_supported', 'Moves between your own bank accounts are not imported. Skip this row; the bank feed handles transfers.');
        elsif v_acct.code in ('1200', '1250') then errs := public.import_err(errs, 'category', 'ar_not_allowed', 'Dues owed by units are tracked per unit. Import them under Opening balances, or choose an income account for money received.');
        elsif v_acct.type = 'expense' and v_amt > 0 then errs := public.import_err(errs, 'amount', 'sign_expense', 'Money coming in cannot go to an expense category.');
        elsif v_acct.type = 'income' and v_amt < 0 then errs := public.import_err(errs, 'amount', 'sign_income', 'Money going out cannot go to an income category.');
        end if;
      end if;
      if not exists (select 1 from public.funds f where f.association_id = b.association_id
           and f.id = coalesce(nullif(o -> 'fund_map' ->> lower(btrim(coalesce(m ->> 'fund_key', ''))), '')::uuid, nullif(o ->> 'default_fund_id', '')::uuid)) then
        errs := public.import_err(errs, 'fund', 'fund_unmapped', 'Choose which fund "' || left(coalesce(m ->> 'fund_key', ''), 60) || '" is.');
      end if;
      if coalesce(m ->> 'unit_label', '') <> '' and not exists (
           select 1 from public.units u where u.association_id = b.association_id and lower(u.label) = lower(btrim(m ->> 'unit_label'))) then
        errs := public.import_err(errs, 'unit', 'unit_unknown', 'There is no unit called "' || left(m ->> 'unit_label', 40) || '".');
      end if;
      if coalesce(m ->> 'payee', '') <> '' and o -> 'payee_map' ? lower(btrim(m ->> 'payee'))
         and not exists (select 1 from public.vendors v where v.association_id = b.association_id
                          and v.id = nullif(o -> 'payee_map' ->> lower(btrim(m ->> 'payee')), '')::uuid) then
        errs := public.import_err(errs, 'payee', 'payee_unknown', 'That contractor does not exist.');
      end if;
      v_key := concat_ws('|', 'tx', m ->> 'date', m ->> 'amount', lower(btrim(coalesce(m ->> 'description', ''))), lower(btrim(coalesce(m ->> 'payee', ''))), lower(btrim(coalesce(m ->> 'unit_label', ''))));

    elsif b.kind = 'units_owners' then
      if coalesce(btrim(m ->> 'unit_label'), '') = '' then errs := public.import_err(errs, 'unit_label', 'unit_missing', 'Every row needs a unit.');
      elsif char_length(btrim(m ->> 'unit_label')) > 60 then errs := public.import_err(errs, 'unit_label', 'unit_long', 'Unit names can be at most 60 characters.'); end if;
      if coalesce(btrim(m ->> 'owner_name'), '') = '' and (coalesce(m ->> 'email', '') <> '' or coalesce(m ->> 'phone', '') <> '') then
        errs := public.import_err(errs, 'owner_name', 'owner_name_missing', 'An owner needs a name.');
      end if;
      if coalesce(m ->> 'email', '') <> '' and not public.email_address_ok(lower(btrim(m ->> 'email'))) then
        errs := public.import_err(errs, 'email', 'email_bad', 'That does not look like an email address.');
      end if;
      v_pct := public.import_num(m ->> 'ownership_percent');
      if coalesce(m ->> 'ownership_percent', '') <> '' and (v_pct is null or v_pct <= 0 or v_pct > 100) then
        errs := public.import_err(errs, 'ownership_percent', 'percent_bad', 'Ownership must be a number above 0 and at most 100.');
      end if;
      if coalesce(m ->> 'dues_amount', '') <> '' and (public.import_num(m ->> 'dues_amount') is null or public.import_num(m ->> 'dues_amount') <= 0) then
        errs := public.import_err(errs, 'dues_amount', 'dues_bad', 'Dues must be an amount above 0.');
      end if;
      if coalesce(btrim(m ->> 'owner_name'), '') <> '' and not coalesce((o ->> 'replace_owners')::boolean, false) and exists (
           select 1 from public.units u
             join public.unit_owners uo on uo.unit_id = u.id and (uo.effective_to is null or uo.effective_to >= current_date)
             join public.persons p on p.id = uo.person_id
            where u.association_id = b.association_id and lower(u.label) = lower(btrim(m ->> 'unit_label'))
              and not (lower(coalesce(p.email, '')) = lower(coalesce(m ->> 'email', '')) and coalesce(p.email, '') <> ''
                       or lower(p.full_name) = lower(btrim(m ->> 'owner_name')))) then
        errs := public.import_err(errs, 'owner_name', 'owner_conflict', 'This unit already has a different owner. Use Change owner on Building Info, or turn on "replace the current owner".');
      end if;
      v_key := concat_ws('|', 'uo', lower(btrim(coalesce(m ->> 'unit_label', ''))), lower(btrim(coalesce(nullif(m ->> 'email', ''), m ->> 'owner_name', ''))));

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
         or v_amt = 0 then
        errs := public.import_err(errs, 'amount', 'amount_bad', 'Give either a debit or a credit above zero, not both.');
      end if;
      v_key := concat_ws('|', 'oa', v_acc_key, lower(btrim(coalesce(m ->> 'fund_key', ''))));

    elsif b.kind = 'opening_units' then
      select u.id into v_unit from public.units u where u.association_id = b.association_id and lower(u.label) = lower(btrim(coalesce(m ->> 'unit_label', '')));
      if v_unit is null then errs := public.import_err(errs, 'unit_label', 'unit_unknown', 'There is no unit called "' || left(coalesce(m ->> 'unit_label', ''), 40) || '".'); end if;
      v_amt := public.import_num(m ->> 'amount');
      if v_amt is null or v_amt <= 0 then errs := public.import_err(errs, 'amount', 'amount_bad', 'Enter what the unit owed, above zero. Credits are not imported here.'); end if;
      v_key := concat_ws('|', 'ou', lower(btrim(coalesce(m ->> 'unit_label', ''))), m ->> 'amount');

    elsif b.kind = 'contractors' then
      if coalesce(btrim(m ->> 'name'), '') = '' then errs := public.import_err(errs, 'name', 'name_missing', 'Every contractor needs a name.');
      elsif char_length(btrim(m ->> 'name')) > 120 then errs := public.import_err(errs, 'name', 'name_long', 'Names can be at most 120 characters.'); end if;
      if coalesce(m ->> 'email', '') <> '' and not public.email_address_ok(lower(btrim(m ->> 'email'))) then
        errs := public.import_err(errs, 'email', 'email_bad', 'That does not look like an email address.');
      end if;
      if m ? 'tin' then errs := public.import_err(errs, 'tin', 'tin_not_accepted', 'Tax ID numbers are never imported. Walkup keeps the last four digits from the W-9.'); end if;
      v_key := concat_ws('|', 'vn', lower(btrim(coalesce(m ->> 'name', ''))));
    end if;

    -- Duplicates: the Nth identical row in this file, and anything already imported.
    v_hash := null;
    if v_key is not null then
      select count(*) into v_occ from public.import_rows y
       where y.batch_id = b.id and y.row_number <= r.row_number and y.decision = 'import'
         and (case b.kind
                when 'transactions' then concat_ws('|', 'tx', y.mapped ->> 'date', y.mapped ->> 'amount', lower(btrim(coalesce(y.mapped ->> 'description', ''))), lower(btrim(coalesce(y.mapped ->> 'payee', ''))), lower(btrim(coalesce(y.mapped ->> 'unit_label', ''))))
                when 'units_owners' then concat_ws('|', 'uo', lower(btrim(coalesce(y.mapped ->> 'unit_label', ''))), lower(btrim(coalesce(nullif(y.mapped ->> 'email', ''), y.mapped ->> 'owner_name', ''))))
                when 'opening_accounts' then concat_ws('|', 'oa', lower(btrim(coalesce(y.mapped ->> 'account_key', ''))), lower(btrim(coalesce(y.mapped ->> 'fund_key', ''))))
                when 'opening_units' then concat_ws('|', 'ou', lower(btrim(coalesce(y.mapped ->> 'unit_label', ''))), y.mapped ->> 'amount')
                else concat_ws('|', 'vn', lower(btrim(coalesce(y.mapped ->> 'name', '')))) end) = v_key;
      v_hash := encode(sha256(convert_to(v_key || '#' || v_occ::text, 'UTF8')), 'hex');
    end if;

    if jsonb_array_length(errs) > 0 then
      update public.import_rows set status = 'error', errors = errs, row_hash = v_hash where id = r.id;
      v_bad := v_bad + 1;
    elsif v_hash is not null and exists (
           select 1 from public.import_rows z join public.import_batches zb on zb.id = z.batch_id
            where zb.association_id = b.association_id and zb.kind = b.kind and zb.status = 'committed'
              and z.status = 'committed' and z.row_hash = v_hash)
          and b.kind not in ('opening_accounts', 'opening_units') then
      update public.import_rows set status = 'duplicate', errors = '[]'::jsonb, row_hash = v_hash where id = r.id;
      v_dup := v_dup + 1;
    else
      update public.import_rows set status = 'ok', errors = '[]'::jsonb, row_hash = v_hash where id = r.id;
      v_ok := v_ok + 1;
      if b.kind = 'transactions' then
        if v_amt > 0 then v_in := v_in + v_amt; else v_out := v_out - v_amt; end if;
        v_by := jsonb_set(v_by, array[v_acct.id::text], jsonb_build_object(
          'account', v_acct.code || ' ' || v_acct.name, 'type', v_acct.type,
          'exempt', case v_acct.type when 'income' then v_acct.is_exempt_function_income when 'expense' then v_acct.is_exempt_expenditure else null end,
          'count', coalesce((v_by -> v_acct.id::text ->> 'count')::int, 0) + 1,
          'total', (coalesce((v_by -> v_acct.id::text ->> 'total')::numeric, 0) + abs(v_amt))::numeric(14,2)::text));
      elsif b.kind = 'opening_accounts' then
        if v_amt > 0 then v_deb := v_deb + v_amt; else v_cre := v_cre - v_amt; end if;
      elsif b.kind = 'opening_units' then
        v_in := v_in + v_amt;
      elsif b.kind = 'units_owners' then
        v_pct := public.import_num(m ->> 'ownership_percent');
        if v_pct is not null then
          if v_unit_pct ? lower(btrim(m ->> 'unit_label')) and (v_unit_pct ->> lower(btrim(m ->> 'unit_label')))::numeric <> v_pct then
            v_batch_errors := public.import_err(v_batch_errors, 'ownership_percent', 'percent_conflict', 'Unit "' || (m ->> 'unit_label') || '" has two different ownership percentages.');
          end if;
          v_unit_pct := jsonb_set(v_unit_pct, array[lower(btrim(m ->> 'unit_label'))], to_jsonb(v_pct::text));
        end if;
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
    if (select count(*) from (
          select lower(u.label) l from public.units u where u.association_id = b.association_id
          union
          select lower(btrim(x.mapped ->> 'unit_label')) from public.import_rows x
           where x.batch_id = b.id and x.status = 'ok') s
         where not v_unit_pct ? s.l) > 0 then
      v_batch_errors := public.import_err(v_batch_errors, 'ownership_percent', 'percent_incomplete', 'Give an ownership percentage for every unit, or for none. Percentages must cover all units.');
    elsif abs(v_pct_total - 100) > 0.000001 then
      v_batch_errors := public.import_err(v_batch_errors, 'ownership_percent', 'percent_sum', 'Ownership percentages add up to ' || v_pct_total::text || ', not 100.');
    end if;
  end if;
  if b.kind = 'units_owners' then
    select count(distinct lower(btrim(x.mapped ->> 'unit_label'))) into v_new_units from public.import_rows x
     where x.batch_id = b.id and x.status = 'ok'
       and not exists (select 1 from public.units u where u.association_id = b.association_id and lower(u.label) = lower(btrim(x.mapped ->> 'unit_label')));
    select count(distinct coalesce(nullif(lower(x.mapped ->> 'email'), ''), lower(x.mapped ->> 'owner_name'))) into v_new_people from public.import_rows x
     where x.batch_id = b.id and x.status = 'ok' and coalesce(btrim(x.mapped ->> 'owner_name'), '') <> ''
       and not exists (select 1 from public.persons p where p.association_id = b.association_id
                        and lower(coalesce(p.email, '')) = lower(coalesce(nullif(x.mapped ->> 'email', ''), '-')));
  end if;

  v_cnt := jsonb_build_object('rows', b.row_count, 'ok', v_ok, 'errors', v_bad, 'duplicates', v_dup, 'skipped', v_skip);
  v_digest := encode(sha256(convert_to(
      coalesce((select string_agg(x.id::text || x.row_hash || x.decision, ',' order by x.row_number) from public.import_rows x where x.batch_id = b.id and x.status = 'ok'), '')
      || b.options::text || v_batch_errors::text, 'UTF8')), 'hex');

  update public.import_batches set status = 'validated', digest = v_digest,
    summary = jsonb_build_object('counts', v_cnt, 'batch_errors', v_batch_errors,
      'money_in', v_in::numeric(14,2)::text, 'money_out', v_out::numeric(14,2)::text,
      'debits', case when b.kind = 'opening_accounts' then v_deb::numeric(14,2)::text end,
      'credits', case when b.kind = 'opening_accounts' then v_cre::numeric(14,2)::text end,
      'unit_total', case when b.kind = 'opening_units' then v_in::numeric(14,2)::text end,
      'by_account', v_by, 'new_units', v_new_units, 'new_people', v_new_people)
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
  v_sched uuid;
  v_start date;
  v_new_unit uuid; v_new_person uuid; v_new_sched uuid;
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
    v_cash := (o ->> 'cash_account_id')::uuid;
    for r in select * from public.import_rows x where x.batch_id = b.id and x.status = 'ok' order by x.row_number loop
      m := r.mapped;
      v_date := (m ->> 'date')::date;
      v_amt := (m ->> 'amount')::numeric;
      select f.id into v_fy from public.import_fiscal_year(b.association_id, v_date) f;
      select * into v_acct from public.accounts where id = (o -> 'account_map' ->> lower(btrim(m ->> 'category_key')))::uuid;
      v_fund := coalesce(nullif(o -> 'fund_map' ->> lower(btrim(coalesce(m ->> 'fund_key', ''))), '')::uuid, (o ->> 'default_fund_id')::uuid);
      v_unit := (select u.id from public.units u where u.association_id = b.association_id and lower(u.label) = lower(btrim(coalesce(m ->> 'unit_label', ''))));
      v_vendor := nullif(o -> 'payee_map' ->> lower(btrim(coalesce(m ->> 'payee', ''))), '')::uuid;
      if v_acct.type in ('expense') or (v_acct.type = 'asset' and v_amt < 0) then
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
                     (o ->> 'fund_id')::uuid, (o ->> 'ar_account_id')::uuid, (o ->> 'income_account_id')::uuid, null, 'Balance carried forward');
      update public.import_rows set status = 'committed', created_table = 'assessment_charges', created_id = v_created where id = r.id;
      v_n := v_n + 1;
    end loop;

  elsif b.kind = 'contractors' then
    for r in select * from public.import_rows x where x.batch_id = b.id and x.status = 'ok' order by x.row_number loop
      m := r.mapped;
      insert into public.vendors (association_id, name, trade, trades, email, phone, contact_name, notes, website_url)
      values (b.association_id, btrim(m ->> 'name'), nullif(btrim(m ->> 'trade'), ''),
              case when nullif(btrim(m ->> 'trade'), '') is null then '{}'::text[] else array[lower(btrim(m ->> 'trade'))] end,
              nullif(lower(btrim(m ->> 'email')), ''), nullif(btrim(m ->> 'phone'), ''), nullif(btrim(m ->> 'contact_name'), ''),
              nullif(btrim(m ->> 'notes'), ''), nullif(btrim(m ->> 'website'), ''))
      on conflict (association_id, name) do nothing
      returning id into v_created;
      if v_created is null then
        update public.import_rows set status = 'duplicate' where id = r.id;
      else
        update public.import_rows set status = 'committed', created_table = 'vendors', created_id = v_created where id = r.id;
        v_n := v_n + 1;
      end if;
      v_created := null;
    end loop;

  elsif b.kind = 'units_owners' then
    v_start := (o ->> 'effective_from')::date;
    for r in select * from public.import_rows x where x.batch_id = b.id and x.status = 'ok' order by x.row_number loop
      m := r.mapped;
      v_new_unit := null; v_new_person := null; v_new_sched := null; v_created := null;
      insert into public.units (association_id, label, sort_order)
      values (b.association_id, btrim(m ->> 'unit_label'),
              coalesce((select max(u.sort_order) from public.units u where u.association_id = b.association_id), 0) + 1)
      on conflict (association_id, label) do nothing
      returning id into v_new_unit;
      select u.id into v_unit from public.units u where u.association_id = b.association_id and lower(u.label) = lower(btrim(m ->> 'unit_label'));

      if coalesce(btrim(m ->> 'owner_name'), '') <> '' then
        v_person := null;
        if coalesce(m ->> 'email', '') <> '' then
          select p.id into v_person from public.persons p
           where p.association_id = b.association_id and lower(p.email) = lower(btrim(m ->> 'email'));
        end if;
        if v_person is null then
          insert into public.persons (association_id, full_name, email, phone, mailing_address)
          values (b.association_id, btrim(m ->> 'owner_name'), nullif(lower(btrim(m ->> 'email')), ''),
                  nullif(btrim(m ->> 'phone'), ''), nullif(btrim(m ->> 'mailing_address'), ''))
          returning id into v_person;
          v_new_person := v_person;
        end if;
        if coalesce((o ->> 'replace_owners')::boolean, false) then
          update public.unit_owners set effective_to = v_start - 1
           where unit_id = v_unit and person_id <> v_person and (effective_to is null or effective_to >= v_start)
             and effective_from < v_start;
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
               (select f.id from public.funds f where f.association_id = b.association_id and f.kind = 'operating' limit 1),
               'fixed_per_unit', coalesce(public.import_date(o ->> 'dues_starts_on'), date_trunc('month', current_date)::date),
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
    select jsonb_object_agg(lower(btrim(x.mapped ->> 'unit_label')), x.mapped ->> 'ownership_percent') into v_pct
      from public.import_rows x where x.batch_id = b.id and x.status = 'committed' and coalesce(x.mapped ->> 'ownership_percent', '') <> '';
    if v_pct is not null and not coalesce((o ->> 'skip_percentages')::boolean, false) then
      select jsonb_agg(jsonb_build_object('unit_id', u.id, 'percentage', (v_pct ->> lower(u.label))::numeric) order by u.sort_order)
        into v_lines_pct from public.units u where u.association_id = b.association_id;
      v_amend := public.record_ownership_amendment(b.association_id, v_start, v_lines_pct,
                   coalesce(nullif(btrim(o ->> 'amendment_reason'), ''), 'Imported from a spreadsheet'), null);
      update public.import_batches set summary = summary || jsonb_build_object('amendment_id', v_amend) where id = b.id;
    end if;
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
      exception when foreign_key_violation then
        raise exception 'one of these is used elsewhere (a repair, for example); remove that link first' using errcode = '22023', hint = 'in_use';
      end;
      update public.import_rows set status = 'undone' where id = r.id;
    end loop;

  elsif b.kind = 'contractors' then
    for r in select * from public.import_rows x where x.batch_id = b.id and x.status = 'committed' and x.created_table = 'vendors' loop
      begin
        delete from public.vendors where id = r.created_id;
      exception when foreign_key_violation then
        raise exception 'a contractor from this import is already used (a repair or a payment)' using errcode = '22023', hint = 'in_use';
      end;
      update public.import_rows set status = 'undone' where id = r.id;
    end loop;

  elsif b.kind = 'units_owners' then
    v_amend := nullif(b.summary ->> 'amendment_id', '')::uuid;
    begin
      if v_amend is not null then
        if exists (select 1 from public.ownership_amendments a
                    where a.association_id = b.association_id
                      and a.effective_from > (select a2.effective_from from public.ownership_amendments a2 where a2.id = v_amend)) then
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
    exception when foreign_key_violation then
      raise exception 'something now depends on these units or owners (a charge or a repair); remove that first' using errcode = '22023', hint = 'in_use';
    end;
  end if;

  update public.import_batches set status = 'undone', undone_at = now(), undone_by = auth.uid() where id = b.id;
end $$;

revoke all on function public.import_undo(uuid) from public, anon;
grant execute on function public.import_undo(uuid) to authenticated;
```

### 3.1 What was exercised

Units and owners (new unit and owner, a conflicting owner refused, percentages
incomplete then skipped, dues plan created, undo removes the new
unit/person/plan/owner link); contractors (duplicate name in file,
missing name, trades array); opening balances (unbalanced refused with both
totals, a receivable account refused, fixed by editing a row, committed as one
entry, trial balance correct); unit balances (missing fiscal year, ensured,
charge posted, Ada's statement then shows 620.50, the sum of an existing 500.00
and the import); transactions (unmapped category, a date before any fiscal year,
a wrong sign, a Zelle-style deposit with a unit, a duplicate row in the file
both imported because they are separate transactions, committed, the deposit
visible in `cash_basis_receipts` as a direct receipt of account 4000, the expense
in `expenses`, undo reversing both and removing the expense row); overlapping
re-upload (three rows matched as duplicates, two new rows ok); the same file
twice (refused with the earlier batch id in the hint); a non-admin and another
association refused; lint queries all clean.

### 3.2 Notes

- **Why the commit re-validates.** The preview digest (a hash of the ok rows,
  their decisions and the options) is checked twice: against the stored one and
  against a fresh run inside the commit transaction. If a unit was added, a year
  closed or an account deactivated since the preview, the commit refuses with
  hint `preview_stale` and the page re-runs the preview.
- **Why `import_rows.raw` exists at all.** It holds only mapped columns' original
  text so the fix table can show what the file said next to the cleaned value; it
  is nulled at commit or cancel, and the PII-bearing `mapped` fields of
  people-kind rows are reduced to the unit label or name.
- **Opening balances once.** The partial unique index
  `import_batches_opening_once` allows one committed `opening_accounts` and one
  `opening_units` batch per association; undo the first to redo it.
- **Capital items.** An imported money-out row mapped to a non-cash asset account
  goes through `record_expense` with `p_is_capitalized = true`, which is how
  #2 and the cash-basis 90% numerator treat it (credit to cash classified by the
  asset debit leg).
- **Tax IDs.** The `contractors` validator refuses a mapped `tin` key
  (`tin_not_accepted`); the application never maps one (section 13).
- **No transfers.** A row whose account is a cash account is refused
  (`transfer_not_supported`): operating-to-reserve moves need the other fund and
  belong to the bank feed's transfer path (#29).

---

## 4. The files

### 4.1 Templates

Download: `/building/import/template/[kind]?format=csv|xlsx`, where `kind` is
`units-owners`, `transactions`, `opening-accounts`, `opening-units` or
`contractors`. Board only (403 JSON otherwise). Built by
`src/lib/import/templates.ts`; contents are static text and a few example rows,
so nothing user-supplied is ever written, but every cell still passes
`safeCell()` (4.4). Filenames: `walkup-units-and-owners.csv`, `walkup-past-transactions.xlsx`, and so on.

**XLSX layout** (exceljs `Workbook`): sheet `Read me` first (plain instructions, wrapped text, column width 90), then sheet `Data`: header row 1 in bold, navy fill, white text, frozen; two or three example rows in grey italics, with a cell comment on A1 saying `Delete the example rows before you upload`. Column widths set, dates formatted `yyyy-mm-dd`, money columns `#,##0.00`. The template is built for this building: `buildTemplate(kind, format, { fundNames, unitLabels, accountLabels })` adds dropdown validation lists to the `Fund`, `Unit` and (for opening balances) `Account` columns from the association's own data. Opening-balance workbooks carry both sheets, `Account balances` and `Unit balances`; the parser picks the sheet by the kind. CSV: UTF-8 with a BOM (so Excel shows accents), CRLF, only the data content.

**1. Units and owners**

| Column | Required | Meaning | Example |
|---|---|---|---|
| `Unit` | yes | The label owners use | `Unit 1` |
| `Owner name` | no | Full name. Repeat the unit on a second row for a co-owner | `Ada Okonkwo` |
| `Email` | no | | `ada@example.com` |
| `Phone` | no | | `312-555-0142` |
| `Mailing address` | no | If different from the unit | `PO Box 12, Chicago IL 60647` |
| `Ownership %` | no | Share of the common elements. For every unit, or for none. Put it on the unit's first row | `33.3333` |
| `Dues amount` | no | What the unit pays each time (monthly, quarterly or yearly, chosen in the wizard) | `350.00` |

Read me text: `One row per owner. A unit with two owners has two rows with the same Unit. Ownership % must add up to 100 across all your units, or be left empty for all of them. Dues amount sets the unit's dues plan; nothing is charged until you charge it on the HOA Dues page.`

**2. Past transactions**

| Column | Required | Meaning | Example |
|---|---|---|---|
| `Date` | yes | When the money moved | `2025-03-14` |
| `Description` | yes | What it was | `Boiler repair, Acme Plumbing` |
| `Amount` | yes | Money in is positive, money out is negative. (A file with separate Deposits and Withdrawals columns works too; map those instead.) | `-450.00` |
| `Payee` | no | Who was paid or who paid | `Acme Plumbing` |
| `Category` | yes | The category or account name or code from your old books | `Repairs` |
| `Fund` | no | Operating or Reserve. Leave empty to use one fund for the whole file | `Operating` |
| `Unit` | no | For dues received from a unit | `Unit 2` |

Read me text: `One row per bank transaction. Do not include transfers between your own accounts. Do not include anything on or before the date of your opening balance. You will choose which of your accounts each category belongs to; Walkup will not guess.`

**3a. Opening balances: accounts** (`opening-accounts`)

| Column | Required | Meaning | Example |
|---|---|---|---|
| `Account` | yes | An account name or code from Walkup's chart of accounts | `1000` or `Operating Cash` |
| `Fund` | yes | `Operating`, `Reserve` (as named in Walkup) | `Operating` |
| `Debit` | one of | Money or assets you had, and what is owed to you other than dues | `18400.00` |
| `Credit` | one of | What you owed, and your fund balance | `17200.00` |

Read me text: `As of one date, list what the association had and owed. Total debits must equal total credits; the Fund balance lines make up the difference. Do not list Assessments Receivable here: put what each unit owed on the Unit balances sheet.`

**3b. Opening balances: what each unit owed** (`opening-units`)

| Column | Required | Meaning | Example |
|---|---|---|---|
| `Unit` | yes | | `Unit 2` |
| `Amount owed` | yes | What the unit owed on the opening date. Leave out units that owed nothing | `750.00` |

**4. Contractors**

| Column | Required | Meaning | Example |
|---|---|---|---|
| `Name` | yes | Business or person | `Acme Plumbing` |
| `Trade` | no | `Plumbing`, `Electrical`, `Roofing`... | `Plumbing` |
| `Contact name` | no | | `Sam Rivera` |
| `Email` | no | | `sam@acme.example` |
| `Phone` | no | | `773-555-0100` |
| `Website` | no | | `acme.example` |
| `Notes` | no | | `Did the boiler in 2024` |

Read me text adds: `Do not put tax ID numbers (SSN or EIN) in this file. Walkup keeps only the last four digits, taken from the W-9 you file with the contractor.`

### 4.2 Parsing: `src/lib/import/parse-file.ts` (server-only)

```ts
export interface ParsedFile {
  kind: "csv" | "xlsx";
  sheetName: string | null;            // xlsx
  headers: string[];                   // as typed, trimmed, blanks named "(column C)"
  rows: string[][];                    // every data row as normalised text (see cell rules); length <= 5000
  rowCount: number;
  sha256: string;                      // of the file bytes
  warnings: string[];                  // "Read 4,812 rows. 3 empty rows were skipped."
}
export type ParseResult =
  | { ok: true; file: ParsedFile }
  | { ok: false; error: string };

export async function parseImportFile(bytes: Uint8Array, filename: string, opts: { kindHint?: ImportKind }): Promise<ParseResult>;
```

Caps and refusals (exact messages):

| Check | Message |
|---|---|
| bytes over 5 MB | `That file is larger than 5 MB. Split it, or remove columns you don't need.` |
| extension not `.csv` / `.xlsx` (case-insensitive), or content not matching | `Upload a .csv or .xlsx file. Older .xls and macro files (.xlsm) are not supported: open the file and Save As .xlsx or .csv.` |
| `.xlsx` without the `PK` zip signature, or `.csv` containing NUL bytes | `That doesn't look like a spreadsheet. Try saving it again as .xlsx or .csv.` |
| xlsx zip central directory: more than 300 entries or declared uncompressed size over 60 MB | `That spreadsheet is unusually large inside. Save a plain copy and try again.` (a pure `zipStats(bytes)` reads the end-of-central-directory record before exceljs loads anything) |
| more than 5,000 data rows | `That file has {n} rows. Walkup imports up to 5,000 at a time. Split it by year.` |
| more than 40 columns | `That file has {n} columns. Remove the ones you don't need and try again.` |
| no header row / no data rows | `We couldn't find a header row and data. The first row should be the column names.` |
| a cell over 2,000 characters | row error `parse_cell_long`: `A cell is too long to be a normal entry.` (the row is staged with the cell cut to 200 characters) |
| a formula cell with no saved result | row error `parse_formula`: `This cell is a formula with no saved value. Open the file, copy and paste values, and save it again.` |

**XLSX** (exceljs `Workbook.xlsx.load`, never evaluating anything): the sheet is chosen by name (`Data`, then `Transactions`, the kind's own name, then the first sheet with at least two non-empty rows). Cell values arrive as `Date` (UTC midnight; converted with `toISOString().slice(0, 10)`), `number`, `string`, `boolean`, `{ formula, result }` (use `result`; if `result` is undefined or an error object it is the `parse_formula` row error), `{ richText: [...] }` (join the `text` parts), `{ text, hyperlink }` (use `text`), `{ error }` (treated as empty with a `parse_formula` error). Verified against exceljs on 2026-10-14. A merged cell is read as its master only. Hidden rows are read like any other (the warning says so if any are hidden).

**CSV** (`csv.ts`, about 80 lines, no dependency): RFC 4180 (quotes, doubled quotes, CRLF/LF/CR in quoted fields), BOM stripped, delimiter chosen from `,` `;` `\t` by counting unquoted occurrences in the first 5 lines (ties go to comma), UTF-8 first; if the bytes are not valid UTF-8, decode as windows-1252 and add the warning `Read as Windows text. Check that names with accents look right.` Blank lines skipped; ragged rows padded or flagged (`A row has more cells than the header: extra cells were ignored.`).

**Cell text rule** (xlsx and csv): `String(value).replace(/\s+/g, " ").trim()`; control characters other than tab/newline removed; a leading `'` that Excel adds to force text is removed.

### 4.3 Normalisers: `src/lib/import/normalize.ts` (pure)

```ts
export function normalizeDate(text: string, hint: "mdy" | "dmy" | "ymd" | "auto"): { ok: true; iso: string } | { ok: false };
// accepts 2026-02-03, 2/3/2026, 02/03/26 (two-digit years 00-69 -> 20xx, 70-99 -> 19xx), "Feb 3, 2026", "3 Feb 2026", an Excel serial number (days since 1899-12-30, 1 to 60000)
// US month-first for slashes unless hint says otherwise; "auto" picks dmy only when a day above 12 appears in the first position of any value in the column.
export function normalizeMoney(text: string): { ok: true; text: string /* "-1234.50" */ } | { ok: false };
// strips $, spaces and thousands commas; (1,234.50) -> -1234.50; trailing minus "123.45-" -> negative; "CR"/"DR" suffix rejected;
// more than two decimals rejected (no silent rounding); European "1.234,50" rejected with the message "That amount uses a comma for decimals. Change it to 1234.50."
export function normalizePercent(texts: string[]): { ok: true; values: (string | null)[]; asFraction: boolean } | { ok: false; error: string };
// column-level: "25", "25%", "25.5" are points. If every non-empty value is at most 1 and they sum to between 0.99 and 1.01, treat as fractions and multiply by 100 (asFraction true, the page says so). A mix is an error: "Some ownership values look like fractions and some like percents."
export function normalizePhone(text: string): string;     // digits, spaces, + ( ) - . x kept; trimmed to 40; no reformatting
export function normalizeEmail(text: string): string;     // lowercase, trimmed, a leading "mailto:" removed, and "Name <a@b.c>" reduced to a@b.c
export function normalizeTrade(text: string): string | null;   // keyword map shared with src/lib/contractors/trades.ts (plumb->plumbing ...); unknown -> the typed text lowercased (stored in vendors.trades as typed, shown as typed)
export function normalizeKey(text: string): string;       // lower, trim, collapse spaces: the key for category/fund/payee/unit maps
```
Money in the staged `mapped` JSON is always the normalised decimal string; no JavaScript number ever represents an amount (DECISIONS #20). Cents arithmetic in the preview uses `toCents`/`fromCents`.

### 4.4 Formula-injection guard: `src/lib/import/safe-cell.ts` (pure)

```ts
export function safeCell(value: string | number | null): string | number;
// numbers pass through. A string whose first character is = + - @ TAB CR LF (after trimming leading spaces) and that is not a plain number
// (/^-?\d+(\.\d+)?$/) is returned with a leading apostrophe-free guard: a single quote prefix: "'" + value. (Excel and Sheets show the text without the quote.)
export function csvLine(cells: (string | number | null)[]): string;     // safeCell on each, then RFC 4180 quoting for , " CR LF
export function toXlsxCell(v: string | number | null): ExcelJS.CellValue;   // strings written as plain strings (never { formula }), safeCell applied
```
Used by: the templates, the `errors.csv` export, and any future download that contains typed text. A test feeds `=HYPERLINK(...)`, `+1+1`, `-2+3`, `@SUM(A1)`, `\t=1`, `\r=1` and a normal negative number.

---

## 5. Column mapping

### 5.1 Fields per kind (`src/lib/import/kinds.ts`)

```ts
export type ImportKind = "units_owners" | "transactions" | "opening_accounts" | "opening_units" | "contractors";

export interface FieldDef {
  key: string;                   // the key used in import_rows.mapped
  label: string;                 // shown to the person
  required: boolean | "oneOf:amount|money_in+money_out" | "oneOf:debit|credit";
  kind: "text" | "email" | "phone" | "date" | "money" | "percent" | "unit" | "category" | "fund";
  help: string;
  synonyms: string[];            // normalised header phrases, in priority order
}
export const FIELDS: Record<ImportKind, FieldDef[]>;
export const KIND_LABEL: Record<ImportKind, string>;   // "Units and owners", "Past transactions", "Opening balances: accounts", "Opening balances: what each unit owed", "Contractors"
```
Staged `mapped` keys (these are what the SQL reads): units_owners `unit_label, owner_name, email, phone, mailing_address, ownership_percent, dues_amount`; transactions `date, description, amount, payee, category_key, fund_key, unit_label`; opening_accounts `account_key, fund_key, debit, credit`; opening_units `unit_label, amount`; contractors `name, trade, contact_name, email, phone, website, notes`.
(`transactions.amount` is the signed result; when the file has `money_in` and `money_out` columns, `stage.ts` computes `amount = in - out` in cents and reports `parse_amount_conflict` when both are filled in one row: `This row has both a deposit and a withdrawal.`)

Synonyms (normalised: lowercase, punctuation to spaces, collapsed):

| Field | Synonyms |
|---|---|
| `unit_label` | unit, unit number, unit no, unit label, unit #, apt, apartment, suite, condo, property, home |
| `owner_name` | owner, owner name, owners, name, full name, resident, homeowner, member, owner 1 |
| `email` | email, e mail, email address, owner email, contact email |
| `phone` | phone, phone number, telephone, tel, mobile, cell, contact phone |
| `mailing_address` | mailing address, address, mail address, owner address, billing address |
| `ownership_percent` | ownership, ownership %, % ownership, percent, percentage, share, interest, common interest, undivided interest |
| `dues_amount` | dues, dues amount, assessment, monthly dues, monthly assessment, regular assessment, hoa fee, fee |
| `date` | date, transaction date, trans date, posted, posted date, post date, paid on, check date |
| `description` | description, memo, details, narrative, transaction, note |
| `amount` | amount, total, value, net |
| `money_in` | deposit, deposits, credit, credits, money in, received, in |
| `money_out` | withdrawal, withdrawals, debit, debits, money out, paid, out |
| `payee` | payee, vendor, paid to, merchant, supplier, contractor |
| `category_key` | category, account, account name, class, gl account, gl code, code |
| `fund_key` | fund, fund name |
| `account_key` | account, account name, gl account, account code, code |
| `debit` / `credit` | debit / credit |
| `name` (contractors) | name, company, business, vendor, contractor |
| `trade` | trade, service, services, type, specialty |
| `contact_name` | contact, contact name, person |
| `website` | website, web, url, site |
| `notes` | notes, comments, comment, remarks |

### 5.2 Detection: `src/lib/import/columns.ts` (pure)

```ts
export interface DetectedColumn { field: string; header: string; index: number; score: number; reason: "exact" | "contains" | "values" }
export function detectColumns(kind: ImportKind, headers: string[], sampleRows: string[][]): {
  mapping: Record<string, number | null>;      // field key -> column index
  detected: DetectedColumn[];
  unmapped: { index: number; header: string; sensitive: boolean }[];
};
export function isSensitiveHeader(header: string): boolean;
// /\b(ssn|social( security)?|tin|ein|itin|tax ?id|taxpayer|routing|account (number|no)|acct|bank account|card|cvv|password|pin)\b/i
```
Scoring: normalised exact synonym 1.0; header contains a synonym as a whole-word phrase 0.8; synonym contains the header (header at least 4 characters) 0.6; below 0.6 no match. Each header and each field is used at most once, highest score first, ties go to the earlier column. A header with no match is sniffed by its values (all of the first 8 non-empty values parse as dates -> `date`; all look like emails -> `email`; all like `$`-or-plain money -> `amount`; only used when the field is still free; `reason: "values"`, score 0.5, shown as `Guess`). Sensitive headers are never auto-mapped and cannot be mapped by hand (the select omits them); their sample cells are hidden (`Hidden: looks like a tax ID or account number`).

### 5.3 Optional AI help: `src/lib/import/ai-mapping.ts` (server-only)

```ts
export const aiMappingSchema = z.object({
  mappings: z.array(z.object({
    field: z.string(),
    header: z.string().nullable(),
    confidence: z.enum(["high", "medium", "low"]),
  })).max(20),
});

export async function suggestMapping(opts: {
  supabase: Supabase; associationId: string; kind: ImportKind;
  headers: string[]; sampleRows: string[][];            // the real rows; shaped inside this function
}): Promise<
  | { ok: true; suggestion: { field: string; header: string; confidence: "high" | "medium" | "low" }[]; sent: AiPreview }
  | { ok: false; reason: string; configured: boolean; quota?: boolean }
>;
export interface AiPreview { headers: string[]; masks: string[][] }    // exactly what was sent, shown to the person
```
What is sent (and nothing else): the kind's field list with each field's label and help, the **headers** (any header that looks like data, meaning it contains `@`, has seven or more digits or is over 60 characters, is replaced with `[column N]`; sensitive headers are replaced with `[column N]`), and **masks** of up to five non-empty sample rows, where each cell is replaced by `shapeOf(cell)`:

```ts
// src/lib/import/shape.ts (pure)
export function shapeOf(cell: string): string;
// letters -> x (lowercase) or X (uppercase), digits -> 9, runs of whitespace -> one space,
// kept as they are: . , - / ( ) $ % @ : # + & '  ; any other character -> ?
// cut to 24 characters, then "..." if cut.
// "Dee Park" -> "Xxx Xxxx"; "ada@example.com" -> "xxx@xxxxxxx.xxx"; "312-555-0142" -> "999-999-9999";
// "$1,234.50" -> "$9,999.99"; "2026-02-03" -> "9999-99-99"; "Boiler repair, Acme Plumbing" -> "Xxxxxx xxxxxx, Xxxx Xxxxxxxx" cut to 24 + "..."
export function maskRows(rows: string[][], maxRows = 5): string[][];
```
System prompt (exact): `You match spreadsheet columns to fields. You are given the column names and, for a few rows, a mask of each cell where letters are x or X and digits are 9. You never see the real values. For each field, name the column that holds it, or null when no column fits. Use each column at most once. Reply only with the mapping.` Call: `runStructured({ kind: "document_classify", supabase, associationId, system, content: [{ type: "text", text }], schema: aiMappingSchema, effort: "low", maxTokens: 1500, timeoutMs: 30_000 })`.
Verification before anything is shown: every `field` must exist for the kind; every `header` must be one of the real headers (exact match; `[column N]` placeholders map back to their index); a header used twice keeps the higher confidence; sensitive headers are dropped; a mapping to a field already auto-detected with score 1.0 is shown only if it differs. Result copy: the suggestion appears as a banner `Suggested by AI. Check each one.` with `Use these suggestions` (applies them to empty or low-score slots, never overwriting a manual choice) and `Dismiss`. The details disclosure `What was sent` lists the headers and masks verbatim. Failures use `AiStatusNote` (foundation 10.1) with the by-hand link scrolling to the mapping table; quota/limit copy is the foundation's. The privacy page gets the line in section 13.

### 5.4 The mapping step (page copy)

H1 `Match your columns`; sub-line `Walkup found {n} rows in {filename}. Check that each Walkup field matches the right column.`

Table (cards on mobile), one row per field: label and `Required` pill, a select of the file's columns (`Not in my file` first; each option shows the header and, in grey, the first sample value, e.g. `Amount  (-450.00)`), the three first samples, a `Matched by name` / `Guess` pill. Under it: `Not imported:` the unmapped headers as pills, with `These columns are left out and never stored.` Sensitive ones: `{header}: left out on purpose (looks like a tax ID or account number).` Buttons: `Suggest with AI` (secondary; hidden when AI is not configured and replaced by the muted text `AI help isn't available on this account. Match by hand.`), `Continue` (disabled until required fields are mapped; the reason is shown beside it: `Match Date, Description and Amount to continue.`), `Cancel` (purges the uploaded file).
Date format (for slash dates): a select `Dates look like` `Month/day/year (3/14/2026)` default, `Day/month/year (14/3/2026)`, `Year-month-day (2026-03-14)`; the preview of three parsed dates sits beside it so a swapped format is visible.
Units file: a note when `Ownership %` is mapped: `Ownership must cover every unit and add up to 100.` Transactions: `Skip the first row?` is not offered (the first row is always the header).

---

## 6. Mapping to the books (options panel, step 4)

Everything below lives in `import_batches.options` (written by `import_set_options`, then `import_validate` re-runs). Each control saves on change (`saveImportOptions`) and the summary strip at the top updates (`n ready, n with problems`).

### 6.1 Transactions

1. `Bank or cash account`: select of cash accounts (`is_cash_account`), required, no default shown as chosen when more than one exists; with one cash account it is pre-selected and labelled. Help: `The account these transactions went through. If some went through your reserve account, import them as a separate file.`
2. `Fund`: select (`Operating`, `Reserve`...) as the default for rows without a fund value; plus, when a Fund column is mapped, a small table of the distinct values -> fund (`fund_map`).
3. `Categories`: the main table. One row per distinct normalised category value (cap 200 distinct values; more is an error `That file has more than 200 different categories. It is probably the wrong column.`): the value as typed, count, total in, total out, and a searchable select of accounts grouped `Income`, `Expenses`, `Assets` (non-cash, not receivables), `Liabilities`, `Equity`; cash accounts and 1200/1250 are not offered. Next to the select: the tax effect chip from the account: `Counts as exempt income` / `Counts as taxable income` / `Counts toward the 90% spending test` / `Does not count toward the spending test` / `Not part of the tax tests`. A row with an exact name or code match is pre-selected with the pill `Matched by name`. `Create a new category...` opens a small dialog: `Name`; `Is this money in or money out?` (`Income` / `Expense`, no default); `Does this count toward your association's tax-exempt activity?` radios with no default, with the help `For example, assessments from owners and spending to maintain the building count. Laundry or parking income does not. If you're not sure, ask your accountant; you can change this later on the Budget page.` and the `Create` button disabled until both are answered (`createImportCategory` -> `import_create_account`). Below the table the required confirmation: `[ ] I've checked that each category is matched to the right account.` (`mapping_confirmed`); the Import button stays disabled and the preview shows `Confirm the categories first` until it is ticked.
4. `Payees` (shown only when a Payee column is mapped): distinct payees with a select `Link to a contractor` (existing contractors; `Don't link` default). Help: `Linking a payee to a contractor adds the payment to that contractor's 1099 total for the year. Link only contractors you paid for services.` A link to `/building/import?kind=contractors` for `Import contractors first`.
5. `Units` (only when a Unit column is mapped): every distinct value must match a unit label (case-insensitive); unknown values are row errors fixed in the fix table.

### 6.2 Opening balances: accounts

`As of`: date, required, help `The last day before your Walkup books begin. Everything in this file is as of the end of that day.`; the page shows the fiscal year that date falls in, or `No fiscal year covers that date.` with `Add {year}` (`ensureFiscalYear`). Accounts and funds are matched by exact code or name (case-insensitive); unmatched are row errors.

### 6.3 Opening balances: what each unit owed

`As of` (same); `Income account` (required, income accounts only, no default; each option shows its tax effect; help `The income account these dues were counted under, usually Regular Assessments. When the owner pays, the tax return uses this account to count the payment.`); `Receivable account` (pre-selected 1200 Assessments Receivable, shown); `Fund` (pre-selected Operating, shown).

### 6.4 Units and owners

`Owners took ownership on`: date, required, help `Use the earliest date you are sure of. It is when each owner's record starts.`; `If a unit already has a different owner`: radio `Stop and show me` (default) / `Replace the current owner` (help `The old owner's record ends the day before the date above. Their history stays.`); `Dues` (only when Dues amount is mapped): `How often is that amount paid?` `Monthly` / `Quarterly` / `Once a year` and `Starting` date (default the first of next month); `Percentages` (only when mapped): the all-or-nothing rule with `Split equally` (fills each unit's first row with `equalShares(n)`) and `Leave percentages out for now` (`skip_percentages`); `Reason for the ownership record` text (default `Imported from a spreadsheet`).

### 6.5 Contractors

No options. Duplicate names (within the file or against existing contractors) are shown as `Already there` and left alone.

---

## 7. Validation, the fix table, the preview

### 7.1 Where each check lives

| Check | Where | Code |
|---|---|---|
| unreadable formula, over-long cell, both deposit and withdrawal | `stage.ts` (parse) | `parse_formula`, `parse_cell_long`, `parse_amount_conflict` |
| required value present, date/amount/percent/email well formed | `import_validate` | `date_bad`, `amount_bad`, `description_missing`, `unit_missing`, `unit_long`, `owner_name_missing`, `email_bad`, `percent_bad`, `dues_bad`, `name_missing`, `name_long` |
| fiscal year exists and is open | `import_validate` | `fiscal_year_missing`, `fiscal_year_closed` |
| category/fund/unit/payee resolve | `import_validate` | `category_missing`, `category_unmapped`, `fund_unmapped`, `unit_unknown`, `payee_unknown` |
| sign fits the account type; no transfers; no receivables | `import_validate` | `sign_expense`, `sign_income`, `transfer_not_supported`, `ar_not_allowed` |
| already covered by an opening balance | `import_validate` | `before_opening` |
| owner conflict | `import_validate` | `owner_conflict` |
| tax ID presented | `import_validate` | `tin_not_accepted` |
| debits = credits; at least two lines | batch | `unbalanced`, `too_few` |
| percentages complete and total 100 | batch | `percent_incomplete`, `percent_sum`, `percent_conflict` |
| required options set | batch | `cash_account_missing`, `fund_missing`, `mapping_unconfirmed`, `as_of_missing`, `income_account_missing`, `ar_account_missing`, `date_missing`, `frequency_unknown`, `entries_exist`, `fiscal_year_missing`, `fiscal_year_closed` |
| duplicates: same row earlier in the file (counted by occurrence) or already imported | `import_validate` (hash) | status `duplicate`, not an error |

Messages are the SQL messages in 0056 (verbatim, plain English). The client maps `code` to a short heading for the fix table (`ERROR_HEADING` in `src/lib/import/messages.ts`): `Date`, `Amount`, `Category`, `Fund`, `Unit`, `Owner`, `Year closed`, `Already counted`, and so on.

### 7.2 Fix table (step 5)

`/building/import/[batchId]?step=fix` shows, above the table, the summary strip: `{ok} ready · {errors} need a fix · {duplicates} already imported · {skipped} skipped`, and batch-level problems as `Answer status="bad"` items (for example `Debits are 5,000.00 and credits are 4,000.00. They must be equal.`). Tabs `Needs a fix ({n})`, `Ready`, `Already imported`, `Skipped`; 50 rows a page from `import_rows` (board RLS), ordered by row number.

Row (desktop table; card on mobile): `#12`, the cleaned values, the problem sentence in `text-bad-text` with the field highlighted; failing fields are inputs (date input, text, select for unit/category from the mapped lists); `Save fix` (calls `import_update_row` for this row, then re-validates) and `Skip this row` / `Include again` (`import_set_row_decision`). Bulk: `Skip all {n} rows with problems` (`import_skip_problem_rows`, with an inline `This leaves {n} rows out. Skip them?`), and `Download the problem rows` (`errors.csv`, 7.4). A banner when everything is fine: `No problems. Go to the preview.`

### 7.3 Preview (step 6)

Server-rendered from `import_batches.summary` plus the first 20 ok rows. Common top: `Answer` `Ready to import {n} rows` / `Nothing is saved until you press Import. You can undo it afterwards.` with the counts line. Per kind:

- **Transactions**: `Money in {money_in}`, `Money out {money_out}`, `{n} entries will be created, each balanced (debits {x} = credits {x}).` A table by account (from `summary.by_account`): account, count, total, tax effect chip. The 20-row sample shows each as a journal entry: `Mar 14, 2025 · Boiler repair, Acme Plumbing` then `Debit 5020 Repairs & Maintenance 450.00` / `Credit 1000 Operating Cash 450.00` (built client-side from the row, cash account and mapped account). Callouts: `Rows with a unit and income are recorded as money received. They don't change what the unit owes now.` and, when payees are linked, `{n} payments will count toward {contractor}'s 1099 total.`
- **Opening balances (accounts)**: the lines grouped Debits and Credits with totals and `Balanced` pill; `This becomes one entry dated {as_of} in fiscal year {label}.`
- **Opening balances (units)**: table unit, owed; `Total {unit_total}`; `{n} charges will be created on {as_of}, each shown on the unit's statement as "Balance carried forward". When an owner pays, the payment is applied to it.` plus the income account and its tax effect.
- **Units and owners**: counts `New units {n}`, `Existing units {n}`, `New people {n}`, `Owners assigned {n}`, `Dues plans {n}`; the percentages table with the total and `Adds up to 100%` / the error; a list of what is skipped.
- **Contractors**: new contractors listed; `Already there` listed.

Footer (sticky on mobile): `Import {n} rows` (primary, disabled while batch errors exist or `ok = 0`), `Back`, `Cancel import`. After a press: inline `Importing...`; success navigates to `?step=done`.

### 7.4 `errors.csv`

Route handler (board admin): rows with `status = 'error'`, columns `Row`, the kind's mapped fields in template order, `Problem`. Every cell through `safeCell`/`csvLine`; `Content-Disposition` ASCII-safe; `Cache-Control: private, no-store`. The first columns match the template so the board can fix the file and upload it again (the file hash differs, the row hashes match what was already imported, so only fixed rows are new).

---

## 8. Commit, undo, idempotency

### 8.1 Commit (`import_commit(batchId, digest)`)

One transaction, one function: re-validates (`import_validate`), checks the digest, checks no batch-level errors, then writes row by row through the ledger paths of decision 4, stamping each `import_rows` row with what it created. Errors roll the whole batch back. Postgres errors surface as:

| Code / hint | Message shown |
|---|---|
| `42501` | `Only a board admin can import.` |
| `22023` hint `preview_stale` | `Something changed since the preview (a unit, a year, an account). Review the preview again.` (the page re-runs `import_validate` and re-renders) |
| `22023` hint `batch_errors` | `Fix the problems at the top of the preview first.` |
| `22023` hint `nothing` | `There is nothing to import.` |
| `23505` (the same file already committed) | `This file was already imported on {date}.` with a link to that batch |
| `check_violation` from the period trigger | `That fiscal year is closed. Skip those rows or choose another date.` |
| anything else | `Something went wrong. Nothing was imported.` (raw message to `console.error`) |

Concurrency: `import_batches` row is `for update`; a double press of Import waits and then fails with `preview_stale` / already committed.

### 8.2 Idempotency

- **File**: `import_start` refuses a file whose `(association, kind, sha256)` is committed; the hint carries the earlier batch id; copy `You imported this file on {date}.` with `See that import`. The unique index `import_batches_file_once` is the backstop.
- **Rows**: hash = sha-256 of `kind | normalised key fields | '#' | occurrence`, where occurrence counts identical keys earlier in the same file, so two real $450 payments on one day both import and a re-export of the same period adds nothing. Matched against `status = 'committed'` rows of committed batches of the same kind.
- **Opening balances**: one committed batch each (`import_batches_opening_once`); `Undo` first to redo.
- **Contractors**: `on conflict (association_id, name) do nothing` is the second line of defence after validation.

### 8.3 Undo (`import_undo(batchId)`)

Allowed for `committed` batches, board admin. Transactions and opening balances: refused if any entry's fiscal year is closed (`year_closed`), or a payment has been applied to an imported opening charge (`in_use`); otherwise each entry is reversed with `reverse_journal_entry` (same date and year, so the pair nets to zero where the mistake was made), and the subsidiary `expenses` / `assessment_charges` rows are deleted so the budget, 1099 totals and balances reflect it. A foreign-key violation (an expense linked to a repair) aborts the whole undo with `One of these is used elsewhere (a repair, for example); remove that link first.` Contractors: deleted if unused. Units and owners: removes the ownership amendment (only if it is the newest), the ownership links, dues plans, people and units this import created, in that order; if something now depends on them (a charge, a repair, a payment) the undo refuses. The batch becomes `undone`; its file hash is free again.
Copy on the result page: `Undo this import` -> inline `This reverses the entries. Both stay in the ledger history. Undo?` `Yes, undo` / `Keep it`. Success: `Undone. Nothing from this import is counted any more.`

---

## 9. Units, owners and ownership percentages

Rules (executed in `import_validate` and `import_commit`):

1. **Units** are matched by label (case-insensitive, trimmed). A label that does not exist is created with the next `sort_order`. Labels are unique per association (0001).
2. **People** are matched by email (case-insensitive) within the association. A row with no email always creates a new person (matching by name would merge two real neighbours called "Sam Lee"); the preview lists them as `New people (no email to match on)`. A row with an existing email reuses that person and keeps the name already on file (the preview notes `Same email as {name on file}`).
3. **Ownership links** (`unit_owners`) are created with `effective_from` = the date chosen. A person already a current owner of that unit gets no second link. Two or more rows with the same unit and different people are co-owners (all current).
4. **A different current owner is a conflict** (`owner_conflict`) unless `replace_owners` is on, in which case the previous links end the day before the chosen date (mirroring `changeUnitOwner`: the new row is inserted, then the old is closed; the whole thing is atomic here). A co-owner pair where one is already on file and the other is new is not a conflict.
5. **Percentages** are all-or-nothing (#7). If any row has one, every unit that will exist after the import (existing and new) needs exactly one value (rows of the same unit must agree: `percent_conflict`), values are numbers above 0 and at most 100, and the total is 100 within 0.000001, else a batch error. On commit one `record_ownership_amendment(effective_from, lines for ALL units, reason)` call records them (that function demands a line for every unit, and the deferred trigger demands the sum of 100). The equal-split helper: `equalShares(n)` returns `n` strings of six decimals summing to exactly `100.000000`, extra millionths going to the last units (`3 -> 33.333333, 33.333333, 33.333334`). Percentages are stored `numeric(9,6)`.
6. **Dues amounts** create one per-unit dues plan (`assessment_schedules`, `allocation_method = 'fixed_per_unit'`, `unit_id` set, `total_amount` = the amount per payment, `annual_amount` = amount x payments per year, note `Imported`) only when the unit has no open plan (never overwrites a plan). **Nothing is charged**: charging stays on the HOA Dues page. If no operating fund exists the plan is skipped and the preview warns.
7. **No logins are created.** People have no `auth_user_id` and no role grants. After the import the result page lists the people with an email and no login: `Invite {n} owners to sign in` -> for each, the owner-portal `createOwnerInvite(personId)` (claim-your-record invite) so the owner who signs in IS this person with this unit; the page shows a copyable link per person and the invite email draft (owner-portal 5.3). Walkup sends nothing.
8. **Existing structure is never deleted.** Units and people not in the file are untouched.

---

## 10. Cash-basis rules and the opening balance

Rules this feature must not break (#1 to #3): the tax tests read **cash movements**, never balances; receipts are classified by the income account on the other leg, or by tracing a payment to the income account its charge credited; disbursements by the debit leg; capital items count in the 90% numerator.

| Imported thing | Entry | Tax effect |
|---|---|---|
| Money in, income account (e.g. Regular Assessments with a unit; Interest) | Dr cash / Cr income, unit on both lines when given | Branch 2 of `cash_basis_receipts` (direct). Exempt or not exactly as the chosen account is flagged. Counted in the year of the date |
| Money out, expense account | `record_expense`: Dr expense / Cr cash, plus an `expenses` row | In the 90% test per the account's `is_exempt_expenditure`. Feeds `monthly_expense_actuals` and 1099 totals (only when a payee is linked) |
| Money out, non-cash asset (a capital item) | `record_expense` with `is_capitalized` | Counts in the 90% numerator whether or not expensed (#2) |
| Money in or out, liability or equity (a loan, a deposit refund) | Dr/Cr cash against that account | Not income, not an expenditure (no income/expense leg) |
| Anything touching a cash account as the chosen category | refused | Transfers belong to the bank feed |
| Opening account balances | one entry, Dr assets/Cr liabilities and fund balances, source `import`, dated `as_of` | Debits to cash with an equity credit are not income (branch 2 needs an income credit leg); credits to cash are never in the opening entry, so nothing enters the 90% test |
| What each unit owed at `as_of` | `record_assessment_charge(type other, due = as_of, memo "Balance carried forward")`: Dr 1200 / Cr the chosen **income** account | When the owner pays, the payment traces to that income account (branch 1) in the year it is paid: cash basis exactly as for any charge |

Why the unit balances are not in the opening entry: an opening entry that put receivables in with an equity credit would balance and look right, and then every payment of those dues would be dropped from the 60% test, because branch 1 of the view joins the charge's entry to an **income** account. The failure would be silent and would lower the exempt ratio. So the receivable is created the way a normal assessment is.

Worked example. Books begin 2026-01-01; opening date `2025-12-31` (fiscal year 2025 added by `Add 2025`).

Account balances file:

| Account | Fund | Debit | Credit |
|---|---|---|---|
| 1000 Operating Cash | Operating | 18,400.00 | |
| 1010 Reserve Cash | Reserve | 52,000.00 | |
| 2000 Accounts Payable | Operating | | 1,200.00 |
| 3000 Operating Fund Balance | Operating | | 17,200.00 |
| 3100 Reserve Fund Balance | Reserve | | 52,000.00 |

Debits 70,400.00 = credits 70,400.00. Unit balances file: Unit 2 owes 750.00, Unit 5 owes 150.00, income account `4000 Regular Assessments` (exempt). Result: one entry of five lines, two charges of "Balance carried forward" dated 2025-12-31 (fiscal 2025 shows 900.00 of assessment income and 900.00 receivable). In February Unit 2 pays 750.00 through the bank feed; the payment is applied to the carried-forward charge; the 2026 cash receipts show 750.00 of exempt function income. Importing 2025 transactions afterwards is refused on or before 2025-12-31 (`before_opening`); importing 2026 transactions is welcome.

Past years' transactions without an opening balance are allowed (a board can import 2025 to prepare the 2025 return and let the bank feed carry 2026), provided no opening balance is dated on or after them and, for the opening balance, no entry exists on or before its date (`entries_exist`).

---

## 11. Libraries and server actions

### 11.1 `src/lib/import/stage.ts` (pure)

```ts
export interface StageInput {
  kind: ImportKind;
  file: ParsedFile;
  mapping: Record<string, number | null>;      // field key -> column index (only these columns are read)
  dateHint: "mdy" | "dmy" | "ymd" | "auto";
}
export interface StagedRow { row_number: number; raw: Record<string, string>; mapped: Record<string, string>; errors: { field: string; code: string; message: string }[] }
export function buildStagedRows(input: StageInput): { rows: StagedRow[]; notes: string[] };
// 1. Reads only the mapped columns. raw[fieldKey] is the cell text as typed; unmapped columns are never touched.
// 2. Normalises (dates via normalizeDate, money via normalizeMoney, email, phone, percent column-wise, trade, unit label trimmed).
//    A value that fails to normalise is left EMPTY in mapped and not repeated as an error here (the database reports date_bad / amount_bad).
// 3. money_in/money_out -> amount in cents, parse_amount_conflict.
// 4. Skips fully empty rows; row_number is the 1-based position in the file's data rows (header excluded) so the person can find it.
// 5. redactTaxIds() is applied to description, notes, payee and owner_name; a redaction adds the note "A number that looked like a tax ID was removed from row N."
```
`notes` is shown on the preview (`Removed a number that looked like a tax ID from 2 rows.`).

### 11.2 `src/lib/import/split.ts`

```ts
export function equalShares(n: number): string[];      // n >= 1; six decimals; sums to exactly 100.000000
export function parseShare(text: string): string | null;
```

### 11.3 `src/app/building/import/actions.ts` (`"use server"`)

All: `createClient()`, `currentAssociationId`, `has_role_in(board_admin)` early refusal (`Only a board admin can import.`), then the work. Return `{ ok: true, ... } | { error: string }` with the copy in 8.1.

```ts
export async function startImport(input: {
  kind: ImportKind; documentId: string; mapping: Record<string, number | null>;
  dateHint: "mdy" | "dmy" | "ymd" | "auto"; keepCopy: boolean;
}): Promise<{ ok: true; batchId: string; notes: string[] } | { error: string; alreadyImported?: { batchId: string; on: string } }>;
// 1. zod. 2. download the stored file (documents row + storage .download, board RLS) 3. parseImportFile 4. buildStagedRows
// 5. rpc import_start (source_document_id only if keepCopy) 6. import_stage_rows in chunks of 500 7. import_set_options(mapping, {})
// 8. unless keepCopy: purgeDocument(documentId) 9. import_validate 10. revalidatePath("/building/import").
// On any failure after import_start: import_cancel(batchId) and purge the document (never leave raw rows or a file behind).

export async function saveImportOptions(batchId: string, options: Record<string, unknown>): Promise<{ ok: true; summary: ImportSummary } | { error: string }>;
// merges into the stored options (keys whitelisted per kind in zod), import_set_options, import_validate.
export async function revalidateImport(batchId: string): Promise<{ ok: true; summary: ImportSummary } | { error: string }>;
export async function fixImportRow(rowId: string, values: Record<string, string>): Promise<{ ok: true; summary: ImportSummary } | { error: string }>;
export async function setRowDecision(rowId: string, decision: "import" | "skip"): Promise<{ ok: true; summary: ImportSummary } | { error: string }>;
export async function skipProblemRows(batchId: string): Promise<{ ok: true; skipped: number; summary: ImportSummary } | { error: string }>;
export async function createImportCategory(input: { name: string; type: "expense" | "income"; isExempt: boolean | null }): Promise<{ ok: true; accountId: string } | { error: string }>;
// isExempt null -> "Say whether this counts toward your tax-exempt activity."
export async function ensureFiscalYear(year: number): Promise<{ ok: true } | { error: string }>;
export async function commitImport(batchId: string, digest: string): Promise<{ ok: true; summary: ImportSummary } | { error: string; hint?: "preview_stale" | "already_imported" }>;
export async function undoImport(batchId: string): Promise<{ ok: true } | { error: string }>;
export async function cancelImport(batchId: string): Promise<{ ok: true } | { error: string }>;     // import_cancel + purge the file if still present
export async function suggestColumnMapping(input: { kind: ImportKind; documentId: string }): Promise<{ ok: true; suggestion: ...; sent: AiPreview } | { ok: false; error: string; configured: boolean }>;
export async function removeUnfinishedUpload(documentId: string): Promise<{ ok: true } | { error: string }>;   // purgeDocument, only for documents titled "Import: ..." by this wizard
export interface ImportSummary { counts: { rows: number; ok: number; errors: number; duplicates: number; skipped: number }; batch_errors: { field: string; code: string; message: string }[]; digest: string; /* kind-specific totals as in 0056 */ }
```
Zod for the mapping: `z.record(z.string().regex(/^[a-z_]{1,30}$/), z.number().int().min(0).max(39).nullable())`, fields must belong to the kind; values for `options`: dates `^\d{4}-\d{2}-\d{2}$`, uuids `z.guid()`, booleans, maps `z.record(z.string().max(200), z.guid())` with at most 200 keys, `dues_frequency` enum.

---

## 12. Pages, with copy and states

Guard on every page: `getViewer()` (owner-portal 2.3); not a board admin -> `BoardOnly what="Importing" why="Only a board admin can bring in spreadsheets." alternative={{ label: "Back to Building Info", href: "/building" }}` (board members see the history read-only with the sentence `Importing is for board admins.` in place of the start cards).

### 12.1 `/building/import` (start)

H1 `Import from a spreadsheet`; sub-line `Bring in your units, owners, last year's transactions and opening balances instead of typing them. Nothing is saved until you've checked it.`

Cards (2x2 on desktop, stacked on mobile), each: title, one sentence, `Download template` (CSV and Excel links) and `Upload your file`:

| Card | Sentence |
|---|---|
| Units and owners | `Each unit, who owns it, how to reach them, their share and their dues. Start here.` |
| Contractors | `The people you hire. Tax ID numbers are never imported.` |
| Opening balances | `What the association had and owed on the day your Walkup books begin, and what each unit owed.` (two buttons: `Account balances`, `What each unit owed`) |
| Past transactions | `Last year's deposits and payments, so reports and the tax forms have history.` |

A line under the cards: `Best order: units and owners, contractors, opening balances, then transactions.` Below: `Unfinished uploads` (if any; each with `Continue` / `Remove`) and `Past imports` (table: date, what, file name, rows, who, status, `Undo` for committed). Empty history: `Nothing imported yet.`

Loading: the standard skeleton. Error: `We couldn't load your imports. Reload the page.`

### 12.2 Upload (`/building/import/new` before a file exists)

Title `Upload your {KIND_LABEL}`; the `DirectUpload` with help `Excel (.xlsx) or CSV, up to 5 MB and 5,000 rows. Only the columns you match in the next step are kept.`; the checkbox `Keep a copy of this file in the Document Hub (board only)`, help `The copy would include columns Walkup doesn't import.`; link `Download the template`. Failures: the foundation's copy plus parse errors from 4.2 (shown after redirect with `?error=` as a `role="alert"` Answer).

### 12.3 Mapping, fix, preview, done

Mapping: 5.4. Options: section 6. Fix: 7.2. Preview: 7.3. 

Done (`?step=done`): `Answer good` `Imported {created} {things}` / `{kind-specific sentence}`; things: `rows` / `units` / `contractors` / `charges`. Kind-specific next steps as buttons:

- Units and owners -> `Review Building Info`, `Invite {n} owners to sign in` (section 9.7), `Import transactions`.
- Contractors -> `See contractors`.
- Opening balances -> `See the trial balance` (`/ledger`), `Import what each unit owed` (when accounts done) / `Import transactions`.
- Transactions -> `See Financial Statements`, `Check the Taxes page` (the categories now feed the tax figures).
- Always: `Undo this import` (inline confirm as 8.3) and `Done`.
A reminder card for transactions: `Check Taxes: the income and spending you just imported now count toward the 60% and 90% tests for the years they fall in.`

### 12.4 States summary

| State | Copy |
|---|---|
| No fiscal year for a date | `No fiscal year covers {date}. Add {year} to import it.` + button |
| Fiscal year closed | `{year} is closed, so nothing can be added to it.` |
| AI not configured | `AI help isn't available on this account. Match by hand.` |
| AI quota | foundation `AiStatusNote` (`Limit reached:`) |
| File too big/long | 4.2 messages |
| Upload still processing | the foundation's DirectUpload states |
| Batch closed (committed/undone/cancelled) opened at an old step | `This import is finished.` with `See the result` |
| Preview stale | `Something changed since the preview. We refreshed it. Check it and import again.` |
| Mobile | steps stack; the fix table becomes cards; the commit bar is sticky; selects are native |

---

## 13. Security and privacy notes

1. **Data minimisation.** Only mapped columns are read, staged or sent anywhere. `raw` is cleared on commit or cancel; people-kind `mapped` is reduced to the unit label or name at commit. The wizard cancels a batch itself when a step fails. A batch left `uploaded` or `validated` for more than 14 days is cancelled the next time a board admin opens `/building/import` (a `cancelStaleImports` server action that calls `import_cancel` for each; it reads `import_batches` under board RLS). No cron and no new service-role entry point are needed.
2. **Tax IDs.** Sensitive headers are never mapped and their samples are hidden; `redactTaxIds` runs on free-text fields; the contractors validator refuses a `tin` key; the staged file is purged after staging unless the board keeps a copy (and the copy is stored with `read: false`, so it is not sent to the model, #25).
3. **Formula injection.** Inbound: formulas are never evaluated (exceljs `result` only); cell text is data. Outbound: every typed text written to a CSV or XLSX goes through `safeCell`; strings are written as strings, never as formulas. Covered by tests with real payloads.
4. **Zip bombs and parser abuse.** 5 MB cap, `zipStats` before exceljs, row/column/cell caps, no external references followed, no macros accepted, `.xls` refused, parse runs inside a server action with `maxDuration = 60`.
5. **AI.** Optional; sees headers (with data-looking or sensitive headers replaced) and character masks of five rows. No values, no names, no amounts. Output verified against the real headers. Logged in `ai_calls` as `document_classify` (decision 1). The privacy page lists it.
6. **Authorisation.** board_admin for every write (`has_role_in`), MFA through `has_role_in`; batches and rows readable by the board only; a different association cannot touch a batch (`import_start` and every function look the batch up and check the role in *its* association; the same-association trigger on `import_rows`).
7. **No trust in the client.** Every value is re-validated in SQL at preview and again at commit; `mapped` can be tampered with by a board admin through `import_update_row` only to values the validator then checks; accounts must belong to the association; funds, units, vendors the same.
8. **Ledger integrity.** Entries go through `post_journal_entry` (balance trigger, period-open trigger) and the existing RPCs; nothing writes `journal_entries` or `journal_lines` directly.
9. **Audit.** `import_batches` is audited; every ledger row has `source = 'import'`, `source_id = batch id`; undo is two visible entries.
10. **Rate and volume.** Five open batches per association, 5,000 rows per batch, 500 rows per staging call.
11. **Privacy page.** In the Anthropic list add: `Importing a spreadsheet. If your board asks for help matching columns, the column names and a character-by-character mask of a few sample cells (letters shown as x, digits as 9) are sent, never the values themselves.` In "What we collect": `Spreadsheets your board imports are read to create records and then removed, unless the board keeps a copy in the Document Hub.`
12. **Terms.** No change.

---

## 14. Test plan

### 14.1 DB: `tests/db/imports.test.ts` (PGlite harness; fixture; the chart is extended in `beforeEach` with 3000, 5020, 4100 accounts; helpers `startAndStage(kind, rows, options)` returning `{ id, summary }`)

Access
1. `import_start` by a board_admin works; by a board_member, an owner, the live accountant, an aal1 session and another association's admin raises `42501`.
2. Board members can `select` batches and rows of their own association; owners and the accountant read none; another association reads none.
3. No role can insert/update/delete `import_batches` or `import_rows` directly.
4. All functions are not executable by `anon`; `import_fiscal_year` and `import_err` are not executable by `authenticated`.
5. A staged row whose batch is in another association (superuser insert) raises `42501`.

Lifecycle
6. `import_stage_rows` refuses more than 500 rows per call, more rows than declared, and a closed batch; `import_start` refuses a sixth open batch and a file already committed (hint carries the batch id).
7. `import_validate` refuses when rows are missing (`rows_missing`).
8. `import_set_options` resets validated rows to pending and clears the digest.
9. `import_update_row` clears parse errors and re-pends; `import_set_row_decision(skip)` excludes the row from the digest and the commit; `import_skip_problem_rows` skips exactly the error rows.
10. `import_cancel` nulls `raw` and `mapped` and closes the batch; a committed batch cannot be cancelled.

Transactions
11. Unmapped category -> `category_unmapped`; unmapped fund (no default) -> `fund_unmapped`; unknown unit -> `unit_unknown`; unknown payee mapping -> `payee_unknown`.
12. Income account with money out and expense account with money in are refused; a cash account as the category is refused (`transfer_not_supported`); 1200/1250 refused (`ar_not_allowed`).
13. A date with no fiscal year and a date in a closed year are refused; the open one passes.
14. `mapping_unconfirmed` is a batch error until `mapping_confirmed` is true; `cash_account_missing` when the cash account is not a cash account or not this association's.
15. After a committed opening balance dated D, rows dated on or before D are `before_opening`.
16. Commit: an expense row creates an `expenses` row via `record_expense` (budget actuals include it); an income row with a unit creates a two-line entry with the unit on both lines and appears in `cash_basis_receipts` as basis `direct` for the chosen account; a capital row (asset account, money out) is `is_capitalized`; every entry has `source = 'import'` and `source_id = batch id`; trial balance debits = credits.
17. The cash-basis consequences: an exempt income account's imported deposit increases exempt receipts in `form_1120h_figures` for its year; a non-exempt account's does not; an exempt expense increases exempt expenditures; a liability/equity row changes neither.
18. Digest: changing an option after validation makes `import_commit` raise `preview_stale`; adding a unit between preview and commit does too; a wrong digest raises.
19. Duplicates: two identical rows in a file both import (occurrence 1 and 2); re-uploading the same rows in a new file marks them `duplicate` and imports only new ones; the same file bytes raise at `import_start`.
20. Atomicity: force a failure on the last row (a closed fiscal year via superuser between validate and commit... or a trigger that raises) and assert zero rows were written and the batch is still `validated`.
21. Undo: reverses every entry (each original has a `reverses_entry_id` partner, net zero per account), deletes the `expenses` rows, marks rows `undone` and the batch `undone`, frees the file hash; refuses when a fiscal year has since closed (`year_closed`); refuses when an expense is linked from a ticket (`in_use`) and leaves everything as it was.

Opening balances
22. Accounts file: unbalanced -> batch error with both totals; fewer than two lines; income/expense accounts refused; 1200/1250 refused; unknown fund; a debit and credit on one line refused.
23. Commit posts exactly one entry dated `as_of` with all lines; `entries_exist` blocks an `as_of` on or after an existing entry; `as_of` with no fiscal year / closed year is refused; a second committed accounts batch is refused by the unique index (and allowed after undo).
24. Unit balances: income account must be an income account; AR must be 1200/1250; unknown unit; zero/negative refused; commit creates `assessment_charges` of type `other` with memo "Balance carried forward", `unit_statement_summary` shows them as owed, and a later `record_payment` allocated to the charge appears in `cash_basis_receipts` branch `assessment` with the chosen income account (the property section 10 exists to protect).
25. Undo of unit balances refuses when a payment has been applied.

Units and owners
26. New unit + new person + link + plan created; the person has no `auth_user_id` and no role grant.
27. Existing person matched by email (case-insensitive), name kept; a row without email creates a new person; two rows for one unit are co-owners.
28. `owner_conflict` for a different current owner; with `replace_owners` the old link ends the day before and the new begins.
29. Percentages: all units covered and summing to 100 -> one amendment with a line per unit; partial -> `percent_incomplete`; sum 99.9 -> `percent_sum`; two values for one unit -> `percent_conflict`; `skip_percentages` records none; values above 100 or zero refused.
30. Dues: a plan is created only when the unit has none; the amount is per payment; `annual_amount` is 12/4/1 times it; nothing is charged (no `assessment_charges` rows).
31. Undo removes only what this batch created (a pre-existing unit/person is untouched), refuses if a charge now exists on a created unit.
32. Commit reduces `mapped` to `unit_label`/`name` and nulls `raw` (PII gone).

Contractors and tax IDs
33. Contractors created with `trades` array from the trade text; a duplicate name in the file and against an existing contractor is `duplicate`; a `tin` key is refused; undo deletes unused, refuses used.

Fiscal years
34. `import_ensure_fiscal_year` creates a calendar year for an association whose year ends in December; is idempotent; refuses overlap/other year-end (`fy_not_december`); board admin only; out-of-range years refused.
35. `import_create_account`: `p_is_exempt null` raises `exempt_required`; creates expense and income accounts with the flag exactly as given; codes do not collide; board admin only; other types refused.

Lint
36. `migrations.test.ts` and `rls.test.ts` pass unchanged after 0056 (no new anon exception, search paths pinned, RLS on, `association_id` present, numerics unchanged).
37. Migration-path: 0056 on seeded data with existing `document_links` rows leaves them (constraint widened includes every earlier table, `announcements` and `import_batches`).

### 14.2 Unit tests (`tests/unit/`)

- `import-csv.test.ts`: quotes, doubled quotes, CRLF inside quotes, BOM, `;` and tab delimiters, ragged rows, windows-1252 fallback, blank lines.
- `import-xlsx.test.ts` (builds workbooks with exceljs in memory): date cells, numbers, strings, `{formula,result}`, a formula with no result, richText, hyperlink text, error cells, merged cells, hidden rows, sheet choice by name and by fallback, more than 5,000 rows, more than 40 columns.
- `import-zip-stats.test.ts`: small zip, a crafted central directory declaring 61 MB and 301 entries, truncated bytes, non-zip.
- `import-normalize.test.ts`: every date format and hint, Excel serials, two-digit years, impossible dates; money forms (`(1,234.50)`, `$1,234.5`, `123.45-`, `1.234,50`, three decimals, `CR`); percent column logic (points, fractions, mixed, over 100); phone; email forms (`Name <a@b.co>`, `mailto:`); trade keywords; `normalizeKey`.
- `import-columns.test.ts`: detection on realistic headers from three bank/QuickBooks-style exports, ties, reused headers, value sniffing, sensitive headers (`SSN`, `Tax ID`, `Routing #`, `Account Number`) never mapped and hidden.
- `import-shape.test.ts`: the examples in 5.3, non-ASCII letters, long text cut with `...`, data-looking headers replaced, `maskRows` takes at most five non-empty rows.
- `import-ai-mapping.test.ts` (SDK mocked as in `ai-structured.test.ts`): the prompt text contains no cell value from the fixture (assert absence of a name, an email and an amount), the headers are the only verbatim text; hallucinated header dropped; duplicate header keeps higher confidence; unknown field dropped; sensitive header dropped; not-configured and quota map to the foundation failures.
- `import-stage.test.ts`: only mapped columns appear in `raw`/`mapped` (a fixture with an `SSN` column proves it is never read); `money_in`/`money_out` combination; both filled -> `parse_amount_conflict`; empty rows skipped; row numbers; tax-ID redaction note; no JavaScript number in `mapped` (all strings).
- `import-split.test.ts`: `equalShares(1..40)` sums exactly 100.000000 and each has six decimals.
- `import-safe-cell.test.ts`: payloads `=1+1`, `+SUM(A1)`, `-2+3`, `@cmd`, `\t=1`, `\r=1`, `=HYPERLINK("http://x")`, plain negatives and numbers; `csvLine` quoting; XLSX cells are strings.
- `import-templates.test.ts`: each template has the documented headers in order, the example rows parse back through `parseImportFile` and `buildStagedRows` with zero errors, dropdowns present when names are passed, no cell begins with a formula character, CSV starts with a BOM.
- `import-actions.test.ts` (fake Supabase): `startImport` cancels the batch and purges the file on a failure after `import_start`; refuses non-admin before any call; zod rejects unknown fields/options; `createImportCategory` with `isExempt: null` refuses before any call.
- `import-copy.test.ts`: no em dash in templates, `messages.ts`, page copy; the word "vendor" absent from user-facing text.

### 14.3 Manual checks before "General Kenobi"

1. A real 12-unit export from Excel (with a Social Security column and merged cells) through units and owners: the SSN column is not offered, not stored (`select raw from import_rows` has no such key), the file is gone from the Document Hub.
2. A year of bank CSV through transactions with 40 distinct categories: mapping, the new-category dialog, preview totals vs the bank statement, import, the Taxes page figures, undo.
3. Opening balances for a building with a payable and a reserve fund; then the first dues payment through the bank feed lands as exempt income.
4. Re-upload the same file (refused), a larger overlapping file (only new rows).
5. Phone: mapping and fix table.
6. Hostile files: a CSV with `=cmd|...` cells and a huge XLSX; the errors CSV opened in Excel shows text, not a formula.

---

## 15. Build order

1. Migration 0056 and `tests/db/imports.test.ts` green (also the lint tests); `tests/db/harness.ts` untouched.
2. Pure libraries and their tests: `safe-cell`, `csv`, `normalize`, `split`, `shape`, `kinds`, `columns`, `stage`, `messages`.
3. Server-only: `zipStats`, `xlsx`, `parse-file`, `templates`, `ai-mapping`; template route.
4. Server actions and their tests.
5. Pages: start, upload, mapping, options, fix, preview, done; `errors.csv`.
6. Integration (16), privacy page text, DECISIONS #39.
7. `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, manual checks.

Dependencies: needs owner-portal 0054 only for the post-import "Invite owners" button (`createOwnerInvite`); needs 0055's `email_address_ok` (used by the contractors and units validators), so 0056 must apply after 0055. If 0055 is delayed, replace the two calls with the inline regex from `associations.board_contact_email`'s check.

---

## 16. Integration tasks

| File | Change |
|---|---|
| `docs/DECISIONS.md` | Append #39 (1.3). |
| `src/app/building/page.tsx` | A card at the top for board admins when there are no units, or always as a small link row: `Import from a spreadsheet` -> `/building/import`, copy `Bring in units, owners, transactions and opening balances.` |
| `src/components/sidebar/config.tsx` | `EXTRA_TITLES`: `{ prefix: "/building/import", label: "Import" }` before the `/building` nav match (or special-case: `pageTitleFor` checks nav items first, so add the prefix to the nav match rule). No new nav item. |
| `src/lib/home/setup-guide.ts` | Add to `SetupInputs`: `importBatches: { kind: string; status: string }[]` (select `kind, status` from `import_batches`, board only). In section `building`, before `units`, add step `{ key: "import_units", name: "Import your units and owners (optional)", detail: committed ? "Imported from a spreadsheet." : "Faster than typing them one at a time.", href: "/building/import", done: importBatches.some(b => b.kind === "units_owners" && b.status === "committed"), doneOn: null, informational: true, instructions: ["On Building Info, open Import from a spreadsheet and download the template.", "Fill it in, upload it, check the preview, and import."] }`. The existing steps `units` and `owners` keep ticking from the real rows (units exist, every unit has a current owner), whether they were typed or imported, so nothing is double counted. In section `money`, before `bank`, add informational `import_opening`: `Enter your opening balances (optional)` (`href: "/building/import"`, done when an `opening_accounts` batch is committed) and after `backlog` add informational `import_history`: `Import last year's transactions (optional)` (done when a `transactions` batch is committed). In `vendors` step detail add `Or import them from a spreadsheet.` Update `tests/unit/setup-guide.test.ts` (informational steps never block `isSetupComplete`). When `units.length === 0` the guide's `nextStep` hint copy becomes `Add your units, or import them from a spreadsheet.` |
| `src/lib/home/urgent-items.ts` | No new items. |
| `src/lib/tour/steps.ts` | `building.body`: `Units, owners, the board and the association's details. Import them from a spreadsheet, or invite the rest of the board from here.` |
| `src/app/privacy/page.tsx`, `tests/unit/privacy-page.test.ts` | The two lines in 13.11 and an assertion on them. |
| `src/app/contractors` (Repairs, now `src/app/repairs/contractors-view.tsx`) | Empty state gains a link `Import contractors`. |
| `src/app/dues/page.tsx` | Empty plan state: `Set each unit's dues, or import them with your units.` linking `/building/import`. |
| `src/lib/ai/kinds.ts` | No change (decision 1). If the lead chooses a new `import_mapping` kind instead: add it to `AI_KINDS`, `AI_DAILY_LIMITS` (20), `AI_KIND_LABEL` (`matching spreadsheet columns`), the `ai_calls.kind` check, `ai_daily_limit()` and `ai_quota_status()` in a new migration, and teach `tests/unit/ai-usage.test.ts` to read the latest definition. |
| `.env.local.example` | No change. |
| `tests/e2e/app.spec.ts` | Admin smoke: `/building/import` loads; downloading a template returns a file; an owner account gets "This part is for the board". |

---

## 17. Deliberately left out (and why)

- **Importing from bank statements PDFs or QuickBooks files directly.** Export to CSV/XLSX first; the bank feed already covers live data (#29).
- **Transfers between own accounts, split transactions, multi-fund rows.** Each row is one two-line entry. A row that needs splitting is entered in the app; transfers go through the bank feed.
- **Posting dues deposits as payments that clear charges.** Past deposits are income received (#29's rule for nothing to apply to). Cutting over unit balances is the Unit balances file.
- **Importing charges, late fees, payments per unit.** The opening balance plus the bank feed going forward is the supported path; replaying history charge by charge invites double counting.
- **Creating logins or sending invites.** People are created without logins; the owner portal's claim-your-record invite is the way in, and Walkup sends nothing (#22/#36 apply to its own channel).
- **Importing documents, policies, tickets, upkeep schedules.** Different shapes; the insurance and repairs imports have their own readers.
- **Updating existing records from a file** (a "sync" that edits phones or emails). Import only adds; changing a person is Building Info's job, with its audit trail.
- **Scheduled or recurring imports.**
- **A mapping memory** (saving a column mapping for next time). Easy later (`import_batches.mapping` already stores the last one per kind); not needed for a first-run feature.
- **Excel `.xls`, `.xlsm`, `.numbers`, `.ods`.** Save as `.xlsx` or `.csv`.
- **A new AI kind and a per-import quota.** The existing `document_classify` allowance is ample (decision 1).
- **Negative unit balances (credits) in the Unit balances file.** An overpayment is a payment, not a charge; it can be recorded as a payment on the Dues page.
