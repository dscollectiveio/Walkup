# R6-selfcheck: Repairs self-check and polish

Step owner: Repairs. Date: 2026-10-14. No git commands run; no migrations
touched or applied; no dev server started or stopped; no dependencies added.
Read every note in this folder first (R1 to R5, F1 to F3, I1 to I6,
insurance-report, the rest for cross-references).

## How the spec was walked

- **§1.1, §2 to §16, every page/flow/state.** Read the spec sections against
  the code (hub, report, ticket page board/accountant/owner, quotes, find,
  directory, profile, upkeep, task page, bills, emergency info, Today,
  pipeline, calendar route, redirect shims, loading files, `maxDuration`).
  Then a mechanical copy check: every backtick-quoted UI string of 8+
  characters in §5 to §16 (placeholders stripped, longest literal fragment)
  was searched for in the Repairs source. Every user-facing string is present
  (the misses were code identifiers, SQL, the §5.8 worked examples, and
  fallbacks the foundation §17 made unnecessary, such as `Copy addresses`).
- **Schema probe (throwaway, deleted after running):** a PGlite test that
  booted every migration and checked every `.from().select()` column (773
  checked, embeds resolved through FKs, `!hint`s, filters, `onConflict`) and
  every `.rpc()` name in Repairs code against the real schema: 0 problems.
  The three dynamic selects (`problems-data.ts`, `maintenance/actions.ts`,
  `[ticketId]/load.ts`) were checked by hand.
- **Client/server boundary:** a script followed the imports of all 46
  `"use client"` files in Repairs: none reaches a `server-only` module or
  `next/headers`. No Server Component passes an inline function prop.
- **Copy rules:** no em dash, "vendor", "best" or "you should" in any
  user-facing Repairs string (the only em dashes are in two regexes that
  strip them from model output).
- **§17:** every unit and DB test file the spec names exists and passes.
- **Cross-workstream tasks addressed to Repairs** (insurance-spec §12 R-1 to
  R-5, listed as open in `insurance-report.md`): built here, see below.

## Built or changed

| File | What |
|---|---|
| `src/app/maintenance/[ticketId]/insurance-prompt.tsx` | Rewritten for insurance-spec §12 **R-1** and **R-5** on top of repairs-spec §5.3 card 10. Claims card `Insurance claims`: status pill, claim number linking to `/insurance/policies/{policy_id}`, loss date, `Claimed {money} · Paid {money}`. No claim: Insurance's `deductibleHint()` (plumbing/flooding/sewage/fire, `coalesce(actual, estimate)` against the right deductible) first, else the repairs-spec water/fire/final-cost line, with `Start an insurance claim` and `Ask your agent` (`/insurance/emails/new?kind=coverage_question&policy={masterId}`). The board gets `Start an insurance claim` on every problem (with nothing else to say: `No insurance claim for this problem.`); the accountant sees the card only when it has content. |
| `src/app/maintenance/[ticketId]/load.ts` | Claims select adds `policy_id, amount_claimed::text, amount_paid::text`; the master policy is now picked with Insurance's `inForce()` from the R-5 column list (an early-recorded renewal no longer hides the in-force policy, which the old `replaced_at is null` filter did). |
| `src/app/maintenance/[ticketId]/page.tsx` | Passes `trade` and the estimate to the insurance card. |
| `src/lib/repairs/drafts.ts` | **R-3**: `ADDITIONAL_INSUREDS` ("the association, its board of directors, and its managing agent"); the certificate and paperwork requests now ask for those as additional insured parties (was "if your insurer allows it, the association"). |
| `src/app/contractors/[vendorId]/page.tsx` | **R-3**: Paperwork card, Illinois associations only: the additional-insureds line, "Illinois requires this for contracts over $10,000 a year (765 ILCS 605/12(i))", the verified quote from `CITATIONS.ICPA_12_I_COI` and the `actLinkText` link. |
| `src/app/repairs/bills-view.tsx`, `src/app/bills/bill-form.tsx` | **R-2**: embed `insurance_policies(...)`; premium bills show `Premium for {coverage short} with {carrier}` linking to the policy, with the period label when two shown bills cover the same coverage (renewal overlap); a retired premium bill shows `Last payment for this policy. The renewal has its own bill.`, and so does the mark-paid success line when `markBillPaid` returns no next date for a premium bill. |
| `src/app/bills/actions.ts` | Comment only: `updateBill` never sends `insurance_policy_id`, so edits keep the link (R-2, verified). |
| `tests/unit/repairs-drafts.test.ts` | Certificate wording updated; paperwork request asserts the additional insureds. |
| `tests/db/tickets-v2.test.ts` | New **28**: `dismissEmergencySuggestion`'s PostgREST upsert shape on `ticket_board_details` works with and without an existing row, keeps the stored triage, and is refused for an owner and the accountant (no suite covered this path). |

R-4 (upkeep copy "added here automatically") was already gone: R5 removed
the sentence per repairs-spec §12.2.

## Deliberately different, and why

1. **R-5 and repairs-spec §5.3 card 10 merged, not replaced.** The ticket page
   is Repairs' area (its spec is authoritative there), but R-5 is a task given
   to Repairs. `deductibleHint()` wins when it fires; otherwise the spec's
   water/fire prompt (which states the deductible even before a cost is known)
   and its any-trade "final cost is above" line still show. Card stays under
   `More about this problem`.
2. **R-5 says "for board users"; repairs-spec says financial readers.** The
   accountant still sees the prompt text (read-only, as §5.3 says) but no
   buttons.
3. **Start a claim link keeps `policy=`** (repairs-spec §5.3) as well as
   `ticket=` (R-1); `/insurance/claims/new` accepts both.

## Verified and left as is (no change needed)

- Report form, ticket page (board, accountant, owner), next-step card, close-out
  (one RPC; `close_out_ticket` keeps the resolution note when `Close it` sends
  none), quotes (table with scoped headers, phone cards, summary, accept/decline,
  `Let {other} know`), Get quotes dialog (bcc "one email to all", photo
  attachments, call scripts; "Did you send it?" lives in the foundation's
  `DraftEmail`), find page and §9.5 states, directory, profile, upkeep view,
  task page, bills, emergency info, owner views, Today, pipeline board, calendar
  route, shims, `RouteLoading` files, `maxDuration` on the five pages.
- Foundation §17 change requests (a) to (e) have all landed and are used
  (bcc, onOpenMailApp in DraftEmail, DirectUpload `prepare`, `coi_read`,
  `narrower_audience` copy through DirectUpload).

## Left undone / open

- **Not checked in a browser** (still): the dev database has neither 0052 nor
  0053, so the pages would only error there. §17.5 and the 375px check wait
  for the lead to apply the migrations. Order: apply 0052 and 0053 together;
  run R1's legacy-length queries first.
- Report-time photos (hold mode, `uploadTicketPhotos`) don't show the
  foundation's "already on another problem with a smaller audience" line; the
  ticket page's `Add photos` (DirectUpload) does. A brand-new problem
  re-using a photo from a narrower ticket is the only case; safe either way.
- Integration §18 tasks: none started (see `repairs-report.md`).

## Cross-workstream

- **Insurance:** R-1, R-2, R-3, R-4, R-5 are done (above); `insurance-report.md`
  can mark them closed.
- **Integration / other owners:** `npm run lint` fails only on files outside
  Repairs: `src/lib/email-outbox/sanitize.ts` (parse error) and
  `tests/db/email-reminders.test.ts` (`no-explicit-any`); `tsc` errors only in
  `tests/db/email-reminders.test.ts` (435 to 437). Not touched.

## Commands run

- `npx tsc --noEmit` (baseline): only `tests/db/email-reminders.test.ts(435-437)`, not Repairs.
- `npx eslint src/app/repairs src/app/maintenance src/app/contractors src/app/bills src/app/upkeep-schedule src/components/repairs src/lib/repairs src/lib/contractors src/lib/upkeep src/lib/google`: exit 0.
- `npx vitest run` on the 31 Repairs unit files (repairs-*, contractor*, upkeep-*, bills-*, bid-parse, google-places, ai-max-duration): 31 files, 408 passed.
- `npx vitest run tests/db/{operations,contractors,upkeep,repairs-security,tickets-v2,ticket-bids,contractors-v2,upkeep-v2,bills-v2,repairs-server-contract,migrations}.test.ts`: 11 files, 146 passed.
- `npx vitest run tests/db/zz-r6-schema-probe.test.ts` (throwaway, then deleted): 773 columns checked, 0 problems.
- `npx vitest run tests/unit`: 121 files, 1466 passed. `npm run lint`: 11 errors, 4 warnings, all outside Repairs (above).
- After the changes: `npx vitest run tests/db/tickets-v2.test.ts -t "28\."`: passed; `npx tsc --noEmit`: only the email-reminders test errors; `npx eslint` on every file touched: exit 0; Repairs unit files plus `insurance-status.test.ts`: 32 files, 429 passed.
- Final DB run: `npx vitest run tests/db/{operations,contractors,upkeep,repairs-security,tickets-v2,ticket-bids,contractors-v2,upkeep-v2,bills-v2,repairs-server-contract,migrations,rls}.test.ts`: 12 files, 159 passed (includes the new tickets-v2 #28).
