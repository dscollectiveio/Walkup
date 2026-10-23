-- ============================================================================
-- 0089: files attached to an announcement get a category owners can be shown
-- ============================================================================
-- A file added from the announcement composer was filed as "Other", which can't be shared with all owners (0074 allows
-- only governing documents, minutes and financial statements), so attaching it to an announcement always hit the
-- sharing error (workflow guide, Appendix A). The board's choice to attach a file to a notice for owners IS the
-- decision to share it, so those files get their own category, "Announcement file", that is shareable. It is still
-- board only until the composer shares it, and still never pinned to a unit.

-- Same list as 0079, with one more row. New associations are seeded from this; existing ones are backfilled below.
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
    ('other',                     'Other',                       'board_only',       160),
    ('unit_owner_upload',         'Unit document',               'board_only',       170),
    ('announcement_file',         'Announcement file',           'board_only',       180)
$$;

revoke all on function public.document_category_defaults() from public, anon;
grant execute on function public.document_category_defaults() to authenticated;

insert into public.document_categories
  (association_id, slug, label, default_visibility, sort_order, is_system)
select a.id, d.slug, d.label, d.default_visibility, d.sort_order, true
  from public.associations a
 cross join public.document_category_defaults() d
 where d.slug = 'announcement_file'
on conflict (association_id, slug) do nothing;

-- The categories an owner may be shown without a unit pin: 0074's three, plus the announcement file.
create or replace function public.owner_shareable_category(p_category_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.document_categories c
     where c.id = p_category_id
       and c.slug in ('governing', 'minutes', 'financial_statement', 'announcement_file')
  )
$$;

revoke all on function public.owner_shareable_category(uuid) from public, anon;
grant execute on function public.owner_shareable_category(uuid) to authenticated;
