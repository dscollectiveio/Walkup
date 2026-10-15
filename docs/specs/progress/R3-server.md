# R3-server: the Repairs server side

Step owner: Repairs. Date: 2026-10-14. No git commands run; no migrations
touched or applied; no dev server started or stopped; no dependencies added.
0053 unchanged.

## Built

| File | What |
|---|---|
| `src/lib/repairs/server.ts` (new, server-only) | Shared action plumbing: `Supabase`, `Ok`/`Err`, `currentAssociationId`, `isBoard`, `isBoardAdmin`, `canReadFinancials`, `currentPersonId`, `dbError` (42501 -> the action's sentence, 23505 -> its duplicate sentence, 22023 -> the RPC message capitalised with a full stop, else the generic sentence with the raw message logged), `sentence`, `firstIssue`, `textOrNull`, `isUuid`. |
| `src/app/maintenance/actions.ts` (rewritten) | §5.1, every action with the spec's signature: `createTicket` (rules + `emergencyConfirmed`, `guessTradeFromText`, `client_key` retry, `after(triageAndRecord)` when `aiConfigured()`), `updateTicketDetails` (`set_ticket_priority` with the `reason_required` sentence naming the reporter's first name; access notes decision when a unit problem becomes shared), `setTicketPlan` (do-not-use / archived checks, only given keys, money as text), `setTicketStatus`, `closeOutTicket` (+ `reviewPrompt`), `closeFixedTickets`, `markDuplicate`, `closeForOwner`, `markEmergency`, `dismissEmergencySuggestion` (upsert), `addComment`, `addMeToo`, `addVisitFeedback`, `editComment`, `deleteComment`, `reopenTicket`, `confirmFixed`, `retriageTicket`, `createTicketFromUpkeep`, `recentExpensesForTicket`, `ownerNoticeRecipients` (shared: sender in To, owners in Bcc, since foundation §17 (a) landed), `markOwnersTold`, `markRepairsSeen`. |
| `src/lib/repairs/triage.ts` (new, server-only) | §7.2: `TRIAGE_URGENCY`, `TRIAGE_REPORTER_DAILY_CAP`, `triageSchema`, `TRIAGE_SYSTEM`, `triageUserText` (only the three scrubbed reporter fields and the month), `postProcessTriage`, `triageTicket` (never throws), `recordTriage`, `triageAndRecord` (reporter cap from the building's midnight), `buildingDayStartIso`. §7.3: runs after `createTicket` and from `retriageTicket`; never for upkeep tickets or a retried submit. |
| `src/lib/repairs/photos.ts` (new, client-safe) | §5.2/§6: `preparePhoto` (sniff, refuse non-photos with the foundation copy, redraw HEIC / over 2.5 MB / over 2,560 px as JPEG via the foundation's `normaliseImage`, 15 MB cap) and `uploadTicketPhotos` (sequential `uploadFile(..., { purpose: "ticket_photo", normaliseImages: false })`, failures collected). |
| `src/lib/repairs/ticket-photos.ts` (new, server-only) | `loadTicketPhotos(supabase, ticketId, { seesNames })`: `ticket_photos()` + `signedImageUrls()`, captions and alt text from the foundation's copy, HEIC rows without a URL. Removal is the foundation's `removeTicketPhoto` (no Repairs wrapper needed). |
| `src/lib/repairs/parse.ts` (new, pure) | `parseMoneyText`, `isoDateOrNull`, `cutText`. |
| `src/lib/repairs/bid-read.ts` (new, server-only) | §8.4: `bidReadSchema`, `BID_READ_SYSTEM`, `BidPrefill`, `bidPrefillFrom`, `bidReadContent`, limits. |
| `src/app/maintenance/bid-actions.ts` (new) | §8: `requestQuotes` (one `request_ticket_quotes` call; email drafts from `quoteRequestDraft`, call scripts; no email = by phone; returns the stored draft text), `recordBid` (updates the contractor's live bid, requested -> received; insert otherwise), `acceptBid`, `declineBid`, `markNoQuote`, `draftNotChosen` ("Let {other} know"), `readBidDocument` (text layer only, `extractDocumentText`), `readBidText` (20..20,000 chars, `redactTaxIds`). |
| `src/lib/repairs/contractor-drafts.ts` (new, server-only) | `loadDraftBasics` (association names/address, sender name/phone), `associationAddress`, `w9Link` (from `tax_form_links`, `irs_w9`), `insertContractorDraft` (23505 on `contractor_messages_one_draft` returns the open draft), `DraftKind`. |
| `src/app/contractors/actions.ts` (rewritten) | §10.7: `createDraft` (every kind from the 4.5 templates; job draft uses the accepted quote, else the estimate), `updateDraft`, `discardDraft` (both check affected rows and act on drafts only), `markMessageSent` (final text + `sent` in one update; already sent -> ok with its `sent_at`), `markMessagesSent`. |
| `src/app/contractors/vendor-actions.ts` (rewritten) | §10.3 `vendorFields` (phone, email **or website**; emergency_service, job_tags, other contact, payment methods), `addVendor`, `updateVendor`, `updateVendorNotes`; §10.6 `addReview` (new object input, tags, upkeepLogId), `updateReview`, `deleteReview`, `addContractorNote`, `editContractorNote`, `deleteContractorNote`, `updateRates` (`rates_as_of` = building today only when a rate changed), `refreshGoogle` (fixed, below); §10.4/10.5 `archiveContractor` (+ open-ticket count), `restoreContractor`, `deleteContractor` (23503 sentence); §10.8 `readCertificate` (kind `coi_read`, text layer only) and `setInsuredUntil` ("Use it"). `searchContractors`, `saveFromSearch`, `assignTicketContractor` removed (§9.4; assigning is `setTicketPlan`). |
| `src/lib/contractors/web-verify.ts` (new, pure) | §9.3: `webContractorSchema`, `LEAD_GEN_HOSTS`, `DIRECTORY_HOSTS`, `hostIn`, `normaliseName`, `findName`/`findNameAll`, `findNumber`, `nameSegments`, `hostCarriesName`, `formatPhone`, `snippetOf`, `verifyWebContractor` (rules 1 to 10), `webSearchTask` (exact §9.3 task), `WEB_ITEM_GUIDANCE`. |
| `src/lib/contractors/found.ts` (new, server-only) | `SourceState`, cache lifetimes, `cleanWants`, `googleCacheKey`, `webCacheKey`, `savedMatcher` (place id, website host, normalised name; archived and do-not-use included), `googleCandidates` (miles, 15-mile cut), `webCandidates`, `webLocation`, `loadWebSearch` (§9.3's page read). |
| `src/app/repairs/find/actions.ts` (new) | §9.2 `searchPlaces`, §9.3 `startWebSearch` (background, `webResearch` with `nameOf`, `redact: loadRedactionTerms`, `verifyWebContractor`, `maxSearches: 4`, user location; `dropped_count` = items listed minus items kept), §9.4 `saveCandidate`, `saveCandidates`, `linkCandidate` (details always re-read from the cache row). |
| `src/lib/google/places.ts` | §9.2: `searchNearby(query, lat, lng, { includedType })` with `pageSize: 20`, unsorted; every fetch through `googleFetch` (`AbortSignal.timeout(10_000)`, network failure/abort -> `GoogleUnavailableError`, map bug 12) in `searchNearby`, `placeDetails`, `geocode`; `PlaceResult.businessStatus`; `GOOGLE_DAILY_LIMIT = 60`, `GOOGLE_TIMEOUT_MS`. `sortByWeightedRating` kept for any other caller. |
| `src/app/repairs/upkeep-actions.ts` (rewritten) | §12.1: `UpkeepTaskInput`, `addUpkeepTask` (`add_upkeep_task`, trade guessed from the name when omitted, `initialNextDue(buildingTodayIso(), …)`), `updateUpkeepTask` (recompute next due from the last done date when the cadence changes and no date was typed), `markUpkeepDone` (`mark_upkeep_done`, building today, `reviewPrompt`), `updateUpkeepLog`, `deleteUpkeepLog`, `archiveUpkeepTask`, `restoreUpkeepTask`, `deleteUpkeepTask` (refused with history), `addUpkeepTemplates` (one insert, template trade). |
| `src/lib/upkeep/schedule.ts` | Added `UPKEEP_INTERVALS` (a "use server" file may export only async functions). |
| `src/app/bills/actions.ts` (new) | §13.1: `BillInput`, `addBill` (operating fund, `due_day` from the date), `updateBill` (`due_day` when the date changes), `setBillPaused`, `markBillPaid` (sends the shown due date; 23505 -> "Already marked paid for {date}." plus the current due date; 22023 passes through), `archiveBill`, `restoreBill`. |
| `src/app/repairs/calendar/route.ts` (new) | §12.5: members only (403 JSON otherwise); active tasks, visits from the building's today (RLS limits owners), current non-archived policies for financial readers; `buildRepairsCalendar`; the three headers. |
| `src/app/contractors/[vendorId]/google-refresh.tsx` (new) + `page.tsx` | **Map bug 8**: the profile no longer calls `refreshGoogle` in `after()` from a Server Component (where `revalidatePath` can't run). `GoogleRefresh` (client) calls it once on mount when stale, key set and viewer on the board, shows "Updating from Google…", then `router.refresh()`; failure shows nothing. Only the two refresh lines of the page changed. |
| `src/lib/repairs/validate.ts` | `z.string().uuid()` -> `z.guid()` (see deviation 9). |

Old UI kept compiling (they are replaced by the UI steps; small adapters only,
each marked with a comment): `src/app/contractors/[vendorId]/notes-editor.tsx`,
`review-form.tsx`, `src/app/contractors/draft-panel.tsx`, `find-panel.tsx`,
`src/app/maintenance/report-form.tsx`, `[ticketId]/contractor-picker.tsx`,
`[ticketId]/controls.tsx` (Fixed/Closed now go through `closeOutTicket`),
`src/app/repairs/upkeep-forms.tsx`. One em dash in the old report form's
option label became parentheses.

Tests (all new): `tests/unit/repairs-triage.test.ts` (14), `repairs-photos.test.ts` (8),
`bid-parse.test.ts` (7), `contractor-web-verify.test.ts` (22), `google-places.test.ts` (6),
`repairs-actions.test.ts` (40, with the in-memory `tests/unit/repairs-fake-db.ts`:
createTicket, board edits, quotes, emails, directory, both find sources, save, upkeep,
bills, calendar route; model, web research and Google mocked) and
`tests/db/repairs-server-contract.test.ts` (4: what the TypeScript side builds,
post-processed triage, template quote requests, plan fields, accepted by the real 0053 functions).

## Deliberately different from the spec, and why

1. **`loadWebSearch` lives in `src/lib/contractors/found.ts`, not in the find actions file.** It takes a Supabase client; exported from a `"use server"` file it would become a callable endpoint with a non-serialisable argument.
2. **`startWebSearch` claims the quota with `claimAiCall` and passes the claim to `webResearch`** instead of `assertAiQuota` (foundation-spec 5.3: "the quota claim comes first and is mandatory"; precedence foundation > area). A fresh cached search or a run already in progress returns before any claim; a claim that can't start is closed as `not_started`.
3. **Verification of web contractors, two tightenings.** (a) "Within 200 characters of the name" is measured on the listing *segment* after each occurrence of the name, cut at a blank line or ellipsis and before the second phone number; otherwise on a directory page a business could take its neighbour's phone or rating (the §17.3 Acme/Best Drains case, both directions, is tested). (b) An article's host passes both host lists and does name the business, so a website is kept only when its host carries a distinctive word of the name (`hostCarriesName`, trade/place words ignored) or a page title from that host names the business. Both only drop data.
4. **`HONESTY_RULES` appended** to the triage, quote-reading and certificate prompts (foundation-spec §14 hand-off for triage; the same reasoning for the two reading prompts). The spec's exact text is kept in front.
5. **Google budget** is checked before a geocode as well as before a text search, and a cached result still shows at the limit (the §9.5 copy promises it). `GOOGLE_DAILY_LIMIT` lives in `places.ts`.
6. **`markBillPaid`** returns `nextDueOn: string | null` (null when an insurance premium bill retired, R-2), and its 23505 error carries `nextDueOn` (the bill's current due date) beside `error`, so the sheet can refresh as §13.1 asks.
7. **`updateTicketDetails`** makes two writes when urgency changes: `set_ticket_priority` first (so a missing reason fails before anything is written), then the details update. Spec-described; noted because §5.1 otherwise wants one RPC per multi-row write.
8. **`recordBid` on an accepted quote** whose amount changes also sets the problem's estimate (`set_ticket_plan`), so the estimate never disagrees with the chosen quote.
9. **`validate.ts` uses `z.guid()`**: zod 4's `uuid()` refuses ids without RFC version/variant bits (all test fixtures, possibly seeded dev rows); `gen_random_uuid()` ids pass either way. Found by the contract test.
10. **`UpkeepTaskInput.trade` is optional**: omitted means guessed from the name on add and left alone on edit (the old form doesn't send it and would otherwise wipe the backfilled trade).
11. Small choices: `markOwnersTold` writes the visit date as "Thu, Oct 22" (never "tomorrow", which goes stale in a stored note); `markRepairsSeen` doesn't revalidate (it is called on page mount); `createTicketFromUpkeep` prefixes "Upkeep: " to a task name under 4 characters (the title check) and leaves the contractor off when the task's usual one is do-not-use or archived; `addMeToo` refuses the reporter; `ownerNoticeRecipients` uses Bcc for shared problems (foundation §17 (a) landed); `saveCandidates` caps at 20; the calendar also excludes archived policies; `archiveContractor` doesn't refuse an already-archived contractor (it re-stamps).
12. `vendorFields` always writes `emergency_service`, `job_tags` and the other-contact fields. Until the form is rebuilt (§10.3), saving a contractor in the old form clears flags set from the find page.

## Left undone (owned by later steps)

- Pages and client components (§5.2 to §5.7, 7.4, 7.5, 8.2 dialogs, 9.1, 9.5, 10.1, 10.2, 12.2 to 12.4, 13.2, 14, 15), including `src/lib/contractors/recommend.ts` (`resolveJob`, `loadSavedCandidates`), `src/lib/repairs/search.ts` (`postgrestIlikeValue`), `today.ts`, the redirect shims, deleting `FindPanel`/`DraftPanel`/`controls.tsx`/`contractor-picker.tsx`/`report-form.tsx`, and `tests/unit/repairs-max-duration.test.ts`.
- `export const maxDuration = 300;` is not yet on `src/app/repairs/page.tsx`, `report/page.tsx`, `find/page.tsx`, `src/app/maintenance/[ticketId]/page.tsx`, `src/app/contractors/[vendorId]/page.tsx` (§2.5); the page step must add it with the pages that host these actions.

## Notes for the Repairs UI steps

- Every action returns `{ ok: true, ... } | { error }`; narrow with `"error" in r`.
- Ticket page: `loadTicketPhotos` for the photo card; `removeTicketPhoto` from `@/app/documents/upload/actions`; `retriageTicket` returns the stored triage; `parseStoredTriage` to render it.
- Find page: `searchPlaces` (client, on mount), `startWebSearch` + `loadWebSearch` (server read) + `PollWhileRunning`; `mergeFound`/`rankFound` from `ranking.ts`; `saveCandidates` before `requestQuotes` for the ask bar; `linkCandidate` for `name_taken`.
- Vendor form field names: `emergency_service` (checkbox "on"), `job_tags` (repeated, `condo_work|small_jobs|free_estimates`), `other_contact_name|role|phone|email`, `payment_methods`.
- `draftNotChosen(bidId)` is "Let {other} know"; `setInsuredUntil` is the certificate's "Use it".

## Cross-workstream

- None required. Insurance: the `tsc` error in `src/app/insurance/page.tsx` (ClaimRow) is in their in-progress file, not from this step.

## Commands run

- `npx tsc --noEmit` after the actions: 45 errors, all in the old Repairs UI files that called the old signatures; adapters added; then only `src/app/insurance/page.tsx(589)` remains (Insurance's file, appeared mid-step, not touched here). Earlier runs: two typing errors in my `upkeep-actions.ts` (fixed).
- `npx eslint src/lib/repairs src/lib/contractors src/lib/google src/lib/upkeep src/app/maintenance src/app/contractors src/app/repairs src/app/bills` + all new test files: clean.
- `npx vitest run tests/unit/contractor-web-verify.test.ts`: 22 passed (run after adding the own-site check and its test).
- `npx vitest run tests/unit/bid-parse.test.ts`: 7 passed.
- `npx vitest run tests/unit/repairs-triage.test.ts`: 14 passed.
- `npx vitest run tests/unit/repairs-photos.test.ts`: 8 passed.
- `npx vitest run tests/unit/google-places.test.ts tests/unit/contractors.test.ts`: 59 passed.
- `npx vitest run tests/unit/repairs-actions.test.ts`: first run 2 failures, both test expectations (the §11.1 keyword order makes "light fixture" electrical; the matcher correctly found a normalised name), fixed in the test; 40 passed.
- `npx vitest run tests/db/repairs-server-contract.test.ts`: first run 1 failure (zod `uuid()` refused a fixture id; deviation 9), fixed; 4 passed. With `repairs-validate` and `repairs-actions`: 56 passed.
- `npx vitest run tests/unit` (final): 104 files, 1296 tests passed.
