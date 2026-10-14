# Security test staging target

Purpose: a throwaway copy of Walkup for an authorized security test. Production
(`oeqgtakyhtauldaebwcn`) is never a test target.

## What it is
- Supabase branch `security-test`, ref `brwauxmdjgfrdqfbgezg`
  (https://brwauxmdjgfrdqfbgezg.supabase.co). Same schema as production plus
  migrations 0049 and 0050. No real data.
- Seed: two buildings (A and B), admin users for each, one owner in building A.
  Credentials are in `.env.staging-credentials.local` (gitignored). Share them
  with the tester over a private channel, not email threads or chat logs.
- Cost: the branch bills hourly while it exists. Delete it when the test ends.

## Rules of engagement (to confirm in writing before the test starts)
In scope: the staging app URL and the staging Supabase API for the branch above.
Out of bounds: production, the Supabase/Vercel/Plaid/Resend platforms themselves,
denial of service or load testing, phishing or social engineering of anyone,
and any real person's data. Stop and report immediately if real data or a
production system is reached.

## Wiring the staging app (Doug, Vercel)
Create a Preview deployment (branch `security-test` or a dedicated project) with:
- `NEXT_PUBLIC_SUPABASE_URL` = the branch URL above
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the branch's publishable key (Supabase dashboard, branch, API settings)
- `PLAID_ENV=sandbox` and sandbox Plaid keys only
- `BANK_TOKEN_KEY` = a new key, different from production
- Vercel Deployment Protection on, with a bypass token shared only with the tester
- No `DEV_AUTH_*` variables

## After the test
Triage findings, record accepted risks in `docs/SECURITY_POLICY.md`, delete the
Supabase branch, remove the Preview env vars, and rotate the bypass token.
