# FX2: server fixes from docs/security/REVIEW-2-server.md

Every finding (1 blocker, 6 major, 22 minor) is addressed in code. Regression tests are in `tests/unit`
(names below); none could run against a database here, so the two SQL edits are covered by a static test.
Checks run: `tsc` (clean except `tests/db/imports.test.ts` percent_total, another engineer's), `eslint` on every
touched path (clean), `vitest` on the new and touched unit tests. The only failing unit test in the tree is
`money-copy.test.ts` (Terms/Privacy copy, REVIEW-3's area).

## SQL changes (migration 0055, unreleased, edited in place)

1. `email_run_rules`: a rule is picked up only while `enabled_by` still holds an active `board_admin` grant in that
   association (join on `role_grants` and `persons`, `revoked_at is null`, `expires_on` honoured). (#20)
2. `email_clear_suppression`: deletes only `reason = 'bounce'`; a spam complaint stays. (#23)

No other migration was touched.

## Findings

| # | What changed | Files | Regression test |
|---|---|---|---|
| 1 Blocker | `classifyDocument` now goes through `runStructured` (kind `document_classify`: claim before, finish after, database refuses a non-board caller). Its own `new Anthropic` and the unused `extractDeclarations` are deleted. `rerunExtraction` and `runExtraction` check `is_board` first. The deprecated `uploadDocuments` and `uploadAndLinkDocument` (no callers) are deleted. SDK may be imported as a value only under `src/lib/ai`. Raw model error text no longer goes to `documents.extraction_error`. | `src/lib/documents/classify.ts`, `pipeline.ts`, `src/app/documents/actions.ts`, `link-actions.ts`, `src/lib/ai/client.ts` (comment) | `documents-pipeline-roles.test.ts` (owner reaches no model call, no write), `review2-documents.test.ts`, `ai-sdk-import-guard.test.ts` |
| 2 | `createLinkToken` and `connectBank` ask `has_role_in(board_admin)` before anything; `connectBank` does so before `itemPublicTokenExchange`, and calls `itemRemove` if `store_bank_connection` fails (logged with `plaidErrorLog`, message to the page is generic). | `src/app/bank-feed/actions.ts` | `bank-feed-roles.test.ts` |
| 3 | `evidence()` uses `verifyWebsite` (http/https only, aggregators by exact match, search's own spelling), then keeps scheme, host and path only. `VerifyCtx` carries `searchUrlsExact` and `urlSpelling`. New `safeHttpUrl()` guards every model/web/DB-derived `href` (market tab, find results, contractor list, insurance contact). `AGGREGATOR_HOSTS` extended (x, twitter, youtube, github, medium, reddit, pinterest, tiktok, linktr.ee, bit.ly, t.co, wixsite, fb, g.page, business.site, and more). | `src/lib/insurance/market-verify.ts`, `src/lib/ai/verify.ts`, `src/lib/security/safe-url.ts`, `src/app/insurance/tabs/market.tsx`, `repairs/find/find-results.tsx`, `repairs/contractors-view.tsx`, `insurance/contacts/[id]/page.tsx` | `review2-verifiers.test.ts` (3) |
| 4 | New `ratingStatedFor`: the grade must be a token in one sentence that names the insurer, AM Best and a rating cue; "A.M. Best" is masked first and a lone "A" before a lower-case word is an article. `verifyRating` (shared) now needs a rater name of 3+ letters matched as a whole word, blanks the rater's own letters before looking for a grade, and needs a rating cue beside a bare number. Improvement over the report: the foundation `verifyRating` is hardened rather than replaced, and the insurance check is its own sentence rule. | `market-verify.ts`, `verify.ts` | `review2-verifiers.test.ts` (4) |
| 5 | Rule 7: rating needs a star/"out of 5"/directly-before-count cue (not "4.5 miles"), the count must be followed within 15 characters by reviews/ratings, the two within 80 characters, `ratingSource` must be named in that passage or be the page's host, and a rating whose only citation is the contractor's own site is dropped. | `src/lib/contractors/web-verify.ts` | `review2-verifiers.test.ts` (5) |
| 6 | `isSingleMailbox()` required for contractor and agency email; agency phone/email only from the agency's own site or the `nameSegments` after its name; every dynamic `mailto:` href uses `mailtoLink()` (encoded); `vendorFields` and contractor draft `to_email` validated. | `verify.ts`, `market-verify.ts`, `web-verify.ts`, `src/lib/email/mailto.ts`, `src/app/contractors/vendor-actions.ts`, `actions.ts`, and the 11 components that built `mailto:${...}` | `review2-verifiers.test.ts` (6), `review2-contractor-actions.test.ts`, `review2-text-safety.test.ts` |
| 7 | One helper `safeNext()` (`src/lib/security/safe-next.ts`): plain printable-ASCII path, no backslash/control/line-separator, no `//` start (also after up to 3 percent-decodings), origin check, 2,048 cap. Used by `/auth/confirm`, the MFA challenge action and page. The invite redirect in `login/actions.ts` now encodes the token. | `src/lib/security/safe-next.ts`, `src/app/auth/confirm/route.ts`, `login/mfa-challenge/actions.ts`, `page.tsx`, `login/actions.ts` | `safe-next.test.ts` |
| 8 | An announcement email carries the board's words only if they hold no link, `@`, bare domain or 8+ digit run (a written date is fine); otherwise it is the title and "sign in to read". The title is checked the same way. | `src/lib/email-outbox/templates/announcement.ts` | `email-templates.test.ts` (updated one test that expected a link in the body; added the new case) |
| 9 | `headerForAi` treats data-shaped headers as data (amounts, dates, number-first addresses, City ST ZIP, capitalised name pairs with no title word). The existing "Suggest with AI" click and "What was sent" panel are unchanged. | `src/lib/import/shape.ts` | `review2-text-safety.test.ts` |
| 10 | `redactTaxIds` folds with NFKC and maps every dash to `-`, allows `[\s.-]{0,3}` between groups (PDF line breaks), a keyword rule (`TIN 1 2 3 ...`) and `123-456-789`. Plain space-separated 3-3-3 is left alone unless a keyword precedes it (unit lists). | `src/lib/documents/redact.ts` | `review2-text-safety.test.ts` |
| 11 | `loadRedactionTerms` reports `unavailable` on a failed lookup and `webResearch` then refuses before claiming. `scrubWebTask` handles Ave/Avenue-style variants, bare street addresses, `1900 N Clark`, spelled-out units and phone numbers, `x at y dot com`. `scrubForModel` drops capitalised name pairs. A lone first name can still pass (documented in the file and the privacy page). | `redaction.ts`, `web-research.ts`, `verify.ts`, `src/lib/repairs/scrub.ts` | `ai-redaction-terms.test.ts`, `ai-web-research.test.ts`, `review2-verifiers.test.ts` (11) |
| 12 | Per-person 30/minute limiter (in-memory, per instance; stated in the file), 429 with `Retry-After`, `id` length/shape cap. | `src/lib/security/rate-limit.ts`, `src/app/api/address/route.ts` | `review2-routes-and-sql.test.ts` |
| 13 | `kid` must be `[A-Za-z0-9_-]{1,64}`; unknown kids are remembered 5 minutes (max 200); calls for one kid share one request; at most 4 lookups in flight. | `src/lib/plaid/webhook-verify.ts` | `plaid-webhook-verify.test.ts` (changed "never caches a miss" to the new rule), `review2-routes-and-sql.test.ts` |
| 14 | Recipients with `, ; < > "`, whitespace or control characters are dropped; subjects collapse control characters; stored subject/`to_email` in contractor drafts are cleaned and validated. | `mailto.ts`, `src/app/contractors/actions.ts` | `review2-text-safety.test.ts`, `review2-contractor-actions.test.ts` |
| 15 | Document search uses `postgrestIlikeValue`. | `src/lib/documents/access.ts` | `review2-text-safety.test.ts` |
| 16 | `escapeText` turns every control and line-separator character (VT, FF, NEL, U+2028/9, tab, DEL) into a space. | `src/lib/tax/ics.ts` | `review2-text-safety.test.ts` |
| 17 | Allow-list of shareable categories (`governing`, `minutes`, `financial_statement`) and never a unit-restricted file. | `src/lib/owner/shareable-documents.ts`, `src/app/announcements/actions.ts` | `review2-actions.test.ts` |
| 18 | A ticket photo that the browser cannot re-encode is refused with a "save as JPEG" message instead of uploading the original with its EXIF. Documents unchanged. | `src/components/upload/upload-file.ts`, `upload-copy.ts` | `review2-photo-upload.test.ts` |
| 19 | After the `documents` insert, `registerUpload` downloads the object again and compares the checksum; a mismatch soft-deletes the row, marks it skipped and returns the mismatch message. | `src/app/documents/upload/actions.ts` | `review2-register-upload.test.ts` |
| 20 | SQL (above). | `0055_email_reminders.sql` | `review2-routes-and-sql.test.ts` (static) |
| 21 | `addUnitCharge` for a late fee ignores the browser's amount, uses `associations.dues_late_fee_amount`, and refuses when an unwaived late fee already exists for that unit and period. | `src/app/dues/actions.ts` | `review2-actions.test.ts` |
| 22 | Aggregator list (see 3); `isGenericName` drops names made only of trade/place words; `hostCarriesName` matches whole host labels (prefix only for words of 4+ letters). | `verify.ts`, `web-verify.ts` | `review2-verifiers.test.ts` (22) |
| 23 | SQL (above) and the Clear button is hidden for complaints. | `0055_email_reminders.sql`, `src/app/dues/email/settings-client.tsx` | `review2-routes-and-sql.test.ts` (static) |
| 24 | `quoteRequestPayloadSchema` (lengths, counts, ranges, unknown keys dropped) runs before the existing checks. | `src/lib/insurance/request-payload.ts`, `src/app/insurance/request-actions.ts` | `review2-actions.test.ts` |
| 25 | `documentError()` for document actions and `friendly()` for dues actions; the pipeline no longer stores raw download text. | `src/lib/documents/errors.ts`, `src/app/dues/actions.ts`, `documents/*` | `review2-documents.test.ts`, `review2-actions.test.ts` |
| 26 | `createTicket` stops at 25 problems per person per 24 hours (a retry of an earlier submit still returns the first ticket). | `src/app/maintenance/actions.ts` | `review2-actions.test.ts` |
| 27 | `searchPlaces({ cacheOnly })` answers from the 24-hour cache and returns `idle`; the page asks that way on mount and shows a "Search Google near your building" button for a live call. | `src/app/repairs/find/actions.ts`, `find-results.tsx` | `review2-find-google.test.ts` |
| 28 | Compare-and-swap claim on `bank_connections.last_synced_at` before an auto-sync, released if the sync does not finish; the in-memory cooldown stays as a cheap first filter. | `src/lib/plaid/auto-sync-claim.ts`, `src/app/bank-feed/page.tsx` | `review2-actions.test.ts` |
| 29 | The `currentAssociationId`-style helpers (documents, repairs, bank feed, dues, tax, building) plus the owner viewer and insurance `currentAssociation` now order by `created_at, id` before taking the first. The remaining inline `associations ... limit(1)` reads were left; the database guards still prevent cross-association writes. | seven helpers listed in the diff, `src/lib/owner/viewer.ts`, `src/lib/insurance/queries.ts` | `review2-actions.test.ts` |

## Not done, or done differently

- **21, unique index:** no partial unique index on late-fee charges. Production may already hold duplicate late fees
  (the defect is live), and a failed index build would block the migration. The server check closes the repeat click
  and the second board member; a true simultaneous double submit is still possible. Add the index after a duplicate
  cleanup. Money still crosses as JS numbers in the other `dues/actions.ts` functions (REVIEW-4's area).
- **24, association facts from the database:** the payload is now bounded, but address, unit count and similar facts
  still come from the board member's browser rather than being re-read from `associations`.
- **9, request preview before sending:** the "Suggest with AI" button is already a click and the "What was sent" panel
  already exists; the fix is the header heuristic. A single-word first-row value (a bare first name) is not caught.
- **11:** a lone first name in a ticket can still reach the triage model; stated in `scrub.ts`.
- **12 and 28:** the limiter and the cooldown are per instance or best effort; the sync claim is exact.
- **22, "names equal to the page title":** not applied. A business's homepage title is often its exact name, so the
  rule would drop real contractors. Generic-word names are dropped instead.
- **29:** only the shared helpers were ordered, not all 30 inline reads.
- **1, 2 (production notes):** the live-in-production items need these files deployed together: `pipeline.ts`,
  `classify.ts`, `documents/actions.ts` (owners lose the Re-read button's effect; it now answers with a refusal),
  `bank-feed/actions.ts`, `safe-next.ts` and its three callers.
