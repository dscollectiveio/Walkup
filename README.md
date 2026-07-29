# Walkup

Accounting and compliance software for self-managed condominium associations of
2–6 units. Its annual output is a defensible Form 1120-H and a clean handoff to
the next board.

Not property management software. Not a general accounting package.

## Status

**Slice 1 — ledger + 1120-H. Scaffold only.** No application code, no database.

| | |
|---|---|
| Schema | `supabase/migrations/0001_core_schema.sql`, **not applied and not yet syntax-checked** |
| Supabase project | not created |
| GitHub remote | none |
| Vercel project | none |

`0001` creates tables with **no enforcement** — the balance trigger, posting and
period immutability, the audit trigger and every RLS policy land in `0002`–`0004`,
each paired with the test that proves it. The manifest at the bottom of `0001`
lists them. Nothing real goes in this database until they are green.

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
src/lib/supabase/      typed clients (browser, server, service-role)
src/lib/accounting/    pure functions — aging, allocation, balances
src/lib/tax/           1120-H computation
tests/unit/            Vitest — accounting and tax logic
tests/e2e/             Playwright — critical accounting flows
```

`src/lib/accounting` and `src/lib/tax` are pure and heavily tested. They do not
touch the database.

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
