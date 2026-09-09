-- ============================================================================
-- Walkup — migration 0024: fix tax_figure_provenance.value's scale
--
-- 0022 declared `value numeric(14,2)`, sized for the money figures. Two of the
-- nine rows compute_and_save_tax_filing() writes are ratios that need 6
-- decimal places (test_60_pct_ratio, test_90_pct_ratio) — e.g. 0.929666
-- silently rounded to 0.93 on insert, a 3-point error in a number a board
-- member reads as "you're at 93%". Caught by hand in the browser, not by
-- tests/db/tax-center.test.ts, which only asserted the money figures.
--
-- numeric(14,6) covers both: money figures keep their two meaningful decimals
-- (trailing zeros are harmless), ratios keep their six. Both scales are
-- already on the project's allowed-scale list (tests/db/migrations.test.ts).
-- ============================================================================

alter table tax_figure_provenance alter column value type numeric(14,6);
