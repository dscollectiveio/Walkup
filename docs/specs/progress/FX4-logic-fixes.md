# FX4: fixes for REVIEW-4 (accounting and logic)

Source: `docs/security/REVIEW-4-logic.md`. Migrations 0051 to 0059 are applied nowhere, so every migration change below
is an in-place edit of the unreleased file. Finding numbers are the report's.

## Blocker

### 1. Unapplied cash never reached `cash_basis_receipts`
- Fixed in `supabase/migrations/0059_tax_views_net_reversals.sql` (no 0060; 0022 is the live view, 0059 redefines it).
- `cash_basis_receipts` has a third branch, `basis = 'unapplied'`: payment amount minus the part of its allocations that
  branch 1 turns into a row, dated at the payment, in the payment's fiscal year. Branches 1 and 3 always sum to the payment,
  so applying cash later only moves it between branches (no double count, nothing dropped).
- DECISION (documented in the migration header): the remainder is classified under the income account the unit's dues post to,
  because a prepayment or over-payment is a payment of dues (DECISIONS #1 prepayments are income in the year received, #3
  cash debits classified by the other leg). Order: income account of the unit's latest assessment-type charge, else of the
  association's latest assessment-type charge, else the lowest-code exempt-function income account, else the lowest-code
  income account. It follows that account's exempt flag and a per-line override on the payment's cash line. It is never
  silently exempt (the flag is the one the board confirmed in the Tax Center) and `basis = 'unapplied'` lets the Tax Center show it.
- Also hardened: an allocation to a charge with no ledger entry (the seed's charges) used to be dropped; it now counts as
  unapplied. A charge entry with two income lines no longer multiplies the allocation (one line per allocation).
- Tests: `tests/db/tax-views-reversals.test.ts` (16 cases): partial application (400 received, 150 applied = 400, the
  reviewer's case), no allocation at all, over-payment, fully applied (no unapplied row), applying later moves it between
  branches with the total fixed, allocation to a charge without an entry, reversed payment and its re-reversal, waived and
  written-off charges (only cash collected counts), non-exempt dues account stays non-exempt, fallback with no charges,
  and a mixed scenario asserting `gross_income` equals total cash debits.

## Major

### 3. Reversal of a reversal (done before 2, same migration)
- Fixed in the views (0059), not by refusing in `reverse_journal_entry` (0036 is live, rows may exist, and the ledger already
  nets correctly; the tax figures must follow the ledger whatever is posted). An original entry counts only if the chain of
  posted reversals hanging off it has even length (recursive count in all four view branches); reversal entries are skipped.
  Reversing a reversal therefore restores the original in every figure; a third reversal removes it again.
- Tests: same file, "reversing a reversal puts the original back" (income and spending, plus ledger net) and "chains of any depth".

### 2. Import double-counts entries already in the books
- `supabase/migrations/0056_imports.sql` `import_validate`: a transactions row is an error `already_in_books` when the books hold
  at least as many live matching entries as this row's occurrence number (same date, same amount and direction on the chosen cash
  account, posted, not undone; undone is judged by the same even/odd reversal chain), or `already_in_bank_feed` for an unposted,
  not excluded bank-feed transaction with the same date and amount. Rows already imported before (same row hash) stay
  "duplicate" as before; a real Nth identical payment is still allowed (test 19 unchanged). Override: `mapped.confirmed_separate = 'true'`
  through `import_update_row`, wired to a "This is a separate transaction" button in `src/app/building/import/[batchId]/fix-table.tsx`
  (one allowed key in `fixImportRow`, `src/app/building/import/actions.ts`) and headings in `src/lib/import/messages.ts`.
- Tests: `tests/db/imports.test.ts` 19b (flagged, skip keeps the 1120-H spending at 530 not 980, separate flag lets it through),
  19c (different amount or date or direction is not a match; undone entry does not count; re-reversal counts again),
  19d (bank feed).

### 4. Insurance dismissal key
- `supabase/migrations/0052_insurance_v2.sql`: `insurance_finding_dismissals.finding_key text not null default ''`, in the unique index.
  `src/lib/insurance/coverage-check.ts`: `dismissalFor()` matches rule, policy and finding id (`''` = whole rule, for hand rows);
  `queries.ts`, `tabs/check.tsx`, `components/finding-card.tsx` and `check-actions.ts` carry and validate the key (must be the rule id or `RULE:suffix`).
- Tests: unit "dismissing one DOC-REQ-01 finding leaves the others open"; db unique-index test (two keys fine, same key twice refused).

### 5. Dues reminders on the net figure
- ONE rule (net, as owner-portal spec 1.3 says): owed and overdue are reduced by payments not yet applied, never below zero.
- `0055_email_reminders.sql`: `email_prepare_batch` keeps a unit on `overdue - credit > 0`; `email_run_rules` uses `owed_n`/`overdue_n`
  net for `min_amount`, the overdue branch and the upcoming branch; `email_facts_current` also compares `credit`.
- `src/lib/email-outbox/templates/dues-reminder.ts` (`netOwed`, `netOverdue`; subject, intro, total across units and past-due
  sentence on the net; rows show total of open charges, the unapplied payment, and the balance), `late-fee-notice.ts` (balance after the payment).
- Portal: `src/lib/owner/standing.ts` standing, headline and detail on the same net figure (ahead = credit minus owed).
- Specs: `docs/specs/owner-portal-spec.md` (standing rules and the `moneyAnswer` table rows) and `docs/specs/money-and-reminders-spec.md`
  (prepare, facts check, rule SQL, rules paragraph, email subject and body) now say net.
- Tests: db "the net rule" describe (4 cases: prepare, facts, stale after approval, rule minimum on net); `email-templates` unit (net subject, rows,
  total, late fee, helpers); `owner-standing` unit.

## Minor
- 6 percent tolerance: `0056` `v_pct_total <> 100`. Test: thirds to six places gives `percent_sum`, total `99.999999` (imports test 29).
- 7 repeat interval: `0055` compares Chicago dates (`created_at at time zone 'America/Chicago'` date) for both the repeat and the oldest-overdue checks;
  the Collections preview already used `>=`, so it now agrees. Test 32b (6 days waits, 7 days sends, UTC/Chicago boundary).
- 8 hourly cap: `0055` leaves the row `queued` with `not_before = now() + 10 minutes` and stops the claim loop. Test 28 rewritten.
- 9 upkeep log cost: `0053` `close_out_ticket` updates the log row's cost on a later close. Test `tickets-v2` 19 (250 then 200).
- 10 year cut: `src/lib/repairs/today.ts` uses the Chicago year. Test in `repairs-today.test.ts`.
- 11 "Same": `src/lib/insurance/compare.ts` only when equal; 0.4% shows `+0.4%`, tiny shows `+<0.1%`. Test in `insurance-compare.test.ts`.
- 12 calendar SEQUENCE: `ics.ts` and `repairs/calendar/route.ts` use `updated_at`. Test: editing moves SEQUENCE.
- 13 declarations: unknown scale words ("$1.5 billion", "$2 bn") are null; cap is 12 whole digits in strict and loose paths
  (an existing test had pinned 14 digits and was corrected).
- 14 bill drift: `0053` trigger `recurring_bills_03_due_day` sets `due_day` from the date when blank (on update, from the pre-update date).
  Test `bills-v2` 1b (31 Jan: 28 Feb, 31 Mar, 30 Apr, 31 May).
- 15 defensive: ranking (`distanceTerm` clamps and handles NaN; `bayesianRating` ignores non-finite counts, clamps 1 to 5, and a rating with zero reviews is unrated),
  compliance and `statusFor` (unreadable date is a problem / overdue), `nextDueAfter(NaN)`, IL-FID-01 on NaN, `toCents` (safe integers, `-0.00`). Unit tests added in each file.
- 16 money glue: a space only separates thousands (`1 234`, `1 234 567.89`); `12 34`, `100 2000` refused.
- 17 copy: "The current Master policy with ..." (no doubled word; flood reads "Flood policy").

## Tests that were weak (section D)
D1 digest assertion (unchanged by skipping error rows; changes when the ok row is skipped), D2 svix (openssl vector, wrong order and wrong key rejected),
D3 console test (each failure path run alone; mutation printing the address now fails), D4 `big.ok` asserted, D5 max-duration (explicit table, existence
asserted, unlisted reaching pages fail; two pages missing from the table added), D6 integrity-guards message, D7 lock tests pin the order in the function
body (renamed from "has the lock"), D8 email-reminders 15 (real batch ids), D9 tickets 250 then 200, D10 tax-views `keep`, D11 added the missing cases,
D12 forecast months 2 and 3 pinned, `skipIf` removed in `insurance-v2.test.ts`.
Scratch file `tz.test.ts` deleted; its assertion is `tests/unit/upkeep-schedule.test.ts` "daysUntil is exact across daylight saving".

## Not fixed or partly fixed
- Collections page and its rule preview (`src/lib/collections/build.ts`, `rule-preview.ts`) still list units on gross charge balances; they need the unit's unapplied credit loaded. The SQL decides who is emailed, so nothing wrong is sent, but the preview can name a unit the net rule will skip.
- The "dues upcoming" email still lists charge amounts gross (it is a heads-up about a charge, not a balance); its selection is net.
- "100 200" in an import money cell still reads as 100,200 (the reviewer's own regex accepts it; the shape is genuinely ambiguous).
- Skipped by design: refusing reversal-of-reversal in `reverse_journal_entry` (finding 3's sketch), see above.
- Not run: the full vitest suite (the lead runs it).
