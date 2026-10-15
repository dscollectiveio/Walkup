# R4-ui-tickets: the Repairs hub, report page, ticket page, quotes, owner view, Today

Step owner: Repairs. Date: 2026-10-14. No git commands run; no migrations
touched or applied; no dev server started or stopped; no dependencies added.

## Built

| File | What |
|---|---|
| `src/lib/repairs/search.ts` (new, pure) | §5.7 `postgrestIlikeValue`, plus `referenceFromQuery` (`#12` / `12`). |
| `src/lib/repairs/problems-params.ts` (new, pure) | §2.2: `viewsFor`, `resolveView` (board -> Today, others -> Problems, board-only views fall back), `parseProblemParams` (every param, invalid -> default, board-only values ignored for others), `hasFilters`, `problemsHref`, `clearedParams`. |
| `src/lib/repairs/today.ts` (new, pure) | §15.1 `buildToday` (all seven sections, stats), `possibleEmergency`, `todayIsEmpty`, `recordedRepairCosts` (ticket final costs + upkeep log rows with `ticket_id is null`). |
| `src/lib/repairs/page-data.ts` (new, server-only) | `loadViewer` (association, member/board/admin/financials/reporter flags, person id, building today), `loadEmergencyInfo` (`building_emergency_info()`; null building when nothing entered), `loadEmergencyContractors`, `loadRepairsSince` (the 30-minute rule of `mark_repairs_seen`). |
| `src/components/repairs/` (new folder) | `styles.ts` (44px buttons/inputs), `pills.tsx` (`Pill`, `StatusPill`, `StagePill`), `emergency-banner.tsx` (§7.4, plus `contractorsForTrade`, `telHref`, `smsHref`; client-safe, no directive), `sheet.tsx` (`Sheet` native `<dialog>` full-screen on phones, `StickyActions`, `StillWorking` 20 s copy), `star-rating.tsx` (radio group), `quick-review.tsx` (stars, four tags, text; `addReview`), `contractor-draft.tsx` (DraftEmail + `updateDraft`/`markMessageSent`/`discardDraft`), `ticket-photo-picker.tsx` (`hold` and `upload` modes). |
| `src/app/repairs/page.tsx` (rewritten) | §2: hub, H1 + per-view blurb, `Report a problem` (full width on phones), pill nav with badges (open/urgent tint, upkeep overdue, expired paperwork, bills due in 14 days and paid by hand), `maxDuration = 300`, `MarkSeen` + `LayoutMemory` islands (`repairs-islands.tsx`). |
| `src/app/repairs/loading.tsx`, `report/loading.tsx`, `find/loading.tsx`, `upkeep/[taskId]/loading.tsx` (new) | §2.5 `RouteLoading`. |
| `src/app/repairs/problems-view.tsx` (rewritten), `problem-filters.tsx`, `problems-data.ts` (server-only), `problems-board.tsx`, `board-pieces.tsx` | §5.7 list (answer, GET filter form with phone `Filters` disclosure, rows with stage/status/overdue pills and money for financial readers, `Recently fixed`, `Show older`, empty states) and §15.2 pipeline board (6/7 columns, folding sections below `lg`/`xl`, 20 per column + `{n} more`, quick actions as links with `?open=` or the `Close it` island, `Show closed`). |
| `src/app/repairs/owner-problems-view.tsx` (new) | §14.1 (answer, updates since last look with role words, Your reports / In your unit / Shared areas with `I'm seeing this too` / Recently fixed, emergency link, empty copy). |
| `src/app/repairs/today-view.tsx` (new) | §15.1 loader + four `Stat` tiles + section cards; `Close all` island. |
| `src/app/repairs/report/page.tsx`, `report-form.tsx` (new) | §5.2 in full: polite live region with the banner swapped in place and `Is this happening right now?`, urgency auto-pick with the hint (the reporter's choice stands), duplicate hint with one-tap me-too, held photos prepared on the phone, `clientKey`, `Sending…`, `Uploading photo i of n…`, leave-page prompt, `router.push(...?reported=1&failed=n)`. Accountant: `Restricted` + the accountant line. |
| `src/app/repairs/emergency-info/page.tsx`, `emergency-info-form.tsx`, `actions.ts` (new) | §14.3: static guidance (expandable), `In this building` (owners: only entered rows; board: `Not recorded` + `Add`), board contacts with call/text, board editor: facts (descriptive placeholders only), contacts add/edit/reorder/show-to-owners/delete (admin). Actions `saveEmergencyInfo` (one upsert on `association_id`), `saveEmergencyContact`, `reorderEmergencyContacts` (one upsert), `deleteEmergencyContact`. |
| `src/app/repairs/bills-view.tsx` (new, interim) | The read-only list that was `/bills`, moved so `/bills` can redirect (see deviation 1). |
| `src/app/maintenance/[ticketId]/` | `page.tsx` (rewritten, `maxDuration = 300`; board/accountant view and owner view), `load.ts` (server-only loader: ticket + board details, events with names or roles, notes, photos, documents minus photos, vendors with compliance/history/ratings, ranked quote candidates, bids, messages, claims, current property policy, threshold, draft basics), `types.ts`, `ticket-dialogs.tsx` (one provider for Get quotes / Record a quote / Mark fixed; `?open=quotes|fix|go-ahead`), `next-step-card.tsx` (every stage, AI possible-emergency line, go-ahead draft, owner's-to-fix dialog, reopen dialog), `details-card.tsx` (Edit details sheet incl. lowering reason and access-notes decision), `plan-card.tsx`, `owner-notice.tsx` (§5.4, Bcc for shared), `close-out-dialog.tsx` (§5.5 incl. review prompt and upkeep line), `photos-card.tsx`, `quotes-card.tsx` (§8.3/8.5 table + phone cards, summary, accept/decline dialogs, requested rows, `Let {other} know`), `request-quotes-dialog.tsx` (§8.2 incl. `Send as one email to all`), `record-quote-dialog.tsx` (§8.4 incl. upload + read + paste), `timeline.tsx` (+ `NoteForm`, edit/delete, Turn into a review), `more-about.tsx`, `money-card.tsx`, `insurance-prompt.tsx`, `messages-card.tsx`, `triage-card.tsx` (§7.5 every state), `duplicate-form.tsx`, `owner-actions.tsx` (confirm block, visit feedback, me-too), `reported-notice.tsx`, `emergency-actions.tsx`. |
| Deleted | `src/app/maintenance/report-form.tsx`, `[ticketId]/controls.tsx`, `[ticketId]/contractor-picker.tsx` (replaced; nothing imported them any more). |
| Shims | `src/app/maintenance/page.tsx` -> `/repairs?view=problems`; `src/app/contractors/page.tsx` keeps `q`, `status`, `trade[]`, `tab=find` -> `/repairs/find?trade=`; `src/app/bills/page.tsx` -> `/repairs?view=bills`. |
| `src/app/contractors/[vendorId]/page.tsx` | One line: `export const maxDuration = 300;` (F3's request, §2.5). |
| Tests (new) | `tests/unit/repairs-search.test.ts` (7), `repairs-problems-params.test.ts` (10), `repairs-today.test.ts` (11), `repairs-max-duration.test.ts` (5). `tests/unit/ai-max-duration.test.ts`: my four pages added to `PAGES` (F2's request to all areas). |

## Deliberately different from the spec, and why

1. **`bills-view.tsx` is an interim port of the old `/bills` page**, not §13.2. §2.3 says `/bills` redirects to `/repairs?view=bills`, and no bills view existed, so the redirect would have lost the page. The Bills step replaces this file.
2. **Photo `accept` is `image/jpeg,image/png`** in both picker modes (foundation §17 overrides §5.2's HEIC list: asked for JPEG, iOS converts; `preparePhoto` still converts any HEIC that arrives). Upload mode delegates to `DirectUpload` with `prepare` (foundation §17 Repairs (c)), so no separate upload loop on the ticket page.
3. **Photo removal uses the foundation's `removeTicketPhoto`** (F3: not `unlinkDocument`). Confirm copy is the spec's sentence with the foundation's `Remove` / `Keep it` buttons.
4. **`Link a payment` (Money card) is offered once the problem is fixed or closed**, through `closeOutTicket` with the same status and cost. There is no action that sets only `expense_id`, and `close_out_ticket` would close an open problem; before the fix the payment is linked in Mark fixed. `Close it` on a fixed problem likewise passes the recorded final cost and payment back, because `close_out_ticket` overwrites both.
5. **The go-ahead without an email** still creates the job draft (`to: []`) and shows the no-email line with `I told them by phone` above it, as §5.6 describes; Today and the pipeline open it with `?open=go-ahead`.
6. **`Report a problem` in the hub header is hidden for the accountant** (they get `Restricted` on the report page; §5.7's empty state hides it too).
7. **Quote request rows and the summary count "asked" as every quote not marked No quote**; "received" counts received, accepted and not-chosen quotes with an amount.
8. **Today rules, small choices:** `new` includes problems of any status created since the visit; "quotes are in" fires on 2+ received or when nothing is still waiting (`requested == 0`); an expiring quote, a reopen within 14 days and the stage row are separate rows; bills due in 14 days include overdue ones ("Bill was due …"); the close row carries the ids (max 50) for `Close all`.
9. **Owner updates** include notes (`X added a note.`) and use `ticket_event_actor_roles()` for the at most six most recent tickets with events; the answer's detail is the latest event on an open report of theirs.
10. **The ticket page's quote candidates are built in `load.ts`** (vendors, reviews, assigned tickets -> `SavedCandidate` -> `rankSaved`), not via `src/lib/contractors/recommend.ts`, which belongs to the find-page step. Why chips drop the `Does {trade}` chip inside the "Do {trade}" group (it repeats the heading).
11. **Owner "Who's handling it"** is left out on a done problem with no visit (the resolution note card says what was done).
12. **Timeline times** are shown in America/Chicago (`Intl` with a fixed zone so server and client agree).
13. **Visit feedback** is offered to the reporter on a done problem that had a contractor or a visit.

## Left undone / for other steps

- **Not checked in a browser.** The dev database doesn't have 0053 (or 0052), so every page here would only show errors or empty states there; signing in also needs the dev credentials. Check after the lead applies the migrations: `/repairs` (all five views, board and owner), `/repairs/report` (banner, photos on an iPhone), `/maintenance/[id]` (board, accountant, owner), `/repairs/emergency-info`, at 375px.
- `src/app/repairs/find/page.tsx` doesn't exist yet; `repairs-max-duration.test.ts` checks it once it does.

## Cross-workstream requests

- **Find page step (§9):** open the quotes dialog with `RequestQuotesDialog` from `@/app/maintenance/[ticketId]/request-quotes-dialog` (`preselected` vendor ids, `candidates: QuoteCandidate[]`, `alreadyAsked`, `photos`, `senderEmail`), or link to `/maintenance/{id}?open=quotes`. If you build `loadSavedCandidates`, `load.ts`'s candidate block can switch to it. Add `export const maxDuration = 300;` to `find/page.tsx`.
- **Contractors step (§10):** reuse `QuickReview`, `StarRating`, `ContractorDraft`, `Sheet`/`StickyActions`, `Pill` from `src/components/repairs/`. The hub passes `ContractorsView` only `{ tab, trade, status }` (`contractorsParams` in `src/app/repairs/page.tsx`); extend that helper when the view takes `q`, `sort`, `archived`. Today's `Review them` links to `/repairs?view=contractors#emails`, so give the emails section `id="emails"`.
- **Upkeep step (§12):** the hub renders `<UpkeepView isBoard={viewer.isBoard} />`; change that call if the props change. `upkeep/[taskId]/loading.tsx` exists.
- **Bills step (§13):** replace `src/app/repairs/bills-view.tsx` (the hub renders `<BillsView />`).
- **Integration (§18.6):** sidebar titles for `/repairs/report`, `/repairs/find`, `/repairs/emergency-info`, `/repairs/upkeep/`; the badge can use `loadRepairsSince`'s rule.

## Commands run

- `npx tsc --noEmit`: during the build, errors only in my files (one bad cast in `load.ts`, a union narrowing in `next-step-card.tsx`, an embed typing in `today-view.tsx`), all fixed; insurance in-progress files had errors early on (not mine). Final: exit 0, no errors in the project.
- `npx eslint src/app/repairs src/app/maintenance src/components/repairs src/lib/repairs src/app/bills/page.tsx src/app/contractors/page.tsx "src/app/contractors/[vendorId]/page.tsx"` + the five test files: exit 0.
- `npx vitest run tests/unit/repairs-search.test.ts tests/unit/repairs-problems-params.test.ts tests/unit/repairs-today.test.ts tests/unit/repairs-max-duration.test.ts tests/unit/ai-max-duration.test.ts`: 5 files, 40 passed.
- `npx vitest run tests/unit`: 112 files, 1397 passed.
- Copy check (grep over every file this step wrote): no em dashes; no "vendor", "best" or "you should" in user-facing strings.
