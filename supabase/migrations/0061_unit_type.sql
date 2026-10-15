-- ============================================================================
-- Walkup — migration 0061: unit type
--
-- What kind of unit each is (commercial, residential, residential penthouse
-- or other) and which floor it is on. Both show on the Building Info roster
-- and are edited with the unit; the floor decides how the building graphic is
-- drawn (units on one floor side by side, floors stacked). A short free-text
-- note per unit is kept alongside.
-- units_update (0002) is row-level and tg_audit (0004) captures the whole
-- row, so no policy or trigger changes are needed.
-- ============================================================================

alter table public.units
  add column floor smallint check (floor is null or floor between -5 and 200),
  add column notes text check (notes is null or char_length(notes) between 1 and 1000),
  add column unit_type text
    check (unit_type is null or unit_type in ('commercial', 'residential', 'residential_penthouse', 'other'));
