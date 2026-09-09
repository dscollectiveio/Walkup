-- ============================================================================
-- Walkup — migration 0030: let a board_admin delete a misplaced unit_owners row
--
-- unit_owners had select/insert/update policies (0002) but no delete policy
-- at all — RLS denies by default, so there was never a way to remove a row
-- outright. That's fine for a real ownership change (end the old row with
-- an effective_to date, per changeUnitOwner/endUnitOwnership — the history
-- should stay on record), but it's wrong for a data-entry mistake: assigning
-- the wrong person to a unit by accident shouldn't leave a permanent, false
-- "so-and-so owned this unit" record. This adds a hard-delete path for
-- exactly that correction, gated to board_admin only — one step stricter
-- than the is_board() (admin + member) gate on insert/update, matching the
-- board_admin-only delete convention already used for vendors, documents,
-- and the other board_writable tables in 0002.
-- ============================================================================

create policy unit_owners_delete on public.unit_owners
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));
