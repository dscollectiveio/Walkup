-- 0077: the three outside roles, step 1 (docs/specs/access-audit-2026-10-20.md, Round 2: "Outside roles
-- (property manager login, attorney, observer): build now"). Only the enum values live here: a new
-- enum value cannot be used in the transaction that adds it, so everything that uses them is in 0080.
alter type public.app_role add value if not exists 'property_manager';
alter type public.app_role add value if not exists 'attorney';
alter type public.app_role add value if not exists 'observer';
