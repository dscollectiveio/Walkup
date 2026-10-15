# I5-ui-market: insurance-spec §15 step 5 (second half) and step 6

Step owner: Insurance. Date: 2026-10-14. No git commands run; no migrations
touched or applied; no dev server started or stopped; no dependencies added.

## Built

| File | What |
|---|---|
| `src/app/insurance/quote-helpers.ts` (pure, client-safe) | `requestChip` (Draft ready / Sent {date} / Quote received / Declined / Expired / Chosen), `followUpOpensOn`/`canFollowUp` (7 days), `validityText` (Valid until / Expires in n days / Expires today / Expired), `premiumVsNow` ("+12% vs now", whole percent from cents), `MESSAGE_KIND_LABEL`, `messageStatusText`, `draftedByLine`, `contactSourceBadge`, `CONTACT_KIND_LABEL`, `roundUpTo10k`, `moneyInputText`, `addDays`, `hostOf`. |
| `src/app/insurance/quotes-data.ts` (server-only) | `loadContacts`, `loadRequests` (contact/partner name, the request's draft message, its quote), `loadQuoteList`, `loadMessages`, `inForceByCoverage`, `requestCoverages` (§9.6 item 2: in force plus gap/ask findings, flagged "from Coverage check"), `loadRequestFlow` (§9.7.2: contacts, per-coverage "wanted" inputs prefilled from the in-force policy with captions, crime = funds total rounded up to $10,000 "From your bank balances", deductibles today, current premium per coverage, building summary incl. facts, claims of the last 5 years, reply-to from the signed-in person). |
| `components/sheet.tsx` | `Sheet` (native dialog driven by `open`, full-screen on phones) and `SheetFooter` (error above buttons, safe-area padding). |
| `components/contact-dialog.tsx` | `ContactDialog` (§9.6 item 3 fields: name, kind, person, email, phone, website, city, state, lines, "This is our current agent", notes) on `saveContact`, field errors inline. |
| `components/message-sheet.tsx` | `MessageBody` (kind and "Drafted by Walkup / From Walkup's template / Edited by you" line, compose notice, `AiWritten` for model drafts, `DraftEmail` editable only while draft, `onSave` → `updateMessage`, `onMarkSent` → save then `markMessageSent`, "Cancel this draft") and `MessageSheet`. |
| `components/quote-buttons.tsx` | `RecordChoiceButton` (the §9.10 confirm, then `/insurance/policies/new?from_quote=`), `DeclineQuoteButton` (sheet with optional reason), `UndeclineButton`, `DeleteQuoteButton` (admin). |
| `components/owner-summary-view.tsx` | What owners see (§9.9): ended-period notice, master policy card with the coverage form in plain words, "If there's damage" (Repairs link, claims line `tel:`), deductible `Stat`s, "What the master policy leaves to you", "Proof of insurance for your lender" (`tel:`/`mailto:`), the ask-card slot, board note, footer. No server imports: the owner page and the editor preview share it. |
| `tabs/quotes.tsx` (replaces I4's interim) | §9.7: request flow at the top with `?new=1`, drafts `Answer` with "Review drafts" (#emails), Quote requests card (toolbar, rows by contact, empty copy), Quotes received by coverage with Compare, Emails card with "Write an email" menu, toast "{n} drafts ready…" on `?drafts=n`. Exports `WriteEmailMenu`. |
| `tabs/request-flow.tsx` | §9.7.2: who (emailable contacts, current agent first, "Asking two or three…" hint, inline Add a contact), what coverage (checkboxes, per-coverage wanted inputs, money parsed with `parseMoneyLoose`), about the building (read-only, "Not recorded", Edit building facts, admin/member address copy), share (current premium off, claim amounts off, claims preview, anything else, reply-to), consent sentence with the contact names, disclaimer, "Prepare {n} emails" / "Preparing…". |
| `tabs/request-rows.tsx` | Request rows by status: draft "Open draft"; sent "Upload the quote" (inline `ImportUploader`, quote mode, request id), "Enter the quote", "Write a follow-up" or disabled "Follow-up available {date}", "Mark declined" (reason sheet), "Set a follow-up date" (date sheet, clear); quote_received "See the quote" / "Add another quote"; declined/expired "Reopen". Read-only for accountants. |
| `tabs/quote-groups.tsx` | Quotes received grouped by coverage: header "{coverage}: {n} quotes" + Compare, carrier, contact, premium "vs now" (neutral), validity in warning text, Record our choice / Decline / Undo decline / Open. |
| `tabs/message-list.tsx` | Filter pills All / Drafts / Sent, rows (kind, contact, subject, status), the message sheet; `?open=` and `openMessage(id)` open a message. |
| `tabs/market.tsx` (replaces I4's interim) | §9.6 items 1 to 8: intro, "What you'd ask for", Your contacts (agent first, badges, kind, place, lines, Ask for a quote / Write / Open, Add a contact, empty copy), Agencies near {city} and Insurers in {state} cards (address missing, not configured, before first search with the decision-4 sentence, running with `PollWhileRunning` + 3 skeleton cards and dimmed previous results, failed by `ai_error`, stalled, results "Found {n} … on {date}", Search again / "Searched today", "{n} web searches left today"), agency cards (name link, verified city/state, "Their pages mention:" chips, quoted `about` "From {host}", phone/email or "Contact details: see their website", up to 3 numbered sources, IL DOI link in Illinois, Save to contacts → Saved, Ask for a quote), insurer cards (chips incl. state, AM Best line only when verified, NAIC link, Find an agent, the "don't mention associations" `<details>`, footnote), `FoundOnWeb`, Listed with Walkup (partners for the state), What insurance costs you (total, per unit per month, master history via `YearByYear`, the never-invent-prices copy), disclaimer. Accountants: the board-only card and the contacts read-only. |
| `tabs/market-parts.tsx` | `MarketSearch`, `FoundButtons` (`saveFoundContact` with `{kind, fetchedAt, key}`; Ask for a quote saves first), `PartnerButtons` (`savePartnerAsContact`), `AddContactButton`. |
| `tabs/owner-view.tsx` (replaces interim), `tabs/proof-request-card.tsx` | Owner view (§9.9) through `owner_insurance_summary` and `my_insurance_proof_requests` only; not published / published states; the ask card (kind select, 1,000-char note, "Ask the board", success copy, the RPC's rate-limit message, own requests "Asked {date}: Open" / "Handled {date}"). |
| `emails/new/page.tsx`, `emails/new/compose-form.tsx` | §9.7.1 compose: kind select, To (contacts with email, current agent default, the request's or quote's contact for follow-ups and thank-yous, "Type an email"), every kind's fields (certificate holder kind + name/address + lender hint + policy (master default) + the owner's note box; claim select + "Add the claim first"; change kind + details + policy; finding or "My own question" (template only); sent-request select; quote select; documents help; blank email), "Write the email" / "Writing…" / 20 s "Still working" line, then the draft in `MessageBody` with the template notice. |
| `quotes/new/page.tsx` | Manual quote entry on `ReviewForm` (quote mode; `?request` → request id, its contact and first coverage; `?contact`, `?coverage`, `?document`) plus "Have the quote as a file?" with the quote-mode `ImportUploader`. |
| `quotes/[id]/page.tsx` | Quote detail: header and chips, board buttons (Record our choice, Decline / Undo decline, Edit, Compare, Write a thank-you, Delete for admins), premium and per-unit tiles with "vs now", "What the quote states" per section with provenance ("Not stated"), lists, About this quote (from, received, valid until, the request it answers, notes), Documents, toast "Quote saved." |
| `quotes/[id]/edit/page.tsx` | `ReviewForm` quote mode, intent edit, stored provenance, contact, dates, notes. |
| `compare/page.tsx` | §9.10: title, coverage pills, Show/Hide declined (`?declined=1`), desktop table from `compareRows` (Now column or "No current policy", sections, premium first with per unit a month, "Not stated", chips with the full fact in sr-only text, `th scope`, Valid until row, Record our choice / Decline / "Open the quote PDF"), phone cards ("{carrier} vs now", changed rows first, "Everything else is the same or not stated"), note, disclaimer, empty state with both buttons. |
| `policies/[id]/switching.tsx` + `policies/[id]/page.tsx` | §9.10a `SwitchingChecklist` (ticks in localStorage per policy via `useSyncExternalStore`, try/catch, memory fallback) and the §10.5 step 7 `IssuedDeclarationsBanner` (upload → read → `/insurance/import/{readId}?update={policyId}`); the policy page computes the checklist with `switchingChecklist()` while the policy has `accepted_quote_id` and is upcoming or in its first 30 days. |
| `contacts/[id]/page.tsx`, `contacts/[id]/contact-actions-bar.tsx` | §9.11: header (name, badges, kind, person, place, source badge, phone, email, website, lines, found-on-the-web line with sources, partner line, notes), Ask for a quote / Write / Edit / Archive or Restore, Quote requests, Quotes, Emails (with Write an email), Policies where they're the agent. |
| `owner-summary/page.tsx`, `owner-summary/editor.tsx` | §9.9 editor: stale notice, master select (in-force/upcoming property), read-only coverage form (with "Change it on the policy"), deductibles and claims phone, editable "leaves to owners" with "Reset to Walkup's wording", tips, liability requirement, certificate contact select (recomputes the instructions), instructions, board note, Save draft, Publish (the spec's confirm), Unpublish, "Published {date}" / "You have unpublished changes." (key-order-independent compare), the Illinois Section 22.1 line with the ilga.gov link, live preview with `OwnerSummaryView`. Accountants see the published version read-only. |
| `sheet/page.tsx`, `sheet/print-button.tsx` | §9.12 facts sheet: heading and address line, one block per in-force policy (master first, then coverage order), policy number, period, main limits and deductibles of its effective sections, coverage form, claims phone, agent; footer; empty copy; print CSS hides the sidebar, top bar and footer. |
| `review/[documentId]/page.tsx`, `review/[documentId]/read-buttons.tsx` | §8.1 legacy shim: board only (others `notFound()`), latest read of the document in 30 days → redirect, otherwise "Read this document" with the two buttons (`startInsuranceRead` on click only), non-insurance files get the Document Hub link; `review/manual?mode=` redirects to the manual forms. |
| `src/lib/insurance/owner-summary-text.ts` (new, pure) | `LEFT_TO_OWNERS`, `COVERAGE_FORM_OWNER_WORDS`, `certificateInstructions`, `NO_AGENT_CERTIFICATE_INSTRUCTIONS`, `CoverageForm`, moved out of `owner-summary.ts` (which imports `node:crypto`) and re-exported from it unchanged. |
| `components/insurance-uploader.tsx` | `ImportUploader` gains optional `readHref(readId)` (the issued-declarations banner's `?update=`). |
| `page.tsx` | Passes `searchParams`, policies, check and `aiOn` to the new Quotes and Marketplace tabs. |
| `tests/unit/insurance-ui-market.test.ts` | 14 tests: request chips, follow-up window, validity text, premium vs now, email status and drafter lines, source badges, host names, crime rounding, money input text, `requestCoverages`, `inForceByCoverage`, the owner-summary wording split (same objects, no `node:crypto` import). |

**Step 6 deleted:** `src/app/insurance/actions.ts`, `upload-declarations.tsx`,
`quote-request-form.tsx`, `request-row.tsx`, `review/[documentId]/review-form.tsx`,
`review/[documentId]/waiting.tsx`. Nothing imported them after the shim was rewritten
(grep over `src` and `tests` came back empty). The shim page is kept.

## Deliberately different from the spec, and why

1. **The request flow is an inline panel at the top of the Quotes tab on every screen size** (`?new=1`), not a dialog on desktop. It has five sections and is long on any screen; one code path also keeps every entry point a plain link (finding cards, Overview, Marketplace, contact page).
2. **Request flow preselection:** `?contact=` (comma-separated ids allowed) ticks those contacts, otherwise the current agent; `?coverage=` ticks only that coverage, otherwise in-force lines plus open gap/ask findings. §10.5's "the agent plus the two agencies" happens only if the board ticks them (nothing records which agencies were "asked for a quote" before the flow opens).
3. **After "Prepare emails"** the client goes to `/insurance?view=quotes&drafts={n}&open={firstMessageId}`: the tab shows the "{n} drafts ready…" toast and opens the first draft (§8.4 step 5 says `drafts=1`).
4. **"Open draft"** on a request row opens the Emails card's sheet through a window event (`openMessage`), since the two lists are separate cards.
5. **Market polling** uses Foundation's `PollWhileRunning` every 5 s with the Foundation 330 s stale window, not a 3-minute cap: `runMarketResearch` refuses a new run while the row is "running" and younger than 330 s, so a 3-minute "Search again" would not start anything. The 60-second copy switch is replaced by `PollWhileRunning`'s own 45-second "You can leave this page" line, plus the fixed line "This usually takes under a minute. You can leave; results will be here." A run the server reports as stalled shows "The search didn't finish. Try again." with the search button.
6. **"{n} web searches left today"** under the search button (Foundation §10.3) and the button disabled at 0; not in §9.6 but Foundation's pattern for scarce kinds.
7. **"Find an agent for this insurer"** links to the first source URL whose path mentions "agent", else the website (the spec's "Find an agent page if it's among the sources").
8. **"Write" on a contact** opens compose with `kind=other` (a blank email); compose also has a kind select at the top so the board can switch. Compose without `?kind` starts on "Ask a coverage question".
9. **Certificate holder**: one textarea as specified; the first line is the holder's name and the rest its address (the action takes them separately). An error asks for that shape.
10. **Quote detail page** (only named in §3.1) is laid out like the policy page: header and chips, buttons, premium tiles, "What the quote states" per section with provenance, lists, About this quote, Documents. Delete is admin-only and hidden once the quote was chosen.
11. **Compare**: "neutral info" chips use the info tone; the declined toggle is a link (`?declined=1`); on phones a changed row also shows "Now {value}".
12. **`owner-summary-text.ts`** split out of `owner-summary.ts` (I2's file, same workstream) because the editor's preview is a client component and `owner-summary.ts` imports `node:crypto`. `owner-summary.ts` re-exports everything, so no caller changed.
13. **Owner summary editor**: the master parts (master, deductibles, claims line) always follow the chosen policy and are read-only as specified; a saved draft keeps its lists. The first tip (the master deductible tip) follows a policy change only while it still has Walkup's wording. Blank list items and blank optional texts are dropped on save. Accountants opening the route see the published version read-only (role matrix "view the published one").
14. **Switching checklist** "other received quotes" = same coverage, not chosen, quoted within 180 days before the new policy starts (declined ones included: they still get a thank-you). The issued-declarations banner shows while the policy has `accepted_quote_id` and no linked document other than the quote's; with AI off it points to Documents and Edit instead of an uploader.
15. **Facts sheet print CSS** is a `<style>` in the page that hides `nav[aria-label="Main"]`, `.app-shell > header` and `.app-shell > footer` (the layout and sidebar belong to Integration).
16. **Legacy shim** also redirects the old `/insurance/review/manual?mode=` link to `/insurance/policies/new` or `/insurance/quotes/new`.
17. Contacts without an email appear in the request flow only as a count ("… have no email address"), since they can't be asked.

## Not verified in a browser

Every insurance route still 307s to `/login` without a session and the dev project
doesn't have 0052, so nothing could be exercised signed in. `curl` of eleven new
routes (quotes and market tabs, `?new=1`, compare, compose, quotes/new, owner
summary, sheet, a contact, a quote, the shim): all 307, no 500. A throwaway script
(scratchpad, not in the repo) walked every `"use client"` module under
`src/app/insurance` through its non-type imports, treating `"use server"` modules as
boundaries: no client module reaches `server-only` or a `node:` import. Manual
checks §13.3 (including 7b, printing the sheet from Safari and Chrome) remain for the
lead after 0052 is applied.

## Left undone

- `src/lib/insurance/declarations.ts` still exports `GROUP_LABEL` and `policyWarnings`
  for "the legacy screens"; nothing in `src/` uses them now, only
  `tests/unit/insurance-declarations.test.ts`. Left in place (removing them means
  deleting I2's tests); they can go with those tests in a cleanup.

## Cross-workstream requests

- **Foundation:** `src/app/documents/upload/link-targets.ts` `LINKABLE_TABLES` still
  lacks `insurance_quotes` and `insurance_claims` (I4 asked too). Until it's added,
  the quote page's Documents card lists linked files but can't attach new ones.
- **Integration:** `pageTitleFor` (sidebar) should know `/insurance/compare`,
  `/insurance/contacts/*`, `/insurance/emails/new`, `/insurance/quotes/*`,
  `/insurance/owner-summary` and `/insurance/sheet`, besides I4's list. Home (I-1)
  can link owners to `/insurance` (the owner view now shows the published summary
  and the proof-of-insurance ask card).

## Commands run

- `npx tsc --noEmit` (several times): my errors fixed along the way (a `never`
  narrowing in `quotes/new`); the only other errors seen were Repairs files being
  edited concurrently (`src/app/maintenance/[ticketId]/load.ts`,
  `next-step-card.tsx`, `src/app/repairs/page.tsx`); the final run: 0 errors.
- `npx eslint src/app/insurance src/lib/insurance tests/unit/insurance-ui-market.test.ts`: exit 0.
- `npx vitest run tests/unit/insurance-owner-summary.test.ts` after the wording split: 9 passed.
- `npx vitest run tests/unit/insurance-max-duration.test.ts tests/unit/insurance-ui-helpers.test.ts`: 44 passed (every new page that hosts quote, request, message, market or import actions declares `maxDuration = 300`).
- `npx vitest run tests/unit/insurance-ui-market.test.ts`: first run 1 failure (my test matched the module's own comment mentioning node:crypto), fixed; 14 passed.
- `npx vitest run tests/unit`: 109 files, 1367 passed.
- `curl -s -o /dev/null -w "%{http_code}"` on eleven new routes at `http://localhost:3100`: all 307.
- DB tests not re-run: no migration, SQL or action changed in this step.
