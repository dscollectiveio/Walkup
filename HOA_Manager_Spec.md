# HOA Manager — Full Parameter Specification

**Version:** 1.0
**Status:** Pre-build. Slice 1 scoped.
**Owner:** Doug

---

## 0. One-line definition

A purpose-built accounting and compliance system for self-managed condominium associations of 2–6 units, whose annual output is a defensible tax filing and a clean handoff to the next board.

**Not** property management software. **Not** a general accounting package.

---

## 1. Audience parameters

| Parameter | Value |
|---|---|
| Primary user | Board member / officer of a self-managed association |
| User sophistication | No accounting or legal training assumed |
| Time available | Evenings, unpaid, alongside a full-time job |
| Building size (sweet spot) | 2–6 units |
| Building size (supported) | 2–20 units |
| Association type | Condominium associations, incorporated (typically non-profit) |
| Geographic scope | Multi-state at launch; verified depth in launch states only |
| Launch states (verified) | Illinois (primary), + 2–4 TBD |
| Product scope | Commercial product from day one |

### Entry triggers

1. **Board turnover** — a new officer inherits undocumented history
2. **Tax filing panic** — 1120-H is due and the financial record is incomplete

Both are continuity failures. Feature decisions should be tested against: *does this help the building survive a change of hands?*

---

## 2. Access model

Four roles. Enforced at the database layer, not the UI layer.

| Role | Scope | Notes |
|---|---|---|
| `board_admin` | Full read/write on their association | Peer role — multiple per association, no hierarchy |
| `board_member` | Full read, limited write | Cannot delete, cannot alter closed periods |
| `accountant` | Read financials + linked documents | Time-boxed access grant with expiry date |
| `owner` | Read-only: budgets, financial summaries, their own unit ledger, meeting minutes | Cannot see other owners' delinquency detail |
| `vendor` | No account | Tokenized single-purpose link scoped to one work order |

**Hard rules:**

- Every row in every table is scoped to an `association_id`
- Row-level security is mandatory, no exceptions, enforced in the database
- An owner must never be able to query another owner's balance
- Accountant grants expire by default (90 days) and are logged

---

## 3. Accounting parameters

### Basis — **modified cash** (single method, no toggle)

- Assessments are **accrued** — a charge is created when due, creating a receivable
- Expenses are recorded **when paid**
- Rationale: delinquency tracking and owner aging are impossible on pure cash basis; full accrual is more machinery than a 4-unit building needs

> This overrides the earlier "let the association choose" position. Dual-basis doubles every report, reconciliation, and tax form before there is evidence anyone wants the second option. Revisit only on real demand.

### Bookkeeping method — **double-entry**

Journal entries with balanced debit/credit lines. Non-negotiable — single-entry cannot produce a defensible return.

### Fund accounting — **required**

- Operating fund
- Reserve fund (restricted)
- Additional named funds supported (e.g. special assessment funds)
- Fund balances must be independently reportable; transfers between funds are explicit journal entries

### Expected volume (design target, not a limit)

- 80–150 transactions per year
- ~15–30 accounts
- 2–20 owner ledgers
- No payroll, no inventory, no COGS

### Required ledger capabilities

- Per-unit owner ledgers with assessment schedules
- Late fee rules and delinquency aging
- Operating vs. reserve fund separation
- Special assessments (one-off, allocable by ownership percentage)
- Budget vs. actual by category and by fund
- Vendor payment tracking with 1099-NEC flagging

### Ownership percentages

- Stored per unit, as exact decimals summing to 100%
- Effective-dated (ownership can change mid-year on sale)
- Used to allocate special assessments and to produce §22.1 resale figures

---

## 4. Tax parameters (Slice 1 output)

### Form 1120-H — IRC §528 election

| Parameter | Value |
|---|---|
| Election | Annual; made by filing the form |
| Due date | 15th day of the 4th month after fiscal year end |
| Extension | Form 7004 |
| Tax rate | 30% on non-exempt taxable income (condominium management associations) |
| Specific deduction | $100 |
| 60% test | ≥60% of gross income must be exempt function income |
| 90% test | ≥90% of expenditures must be for acquisition/construction/management/maintenance/care of association property |
| Private inurement | Prohibited |

**Implementation requirement:** every account and every transaction must carry:

- `is_exempt_function_income` (boolean, income accounts)
- `is_exempt_expenditure` (boolean, expense accounts)

Without these flags the 60% and 90% tests cannot be computed, and the form cannot be produced. This is the single most important domain detail in the schema.

**Typical non-exempt income:** interest on reserves, laundry income, common-area rental, vending, fees from non-members.

> **Rates and thresholds must not be hardcoded.** Store them in a dated `tax_parameters` table with a source citation, so an out-of-date figure is visible rather than silent.

### Form 1099-NEC

- Threshold: $600 per vendor per calendar year for services
- Requires W-9 on file (TIN, entity type, address)
- Corporations generally exempt — flag per vendor, do not infer
- Output: per-vendor totals + missing-W-9 exception report

---

## 5. Onboarding parameters

**Method:** AI extraction from uploaded prior-year documents (bank statements, prior returns, spreadsheets, ledgers).

**Non-negotiable guardrails:**

- Extraction **proposes**; the human **commits**
- Mandatory line-by-line review before anything enters the ledger
- Per-field confidence score surfaced in the review UI
- Source document permanently linked to every derived transaction
- Extracted-but-unreviewed data lives in a staging table, never in the ledger

**Rationale:** silent extraction errors in an accounting system are worse than manual entry, and trust does not recover once broken.

---

## 6. Compliance parameters

**Architecture:** state rules are **data, not code.**

Four rule categories genuinely vary by state for small associations:

1. Annual report filing (form, fee, deadline basis, filing URL)
2. Reserve funding requirements
3. Meeting and notice rules
4. Resale disclosure obligations

**Rules table requirements:**

- Full 50-state schema built at launch
- `verification_status`: `verified` | `unverified` | `stale`
- `verified_on` date and `source_url` on every row
- Unverified states surface a visible disclaimer in the UI
- Rules older than 12 months auto-flag as `stale`

**Deadline logic:** deadlines are computed from association-specific anchors (incorporation anniversary, fiscal year end), never fixed calendar dates.

**Illinois specifics (seed data):**

- Annual report: Form NFP 114.05, $10 fee, due before the first day of the incorporation anniversary month, filed at ilsos.gov
- Illinois Condominium Property Act §22.1 resale disclosure
- Chicago Condominium Ordinance (Municipal Code Ch. 13-72) where applicable
- Illinois AG charitable registration is a **separate** filing — must not be conflated with the annual report

---

## 7. Sequencing

| Slice | Contents | Status |
|---|---|---|
| **1** | Ledger + 1120-H output | **Build now** |
| 2 | AI document intake + document vault | Next |
| 3 | Owner read-only portal + accountant access | |
| 4 | Compliance calendar + state rules engine (launch states) | |
| 5 | Insurance, vendor directory, work orders, minutes, §22.1 packets, reserve studies | |

---

## 8. Technical parameters

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router), TypeScript |
| Database | Supabase (Postgres) |
| Auth | Supabase Auth |
| Authorization | Postgres row-level security |
| File storage | Supabase Storage |
| Hosting | Vercel |
| Styling | Tailwind CSS + shadcn/ui |
| AI extraction | Anthropic API (server-side only) |
| Money type | `NUMERIC(14,2)` — never floating point |
| Percentages | `NUMERIC(9,6)` |
| Dates | `DATE` for accounting dates, `TIMESTAMPTZ` for audit |
| Testing | Vitest (unit), Playwright (critical accounting flows) |

**Non-negotiables:**

- All money as integers or `NUMERIC` — never `float`
- No API keys in client code
- Every mutation to financial data writes an audit log row
- Closed fiscal periods are immutable; corrections are reversing entries, never edits

---

## 9. Open decisions

| # | Decision | Impact if deferred |
|---|---|---|
| 1 | Pricing model (flat annual / per-unit / tax-season paywall) | Determines whether seat counting and feature gating are needed from day one |
| 2 | Additional launch states beyond Illinois | Blocks Slice 4, not Slice 1 |
| 3 | Who maintains the 50-state rules table, and how often | Product liability risk if unresolved before Slice 4 |
| 4 | What gets cut | Nothing has been deprioritized; sequencing defers this, does not resolve it |

---

## 10. Required disclaimer posture

This product generates tax filings and surfaces legal deadlines. Before it produces anything a user relies on:

- Tax output must be reviewed by a CPA against current IRS instructions
- State compliance data must be verified against primary sources
- The UI must clearly state that the software does not provide tax or legal advice

Encoding the author's understanding of tax law into software without professional review is the primary product risk here, ahead of any technical concern.
