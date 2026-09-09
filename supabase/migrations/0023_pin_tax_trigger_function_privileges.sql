-- ============================================================================
-- Walkup — migration 0023: revoke public/anon execute on a new trigger function
--
-- tg_line_classification_association() (0022) is SECURITY DEFINER and returns
-- trigger, so it cannot actually be invoked outside of trigger context (Postgres
-- refuses that call at the SQL level) — but the security linter flags any
-- SECURITY DEFINER function with default privileges regardless of return type.
-- Matches the explicit revoke/grant already applied to every other new
-- function in 0022; closing it here rather than leaving avoidable linter noise.
-- ============================================================================

revoke all on function public.tg_line_classification_association() from public, anon;
grant execute on function public.tg_line_classification_association() to authenticated;
