-- ============================================================================
-- Walkup — migration 0038: setup guide dismissal
--
-- The home page shows a board admin a section-by-section setup walkthrough
-- until every step is done. Every step is derived from real rows (units,
-- bank_connections, insurance_policies, …) — nothing here records progress.
-- The one thing that isn't derivable is "the admin chose to hide it", which
-- has to outlive the browser session and be shared by every admin, so it
-- lives on the association. Cleared (set back to null) only by hand; the
-- guide reappears if you do.
--
-- associations_update (0002) already restricts writes to board_admin.
-- ============================================================================

alter table public.associations
  add column setup_dismissed_at timestamptz;

comment on column public.associations.setup_dismissed_at is
  'When a board admin hid the home-page setup guide. Null = still shown while any step is open.';
