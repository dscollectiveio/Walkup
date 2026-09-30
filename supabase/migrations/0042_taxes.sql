-- ============================================================================
-- Walkup — migration 0042: Taxes — form determination, official templates,
-- auto-fill with provenance, review, and export
--
-- Part 4 of docs/reference/build-prompt-budget-contractors-insurance-taxes.md.
-- Builds around the existing Tax Center (0022: cash-basis 1120-H figures,
-- tax_parameters with source_url + verified_on, per-line overrides, filing
-- lock) rather than replacing it.
--
--   * accounts.tax_classification_confirmed_at/_by — income classification
--     is pre-filled by the seed chart (0005) and now needs a board member to
--     confirm it once per income account (Doug, 2026-09-30, DECISIONS #32).
--     The flags and their CHECK constraints keep their meaning.
--     confirm_income_classification() is the only write path.
--   * vendor_1099_calendar_totals — 1099-NEC is a calendar-year form; the
--     existing vendor_1099_totals groups by fiscal year. Same filters, grouped
--     by the calendar year the payment was made.
--   * tax_form_templates — official PDFs (global, platform-admin managed,
--     DECISIONS #31). Ships with ZERO rows. A template is unusable until a
--     human has verified its field map and set it active; re-fetching a
--     changed file creates a new inactive row, never an auto-activation. The
--     PDFs live in the private `tax-templates` storage bucket (global, so not
--     the per-association Document Hub).
--   * tax_forms — one per required form per association per tax year (and per
--     contractor for 1099-NEC): determination, reason, status, due date.
--   * tax_form_fields — every value placed on a form, with where it came from
--     and whether a person confirmed it.
--   * document_links may now point at tax_forms (filled packets and proof of
--     filing live in the Document Hub).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Income classification: confirmed once by the board
-- ----------------------------------------------------------------------------

alter table public.accounts
  add column tax_classification_confirmed_at timestamptz,
  add column tax_classification_confirmed_by uuid references auth.users(id);

create or replace function public.confirm_income_classification(
  p_account_id uuid,
  p_is_exempt  boolean
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_assoc uuid;
  v_type  text;
begin
  select association_id, type::text into v_assoc, v_type from public.accounts where id = p_account_id;
  if v_assoc is null then
    raise exception 'account not found' using errcode = 'P0002';
  end if;
  if not public.is_board(v_assoc) then
    raise exception 'not authorized to classify income for this association' using errcode = '42501';
  end if;
  if v_type <> 'income' then
    raise exception 'only income accounts are classified here' using errcode = 'check_violation';
  end if;
  update public.accounts
     set is_exempt_function_income       = p_is_exempt,
         tax_classification_confirmed_at = now(),
         tax_classification_confirmed_by = auth.uid()
   where id = p_account_id;
end $$;

revoke all on function public.confirm_income_classification(uuid, boolean) from public, anon;
grant execute on function public.confirm_income_classification(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 1099-NEC by calendar year
-- ----------------------------------------------------------------------------

create view public.vendor_1099_calendar_totals
with (security_invoker = true) as
select
  v.id as vendor_id, v.association_id, v.name, v.entity_type, v.address,
  v.w9_on_file, v.is_1099_exempt, v.tin_last4, v.email,
  extract(year from e.paid_on)::int as calendar_year,
  sum(e.amount)::numeric(14,2)      as total_paid,
  count(*)::int                     as payment_count,
  array_agg(e.id order by e.paid_on) as expense_ids
from public.vendors v
join public.expenses e         on e.vendor_id = v.id and e.is_services
join public.journal_entries je on je.id = e.journal_entry_id and je.is_posted
where not v.is_1099_exempt
group by v.id, v.association_id, v.name, v.entity_type, v.address, v.w9_on_file,
         v.is_1099_exempt, v.tin_last4, v.email, extract(year from e.paid_on);

grant select on public.vendor_1099_calendar_totals to authenticated;

-- ----------------------------------------------------------------------------
-- Official form templates (global)
-- ----------------------------------------------------------------------------

create table public.tax_form_templates (
  id                  uuid primary key default gen_random_uuid(),
  form_code           text not null check (form_code in
                        ('irs_1120h', 'irs_1120', 'il_1120', 'irs_1099_nec', 'irs_1096', 'il_sos_annual_report', 'other')),
  tax_year            smallint not null check (tax_year between 2000 and 2100),
  revision            text,
  source_url          text not null check (
                        source_url ~ '^https://(www\.)?(irs\.gov|tax\.illinois\.gov|ilsos\.gov)/'),
  storage_path        text not null,
  sha256              text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- Every AcroForm field on the PDF, enumerated by code, so a human can check
  -- the map covers what matters: [{ "name": ..., "type": ... }].
  field_names_json    jsonb not null default '[]',
  -- pdf_field_name -> { label, section, source, rule, citation }. Unmapped
  -- fields are simply absent and render blank.
  field_map_json      jsonb not null default '{}',
  -- The due-date rule as a string one function interprets (lib/tax/due-rules),
  -- and where in the official instructions it comes from.
  due_rule            text,
  due_rule_citation   text,
  -- What to sign, what to attach, where to mail — for the cover sheet — with
  -- its citation. Plus anything a human learned verifying the form (e.g.
  -- Illinois treatment of 1120-H filers).
  filing_instructions text,
  filing_citation     text,
  notes               text,
  verified_at         timestamptz,
  verified_by         uuid references auth.users(id),
  active              boolean not null default false,
  fetched_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (form_code, tax_year, sha256),
  check (not active or verified_at is not null)
);

-- One live template per form per year.
create unique index tax_form_templates_one_active
  on public.tax_form_templates (form_code, tax_year) where active;

alter table public.tax_form_templates enable row level security;

-- Any signed-in user may read templates (they're public IRS/IL forms);
-- only a platform admin changes them.
create policy tax_form_templates_select on public.tax_form_templates
  for select to authenticated using (true);
create policy tax_form_templates_insert on public.tax_form_templates
  for insert to authenticated with check (public.is_platform_admin());
create policy tax_form_templates_update on public.tax_form_templates
  for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy tax_form_templates_delete on public.tax_form_templates
  for delete to authenticated using (public.is_platform_admin() and not active);

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'no storage schema — skipping tax-templates bucket (expected under PGlite)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('tax-templates', 'tax-templates', false, 15728640, array['application/pdf'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists tax_templates_read   on storage.objects;
  drop policy if exists tax_templates_write  on storage.objects;
  drop policy if exists tax_templates_delete on storage.objects;

  create policy tax_templates_read on storage.objects
    for select to authenticated using (bucket_id = 'tax-templates');
  create policy tax_templates_write on storage.objects
    for insert to authenticated with check (bucket_id = 'tax-templates' and public.is_platform_admin());
  create policy tax_templates_delete on storage.objects
    for delete to authenticated using (bucket_id = 'tax-templates' and public.is_platform_admin());
end $$;

-- ----------------------------------------------------------------------------
-- Forms an association needs, and every value on them
-- ----------------------------------------------------------------------------

create table public.tax_forms (
  id                      uuid primary key default gen_random_uuid(),
  association_id          uuid not null references public.associations(id) on delete restrict,
  form_code               text not null check (form_code in
                            ('irs_1120h', 'irs_1120', 'il_1120', 'irs_1099_nec', 'irs_1096', 'il_sos_annual_report', 'other')),
  -- Fiscal year for the returns; the calendar year of payment for 1099/1096.
  tax_year                smallint not null check (tax_year between 2000 and 2100),
  fiscal_year_id          uuid references public.fiscal_years(id) on delete restrict,
  -- One 1099-NEC per contractor.
  vendor_id               uuid references public.vendors(id) on delete restrict,
  determination           text not null check (determination in
                            ('required', 'likely_required', 'optional', 'not_required', 'ask_cpa')),
  determination_reason    text not null check (btrim(determination_reason) <> ''),
  status                  text not null default 'not_started' check (status in
                            ('not_started', 'draft', 'in_review', 'ready_to_sign', 'filed')),
  template_id             uuid references public.tax_form_templates(id) on delete restrict,
  signable_document_id    uuid references public.documents(id) on delete set null,
  editable_document_id    uuid references public.documents(id) on delete set null,
  worksheet_document_id   uuid references public.documents(id) on delete set null,
  filed_on                date,
  filed_proof_document_id uuid references public.documents(id) on delete set null,
  due_on                  date,
  created_by              uuid references auth.users(id) default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check ((status = 'filed') = (filed_on is not null)),
  check ((form_code = 'irs_1099_nec') = (vendor_id is not null))
);

create unique index tax_forms_one_per_year
  on public.tax_forms (association_id, form_code, tax_year, coalesce(vendor_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.tax_form_fields (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references public.associations(id) on delete restrict,
  tax_form_id     uuid not null references public.tax_forms(id) on delete cascade,
  pdf_field_name  text not null,
  label           text not null,
  section         text,
  citation        text,
  value           text,
  source          text not null check (source in ('setting', 'ledger', 'contractors', 'manual', 'calculated')),
  -- Setting key, transaction/expense ids, or the formula and its inputs.
  source_ref_json jsonb not null default '{}',
  confidence      text not null check (confidence in ('high', 'review', 'blank')),
  -- A newer value from the records that differs from one a person confirmed
  -- or typed — shown as "your records now say $X, you entered $Y".
  proposed_value  text,
  user_edited     boolean not null default false,
  leave_blank     boolean not null default false,
  confirmed_by    uuid references auth.users(id),
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tax_form_id, pdf_field_name)
);

create or replace function public.tg_tax_form_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'tax_forms' then
    if new.vendor_id is not null and not exists (
      select 1 from public.vendors v where v.id = new.vendor_id and v.association_id = new.association_id
    ) then
      raise exception 'contractor belongs to a different association' using errcode = '42501';
    end if;
    if new.fiscal_year_id is not null and not exists (
      select 1 from public.fiscal_years f where f.id = new.fiscal_year_id and f.association_id = new.association_id
    ) then
      raise exception 'fiscal year belongs to a different association' using errcode = '42501';
    end if;
  else
    if not exists (
      select 1 from public.tax_forms t where t.id = new.tax_form_id and t.association_id = new.association_id
    ) then
      raise exception 'form belongs to a different association' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger tax_forms_same_association
  before insert or update on public.tax_forms
  for each row execute function public.tg_tax_form_same_association();
create trigger tax_form_fields_same_association
  before insert or update on public.tax_form_fields
  for each row execute function public.tg_tax_form_same_association();

do $$
declare
  t text;
  tables text[] := array['tax_forms', 'tax_form_fields'];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.can_read_financials(association_id))', t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.is_board(association_id))', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_board(association_id))
         with check (public.is_board(association_id))', t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.has_role_in(association_id, array[''board_admin'']::public.app_role[]))',
      t || '_delete', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.tg_audit()', 'audit_' || t, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Filled packets and proof of filing link to the form in the Document Hub
-- ----------------------------------------------------------------------------

alter table public.document_links drop constraint document_links_target_table_known;
alter table public.document_links
  add constraint document_links_target_table_known
  check (target_table in (
    'associations', 'units', 'persons', 'vendors',
    'journal_entries', 'expenses', 'assessment_charges', 'payments',
    'insurance_policies', 'tickets', 'recurring_bills', 'fiscal_years',
    'tax_forms'
  ));
