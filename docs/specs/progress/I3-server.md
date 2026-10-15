# I3-server: insurance-spec §15 steps 3 and 4 (server libs and server actions)

Step owner: Insurance. Date: 2026-10-14. No git commands run; no migrations
touched or applied; no dev server started or stopped; no dependencies added.
No UI pages built (step 5).

## Built

| File | What |
|---|---|
| `src/lib/insurance/read.ts` (server-only) | `runInsuranceRead(supabase, readId)` per §7.1.7 steps 1 to 9: claim (`claim_insurance_read`, set), category re-check, download, `extractPdfPages` + unpdf page count, `chooseReadMethod`, not-configured, pass 1 outline, pass 2 details 3 at a time with the 270 s deadline, `postProcessRead`, every write guarded by `id` + `state='running'` + the claimed `started_at`. Exports `ReadOutcome`, `READ_COPY`, `readStateFor(code, method)` (the §7.1.7 step 7 table). |
| `src/lib/insurance/summary.ts` (server-only) | `writePolicySummary(supabase, policyId, { force })`: `summaryFacts` input, `SUMMARY_SYSTEM`, `checkSummary`, one retry with the reasons, `summary_error` on failure, never overwrites a board summary unless forced (update guarded by `summary_source`). `SUMMARY_COPY` holds the §7.2 UI copy. |
| `src/lib/insurance/market.ts` (server-only) | `runMarketResearch(supabase, kind, { force })` = §7.3.5 steps 1 to 4 (board, inputs, cache, quota claim, row claim) returning a `MarketJob`; `finishMarketResearch(supabase, job)` = steps 5 to 7 (webResearch with `verifyAgency`/`verifyInsurer`, `finalizeMarketItems`, cache write guarded by `ai_started_at`); `marketCoverages()`; `MARKET_COPY`. |
| `src/lib/insurance/draft.ts` (server-only) | `draftEmail({ supabase, associationId, kind, facts, values })` per §8.5: model with placeholder-only facts, `checkModelDraft`, `fillPlaceholders`; template fallback with the §8.5 notices. |
| `src/lib/insurance/queries.ts` (server-only) | `currentAssociation`, `isBoard`, `isBoardAdmin`, `adminNames`, `addressMissingCopy`, `unitCount`, `loadInsuranceContext`, `loadPolicies`/`loadPolicy` (with status), `loadQuote`, `loadFacts`, `fundsTotal`, `loadCheckInput` (fills `CheckInput.quotes`, as I2 asked), `INSURER_PAYEE_PATTERN`, `loadOwnerSummary`, `loadInsuranceBanners` (§9.1 item 0 / I-1), `ownerSummaryStalenessFor`, `stalenessSentence`. |
| `src/lib/insurance/errors.ts` (pure) | `friendlyDbError` exactly as §8. |
| `src/lib/insurance/save-input.ts` (pure, new) | `prepareFieldValues` (§8.2 steps 1, 2, 3, 5, 7 and the §8.3 mirror; section clearing and `clearLegacy` on edits), `parseLists`, `premiumBillOption` (§8.2 step 8), `agentFromValues`, `fieldErrorText`, `emptyColumnValue`, `FieldMeta`, `SourceEntry`. |
| `src/lib/insurance/contacts.ts` (server-only, new) | `upsertAgentContact` (§8.2 step 6, shared by policy and quote saves). |
| `src/lib/insurance/emails.ts` | Added `DRAFT_SYSTEM` (§7.4.3, verbatim) and `draftUserMessage`. |
| `src/lib/insurance/summary-check.ts` | Added `SUMMARY_SYSTEM` (§7.2, verbatim) and `summaryRetryNote`. |
| `src/app/insurance/action-helpers.ts` (server-only) | `revalidateInsurance(...extra)`, `actionContext(boardOnlyMessage | false)`, `isUuid`, `cleanText`, `isIsoDate`, `NO_ASSOCIATION`. Kept out of the `"use server"` files. |
| `src/app/insurance/import-actions.ts` | `startInsuranceRead` (category check, 30-day reuse in any state, insert, `after(runInsuranceRead)` with the client created in the action), `retryInsuranceRead` (attempt cap, quota only from the next day, guarded requeue), `skipReadItem`/`unskipReadItem`. |
| `src/app/insurance/policy-actions.ts` | `savePolicy` (§8.2 steps 1 to 12, duplicate check, agent contact + `set_current_insurance_agent`, premium bill, `after(writePolicySummary)`), `archivePolicy`, `deletePolicy`, `writeSummaryNow`, `saveSummaryText`, `trackPremium`, `recordAgentAnswer` (§8.2a). |
| `src/app/insurance/quote-actions.ts` | `saveQuote`, `declineQuote`, `undeclineQuote`, `deleteQuote`. |
| `src/app/insurance/request-actions.ts` | `createQuoteRequests` (draft first with no writes, then `create_insurance_quote_requests`), `setQuoteRequestStatus`, `setFollowUp`. Re-exports the `QuoteRequestPayloadV2` type. |
| `src/app/insurance/message-actions.ts` | `composeInsuranceEmail` (every kind of §7.4.2 plus `other`), `updateMessage`, `markMessageSent`, `cancelMessage`. |
| `src/app/insurance/contact-actions.ts` | `saveContact`, `archiveContact`, `saveFoundContact` (reads the cache row, matches `fetched_at` and `key`), `savePartnerAsContact`. |
| `src/app/insurance/claim-actions.ts` | `saveClaim` (validation, `closedOn` default, ticket revalidation), `deleteClaim`. |
| `src/app/insurance/facts-actions.ts` | `saveBuildingFacts(_prev, formData)`, `saveBuildingBasics`. |
| `src/app/insurance/market-actions.ts` | `startMarketSearch(kind, force)`. |
| `src/app/insurance/owner-summary-actions.ts` | `saveOwnerSummaryDraft`, `publishOwnerSummary`, `unpublishOwnerSummary`. |
| `src/app/insurance/owner-request-actions.ts` | `requestInsuranceProof`, `closeOwnerRequest`. |
| `src/app/insurance/check-actions.ts` | `dismissFinding`, `restoreFinding`. |
| `src/app/admin/partners/actions.ts` | `savePartner`, moved (§8.12); `partner-form.tsx` imports it from `./actions`; removed from `src/app/insurance/actions.ts` (the rest of that legacy file stays until the UI step deletes it, §15 step 6). |
| Tests | `tests/unit/insurance-read-run.test.ts` (13: the §13.2 `runInsuranceRead` list with mocked `runStructured` and a fake supabase, plus native PDF, quote forceReview, not_insurance, `readStateFor`), `tests/unit/insurance-draft-summary.test.ts` (9), `tests/unit/insurance-market.test.ts` (11), `tests/unit/insurance-save-input.test.ts` (15, incl. `friendlyDbError`), `tests/unit/insurance-actions.test.ts` (12: the actions against an in-memory Supabase fake; what reaches the model vs the RPCs), `tests/db/insurance-actions-contract.test.ts` (3: what `prepareFieldValues` builds is accepted by the real 0052 save RPCs in PGlite; edits clear a switched-off section; premium bill). No test calls the API. |

## Deliberately different from the spec, and why

1. **Pass-2 reads and the summary retry are separately metered.** Foundation's
   `runStructured` has no `step: "followup"` (F2 note) and `internal.ts` is
   off-limits to area code (import-guard test). So each pass-2 call and the
   summary's one retry go through `runStructured` and claim their own quota unit:
   a 3-policy package costs 4 `insurance_read` units, not 1. A pass-2 quota failure
   becomes that item's `detailError: "failed"` (or the read's `quota` state when
   every item failed). See the Foundation request below; switching back is a
   one-line change in `read.ts`/`summary.ts`.
2. `NATIVE_NOTE`/`IMAGE_NOTE` are appended to the pass-1 prompt too (the outline's
   page numbers need the same convention). For the text method, the page text is
   its own text block ("The document's text, page by page:") before the prompt.
3. `readStateFor`: `too_long` is `unreadable` for every method; `bad_request` is
   `unreadable` for native/image and `failed` for text (the table's "(native or
   image method)" read as qualifying `bad_request`).
4. When every pass-2 item fails, the read takes the first failure's state and no
   `result` is stored (a retry re-reads the whole file).
5. `composeInsuranceEmail` takes an extra optional `question` (the compose form's
   "My own question", template only, nothing to the model, §9.7.1). Kind `other`
   saves a blank draft with greeting and sign-off and an empty subject.
   `quote_request` through compose is refused ("Use Ask for quotes …"): it needs
   the request payload, which only `createQuoteRequests` builds.
6. `createQuoteRequests` drafts once for all contacts (§8.4 step 3): the facts'
   `recipientKind` is the contacts' shared kind (else "agency"), `isCurrentAgent`
   only when the one contact is the current agent; `{{agent_name}}` is filled per
   contact (agency person, else an agent's own name, else "there") by plain string
   substitution, so nothing the board typed is re-scanned for placeholders.
   `renewal_date` comes from the in-force policy of the first coverage (also the
   request's `policy_id`). `findingTopics` are open gap/ask findings on the
   requested lines.
7. The duplicate check (§8.2 step 4) also runs for read-item saves (they are new
   policies; the same declarations read twice is the case §6.5a describes).
8. `saveBuildingFacts` reads a hidden `_keys` field listing the questions the form
   showed, so an unanswered radio or unticked checkbox group in `?only=` mode clears
   only its own fact. Without `_keys` it uses the fact keys present in the form.
   **UI step: render `<input type="hidden" name="_keys" value="…">`.**
9. `saveOwnerSummaryDraft` leaves `source_policy_id` alone while a version is
   published (it and `source_hash` describe the published version; changing it from
   a draft save would make staleness compare the wrong policy).
10. `writeSummaryNow` always forces (the policy page confirms before replacing a
    board summary, §7.2). The background summary never overwrites a board one: its
    update carries `summary_source is null or <> 'board'`.
11. The agent contact becomes current when the saved policy's end date is today or
    later (active or upcoming), per step 6's "is or will be in force".
12. `setQuoteRequestStatus` sets `sent_at` whenever a request leaves `draft` (0041's
    `status = 'draft' or sent_at is not null`) and refuses on `accepted`; "Reopen"
    (`sent`) clears `declined_reason`.
13. Market: insurers are not filtered by state in `finalizeMarketItems` (they have
    no `state` field); `ai_error` stores the failure code (`quota_unknown` stored as
    `quota`). The cached-row "running" check happens before the quota claim, so a
    second click while a search runs costs nothing.
14. `savePartner` revalidates `/insurance` with the `layout` scope (it used the old
    page-only call). Otherwise unchanged.

## Left undone (later Insurance steps)

- All UI (§15 step 5), including `maxDuration = 300` on the §3.1 pages and
  `insurance-max-duration.test.ts`. The pages that host these actions must declare it.
- Deleting `src/app/insurance/actions.ts`, `upload-declarations.tsx`,
  `review/[documentId]/review-form.tsx` and `waiting.tsx` (step 6). Legacy screens
  still import the old actions and still compile.
- The legacy shim page `/insurance/review/[documentId]` (step 5).

## Cross-workstream requests

- **Foundation:** add a metered follow-up to `structured.ts`, e.g.
  `runStructuredFollowup({ ...opts, parent: AiClaim })` (callStructured +
  `logAiFollowup`), so a read's pass-2 calls and the summary retry count once, as
  insurance-spec §7 intends. Also `record_ai_call` allows only 3 follow-ups per
  parent; a read can make up to 8 pass-2 calls (`READ_LIMITS.maxPolicies`), so the
  cap would need to be 8 for insurance_read, or extra follow-ups go unlogged.
- **Foundation:** `verifyItems` hands `verify()` only the item's own citations
  (`citationsFor`). insurance-spec §7.3.4 step 11 checks the AM Best rating against
  "any citation in the response" with the `amBestSourceUrl`; when that page isn't
  among the item's `sourceUrls` (or on its host), the rating is dropped. Safe, but
  ratings will rarely survive. Option: add `allCitations` to `VerifyContext`.
- **Integration (I-1):** `loadInsuranceBanners(supabase, associationId)` and
  `stalenessSentence()` are in `src/lib/insurance/queries.ts`.
- **Repairs (R-1/R-5):** `saveClaim` revalidates `/maintenance/{ticketId}` and
  `/repairs`; `composeInsuranceEmail({ kind: "coverage_question", question, policyId })`
  is the template-only "Ask your agent" path.

## Commands run

- `npx tsc --noEmit` (after each lib and action file): clean for every file in this
  step. Errors seen along the way were all in Repairs files being built concurrently
  (`src/app/repairs/upkeep-actions.ts`, `tests/unit/upkeep-schedule.test.ts`,
  `tests/unit/contractors.test.ts`), not touched here.
- `npx eslint src/lib/insurance src/app/insurance src/app/admin/partners tests/unit/insurance-*.test.ts tests/db/insurance-actions-contract.test.ts`: clean.
- `npx vitest run tests/unit/insurance-read-run.test.ts`: 13 passed (first run).
- `npx vitest run tests/unit/insurance-save-input.test.ts`: 15 passed.
- `npx vitest run tests/unit/insurance-draft-summary.test.ts`: 9 passed.
- `npx vitest run tests/unit/insurance-market.test.ts`: first run failed to load (vi.mock factory used top-level variables); moved them into `vi.hoisted`; 11 passed.
- `npx vitest run tests/unit/insurance-actions.test.ts`: 1 failure in my fixture (a carrier name that `carrierKey` rightly treats as different), fixed; 12 passed.
- `npx vitest run tests/unit`: 98 files, 1199 passed (includes `ai-internal-imports`).
- `npx vitest run tests/db/insurance-actions-contract.test.ts`: 3 passed.
- `npx vitest run tests/db/insurance-v2.test.ts tests/db/insurance.test.ts`: 135 passed.
