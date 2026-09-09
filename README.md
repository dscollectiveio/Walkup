# Walkup

Accounting and compliance software for self-managed condominium associations of
2–6 units. Its annual output is a defensible Form 1120-H and a clean handoff to
the next board.

Not property management software. Not a general accounting package.

## Status

Well past scaffold: ledger, 1120-H, document hub, tax center, bank feed (Plaid,
read-only), and MFA are built and tested. See `docs/DECISIONS.md` for what
shipped and why.

| | |
|---|---|
| Schema | `supabase/migrations/0001`–`0026`, applied and tested (`tests/db/`) |
| Supabase project (dev/staging) | created — see `.env.local` |
| Supabase project (production) | see `docs/DECISIONS.md` #27 for the split rationale |
| GitHub remote | `dscollectiveio/Walkup` |
| Vercel project | see `docs/DECISIONS.md` #27 |

Every migration after `0001` is paired with the test that proves its
enforcement — the balance trigger, posting and period immutability, the audit
trigger, every RLS policy, and (since `0025`) mandatory MFA on every
role-scoped query. Nothing bypasses RLS: there is no service-role client
anywhere in this codebase, deliberately (`docs/DECISIONS.md` #18).

## Documents

| File | What it is |
|---|---|
| `CLAUDE.md` | Standing context. Invariants. Read first. |
| `docs/DECISIONS.md` | Settled decisions with reasoning. **Wins over the spec.** |
| `HOA_Manager_Spec.md` | Original full specification, preserved unedited |
| `docs/reference/` | Original schema draft, setup checklist, opening prompt |

## Getting started

Requires Node 20+ (developed on 24).

```bash
npm install
```

```bash
npm run dev
```

The Supabase CLI is a dev dependency — use `npx supabase`, no global install.

## Layout

```
supabase/migrations/   versioned schema; never edit the database by hand
src/lib/supabase/      typed clients (browser, server) — no service-role client
src/lib/tax/           1120-H computation
src/lib/documents/     document hub: extraction, classification, redaction
tests/db/              Vitest against PGlite — schema, RLS, RPCs, run the real migrations
tests/unit/            Vitest — pure functions (tax math, redaction)
tests/e2e/             Playwright — currently empty
```

`src/lib/tax` is pure and heavily tested; it does not touch the database.

## Two things that will bite you

**Ledger writes never go through the REST client.** Journal entry balance is a
`DEFERRED` constraint trigger, and PostgREST runs every request in its own
transaction — an entry inserted separately from its lines commits alone and
unbalanced. Everything goes through `post_journal_entry(header, lines[])`.

**The tax module never reads the income statement.** The books accrue
assessments; the return is filed on the cash method. Both 1120-H tests are
computed from movements across cash accounts, classified by the opposite leg of
the entry. See `docs/DECISIONS.md` #1 and #3.

## Before anyone files anything

- [ ] A CPA reviews the cash-method treatment and the 60%/90% computations
- [ ] `tax_parameters` values verified, dated, with source URLs
- [ ] The UI states plainly that this is not tax or legal advice
- [ ] Illinois annual report data verified against ilsos.gov

The code being correct and the tax treatment being correct are different
problems, and only one of them is solved by testing.
