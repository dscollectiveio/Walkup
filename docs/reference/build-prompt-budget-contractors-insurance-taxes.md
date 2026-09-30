# Build prompt: Budget & spending, Contractors, Insurance, Taxes

Combined and adapted from four standalone prompts
(`walkup-budget-spending-prompt.md`, `walkup-contractors-prompt.md`,
`walkup-insurance-prompt.md`, `walkup-taxes-prompt.md`). Those were written
against a generic codebase. This version is rewritten against Walkup as it
actually exists on 2026-09-30, after a survey of every area they touch. Where
an original prompt and the codebase disagree, **the codebase wins** and the
conflict is recorded under "Adaptations" in each part.

Build order: Part 1 → 2 → 3 → 4. Taxes reads contractors and bills, and
Insurance links claims to repairs, so earlier parts are prerequisites.

---

## Global rules (apply to every part)

### How Walkup is built — use these, don't invent parallels

| The prompts say | In Walkup it is |
|---|---|
| building / association | `associations` (one per tenant; RLS by `association_id`) |
| repair | `tickets` (the Maintenance section, `/maintenance`). `/repairs` is a placeholder page |
| bill (paid) | `expenses` (written only via `record_expense`; the bank feed posts them) |
| bill (upcoming) | `recurring_bills` + the `upcoming_bills` view |
| contractor | `vendors` table. **UI always says "contractor"** |
| ledger category | `accounts` (expense/income accounts; the budget and bank feed already use them) |
| transactions | `bank_transactions` — the bank feed is the ledger's front door (DECISIONS #29) |
| notification / reminder system | none stored. Reminders are **derived** each render in `src/lib/home/reminders.ts` and shown in Home's "Coming up" |
| email sending | **none, by design.** Outbound mail = a stored draft + `mailto:` the board sends from its own mailbox (`contractor_messages` + `draft-panel.tsx`) |
| design tokens | `src/app/globals.css` — Avenir (Doug switched off Fraunces/Figtree), ink/mute/moss/brass/rust, good/bad/warning/info tints |
| charts | in-house SVG in `src/components/home/charts/*` (line, bar, donut). No chart library |
| exports | `exceljs` (xlsx) and `@react-pdf/renderer` (generated PDFs) are installed; Route Handler pattern in `src/app/financial-statements/export/*` |
| document extraction | Document Hub: `unpdf` text layer → Claude (`src/lib/documents/classify.ts`) → one fixed `extraction` jsonb; per-document confidence; review queue confirms category only |

### Engineering rules
- Supabase RLS is the only authorization. Every page/route does its own
  `createClient()` + role check; route handlers repeat the page's check.
- New tables: RLS on, policies explicit, audited via `tg_audit()` if they hold
  association data. New SECURITY DEFINER functions pin `search_path = ''`.
- Migrations are numbered from `0039`. Apply to dev/staging
  (`xhrivmdkrcfkhjyhkhye`) only. **Production is held** (Doug's call, 2026-09-30)
  — nothing goes to `oeqgtakyhtauldaebwcn` and nothing is pushed until he says so.
- Tests: pure logic in `tests/unit`, RLS/SQL in `tests/db` (PGlite harness,
  `asUser`). `tsc`, lint, full vitest, and `next build` green before each commit.
- Money: integer cents in logic (`toCents` for text-typed view columns).
- No new charting/table library. New dependency only where named below.
- Commit locally at the end of each part; do not push.

### Product rules (from all four prompts, kept verbatim in spirit)
- **Never fabricate.** No placeholder figures, sample records, guessed limits,
  invented brokers, invented URLs, or tax rules from memory. Blank beats wrong.
- **Plain language.** "Spent," "budgeted," "owed," "so far this year,"
  "contractor," "deductible," "renews on," "Ask your CPA." Never "variance,"
  "YTD," "accrual," "vendor," "marketplace."
- **Dollars first**, a percentage never without a dollar figure nearby.
- **Every number links to what's behind it.**
- **No advice, no ranking, no filing claims.**

### Gates
The original prompts stop at every phase for review. Replaced by: one upfront
decisions list (below), then build each part end to end, verify, commit
locally, and report at the end of each part. Anything that contradicts the
codebase or needs an unsourced rule is **left out and reported**, not guessed.

### Decisions (asked 2026-09-30, answered by Doug)
1. **Platform admin = Doug's account.** A `platform_admins` table (one row),
   checked by `is_platform_admin()` in the database. Only it can manage
   global records: official tax form templates and insurance broker partners.
2. **Google Places: build it, hidden until `GOOGLE_PLACES_KEY` exists.**
   Privacy policy lists Google as a service provider.
3. **Contractor reviews: board members only.** Owners' access is unchanged —
   they still can't read contractors.
4. **Income classification: pre-filled, board confirms once.** Seeded flags
   are suggestions; the 1120-H check is "Ask your CPA" until every income
   account with activity is confirmed. No schema constraint changes.

---

## Part 1 — Budget & spending

Rebuild `/budget` as **Budget & spending** (same route; nav label renamed;
stays in Money In & Money Out). One question: "Are we okay, and what's off?"

### Adaptations
- **Shared money math first.** None of Home's calculations are shared; move
  them into `src/lib/money/*` and have Home and this page both call it.
- **Fix a real bug while doing it:** Home's month-by-month in/out bars sum
  `monthly_cash_activity` across fund kinds, so a reserve transfer counts as
  money out *and* money in. Transfers (`journal_entries.source = 'transfer'`)
  are excluded from in/out and from spending; shown only as "Saved."
- **Categories = expense accounts.** No second category scheme.
- **Reserve contribution row** = transfers into the reserve fund in the period.
  There's no budget target for it in the schema; show the amount only, never an
  invented target.
- **Dues expected** = `assessment_charges` due in the period
  (`monthly_dues_collection.charged`). Late units = `charge_balances` open or
  partial with `days_overdue > 0`.
- **Upcoming bills** need a way in: add an "Add a bill" form (board;
  `recurring_bills` insert is already permitted by RLS).
- **Transactions table** = `bank_transactions`. Categorize in one interaction
  (menu of expense accounts → existing `categorizeBankTransaction` with post).
- Sidebar "needs a category" badge on Bank Sync & Transactions and on
  Budget & spending (layout already fetches the open-ticket badge count).

### Build
1. Header: title, association, fiscal year range, "synced …" from the latest
   `bank_connections.last_synced_at`; period switcher **This year** (fiscal,
   default) / **Last 12 months** / **This month** as URL params; Edit budget.
2. Forecast banner (≥3 full months of fiscal-year history, and a budget):
   "At this pace you'll end the year about $X over/under budget." + main
   driver + link. Left accent: rust over, moss under. Special-assessment
   sentence only when projected overage > operating cash + reserve; never an
   amount. Otherwise "Not enough history for a forecast yet."
3. Four stat cards: Cash on hand (operating only) + runway in months;
   Reserve fund + average monthly growth; Dues collected this month
   (collected/expected, late units linked to `/units/[id]`); Spent this month
   vs typical month (median of prior months, hidden under 3 months).
4. Budget vs spent: one row per budgeted expense account, pro-rated target
   (caption explains), status On track / Watch (≤10% over) / Over (>10%),
   bar capped at 100%, furthest-over row highlighted, row links to filtered
   transactions, Saved row for reserve, total row.
5. Where the money went: donut (≤6 slices + Other), legend $ and %, excludes
   reserve transfers (caption), slice → filtered transactions, prior-period
   comparison sentence when data exists.
6. Coming up in the next 30 days: `upcoming_bills`, "about" for estimates,
   contractor / insurance links, closing line (cash after bills + dues due).
   Empty: how bills get here + Add a bill.
7. Transactions: date, description, category, amount, action; filter by
   category incl. "Needs a category (N)"; search; xlsx export; needs-category
   rows first, tinted, one-click categorize; dues green; transfers shown;
   "Show earlier."
8. Empty states exactly as the original prompt (no budget → hide bars and
   forecast, offer last year's actuals as a labeled, confirm-to-apply
   suggestion; nothing uncategorized → "Everything is categorized.").

---

## Part 2 — Contractors

### Adaptations
- Table stays `vendors`; add columns rather than a new `contractors` table.
  Existing: name, trade (single text), phone, email, contact_name, address,
  notes, is_preferred, insured_until (= COI expiry), license_number,
  w9_on_file, w9_received_on, tin_last4, entity_type, is_1099_exempt,
  last_used_on.
- Add: `trades text[]` (backfilled from `trade`), `website_url`,
  `status` (`preferred`/`okay`/`do_not_use`, backfilled from `is_preferred`),
  `do_not_use_reason`, `board_rating` 1–5, `license_expires_on`,
  `source` (`manual`/`google`), `google_place_id` (unique per association),
  `google_rating`, `google_review_count`, `google_fetched_at`, `created_by`.
- **Repairs = tickets.** `tickets.assigned_vendor_id` and `tickets.expense_id`
  already exist but nothing writes them — add a contractor picker on the ticket
  detail page and "Find someone for this."
- **Bills already link:** `expenses.vendor_id` and `bank_transactions.vendor_id`
  (bank feed vendor picker). No `bills.contractor_id`. History and "total paid"
  come from `expenses`.
- `contractor_reviews` table (board-only unless Doug decides otherwise).
- Building address: add `street_address`, `postal_code`, `latitude`,
  `longitude` to `associations`, editable on Building Info; geocode server-side
  on save when a key exists.
- Google Places (New) Text Search + Place Details, server-only, key
  `GOOGLE_PLACES_KEY` documented in `.env.local.example`; **Find a contractor
  hidden entirely when the key is absent**. 24h cache table per
  (association, trade); log live calls. Field masks as in the original prompt.
- License lookup URLs: **left blank** unless verified — not guessed.
- Trade list: one config file, `src/lib/contractors/trades.ts`.

### Build
List (Your contractors / Find a contractor tabs; filters; sort preferred →
last used → name; empty state), add/edit (three required things, rest under
"More details"; do-not-use reason), detail page (`/contractors/[id]`: two
ratings never merged, paperwork chips, history from tickets + expenses, reviews,
notes), ticket picker + "Find someone for this", Find tab with all copy from
the original prompt, save-from-search deduped on `google_place_id`, 30-day
refresh.

---

## Part 3 — Insurance

### Adaptations
- `insurance_policies` exists (coverage enum: property, general_liability,
  umbrella, directors_officers, flood, workers_comp, other; carrier, broker,
  dates, premium, deductible, coverage_limit). **Extend it**, don't replace:
  add `named_insured`, `insured_address`, `payment_schedule`, agent fields,
  the limit and deductible columns from the original prompt, `coverage_form`,
  `renewal_reminder_days` (60), `last_reviewed_at/by`, `source_document_id`.
  Map the prompt's `master` → existing `property`.
- **Extraction reuses the Document Hub pipeline** but it must grow: add a
  per-category field schema in `classify.ts` for the `insurance` category
  (declarations fields, each with value, confidence, page, snippet). Text-layer
  PDFs only — scanned pages come back "skipped," and the UI says to enter by
  hand. Provenance stored per field in a new `insurance_policy_field_sources`.
- Review screen as specified; nothing saved to `insurance_policies` until
  "Save policy."
- Claims: new `insurance_claims`, optional `ticket_id` (the repair).
- Renewal reminder: derived in `reminders.ts` at `expires − renewal_reminder_days`.
- **Get quotes:** `insurance_partners` is global (platform-admin managed, ships
  **empty**). Requests go out as **mailto drafts** (no email service), tracked
  in `insurance_quote_requests`. Received quote PDFs go through the same
  extraction into the existing `insurance_quotes` (extended). Side-by-side
  comparison, "Not stated" for blanks, no ranking.
- Building characteristics for the request (year built, construction type,
  stories, roof year): add to `associations`, editable on Building Info.

---

## Part 4 — Taxes

### Adaptations
- A Tax Center already exists and is good: cash-basis 1120-H worksheet,
  `tax_parameters` with `source_url` + `verified_on` (all currently unverified,
  shown as Provisional), per-line overrides, provenance, filing lock, and a
  1099 candidate list. **Keep all of it.** Add the form-determination layer,
  official PDFs, and exports around it.
- **Thresholds stay in `tax_parameters`** (never literals). Remove the one
  hardcoded `600` fallback on the tax page.
- **1099 year bug:** `vendor_1099_totals` groups by fiscal year; 1099-NEC is
  calendar-year. Add a calendar-year view.
- **Classification:** per decision 4 — seeded flags become proposals; the
  board confirms each income account once (`accounts.tax_classification_confirmed_at`);
  1120-H determination is `ask_cpa` until every income account with activity
  is confirmed. Existing CHECK constraints and flag meanings are untouched.
- **Deadlines:** move the hardcoded 1120-H / 1099 / SOS deadlines in
  `reminders.ts` to rule strings stored on the form template (sourced, cited).
  Until a template carries a verified rule, the deadline shows as unverified.
- Determination as a pure function (`src/lib/tax/determine.ts`) with a plain
  reason on every output. IL-1120 and SOS annual report are `ask_cpa` until a
  human records the rule.
- **Official PDFs:** new dependency `pdf-lib` (AcroForm read/fill/flatten).
  `tax_form_templates` is global, managed by the platform admin, ships with
  **zero active templates**. Admin tool: fetch from irs.gov / tax.illinois.gov
  only, checksum, enumerate AcroForm field names, edit field map, verify,
  activate. Never redraw a form.
- Auto-fill with provenance into `tax_form_fields`; review; signable packet
  (filled + flattened + cover sheet) and CPA packet (editable PDF + xlsx) stored
  in the Document Hub. "Mark as filed" extends the existing lock.
- No e-filing language anywhere. Footer on every view.
