# PL2: Plaid fixes done by the lead engineer (2026-10-14), from PL1-plaid.md

Done (uncommitted, tests green):
- Gap 1: `/api/cron` added to `PUBLIC_PATHS` in `src/lib/supabase/proxy.ts`. The daily bank sync and
  `deprovision_stale_access` were being redirected to /login and never ran. Guard test:
  `tests/unit/proxy-public-paths.test.ts`.
- Gap 2: `plaidErrorLog()` in `src/lib/plaid.ts`; all Plaid error logging goes through it (balances, page
  auto-sync, sync, actions, cron). Tests in `tests/unit/plaid-errors.test.ts` include a grep guard.
  DOUG: check Vercel logs for old raw errors (they could contain PLAID-SECRET) and decide on rotating it.
- Gap 4: end-user disclosure on the Bank feed page and the Privacy Policy bank paragraph (data read, Plaid End
  User Privacy Policy link, how to disconnect, token kept encrypted).
- Gap 6 (partly): cron `maxDuration = 300`, per-connection try/catch so one failure doesn't stop the rest or
  deprovisioning. NOT done: page cap + cursor persistence per batch, dead-token handling.
- Gap 7: constant-time cron secret check; `server-only` import first.

Still to do (schedule later): gap 3 (webhook receiver; migration number must be 0057 or later now), gap 5
(published text/docs that disagree), gap 6 remainder, gaps 8-12, SDK 45 -> 48 upgrade.
