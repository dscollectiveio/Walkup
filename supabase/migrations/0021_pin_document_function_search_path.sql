-- ============================================================================
-- Walkup — migration 0021: pin search_path on the two functions 0020 added
--
-- Same shape as 0007: found by Supabase's own linter immediately after
-- applying 0020 to the real project, and fixed forward rather than by editing
-- an applied migration, so the repo and the database stay in exact step.
--
-- Neither function is SECURITY DEFINER, so CLAUDE.md invariant 11 does not
-- strictly bite — an unpinned search_path is an escalation vector only when
-- the function runs as its owner. Pinning them anyway costs nothing, keeps the
-- advisor report clean enough that a real finding stands out, and removes the
-- question of what happens if either is ever made SECURITY DEFINER later.
--
-- Both bodies reference no schema objects at all — one returns a constant list,
-- the other only touches NEW — so an empty search_path cannot break them.
-- ============================================================================

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
    ('other',                     'Other',                       'board_only',       160)
$$;

revoke all on function public.document_category_defaults() from public, anon;
grant execute on function public.document_category_defaults() to authenticated;

create or replace function public.tg_document_title()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.title := coalesce(nullif(trim(new.title), ''), new.filename);
  return new;
end $$;

revoke all on function public.tg_document_title() from public, anon, authenticated;
