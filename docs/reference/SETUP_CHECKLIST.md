# Setup Checklist

Everything that has to exist before Claude Code writes a useful line.

---

## 1. Decide these first (30 minutes, saves weeks)

- [ ] **Accounting basis — confirm modified cash.** The spec assumes it. If you disagree, say so now; it's the hardest thing to change later.
- [ ] **Pricing model.** Flat annual is simplest and requires no seat counting. Per-unit requires unit verification. Tax-season paywall requires feature gating from day one. Pick one, even provisionally.
- [ ] **Product name and domain.** Needed for the Vercel project and Supabase project name.
- [ ] **Whether 2158 N. Damen is customer zero or a test fixture.** If it's real, its data goes in with real care and RLS must work before it's entered.

---

## 2. Accounts to create

- [ ] **GitHub** repo — private
- [ ] **Supabase** project — pick the region closest to your users, note the project ref
- [ ] **Vercel** project — link to the GitHub repo
- [ ] **Anthropic API** key — for Slice 2, but set up the billing now so it isn't a blocker later
- [ ] **Domain registrar** — if the name is decided

You already have Supabase and Vercel connected as MCP tools, which means Claude Code can provision and deploy directly rather than you clicking through dashboards.

---

## 3. Local environment

```bash
node -v      # 20 or higher
npm i -g supabase
supabase --version
```

- [ ] Node 20+
- [ ] Supabase CLI
- [ ] Claude Code installed and authenticated
- [ ] Git configured

---

## 4. Repo layout to start from

```
hoa-manager/
├── CLAUDE.md                     ← standing context, Claude Code reads every session
├── HOA_Manager_Spec.md           ← full parameters
├── README.md
├── .env.local.example
├── supabase/
│   ├── migrations/
│   │   └── 0001_initial.sql      ← schema.sql becomes this
│   └── seed.sql                  ← chart of accounts
├── src/
│   ├── app/
│   ├── components/
│   ├── lib/
│   │   ├── supabase/
│   │   ├── accounting/           ← pure functions, heavily tested
│   │   └── tax/                  ← 1120-H computation, heavily tested
│   └── types/
└── tests/
    ├── unit/
    └── e2e/
```

**Put `CLAUDE.md` and `HOA_Manager_Spec.md` in the repo root before the first Claude Code session.** They're what stop it from re-deciding things you've already settled.

---

## 5. Environment variables

```env
# .env.local.example — commit this, never .env.local

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Server only. Never expose to the client.
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
```

- [ ] `.env.local` in `.gitignore` before the first commit
- [ ] Service role key never imported into a client component
- [ ] Same variables set in Vercel project settings

---

## 6. Build order

1. Repo scaffold, Next.js + TypeScript + Tailwind + shadcn
2. Supabase project, migration 0001, typed client generation
3. Auth + memberships + **RLS policies with tests that prove isolation**
4. Association setup: units, ownership percentages, fiscal year
5. Chart of accounts + funds, seeded
6. Journal entries + lines, with the balance-enforcement trigger
7. Assessment schedules → charge generation → payments → allocations
8. Late fees + delinquency aging
9. Vendors + expenses + 1099 totals
10. Budgets + budget vs. actual
11. Reports: trial balance, balance sheet by fund, income statement, owner statement
12. 1120-H worksheet + tests
13. Deploy to Vercel

Steps 3 and 6 are where correctness is won or lost. Don't let them get rushed.

---

## 7. Before real data goes in

- [ ] RLS isolation test passes — an owner cannot read another owner's balance
- [ ] Unbalanced journal entry is rejected at the database level
- [ ] Closed period cannot be edited
- [ ] Audit log captures a mutation end to end
- [ ] A full year of test transactions produces a trial balance that actually balances

---

## 8. Before anyone files anything

- [ ] A CPA reviews the 1120-H computation against current-year IRS instructions
- [ ] `tax_parameters` values are verified and dated with source URLs
- [ ] The UI states plainly that this is not tax or legal advice
- [ ] Illinois annual report data verified against ilsos.gov
- [ ] Any unverified state is visibly labeled as such

This is the real risk in the product. The code being correct and the tax treatment being correct are different problems, and only one of them is solved by testing.

---

## 9. What to hand Claude Code first

1. The repo with `CLAUDE.md`, `HOA_Manager_Spec.md`, and `schema.sql` committed
2. `CLAUDE_CODE_PROMPT.md` as your opening message
3. Then stop and read its critique before letting it write code

The most valuable thing in that first exchange is the list of things it thinks are wrong with the schema.
