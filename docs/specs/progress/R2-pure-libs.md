# R2-pure-libs: repairs-spec §4 shared libraries, §11 trades and templates, their unit tests

Step owner: Repairs. Date: 2026-10-14. No git commands run; no migrations
touched or applied; no dev server touched; no dependencies added.

## Built

| File | What |
|---|---|
| `src/lib/contractors/trades.ts` | §11.1: 30 trades with `group`, `placesType` (only plumber, electrician, roofing_contractor, painter, locksmith), `related`, `licenseTypical`; `TRADE_SLUGS` tuple; `TRADE_KEYWORDS` (the §11.1 keyword list, exported for the vocabulary) and `guessTradeFromText` (whole words with optional `s`/`es`, `*` stems, first match wins); `TRADE_GROUP_LABEL`. `tradeLabel`, `tradeBySlug`, `SEARCHABLE_TRADES`, `isTradeSlug` unchanged. |
| `src/lib/upkeep/schedule.ts` | §4.13 rewrite: `allowsDueMonth`, `addMonthsClamped`, `endOfMonth`, `anchorMonths`, `nextDueAfter` (mirrors `public.upkeep_next_due` line for line), `initialNextDue(today, interval, month, lastDoneOn?)`, `cadenceWords` with anchor months. `statusFor`, `daysUntil`, `MONTH_NAMES` unchanged. §11.2: `UpkeepTemplate` gains `trade`, `searchPhrase`, `defaultChecked`; the 4 new templates (unticked); `templateForName()`. |
| `src/lib/upkeep/bills.ts` (new) | §4.14: `FREQUENCY_MONTHS`, `BillFrequency`, `billNextDue` (mirrors `public.bill_next_due`), `rollForward`, `monthlyEquivalentCents`. |
| `src/lib/upkeep/ics.ts` (new) | §4.15: `CalendarItem`, `sequenceFrom`, `upkeepCalendarItems`, `buildRepairsCalendar` (reuses `escapeText`/`foldLine` from `src/lib/tax/ics.ts`). |
| `src/lib/repairs/labels.ts` (new) | §4.1: statuses, priorities, `EVENT_KINDS` (23), `actorWord`, `eventSentence` (all copy). |
| `src/lib/repairs/validate.ts` (new) | §4.2: `MONEY_TEXT`, `moneyText` (zod), `normaliseMoneyInput`, `isoDate`, `ticketReportSchema`, `ticketDetailsSchema`, `ticketPlanSchema`, `closeOutSchema`, `bidSchema`, `storedTriageSchema` (+ input types) and `parseStoredTriage()`. |
| `src/lib/repairs/emergency.ts` (new) | §4.3: `EMERGENCY_KINDS`, rules, guidance (exact copy), `detectEmergency`, `buildingFactLines`, `EMERGENCY_KIND_LABEL`. |
| `src/lib/repairs/stage.ts` (new) | §4.4: `ticketStage`, `STAGES`, `STAGE_LABEL`, `SortableTicket`, `compareForTriage`. |
| `src/lib/repairs/drafts.ts` (new) | §4.5: every template, `callScript`, `emailDate`. |
| `src/lib/repairs/format.ts` (new) | §4.6: `humanDate`, `moneyText`, `whereLabel`, plus `monthYear` ("Sep 2026", for ranking chips). |
| `src/lib/repairs/similar.ts` (new) | §4.7: `similarOpenTickets` (+ `titleTokens`, `jaccard`). |
| `src/lib/repairs/scrub.ts`, `vocabulary.ts` (new) | §4.8: `scrubForModel` (via `scrubWebTask`), `REPAIR_VOCABULARY`, `vocabPhrase`. |
| `src/lib/repairs/revalidate.ts` (new, server-only) | §4.9: `revalidateRepairs`. |
| `src/lib/contractors/compliance.ts` (new) | §4.10: `complianceFor`, thresholds, plus `usedRecently(date, today)` for building `inUse`. |
| `src/lib/contractors/ranking.ts` (new) | §4.11: priors, weights, `bayesianRating`, `ratingComponent`, candidate types, `rankSaved`, `rankFound`, `mergeFound` (+ exported `savedScore`, `foundScore`, `savedWhy`, `foundWhy`, `JOB_WANTS`). |
| `src/lib/contractors/history.ts` (new, server-only) | §4.12: `HistoryItem`, `loadContractorHistory`, pure `mergeHistory` and `historyTotals`. |
| `src/lib/google/places.ts` | Only `sortByRating` -> `sortByWeightedRating` (Bayesian, `GOOGLE_PRIOR`), used by `searchNearby`. The rest of §9.2 is left for the find-page step. |
| `src/app/repairs/upkeep-actions.ts` | Two call sites only: `initialNextDue` now takes the interval. The upkeep step rewrites this file. |

Tests: new `tests/unit/bills-schedule.test.ts`, `upkeep-ics.test.ts`,
`repairs-emergency.test.ts`, `repairs-stage.test.ts`, `repairs-labels.test.ts`,
`repairs-drafts.test.ts`, `repairs-format.test.ts`, `repairs-similar.test.ts`,
`repairs-scrub.test.ts`, `repairs-vocabulary.test.ts`, `repairs-validate.test.ts`,
`contractor-compliance.test.ts`, `contractor-ranking.test.ts`,
`contractor-history.test.ts`; updated per §17.4 `upkeep-schedule.test.ts`
(uses `UPKEEP_CASES`, month-end results, the interval argument, anchors,
leap years, templates) and `contractors.test.ts` (30 trades, `placesType`,
`guessTradeFromText` positives and every §11.1 negative,
`sortByWeightedRating`). `bills-schedule` uses `BILL_CASES`.

## Deliberately different from the spec, and why

1. **`guessTradeFromText` follows the §11.1 list, not the 0053 SQL backfills.**
   §11.1 says "same order as the SQL backfills", but 0053's ticket backfill
   has its own order (roofing before hvac, masonry before gutters, ...) and
   fewer keywords, and the upkeep backfill differs again. The backfills are
   one-off on legacy rows; the TS function is the spec'd list with its tests.
   Effect: text with keywords from two trades can get a different trade from
   the backfill than from the app (e.g. "roof heating cable": SQL roofing,
   TS hvac). Recorded, not changed (0053 is R1's file).
2. **Drafts write dates in full** (`emailDate`: "Thursday, October 22, 2026")
   where §4.5 says `humanDate`. The draft functions have no `todayIso`, and
   "tomorrow" in an email goes stale the moment it's read later.
3. **`REPAIR_VOCABULARY` drops joining words** (`a an and at in of on or the to`)
   that the sources contain ("Smoke and CO detector", "crack in wall"), so a
   phrase is never just "and". Still built only from the listed sources.
4. **`scrubForModel`** also drops the last word when `scrubWebTask` itself cut
   the text at 2,000 characters (it cuts mid-word), and trims trailing space.
5. **`eventSentence`**: `note_added` returns `{who} added a note.` (the page
   renders the note; this line is for lists like the owner's "what changed");
   `trade_changed` to null is "Kind of work cleared."; `final_cost_recorded`
   to null "Final cost removed."; `details_edited` joins fields as "the title,
   location and access notes"; a money value that isn't numeric text shows as
   written instead of throwing (a timeline must not crash on one odd row).
6. **Ranking**: the emergency chip ("takes emergency calls" / "Advertises
   emergency service") shows only when the job is urgent or the emergency
   toggle is on, like the other "what matters" chips (5 chips max). A
   do-not-use found result scores `WEIGHTS.trade` (§4.11 "no terms beyond the
   trade") and always sorts last in `rankFound`. `mergeFound` also fills
   Google's empty `email`, `cityText` and `snippet` from the matched web
   result (Google never has an email). Saved ties use board review count,
   else Google's. Distance chip rounds to 0.1 mi ("6 mi away", "2.3 mi away").
   Saved Google chip prints the rating with one decimal.
7. **Compliance** items come worst first (bad, then warning, spec order
   within a tone). `license_missing` depends on the number being blank (with
   `inUse` and `tradeNeedsLicense`), independent of the expiry date.
8. **History**: the upkeep `HistoryItem` gains optional `ticketId` so a
   close-out that also logged upkeep counts as one job; `historyTotals(items,
   today)` is the pure, tested part of the totals (jobs = assigned problems +
   upkeep not tied to a problem; first/last used from problems, upkeep and
   payments; quotes and messages aren't "use"). The loader throws on a query
   error rather than showing an empty history.
9. **ICS**: a task's own description follows the cadence line; a visit's
   description is `Expected: {window}` or `No time window recorded.`; policy
   items use `coverageShort()` ("Master policy insurance renews (Acme)") from
   `src/lib/insurance/coverage.ts` and link to `/insurance/policies/{id}`;
   events carry `TRANSP:TRANSPARENT`; the calendar carries
   `X-WR-RELCALID:walkup-repairs-{associationId}`. Items come sorted by date.
   Filtering (active tasks, visits from today, current policies) is the
   route's job, as §12.5 says, since the function has no `today`.
10. **Schedule**: `nextDueAfter` treats an interval below 1 as 1 (the SQL
    returns null; the TS signature returns a string). Two existing template
    descriptions had em dashes; now "...main line. Cheaper than a backup." and
    "Porches, trim, railings: catch rot early." (names unchanged, so existing
    tasks still match). New template descriptions written for the 4 new ones.
11. **Emergency**: a negation counts only as a whole word ("casino smell of
    gas" still fires); every occurrence of a pattern is tried, not just the
    first. `buildingFacts` lists one key per line (`gas_emergency_phone`,
    `electric_panel_location`, `electric_emergency_phone`,
    `elevator_company_phone`, `water_shutoff_location`); the elevator line,
    like gas and power, needs a number. Two spec-faithful limits the tests
    document: "Elevator stuck on the third floor" fires (the exclude needs
    "stuck on a/the floor"), and "Carbon monoxide detector needs replacing"
    fires (the 20-character window ends before "replac").
12. **`compareForTriage`** uses "urgent or not" for the second key (not the
    full priority rank), then overdue `due_on < today`, then newest
    `created_at`, then higher `reference`.
13. **`similarOpenTickets`** breaks score ties on the higher reference.
14. **`moneyText(null)`** (format) returns "".

## Not built here (other steps own them)

Not in §4/§11, so left for the steps that own their sections:
`src/lib/repairs/search.ts` (`postgrestIlikeValue`, §5.7), `parse.ts`
(`parseMoneyText`, §8.4), `today.ts` (`buildToday`, §15.1), `photos.ts`
(`preparePhoto`, §5.2/6), `triage.ts` (§7.2), `src/lib/contractors/web-verify.ts`
(§9.3) and their unit tests (`repairs-search`, `bid-parse`, `repairs-today`,
`repairs-photos`, `repairs-triage`, `contractor-web-verify`,
`repairs-max-duration`). The rest of the `places.ts` changes (§9.2) too.

## Cross-workstream notes

- **Repairs (later steps)**: `revalidateRepairs` exists; use
  `parseStoredTriage()` to render triage; `templateForName(task.name)` gives the
  template's `searchPhrase`/`trade` for "Find someone"; `usedRecently()` helps
  build `inUse`; the template picker can group by `defaultChecked`.
  `upkeep-actions.ts` still uses the old non-RPC flow (only the two
  `initialNextDue` calls changed).
- **Integration (§18.1, 18.4)**: feed `complianceFor` from
  `@/lib/contractors/compliance` (pure, client-safe); `usedRecently(date, today)`
  covers the 365-day rule.
- `tests/unit/secret-box.test.ts` failed once in a full unit run ("refuses a
  tampered value and a different key") and passed 3 of 3 re-runs: flaky, not
  this step's code.

## Commands run

- `npx tsc --noEmit` after the libs: only the expected errors in the two
  existing tests (`sortByRating`, old `initialNextDue` arity); after updating
  them: exit 0, no errors in the whole project.
- `npx vitest run tests/unit/contractors.test.ts tests/unit/upkeep-schedule.test.ts`:
  first 1 failure (my own expected order for 4.5/10 vs 4.8/3: 4.367 vs 4.365,
  the test was wrong), fixed; 75 passed.
- `npx vitest run tests/unit/bills-schedule.test.ts tests/unit/upkeep-ics.test.ts`:
  first 1 failure (test regex matched digits inside a UUID), fixed; 17 passed.
- `npx vitest run tests/unit/repairs-emergency.test.ts`: two test strings
  adjusted to what the spec's excludes cover (deviation 11); 30 passed.
- `npx vitest run tests/unit/repairs-stage.test.ts tests/unit/repairs-labels.test.ts`:
  first 1 failure (money helper threw on a non-money value), made robust
  (deviation 5); 41 passed.
- `npx vitest run tests/unit/repairs-drafts.test.ts`: 14 passed.
- `npx vitest run` on format, similar, scrub, vocabulary: first 2 failures
  (trailing space at the 2,000 cap; "and" in a Google query), fixed; 20 passed.
- `npx vitest run tests/unit/repairs-validate.test.ts`: 12 passed.
- `npx vitest run tests/unit/contractor-compliance.test.ts`: 8 passed.
- `npx vitest run tests/unit/contractor-ranking.test.ts`: first 1 failure (my
  fixture triggered the board-loved bonus), fixed; 16 passed. A/B/C give
  56.9 / 60.5 / 60.7.
- `npx vitest run tests/unit/contractor-history.test.ts`: 6 passed.
- `npx eslint src/lib/repairs src/lib/contractors src/lib/upkeep src/lib/google/places.ts src/app/repairs/upkeep-actions.ts` plus all 16 test files above: exit 0.
- `npx vitest run tests/unit`: 94 files, 1151 passed, 1 failed (secret-box,
  flaky, see above; 6/6 on each of 3 re-runs).
- `npx vitest run tests/db/upkeep-v2.test.ts tests/db/bills-v2.test.ts`: 25 passed.
- A throwaway PGlite probe (`tests/db/zz-r2-parity-probe.test.ts`, deleted
  after running) compared `nextDueAfter`/`billNextDue` with
  `public.upkeep_next_due`/`public.bill_next_due` on 1,500 random inputs each
  (dates 2024 to 2030, intervals 1 to 36 including ones a due month isn't
  allowed for, null months and due days): 0 differences.
