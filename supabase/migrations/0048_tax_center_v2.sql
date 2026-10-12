-- ============================================================================
-- Walkup — migration 0048: Tax Center v2 — official links, link-only
-- templates, the accountant handoff, and rules resolved as of the period
--
-- Slice A1 of docs/reference/build-prompt-tax-center-v2.md (DECISIONS #33,
-- amending #32). Everything here is schema and rules; nothing in it sets a
-- template active or verified, stores a recipient TIN, or sends anything.
--
-- WHY. Dev and production both still have zero tax_form_templates, so a board
-- opening the Taxes tab today sees no official link, no due date and no way
-- to hand figures to their CPA. The template path stays the gate for anything
-- Walkup *fills*, but a board should not need a verified template to find the
-- right IRS page, know roughly when a form is due, or email their accountant.
--
-- WHAT.
--   A. tax_form_links — a global registry of official URLs (irs.gov,
--      tax.illinois.gov, ilsos.gov, ilga.gov only), seeded with the links
--      research found on 2026-10-11. Every seeded row is `verified_at null`:
--      boards see "retrieved 2026-10-11 · not yet checked by a person" until a
--      platform admin opens the link and marks it current. Same precedent as
--      the 0005 tax_parameters rows. Global (DECISIONS #31): any signed-in
--      user reads, only a platform admin writes, not on tg_audit().
--   B. tax_form_templates grows `kind` ('pdf' | 'link_only'): a link-only
--      template carries a cited due rule, filing instructions and notes for a
--      form Walkup never fills (IL-1120, the Illinois SOS annual report, Form
--      1096), with no PDF. storage_path/sha256 become nullable, tied to kind
--      by a CHECK. Also include_pages (1099-NEC exports keep only the
--      recipient copies), mirror_json (Copy 2 mirrors Copy B at export),
--      revision_title (the PDF's own title, so a silent re-issue is noticed),
--      instructions_url and suggested_from (which code-side suggestion an
--      admin installed it from). The form_code CHECK is unchanged — a W-9 is
--      never a template.
--   C. tax_forms records when a form was sent to the accountant, by whom, and
--      a snapshot of what was sent. `determination` gains 'eligible': 1120-H
--      is an election, not a requirement — when both tests pass the honest
--      answer is "you qualify; elect it by filing".
--   D. associations gains the accountant (a persons row + firm, set through
--      set_accountant()), the Illinois SOS file number, and the answer to
--      "how do you file 1099s with the IRS?" (paper | electronic | not yet
--      known), which is what decides whether Form 1096 is needed. A trigger
--      refuses an accountant from another association.
--   E. redact_person() refuses while the person is recorded as the accountant
--      (DECISIONS #30 — the accountant is personal data in persons; clear the
--      pointer first, then redact).
--   F. tax_parameters: the $600 1099-NEC threshold ends 2026-01-01 and a
--      $2,000 row starts there (P.L. 119-21 §70433; unverified, cited).
--      verify_tax_parameter() lets a platform admin mark a rule checked.
--   G. is_platform_admin() now also requires session_is_aal2(): a
--      password-only session must not be able to change what every
--      association's tax pages read from.
--   H. compute_and_save_tax_filing() resolves the four 1120-H parameters as
--      of the fiscal year's end rather than today, and the frozen snapshot
--      says which date it was resolved for. Same signature, same provenance
--      rows, same arithmetic as 0022/0024.
--
-- HOW TO APPLY. Dev/staging now; production waits for "General Kenobi". No
-- data backfill is needed: new columns are nullable or defaulted, the
-- determination CHECK only widens, and the $600 → $2,000 split is a pure
-- insert plus one effective_to. After applying, the admin page's "Rules and
-- thresholds" card shows both threshold rows unchecked — that is correct
-- until a person checks them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. Official links registry (global)
-- ----------------------------------------------------------------------------

create table public.tax_form_links (
  id                uuid primary key default gen_random_uuid(),
  -- irs_w9 is a link here (boards request W-9s) but never a template.
  form_code         text not null check (form_code in
                      ('irs_1120h', 'irs_1120', 'il_1120', 'irs_1099_nec', 'irs_1096', 'il_sos_annual_report', 'irs_w9')),
  kind              text not null check (kind in
                      ('about', 'form', 'instructions', 'file_online', 'order_paper', 'guidance', 'law')),
  label             text not null check (btrim(label) <> ''),
  -- Official hosts only. Any subdomain of these four, nothing else.
  url               text not null check (
                      url ~ '^https://([a-z0-9-]+\.)*(irs\.gov|illinois\.gov|ilsos\.gov|ilga\.gov)/'),
  -- Null = federal, shown to every building; 'IL' = Illinois buildings only.
  state_code        text check (state_code is null or state_code ~ '^[A-Z]{2}$'),
  -- When research last opened it, and what research saw. Not a verification.
  retrieved_on      date not null,
  retrieved_note    text,
  -- A person opened the link and confirmed it is current. Never set by code.
  verified_at       timestamptz,
  verified_by       uuid references auth.users(id),
  -- The admin's "Check all links": '200', 'blocked' (ilsos.gov refuses
  -- non-browser clients), or 'error: …'. Informational, not a verification.
  last_checked_at   timestamptz,
  last_check_status text,
  active            boolean not null default true,
  sort_order        smallint not null default 100,
  created_at        timestamptz not null default now(),
  unique (form_code, kind, url)
);

alter table public.tax_form_links enable row level security;

-- Public government URLs: any signed-in user may read them. Only a platform
-- admin adds, verifies, deactivates or removes one.
create policy tax_form_links_select on public.tax_form_links
  for select to authenticated using (true);
create policy tax_form_links_insert on public.tax_form_links
  for insert to authenticated with check (public.is_platform_admin());
create policy tax_form_links_update on public.tax_form_links
  for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy tax_form_links_delete on public.tax_form_links
  for delete to authenticated using (public.is_platform_admin());

-- Not on tg_audit(): the audit log is per association and this table belongs
-- to none (same as insurance_partners and tax_form_templates).

-- Seed: what Walkup research opened on 2026-10-11. Every row unverified.
insert into public.tax_form_links
  (form_code, kind, label, url, state_code, retrieved_on, retrieved_note, sort_order)
select
  v.form_code, v.kind, v.label, v.url, v.state_code,
  date '2026-10-11',
  'Retrieved by Walkup research on 2026-10-11 (HTTP 200 by GET; ilsos.gov opened in a browser). Not yet checked by a person.',
  case v.kind
    when 'about'        then 10
    when 'form'         then 20
    when 'instructions' then 30
    when 'file_online'  then 40
    when 'order_paper'  then 50
    when 'guidance'     then 60
    when 'law'          then 70
  end
from (values
  -- Form 1120-H
  ('irs_1120h', 'about', 'About Form 1120-H',
   'https://www.irs.gov/forms-pubs/about-form-1120-h', null::text),
  ('irs_1120h', 'instructions', 'Instructions for Form 1120-H',
   'https://www.irs.gov/instructions/i1120h', null),
  ('irs_1120h', 'form', 'Form 1120-H (PDF, current revision)',
   'https://www.irs.gov/pub/irs-pdf/f1120h.pdf', null),
  -- Form 1120 (when a test fails)
  ('irs_1120', 'about', 'About Form 1120',
   'https://www.irs.gov/forms-pubs/about-form-1120', null),
  -- Form 1099-NEC
  ('irs_1099_nec', 'about', 'About Form 1099-NEC',
   'https://www.irs.gov/forms-pubs/about-form-1099-nec', null),
  ('irs_1099_nec', 'instructions', 'Instructions for Forms 1099-MISC and 1099-NEC',
   'https://www.irs.gov/instructions/i1099mec', null),
  ('irs_1099_nec', 'guidance', 'General Instructions for Certain Information Returns',
   'https://www.irs.gov/instructions/i1099gi', null),
  ('irs_1099_nec', 'file_online', 'File 1099s online with IRIS (free)',
   'https://www.irs.gov/filing/e-file-information-returns-with-iris', null),
  ('irs_1099_nec', 'order_paper', 'Order official paper forms from the IRS',
   'https://www.irs.gov/businesses/order-paper-information-returns-and-employer-returns', null),
  -- Form 1096 (paper 1099s only)
  ('irs_1096', 'about', 'About Form 1096',
   'https://www.irs.gov/forms-pubs/about-form-1096', null),
  -- Form W-9 (requested from contractors; never filled by Walkup)
  ('irs_w9', 'about', 'About Form W-9',
   'https://www.irs.gov/forms-pubs/about-form-w-9', null),
  ('irs_w9', 'form', 'Form W-9 (PDF)',
   'https://www.irs.gov/pub/irs-pdf/fw9.pdf', null),
  -- Illinois: IL-1120
  ('il_1120', 'about', 'Illinois corporate income tax forms (IL-1120)',
   'https://tax.illinois.gov/forms/incometax/currentyear/business-corporate.html', 'IL'),
  ('il_1120', 'guidance', 'Illinois DOR: which return a homeowners association files',
   'https://tax.illinois.gov/questionsandanswers/answer.458.html', 'IL'),
  ('il_1120', 'instructions', 'Illinois corporate income tax — due dates and extensions',
   'https://tax.illinois.gov/research/taxinformation/income/corporate.html', 'IL'),
  -- Illinois: Secretary of State NFP annual report
  ('il_sos_annual_report', 'file_online', 'File the annual report online (ILSOS)',
   'https://apps.ilsos.gov/nfpannualreports/', 'IL'),
  ('il_sos_annual_report', 'instructions', 'How to file an NFP annual report',
   'https://www.ilsos.gov/departments/business-services/annual-reports/nfp-instructions.html', 'IL'),
  ('il_sos_annual_report', 'about', 'ILSOS annual reports',
   'https://www.ilsos.gov/departments/business-services/annual-reports.html', 'IL'),
  ('il_sos_annual_report', 'law', 'General Not For Profit Corporation Act (805 ILCS 105)',
   'https://www.ilga.gov/Legislation/ILCS/Articles?ActID=2280&ChapterID=65', 'IL')
) as v(form_code, kind, label, url, state_code);

-- ----------------------------------------------------------------------------
-- B. Templates: link-only kind, export shaping, provenance of the fetch
-- ----------------------------------------------------------------------------

alter table public.tax_form_templates
  -- 'link_only': a cited due rule + filing instructions for a form Walkup
  -- never fills. No PDF, no field map, same verify/activate gate.
  add column kind             text not null default 'pdf' check (kind in ('pdf', 'link_only')),
  -- 1-based page numbers kept in PDF exports (1099-NEC: the recipient copies,
  -- pages 4–6). Null = every page.
  add column include_pages    smallint[] check (
                                include_pages is null
                                or (cardinality(include_pages) > 0 and 1 <= all (include_pages))),
  -- [{ "from": "CopyB[0]", "to": "Copy2[0]" }]: at export, every filled value
  -- whose field name contains `from` is also written to the twin name with
  -- `to`, so Copy 2 matches Copy B without mapping it twice.
  add column mirror_json      jsonb not null default '[]' check (jsonb_typeof(mirror_json) = 'array'),
  -- The PDF's own title at fetch time ("2025 Form 1120-H"). A changed title on
  -- re-fetch is probably next year's form, not a correction.
  add column revision_title   text,
  add column instructions_url text check (
                                instructions_url is null
                                or instructions_url ~ '^https://(www\.)?(irs\.gov|tax\.illinois\.gov|ilsos\.gov)/'),
  -- Key of the code-side suggestion (src/lib/tax/suggested) an admin installed
  -- this from, if any. Informational.
  add column suggested_from   text,
  alter column storage_path drop not null,
  alter column sha256 drop not null,
  add constraint tax_form_templates_pdf_has_file
    check ((kind = 'pdf') = (storage_path is not null and sha256 is not null));

-- ----------------------------------------------------------------------------
-- C. Forms: the accountant handoff, and 1120-H as an election
-- ----------------------------------------------------------------------------

alter table public.tax_forms
  add column sent_to_accountant_at timestamptz,
  add column sent_to_accountant_by uuid references auth.users(id),
  -- { subject, body, attachments: [filenames], figures } as drafted at send
  -- time, so "what did we send them?" has an answer after the books move on.
  add column sent_snapshot_json    jsonb,
  add constraint tax_forms_sent_by_needs_when
    check (sent_to_accountant_by is null or sent_to_accountant_at is not null);

-- 'eligible': both 1120-H tests pass. Filing 1120-H is a yearly election, so
-- "Required" was the wrong word; 'likely_required' stays for Form 1120 when a
-- test fails.
alter table public.tax_forms drop constraint tax_forms_determination_check;
alter table public.tax_forms
  add constraint tax_forms_determination_check
  check (determination in ('required', 'likely_required', 'eligible', 'optional', 'not_required', 'ask_cpa'));

-- ----------------------------------------------------------------------------
-- D. The association's accountant and filing settings
-- ----------------------------------------------------------------------------

alter table public.associations
  -- A persons row (DECISIONS #30), independent of any `accountant` role grant.
  add column accountant_person_id       uuid references public.persons(id) on delete set null,
  add column accountant_firm            text,
  add column il_sos_file_number         text,
  add column information_returns_filing text check (
                                          information_returns_filing is null
                                          or information_returns_filing in ('paper', 'electronic'));

comment on column public.associations.accountant_person_id is
  'The tax accountant the board hands figures to. A persons row in this association; redact_person() refuses while set. Set through set_accountant().';
comment on column public.associations.accountant_firm is
  'The accountant''s firm, for the email draft. Cleared with the accountant.';
comment on column public.associations.il_sos_file_number is
  'Illinois Secretary of State corporation file number — the annual report portal asks for it. Set through set_tax_filing_settings().';
comment on column public.associations.information_returns_filing is
  'How the board files 1099s with the IRS: paper (Form 1096 required), electronic (IRIS; no 1096), null = not yet answered (ask your CPA). Set through set_tax_filing_settings().';

-- The FK alone would let a board point at a person in another association.
create or replace function public.tg_association_accountant_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.accountant_person_id is not null and not exists (
    select 1 from public.persons p
     where p.id = new.accountant_person_id and p.association_id = new.id
  ) then
    raise exception 'accountant belongs to a different association' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_association_accountant_same_association() from public, anon;
grant execute on function public.tg_association_accountant_same_association() to authenticated;

create trigger associations_accountant_same_association
  before insert or update of accountant_person_id on public.associations
  for each row execute function public.tg_association_accountant_same_association();

-- Board members (not only board_admin) may name the accountant: it is a
-- contact, not an access grant. "Give them read access" stays a separate,
-- expiring role grant. A null person clears both columns.
create or replace function public.set_accountant(
  p_association_id uuid,
  p_person_id      uuid,
  p_firm           text
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_board(p_association_id) then
    raise exception 'not authorized to set the accountant for this association' using errcode = '42501';
  end if;
  update public.associations
     set accountant_person_id = p_person_id,
         accountant_firm      = case when p_person_id is null then null
                                     else nullif(btrim(p_firm), '') end
   where id = p_association_id;
end $$;

revoke all on function public.set_accountant(uuid, uuid, text) from public, anon;
grant execute on function public.set_accountant(uuid, uuid, text) to authenticated;

-- Both settings in one call; pass the current value of the one you are not
-- changing. Null for the filing method means "not yet answered".
create or replace function public.set_tax_filing_settings(
  p_association_id             uuid,
  p_information_returns_filing text,
  p_il_sos_file_number         text
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_board(p_association_id) then
    raise exception 'not authorized to change tax filing settings for this association' using errcode = '42501';
  end if;
  if p_information_returns_filing is not null
     and p_information_returns_filing not in ('paper', 'electronic') then
    raise exception 'how 1099s are filed must be ''paper'', ''electronic'' or not yet answered'
      using errcode = 'check_violation';
  end if;
  update public.associations
     set information_returns_filing = p_information_returns_filing,
         il_sos_file_number         = nullif(btrim(p_il_sos_file_number), '')
   where id = p_association_id;
end $$;

revoke all on function public.set_tax_filing_settings(uuid, text, text) from public, anon;
grant execute on function public.set_tax_filing_settings(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- E. redact_person(): one more refusal
-- ----------------------------------------------------------------------------
-- The full 0037 body, unchanged except for the accountant check after the
-- unit-owner check. The FK is ON DELETE SET NULL, but redaction doesn't
-- delete — it would leave "Former member" named as the accountant on every
-- email draft. Choose another accountant (or clear it) first.

create or replace function public.redact_person(p_person_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.persons%rowtype;
begin
  select * into p from public.persons where id = p_person_id;
  if not found then
    raise exception 'person not found';
  end if;

  if not public.has_role_in(
       p.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not authorized to remove personal data for this association'
      using errcode = '42501';
  end if;

  if p.auth_user_id is not null and p.auth_user_id = auth.uid() then
    raise exception 'you can''t remove your own personal data from here';
  end if;

  if exists (
    select 1 from public.role_grants g
     where g.person_id = p.id
       and g.revoked_at is null
       and (g.expires_on is null or g.expires_on >= current_date)) then
    raise exception 'revoke this person''s access before removing their personal data';
  end if;

  if exists (
    select 1 from public.unit_owners uo
     where uo.person_id = p.id
       and (uo.effective_to is null or uo.effective_to >= current_date)) then
    raise exception 'this person still owns a unit — record the ownership change first';
  end if;

  if exists (
    select 1 from public.associations a where a.accountant_person_id = p.id) then
    raise exception 'this person is recorded as your tax accountant — choose another accountant first';
  end if;

  update public.persons
     set full_name       = 'Former member',
         email           = null,
         phone           = null,
         mailing_address = null,
         auth_user_id    = null
   where id = p.id;

  if p.email is not null then
    update public.invites
       set email = null
     where association_id = p.association_id
       and lower(email) = lower(p.email);

    update public.audit_log
       set before_data = case when before_data is null then null
                              else before_data || jsonb_build_object('email', null) end,
           after_data  = case when after_data is null then null
                              else after_data  || jsonb_build_object('email', null) end
     where association_id = p.association_id
       and table_name = 'invites'
       and (lower(before_data->>'email') = lower(p.email)
         or lower(after_data->>'email')  = lower(p.email));
  end if;

  -- Includes the row the update above just wrote, whose before_data still
  -- holds everything that was removed.
  update public.audit_log
     set before_data = case when before_data is null then null
                            else before_data || jsonb_build_object(
                              'full_name', '[redacted]', 'email', null,
                              'phone', null, 'mailing_address', null) end,
         after_data  = case when after_data is null then null
                            else after_data || jsonb_build_object(
                              'full_name', case when after_data->>'full_name' = 'Former member'
                                                then 'Former member' else '[redacted]' end,
                              'email', null, 'phone', null, 'mailing_address', null) end
   where association_id = p.association_id
     and table_name = 'persons'
     and record_id = p.id;
end $$;

-- ----------------------------------------------------------------------------
-- F. 1099-NEC threshold: $600 through 2025, $2,000 from 2026
-- ----------------------------------------------------------------------------
-- Readers resolve the threshold as of December 31 of the payment year with
-- the half-open range [effective_from, effective_to) — the same range the
-- tax_parameters_no_overlap exclusion constraint (0001) is built on.

update public.tax_parameters
   set effective_to = '2026-01-01'
 where key = 'form_1099_nec_threshold' and effective_to is null;

insert into public.tax_parameters
  (key, numeric_value, effective_from, effective_to, source_url, verified_on, notes)
values
  ('form_1099_nec_threshold', 2000.00, '2026-01-01', null,
   'https://www.irs.gov/instructions/i1099mec', null,
   'Per contractor per calendar year, for services, for payments made after 2025-12-31 (P.L. 119-21 §70433 as described in Federal Register REG-113229-25; Instructions for Forms 1099-MISC and 1099-NEC, Rev. December 2026, What''s New). Indexed for inflation from calendar year 2027 — add a new row when the IRS publishes the amount. Retrieved 2026-10-11; not CPA-checked.');

-- A platform admin marks a rule as checked today. tax_parameters stays
-- select-only through the API (0002); this is the one write path, and it
-- changes nothing but verified_on.
create or replace function public.verify_tax_parameter(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized to mark a tax rule as checked' using errcode = '42501';
  end if;
  update public.tax_parameters set verified_on = current_date where id = p_id;
  if not found then
    raise exception 'tax parameter not found' using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.verify_tax_parameter(uuid) from public, anon;
grant execute on function public.verify_tax_parameter(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- G. Platform admin requires MFA
-- ----------------------------------------------------------------------------
-- Same gate 0025 put on has_role_in(): a password-only session is not enough
-- to edit the templates, links and rules every association reads from.
-- Privileges carry over from 0041's revoke/grant.

-- Guarded: an environment that never applied 0025 (the dev project doesn't
-- enforce MFA at the database) has no session_is_aal2(); there the function
-- keeps its 0041 body rather than failing the whole migration.
do $do$
begin
  if to_regprocedure('public.session_is_aal2()') is null then
    raise notice 'session_is_aal2() not present (0025 not applied) — is_platform_admin() left as in 0041';
    return;
  end if;
  execute $f$
    create or replace function public.is_platform_admin()
    returns boolean
    language sql stable security definer set search_path = ''
    as $body$
      select public.session_is_aal2()
         and exists (select 1 from public.platform_admins where user_id = auth.uid());
    $body$
  $f$;
end $do$;

-- ----------------------------------------------------------------------------
-- H. compute_and_save_tax_filing(): parameters as of the fiscal year end
-- ----------------------------------------------------------------------------
-- 0022 resolved the four 1120-H parameters as of current_date, which is wrong
-- the moment a rate changes between a fiscal year's end and the day the board
-- saves its figures. Now resolved as of fiscal_years.ends_on, with the same
-- half-open range as F, and every row in parameters_snapshot carries the
-- "as_of" date it was resolved for. Figures, provenance rows and arithmetic
-- are exactly 0022/0024's; keep this in step with
-- src/lib/tax/form1120h.ts's computeForm1120h() as that comment says.

create or replace function public.compute_and_save_tax_filing(
  p_association_id uuid,
  p_fiscal_year_id uuid
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_filing              uuid;
  v_locked_at           timestamptz;
  v_as_of               date;
  v_exempt_income        numeric(14,2);
  v_exempt_income_lines   uuid[];
  v_nonexempt_income      numeric(14,2);
  v_nonexempt_income_lines uuid[];
  v_gross_income          numeric(14,2);
  v_gross_income_lines     uuid[];
  v_exempt_expenditures    numeric(14,2);
  v_exempt_expenditures_lines uuid[];
  v_total_expenditures     numeric(14,2);
  v_total_expenditures_lines uuid[];
  v_rate                 numeric(14,6);
  v_deduction             numeric(14,2);
  v_income_test_threshold numeric(9,6);
  v_expenditure_test_threshold numeric(9,6);
  v_income_ratio          numeric(9,6);
  v_expenditure_ratio     numeric(9,6);
  v_income_passed         boolean;
  v_expenditure_passed    boolean;
  v_taxable_income        numeric(14,2);
  v_tax_due               numeric(14,2);
  v_params_snapshot       jsonb;
begin
  if not public.is_board(p_association_id) then
    raise exception 'not authorized to save a tax filing for this association'
      using errcode = '42501';
  end if;

  select locked_at into v_locked_at
    from public.tax_filings
   where association_id = p_association_id
     and fiscal_year_id = p_fiscal_year_id
     and form = '1120-H';

  if v_locked_at is not null then
    raise exception 'this filing is locked and cannot be recomputed'
      using errcode = 'check_violation';
  end if;

  -- The date the rules are read as of. Scoped to the association so a board
  -- can't save a filing against another building's fiscal year.
  select ends_on into v_as_of
    from public.fiscal_years
   where id = p_fiscal_year_id and association_id = p_association_id;

  if v_as_of is null then
    raise exception 'fiscal year not found for this association' using errcode = 'P0002';
  end if;

  select coalesce(sum(amount), 0), coalesce(array_agg(journal_line_id), '{}')
    into v_exempt_income, v_exempt_income_lines
    from public.cash_basis_receipts
   where association_id = p_association_id and fiscal_year_id = p_fiscal_year_id
     and is_exempt;

  select coalesce(sum(amount), 0), coalesce(array_agg(journal_line_id), '{}')
    into v_nonexempt_income, v_nonexempt_income_lines
    from public.cash_basis_receipts
   where association_id = p_association_id and fiscal_year_id = p_fiscal_year_id
     and not is_exempt;

  select coalesce(sum(amount), 0), coalesce(array_agg(journal_line_id), '{}')
    into v_gross_income, v_gross_income_lines
    from public.cash_basis_receipts
   where association_id = p_association_id and fiscal_year_id = p_fiscal_year_id;

  select coalesce(sum(amount), 0), coalesce(array_agg(journal_line_id), '{}')
    into v_exempt_expenditures, v_exempt_expenditures_lines
    from public.cash_basis_disbursements
   where association_id = p_association_id and fiscal_year_id = p_fiscal_year_id
     and is_exempt;

  select coalesce(sum(amount), 0), coalesce(array_agg(journal_line_id), '{}')
    into v_total_expenditures, v_total_expenditures_lines
    from public.cash_basis_disbursements
   where association_id = p_association_id and fiscal_year_id = p_fiscal_year_id;

  select numeric_value into v_rate
    from public.tax_parameters
   where key = 'form_1120h_rate_condo' and effective_from <= v_as_of
     and (effective_to is null or effective_to > v_as_of);
  select numeric_value into v_deduction
    from public.tax_parameters
   where key = 'form_1120h_specific_deduction' and effective_from <= v_as_of
     and (effective_to is null or effective_to > v_as_of);
  select numeric_value into v_income_test_threshold
    from public.tax_parameters
   where key = 'form_1120h_income_test' and effective_from <= v_as_of
     and (effective_to is null or effective_to > v_as_of);
  select numeric_value into v_expenditure_test_threshold
    from public.tax_parameters
   where key = 'form_1120h_expenditure_test' and effective_from <= v_as_of
     and (effective_to is null or effective_to > v_as_of);

  if v_rate is null or v_deduction is null
     or v_income_test_threshold is null or v_expenditure_test_threshold is null then
    raise exception 'a required 1120-H tax parameter is missing from tax_parameters'
      using errcode = 'check_violation';
  end if;

  if v_gross_income = 0 then
    v_income_ratio := null; v_income_passed := true;
  else
    v_income_ratio := round(v_exempt_income / v_gross_income, 6);
    v_income_passed := v_income_ratio >= v_income_test_threshold;
  end if;

  if v_total_expenditures = 0 then
    v_expenditure_ratio := null; v_expenditure_passed := true;
  else
    v_expenditure_ratio := round(v_exempt_expenditures / v_total_expenditures, 6);
    v_expenditure_passed := v_expenditure_ratio >= v_expenditure_test_threshold;
  end if;

  v_taxable_income := greatest(0, v_nonexempt_income - v_deduction);
  v_tax_due := round(v_taxable_income * v_rate, 2);

  -- Same array shape as 0022's snapshot (older filings keep theirs), with the
  -- resolution date on every row.
  select jsonb_agg((to_jsonb(tp) - 'id') || jsonb_build_object('as_of', v_as_of))
    into v_params_snapshot
    from public.tax_parameters tp
   where key in ('form_1120h_rate_condo', 'form_1120h_specific_deduction',
                 'form_1120h_income_test', 'form_1120h_expenditure_test')
     and effective_from <= v_as_of
     and (effective_to is null or effective_to > v_as_of);

  insert into public.tax_filings (
    association_id, fiscal_year_id, form,
    exempt_income_cash, nonexempt_income_cash, gross_income_cash,
    exempt_expenditures_cash, total_expenditures_cash,
    test_60_pct_ratio, test_60_pct_passed, test_90_pct_ratio, test_90_pct_passed,
    taxable_income, tax_due, parameters_snapshot, computed_at
  ) values (
    p_association_id, p_fiscal_year_id, '1120-H',
    v_exempt_income, v_nonexempt_income, v_gross_income,
    v_exempt_expenditures, v_total_expenditures,
    v_income_ratio, v_income_passed, v_expenditure_ratio, v_expenditure_passed,
    v_taxable_income, v_tax_due, v_params_snapshot, now()
  )
  on conflict (association_id, fiscal_year_id, form) do update set
    exempt_income_cash = excluded.exempt_income_cash,
    nonexempt_income_cash = excluded.nonexempt_income_cash,
    gross_income_cash = excluded.gross_income_cash,
    exempt_expenditures_cash = excluded.exempt_expenditures_cash,
    total_expenditures_cash = excluded.total_expenditures_cash,
    test_60_pct_ratio = excluded.test_60_pct_ratio,
    test_60_pct_passed = excluded.test_60_pct_passed,
    test_90_pct_ratio = excluded.test_90_pct_ratio,
    test_90_pct_passed = excluded.test_90_pct_passed,
    taxable_income = excluded.taxable_income,
    tax_due = excluded.tax_due,
    parameters_snapshot = excluded.parameters_snapshot,
    computed_at = excluded.computed_at
  returning id into v_filing;

  delete from public.tax_figure_provenance where filing_id = v_filing;

  insert into public.tax_figure_provenance
    (association_id, filing_id, figure_key, value, derivation, source_journal_line_ids, formula_description)
  values
    (p_association_id, v_filing, 'exempt_income', v_exempt_income, 'sum',
     v_exempt_income_lines, 'sum of cash receipts classified as exempt function income'),
    (p_association_id, v_filing, 'nonexempt_income', v_nonexempt_income, 'sum',
     v_nonexempt_income_lines, 'sum of cash receipts not classified as exempt function income'),
    (p_association_id, v_filing, 'gross_income', v_gross_income, 'sum',
     v_gross_income_lines, 'sum of all cash receipts for the fiscal year'),
    (p_association_id, v_filing, 'exempt_expenditures', v_exempt_expenditures, 'sum',
     v_exempt_expenditures_lines, 'sum of cash disbursements classified as exempt expenditures'),
    (p_association_id, v_filing, 'total_expenditures', v_total_expenditures, 'sum',
     v_total_expenditures_lines, 'sum of all cash disbursements for the fiscal year'),
    (p_association_id, v_filing, 'taxable_income', v_taxable_income, 'computed',
     '{}', format('greatest(0, nonexempt_income %s - specific deduction %s)', v_nonexempt_income, v_deduction)),
    (p_association_id, v_filing, 'tax_due', v_tax_due, 'computed',
     '{}', format('taxable_income %s x rate %s', v_taxable_income, v_rate)),
    (p_association_id, v_filing, 'test_60_pct_ratio', v_income_ratio, 'computed',
     '{}', format('exempt_income %s / gross_income %s, must be >= %s', v_exempt_income, v_gross_income, v_income_test_threshold)),
    (p_association_id, v_filing, 'test_90_pct_ratio', v_expenditure_ratio, 'computed',
     '{}', format('exempt_expenditures %s / total_expenditures %s, must be >= %s', v_exempt_expenditures, v_total_expenditures, v_expenditure_test_threshold));

  return v_filing;
end $$;
