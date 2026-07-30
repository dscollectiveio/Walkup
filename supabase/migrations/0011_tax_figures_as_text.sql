-- ============================================================================
-- Walkup — migration 0011: return the 1120-H figures as text
--
-- PostgREST serializes a NUMERIC column to a JSON **number**, not a string.
-- JSON numbers are IEEE 754 doubles, so every money value the tax module read
-- had already passed through a float before any arithmetic happened — the
-- exact failure mode NUMERIC(14,2) exists to prevent (CLAUDE.md invariant 1).
--
-- node-postgres returns NUMERIC as a string, which is why this was invisible
-- until the app moved onto PostgREST. It surfaced as a crash rather than a
-- silent rounding error only because toCents() refuses anything that is not a
-- plain decimal string. Had it been more permissive, this would have been a
-- quiet loss of precision in a tax computation.
--
-- Returning text keeps the value exact all the way from Postgres to
-- toCents(), which parses it into integer cents without ever constructing a
-- float.
-- ============================================================================

drop function if exists public.form_1120h_figures(uuid, uuid);

create function public.form_1120h_figures(
  p_association_id uuid,
  p_fiscal_year_id uuid
)
returns table (
  exempt_income       text,
  nonexempt_income    text,
  gross_income        text,
  exempt_expenditures text,
  total_expenditures  text
)
language sql stable security invoker set search_path = ''
as $$
  select
    coalesce((select sum(amount) from public.cash_basis_receipts
               where association_id = p_association_id
                 and fiscal_year_id = p_fiscal_year_id
                 and is_exempt), 0)::numeric(14,2)::text,
    coalesce((select sum(amount) from public.cash_basis_receipts
               where association_id = p_association_id
                 and fiscal_year_id = p_fiscal_year_id
                 and not is_exempt), 0)::numeric(14,2)::text,
    coalesce((select sum(amount) from public.cash_basis_receipts
               where association_id = p_association_id
                 and fiscal_year_id = p_fiscal_year_id), 0)::numeric(14,2)::text,
    coalesce((select sum(amount) from public.cash_basis_disbursements
               where association_id = p_association_id
                 and fiscal_year_id = p_fiscal_year_id
                 and is_exempt), 0)::numeric(14,2)::text,
    coalesce((select sum(amount) from public.cash_basis_disbursements
               where association_id = p_association_id
                 and fiscal_year_id = p_fiscal_year_id), 0)::numeric(14,2)::text;
$$;

revoke all on function public.form_1120h_figures(uuid, uuid) from public, anon;
grant execute on function public.form_1120h_figures(uuid, uuid) to authenticated;
