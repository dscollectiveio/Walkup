-- ============================================================================
-- Walkup — migration 0043: pin privileges on the 0040–0042 trigger functions
--
-- Same fix as 0023 did for tg_line_classification_association. The three
-- "same association" guard triggers added for contractors, insurance and
-- taxes are SECURITY DEFINER, and Postgres grants EXECUTE on new functions to
-- PUBLIC by default — so the Supabase advisor flagged them as callable by the
-- anon role over /rest/v1/rpc. A trigger function called directly does
-- nothing useful, but nothing reachable without signing in should be
-- SECURITY DEFINER. Revoke from public and anon; keep authenticated, matching
-- 0023.
-- ============================================================================

revoke all on function public.tg_contractor_review_association() from public, anon;
grant execute on function public.tg_contractor_review_association() to authenticated;

revoke all on function public.tg_insurance_same_association() from public, anon;
grant execute on function public.tg_insurance_same_association() to authenticated;

revoke all on function public.tg_tax_form_same_association() from public, anon;
grant execute on function public.tg_tax_form_same_association() to authenticated;
