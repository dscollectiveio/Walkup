# Security review 2: server actions, route handlers and libraries

**Reviewer stance:** hostile, read-only. Nothing in the repository was changed except this file. No remote Supabase project, Anthropic, Plaid, Resend or Google call was made; no dev server was started or stopped.

**Scope:** every server action and route handler added or changed in the Insurance and Repairs overhaul and the money, import and owner-portal work: `src/app/{insurance,repairs,maintenance,contractors,bills,owner,documents/upload,building/import,dues,delinquency,unsubscribe,api}`, plus the changed `src/app/{documents,bank-feed,announcements,statements,login/mfa-challenge}` actions they touch, and `src/lib/{ai,email,email-outbox,import,insurance,contractors,repairs,plaid,google,documents,upkeep,address}`, `src/lib/supabase/proxy.ts` and the SQL functions those actions call (read for authorisation only).

**Standard:** `docs/specs/insurance-repairs-overhaul.md`, `docs/specs/foundation-spec.md`, `docs/DECISIONS.md` (#4, #20, #22, #25, #26, #28, #31, #35, #36, #37), `docs/security/ATTACK-REPORT-1.md`.

**Method:** read every action and route; traced each id from the browser to the RLS or RPC that decides; tried to defeat the anti-fabrication verifiers, the redaction code, the redirect checks, the ICS and mailto builders and the import prompt builder with scratch tests that live **outside** the repo.

**Reproducing the proofs:** the scratch tests are in
`/private/tmp/claude-501/-Users-dougsmart-Desktop-Claude-Code/1b96944a-acd7-43cd-9ccd-ed28497e667d/scratchpad/review-b/` (`t1`..`t8.test.ts`, `vitest.config.mts`, a `server-only` stub). Run:

```
cd /Users/dougsmart/Projects/walkup
npx vitest run --disableConsoleIntercept \
  --config /private/tmp/claude-501/-Users-dougsmart-Desktop-Claude-Code/1b96944a-acd7-43cd-9ccd-ed28497e667d/scratchpad/review-b/vitest.config.mts
```

**Production reminder:** migrations 0051 to 0059 and the new code are not in production. Findings marked "live now" are in code or SQL production already runs.

## Summary

| # | Severity | Finding | Live now? |
|---|---|---|---|
| 1 | Blocker | Any owner can trigger unmetered Opus calls (`rerunExtraction`); the document classifier bypasses `claim_ai_call` | yes |
| 2 | Major | Plaid Link token and public-token exchange have no role check; orphan billable Items | yes |
| 3 | Major | Market search keeps a model-written `website` verbatim: `javascript:`, `data:`, `file:` and `ftp:` URLs reach `href` | no |
| 4 | Major | AM Best rating verification is defeated by ordinary English (`A mutual company...`, `A.M. Best` itself) | no |
| 5 | Major | Contractor rating check needs no rating context and never checks the source label; a self-published rating is shown as "Google" | no |
| 6 | Major | Contact details are attributed to the wrong business (neighbouring listing) and can carry `mailto:` parameters | no |
| 7 | Major | Open redirect: `next=/\evil.example` passes the `//` check (MFA challenge, `/auth/confirm`) | yes |
| 8 to 29 | Minor | See the list below | mixed |

Counts: 1 blocker, 6 major, 22 minor.

---

## Blocker

### 1. Owner-reachable, unmetered model call: `rerunExtraction` and `classifyDocument`

**Where:** `src/app/documents/actions.ts:164-177` (`rerunExtraction`), `src/lib/documents/pipeline.ts:135` (`classifyDocument(...)`), `src/lib/documents/classify.ts:76-96` (`new Anthropic({ apiKey })`). Also reached from `src/app/documents/upload/actions.ts:357-367` (every hub upload, `read !== false`), `src/app/documents/link-actions.ts:103` and the deprecated `uploadDocuments`.

**What is wrong:** two defects that compound.
1. `rerunExtraction(documentId)` checks only that the document row is *visible* to the caller, then calls `runExtraction`. Nothing checks `is_board`. An owner can see every `all_owners` document (`documents_select`, migration 0020 lines 428-442) and can download its bytes (`documents_read` on `storage.objects`, 0020:463). The `UPDATE`s inside `runExtraction` are silently filtered by RLS (zero rows, no error), so the function carries on to the paid call.
2. `classifyDocument` builds its own Anthropic client and never calls `claimAiCall`/`claim_ai_call`. `document_classify` exists as a kind with a daily limit of 200 (`src/lib/ai/kinds.ts`, mirrored in SQL), but the only caller that claims it is the import column mapper (`src/lib/import/ai-mapping.ts`). DECISIONS #35.10 says "Every model call is claimed and logged ... enforced in the database before the call." The `ai-internal-imports` test only guards `internal.ts`; it does not stop `new Anthropic` elsewhere. Had the call gone through `runStructured`, the database would have refused a non-board caller (`claim_ai_call` allows non-board only `ticket_triage`).

**PROOF (scratch test `t4.test.ts`, run as an owner-shaped client: row and object readable, all UPDATEs filtered):**
```
Q1 trace: ["UPDATE documents (RLS filters it)","classifyDocument (Anthropic call)","UPDATE documents (RLS filters it)","UPDATE documents (RLS filters it)"]
```
Code path: `rerunExtraction` -> `runExtraction` -> `storage.download` (allowed) -> `extractDocumentText` -> `classifyDocument` -> `client.messages.parse` with up to 60,000 characters in and `max_tokens: 16000` with adaptive thinking. A loop of this call, from any signed-in member who can see one text-layer governing document, has no ceiling. Board members have the same hole through uploads (new bytes each time defeat the checksum dedupe) and `rerunExtraction`.

**Fix (all of):**
- `rerunExtraction`: `rpc("is_board", { assoc })` first; return the existing refusal copy for anyone else. Same guard at the top of `runExtraction` (it takes a bare client and a document id; refuse unless `is_board(doc.association_id)`).
- Route classification through `runStructured({ kind: "document_classify", ... })` (claim before, `finish_ai_call` after, `claim` passed in when the caller pre-claims). Delete the unused `extractDeclarations` export and the second `new Anthropic`.
- Add a unit test: only files under `src/lib/ai/` may import `@anthropic-ai/sdk`.
- Delete the deprecated `uploadDocuments` and `uploadAndLinkDocument` actions (they remain callable server actions; neither checks the role before `after(runExtraction)`), or add the same board check.

**Production impact:** live now. `rerunExtraction`, `runExtraction` and `classifyDocument` exist in the deployed hub (#25). If `ANTHROPIC_API_KEY` is set in production, any owner at AAL2 can run unlimited paid calls today. Worst case is cost; writes are refused by RLS, so no data is changed.

---

## Major

### 2. `createLinkToken` and `connectBank` have no role check; any member can mint billable Plaid Items

**Where:** `src/app/bank-feed/actions.ts:40` (`createLinkToken`) and `:161-182` (`connectBank`).

**What is wrong:** `createLinkToken` only needs an association id and a signed-in user, so an owner or the accountant gets a Link token. `connectBank` then calls `plaidClient().itemPublicTokenExchange` (line 171) **before** anything checks the role. `store_bank_connection` is board-admin only (0016:139), so the insert fails with 42501 and the function returns `error.message`, but the Plaid Item already exists and its access token is dropped when the function returns. Nothing calls `itemRemove`. Each such call leaves a live, Production-billable Transactions Item that Walkup cannot retire (no stored token, `plaid_item_id` never saved). Compare `createUpdateLinkToken`, `syncBankTransactions`, `registerBankWebhook` and `disconnectBank`, which all call `readBankToken` (an admin-only RPC) first.

**PROOF (code path):** owner session -> `createLinkToken()` returns a token -> Plaid Link with the owner's own bank login -> `connectBank(publicToken, "x")` -> line 171 succeeds -> line 182 rejects -> return. No `has_role_in`, no `is_board`, no `itemRemove` between 161 and 190.

**Fix:** at the top of both actions, `rpc("has_role_in", { assoc, roles: ["board_admin"] })`; refuse otherwise. In `connectBank`, if `store_bank_connection` fails after the exchange, call `plaidClient().itemRemove({ access_token })` before returning, and log with `plaidErrorLog`.

**Production impact:** live now (the order is the same in the deployed file). Cost is per orphan Item per month, plus an unauthorised party linking a real bank under the association's Plaid client.

### 3. Market search keeps the model's `website` string verbatim: dangerous schemes reach `href`

**Where:** `src/lib/insurance/market-verify.ts:213` (`evidence()`), rendered at `src/app/insurance/tabs/market.tsx:87` (`<a href={website}>`).

**What is wrong:** `evidence()` accepts `item.website` when `searchUrls.has(normaliseUrl(w))` **or** `hostInSearch(w, searchUrls)`, then stores `item.website.trim()` as the website. `normaliseUrl` and `hostOf` ignore the scheme, so any scheme with the right host passes. The verbatim string (query, fragment, scheme) is kept; `verifyItems` respells only `sourceUrls`, not this field. `saveFoundContact` re-filters with `^https?://`, but the market tab renders the raw item. `hostInSearch` also approves *any path* on a host that appeared in the results, including shared platforms that are not in `AGGREGATOR_HOSTS` (see 22).

**PROOF (scratch test `t2.test.ts`, `t1.test.ts`):**
```
J "javascript://acmeagency.com/%0Aalert(document.domain)" => "javascript://acmeagency.com/%0Aalert(document.domain)"
J "data://acmeagency.com/"  => "data://acmeagency.com/"
J "file://acmeagency.com/etc/passwd" => "file://acmeagency.com/etc/passwd"
J "ftp://acmeagency.com/" => "ftp://acmeagency.com/"
E1 "https://acmeagency.com/anything?redirect=https://evil.example" => kept verbatim
E2 shared platform website => https://medium.com/@attacker/pay-here
```
The `javascript://host/%0A...` form needs only one search result on that host and a model that emits the string (an injected page can ask for it; the structuring prompt tells the model to ignore page instructions but nothing in code enforces the field). The CSP (`script-src 'self' 'nonce-...' 'strict-dynamic'`, no `unsafe-inline`) should stop a `javascript:` navigation in current browsers; it is the only barrier.

**Fix:** in `evidence()` call the foundation's `verifyWebsite(item.website, { searchUrls, searchUrlsExact, urlSpelling })` (http/https only, aggregator hosts by exact match, respelled to the search's own URL, or rebuilt as `https://host/`), and pass `ctx.urlSpelling` from `verifyItems`. Add a `safeHttpUrl()` guard at the render site. Extend `AGGREGATOR_HOSTS` (item 22).

**Production impact:** none yet (0052 and the market tab are not deployed). Fix before release.

### 4. AM Best rating verification is defeated by ordinary English

**Where:** `src/lib/insurance/market-verify.ts:320-337` (`verifyInsurer`), and the foundation's `verifyRating` (`src/lib/ai/verify.ts:268-333`), which the areas do not use.

**What is wrong:**
- `verifyInsurer` removes the words "A.M. Best" and then accepts the rating if a single-letter token appears **anywhere** in the cited text (`(^|[^A-Za-z+\-])A($|[^A-Za-z+\-])`), not near the insurer's name. The article "A" at the start of a sentence is a token. Another insurer's `A+` in the same snippet counts for this insurer.
- `verifyRating` accepts the "A" of "A.M. Best" itself as the grade (the strict boundary after `A` is `.`), and takes the label from a regex built from model text that is not word-bounded (`label: "a"` matches any window).
- The foundation helpers `verifyRating` and `verifyClaims` are exported but **no area calls them**; both areas wrote weaker private versions.

**PROOF (scratch tests `t1`, `t5`):**
```
B1 amBestRating => A   verified.rating = true      (text: "A.M. Best is an insurance rating agency. A mutual company, Acme Mutual Insurance writes condo master policies.")
B2 other insurer's A+ attributed to Acme => A+     (text: "A.M. Best rates Zenith Mutual A+. Acme Mutual Insurance is a regional carrier.")
R1 verifyRating(A, 'AM Best') on "A.M. Best publishes financial strength ratings for insurers." => {"value":"A","label":"AM Best","reviews":null}
A1 verifyRating(4.9,'a') on "Release notes: version 4.9 shipped today." => kept
```
The board sees a financial-strength grade with a "verified" tick that no source gave for that insurer. DECISIONS #35.3 and brief 5 promise the opposite.

**Fix:** require the grade to be adjacent to the rating agency label *and* the insurer name in the same sentence (a pattern like `<insurer name> ... (A\+\+|A\+|A|...) ... (rating|rated|AM Best)` or `AM Best ... rating of X`), reject the letter when the only match is part of "A.M. Best", and reuse one shared implementation. In `verifyRating` bound the label to a fixed allowlist (`AM Best`, `BBB`, `Google`, `Yelp`, `Angi`, ...), whole-word match, and exclude the label's own letters from the grade search.

**Production impact:** none yet.

### 5. Contractor rating: no rating context, source label never checked, self-published ratings relabelled

**Where:** `src/lib/contractors/web-verify.ts:290-309` (rule 7).

**What is wrong:** a rating `4.5` and count `14` are kept if both numbers appear within 80 characters of each other inside the 200-character segment after the business name. There is no requirement for "stars", "reviews" or "rating", and no unit exclusion (miles, years, technicians). `ratingSource` is any model string of up to 30 characters and is **never compared with the text**, so a rating printed on the contractor's own website is presented as "Google 5.0 from 500 reviews, as listed on <date>" (`src/lib/contractors/ranking.ts:215` builds that sentence). Ranking uses the Bayesian score, so a self-declared `5.0 x 500` outranks honest competitors.

**PROOF (scratch test `t1`, group C):**
```
C1 rating kept => 4.5 14 Google   (text: "Acme Plumbing serves Chicago since 2010 with 14 technicians. Our shop is 4.5 miles from the Loop.")
C2 rating kept => 5 500 Google    (text: "Acme Plumbing - rated 5.0 by 500 happy customers")
```
**Fix:** require the count to be followed within 15 characters by "review(s)/rating(s)" and the rating by a star or "out of 5" cue; require `ratingSource` (normalised) to appear in the same segment or in the citation's host; reject ratings whose only citation is the contractor's own site, or show them as "Their website says...". Prefer calling the corrected shared `verifyRating`.

**Production impact:** none yet.

### 6. Contact details attributed to the wrong business, and `mailto:` parameters accepted

**Where:** `src/lib/insurance/market-verify.ts:219-223, 279-281` (agency phone/email use all citations that merely *name* the agency); `src/lib/contractors/web-verify.ts:279-288` (email shape never checked); links built as `mailto:${email}` at `src/app/insurance/tabs/market.tsx:416`, `src/app/repairs/find/find-results.tsx:345`, `src/app/contractors/[vendorId]/profile-actions.tsx:56` (and similar), with no encoding.

**What is wrong:** (a) the contractor verifier segments a listing page by name and cuts at the second phone number; the insurance verifier does not, so a directory snippet listing two agencies lets the model keep the neighbour's number with `verified.phone = true`. (b) Neither verifier validates email *shape*; `appearsInCitations(email)` only checks character boundaries, so a page that prints `info@acme.example?bcc=attacker@evil.example` yields a "verified" address that becomes `href="mailto:info@acme.example?bcc=attacker@evil.example"` (hidden recipient, `body=`, `subject=` all injectable). Saved vendors keep the string too (`saveOne`, `find/actions.ts` row `email: c.item.email`).

**PROOF (scratch tests `t1` group D, `t3`):**
```
D1 phone kept => (312) 555-0199 verified.phone= true     (text: "Acme Insurance Agency (312) 555-0100. Baker Insurance Agency (312) 555-0199."; item = Acme with Baker's number)
M1 contractor email kept => info@acmeplumbing.com?bcc=attacker@evil.example
M2 agency email kept     => info@acmeagency.com?bcc=attacker@evil.example
```
Quote requests go to `contact.email`; `saveFoundContact` does reject two-`@` strings (`EMAIL_RE`), but not a neighbour's real address.

**Fix:** reuse `nameSegments` in `market-verify` (phone/email only from the segment after the name or from the business's own host); validate email with a strict single-mailbox regex before keeping it (reject `?`, `&`, `,`, `;`, whitespace, a second `@`); build every `mailto:` through `mailtoHref()` (which encodes) or `encodeURIComponent`; validate `vendors.email` in `vendorFields` (`src/app/contractors/vendor-actions.ts:62`, currently unvalidated text).

**Production impact:** none yet for verifier output; vendor email shape is also unvalidated in the deployed manual form.

### 7. Open redirect: `next` check passes `/\evil.example`

**Where:** `src/app/login/mfa-challenge/actions.ts:34` and `src/app/auth/confirm/route.ts:28` (`next.startsWith("/") && !next.startsWith("//")`). The challenge page reads `next` from the query string (`src/app/login/mfa-challenge/page.tsx`, `MfaChallengeForm next={next}`).

**What is wrong:** WHATWG URL parsing treats `\` as `/` for http(s), so `/\evil.example` and `/<TAB>/evil.example` resolve to another origin.

**PROOF (node):**
```
"/\\evil.com"   passes check: true  => https://evil.com/
"/\t/evil.com"  passes check: true  => https://evil.com/
"/\\/evil.com"  passes check: true  => https://evil.com/
"//evil.com"    passes check: false
```
Phishing path: send a signed-in or about-to-sign-in member `https://<walkup>/login/mfa-challenge?next=/\evil.example`; after entering a valid code they land on the attacker's look-alike "session expired" page. For `/auth/confirm` the attacker uses their own valid `token_hash`, which signs the victim in as the attacker (login CSRF) and then redirects away.

**Fix:** one helper `safeNext(raw)`: `new URL(raw, "http://x")` must have `origin === "http://x"` **and** the raw string must match `^/[A-Za-z0-9._~%/\-?=&#]*$` with no backslash, tab, CR or LF; fall back to `/`. Use it in both places and in any future `next`.

**Production impact:** live now (these files predate the work; `mfa-challenge/page.tsx` is modified here).

---

## Minor

### 8. Emailed announcements carry an unconstrained body (payment-diversion phishing from the official sender)
`src/lib/email-outbox/templates/announcement.ts:13` renders `extra.body` (up to 5,000 characters, `src/lib/owner/announcements.ts`) as the board's own words. `board_note` is stripped of `://`, `www.` and `@` (`actions-core.ts:42`, SQL check) but announcements are not, and neither rule stops a bare domain or an account number. Caps are enforced server-side (daily cap at most 200, 20 in week one, weekly cap per person per kind, hourly platform cap, recipients only association persons), so this is not an open relay; it is a DKIM-signed channel to every owner for a compromised admin. **Fix:** email only the title and "sign in to read" for announcements, or apply the note rule plus a digit-run limit to the emailed body. Not live.

### 9. Import AI column help sends real values when the file has no header row
`src/lib/import/shape.ts:51` (`headerForAi`) only hides headers that contain `@`, 7+ digits, over 60 characters or a sensitive word. The parser treats row 1 as headers unconditionally. **PROOF (`t7`):** a headerless file produced
```
Columns:
1. Jane Doe
2. 415 W Oakdale Ave Unit 2B
3. 1,250.00
```
sent to Anthropic, against spec 5.3 "Never a value". The "What was sent" panel appears after the call. **Fix:** treat a header as data when it has two capitalised name-like words, an address-like street pattern or an amount; show the request and require a click before sending.

### 10. `redactTaxIds` misses common separators; the "database never holds a full TIN" invariant is weaker than stated
`src/lib/documents/redact.ts:22` handles only ASCII `-`/space with exactly one separator and ASCII digits. **PROOF (`t6`), left unchanged:** `123–45–6789` (en dash), `123‑45‑6789` (non-breaking hyphen), `123 – 45 – 6789`, `123-45-\n6789` (PDF line break), `123.45.6789`, full-width digits, `12–3456789`, `123 456 789`. Native insurance reads, quote text, COI text and every model answer rely on it (#7, #35.7). **Fix:** NFKC-normalise and map all `\p{Pd}`/` `/`‑` to `-` before matching; allow `\s*[-.]?\s*` between groups and `\d` with `u` plus `\p{Nd}`. Live now (file predates the work).

### 11. Free text to the model keeps names; `loadRedactionTerms` fails open; `scrubWebTask` has gaps
`src/lib/repairs/scrub.ts:15` calls `scrubWebTask(text, { names: [], addresses: [] })`, so owner names in ticket text reach Anthropic (documented in the file; the privacy page covers "reported problems"). `src/lib/ai/redaction.ts:44` ignores query errors and returns empty name lists, so a failed lookup lets `webResearch` proceed unscrubbed (today the task text is structured and holds no names, so the exposure is nil, but the guard fails open). **PROOF (`t6`):** `scrubWebTask` leaves `415 W Oakdale Avenue` when the stored address is `415 W. Oakdale Ave`, `apartment two`, and spelled-out phone numbers; `scrubForModel("Jane Doe's radiator ... 1900 N Clark ...")` keeps `Jane Doe`, `jane at gmail dot com` and `1900 N Clark` (4-digit years 1800-2100 are exempt). **Fix:** make `webResearch` return `ok:false` if `loadRedactionTerms` errors; strip capitalised word pairs and street-number-plus-word patterns for triage.

### 12. `/api/address` has no per-user or global limit
`src/app/api/address/route.ts:14`. Any signed-in account at AAL2 (signup is open) can call paid Google Places Autocomplete and Place Details in a loop, or hammer Photon with the app's user agent. **Fix:** per-user token bucket (for example 30 per minute), cap `id` length, return 429.

### 13. Plaid webhook: unauthenticated callers can force one authenticated Plaid API call per request
`src/app/api/plaid/webhook/route.ts:28` and `src/lib/plaid/webhook-verify.ts:78`. The key is fetched by `kid` before the signature is checked and unknown keys are never cached, so a flood of forged `Plaid-Verification` headers with random `kid` values spends the app's Plaid client credentials and rate limit and can delay real webhooks (they return 503 and Plaid retries). **Fix:** cap `kid` to the real format (a UUID), negative-cache unknown kids for a few minutes, cap concurrent fetches.

### 14. `mailtoHref` and friends do not strip CR/LF or split commas
`src/lib/email/mailto.ts:37`. **PROOF (`t6`):** `mailtoHref(["a@b.com,evil@x.example"], "Hi\r\nBcc: x@y.example", "body")` => `mailto:a%40b.com%2Cevil%40x.example?subject=Hi%0D%0ABcc%3A%20x%40y.example&body=body`. Several mail clients decode `%2C` and `%0D%0A` before use. The editor's subject is a single-line input, but stored subjects (`contractor_messages`, `updateDraft`, `markMessageSent`) are not stripped of newlines. **Fix:** collapse whitespace in the subject, reject recipients containing `, ; < > "` and whitespace, and validate stored `to_email`/`subject` in `contractors/actions.ts` (`checkText` allows CR/LF in subject).

### 15. Document search interpolates `q` into PostgREST `or()` unquoted
`src/lib/documents/access.ts:135-139` (`listDocuments`). Only `%` and `_` are escaped; `,`, `(` and `)` in `q` add filter clauses (a broken value makes the whole list return `null`, shown as "not visible to you"). Results are still RLS-filtered, so this is not a leak. `src/lib/repairs/search.ts` (`postgrestIlikeValue`) already does it correctly. **Fix:** reuse that helper. Live now.

### 16. ICS output does not neutralise U+2028, U+0085, VT or FF
`src/lib/tax/ics.ts:34` (`escapeText`), used by `src/lib/upkeep/ics.ts`. Ticket titles are owner-written (4 to 120 characters, no control-character filter). **PROOF (`t8`):** a title containing U+2028/U+0085 yields a file in which a splitlines-style parser sees `BEGIN:VEVENT`, `SUMMARY:Pay evil.example`, `END:VEVENT` as separate lines inside the real event. **Fix:** replace `[\u0000-\u001f\u007f-\u009f  ]` (except the folding CRLF) with a space before escaping, as `cleanHeaderText` does for email.

### 17. `shareDocumentWithOwners` refuses only two private categories
`src/app/announcements/actions.ts:102`. `PRIVATE_CATEGORIES = {"legal_notice","unit_record"}`; `bank_statement`, `tax_form`, `vendor_document` (W-9s), `insurance`, `contract`, `correspondence` and uncategorised files can be made readable by every owner with one click (and attached to an announcement). **Fix:** allow-list the shareable categories (`governing`, `minutes`, `financial_statement`) instead.

### 18. Photo EXIF is stripped only when the browser can decode the file
`src/components/upload/upload-file.ts:87,93`: `(await normaliseImage(file, settings)) ?? file`. HEIC outside Safari, a decode error or a missing `createImageBitmap` uploads the original, GPS and device included, to a bucket that shows shared-area photos to every owner. The server never strips. **Fix:** for `ticket_photo`, fail the upload (ask for JPEG) instead of falling back, or strip EXIF on the server in `registerPhoto`.

### 19. `registerUpload` has a check-then-insert window on the stored object
`src/app/documents/upload/actions.ts:219-324`. The bytes are verified at line 219-236 and the `documents` row is inserted at 324; until the row exists, the uploader can delete their pending object and re-upload different bytes at the same path with the unexpired signed token. **Fix:** compare the checksum inside the insert RPC against the object's `metadata.eTag`, or re-read the object after the insert and discard on mismatch.

### 20. Standing reminder rules keep sending after the enabling admin loses the role
`supabase/migrations/0055_email_reminders.sql:1038-1111` (`email_run_rules`) records `rl.enabled_by` as approver but never checks that person still holds `board_admin`. **Fix:** join `role_grants` (active) for `enabled_by`, or pause rules when a grant is revoked.

### 21. `addUnitCharge` posts any amount and has no idempotency (pre-existing, now reached from the changed Dues UI)
`src/app/dues/actions.ts:228`, called from `src/app/dues/needs-you.tsx:166`. The server does not recompute the late fee from the association's rule and the ledger has no unique key for a late fee per unit and period, so a second click or a second board member posts a second charge. Money crosses as a JS number (`Math.round(x*100)/100`), against #20; values with two decimals round-trip, so no cent is lost, but the boundary rule is broken throughout this file (`createDuesSchedule`, `chargeDuesPeriod`, `recordPayment`, `reportOutsidePayment`). **Fix:** have the action take `(unitId, periodStart)` and compute the amount from `associations.dues_late_fee_*` text, with a partial unique index on late-fee charges. Live now.

### 22. Verifier hygiene: aggregator list, generic names, substring host match
- `AGGREGATOR_HOSTS` (`src/lib/ai/verify.ts:62`) lacks path-tenant and redirect hosts. **PROOF (`t1`, E3):** not aggregators: `x.com`, `twitter.com`, `youtube.com`, `github.com`, `medium.com`, `reddit.com`, `pinterest.com`, `tiktok.com`, `linktr.ee`, `bit.ly`, `t.co`, `wixsite.com`, `fb.com`, `g.page`, `business.site`. Combined with `hostInSearch` this makes one result on such a host approve any URL on it (item 3).
- A fabricated *generic* name passes: **PROOF (`t1`, G1):** `Plumbing Contractors` is kept from the sentence "Plumbing contractors in Chicago: Alpha Rooter, Beta Pipe..." because `nameAppears`/`findName` only need the words in the citation; it can then be saved as a vendor. **Fix:** reject names made only of trade/place words (reuse `GENERIC_NAME_WORDS`) and names equal to the page title.
- `hostCarriesName` (`web-verify.ts:167`) uses substring matching: tokens like `pro`, `ace`, `all` match unrelated hosts, so a blog counts as the contractor's "own site" for phone, email and flags. **Fix:** match whole labels or registrable-domain prefixes.

### 23. `clearSuppression` can clear spam-complaint blocks
`src/lib/email-outbox/actions-core.ts` / `email_clear_suppression` (0055:626) deletes any suppression, including `reason = 'complaint'`. A complainant is also set `unsubscribed_all`, which still blocks sends, but the Resend complaint record becomes removable by the sender. **Fix:** only allow clearing `bounce`.

### 24. `createQuoteRequests` stores client-built JSON without bounds
`src/app/insurance/request-actions.ts:96-136` validates only a few fields of `payload` and stores the rest in `payload_json` (claims list capped at 20, but object sizes, association address and unit counts are the browser's). Board-only, body capped at 4 MB. **Fix:** a zod schema with lengths and numeric ranges; take association facts from the database, not the payload.

### 25. Raw error text reaches the browser and the database in older paths
`classifyDocument` returns `(cause as Error).message` into `documents.extraction_error` (shown in the hub); `src/app/documents/actions.ts` and `link-actions.ts` return Supabase `error.message`; `dues/actions.ts` returns `error.message` for most failures. None contains secrets, but they expose constraint and table names. Use the `dbError`/`friendlyDbError` mappers.

### 26. Ticket and photo creation have no per-person ceiling
`createTicket` (idempotent per `clientKey` only) and `attach_ticket_photo` (20 per ticket, 30 pending uploads a day) leave an owner free to create unlimited tickets, each with up to 20 photos of 15 MB, and each ticket queues an AI triage (capped at 5 a day per reporter in TS and 10 in SQL). **Fix:** a per-person daily ticket cap in the insert RPC.

### 27. The Google lookups run on page load
`src/app/repairs/find/find-results.tsx:74` calls `searchPlaces` on mount, so opening a link (or a link sent to a board member) spends a Places call and writes `google_api_calls` and the cache (cap 60 a day per building, counted before the call and not under a lock). Minor cost exposure; make it a button.

### 28. Auto-sync cooldown is per server instance
`src/app/bank-feed/page.tsx:361-379` keeps `autoSyncStartedAt` in a module `Map`; on serverless two instances sync the same cursor at once. Writes are idempotent, so the effect is wasted Plaid calls and a stale cursor overwrite. Use a database timestamp with a conditional update.

### 29. Inconsistent `.limit(1)` association pick for multi-association users
Many actions (`currentAssociationId`) take the first visible association with no `order`. Decision #11 makes the UI single-association, and the database guard triggers prevent cross-association writes, so it is not exploitable today; it becomes a wrong-building write the day a person belongs to two.

---

## Checked and fine

**Webhooks and cron**
- Svix (Resend) verification (`src/lib/email-outbox/svix.ts`): HMAC-SHA256 over `id.timestamp.body` with the base64 key, `timingSafeEqual` on equal-length buffers, any `v1` entry accepted, timestamp within 5 minutes both ways, numeric-only timestamp, missing secret returns 500 (fails closed), invalid signature returns 400 before any database call, replay absorbed by `email_log_svix_idx` plus the in-function duplicate check; events for unknown message ids are ignored.
- Plaid verification (`webhook-verify.ts`): exactly `ES256` (no `none`, no HS), key only from Plaid by `kid`, `expired_at` honoured, P-256 JWK shape checked, P1363 signature length 64, `iat` window 5 minutes both directions, body SHA-256 compared with `timingSafeEqual` on the exact raw bytes, only four ITEM codes acted on, item id pattern-checked, service client created inside the route and used for one RPC.
- Cron routes: `CRON_SECRET` unset gives 500, compare is SHA-256 then `timingSafeEqual`, GET only (POST is 405), counts-only responses, `email_claim` with no batch is restricted in SQL to `dues_reminder` and `late_fee_notice`, daily/weekly/hourly caps and bounce/complaint suppression are enforced in SQL, `serviceRpc` allow-lists six names and cannot read tables.
- Unsubscribe: GET of `/unsubscribe/[token]/one-click` only redirects (303) and changes nothing, so link scanners are harmless; POST needs a 96-hex token (about 360 bits), anon key and no cookies, answers 200 for any token; the preference page sets `referrer: no-referrer`; masked email only.
- Proxy `PUBLIC_PATHS`: `/api/cron` (two routes, both secret-checked), `/api/plaid/webhook` and `/api/email/webhook` (exact, signature-checked), `/unsubscribe`, `/terms`, `/sitemap.xml`; nothing else became public. `/api/address` is signed-in and not MFA-exempt.

**Authorisation and input**
- Every action that takes an id either runs a board check in TypeScript (`isBoard`, `actionContext(boardOnly)`, `getViewer().isBoard`) or hands it to an RPC that does; I read the SQL for `archive_insurance_policy`, `delete_insurance_*`, `claim_insurance_read`, `set_current_insurance_agent`, `track_insurance_premium`, `mark_insurance_message_sent`, `request_insurance_proof`, `mark_bill_paid`, `email_*` and `store_bank_connection`: all re-check role against the row's own association. Accountant is excluded from every Repairs write.
- Deletes in Insurance and Repairs are `board_admin` only in SQL.
- zod or explicit validation with size caps on tickets, bids, bills, upkeep, emergency info, import (`.strict()` schemas, `^[a-z_]{1,30}$` keys checked against `FIELDS[kind]`, 5 MB / 5,000 rows / zip-bomb stats), announcements, email rules and daily cap.
- Money in new code stays text or integer cents (`moneyText`, `toCents`/`fromCents`, `parseMoneyText`); `mark_bill_paid` locks the row and refuses a repeated or null `p_due_on` (a client cannot skip the due-date check); `createTicket` is idempotent on `client_key`; `saveCandidate` re-reads details from the cache row, never from the browser.
- Uploads: path format mirrored in SQL, storage path built from a random suffix, filename reduced to `[A-Za-z0-9_.-]`, stored bytes re-sniffed and compared with the stored content type, HTML/SVG/JS cannot be stored under a non-text type, signed upload tokens do not allow overwriting a registered path, signed download URLs are minted only after the row query (60 s documents, 10 min photo thumbnails).
- Apart from the two `next` parameters in item 7, every `redirect()`/`router.push()` in the reviewed code builds its path from a server-returned id or a constant; the one-click GET builds its target from `encodeURIComponent(token)` on the request's own origin.

**Content handling**
- No `dangerouslySetInnerHTML` of user, model or web text (only the theme script and escaped JSON-LD). Email HTML escapes everything (`escapeHtml`), links only the site origin, headers come from `cleanHeaderText` and `fromHeader` (control characters, quotes, angle brackets removed), attachment names from `safeFilename`, Resend body is JSON, reply-to and from validated.
- CSV/XLSX output passes `safeCell`/`csvLine` (leading `= + - @ tab CR LF` guarded); statement and late-fee PDFs are RLS-read (`unit_statement*`), headers fixed; ICS escapes backslash, semicolon, comma and CR/LF (see 16 for the other separators).
- No server-side fetch of a user-, model- or search-supplied URL: the only `fetch` calls are to fixed Google, Photon, Resend and Plaid hosts (`encodeURIComponent` on place ids); the web research tool is Anthropic's server-side search, and no `web_fetch` or other tool is enabled. (`src/app/admin/tax-templates/actions.ts` fetches platform-admin URLs; it is outside this diff.)
- Model-written insurance drafts take only an enumerated fact set and placeholders (`draftFacts` strips digits and `@`), the model's text is checked (`checkModelDraft`: no digits, `$`, em dash, forbidden words, required placeholders exactly once) and values are inserted with a function replacer, so injected source text cannot reach a draft. Contractor and owner notices are deterministic templates. `ai/draft.ts` has no caller.
- Prompt-injection containment per call site: reads (insurance, bids, COI) produce zod-validated fields the board confirms, quote reads never pre-fill, redaction runs on every returned string; triage outputs enums plus capped text and never decides safety; web research output passes `verifyItems`, and the tool is limited to `web_search` with `max_uses`.
- What leaves to third parties via web search is only city, state, ZIP, building shape, coverage types and a vocabulary-only phrase; Google gets the geocode address and the vocabulary phrase (#31, #35h). The privacy page lists Anthropic, Google and Photon.

**Operational**
- Logging: `plaidErrorLog` and `classifyAiError` emit status, code and name only; no key, token, prompt, answer or email address is logged; webhook and cron logs carry counts and ids.
- AI metering for `runStructured` and `webResearch`: `claim_ai_call` first, `quota_unknown` fails closed, give-back rules, follow-up rows under the parent claim, stale in-flight rows expire. Concurrent web searches are blocked by the atomic `claimAiRun`.
- `service-role` use is confined to the cron, the Plaid webhook and `serviceRpc` (checked with a grep of `SERVICE_ROLE`).
- Supabase Auth, MFA gate and RLS helpers are unchanged and still enforce AAL2 in SQL; the new SECURITY DEFINER functions I read call those helpers.
