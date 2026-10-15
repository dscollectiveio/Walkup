# REVIEW 4: accounting and logic review of the new money and date paths

Reviewer: read-only logic review, 2026-10-14. Nothing in the repository was changed except this file.
Method: every finding below was reproduced with a scratch script outside the repo
(`/private/tmp/claude-501/-Users-dougsmart-Desktop-Claude-Code/1b96944a-acd7-43cd-9ccd-ed28497e667d/scratchpad/review-d/*.test.ts`,
run with `./run.sh <file>`; they import repo modules by path and boot the repo's PGlite harness with every migration applied).
The test-quality section (section D) is from reading, not from running mutations; that is stated per item.

Scope read: DECISIONS #1 to #3, #7, #9, #14, #20, #29, #39, #40; `docs/specs/insurance-repairs-overhaul.md`, import, money-and-reminders and owner-portal specs;
`src/lib/{upkeep,contractors,insurance,import,email-outbox,repairs,money,statements,owner,collections}`; migrations 0053 to 0059.

Severity key. **Blocker**: a normal action produces a wrong tax figure or wrong money with no warning.
**Major**: wrong or misleading result on a plausible path, or a rule the spec states and the code does not keep.
**Minor**: wrong at an edge, cosmetic, or defensive.

## Summary

| # | Sev | One line |
|---|-----|----------|
| 1 | Blocker | Cash received but not applied to a charge never reaches `cash_basis_receipts`, so Form 1120-H income and the 60% test are understated (pre-existing, unchanged by 0059) |
| 2 | Major | A transactions import can duplicate entries already in the books (bank feed or typed): no overlap check, 90% test numerator and denominator doubled |
| 3 | Major | `reverse_journal_entry` accepts a reversal; 0059 then drops both sides from the tax views while the ledger nets back to the original |
| 4 | Major | One dismissal of "your declaration requires X" (DOC-REQ-01) dismisses it for every coverage |
| 5 | Major | Dues reminders are chosen and totalled on gross `owed`, not net; an owner whose payment is simply unapplied is dunned for money the statement shows as paid |
| 6 | Minor | Ownership percent check tolerates 1e-6, so 33.333333 x 3 previews clean and then fails at commit |
| 7 | Minor | `repeat_every_days` is effectively one day longer than stated; Collections preview says the opposite |
| 8 | Minor | Hourly platform cap turns a transient limit into a permanent `skipped` |
| 9 | Minor | Close-out never updates the upkeep log cost after the first close, so history and ticket disagree |
| 10 | Minor | "Recorded repair costs this year" cuts the year at UTC, not Chicago |
| 11 | Minor | Insurance compare labels a premium up to 0.5% different as "Same" |
| 12 | Minor | Calendar SEQUENCE for policy events never advances after an edit |
| 13 | Minor | Declarations money parsers: "$1.5 billion" reads as $1.50; no cap at numeric(14,2) on the strict path |
| 14 | Minor | Recurring bills without a due day drift to the 28th for good after a month-end |
| 15 | Minor | Defensive gaps: NaN/negative inputs in ranking, rule inputs, dates, `toCents` |
| 16 | Minor | `normalizeMoney` glues two numbers separated by a space ("100 200" becomes 100200.00) |
| 17 | Minor | Copy: "The current Master policy policy with ..." in the calendar file |

No blocker or major finding in: upkeep date maths, ICS output, contractor ranking and compliance thresholds, premium instalments, change percent,
duplicates detection, statement totals across the three code paths, send caps and warm-up, bill dates, money helpers. See section C.

---

## A. Blocker

### 1. Unapplied cash never counts as a receipt (60% test and Form 1120-H income understated)

- Where: `supabase/migrations/0059_tax_views_net_reversals.sql:35` (the `assessment` branch joins `payment_allocations`, so only the allocated part of a payment is seen); same shape in `0022_tax_center_classification_and_provenance.sql:112-131`. The `direct` branch needs an income-credited line, which a payment (cash debit, receivable credit) does not have. `0001_core_schema.sql:413-416` and DECISIONS #1 say the unallocated remainder "is taxable income in the year received". Nothing implements that. `grep -i unapplied|unallocated` across the tax migrations and `src/lib/tax` returns nothing.
- Input: unit pays 400.00 on 2026-02-11 against a single 150.00 charge (`record_payment` allows this by design, 0015:45-52). Same shape as 100.00 over-paid, or a prepayment.
- Expected: `form_1120h_figures` exempt income 400.00 (cash actually received, DECISIONS #1 and #3: "debits to cash accounts").
- Actual (scratch run `importtax.test.ts`, then `fix.test.ts`):
  - Ledger cash received in 2026: 1150.00. `form_1120h_figures`: `exempt_income 900.00, gross_income 900.00`. The missing 250.00 is exactly the unapplied remainder.
  - Minimal case: 400 received, 150 applied gives `exempt_income 150.00`.
- Why it matters here: the owner portal, the dues emails and the statement code all treat "payment not yet applied" as a normal state (`unit_position_core.credit`), so this is the common path, not an edge. The ratio moves and failing the 60% test forfeits the election (DECISIONS #1).
- Fix (needs one decision from Doug: which income account the remainder is classified under; this proposal uses the unit's latest assessment-charge income account, which is the account that unit's dues already post to). Add a third branch to `cash_basis_receipts` in a new migration `0060`:

```sql
union all
select p.association_id, e.fiscal_year_id, p.received_on, inc.id, inc.code, inc.name,
       coalesce(ovr.is_exempt, inc.is_exempt_function_income),
       (p.amount - coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.payment_id = p.id), 0))::numeric(14,2),
       'unapplied'::text, cl.id
  from public.payments p
  join public.journal_entries e on e.id = p.journal_entry_id
  join public.journal_lines cl on cl.journal_entry_id = e.id and cl.debit > 0
  join public.accounts ca on ca.id = cl.account_id and ca.is_cash_account
  join lateral (select l2.account_id from public.assessment_charges c2
                  join public.journal_lines l2 on l2.journal_entry_id = c2.journal_entry_id and l2.credit > 0
                  join public.accounts a2 on a2.id = l2.account_id and a2.type = 'income'
                 where c2.unit_id = p.unit_id and c2.charge_type = 'assessment'
                 order by c2.due_on desc limit 1) li on true
  join public.accounts inc on inc.id = li.account_id
  left join public.tax_line_classifications ovr on ovr.journal_line_id = cl.id
 where e.is_posted and e.reverses_entry_id is null
   and not exists (select 1 from public.journal_entries r where r.reverses_entry_id = e.id and r.is_posted)
   and p.amount - coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.payment_id = p.id), 0) > 0
```

  Verified in a scratch database: the same 400.00 / 150.00 case moves from `exempt_income 150.00` to `400.00`, and a later allocation only moves money from this branch to the `assessment` branch (the two always sum to `p.amount`, so no double count). A unit with no prior assessment charge needs a fallback (refuse an unapplied remainder, or take an account from the payment form).
- Add a test: `tests/db/tax-views-reversals.test.ts` has no case with a partial allocation; add "payment 400 allocated 150 gives exempt_income 400.00".

---

## B. Major

### 2. Transactions import is not checked against entries already in the books

- Where: `supabase/migrations/0056_imports.sql:759-763` (duplicate test compares only to earlier committed `import_rows` with the same `row_hash`); `before_opening` (0056 near line 760) only protects dates on or before an opening balance. Spec text: import-spec "importing 2026 transactions is welcome" next to the bank feed (#29).
- Input: a 450.00 repair on 2026-03-03 is already in the ledger (typed by hand, or posted from the bank feed); the board imports last year's spreadsheet which contains the same row.
- Expected: preview marks it a duplicate or asks.
- Actual (scratch `import2.test.ts`): preview `counts {"ok":1,"duplicates":0}`, `batch_errors []`; after commit `form_1120h_figures` shows `exempt_expenditures 900.00, total_expenditures 900.00` for a 450.00 job. The same applies to deposits: the `direct` branch counts both entries as receipts.
- Fix: in `import_validate` for `kind = 'transactions'`, after the account checks, flag a row `duplicate` (or an error with code `possible_duplicate`, overridable per row by `decision`) when a posted, unreversed entry in the association has a cash-account line with the same `entry_date` and amount, or a `bank_transactions` row (posted or pending) has the same `posted_on` and signed amount. Sketch:

```sql
if b.kind = 'transactions' and v_date is not null and v_amt is not null and exists (
     select 1 from public.journal_entries je
       join public.journal_lines l on l.journal_entry_id = je.id
       join public.accounts a on a.id = l.account_id and a.is_cash_account
      where je.association_id = b.association_id and je.is_posted and je.entry_date = v_date
        and je.reverses_entry_id is null
        and not exists (select 1 from public.journal_entries r where r.reverses_entry_id = je.id and r.is_posted)
        and ((v_amt > 0 and l.debit = v_amt) or (v_amt < 0 and l.credit = -v_amt))) then
  errs := public.import_err(errs, 'amount', 'already_in_books',
    'A transaction for this date and amount is already in your books. Skip this row unless it is a second one.');
end if;
```

  Add a db test in `tests/db/imports.test.ts` that record_expense(450, 2026-03-03) then importing the same row yields `errors: 1`.

### 3. A reversal can be reversed; the tax views then lose the income while the ledger gets it back

- Where: `supabase/migrations/0036_bank_feed_posting_functions.sql:225-270` (`reverse_journal_entry` only refuses an entry that "has already been reversed", line 245; it never refuses a reversal) combined with `0059...:44,73,102` (`e.reverses_entry_id is null` skips every reversal, including the second).
- Input: post a 300.00 deposit to 4000, `reverse_journal_entry(entry)` returns R1, then `reverse_journal_entry(R1)` (any board member can call the RPC).
- Expected: ledger credit to 4000 on that date is 300.00 again, and the tax figure includes 300.00 again.
- Actual (scratch `importtax.test.ts`): ledger net credit to 4000 on 2026-03-02 is `300.00`; `form_1120h_figures` is `exempt_income 900.00` before and after the second reversal (should be 1200.00 after). The original and both reversals are all skipped.
- Fix (smallest): refuse it in the function, new migration:

```sql
-- inside public.reverse_journal_entry, after the "not posted" check:
if e.reverses_entry_id is not null then
  raise exception 'a reversal cannot itself be reversed; post the entry again instead' using errcode = '22023';
end if;
```

  Verified in a scratch database (a trigger with the same condition raises `a reversal cannot itself be reversed`). Add the case to `tests/db/tax-views-reversals.test.ts`.

### 4. Dismissing one DOC-REQ-01 finding dismisses them all

- Where: `src/lib/insurance/coverage-check.ts:822` matches a dismissal on `ruleId` plus `policyId` only; DOC-REQ-01 findings all have `policyId = null` and differ by `idSuffix` (`:449`, id `DOC-REQ-01:<coverage>`). The table key is the same pair: `supabase/migrations/0052_insurance_v2.sql:489-490` (unique on association, rule_id, policy_id).
- Input: declaration requires flood and earthquake, neither on file; the board dismisses "Your declaration requires flood coverage".
- Expected: earthquake stays open. Actual (scratch `insurance.test.ts`): `DOC-REQ-01:flood dismissed=true` and `DOC-REQ-01:earthquake dismissed=true`, and both leave the counts.
- Fix: add `finding_key text not null default ''` to `insurance_finding_dismissals`, include it in the unique index (`coalesce(policy_id, zero-uuid), finding_key`), store `f.id` (or the `idSuffix`) when dismissing, and match `x.findingKey === f.id` (keep `ruleId`+`policyId` as the fallback for old rows where `finding_key = ''` and the rule emits one finding). Add a unit test in `tests/unit/insurance-coverage-check.test.ts`: two required lines missing, dismiss one.

### 5. Dues reminders use gross `owed`; owners whose payment is unapplied are told they owe it

- Where: `supabase/migrations/0055_email_reminders.sql:724` (`email_prepare_batch` keeps a unit when `overdue > 0`), `:1087-1099` (`email_run_rules`, `owed_n >= min_amount` and the overdue branch, same blindness), `:422` (`email_facts_current` compares `owed` and `overdue` but not `credit`), `src/lib/email-outbox/templates/dues-reminder.ts` (subject, total, "is past due"). The owner-portal spec rule 2 (`owner-portal-spec.md:91`) and the `0054` header say the net figure is "one rule everywhere"; the statement code does follow it, the reminder code does not. (Both specs also contain the gross copy, `owner-portal-spec.md:1318` and `money-and-reminders-spec.md:936`, so this is a spec contradiction to settle, not only a code slip.)
- Input: unit with one 500.00 charge due 2026-01-01 and a 500.00 payment recorded but not allocated.
- Expected: `net 0.00`, no reminder (the statement's last line says "Paid up").
- Actual (scratch `email.test.ts`): `unit_position_core` gives `owed 500.00, overdue 500.00, credit 500.00, net 0.00`; `email_prepare_batch` creates a draft; the rendered email reads "Dues reminder: Unit 2 has a balance of $500.00 ... $500.00 of this is past due ... a payment of $500.00 ... has not been applied". The full email statement for a richer unit (partial payments, a waived charge, a written-off charge with a part payment, a credit) ends at `400.00` in all of: `unit_position_core.net`, `email_statement_facts.closing`, `unit_statement_core` last balance and the PDF `totalsOf` closing, but the dues email for that unit headlines `$550.00`.
- Fix: in `email_prepare_batch` and `email_run_rules` use `greatest((facts->>'overdue')::numeric - (facts->>'credit')::numeric, 0) > 0` (and `greatest(owed - credit, 0) >= min_amount`); add `cur ->> 'credit' is distinct from u ->> 'credit'` to `email_facts_current`; in the template, when `credit > 0` show "Balance after your unapplied payment" using `net` (the facts already carry `net`). Update the two spec lines. Add a db test "an owner whose unapplied payment covers the overdue amount is not prepared".

---

## C. Minor

6. **Ownership percent tolerance.** `0056_imports.sql:827` `abs(v_pct_total - 100) > 0.000001`. Input: three units at `33.333333`. Preview: `batch_errors []`, `percent_total 99.999999`. Commit: `ownership amendment ... allocates %99.999999, not 100%` (transaction rolls back; raw DB text shown). Fix: `<> 100` (the amendment demands exactly 100), keep the message `percent_sum`.
7. **Reminder repeat interval is +1 day.** `0055_email_reminders.sql:1099` compares `created_at` to `(p_today - repeat_every_days)::timestamptz` (midnight UTC). Input: rule `repeat_every_days = 7`, previous batch created 7 calendar days ago at 14:00 UTC. Expected: eligible today. Actual (scratch `email.test.ts`): `queued: []` today; eligible after 8 days. Related: `created_at::date >= d.oldest` (`:1094`) compares a UTC date to a Chicago date. Fix: `(ob.created_at at time zone 'America/Chicago')::date > p_today - rl.repeat_every_days` and the same conversion at `:1094`. `src/lib/collections/rule-preview.ts:55` uses `>= repeatEveryDays`, so the preview names a unit one day before the rule will email it; the comment says SQL wins, so this is only a mismatch to fix with the same boundary.
8. **Hourly platform cap is terminal.** `0055:958` marks the row `skipped` with `platform_cap` (exact boundary is right: 299 in the last hour lets the next claim through, 300 skips it; scratch `caps.test.ts`). The skipped row is gone for good although the copy says "try again later" (`reasons.ts`). Fix: on `platform_cap` leave the row `queued` with `not_before = now() + interval '10 minutes'` and stop the claim loop for this call.
9. **Close-out leaves a stale log cost.** `0053_repairs_v2.sql:2596` writes the upkeep log only when none exists. Input: close with 500, reopen, close with 450. Expected: log 450. Actual: `ticket_cost 450.00, log_cost 500.00` (scratch `repairs.test.ts`); the task page prints "$500 in all". `tests/db/tickets-v2.test.ts:19` closes twice with the same cost, so it cannot see this. Fix: after the `not exists` branch add `update public.upkeep_log set cost = round(p_actual_cost, 2) where ticket_id = p_ticket_id`.
10. **Year cut in UTC.** `src/lib/repairs/today.ts:346` uses `resolved_at.slice(0, 4)`. Input: resolved 2026-12-31 20:00 Chicago (`2027-01-01T02:00:00Z`); in 2026 it counts 0, in 2027 it counts 100.00 (scratch). Fix: format the instant with `Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" })` before taking the year, or compare to `buildingTodayIso`-based range.
11. **"Same" hides a real premium change.** `src/lib/insurance/compare.ts:91` returns `same` when the rounded whole percent is 0. Input: now 10,000.00, quote 10,040.00. Actual: chip "Same", aria "same as now", per-unit row also "same" (139.44 vs 138.89). Fix: only return `same` when `a === b`; otherwise show one decimal ("+0.4%") or `premium_up` with `pct: "0.4"`.
12. **Calendar SEQUENCE for policies.** `src/lib/upkeep/ics.ts:88` uses `created_at`; `route.ts:50` selects `created_at`. `insurance_policies.updated_at` exists since `0052_insurance_v2.sql:189`, so the comment at `ics.ts:81-82` is stale. Editing the end date keeps the same UID and SEQUENCE, so a calendar can ignore the re-import. Fix: select `updated_at` and use `sequenceFrom(p.updated_at)`.
13. **Declarations money.** `src/lib/insurance/declarations.ts:107-111`: `parseMoneyLoose("$1.5 billion")` returns `1.50` (scratch: strict null, loose `1.50`) because an unknown word after a space passes the lookahead; shown as a suggestion only, but "Use this" fills $1.50. `:136` caps at `9999999999999999` cents (14 integer digits) while the column is `numeric(14,2)` (12 integer digits); `parseMoneyText` (`:100`) has no cap, so `1000000000000.00` is accepted as an auto-fill value and fails at save. Fix: after the unit group require `(?:\s|$|[.,;])` and reject remaining letters (`/[a-z]/i.test(rest)`), and cap at `99999999999999` cents (12 digits plus 2) in both paths.
14. **Bill day drift.** `src/lib/upkeep/bills.ts:18` (and SQL `bill_next_due`, 0053:2109) chain from the previous due date. First due 2026-01-31, monthly, no due day: `2026-01-31 2026-02-28 2026-03-28 2026-04-28 ...` forever (scratch `bills.test.ts`; TS and SQL agree on 224 cases). Fix: when `due_day` is null derive the target day from the bill's original anchor (store `anchor_day`), or default `due_day` to the day of the first due date on insert.
15. **Defensive gaps (all reproduced).**
    - `ranking.ts:95` `distanceTerm`: `distanceMiles = NaN` gives score `NaN` (sorts unpredictably); `-5` gives 57.5 where the cap for the term is 15. Clamp with `Math.min(1, Math.max(0, ...))` and treat non-finite as unknown.
    - `ranking.ts:20` `bayesianRating`: `count = Infinity` returns `NaN`; rating 7 gives 6.55 (unclamped). A 1.0 rating with `count 0` scores above an unrated contractor (50.8 vs 45) because it collapses to the prior 4.3; treat `count = 0` as unrated.
    - `compliance.ts:51` and `schedule.ts:104-112`: an unparseable date makes `daysUntil` NaN, so `statusFor` returns `scheduled` and the contractor shows no certificate problem. Return `overdue`/flag for NaN.
    - `coverage-check.ts:298`: `unitCount = NaN` makes IL-FID-01 fire a "gap" (`NaN < 6` is false). Guard `!Number.isFinite`.
    - `cents.ts:25`: `toCents("99999999999999999.99")` returns `1e19` (not a safe integer) and `toCents("-0.00")` returns `-0`. Add `Number.isSafeInteger` and `|| 0`.
    - `upkeep nextDueAfter(NaN, ...)` returns `"NaN-NaN-NaN"` while SQL returns null for interval < 1; callers validate, so latent only.
16. **Money cell glue.** `src/lib/import/normalize.ts:155` strips all whitespace, so `"100 200"` becomes `100200.00`. Only accept a space as a thousands separator when it is between a 1-3 digit group and groups of exactly 3 digits (`/^\d{1,3}( \d{3})+(\.\d+)?$/`), else unreadable.
17. **Copy.** `src/lib/upkeep/ics.ts:94,103`: `coverageShort("property")` is "Master policy", so the text reads "The current Master policy policy with ..." (scratch output). Use the noun form (`coverageNoun`) or drop the second "policy".

### Checked and fine (with the evidence)

Upkeep and calendar
- `nextDueAfter` (TS) equals `public.upkeep_next_due` (SQL) on 15,717 combinations: dates 2023-2029 including 29 Feb, 31 Jan/Mar/May/Aug/Oct/Dec, 30 Apr/Jun/Nov, 1 Jan/Dec; intervals 1, 2, 3, 4, 5, 6, 7, 9, 12, 18, 24, 36, 60; every due month and none. Zero differences. Result is strictly after the done date in every case with a due month. Gaps stay within a half cycle either side (interval 12 gives 6 to 18 months, 24 gives 18 to 30).
- Month-end clamp (Jan 31 + 1 month = Feb 28/29), leap day (2028-02-29 + 12 months = 2029-02-28), done late and done early, backdated (SQL trigger keeps the latest completion, TS fixture cases pass), `initialNextDue` in its own month (due by month end, not overdue).
- `daysUntil` is exact for 1, 59, 60, 61 and 400 days over 1,500 start dates in UTC, America/Chicago, Pacific/Auckland, America/Havana, America/Sao_Paulo and Australia/Lord_Howe (0 mismatches), so DST cannot shift a status.
- ICS: CRLF everywhere, file ends CRLF, no bare LF; no physical line over 75 octets even with accented and Japanese text (octet counting, no split code point); backslash, semicolon, comma and newline escaped in SUMMARY, DESCRIPTION, X-WR-CALNAME and the alarm; a task name containing `\r\nBEGIN:VEVENT\r\nX:1` and a visit title containing `\r\nATTENDEE:evil` stay inside one escaped value (property list shows no injected ATTENDEE, VEVENT count correct); stable `UID`s per task, visit and policy; `DTSTAMP` from `generatedAt` with an unreadable stamp falling back to the epoch; DTEND rolls over month, year and 29 Feb; SEQUENCE is a safe integer.
- Bills: `billNextDue` TS equals SQL `bill_next_due` on 224 cases; `monthlyEquivalentCents` rounds half away from zero ("0.05" quarterly = 2, "1000.00" semiannual = 16667).

Contractors
- Bayesian: 5.0 from 1 review (4.33) ranks below 4.8 from 900 (4.79); zero or null or negative count returns the prior 4.3; NaN rating returns null; 1e15 reviews converges to the rating. Ties order by review count then name (`a`, `b`, `B`).
- Compliance boundaries: insurance expires in 30 days warns, 31 does not, today warns ("expires today"), yesterday is expired; license 60 warns, 61 does not; `usedRecently` includes exactly 365 days ago and excludes 366 and tomorrow; 1099-exempt contractors skip W-9.

Insurance
- Coverage-check thresholds: GL 999,999.99 fires and 1,000,000.00 does not; fidelity exactly equal to funds does not fire and one cent under does; deductible equal to funds does not fire and one cent over does; replacement cost limit one cent under fires with the exact `$0.01` shortfall; the 36-month valuation boundary (2023-10-14 quiet, 2023-10-13 fires); ordinance law B+C minimum is the lesser of 10% of the building limit and 500,000 (6,000,000 building: 499,999.99 fires, 500,000.00 does not; 100.00 building: 9.99 fires, 10.00 does not); only Coverage B recorded asks instead of passing; wind/hail 2% of 2,400,000.01 prints about $48,000; non-Illinois turns statute rules off; a null `facts` still runs (8 findings).
- `mulCentsBp4`: 1e14 cents x 10000 bp4 exact, rounds half up (1 cent x 5000 = 1, x 4999 = 0, 3 x 1667 = 1), negative handled, throws instead of returning an unsafe integer.
- `parseMoney`: `$2,400,000`, `1,000,000`, `5,000.00`, `USD 5000`, `$ 5,000` parse; "$1M", "$1.2M", "$2.5M", "$500K", "$1 million", "1,000,000 each occurrence" are review-grade only and exact (BigInt, no float); ranges ("1-2M"), two figures ("$1M/$2M"), "$1,2M", negatives and parentheses return null.
- `parsePercent`: 1%, 2%, 2.5%, 0.5%, 100% parse to 4-place fractions; "2", "1%/2%", "101%", "2.555%", ".5%" return null. `parseDate`: ISO, US `3/1/2026`, `March 1st, 2026`, `1 March 2026`, `Sept. 5, 2026` parse; `02/29/2026`, `13/01/2026`, `2026-02-30`, `0099-01-01`, two-digit years return null.
- Premium instalments: for 5 schedules x 11 amounts (0.00 to 999,999,999,999.99) x 6 date ranges (including 31 Jan start, 6-month term, zero-length term, 2-year term) the first instalment plus the others equals the annual premium to the cent in all 330 cases (remainder on the first). Dates are never chained (31 Jan monthly gives 31 Jan, 28 Feb, 31 Mar, 30 Apr ...).
- `changePercent` equals exact rational arithmetic (round half away from zero, one decimal) on 200,000 random pairs; zero previous returns null; `perUnitCost` null for 0, NaN units.
- `findDuplicatePolicy`: same coverage, carrier ignoring case, punctuation, "Inc.", "Company", "The", same start date, policy number only compared when both exist; archived and self ignored.

Import
- `normalizeMoney`: `$1,234.56`, `(1,234.56)`, `($50)`, `-$50`, `$-50`, `50-`, unicode minus, `.5`, `1,234`, trailing/leading spaces; European `12,50`, `1.234,50`, `1234,5` return the comma-decimal message instead of guessing; `€`, `USD`, `CR`/`DR`, 3 decimals, 13 digits, `1e3`, `+5` return unreadable; `-0` and `(0.00)` give `0.00`.
- `normalizeDate`: ISO with time, `20260304`, `3.4.26`, `04-Mar-26`, `Mar 4, 2026`, Excel serial 46055 = 2026-02-02, impossible dates, years outside 1990-2100, `detectDateOrder` day-first only when one part is over 12 and none in the other slot.
- `equalShares(n)` adds to exactly 100.000000 for every n from 1 to 700 (thirds: 33.333333, 33.333333, 33.333334); `parseShare` bounds.
- DB scenario (`importtax.test.ts`, units 1-3, FY2025 and FY2026): opening accounts as of 2025-12-31 (cash 10,000.00 debit, fund balance credit) leaves `form_1120h_figures` at zero for both years; opening unit balances (750.00 and 150.00 to income 4000) leave it at zero until paid, then a 750.00 payment counts 750.00 exempt in 2026; importing 4 rows (interest 50.00 non-exempt, deposit 300.00 exempt, repair -450.00 exempt, other income 80.00 non-exempt) gives `exempt 1200.00, nonexempt 130.00, gross 1330.00, exempt expenditures 450.00` and `exempt + nonexempt = gross`; undoing that batch returns exactly to `900.00 / 0.00 / 900.00 / 0.00 / 0.00` (0059 nets the reversal); trial balance debits equal credits before and after (13,680.00 and 14,560.00 totals include the reversal pairs); re-importing the same two rows after undo is allowed and counts once; a third file overlapping those two rows plus one new row validates as `duplicates 2, ok 1`. Income accounts cannot be unclassified (`accounts_check`), so no receipt is silently neither exempt nor non-exempt.

Email and statements
- One scenario (partial payment, waived 300.00, written-off 100.00 with 40.00 paid, 150.00 unapplied, one future charge): `unit_position_core` owed 550.00 / overdue 300.00 / credit 150.00 / net 400.00; email facts the same; `email_statement_facts` opening 0.00, charges 1150.00, payments 390.00, adjustments 360.00, closing 400.00; `unit_statement_core` all-history last balance 400.00; PDF `totalsOf` closing 400.00; the rendered statement email prints the same five figures. The three paths agree (the net rule holds for statements).
- Chicago day boundary: waiver/write-off lines are dated in Chicago; `email_today()` is used for prepare, claim and the facts check; the cron passes `buildingTodayIso()`.
- Caps (`caps.test.ts`): warm-up gives `min(cap, 20)` for 6d23h59m after enabling and the full cap at 7d1m; 19 sent today leaves 1, 20 leaves 0, 21 never goes negative; messages claimed 1 second before Chicago midnight are not counted today and at midnight they are; weekly cap: 6d23h59m59s blocks, exactly 7 days and 7d1s allow; hourly platform ceiling: with 299 sent in the hour the next claim is allowed and the 300th-plus-one is stopped (see item 8 for what happens to it).
- Idempotency: `wk-<uuid>` key per outbox row; `email_mark_sent` is a no-op for the same provider id; stale `sending` rows are re-queued only within 20 hours and 3 attempts, after that failed with "outcome unknown"; the outbox state machine rejects `queued` to `sent`.

Repairs and money helpers
- Recorded repair costs: a ticket's cost plus its own close-out log row are not double counted (`ticket_id` set rows excluded: 500.00 ticket + 500.00 linked log + 75.00 unlinked log gives 500.00 and 75.00); `ticketStage` rule order (scheduled beats quoting; accepted bid with a vendor is "chosen").
- `quoteSummary`: tie reads "Lowest $100 from A"; mixed kinds name the non-comparable bids; a declined bid can still be the lowest (by design).
- `formatMoney` variants (email, repairs, insurance, UI, owner words) agree on negatives and `999,999,999,999.99`; `fromCents(-1)` is `-0.01`; `sumMoney(["0.10","0.20","-0.30"])` is `0.00` (no float drift); `toCents` rejects `.5`, `5.`, `+5`, `1,000.00`, three decimals.

---

## D. Tests that assert the wrong thing or pass vacuously

Items 1 to 8 are by reading the test and the code (confidence stated); I ran none of the mutations. About 60 test blocks across upkeep, contractors, insurance, import, email, repairs, owner, tax and money were read; the sound ones are listed at the end. Items 9 to 12 are mine, from the findings above.

1. `tests/db/imports.test.ts:315` "fixing a row clears its complaints; skipping excludes it ...": `expect(after.digest).not.toBe(digestBefore.length ? "" : digestBefore)`. `digestBefore` is always non-empty, so it compares to `""`. Survives: digest computed without the skipped rows. Fix: `expect(after.digest).not.toBe(digestBefore)`. (High.)
2. `tests/unit/email-svix.test.ts:19` "matches a fixed vector": never calls `verifySvix`; `expected` is computed in the test with the same `createHmac`. Survives: sign `${ts}.${id}.${body}`. Fix: hard-code an `openssl`-generated base64 literal and assert `verifySvix` accepts it. (High.)
3. `tests/unit/email-send-batch.test.ts:230` "writes no address, amount or message text to the console": the first row gets the 401 and the loop stops (`send-batch.ts:223-225`), so the bad-facts and bad-template rows never log. Survives: printing `row.to_email` in the `render_failed` line (`send-batch.ts:165`). Fix: a `send` that returns ok, or one run per failure path. (High.)
4. `tests/unit/email-actions.test.ts:71-72`: `if (!big.ok) expect(...)` asserts nothing when the parser accepts 91 days. Fix: `expect(big.ok).toBe(false)` first. (High.)
5. `tests/unit/insurance-max-duration.test.ts:86,92`: `if (!reachesActions(file)) return;` and `if (!existsSync(file)) return;` make a missing or renamed page a green test. Fix: assert existence; drive the first from the explicit table. (High.)
6. `tests/db/integrity-guards.test.ts:38-46`: ends in bare `.rejects.toThrow()`; any error (typo, RLS) passes. Fix: `.rejects.toThrow(/different association/)`. (Medium.)
7. `tests/db/upkeep-v2.test.ts:117` and `tests/db/repairs-security.test.ts:156`: assert only that the function source contains `for update` / `pg_advisory_xact_lock`. Survives: lock taken after the read it protects. Rename to say "mentions" or match the exact statement. (Medium.)
8. `tests/db/email-reminders.test.ts:409,418-420`: `[f.unit3 === f.unit3 ? f.unit2 : f.unit2]` is always `unit2`; the final "queued and skipped appear in email_log" is satisfied by the earlier `sendReminderTo` row. Scope the log assertion to the batch under test. (Medium.)
9. `tests/db/tickets-v2.test.ts:19` closes out twice with the same cost (250, 250), so it cannot catch finding 9. Add 250 then 200 and assert the log row.
10. `tests/db/tax-views-reversals.test.ts:80` `expect(keep).toBeTruthy()` is trivially true; the file has no partial-allocation case (finding 1) and no reversal-of-reversal case (finding 3).
11. `tests/unit/insurance-coverage-check.test.ts` has no dismissal-per-finding case (finding 4); `tests/db/imports.test.ts` has no overlap-with-existing-entries case (finding 2) and no thirds-to-six-places case (finding 6).
12. `tests/unit/money.test.ts:100` only tests `monthsElapsed: 1` against a minimum of 3; the boundary values 2 and 3 are unpinned. `tests/db/insurance-v2.test.ts:381,1022` use `it.skipIf(!existsSync(...))`; remove the skip.

Sampled and judged sound: `upkeep-schedule`, `bills-schedule` (hand-written case fixtures, not generated), `contractor-compliance` (exact 30/31 and 60/61), `contractor-ranking` (pinned scores), `insurance-duplicates`, `insurance-compare`, `insurance-premium` (4-case shared table, SQL and TS), `insurance-status`, `insurance-coverage-check` (scenario parity against `RULES`), `email-config`, `email-service-rpc`, `email-actions` (approve, resume, prepare, `mapDbError`), `import-stage`, `import-xlsx`, `owner-standing`, `owner-statement`, `upkeep-v2` db 1-10 and 12-14, `ticket-bids` (including negative controls), `tickets-v2` 1, 6, 7, 17, 18, `repairs-security` 1-12, 14, 26-29, `email-reminders` db 6-8, 16, 25-29, `imports` db 2, 3, 10, 17, 18, 18b, 19, 36, `tax-views-reversals` first two, `integrity-guards` insert guards, `insurance-select-columns`.

## E. Reproducing

```
cd /private/tmp/claude-501/-Users-dougsmart-Desktop-Claude-Code/1b96944a-acd7-43cd-9ccd-ed28497e667d/scratchpad/review-d
./run.sh upkeep.test.ts      # 1  TS vs SQL upkeep fuzz, ICS output
./run.sh importtax.test.ts   # 1, 3  tax figures before/after, undo, reverse-of-reversal
./run.sh import2.test.ts     # 2, 6  overlap with existing entries, 99.999999
./run.sh insurance.test.ts   # 4, 13 coverage check edges, parsers
./run.sh email.test.ts       # 5, 7  statement parity, dunning, repeat interval
./run.sh caps.test.ts        # 8     warm-up, daily, weekly, hourly boundaries
./run.sh repairs.test.ts     # 9, 10 close-out, recorded costs
./run.sh fix.test.ts         # proposed fixes for 1 and 3 verified
```
