-- ============================================================================
-- Walkup — migration 0052: insurance v2
--
-- docs/specs/insurance-spec.md (and the master brief, decisions 1–11).
--
--   * coverage_type gains fidelity/crime, equipment breakdown, cyber,
--     earthquake and employment practices. NOTE: Postgres refuses a new enum
--     value inside the transaction that added it, so nothing below uses them;
--     slug lists are text[] with literal checks.
--   * insurance_policies and insurance_quotes share one set of per-coverage
--     columns (percent deductibles as numeric(6,4) fractions, valuation,
--     coinsurance, ordinance or law A/B/C, D&O/crime/umbrella/flood/
--     earthquake/WC/cyber/EPL details, endorsements, exclusions, premium
--     breakdown). Policies gain a lifecycle (archive, replaced_by, accepted
--     quote, updated_at) and a stored plain-English summary.
--   * insurance_contacts: the board's own agent and any agency or insurer it
--     saved. Quote requests go to any contact, not only platform partners.
--   * insurance_messages: every drafted email, mirroring contractor_messages
--     (#22: nothing is sent by Walkup; "sent" needs an approver).
--   * insurance_document_reads: one read of one document, with a state machine
--     that cannot spin forever (attempt cap, stale detection).
--   * insurance_building_facts, insurance_finding_dismissals: the coverage check.
--   * insurance_owner_summaries + owner_insurance_summary(): the published,
--     owner-readable summary (decision 9). Owners still never read insurance_*.
--   * insurance_market_research: 30-day cache of web research (decision 10).
--   * recurring_bills.insurance_policy_id: one active premium bill per policy;
--     a renewal gets its own bill and the old one retires when paid out.
--   * save_insurance_policy / save_insurance_quote: transactional, idempotent
--     saves; provenance for read values is rebuilt from the stored read.
--   * Reads only of documents filed as Insurance (decision 7), enforced here.
--   * insurance_owner_requests: owners ask the board for proof of insurance.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Coverage types (not used anywhere else in this file, see header)
-- ----------------------------------------------------------------------------

alter type public.coverage_type add value if not exists 'fidelity_crime';
alter type public.coverage_type add value if not exists 'equipment_breakdown';
alter type public.coverage_type add value if not exists 'cyber';
alter type public.coverage_type add value if not exists 'earthquake';
alter type public.coverage_type add value if not exists 'employment_practices';

-- ----------------------------------------------------------------------------
-- 2. Contacts (before policies, which reference them)
-- ----------------------------------------------------------------------------

-- CHECK constraints can't hold subqueries; this immutable helper can. Every
-- element must be an http(s) URL, because the UI renders them as links.
create or replace function public.insurance_urls_ok(p text[])
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(bool_and(u ~* '^https?://[^[:space:]]+$'), true) from unnest(p) u
$$;
revoke all on function public.insurance_urls_ok(text[]) from public, anon;
grant execute on function public.insurance_urls_ok(text[]) to authenticated;

create table public.insurance_contacts (
  id               uuid primary key default gen_random_uuid(),
  association_id   uuid not null references public.associations(id) on delete restrict,
  kind             text not null default 'agency'
                     check (kind in ('agent', 'agency', 'broker', 'insurer', 'adjuster', 'other')),
  name             text not null check (length(btrim(name)) > 0),
  person_name      text,
  email            text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone            text,
  website_url      text check (website_url is null or website_url ~* '^https?://'),
  city             text,
  state_code       text check (state_code is null or state_code ~ '^[A-Z]{2}$'),
  lines            text[] not null default '{}' check (lines <@ array[
                     'property', 'general_liability', 'directors_officers', 'umbrella', 'flood',
                     'workers_comp', 'fidelity_crime', 'equipment_breakdown', 'cyber', 'earthquake',
                     'employment_practices', 'other']::text[]),
  source           text not null default 'manual' check (source in ('manual', 'policy', 'web', 'partner')),
  source_urls      text[] not null default '{}' check (public.insurance_urls_ok(source_urls)),
  found_key        text,          -- the research item's stable key (§7.3.4), for "Saved" state and dedupe
  found_at         timestamptz,
  partner_id       uuid references public.insurance_partners(id) on delete set null,
  is_current_agent boolean not null default false,
  notes            text,
  archived_at      timestamptz,
  created_by       uuid references auth.users(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index insurance_contacts_identity_key
  on public.insurance_contacts (association_id, lower(name), lower(coalesce(email, '')))
  where archived_at is null;
create index on public.insurance_contacts (association_id) where archived_at is null;
-- At most one current agent. Writers clear the others first, in the same
-- statement batch (saveContact) or transaction (backfill below).
create unique index insurance_contacts_one_current_agent
  on public.insurance_contacts (association_id)
  where is_current_agent and archived_at is null;

comment on table public.insurance_contacts is
  'Insurance agents, agencies, brokers and insurers the board works with or saved from Walkup''s web research. Found contacts keep the source URLs they were found on (decision 5). Saving a contact is not an endorsement.';

-- ----------------------------------------------------------------------------
-- 3. Shared coverage columns on insurance_policies and insurance_quotes
-- ----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['insurance_policies', 'insurance_quotes'] loop
    execute format($f$
      alter table public.%1$I
        add column taxes_and_fees                    numeric(14,2) check (taxes_and_fees is null or taxes_and_fees >= 0),
        add column claims_phone                      text check (claims_phone is null or length(claims_phone) <= 40),
        add column client_token                      uuid,
        add column included_sections                 text[] not null default '{}' check (included_sections <@ array[
                                                       'property', 'property_deductibles', 'liability', 'do', 'crime', 'umbrella',
                                                       'flood', 'earthquake', 'equipment', 'workers_comp', 'cyber', 'epli', 'generic']::text[]),
        add column business_personal_property_limit  numeric(14,2) check (business_personal_property_limit is null or business_personal_property_limit >= 0),
        add column loss_of_income_limit              numeric(14,2) check (loss_of_income_limit is null or loss_of_income_limit >= 0),
        add column valuation                         text not null default 'unknown' check (valuation in
                                                       ('replacement_cost', 'extended_replacement_cost', 'functional_replacement_cost', 'actual_cash_value', 'unknown')),
        add column extended_replacement_percent      numeric(6,4) check (extended_replacement_percent is null or extended_replacement_percent between 0 and 1),
        add column coinsurance_percent               numeric(6,4) check (coinsurance_percent is null or coinsurance_percent between 0 and 1),
        add column agreed_value                      boolean,
        add column cause_of_loss_form                text not null default 'unknown' check (cause_of_loss_form in ('special', 'broad', 'basic', 'unknown')),
        add column ordinance_law_a_included          boolean,
        add column ordinance_law_b_limit             numeric(14,2) check (ordinance_law_b_limit is null or ordinance_law_b_limit >= 0),
        add column ordinance_law_c_limit             numeric(14,2) check (ordinance_law_c_limit is null or ordinance_law_c_limit >= 0),
        add column ordinance_law_bc_limit            numeric(14,2) check (ordinance_law_bc_limit is null or ordinance_law_bc_limit >= 0),
        add column equipment_breakdown_included      boolean,
        add column equipment_breakdown_limit         numeric(14,2) check (equipment_breakdown_limit is null or equipment_breakdown_limit >= 0),
        add column equipment_breakdown_deductible    numeric(14,2) check (equipment_breakdown_deductible is null or equipment_breakdown_deductible >= 0),
        add column earthquake_covered                boolean,
        add column wind_hail_deductible_percent      numeric(6,4) check (wind_hail_deductible_percent is null or wind_hail_deductible_percent between 0 and 1),
        add column waiver_of_subrogation             boolean,
        add column products_completed_aggregate      numeric(14,2) check (products_completed_aggregate is null or products_completed_aggregate >= 0),
        add column personal_advertising_injury_limit numeric(14,2) check (personal_advertising_injury_limit is null or personal_advertising_injury_limit >= 0),
        add column medical_payments_limit            numeric(14,2) check (medical_payments_limit is null or medical_payments_limit >= 0),
        add column damage_to_premises_rented_limit   numeric(14,2) check (damage_to_premises_rented_limit is null or damage_to_premises_rented_limit >= 0),
        add column hired_non_owned_auto              boolean,
        add column unit_owners_additional_insureds   boolean,
        add column manager_additional_insured        boolean,
        add column do_retention                      numeric(14,2) check (do_retention is null or do_retention >= 0),
        add column do_claims_made                    boolean,
        add column do_retro_date                     date,
        add column do_full_prior_acts                boolean,
        add column do_covers_non_monetary            boolean,
        add column do_covers_breach_of_contract      boolean,
        add column do_covers_insurance_decisions     boolean,
        add column do_includes_managing_agent        boolean,
        add column do_includes_past_future_board     boolean,
        add column crime_limit                       numeric(14,2) check (crime_limit is null or crime_limit >= 0),
        add column crime_deductible                  numeric(14,2) check (crime_deductible is null or crime_deductible >= 0),
        add column crime_includes_manager            boolean,
        add column crime_social_engineering_limit    numeric(14,2) check (crime_social_engineering_limit is null or crime_social_engineering_limit >= 0),
        add column crime_computer_fraud_limit        numeric(14,2) check (crime_computer_fraud_limit is null or crime_computer_fraud_limit >= 0),
        add column crime_funds_transfer_limit        numeric(14,2) check (crime_funds_transfer_limit is null or crime_funds_transfer_limit >= 0),
        add column umbrella_retention                numeric(14,2) check (umbrella_retention is null or umbrella_retention >= 0),
        add column umbrella_includes_do              boolean,
        add column flood_building_limit              numeric(14,2) check (flood_building_limit is null or flood_building_limit >= 0),
        add column flood_contents_limit              numeric(14,2) check (flood_contents_limit is null or flood_contents_limit >= 0),
        add column flood_deductible                  numeric(14,2) check (flood_deductible is null or flood_deductible >= 0),
        add column flood_program                     text not null default 'unknown' check (flood_program in ('nfip', 'private', 'unknown')),
        add column flood_zone_rated                  text,
        add column earthquake_limit                  numeric(14,2) check (earthquake_limit is null or earthquake_limit >= 0),
        add column earthquake_deductible             numeric(14,2) check (earthquake_deductible is null or earthquake_deductible >= 0),
        add column earthquake_deductible_percent     numeric(6,4) check (earthquake_deductible_percent is null or earthquake_deductible_percent between 0 and 1),
        add column wc_el_each_accident               numeric(14,2) check (wc_el_each_accident is null or wc_el_each_accident >= 0),
        add column wc_el_disease_each_employee       numeric(14,2) check (wc_el_disease_each_employee is null or wc_el_disease_each_employee >= 0),
        add column wc_el_disease_policy_limit        numeric(14,2) check (wc_el_disease_policy_limit is null or wc_el_disease_policy_limit >= 0),
        add column wc_covers_volunteers              boolean,
        add column cyber_limit                       numeric(14,2) check (cyber_limit is null or cyber_limit >= 0),
        add column cyber_retention                   numeric(14,2) check (cyber_retention is null or cyber_retention >= 0),
        add column epli_limit                        numeric(14,2) check (epli_limit is null or epli_limit >= 0),
        add column epli_retention                    numeric(14,2) check (epli_retention is null or epli_retention >= 0),
        add column epli_third_party                  boolean,
        add column endorsements                      jsonb not null default '[]'::jsonb check (jsonb_typeof(endorsements) = 'array'),
        add column exclusions                        jsonb not null default '[]'::jsonb check (jsonb_typeof(exclusions) = 'array'),
        add column premium_breakdown                 jsonb not null default '[]'::jsonb check (jsonb_typeof(premium_breakdown) = 'array')
    $f$, t);
    -- A double-submitted manual save carries the same token: the second insert
    -- hits this index and the RPC returns the first row instead (part 19/20).
    execute format(
      'create unique index %I on public.%I (association_id, client_token) where client_token is not null',
      t || '_client_token_key', t);
  end loop;
end $$;

-- Policy-only lifecycle
alter table public.insurance_policies
  add column updated_at             timestamptz not null default now(),
  add column updated_by             uuid references auth.users(id),
  add column archived_at            timestamptz,
  add column archived_by            uuid references auth.users(id),
  add column replaced_by_policy_id  uuid references public.insurance_policies(id) on delete set null,
  add column accepted_quote_id      uuid references public.insurance_quotes(id) on delete set null,
  add column agent_contact_id       uuid references public.insurance_contacts(id) on delete set null,
  add column summary_text           text,
  add column summary_source         text check (summary_source is null or summary_source in ('model', 'board')),
  add column summary_written_at     timestamptz,
  add column summary_error          text check (summary_error is null or length(summary_error) <= 300),
  add constraint insurance_policies_not_replaced_by_self check (replaced_by_policy_id is null or replaced_by_policy_id <> id);

create index on public.insurance_policies (association_id) where archived_at is null;

comment on column public.insurance_policies.replaced_at is
  'When a replacing policy was recorded (0041 meant "no longer current"). Status is computed from replaced_by_policy_id and the successor''s effective_from (src/lib/insurance/status.ts): a policy stays active until its successor starts.';
comment on column public.insurance_policies.included_sections is
  'Which coverage sections this policy carries (a package master policy can include liability, D&O, crime, equipment breakdown). Drives which fields the UI shows and the coverage check.';
comment on column public.insurance_policies.wind_hail_deductible_percent is
  'Percentage deductibles are stored as fractions: 2% = 0.0200. The dollar minimum, if any, is wind_hail_deductible.';

-- Quote-only columns
alter table public.insurance_quotes
  add column quote_number     text,
  add column covers_to        date,
  add column payment_schedule text not null default 'unknown'
                                check (payment_schedule in ('annual', 'semi_annual', 'quarterly', 'monthly', 'unknown')),
  add column named_insured    text,
  add column agency_name      text,
  add column agent_phone      text,
  add column broker_email     text,
  add column contact_id       uuid references public.insurance_contacts(id) on delete set null,
  add column declined_at      timestamptz,
  add column updated_at       timestamptz not null default now(),
  add column created_by       uuid references auth.users(id) default auth.uid(),
  add constraint insurance_quotes_term_order check (covers_to is null or covers_from is null or covers_to > covers_from);

-- ----------------------------------------------------------------------------
-- 4. Provenance covers quotes too
-- ----------------------------------------------------------------------------

alter table public.insurance_policy_field_sources
  alter column policy_id drop not null,
  add column quote_id uuid references public.insurance_quotes(id) on delete cascade,
  add column read_id  uuid,  -- FK added after insurance_document_reads exists
  add constraint insurance_field_sources_one_owner check (num_nonnulls(policy_id, quote_id) = 1),
  add constraint insurance_field_sources_quote_field_key unique (quote_id, field_name);

alter table public.insurance_policy_field_sources drop constraint if exists insurance_policy_field_sources_source_check;
alter table public.insurance_policy_field_sources
  add constraint insurance_policy_field_sources_source_check
  check (source in ('extracted', 'manual', 'quote', 'previous_policy', 'agent_confirmed'));

-- 0041 snippets had no cap; trim before the length check below.
update public.insurance_policy_field_sources
   set raw_text_snippet = left(raw_text_snippet, 240)
 where length(raw_text_snippet) > 240;

alter table public.insurance_policy_field_sources
  add column created_by   uuid references auth.users(id) default auth.uid(),
  add column confirmed_on date,   -- agent_confirmed only: the date of the agent's answer
  add constraint insurance_field_sources_confirmed_on
    check ((source = 'agent_confirmed') = (confirmed_on is not null)),
  add constraint insurance_field_sources_snippet_len
    check (raw_text_snippet is null or length(raw_text_snippet) <= 240);

comment on table public.insurance_policy_field_sources is
  'Where each saved policy or quote value came from: read from a document (page, confidence, snippet, rebuilt by the save RPC from the stored, already redacted read), typed in, copied from a quote, carried over from the previous policy, or confirmed by the agent (confirmed_on, created_by, optional attachment in document_id). field_name is the src/lib/insurance/fields.ts key, not the column.';

-- The delete policy stays board_admin only (0041), as the brief's quality bar
-- requires. Stale provenance is pruned by the save RPCs through this narrow
-- definer function, which a board member can't point at anything but the row
-- being saved.
create or replace function public.insurance_prune_field_sources(
  p_policy_id uuid, p_quote_id uuid, p_keep text[]
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_assoc uuid;
  v_n     integer;
begin
  if num_nonnulls(p_policy_id, p_quote_id) <> 1 then
    raise exception 'insurance_prune_field_sources: exactly one of policy or quote' using errcode = '22023';
  end if;
  if p_policy_id is not null then
    select association_id into v_assoc from public.insurance_policies where id = p_policy_id;
  else
    select association_id into v_assoc from public.insurance_quotes where id = p_quote_id;
  end if;
  if v_assoc is null or not public.is_board(v_assoc) then
    raise exception 'Only a board member can change where values came from.' using errcode = '42501';
  end if;
  delete from public.insurance_policy_field_sources s
   where s.association_id = v_assoc
     and ((p_policy_id is not null and s.policy_id = p_policy_id)
       or (p_quote_id  is not null and s.quote_id  = p_quote_id))
     and not (s.field_name = any (coalesce(p_keep, '{}')));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.insurance_prune_field_sources(uuid, uuid, text[]) from public, anon;
grant execute on function public.insurance_prune_field_sources(uuid, uuid, text[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Document reads
-- ----------------------------------------------------------------------------

create table public.insurance_document_reads (
  id                 uuid primary key default gen_random_uuid(),
  association_id     uuid not null references public.associations(id) on delete restrict,
  document_id        uuid not null references public.documents(id) on delete cascade,
  mode               text not null check (mode in ('policy', 'quote')),
  quote_request_id   uuid references public.insurance_quote_requests(id) on delete set null,
  replaces_policy_id uuid references public.insurance_policies(id) on delete set null,
  state              text not null default 'queued' check (state in
                       ('queued', 'running', 'done', 'failed', 'unreadable', 'not_configured', 'quota', 'timed_out')),
  method             text check (method is null or method in ('text', 'native_pdf', 'image')),
  attempts           smallint not null default 0 check (attempts between 0 and 10),
  page_count         smallint check (page_count is null or page_count > 0),
  -- attempts counts model runs only. claim_insurance_read adds 1; a run that
  -- ends in quota or not_configured gives it back (§7.1.7), so those outcomes
  -- never use up the cap of 3.
  result             jsonb,
  saved              jsonb not null default '{}'::jsonb check (jsonb_typeof(saved) = 'object'),
  error              text,
  started_at         timestamptz,
  finished_at        timestamptz,
  created_by         uuid references auth.users(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (state <> 'done' or result is not null)
);

create index on public.insurance_document_reads (association_id, created_at desc);
create index on public.insurance_document_reads (document_id);

alter table public.insurance_policy_field_sources
  add constraint insurance_field_sources_read_fk
  foreign key (read_id) references public.insurance_document_reads(id) on delete set null;

comment on table public.insurance_document_reads is
  'One reading of one insurance document by the model (text layer, or the PDF/image itself per decision 7). Only documents filed in the insurance category can be read (guard trigger). result holds what was found, already passed through redactTaxIds(); saved maps each found policy''s index to what the board saved ({policy_id} | {quote_id} | {skipped: true}), written by the save and skip RPCs with row locks (the app never updates it directly). Not audited: like documents.extraction it is document content, and it is a work log (only deletes are audited, and only a board admin can delete). A board member can still write result directly: the database cannot tell the model''s output from a person''s edit until the writes move into service-side RPCs (REVIEW-1 #7, DECISIONS 35(i)).';

-- ----------------------------------------------------------------------------
-- 6. Claims
-- ----------------------------------------------------------------------------

alter table public.insurance_claims
  add column adjuster_name      text,
  add column adjuster_email     text,
  add column adjuster_phone     text,
  add column reported_on        date,
  add column closed_on          date,
  add column deductible_applied numeric(14,2) check (deductible_applied is null or deductible_applied >= 0),
  add column notes              text,
  add column updated_by         uuid references auth.users(id);

-- ----------------------------------------------------------------------------
-- 7. Quote requests go to any contact
-- ----------------------------------------------------------------------------

alter table public.insurance_quote_requests
  alter column partner_id drop not null,
  add column contact_id      uuid references public.insurance_contacts(id) on delete restrict,
  add column coverages       text[] not null default '{}' check (coverages <@ array[
                               'property', 'general_liability', 'directors_officers', 'umbrella', 'flood',
                               'workers_comp', 'fidelity_crime', 'equipment_breakdown', 'cyber', 'earthquake',
                               'employment_practices', 'other']::text[]),
  add column follow_up_on    date,
  add column declined_reason text,
  add constraint insurance_quote_requests_has_recipient check (num_nonnulls(partner_id, contact_id) >= 1);

-- ----------------------------------------------------------------------------
-- 8. Messages (mirrors contractor_messages; #22: never sent by Walkup)
-- ----------------------------------------------------------------------------

create table public.insurance_messages (
  id                uuid primary key default gen_random_uuid(),
  association_id    uuid not null references public.associations(id) on delete restrict,
  kind              text not null check (kind in ('quote_request', 'quote_follow_up', 'coverage_question',
                      'certificate_request', 'claim_report', 'change_request', 'documents_request',
                      'quote_decline', 'other')),
  contact_id        uuid references public.insurance_contacts(id) on delete restrict,
  to_email          text,
  subject           text not null,
  body              text not null,
  status            public.message_status not null default 'draft',
  policy_id         uuid references public.insurance_policies(id) on delete set null,
  quote_request_id  uuid references public.insurance_quote_requests(id) on delete set null,
  claim_id          uuid references public.insurance_claims(id) on delete set null,
  finding_rule_id   text check (finding_rule_id is null or finding_rule_id ~ '^[A-Z0-9_-]{4,32}$'),
  drafted_by        text not null default 'template' check (drafted_by in ('model', 'template', 'board')),
  facts_json        jsonb not null default '{}'::jsonb,
  created_by        uuid references auth.users(id) default auth.uid(),
  approved_by       uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  sent_at           timestamptz,
  check ((status = 'sent') = (sent_at is not null)),
  check (status <> 'sent' or approved_by is not null)
);

create index on public.insurance_messages (association_id, status, created_at desc);
create index on public.insurance_messages (contact_id);

comment on table public.insurance_messages is
  'Emails to insurance agents, brokers and insurers. Drafts only: the board opens each in its own mail app (mailto) and marks it sent. A row cannot be sent without an approver, the approver is always the caller, and a sent or cancelled email can''t be edited (tg_insurance_messages_lock, #22). facts_json records the structured facts the draft was written from (decision 8); the model never sees names, numbers or free text the board typed.';

-- RLS lets any board member update the table, so the "only while draft" rule
-- and the approver rule live here, not in the server action.
create or replace function public.tg_insurance_messages_lock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.status in ('sent', 'cancelled') then
    if new.subject is distinct from old.subject or new.body is distinct from old.body
       or new.to_email is distinct from old.to_email or new.facts_json is distinct from old.facts_json
       or new.kind is distinct from old.kind or new.contact_id is distinct from old.contact_id
       or new.status is distinct from old.status then
      raise exception 'This email was already sent or cancelled and can''t be changed.' using errcode = '22023';
    end if;
    -- Who approved it and when it went are part of the record (REVIEW-1 #8).
    new.approved_by := old.approved_by;
    new.sent_at     := old.sent_at;
  end if;
  if new.status = 'sent'
     and (tg_op = 'INSERT' or old.status is distinct from 'sent')
     and new.approved_by is distinct from auth.uid() then
    raise exception 'Only the person marking an email sent can approve it.' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_insurance_messages_lock() from public, anon;
grant execute on function public.tg_insurance_messages_lock() to authenticated;   -- 0043 convention for trigger functions

create trigger insurance_messages_lock
  before insert or update on public.insurance_messages
  for each row execute function public.tg_insurance_messages_lock();

-- ----------------------------------------------------------------------------
-- 9. Building facts (one row per association)
-- ----------------------------------------------------------------------------

create table public.insurance_building_facts (
  id                            uuid primary key default gen_random_uuid(),
  association_id                uuid not null unique references public.associations(id) on delete restrict,
  is_condominium                boolean not null default true,
  replacement_cost_estimate     numeric(14,2) check (replacement_cost_estimate is null or replacement_cost_estimate > 0),
  replacement_cost_as_of        date,
  replacement_cost_source       text not null default 'unknown'
                                  check (replacement_cost_source in ('appraisal', 'insurer_valuation', 'board_estimate', 'unknown')),
  building_count                smallint check (building_count is null or building_count between 1 and 500),
  total_square_feet             integer check (total_square_feet is null or total_square_feet between 1 and 10000000),
  flood_zone                    text check (flood_zone is null or flood_zone in
                                  ('A', 'AE', 'AH', 'AO', 'AR', 'A99', 'V', 'VE', 'X', 'B', 'C', 'D', 'unknown')),
  has_below_grade_units         boolean,
  has_basement                  boolean,
  has_boiler                    boolean,
  has_elevator                  boolean,
  has_sprinklers                boolean,
  has_employees                 boolean,
  employee_count                smallint check (employee_count is null or employee_count >= 0),
  uses_volunteers               boolean,
  has_commercial_space          boolean,
  has_amenities                 boolean,
  manager_handles_funds         boolean,
  management_company            text,
  rental_share                  numeric(6,4) check (rental_share is null or rental_share between 0 and 1),
  declaration_coverage_form     text not null default 'unknown'
                                  check (declaration_coverage_form in ('bare_walls', 'single_entity', 'all_in', 'unknown')),
  declaration_required_lines    text[] not null default '{}' check (declaration_required_lines <@ array[
                                  'property', 'general_liability', 'directors_officers', 'umbrella', 'flood',
                                  'workers_comp', 'fidelity_crime', 'equipment_breakdown', 'cyber', 'earthquake',
                                  'employment_practices', 'other']::text[]),
  declaration_insurance_section text,
  declaration_notes             text,
  owners_must_carry_ho6         boolean,
  owners_ho6_min_liability      numeric(14,2) check (owners_ho6_min_liability is null or owners_ho6_min_liability >= 0),
  updated_by                    uuid references auth.users(id) default auth.uid(),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  check (replacement_cost_as_of is null or replacement_cost_as_of <= current_date + 1)
);

comment on table public.insurance_building_facts is
  'Facts the coverage check needs that the rest of Walkup does not hold: replacement cost estimate, flood zone, equipment, employees, who handles funds, and what the declaration''s insurance article requires. Year built, construction and stories stay on associations (Building Info).';

-- ----------------------------------------------------------------------------
-- 10. Finding dismissals
-- ----------------------------------------------------------------------------

create table public.insurance_finding_dismissals (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  rule_id        text not null check (rule_id ~ '^[A-Z0-9_-]{4,32}$'),
  policy_id      uuid references public.insurance_policies(id) on delete cascade,
  -- Which finding of the rule. One rule can raise several findings with no
  -- policy (DOC-REQ-01: one per coverage the declaration requires), so the
  -- rule and policy alone would dismiss them all at once (REVIEW-4 #4). The
  -- app stores the finding's id ("DOC-REQ-01:flood"); '' means "the rule's
  -- findings for that policy" and is only what a hand-written row gets.
  finding_key    text not null default '' check (length(finding_key) <= 100),
  reason         text not null check (length(btrim(reason)) > 0),
  dismissed_by   uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now()
);

create unique index insurance_finding_dismissals_key
  on public.insurance_finding_dismissals (association_id, rule_id, coalesce(policy_id, '00000000-0000-0000-0000-000000000000'::uuid), finding_key);

comment on table public.insurance_finding_dismissals is
  'A board''s "not relevant to us" on one coverage-check finding, with its reason. Tied to a policy when the finding is, so a renewal shows the finding again, and to the finding itself (finding_key) so dismissing the flood requirement does not dismiss the earthquake one.';

-- ----------------------------------------------------------------------------
-- 11. Owner summary
-- ----------------------------------------------------------------------------

create table public.insurance_owner_summaries (
  id               uuid primary key default gen_random_uuid(),
  association_id   uuid not null unique references public.associations(id) on delete restrict,
  source_policy_id uuid references public.insurance_policies(id) on delete set null,
  -- ownerSummarySourceHash() (§6.9) of the source policy's carrier, period,
  -- coverage form and deductibles at publish time; a mismatch means "stale".
  source_hash      text check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$'),
  draft            jsonb not null default '{}'::jsonb check (jsonb_typeof(draft) = 'object'),
  published        jsonb check (published is null or jsonb_typeof(published) = 'object'),
  published_at     timestamptz,
  published_by     uuid references auth.users(id),
  created_by       uuid references auth.users(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((published is null) = (published_at is null))
);

comment on table public.insurance_owner_summaries is
  'What the master policy means for owners. draft is the board''s working copy; published is the frozen snapshot owners read through owner_insurance_summary() (decision 9). Owners never select this table.';

-- ----------------------------------------------------------------------------
-- 12. Market research cache (decisions 4, 5, 10)
-- ----------------------------------------------------------------------------

create table public.insurance_market_research (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  kind           text not null check (kind in ('agencies', 'insurers')),
  -- The last completed search (null until one completes).
  query_key      text,
  inputs         jsonb,
  items          jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  sources        jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  fetched_at     timestamptz,
  expires_at     timestamptz,
  -- The search in flight (Foundation 5.3 status-row columns, plus what it was asked).
  ai_state       text not null default 'idle' check (ai_state in ('idle', 'running', 'done', 'failed')),
  ai_started_at  timestamptz,
  ai_finished_at timestamptz,
  ai_error       text check (ai_error is null or length(ai_error) <= 500),
  pending_inputs jsonb,
  pending_key    text,
  created_by     uuid references auth.users(id) default auth.uid(),
  unique (association_id, kind),
  check ((fetched_at is null) = (expires_at is null)),
  check (expires_at is null or expires_at > fetched_at),
  check ((fetched_at is null) = (query_key is null))
);

comment on table public.insurance_market_research is
  'Cache of web research for insurers and agencies (30 days). inputs is exactly what left Walkup (decision 4: city, state, ZIP, unit count, stories, year built, construction, coverage types). items were verified against the search results before storage (decision 5). The ai_* columns track a search running in the background (after()), so the page can poll and the previous results stay visible meanwhile. Not audited: a cache.';

-- ----------------------------------------------------------------------------
-- 12a. Owners ask the board for proof of insurance (decision 9)
-- ----------------------------------------------------------------------------

create table public.insurance_owner_requests (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references public.associations(id) on delete restrict,
  person_id       uuid not null references public.persons(id) on delete restrict,
  kind            text not null default 'certificate' check (kind in ('certificate', 'question')),
  note            text check (note is null or length(note) <= 1000),
  status          text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  message_id      uuid references public.insurance_messages(id) on delete set null,
  handled_by      uuid references auth.users(id),
  handled_at      timestamptz,
  created_at      timestamptz not null default now(),
  check ((status = 'open') = (handled_at is null))
);

create index on public.insurance_owner_requests (association_id, status, created_at desc);

comment on table public.insurance_owner_requests is
  'An owner asking the board for proof of the building''s insurance (for a lender, a refinance or a sale). Owners insert only through request_insurance_proof() and read only their own through my_insurance_proof_requests(); the board reads and handles them. note is the owner''s own text and is never sent to the model.';

-- ----------------------------------------------------------------------------
-- 13. Premium bill link
-- ----------------------------------------------------------------------------

alter table public.recurring_bills
  add column insurance_policy_id uuid references public.insurance_policies(id) on delete set null;

comment on column public.recurring_bills.insurance_policy_id is
  'The insurance policy whose premium this bill tracks. One active bill per policy. A renewal gets its own bill (track_insurance_premium); the old policy''s bill keeps its remaining installments and is retired by insurance_premium_bill_advance() once paid out or once its next due date reaches the successor''s start.';

-- ----------------------------------------------------------------------------
-- 14. Document links can point at quotes and claims
--     (0053_repairs_v2 must keep these two values if it widens the list again)
-- ----------------------------------------------------------------------------

alter table public.document_links drop constraint document_links_target_table_known;
alter table public.document_links
  add constraint document_links_target_table_known
  check (target_table in (
    'associations', 'units', 'persons', 'vendors',
    'journal_entries', 'expenses', 'assessment_charges', 'payments',
    'insurance_policies', 'tickets', 'recurring_bills', 'fiscal_years',
    'tax_forms', 'insurance_quotes', 'insurance_claims'
  ));

-- ----------------------------------------------------------------------------
-- 15. Same-association guards for every new FK
-- ----------------------------------------------------------------------------

-- Only the definer trigger below calls this; nobody else may.
create or replace function public.insurance_assert_same_association(
  p_table text, p_id uuid, p_association_id uuid, p_what text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean;
begin
  if p_id is null then
    return;
  end if;
  if p_table not in ('insurance_policies', 'insurance_quotes', 'insurance_contacts', 'insurance_quote_requests',
                     'insurance_claims', 'insurance_document_reads', 'insurance_messages', 'documents',
                     'accounts', 'funds', 'persons') then
    raise exception 'insurance_assert_same_association: unexpected table %', p_table;
  end if;
  execute format('select exists (select 1 from public.%I where id = $1 and association_id = $2)', p_table)
    into v_ok using p_id, p_association_id;
  if not v_ok then
    raise exception '% belongs to a different association', p_what using errcode = '42501';
  end if;
end $$;

revoke all on function public.insurance_assert_same_association(text, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.tg_insurance_v2_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- One statement per column, inside per-table branches: plpgsql resolves
  -- new.<col> per statement, so columns absent from other tables are never touched.
  case tg_table_name
    when 'insurance_policies' then
      perform public.insurance_assert_same_association('insurance_contacts', new.agent_contact_id, new.association_id, 'contact');
      perform public.insurance_assert_same_association('insurance_policies', new.replaced_by_policy_id, new.association_id, 'replacing policy');
      perform public.insurance_assert_same_association('insurance_quotes', new.accepted_quote_id, new.association_id, 'quote');
      perform public.insurance_assert_same_association('documents', new.source_document_id, new.association_id, 'document');
    when 'insurance_quotes' then
      perform public.insurance_assert_same_association('insurance_contacts', new.contact_id, new.association_id, 'contact');
      perform public.insurance_assert_same_association('insurance_quote_requests', new.quote_request_id, new.association_id, 'quote request');
      perform public.insurance_assert_same_association('documents', new.document_id, new.association_id, 'document');
    when 'insurance_policy_field_sources' then
      perform public.insurance_assert_same_association('insurance_quotes', new.quote_id, new.association_id, 'quote');
      perform public.insurance_assert_same_association('insurance_document_reads', new.read_id, new.association_id, 'document read');
      perform public.insurance_assert_same_association('documents', new.document_id, new.association_id, 'document');
    when 'insurance_document_reads' then
      perform public.insurance_assert_same_association('documents', new.document_id, new.association_id, 'document');
      perform public.insurance_assert_same_association('insurance_quote_requests', new.quote_request_id, new.association_id, 'quote request');
      perform public.insurance_assert_same_association('insurance_policies', new.replaces_policy_id, new.association_id, 'policy');
      -- Decision 7: only documents filed as insurance may be read (natively or
      -- otherwise). Checked when the read is created or pointed at another file.
      -- Nested ifs: plpgsql evaluates both sides of OR, and OLD is null on INSERT.
      if tg_op = 'UPDATE' then
        if new.document_id is not distinct from old.document_id then
          return new;
        end if;
      end if;
      if not exists (
        select 1 from public.documents d
          join public.document_categories c on c.id = d.category_id
         where d.id = new.document_id and c.slug = 'insurance'
      ) then
        raise exception 'File this document as Insurance before Walkup reads it.' using errcode = '42501';
      end if;
    when 'insurance_quote_requests' then
      perform public.insurance_assert_same_association('insurance_contacts', new.contact_id, new.association_id, 'contact');
    when 'insurance_messages' then
      perform public.insurance_assert_same_association('insurance_contacts', new.contact_id, new.association_id, 'contact');
      perform public.insurance_assert_same_association('insurance_policies', new.policy_id, new.association_id, 'policy');
      perform public.insurance_assert_same_association('insurance_quote_requests', new.quote_request_id, new.association_id, 'quote request');
      perform public.insurance_assert_same_association('insurance_claims', new.claim_id, new.association_id, 'claim');
    when 'insurance_owner_summaries' then
      perform public.insurance_assert_same_association('insurance_policies', new.source_policy_id, new.association_id, 'policy');
    when 'insurance_finding_dismissals' then
      perform public.insurance_assert_same_association('insurance_policies', new.policy_id, new.association_id, 'policy');
    when 'recurring_bills' then
      perform public.insurance_assert_same_association('insurance_policies', new.insurance_policy_id, new.association_id, 'policy');
      -- 0013 has no guard on these two; Repairs' 0053 adds its own
      -- (tg_recurring_bills_same_association). Both may run; they agree.
      perform public.insurance_assert_same_association('accounts', new.account_id, new.association_id, 'category');
      perform public.insurance_assert_same_association('funds', new.fund_id, new.association_id, 'fund');
    when 'insurance_owner_requests' then
      perform public.insurance_assert_same_association('persons', new.person_id, new.association_id, 'person');
      perform public.insurance_assert_same_association('insurance_messages', new.message_id, new.association_id, 'email');
    else
      null;
  end case;
  return new;
end $$;

revoke all on function public.tg_insurance_v2_same_association() from public, anon;
grant execute on function public.tg_insurance_v2_same_association() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['insurance_policies', 'insurance_quotes', 'insurance_policy_field_sources',
                           'insurance_document_reads', 'insurance_quote_requests', 'insurance_messages',
                           'insurance_owner_summaries', 'insurance_finding_dismissals', 'recurring_bills',
                           'insurance_owner_requests'] loop
    execute format(
      'create trigger %I before insert or update on public.%I
         for each row execute function public.tg_insurance_v2_same_association()',
      t || '_insurance_v2_same_association', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 16. RLS
-- ----------------------------------------------------------------------------

-- Readers read, board writes, board_admin deletes; audited (same shape as 0041).
do $$
declare
  t text;
begin
  foreach t in array array['insurance_contacts', 'insurance_messages', 'insurance_building_facts',
                           'insurance_owner_summaries', 'insurance_finding_dismissals'] loop
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

-- A dismissal is a board note, not a record: any board member may take one back.
drop policy insurance_finding_dismissals_delete on public.insurance_finding_dismissals;
create policy insurance_finding_dismissals_delete on public.insurance_finding_dismissals
  for delete to authenticated using (public.is_board(association_id));

-- Owner requests: the board reads and handles them; nobody inserts directly
-- (request_insurance_proof is the only writer of new rows); audited.
alter table public.insurance_owner_requests enable row level security;
create policy insurance_owner_requests_select on public.insurance_owner_requests
  for select to authenticated using (public.is_board(association_id));
create policy insurance_owner_requests_update on public.insurance_owner_requests
  for update to authenticated using (public.is_board(association_id)) with check (public.is_board(association_id));
create policy insurance_owner_requests_delete on public.insurance_owner_requests
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));
create trigger audit_insurance_owner_requests
  after insert or update or delete on public.insurance_owner_requests
  for each row execute function public.tg_audit();

-- Reads and research: board only (they hold document content / web results), not audited.
do $$
declare
  t text;
begin
  foreach t in array array['insurance_document_reads', 'insurance_market_research'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_board(association_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_board(association_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_board(association_id)) with check (public.is_board(association_id))', t || '_update', t);
    -- Deleting a reading is board_admin only (CLAUDE.md: board_member has no
    -- deletes), and a delete leaves an audit row (REVIEW-1 #7).
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_role_in(association_id, array[''board_admin'']::public.app_role[]))', t || '_delete', t);
  end loop;
end $$;

create trigger audit_insurance_document_reads_delete
  after delete on public.insurance_document_reads
  for each row execute function public.tg_audit();

-- ----------------------------------------------------------------------------
-- 17. Editable-column allowlists (the TS field table is tested against these)
-- ----------------------------------------------------------------------------

create or replace function public.insurance_policy_editable_columns()
returns text[] language sql immutable set search_path = '' as $$
  select array[
    'coverage', 'carrier_name', 'policy_number', 'named_insured', 'insured_address',
    'effective_from', 'effective_to', 'annual_premium', 'payment_schedule', 'taxes_and_fees', 'claims_phone',
    'agency_name', 'broker_name', 'agent_phone', 'broker_email', 'agent_contact_id',
    'included_sections',
    'building_limit', 'business_personal_property_limit', 'loss_of_income_limit', 'valuation',
    'extended_replacement_percent', 'coinsurance_percent', 'agreed_value', 'cause_of_loss_form',
    'coverage_form', 'ordinance_or_law', 'ordinance_law_a_included', 'ordinance_law_b_limit',
    'ordinance_law_c_limit', 'ordinance_law_bc_limit', 'water_backup_limit',
    'equipment_breakdown_included', 'flood_covered', 'earthquake_covered', 'loss_assessment_limit',
    'waiver_of_subrogation',
    'property_deductible', 'water_damage_deductible', 'wind_hail_deductible',
    'wind_hail_deductible_percent', 'per_unit_deductible',
    'liability_per_occurrence', 'liability_aggregate', 'products_completed_aggregate',
    'personal_advertising_injury_limit', 'medical_payments_limit', 'damage_to_premises_rented_limit',
    'hired_non_owned_auto', 'unit_owners_additional_insureds', 'manager_additional_insured',
    'do_limit', 'do_retention', 'do_claims_made', 'do_retro_date', 'do_full_prior_acts',
    'do_covers_non_monetary', 'do_covers_breach_of_contract', 'do_covers_insurance_decisions',
    'do_includes_managing_agent', 'do_includes_past_future_board',
    'crime_limit', 'crime_deductible', 'crime_includes_manager', 'crime_social_engineering_limit',
    'crime_computer_fraud_limit', 'crime_funds_transfer_limit',
    'umbrella_limit', 'umbrella_retention', 'umbrella_includes_do',
    'flood_building_limit', 'flood_contents_limit', 'flood_deductible', 'flood_program', 'flood_zone_rated',
    'earthquake_limit', 'earthquake_deductible', 'earthquake_deductible_percent',
    'equipment_breakdown_limit', 'equipment_breakdown_deductible',
    'wc_el_each_accident', 'wc_el_disease_each_employee', 'wc_el_disease_policy_limit', 'wc_covers_volunteers',
    'cyber_limit', 'cyber_retention',
    'epli_limit', 'epli_retention', 'epli_third_party',
    'coverage_limit', 'deductible',
    'endorsements', 'exclusions', 'premium_breakdown',
    'renewal_reminder_days', 'notes'
  ]::text[]
$$;

create or replace function public.insurance_quote_editable_columns()
returns text[] language sql immutable set search_path = '' as $$
  -- Same coverage columns as a policy; the policy-only basics are swapped for
  -- the quote's own (quote_number for policy_number, covers_from/covers_to for
  -- the term, contact_id for agent_contact_id).
  select array(
           select c from unnest(public.insurance_policy_editable_columns()) c
            where c not in ('policy_number', 'effective_from', 'effective_to', 'insured_address',
                            'renewal_reminder_days', 'agent_contact_id'))
         || array['quote_number', 'covers_from', 'covers_to', 'quoted_on', 'valid_until',
                  'contact_id', 'quote_request_id']::text[]
$$;

revoke all on function public.insurance_policy_editable_columns() from public, anon;
revoke all on function public.insurance_quote_editable_columns() from public, anon;
grant execute on function public.insurance_policy_editable_columns() to authenticated;
grant execute on function public.insurance_quote_editable_columns() to authenticated;

-- ----------------------------------------------------------------------------
-- 18. Premium bill (one per policy; renewals get their own)
-- ----------------------------------------------------------------------------

create or replace function public.track_insurance_premium(
  p_policy_id      uuid,
  p_account_id     uuid,              -- null: keep this bill's account, or inherit the predecessor's
  p_frequency      public.bill_frequency,
  p_typical_amount numeric,
  p_next_due_on    date
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_p    public.insurance_policies;
  v_prev public.recurring_bills;     -- the replaced policy's active bill, if any
  v_acct uuid := p_account_id;
  v_fund uuid;
  v_bill uuid;
begin
  select * into v_p from public.insurance_policies where id = p_policy_id;
  if not found then
    raise exception 'That policy was not found.' using errcode = 'P0002';
  end if;
  if not public.is_board(v_p.association_id) then
    raise exception 'Only a board member can track a premium.' using errcode = '42501';
  end if;
  if v_p.archived_at is not null then
    raise exception 'This policy is archived. Restore it before tracking its premium.' using errcode = '22023';
  end if;
  if p_typical_amount is null or p_typical_amount <= 0 then
    raise exception 'Enter the premium before tracking it as a bill.' using errcode = '22023';
  end if;
  -- The client chooses the account; it must be one of this association's
  -- expense accounts (recurring_bills had no same-association guard before 0052).
  if v_acct is not null and not exists (
    select 1 from public.accounts a
     where a.id = v_acct and a.association_id = v_p.association_id and a.type = 'expense'
  ) then
    raise exception 'Choose one of your expense categories for the premium.' using errcode = '22023';
  end if;

  select b.* into v_prev
    from public.recurring_bills b
    join public.insurance_policies o on o.id = b.insurance_policy_id
   where o.replaced_by_policy_id = p_policy_id
     and o.association_id = v_p.association_id
     and b.is_active
   order by o.effective_from desc
   limit 1
   for update of b;

  select id into v_bill from public.recurring_bills
   where insurance_policy_id = p_policy_id and is_active
   limit 1 for update;

  if v_bill is null then
    v_acct := coalesce(v_acct, v_prev.account_id);
    if v_acct is null then
      raise exception 'Choose the expense category the premium is paid from.' using errcode = '22023';
    end if;
    v_fund := v_prev.fund_id;
    if v_fund is null then
      select id into v_fund from public.funds
       where association_id = v_p.association_id and kind = 'operating'
       order by name limit 1;
    end if;
    if v_fund is null then
      raise exception 'There is no operating fund to pay the premium from.' using errcode = 'P0002';
    end if;
    insert into public.recurring_bills
      (association_id, name, account_id, fund_id, frequency, typical_amount, next_due_on, notes,
       insurance_policy_id, autopay_arranged, autopay_note)
    values
      (v_p.association_id, v_p.carrier_name || ' insurance premium', v_acct, v_fund, p_frequency,
       p_typical_amount, p_next_due_on, 'Tracked from Insurance. Walkup does not pay it.', p_policy_id,
       coalesce(v_prev.autopay_arranged, false), v_prev.autopay_note)
    returning id into v_bill;
  else
    update public.recurring_bills
       set account_id     = coalesce(v_acct, account_id),
           frequency      = p_frequency,
           typical_amount = p_typical_amount,
           next_due_on    = p_next_due_on,
           name           = v_p.carrier_name || ' insurance premium'
     where id = v_bill;
  end if;

  -- The replaced policy's bill keeps any installment due before this policy
  -- starts. Once its next due date reaches the new start date there is nothing
  -- left for it to track, so it retires now; otherwise mark-paid retires it
  -- (insurance_premium_bill_advance) after its last installment.
  if v_prev.id is not null and v_prev.next_due_on is not null and v_prev.next_due_on >= v_p.effective_from then
    update public.recurring_bills set is_active = false where id = v_prev.id;
  end if;

  return v_bill;
end $$;

revoke all on function public.track_insurance_premium(uuid, uuid, public.bill_frequency, numeric, date) from public, anon;
grant execute on function public.track_insurance_premium(uuid, uuid, public.bill_frequency, numeric, date) to authenticated;

-- Called by Repairs' mark_bill_paid (0053, task R-2) for a bill linked to a
-- policy, instead of the generic frequency step. Mirrors premiumSchedule()
-- (§6.6): installments run from effective_from every 12/n months (Postgres
-- clamps month ends the same way the TS helper does); after the last one the
-- next due date is the renewal (effective_to). When the policy has a
-- non-archived successor whose start is on or before that date, the bill
-- retires: the successor's own bill takes over. Returns the new next due date,
-- or null when the bill retired.
create or replace function public.insurance_premium_bill_advance(p_bill_id uuid, p_paid_due_on date)
returns date
language plpgsql security invoker set search_path = '' as $$
declare
  v_b    public.recurring_bills;
  v_p    public.insurance_policies;
  v_s    public.insurance_policies;
  v_n    integer;
  v_k    integer;
  v_d    date;
  v_next date;
begin
  select * into v_b from public.recurring_bills where id = p_bill_id for update;
  -- Invoker rights: a bill the caller can't see (an owner, another
  -- association's board) is a bill the caller can't mark paid.
  if not found then
    raise exception 'Only a board member can mark a bill paid.' using errcode = '42501';
  end if;
  if v_b.insurance_policy_id is null then
    return null;
  end if;
  if not public.is_board(v_b.association_id) then
    raise exception 'Only a board member can mark a bill paid.' using errcode = '42501';
  end if;
  select * into v_p from public.insurance_policies where id = v_b.insurance_policy_id;
  select * into v_s from public.insurance_policies
   where id = v_p.replaced_by_policy_id and archived_at is null;

  v_n := case v_p.payment_schedule
           when 'monthly' then 12 when 'quarterly' then 4 when 'semi_annual' then 2 else 1 end;
  for v_k in 1 .. v_n - 1 loop
    v_d := (v_p.effective_from + make_interval(months => v_k * (12 / v_n)))::date;
    if v_d > coalesce(p_paid_due_on, v_p.effective_from) and v_d < v_p.effective_to then
      v_next := v_d;
      exit;
    end if;
  end loop;
  v_next := coalesce(v_next, v_p.effective_to);

  if v_s.id is not null and v_next >= v_s.effective_from then
    update public.recurring_bills set is_active = false where id = p_bill_id;
    return null;
  end if;
  update public.recurring_bills set next_due_on = v_next where id = p_bill_id;
  return v_next;
end $$;

revoke all on function public.insurance_premium_bill_advance(uuid, date) from public, anon;
grant execute on function public.insurance_premium_bill_advance(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 19. Transactional policy save
-- ----------------------------------------------------------------------------

-- Provenance is never taken from the client. The client says, per field, only
-- which source applies (and, for a read value, which candidate it used); this
-- rebuilds page, confidence, snippet and document from the stored read (whose
-- strings already went through redactTaxIds(), decision 7 / #25), from the
-- accepted quote's own provenance, or from the agent-answer form.
--   p_sources: [{field_name, source: 'extracted'|'manual'|'quote'|'previous_policy'|'agent_confirmed'|'keep',
--                candidate_index?: int, confirmed_on?: date, document_id?: uuid (agent_confirmed only)}]
create or replace function public.insurance_resolve_sources(
  p_association_id uuid, p_read_id uuid, p_read_index integer, p_from_quote_id uuid, p_sources jsonb
) returns table (field_name text, source text, document_id uuid, page_number smallint,
                 confidence numeric(6,4), raw_text_snippet text, confirmed_on date)
language plpgsql stable security invoker set search_path = '' as $$
declare
  e       jsonb;
  v_item  jsonb;
  v_doc   uuid;
  v_field jsonb;
  v_cand  jsonb;
  v_qdoc  uuid;
begin
  if p_read_id is not null and p_read_index is not null then
    select r.result->'policies'->p_read_index, r.document_id into v_item, v_doc
      from public.insurance_document_reads r
     where r.id = p_read_id and r.association_id = p_association_id and r.state = 'done';
  end if;
  if p_from_quote_id is not null then
    select q.document_id into v_qdoc
      from public.insurance_quotes q
     where q.id = p_from_quote_id and q.association_id = p_association_id;
  end if;

  for e in select x from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) x loop
    field_name := e->>'field_name';
    source := e->>'source';
    document_id := null; page_number := null; confidence := null;
    raw_text_snippet := null; confirmed_on := null;
    if field_name is null or field_name !~ '^[a-z0-9_]{2,64}$' then
      raise exception 'Unknown field in where the values came from.' using errcode = '22023';
    end if;
    case source
      when 'keep' then
        continue;                         -- unchanged field: its stored row stays (see prune)
      when 'extracted' then
        if v_item is null then
          raise exception 'Values read from a file need the reading they came from. Reload and try again.' using errcode = '22023';
        end if;
        select f into v_field from jsonb_array_elements(v_item->'fields') f where f->>'name' = field_name limit 1;
        v_cand := v_field->'candidates'->((e->>'candidate_index')::int);
        if v_cand is null then
          raise exception 'Where "%" came from doesn''t match the reading. Reload and try again.', field_name using errcode = '22023';
        end if;
        document_id      := v_doc;
        page_number      := nullif(v_cand->>'page', '')::smallint;
        confidence       := least(greatest(coalesce((v_field->>'confidence')::numeric, 0), 0), 1)::numeric(6,4);
        raw_text_snippet := left(v_cand->>'snippet', 240);
      when 'quote' then
        document_id := v_qdoc;
        select s.page_number, s.confidence, s.raw_text_snippet
          into page_number, confidence, raw_text_snippet
          from public.insurance_policy_field_sources s
         where s.quote_id = p_from_quote_id and s.field_name = (e->>'field_name') and s.source = 'extracted';
      when 'agent_confirmed' then
        confirmed_on := nullif(e->>'confirmed_on', '')::date;
        if confirmed_on is null or confirmed_on > current_date + 1 then
          raise exception 'Enter the date your agent answered.' using errcode = '22023';
        end if;
        document_id := nullif(e->>'document_id', '')::uuid;   -- optional attachment; the guard trigger checks it
      when 'manual', 'previous_policy' then
        null;
      else
        raise exception 'Unknown source "%".', source using errcode = '22023';
    end case;
    return next;
  end loop;
end $$;

revoke all on function public.insurance_resolve_sources(uuid, uuid, integer, uuid, jsonb) from public, anon;
grant execute on function public.insurance_resolve_sources(uuid, uuid, integer, uuid, jsonb) to authenticated;

create or replace function public.save_insurance_policy(
  p_association_id uuid,
  p_policy_id      uuid,                 -- null: insert
  p_values         jsonb,                -- {column: value}; keys ⊆ insurance_policy_editable_columns()
  p_sources        jsonb,                -- see insurance_resolve_sources
  p_options        jsonb default '{}'::jsonb
    -- {document_id, read_id, read_index, replaces_policy_id, accepted_quote_id,
    --  expected_updated_at (the PostgREST string, verbatim), client_token,
    --  premium_bill: {account_id, frequency, typical_amount, next_due_on}}
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_cols     text[] := public.insurance_policy_editable_columns();
  v_bad      text;
  v_row      public.insurance_policies;
  v_old      public.insurance_policies;
  v_new      public.insurance_policies;
  v_rep      public.insurance_policies;
  v_id       uuid;
  v_doc      uuid := nullif(p_options->>'document_id', '')::uuid;
  v_read     uuid := nullif(p_options->>'read_id', '')::uuid;
  v_idx      integer := nullif(p_options->>'read_index', '')::integer;
  v_replaces uuid := nullif(p_options->>'replaces_policy_id', '')::uuid;
  v_quote    uuid := nullif(p_options->>'accepted_quote_id', '')::uuid;
  v_token    uuid := nullif(p_options->>'client_token', '')::uuid;
  v_bill     jsonb := p_options->'premium_bill';
  v_saved    jsonb;
  v_entry    jsonb;
  v_list     text;
  v_select   text;
  v_assign   text;
begin
  if not public.is_board(p_association_id) then
    raise exception 'Only a board member can save a policy.' using errcode = '42501';
  end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' or p_values = '{}'::jsonb then
    raise exception 'Nothing to save.' using errcode = '22023';
  end if;
  select k into v_bad from jsonb_object_keys(p_values) k where not (k = any (v_cols)) limit 1;
  if v_bad is not null then
    raise exception 'Unknown policy field: %', v_bad using errcode = '22023';
  end if;
  if (v_read is null) <> (v_idx is null) then
    raise exception 'A reading and its item go together.' using errcode = '22023';
  end if;

  -- Idempotency 1: one read item saves once. The row lock serialises two tabs
  -- or a double click; the second sees the first's entry.
  if v_read is not null then
    select saved into v_saved from public.insurance_document_reads
     where id = v_read and association_id = p_association_id
     for update;
    if not found then
      raise exception 'That reading was not found.' using errcode = 'P0002';
    end if;
    v_entry := v_saved -> v_idx::text;
    if p_policy_id is null and v_entry is not null and (v_entry ? 'policy_id' or v_entry ? 'quote_id') then
      raise exception 'This policy was already saved from this file.'
        using errcode = '23505', detail = coalesce(v_entry->>'policy_id', v_entry->>'quote_id');
    end if;
  end if;

  -- Idempotency 2: a manual save resubmitted with the same token returns the first row.
  if p_policy_id is null and v_token is not null then
    select id into v_id from public.insurance_policies
     where association_id = p_association_id and client_token = v_token;
    if found then
      return v_id;
    end if;
  end if;

  v_row := jsonb_populate_record(null::public.insurance_policies, p_values);

  select string_agg(format('%I', k), ', '), string_agg(format('($4).%I', k), ', '),
         string_agg(format('%I = ($2).%I', k, k), ', ')
    into v_list, v_select, v_assign
    from jsonb_object_keys(p_values) k;

  if p_policy_id is null then
    v_id := gen_random_uuid();
    begin
      execute format(
        'insert into public.insurance_policies
           (id, association_id, source_document_id, client_token, last_reviewed_at, last_reviewed_by,
            updated_at, updated_by, %s)
         select $1, $2, $3, $5, now(), auth.uid(), now(), auth.uid(), %s', v_list, v_select)
        using v_id, p_association_id, v_doc, v_row, v_token;
    exception when unique_violation then
      -- Two concurrent submits with one token: the loser returns the winner.
      select id into v_id from public.insurance_policies
       where association_id = p_association_id and client_token = v_token;
      if v_id is null then
        raise;
      end if;
      return v_id;
    end;
  else
    select * into v_old from public.insurance_policies
     where id = p_policy_id and association_id = p_association_id
     for update;
    if not found then
      raise exception 'That policy was not found.' using errcode = 'P0002';
    end if;
    -- Compare at millisecond precision: a JS Date round trip drops microseconds.
    -- The action passes PostgREST's string verbatim, so this is belt and braces.
    if p_options ? 'expected_updated_at'
       and date_trunc('milliseconds', v_old.updated_at)
           <> date_trunc('milliseconds', (p_options->>'expected_updated_at')::timestamptz) then
      raise exception 'Someone else changed this policy while you were editing. Reload to see their changes.'
        using errcode = '40001';
    end if;
    execute format(
      'update public.insurance_policies
          set updated_at = now(), updated_by = auth.uid(), last_reviewed_at = now(), last_reviewed_by = auth.uid(),
              source_document_id = coalesce($3, source_document_id), %s
        where id = $1', v_assign)
      using p_policy_id, v_row, v_doc;
    v_id := p_policy_id;

    -- Provenance for fields no longer submitted goes away (definer helper;
    -- the table's delete policy stays board_admin only).
    perform public.insurance_prune_field_sources(
      v_id, null,
      array(select e->>'field_name' from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) e));
  end if;

  insert into public.insurance_policy_field_sources
    (association_id, policy_id, field_name, source, document_id, read_id, page_number, confidence,
     raw_text_snippet, confirmed_on, created_by)
  select p_association_id, v_id, r.field_name, r.source, r.document_id,
         case when r.source = 'extracted' then v_read end,
         r.page_number, r.confidence, r.raw_text_snippet, r.confirmed_on, auth.uid()
    from public.insurance_resolve_sources(p_association_id, v_read, v_idx, v_quote, p_sources) r
  on conflict (policy_id, field_name) do update
     set source = excluded.source, document_id = excluded.document_id, read_id = excluded.read_id,
         page_number = excluded.page_number, confidence = excluded.confidence,
         raw_text_snippet = excluded.raw_text_snippet, confirmed_on = excluded.confirmed_on,
         created_by = excluded.created_by, created_at = now();

  if v_doc is not null then
    insert into public.document_links (association_id, document_id, target_table, target_id, relation)
    values (p_association_id, v_doc, 'insurance_policies', v_id, 'declarations')
    on conflict (document_id, target_table, target_id, relation) do nothing;
  end if;

  select * into v_new from public.insurance_policies where id = v_id;

  if v_replaces is not null then
    if v_replaces = v_id then
      raise exception 'A policy cannot replace itself.' using errcode = '22023';
    end if;
    select * into v_rep from public.insurance_policies
     where id = v_replaces and association_id = p_association_id
     for update;
    if not found then
      raise exception 'The policy this replaces was not found.' using errcode = 'P0002';
    end if;
    if v_rep.archived_at is not null then
      raise exception 'An archived policy can''t be replaced. Restore it first.' using errcode = '22023';
    end if;
    if v_rep.replaced_by_policy_id is not null and v_rep.replaced_by_policy_id <> v_id then
      raise exception 'That policy was already replaced by another one. Open it to change that.' using errcode = '22023';
    end if;
    if v_rep.coverage <> v_new.coverage then
      raise exception 'A policy can only replace one of the same kind.' using errcode = '22023';
    end if;
    if v_rep.effective_from >= v_new.effective_from then
      raise exception 'The policy being replaced has to start before this one.' using errcode = '22023';
    end if;
    if v_new.replaced_by_policy_id = v_replaces then
      raise exception 'These two policies would replace each other.' using errcode = '22023';
    end if;
    update public.insurance_policies
       set replaced_by_policy_id = v_id, replaced_at = coalesce(replaced_at, now()),
           updated_at = now(), updated_by = auth.uid()
     where id = v_replaces;
    -- The old policy's premium bill is NOT moved: it keeps its remaining
    -- installments (track_insurance_premium below gives this policy its own
    -- bill and retires the old one only when nothing is left for it).
  end if;

  if v_quote is not null then
    update public.insurance_quotes set was_selected = true, updated_at = now()
     where id = v_quote and association_id = p_association_id;
    if not found then
      raise exception 'That quote was not found.' using errcode = 'P0002';
    end if;
    update public.insurance_quote_requests r
       set status = 'accepted', updated_at = now(), responded_at = coalesce(r.responded_at, now())
      from public.insurance_quotes q
     where q.id = v_quote and r.id = q.quote_request_id and r.status in ('sent', 'quote_received');
    update public.insurance_policies set accepted_quote_id = v_quote where id = v_id;
  end if;

  if v_read is not null then
    update public.insurance_document_reads
       set saved = saved || jsonb_build_object(v_idx::text, jsonb_build_object('policy_id', v_id)),
           updated_at = now()
     where id = v_read;
  end if;

  if v_bill is not null and jsonb_typeof(v_bill) = 'object' then
    perform public.track_insurance_premium(
      v_id,
      nullif(v_bill->>'account_id', '')::uuid,
      (v_bill->>'frequency')::public.bill_frequency,
      (v_bill->>'typical_amount')::numeric(14,2),
      nullif(v_bill->>'next_due_on', '')::date);
  end if;

  return v_id;
end $$;

revoke all on function public.save_insurance_policy(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_insurance_policy(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 20. Transactional quote save
-- ----------------------------------------------------------------------------

create or replace function public.save_insurance_quote(
  p_association_id uuid,
  p_quote_id       uuid,
  p_values         jsonb,               -- keys ⊆ insurance_quote_editable_columns()
  p_sources        jsonb,               -- as for policies; 'quote' and 'agent_confirmed' are refused
  p_options        jsonb default '{}'::jsonb   -- {document_id, read_id, read_index, client_token}
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_cols   text[] := public.insurance_quote_editable_columns();
  v_bad    text;
  v_row    public.insurance_quotes;
  v_id     uuid;
  v_doc    uuid := nullif(p_options->>'document_id', '')::uuid;
  v_read   uuid := nullif(p_options->>'read_id', '')::uuid;
  v_idx    integer := nullif(p_options->>'read_index', '')::integer;
  v_token  uuid := nullif(p_options->>'client_token', '')::uuid;
  v_saved  jsonb;
  v_entry  jsonb;
  v_list   text;
  v_select text;
  v_assign text;
  v_n      integer;
begin
  if not public.is_board(p_association_id) then
    raise exception 'Only a board member can save a quote.' using errcode = '42501';
  end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' or p_values = '{}'::jsonb then
    raise exception 'Nothing to save.' using errcode = '22023';
  end if;
  select k into v_bad from jsonb_object_keys(p_values) k where not (k = any (v_cols)) limit 1;
  if v_bad is not null then
    raise exception 'Unknown quote field: %', v_bad using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) e
              where e->>'source' in ('quote', 'agent_confirmed')) then
    raise exception 'A quote''s values come from the quote itself or from you.' using errcode = '22023';
  end if;
  if (v_read is null) <> (v_idx is null) then
    raise exception 'A reading and its item go together.' using errcode = '22023';
  end if;

  if v_read is not null then
    select saved into v_saved from public.insurance_document_reads
     where id = v_read and association_id = p_association_id
     for update;
    if not found then
      raise exception 'That reading was not found.' using errcode = 'P0002';
    end if;
    v_entry := v_saved -> v_idx::text;
    if p_quote_id is null and v_entry is not null and (v_entry ? 'policy_id' or v_entry ? 'quote_id') then
      raise exception 'This quote was already saved from this file.'
        using errcode = '23505', detail = coalesce(v_entry->>'quote_id', v_entry->>'policy_id');
    end if;
  end if;

  if p_quote_id is null and v_token is not null then
    select id into v_id from public.insurance_quotes
     where association_id = p_association_id and client_token = v_token;
    if found then
      return v_id;
    end if;
  end if;

  v_row := jsonb_populate_record(null::public.insurance_quotes, p_values);
  select string_agg(format('%I', k), ', '), string_agg(format('($4).%I', k), ', '),
         string_agg(format('%I = ($2).%I', k, k), ', ')
    into v_list, v_select, v_assign
    from jsonb_object_keys(p_values) k;

  if p_quote_id is null then
    v_id := gen_random_uuid();
    begin
      execute format(
        'insert into public.insurance_quotes (id, association_id, document_id, client_token, updated_at, %s)
         select $1, $2, $3, $5, now(), %s', v_list, v_select)
        using v_id, p_association_id, v_doc, v_row, v_token;
    exception when unique_violation then
      select id into v_id from public.insurance_quotes
       where association_id = p_association_id and client_token = v_token;
      if v_id is null then
        raise;
      end if;
      return v_id;
    end;
  else
    execute format(
      'update public.insurance_quotes set updated_at = now(), document_id = coalesce($3, document_id), %s
        where id = $1 and association_id = $4', v_assign)
      using p_quote_id, v_row, v_doc, p_association_id;
    -- EXECUTE does not set FOUND (it would still hold the last SELECT's
    -- result); the row count is the only honest answer.
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'That quote was not found.' using errcode = 'P0002';
    end if;
    v_id := p_quote_id;
    perform public.insurance_prune_field_sources(
      null, v_id,
      array(select e->>'field_name' from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb)) e));
  end if;

  insert into public.insurance_policy_field_sources
    (association_id, quote_id, field_name, source, document_id, read_id, page_number, confidence,
     raw_text_snippet, created_by)
  select p_association_id, v_id, r.field_name, r.source, r.document_id,
         case when r.source = 'extracted' then v_read end,
         r.page_number, r.confidence, r.raw_text_snippet, auth.uid()
    from public.insurance_resolve_sources(p_association_id, v_read, v_idx, null, p_sources) r
  on conflict (quote_id, field_name) do update
     set source = excluded.source, document_id = excluded.document_id, read_id = excluded.read_id,
         page_number = excluded.page_number, confidence = excluded.confidence,
         raw_text_snippet = excluded.raw_text_snippet, created_by = excluded.created_by, created_at = now();

  if v_doc is not null then
    insert into public.document_links (association_id, document_id, target_table, target_id, relation)
    values (p_association_id, v_doc, 'insurance_quotes', v_id, 'quote')
    on conflict (document_id, target_table, target_id, relation) do nothing;
  end if;

  -- A quote arriving answers its request (a request still in draft was evidently sent).
  update public.insurance_quote_requests r
     set status = 'quote_received', sent_at = coalesce(r.sent_at, now()),
         responded_at = coalesce(r.responded_at, now()), updated_at = now()
    from public.insurance_quotes q
   where q.id = v_id and r.id = q.quote_request_id and r.status in ('draft', 'sent', 'declined', 'expired');

  -- ...so its unsent request and follow-up drafts are moot: cancel them, or
  -- "N emails are ready to send" would never clear.
  update public.insurance_messages m
     set status = 'cancelled', updated_at = now()
    from public.insurance_quotes q
   where q.id = v_id and m.quote_request_id = q.quote_request_id
     and m.kind in ('quote_request', 'quote_follow_up') and m.status in ('draft', 'approved');

  if v_read is not null then
    update public.insurance_document_reads
       set saved = saved || jsonb_build_object(v_idx::text, jsonb_build_object('quote_id', v_id)),
           updated_at = now()
     where id = v_read;
  end if;

  return v_id;
end $$;

revoke all on function public.save_insurance_quote(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_insurance_quote(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 21. Archive, delete, reads, messages, requests, contacts, owner summary
-- ----------------------------------------------------------------------------

-- Brief §2: "archive/delete (admin)".
create or replace function public.archive_insurance_policy(p_policy_id uuid, p_archived boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_assoc uuid;
begin
  select association_id into v_assoc from public.insurance_policies where id = p_policy_id;
  if v_assoc is null or not public.has_role_in(v_assoc, array['board_admin']::public.app_role[]) then
    raise exception 'Only a board admin can archive a policy.' using errcode = '42501';
  end if;
  update public.insurance_policies
     set archived_at = case when p_archived then now() end,
         archived_by = case when p_archived then auth.uid() end,
         updated_at = now(), updated_by = auth.uid()
   where id = p_policy_id;
  if p_archived then
    update public.recurring_bills set is_active = false where insurance_policy_id = p_policy_id and is_active;
  end if;
end $$;

revoke all on function public.archive_insurance_policy(uuid, boolean) from public, anon;
grant execute on function public.archive_insurance_policy(uuid, boolean) to authenticated;

-- Decision 35(g): archive is board_admin only. The RPC checks it, but
-- insurance_policies_update lets any board member write the columns directly,
-- so the table enforces it too (REVIEW-1 #6). Definer functions and the
-- service role (current_user is not an API role) are unaffected.
create or replace function public.tg_insurance_policies_archive_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.archived_at is distinct from old.archived_at or new.archived_by is distinct from old.archived_by)
     and current_user in ('authenticated', 'anon')
     and not public.has_role_in(old.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'Only a board admin can archive or restore a policy.' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_insurance_policies_archive_guard() from public, anon;
grant execute on function public.tg_insurance_policies_archive_guard() to authenticated;   -- 0043 convention for trigger functions

create trigger insurance_policies_archive_guard
  before update on public.insurance_policies
  for each row execute function public.tg_insurance_policies_archive_guard();

-- document_links.target_id has no FK, so deletes remove the links in the same
-- transaction (a dangling link blocks purging the document: document_id is
-- ON DELETE RESTRICT, 0001).
create or replace function public.delete_insurance_policy(p_policy_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_assoc uuid;
begin
  select association_id into v_assoc from public.insurance_policies where id = p_policy_id for update;
  if v_assoc is null or not public.has_role_in(v_assoc, array['board_admin']::public.app_role[]) then
    raise exception 'Only a board admin can delete a policy.' using errcode = '42501';
  end if;
  if exists (select 1 from public.insurance_claims c where c.policy_id = p_policy_id) then
    raise exception 'This policy has claims recorded against it. Archive it instead.' using errcode = '23503';
  end if;
  update public.insurance_policies set replaced_by_policy_id = null
   where replaced_by_policy_id = p_policy_id;
  update public.recurring_bills set is_active = false
   where insurance_policy_id = p_policy_id and is_active;
  delete from public.document_links
   where association_id = v_assoc and target_table = 'insurance_policies' and target_id = p_policy_id;
  delete from public.insurance_policies where id = p_policy_id;
end $$;

create or replace function public.delete_insurance_quote(p_quote_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_assoc uuid;
begin
  select association_id into v_assoc from public.insurance_quotes where id = p_quote_id for update;
  if v_assoc is null or not public.has_role_in(v_assoc, array['board_admin']::public.app_role[]) then
    raise exception 'Only a board admin can delete a quote.' using errcode = '42501';
  end if;
  delete from public.document_links
   where association_id = v_assoc and target_table = 'insurance_quotes' and target_id = p_quote_id;
  delete from public.insurance_quotes where id = p_quote_id;
end $$;

create or replace function public.delete_insurance_claim(p_claim_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_assoc uuid;
begin
  select association_id into v_assoc from public.insurance_claims where id = p_claim_id for update;
  if v_assoc is null or not public.has_role_in(v_assoc, array['board_admin']::public.app_role[]) then
    raise exception 'Only a board admin can delete a claim.' using errcode = '42501';
  end if;
  update public.insurance_messages set claim_id = null where claim_id = p_claim_id;
  delete from public.document_links
   where association_id = v_assoc and target_table = 'insurance_claims' and target_id = p_claim_id;
  delete from public.insurance_claims where id = p_claim_id;
end $$;

revoke all on function public.delete_insurance_policy(uuid) from public, anon;
revoke all on function public.delete_insurance_quote(uuid) from public, anon;
revoke all on function public.delete_insurance_claim(uuid) from public, anon;
grant execute on function public.delete_insurance_policy(uuid) to authenticated;
grant execute on function public.delete_insurance_quote(uuid) to authenticated;
grant execute on function public.delete_insurance_claim(uuid) to authenticated;

-- Atomically move a read to "running". Returns a set so "nothing to claim" is
-- an empty array over PostgREST (a composite return would come back as an
-- object of nulls). Stale = running longer than AI_STALE_AFTER_SECONDS (330).
create or replace function public.claim_insurance_read(p_read_id uuid)
returns setof public.insurance_document_reads
language plpgsql security invoker set search_path = '' as $$
begin
  return query
  with claimed as (
    update public.insurance_document_reads d
       set state = 'running', attempts = d.attempts + 1, started_at = now(), finished_at = null,
           error = null, updated_at = now()
     where d.id = p_read_id
       and public.is_board(d.association_id)
       and d.attempts < 3
       and (d.state in ('queued', 'failed', 'timed_out', 'quota', 'not_configured')
            or (d.state = 'running' and d.started_at < now() - interval '330 seconds'))
    returning d.*
  )
  select * from claimed;
end $$;

revoke all on function public.claim_insurance_read(uuid) from public, anon;
grant execute on function public.claim_insurance_read(uuid) to authenticated;

-- Skip or unskip one found policy. jsonb operators in one UPDATE, under the
-- same row lock the save RPCs take, so a concurrent save is never overwritten.
create or replace function public.set_insurance_read_item_skipped(p_read_id uuid, p_index integer, p_skipped boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_saved jsonb;
  v_entry jsonb;
begin
  select saved into v_saved from public.insurance_document_reads
   where id = p_read_id and public.is_board(association_id)
   for update;
  if not found then
    raise exception 'That reading was not found.' using errcode = 'P0002';
  end if;
  if p_index is null or p_index < 0 then
    raise exception 'Unknown item.' using errcode = '22023';
  end if;
  v_entry := v_saved -> p_index::text;
  if v_entry is not null and (v_entry ? 'policy_id' or v_entry ? 'quote_id') then
    raise exception 'This one is already saved.' using errcode = '22023';
  end if;
  update public.insurance_document_reads
     set saved = case when p_skipped
                      then saved || jsonb_build_object(p_index::text, jsonb_build_object('skipped', true))
                      else saved - p_index::text end,
         updated_at = now()
   where id = p_read_id;
end $$;

revoke all on function public.set_insurance_read_item_skipped(uuid, integer, boolean) from public, anon;
grant execute on function public.set_insurance_read_item_skipped(uuid, integer, boolean) to authenticated;

-- Quote requests and their draft emails in one transaction (the drafts were
-- written before this call, with no DB writes; a failure leaves nothing).
--   p_requests: [{contact_id, partner_id, policy_id, coverages: text[], payload_json}]
--   p_messages: [{subject, body, to_email, drafted_by, facts_json}]   -- same order, same length
create or replace function public.create_insurance_quote_requests(
  p_association_id uuid, p_requests jsonb, p_messages jsonb
) returns table (request_id uuid, message_id uuid)
language plpgsql security invoker set search_path = '' as $$
declare
  v_n   integer;
  v_i   integer;
  v_r   jsonb;
  v_m   jsonb;
  v_req uuid;
  v_msg uuid;
begin
  if not public.is_board(p_association_id) then
    raise exception 'Only a board member can ask for quotes.' using errcode = '42501';
  end if;
  v_n := jsonb_array_length(coalesce(p_requests, '[]'::jsonb));
  if v_n = 0 or v_n > 10 or v_n <> jsonb_array_length(coalesce(p_messages, '[]'::jsonb)) then
    raise exception 'Choose between one and ten contacts.' using errcode = '22023';
  end if;
  for v_i in 0 .. v_n - 1 loop
    v_r := p_requests -> v_i;
    v_m := p_messages -> v_i;
    insert into public.insurance_quote_requests
      (association_id, contact_id, partner_id, policy_id, coverages, payload_json, status)
    values
      (p_association_id, (v_r->>'contact_id')::uuid, nullif(v_r->>'partner_id', '')::uuid,
       nullif(v_r->>'policy_id', '')::uuid,
       array(select jsonb_array_elements_text(coalesce(v_r->'coverages', '[]'::jsonb))),
       v_r->'payload_json', 'draft')
    returning id into v_req;
    insert into public.insurance_messages
      (association_id, kind, contact_id, to_email, subject, body, status, quote_request_id, drafted_by, facts_json)
    values
      (p_association_id, 'quote_request', (v_r->>'contact_id')::uuid, v_m->>'to_email',
       v_m->>'subject', v_m->>'body', 'draft', v_req, coalesce(v_m->>'drafted_by', 'template'),
       coalesce(v_m->'facts_json', '{}'::jsonb))
    returning id into v_msg;
    request_id := v_req;
    message_id := v_msg;
    return next;
  end loop;
end $$;

revoke all on function public.create_insurance_quote_requests(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.create_insurance_quote_requests(uuid, jsonb, jsonb) to authenticated;

create or replace function public.mark_insurance_message_sent(p_message_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_assoc uuid;
  v_req   uuid;
begin
  select association_id, quote_request_id into v_assoc, v_req
    from public.insurance_messages where id = p_message_id;
  if v_assoc is null or not public.is_board(v_assoc) then
    raise exception 'Only a board member can mark an email sent.' using errcode = '42501';
  end if;
  update public.insurance_messages
     set status = 'sent', sent_at = now(), approved_by = auth.uid(), updated_at = now()
   where id = p_message_id and status in ('draft', 'approved');
  if not found then
    raise exception 'This email was already marked sent or was cancelled.' using errcode = '22023';
  end if;
  if v_req is not null then
    update public.insurance_quote_requests
       set status = 'sent', sent_at = coalesce(sent_at, now()), updated_at = now()
     where id = v_req and status = 'draft';
  end if;
  -- An owner's proof request answered by this email is done.
  update public.insurance_owner_requests
     set status = 'done', handled_by = auth.uid(), handled_at = now()
   where message_id = p_message_id and status = 'open';
end $$;

revoke all on function public.mark_insurance_message_sent(uuid) from public, anon;
grant execute on function public.mark_insurance_message_sent(uuid) to authenticated;

-- One current agent per association (unique index part 2): clear, then set.
create or replace function public.set_current_insurance_agent(p_contact_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_assoc uuid;
begin
  select association_id into v_assoc from public.insurance_contacts
   where id = p_contact_id and archived_at is null;
  if v_assoc is null or not public.is_board(v_assoc) then
    raise exception 'Only a board member can choose the current agent.' using errcode = '42501';
  end if;
  update public.insurance_contacts set is_current_agent = false, updated_at = now()
   where association_id = v_assoc and is_current_agent and id <> p_contact_id;
  update public.insurance_contacts set is_current_agent = true, updated_at = now()
   where id = p_contact_id;
end $$;

revoke all on function public.set_current_insurance_agent(uuid) from public, anon;
grant execute on function public.set_current_insurance_agent(uuid) to authenticated;

-- Board members (not only admins) may set the four building facts the
-- coverage check and quote requests use. associations_update stays
-- board_admin only (0002); address, city, state and ZIP stay there.
create or replace function public.update_insurance_building_basics(
  p_association_id uuid, p_year_built smallint, p_construction_type text,
  p_stories smallint, p_roof_replaced_year smallint
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_board(p_association_id) then
    raise exception 'Only a board member can change these facts.' using errcode = '42501';
  end if;
  -- The columns' own CHECK constraints (0041) validate the values.
  update public.associations
     set year_built = p_year_built, construction_type = p_construction_type,
         stories = p_stories, roof_replaced_year = p_roof_replaced_year
   where id = p_association_id;
end $$;

revoke all on function public.update_insurance_building_basics(uuid, smallint, text, smallint, smallint) from public, anon;
grant execute on function public.update_insurance_building_basics(uuid, smallint, text, smallint, smallint) to authenticated;

-- Owners: ask the board for proof of insurance (decision 9 keeps owners out of
-- insurance_* tables; this is the only way in, and only for their own row).
create or replace function public.request_insurance_proof(
  p_association uuid, p_kind text, p_note text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_person uuid := public.current_person_id(p_association);
  v_id     uuid;
begin
  if v_person is null or not public.is_member(p_association) then
    raise exception 'Only a member of this association can ask.' using errcode = '42501';
  end if;
  if p_kind not in ('certificate', 'question') then
    raise exception 'Unknown request.' using errcode = '22023';
  end if;
  if (select count(*) from public.insurance_owner_requests r
       where r.person_id = v_person and r.created_at > now() - interval '1 day') >= 3 then
    raise exception 'You''ve asked three times today. The board will get back to you.' using errcode = '22023';
  end if;
  insert into public.insurance_owner_requests (association_id, person_id, kind, note)
  values (p_association, v_person, p_kind, nullif(left(btrim(p_note), 1000), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.my_insurance_proof_requests(p_association uuid)
returns table (id uuid, kind text, status text, created_at timestamptz, handled_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.kind, r.status, r.created_at, r.handled_at
    from public.insurance_owner_requests r
   where r.association_id = p_association
     and r.person_id = public.current_person_id(p_association)
   order by r.created_at desc
   limit 10
$$;

revoke all on function public.request_insurance_proof(uuid, text, text) from public, anon;
revoke all on function public.my_insurance_proof_requests(uuid) from public, anon;
grant execute on function public.request_insurance_proof(uuid, text, text) to authenticated;
grant execute on function public.my_insurance_proof_requests(uuid) to authenticated;

create or replace function public.publish_insurance_owner_summary(
  p_association_id uuid, p_content jsonb, p_source_policy_id uuid, p_source_hash text
) returns timestamptz
language plpgsql security invoker set search_path = '' as $$
declare
  v_at timestamptz := now();
begin
  if not public.is_board(p_association_id) then
    raise exception 'Only a board member can publish the summary.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_content) <> 'object' or p_content->>'version' is distinct from '1' then
    raise exception 'The summary is not in the expected shape.' using errcode = '22023';
  end if;
  insert into public.insurance_owner_summaries
    (association_id, source_policy_id, source_hash, draft, published, published_at, published_by, updated_at)
  values (p_association_id, p_source_policy_id, p_source_hash, p_content, p_content, v_at, auth.uid(), v_at)
  on conflict (association_id) do update
     set source_policy_id = excluded.source_policy_id, source_hash = excluded.source_hash,
         draft = excluded.draft, published = excluded.published, published_at = excluded.published_at,
         published_by = excluded.published_by, updated_at = excluded.updated_at;
  return v_at;
end $$;

revoke all on function public.publish_insurance_owner_summary(uuid, jsonb, uuid, text) from public, anon;
grant execute on function public.publish_insurance_owner_summary(uuid, jsonb, uuid, text) to authenticated;

-- Owners' only window into insurance (decision 9): the published snapshot.
create or replace function public.owner_insurance_summary(p_association uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select s.published || jsonb_build_object('published_at', s.published_at)
    from public.insurance_owner_summaries s
   where s.association_id = p_association
     and s.published_at is not null
     and public.is_member(p_association)
$$;

revoke all on function public.owner_insurance_summary(uuid) from public, anon;
grant execute on function public.owner_insurance_summary(uuid) to authenticated;

comment on function public.owner_insurance_summary(uuid) is
  'Returns only the board-published owner summary (decision 9), to any member of that association. Owners never read insurance_* tables directly.';

-- ----------------------------------------------------------------------------
-- 22. Year-over-year view ignores policies archived as mistakes
-- ----------------------------------------------------------------------------

create or replace view public.insurance_year_over_year
with (security_invoker = true) as
select
  p.association_id,
  p.coverage,
  p.id                                as policy_id,
  p.carrier_name,
  p.effective_from,
  p.effective_to,
  p.annual_premium::numeric(14,2)     as annual_premium,
  lag(p.annual_premium) over w        as previous_premium,
  lag(p.carrier_name)   over w        as previous_carrier,
  (p.annual_premium - lag(p.annual_premium) over w)::numeric(14,2) as change_amount,
  case
    when lag(p.annual_premium) over w is null or lag(p.annual_premium) over w = 0 then null
    else round((p.annual_premium - lag(p.annual_premium) over w) / lag(p.annual_premium) over w * 100, 1)
  end                                 as change_percent,
  (select count(*) from public.insurance_quotes q
    where q.association_id = p.association_id
      and q.coverage = p.coverage
      and q.quoted_on between p.effective_from - interval '120 days' and p.effective_from
  )::int                              as quotes_obtained
from public.insurance_policies p
where p.archived_at is null
window w as (partition by p.association_id, p.coverage order by p.effective_from);

-- ----------------------------------------------------------------------------
-- 23. Backfills
-- ----------------------------------------------------------------------------

-- updated_at reflects the last real change, not this migration.
update public.insurance_policies set updated_at = coalesce(last_reviewed_at, created_at);
update public.insurance_quotes   set updated_at = created_at;

-- Package sections for existing rows (from what they hold).
update public.insurance_policies set included_sections = array_remove(array[
    case when coverage::text = 'property' then 'property' end,
    case when coverage::text = 'property' then 'property_deductibles' end,
    case when coverage::text = 'general_liability'
           or liability_per_occurrence is not null or liability_aggregate is not null then 'liability' end,
    case when coverage::text = 'directors_officers' or do_limit is not null then 'do' end,
    case when coverage::text = 'umbrella' or umbrella_limit is not null then 'umbrella' end,
    case when coverage::text = 'flood' then 'flood' end,
    case when coverage::text in ('workers_comp') then 'workers_comp' end,
    case when coverage::text = 'other' then 'generic' end
  ], null);
update public.insurance_quotes set included_sections = array_remove(array[
    case when coverage::text = 'property' then 'property' end,
    case when coverage::text = 'property' then 'property_deductibles' end,
    case when coverage::text = 'general_liability'
           or liability_per_occurrence is not null or liability_aggregate is not null then 'liability' end,
    case when coverage::text = 'directors_officers' or do_limit is not null then 'do' end,
    case when coverage::text = 'umbrella' or umbrella_limit is not null then 'umbrella' end,
    case when coverage::text = 'flood' then 'flood' end,
    case when coverage::text in ('workers_comp') then 'workers_comp' end,
    case when coverage::text = 'other' then 'generic' end
  ], null);

-- The agent recorded on each policy becomes a contact. Blank strings count as
-- missing (the name check refuses an empty name), and an email the contacts
-- check would refuse is dropped rather than failing the migration. The
-- distinct key is the contact's own identity (name, kept email), so two
-- policies whose emails differ only by being invalid make one contact.
with agents as (
  select p.id as policy_id, p.association_id, p.effective_from, p.created_by, p.created_at,
         nullif(btrim(p.agency_name), '') as agency,
         nullif(btrim(p.broker_name), '') as person,
         case when btrim(p.broker_email) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
              then btrim(p.broker_email) end as email,
         nullif(btrim(p.agent_phone), '') as phone
    from public.insurance_policies p
)
insert into public.insurance_contacts
  (association_id, kind, name, person_name, email, phone, source, is_current_agent, created_by, created_at)
select distinct on (a.association_id, lower(coalesce(a.agency, a.person)), lower(coalesce(a.email, '')))
       a.association_id,
       case when a.agency is not null then 'agency' else 'agent' end,
       coalesce(a.agency, a.person),
       case when a.agency is not null then a.person end,
       a.email,
       a.phone,
       'policy',
       false,                     -- set for one contact per association below (unique index)
       a.created_by,
       a.created_at
  from agents a
 where coalesce(a.agency, a.person) is not null
 order by a.association_id, lower(coalesce(a.agency, a.person)), lower(coalesce(a.email, '')),
          a.effective_from desc
on conflict do nothing;

update public.insurance_policies p
   set agent_contact_id = c.id
  from public.insurance_contacts c
 where c.association_id = p.association_id
   and c.source = 'policy'
   and lower(c.name) = lower(coalesce(nullif(btrim(p.agency_name), ''), nullif(btrim(p.broker_name), '')))
   and lower(coalesce(c.email, '')) = lower(coalesce(
         case when btrim(p.broker_email) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
              then btrim(p.broker_email) end, ''));

-- One current agent per association: the agent of the latest-starting policy
-- that is still in force (0041 meaning: not replaced, not ended).
update public.insurance_contacts c
   set is_current_agent = true
  from (
    select distinct on (p.association_id) p.association_id, p.agent_contact_id
      from public.insurance_policies p
     where p.agent_contact_id is not null and p.replaced_at is null and p.effective_to >= current_date
     order by p.association_id, p.effective_from desc, p.created_at desc
  ) pick
 where c.id = pick.agent_contact_id;

-- Platform partners already written to become contacts of that association.
-- (insurance_partners.contact_email was never format-checked; one the
-- contacts check would refuse is left off rather than failing the migration.)
insert into public.insurance_contacts (association_id, kind, name, email, phone, source, partner_id)
select distinct r.association_id, 'broker', pt.name,
       case when btrim(pt.contact_email) ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
            then btrim(pt.contact_email) end,
       pt.phone, 'partner', pt.id
  from public.insurance_quote_requests r
  join public.insurance_partners pt on pt.id = r.partner_id
 where length(btrim(pt.name)) > 0
on conflict do nothing;

update public.insurance_quote_requests r
   set contact_id = c.id
  from public.insurance_contacts c
 where c.association_id = r.association_id and c.partner_id = r.partner_id and r.contact_id is null;

update public.insurance_quote_requests r
   set coverages = array[p.coverage::text]
  from public.insurance_policies p
 where p.id = r.policy_id and r.coverages = '{}';

-- Replacement links for policies 0041 marked replaced (best effort: the next
-- policy of the same cover that started strictly later, or on the same day but
-- was created later). The strict order makes A->B and B->A impossible, so two
-- same-day duplicates can't hide each other.
update public.insurance_policies o
   set replaced_by_policy_id = (
     select n.id from public.insurance_policies n
      where n.association_id = o.association_id and n.coverage = o.coverage and n.id <> o.id
        and (n.effective_from > o.effective_from
             or (n.effective_from = o.effective_from and n.created_at > o.created_at))
      order by n.effective_from, n.created_at
      limit 1)
 where o.replaced_at is not null and o.replaced_by_policy_id is null;
-- Rows still without a successor keep replaced_at and no link. policyStatus()
-- reports them as "replaced" (§6.4 rule 2b), so they don't come back as
-- active or expired in reminders, the check or the coverage map.

-- 0041 bills were made on every click; a policy's active bills beyond the one
-- linked below stay active and unlinked so nothing disappears silently. The
-- Overview lists them under "Possible duplicate premium bills" (§9.1 item 3).

-- Premium bills made by the 0041 button: link the earliest matching bill to
-- its policy when the match is unambiguous. Later duplicates stay unlinked
-- (the board can deactivate them; nothing is deleted).
with candidates as (
  select distinct on (p.id) b.id as bill_id, p.id as policy_id
    from public.recurring_bills b
    join public.insurance_policies p
      on p.association_id = b.association_id
     and b.name = p.carrier_name || ' insurance'
     and b.notes = 'Premium for the ' || replace(p.coverage::text, '_', ' ') || ' policy.'
   where b.is_active and b.insurance_policy_id is null and p.replaced_at is null
     and (select count(*) from public.insurance_policies p2
           where p2.association_id = p.association_id and p2.carrier_name = p.carrier_name
             and p2.coverage = p.coverage and p2.replaced_at is null) = 1
   order by p.id, b.created_at
)
update public.recurring_bills b
   set insurance_policy_id = c.policy_id
  from candidates c
 where b.id = c.bill_id;

create unique index recurring_bills_insurance_policy_key
  on public.recurring_bills (insurance_policy_id)
  where insurance_policy_id is not null and is_active;
