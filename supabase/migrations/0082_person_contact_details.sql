-- ============================================================================
-- 0082: a person's phone and mailing address move to their own table
-- ============================================================================
-- DECISIONS #50. The access audit (docs/specs/access-audit-2026-10-20.md, #47) found that the accountant
-- could read every owner's phone and mailing address, because persons_select lets "board and accountant"
-- (can_read_financials) read whole rows. The accountant needs names and email for the books; nothing in
-- their work needs a phone number or a home address. Column-level grants cannot separate them (board and
-- accountant share one database role), so the two columns move to public.person_contact_details, which the
-- accountant has no policy on. `email` stays on persons (sign-in, invites, email sending and about thirty
-- pages read it; the owner decided not to move it).
--
-- Who reads person_contact_details: the board (is_board), the person themselves, a property manager. An
-- attorney reads it only through attorney_shared_owners(), for the units shared with them. Not the
-- accountant, other owners or observers.
-- Who writes it: the board (is_board), and the person themselves through update_my_profile() only.
--
-- Not applied by hand: this file is the whole change.

-- ----------------------------------------------------------------------------
-- 1. The table
-- ----------------------------------------------------------------------------

create table public.person_contact_details (
  person_id       uuid primary key references public.persons(id) on delete cascade,
  association_id  uuid not null references public.associations(id) on delete restrict,
  phone           text,
  mailing_address text,
  updated_at      timestamptz not null default now(),
  -- tg_audit() names the audited record by an "id" key. This is the person's id, so a person's audit history
  -- (and its redaction in redact_person) is found by the same id as their persons row.
  id              uuid generated always as (person_id) stored
);

comment on table public.person_contact_details is
  'A person''s phone and mailing address, apart from persons so the accountant cannot read them (DECISIONS #50). Read by the board, the person themselves and a property manager; an attorney only through attorney_shared_owners(). Written by the board, and by the person through update_my_profile().';

create index person_contact_details_association_idx on public.person_contact_details (association_id);

-- Copy what is there today (before the audit trigger exists, so the copy is not logged as new edits).
insert into public.person_contact_details (person_id, association_id, phone, mailing_address)
select p.id, p.association_id, p.phone, p.mailing_address
  from public.persons p
 where p.phone is not null or p.mailing_address is not null;

-- The association always comes from the person, never from the caller, and the person cannot be swapped.
create or replace function public.tg_person_contact_details_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_assoc uuid;
begin
  select p.association_id into v_assoc from public.persons p where p.id = new.person_id;
  if v_assoc is null then
    raise exception 'that person isn''t on file' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.person_id is distinct from old.person_id then
    raise exception 'contact details cannot be moved to another person' using errcode = '42501';
  end if;
  new.association_id := v_assoc;
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.tg_person_contact_details_guard() from public, anon;
grant execute on function public.tg_person_contact_details_guard() to authenticated;

create trigger person_contact_details_guard
  before insert or update on public.person_contact_details
  for each row execute function public.tg_person_contact_details_guard();

create trigger audit_person_contact_details
  after insert or update or delete on public.person_contact_details
  for each row execute function public.tg_audit();

-- ----------------------------------------------------------------------------
-- 2. Who can read and write it
-- ----------------------------------------------------------------------------

alter table public.person_contact_details enable row level security;

create policy person_contact_details_select on public.person_contact_details
  for select to authenticated
  using (
    public.is_board(association_id)
    or public.has_role_in(association_id, array['property_manager']::public.app_role[])
    or exists (select 1 from public.persons p where p.id = person_id and p.auth_user_id = auth.uid())
  );

create policy person_contact_details_insert on public.person_contact_details
  for insert to authenticated
  with check (public.is_board(association_id));

create policy person_contact_details_update on public.person_contact_details
  for update to authenticated
  using (public.is_board(association_id))
  with check (public.is_board(association_id));

create policy person_contact_details_delete on public.person_contact_details
  for delete to authenticated
  using (public.is_board(association_id));

-- ----------------------------------------------------------------------------
-- 3. update_my_profile: the person edits their own details
-- ----------------------------------------------------------------------------
-- Same signature, same checks and limits as 0054. The two blank values remove the row.

create or replace function public.update_my_profile(
  p_association_id  uuid,
  p_phone           text,
  p_mailing_address text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_person uuid := public.current_person_id(p_association_id);
  v_phone  text := nullif(btrim(p_phone), '');
  v_addr   text := nullif(btrim(p_mailing_address), '');
begin
  if v_person is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_phone is not null and char_length(v_phone) > 40 then
    raise exception 'phone number is too long' using errcode = '22023';
  end if;
  if v_addr is not null and char_length(v_addr) > 300 then
    raise exception 'mailing address is too long' using errcode = '22023';
  end if;
  if v_phone is null and v_addr is null then
    delete from public.person_contact_details where person_id = v_person;
  else
    insert into public.person_contact_details (person_id, association_id, phone, mailing_address)
    values (v_person, p_association_id, v_phone, v_addr)
    on conflict (person_id) do update
      set phone = excluded.phone, mailing_address = excluded.mailing_address;
  end if;
end $$;

revoke all on function public.update_my_profile(uuid, text, text) from public, anon;
grant execute on function public.update_my_profile(uuid, text, text) to authenticated;

comment on function public.update_my_profile(uuid, text, text) is
  'The signed-in person edits their own phone and mailing address (person_contact_details). Name and email are the board''s record.';

-- ----------------------------------------------------------------------------
-- 4. attorney_shared_owners: read the new table
-- ----------------------------------------------------------------------------
-- Same columns as 0080. An owner with no details on file still appears, with blanks.

create or replace function public.attorney_shared_owners(p_association_id uuid)
returns table (
  unit_id         uuid,
  unit_label      text,
  full_name       text,
  email           text,
  phone           text,
  mailing_address text,
  owner_since     date
)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.label, p.full_name, p.email, d.phone, d.mailing_address, uo.effective_from
    from public.attorney_shares s
    join public.units u on u.id = s.unit_id and u.association_id = s.association_id
    join public.unit_owners uo
      on uo.unit_id = u.id
     and uo.association_id = u.association_id
     and (uo.effective_to is null or uo.effective_to >= current_date)
    join public.persons p on p.id = uo.person_id and p.association_id = u.association_id
    left join public.person_contact_details d on d.person_id = p.id
   where s.association_id = p_association_id
     and s.unit_id is not null
     and s.person_id = public.current_person_id(p_association_id)
     and public.has_role_in(p_association_id, array['attorney']::public.app_role[])
   order by u.sort_order, u.label, p.full_name
$$;

revoke all on function public.attorney_shared_owners(uuid) from public, anon;
grant execute on function public.attorney_shared_owners(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. redact_person, delete_former_member and import_commit: patched from their current definitions
-- ----------------------------------------------------------------------------
-- These are long and already applied, so each is rewritten from pg_get_functiondef() with the few lines that
-- touched persons.phone / persons.mailing_address replaced. Each patch must change the text, or this fails.

do $$
declare
  v_def text;
  v_new text;
begin
  -- redact_person: clear the contact details row, and scrub its audit history, instead of the two columns.
  v_def := pg_get_functiondef('public.redact_person(uuid)'::regprocedure);
  v_new := regexp_replace(v_def, 'phone\s+=\s+null,\s*mailing_address\s+=\s+null,\s*', '');
  if v_new = v_def then raise exception 'redact_person: could not find the phone/mailing_address update'; end if;
  v_def := v_new;
  v_new := replace(v_def,
    'perform public.email_redact_person(p.id, p.email);',
    $p$delete from public.person_contact_details where person_id = p.id;

  update public.audit_log
     set before_data = case when before_data is null then null
                            else before_data || jsonb_build_object('phone', null, 'mailing_address', null) end,
         after_data  = case when after_data is null then null
                            else after_data  || jsonb_build_object('phone', null, 'mailing_address', null) end
   where association_id = p.association_id
     and table_name = 'person_contact_details'
     and record_id = p.id;

  perform public.email_redact_person(p.id, p.email);$p$);
  if v_new = v_def then raise exception 'redact_person: could not find the email_redact_person call'; end if;
  execute v_new;

  -- delete_former_member: "no phone or address" now means no details row holding either.
  v_def := pg_get_functiondef('public.delete_former_member(uuid)'::regprocedure);
  v_new := regexp_replace(v_def,
    'or p\.phone is not null\s+or p\.mailing_address is not null',
    'or exists (select 1 from public.person_contact_details d where d.person_id = p.id and (d.phone is not null or d.mailing_address is not null))');
  if v_new = v_def then raise exception 'delete_former_member: could not find the phone/mailing_address check'; end if;
  execute v_new;

  -- import_commit: a new person's phone and address go to person_contact_details.
  v_def := pg_get_functiondef('public.import_commit(uuid, text)'::regprocedure);
  v_new := replace(v_def,
    'insert into public.persons (association_id, full_name, email, phone, mailing_address)',
    'insert into public.persons (association_id, full_name, email)');
  if v_new = v_def then raise exception 'import_commit: could not find the persons insert'; end if;
  v_def := v_new;
  v_new := regexp_replace(v_def,
    ',\s*nullif\(btrim\(m ->> ''phone''\), ''''\), nullif\(btrim\(m ->> ''mailing_address''\), ''''\)\)',
    ')');
  if v_new = v_def then raise exception 'import_commit: could not find the phone/mailing_address values'; end if;
  v_def := v_new;
  v_new := replace(v_def,
    'v_new_person := v_person;',
    $p$v_new_person := v_person;
          if nullif(btrim(m ->> 'phone'), '') is not null or nullif(btrim(m ->> 'mailing_address'), '') is not null then
            insert into public.person_contact_details (person_id, association_id, phone, mailing_address)
            values (v_person, b.association_id, nullif(btrim(m ->> 'phone'), ''), nullif(btrim(m ->> 'mailing_address'), ''));
          end if;$p$);
  if v_new = v_def then raise exception 'import_commit: could not find v_new_person assignment'; end if;
  execute v_new;
end $$;

-- ----------------------------------------------------------------------------
-- 6. Drop the two columns (fails, rather than cascades, if anything still depends on them)
-- ----------------------------------------------------------------------------

alter table public.persons drop column phone, drop column mailing_address;
