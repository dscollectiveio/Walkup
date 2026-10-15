# R5-ui-contractors-upkeep: find page, contractor directory and profile, upkeep, bills

Step owner: Repairs. Date: 2026-10-14. No git commands run (one read-only
`git show HEAD:src/app/bills/page.tsx` to copy the old explainer text); no
migrations touched or applied; no dev server started or stopped; no
dependencies added.

## Built

| File | What |
|---|---|
| `src/lib/contractors/recommend.ts` (new, server-only) | §9.1 `JobContext`, `resolveJob` (ticket: trade from URL > ticket > triage, `suggestedPhrase` from stored triage via `vocabPhrase`, urgent; task: template `searchPhrase` only when the template's trade is the resolved trade; trade), `loadSavedCandidates(supabase, trade, related, todayIso)` (non-archived, non-do-not-use, `.overlaps("trades")`, reviews + tags, jobs, last used from problems/payments/upkeep, compliance flags, rates). |
| `src/lib/contractors/find-params.ts` (new, pure) | `parseWants` (urgent default, `want=none`), `findHref`, `toggleWant`, `WANT_LABEL`, `askBarState`, `MAX_ASK`, `firstParam`, `joinWords`. |
| `src/lib/contractors/directory.ts` (new, pure) | §10.1 `parseDirectoryParams`, `directoryHref`, `hasDirectoryFilters`, `matchesQuery`, `sortDirectory` (Bayesian your/Google rating, nulls last), `paperworkSummary`, `DRAFT_KIND_LABEL`, `orderDrafts`. |
| `src/lib/upkeep/view.ts` (new, pure) | §12.2/12.3 `whenLabel`, `monthsHint`, `groupUpkeep`, `upkeepAnswer`, `historyTotals`, `parseUpkeepShow`, `INTERVAL_OPTIONS`. |
| `src/lib/upkeep/bills-view.ts` (new, pure) | §13.2 `parseBillShow`, `billShowFilter`, `manualDueSoon`, `billsAnswer`, `monthlyTotal`, `nextDueText` (autopay rolled forward), `FREQUENCY_WORDS`. |
| `src/app/repairs/find/page.tsx` (new, `maxDuration = 300`) | §9.1: Restricted for non-board; trade picker card when no trade; header with back link, H1, trade `Change` (GET form keeping ticket/task/wants); wants bar; search-words line with `Use it`; "Your contractors who do this" (rankSaved, checkboxes on ticket pages, rates line, Call/Email, `Assign to #ref`); "Found nearby"; ask bar. Builds the Get-quotes dialog data for a ticket (all usable contractors, live bids, photos, sender email). |
| `src/app/repairs/find/find-context.tsx`, `ask-bar.tsx`, `find-results.tsx`, `wants-bar.tsx`, `assign-button.tsx` (new) | Selection across saved and found cards; R4's `RequestQuotesDialog` opened with the picks (waits for the refresh that brings newly saved contractors in); §9.5 states (Google on mount with pulsing placeholder, no_address, quota, error + Try again, cached + Search again; web idle button with "{used} of {limit} web searches used today" / zero line, running via `PollWhileRunning`, error/stalled + Try again, quota, dropped line, nothing verifiable, nothing within 15 miles, both off); `mergeFound` + `rankFound` with why chips; found card details (address / Based in, snippet, Call, Website, See on Google, Source links, "See their website for contact details"); In your list / archived + Restore / do-not-use; Save, Save and ask, name_taken with Link to them / View them; `FoundOnWeb`; footer note and `Save someone you already know`. |
| `src/app/repairs/contractors-view.tsx` (rewritten) | §10.1: compliance Answer (in use only, up to 4 + "and k more", names link), Add / Find buttons, GET search + Filters-and-sort disclosure (trade chips in use + More…, status, sort, Show archived), rows with status/Archived/emergency pills, trade chips, tel/mailto/Website, your/Google ratings, last used, worst compliance chip; "Emails waiting to be sent" card `id="emails"` (quote requests first) + `Write to a contractor`; empty and no-match copy; accountant read-only. |
| `src/app/contractors/emails-card.tsx`, `write-dialog.tsx` (new) | `DraftList` (collapsed rows into `ContractorDraft`, Discard); `WriteToContractor` (contractor, What about: problem/W-9/certificate/something else; `preset` kind for the profile buttons). |
| `src/app/contractors/[vendorId]/page.tsx` (rewritten) + `profile-actions.tsx`, `archive-dialog.tsx`, `rates-card.tsx`, `reviews-card.tsx`, `notes-log.tsx`, `certificate-reader.tsx` (new) | §10.2 all eight sections: header (archived banner + Restore, second contact, Call/Email draft/Website/Ask for a quote → 8.2 dialog/Assign to a problem/Edit/More: Archive or Restore, Delete for admins), Paperwork (compliance chips, Ask for a certificate / W-9 / both, Update, last requested lines, details incl. business type, EntityDocuments, Read the certificate → Use it), Rates and terms, Ratings (board average + tag counts + board rating; Google with closed warning and `GoogleRefresh`; web source links and "From their website" tags), Work with you (totals, usual-for tasks, bills, 20 history items + Show all), Reviews (radio stars, tags, own edit, admin delete with confirm), Notes (summary + log, own edit, admin delete), Emails (drafts + sent history). |
| `src/app/contractors/vendor-form.tsx` (rewritten) | §10.3: phone, email or website; emergency checkbox with hint; job tags; other contact; payment methods; grouped trades; W-9 untick confirm; em dashes removed from two option/hint strings; `AddVendorButton` `variant`, `EditVendorButton` `label`. |
| `src/app/repairs/upkeep-view.tsx`, `upkeep-forms.tsx` (rewritten) | §12.2: Answer, toolbar (Add a job dialog, usual checklist sheet with "Only if your building has one", Add to your calendar + note), All/Overdue/Next 60 days pills, schedule groups (client list so "Logged. Next due …" survives the refresh), row More menu (Edit, Turn into a problem / Open problem #n, Find someone, History, Archive), mark-done panel with sticky actions and `How did {name} do?`, Recently done, Archived jobs ({n}) page with Restore, Bills-tab line; owner/accountant layouts; empty states. Task dialog per spec (monthly hint, anchor-month hint, trade guessed from the name until picked, add vs edit date hints). |
| `src/app/repairs/upkeep/[taskId]/page.tsx`, `task-history.tsx` (new) | §12.3: header, Next time card with board buttons (Mark done, Turn into a problem / Open problem, Find someone, Edit, Archive/Restore, Delete for admins without history), History table (cards on phones) with inline edit and admin delete confirm, totals, Problems from this job. |
| `src/app/repairs/bills-view.tsx` (rewritten), `src/app/bills/bill-form.tsx` (new) | §13.2: Answer, Stat, Add a bill panel, Active/Paused/Archived pills, rows with pills/amount/next (autopay rolled forward)/last paid, Mark paid or Confirm it went through sheet (sends the due date shown, refreshes it on "already marked"), Edit sheet, More (Pause/Resume, Payment history, Archive/Restore), payment history list, empty copy, the old explainer card (text from HEAD's `/bills`). |
| `src/app/repairs/page.tsx` | Only the three view calls (`UpkeepView`, `ContractorsView`, `BillsView` now take `supabase`, `viewer` and their params) and the `first()` helper replacing `contractorsParams`. |
| Deleted | `src/app/contractors/draft-panel.tsx`, `find-panel.tsx`, `[vendorId]/notes-editor.tsx`, `[vendorId]/review-form.tsx` (replaced; nothing imports them). |
| Tests | New `tests/unit/repairs-find-params.test.ts` (8), `contractor-directory.test.ts` (8), `upkeep-view.test.ts` (9), `bills-view.test.ts` (5). `ai-max-duration.test.ts`: find page added to `PAGES`. `repairs-max-duration.test.ts`: the "until it exists" skip removed. |

## Deliberately different from the spec, and why

1. **Search runs over every contractor in TS** (name, contact person and trade label, every word) instead of a server `ilike` plus a TS trade match: one rule, the same result, and the list is capped at 1,000 rows.
2. **`want=none`** marks "every want switched off" so an urgent job's default (emergency) can be turned off; without it the default came back on each click.
3. **"Change" trade drops the phrase** (it described the old trade) and keeps the wants; a task's template phrase is used only when the resolved trade is the template's trade.
4. **Find page "Email"** on saved and found cards is a plain `mailto:` link to the address on file (as in the directory's contact row); written emails go through `Write to a contractor` / the quote dialog.
5. **Profile "Ask for a quote"** reuses R4's `RequestQuotesDialog` with this one contractor (`trade={null}`, no photos to attach) rather than navigating to the problem page, which has no way to preselect.
6. **Web-search remaining line** uses the area spec's "{used} of {limit} web searches used today"; at zero it uses the foundation's "No web searches left today. They reset at midnight." and disables the button.
7. **Bills Stat**: label "Regular bills", value "About {money} a month", note "Recurring bills only". The paused note shows in the row's note line ("Paused: …").
8. **Upkeep "Recently done" and the task history** hide cost and contractor from owners (RLS lets owners read `upkeep_log`); accountants see both.
9. **The edit form keeps "Summary for the next board"** (the `notes` field) because `vendorFields` writes `notes` from the form; leaving it out would wipe the summary on every edit.
10. Saved-list empty copy lowercases the trade label ("do heating & cooling yet").
11. `loadTicketPage` (R4's `load.ts`) still builds its own quote candidates; switching it to `loadSavedCandidates` would change R4's ranking inputs (it ranks all trades), so left alone.

## Left undone / for other steps

- **Not checked in a browser.** The dev database doesn't have 0052/0053 and sign-in needs the dev credentials; every page here would only show errors there. Check after the lead applies the migrations: `/repairs/find?ticket=…`, `?task=…`, `?trade=plumbing` (Google on and off, web idle/running/done), `/repairs?view=contractors`, `/contractors/{id}` (board, admin, accountant), `/repairs?view=upkeep` (board, owner), `/repairs/upkeep/{id}`, `/repairs?view=bills`, all at 375px.
- No DB tests run: this step changed no SQL.

## Cross-workstream requests

- **Integration:** `src/app/delinquency/reminder-letter-button.tsx` has a comment naming the deleted `src/app/contractors/draft-panel.tsx`; update the comment when convenient. Sidebar titles for `/repairs/find` and `/repairs/upkeep/[id]` (§18.6) are still Integration's.
- **Budget owner (§18.11):** `src/app/budget/add-bill-form.tsx` and `addRecurringBill` are no longer used by Repairs.

## Commands run

- `npx tsc --noEmit` (baseline): exit 0. After the find page and profile: 1 embed-cast error in my profile page (fixed) and 2 in `src/app/repairs/page.tsx` while the views' props were mid-change (fixed). Final: only `tests/db/email-reminders.test.ts(435-437)` errors, a file another engineer is editing (not touched here).
- `npx eslint src/app/repairs src/app/contractors src/app/bills src/lib/contractors src/lib/upkeep` + the six test files: exit 0.
- `npx vitest run tests/unit/repairs-find-params.test.ts tests/unit/contractor-directory.test.ts tests/unit/upkeep-view.test.ts tests/unit/bills-view.test.ts tests/unit/repairs-max-duration.test.ts`: first run 1 failure (my test expected a date where the rule correctly says "due in October"), test fixed; all pass.
- `npx vitest run tests/unit/ai-max-duration.test.ts tests/unit/repairs-max-duration.test.ts`: 13 passed.
- `npx vitest run tests/unit`: 121 files, 1466 tests passed.
- Copy check over every file this step wrote: no em dashes; no "vendor", "best" or "you should" in user-facing strings.
