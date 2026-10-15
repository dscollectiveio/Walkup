# I4-ui-core: insurance-spec §15 step 5, first half (components, Import and Review, Policy detail, Overview, Policies, Coverage check, Building facts)

Step owner: Insurance. Date: 2026-10-14. No git commands run; no migrations
touched or applied; no dev server started or stopped; no dependencies added.

## Built

| File | What |
|---|---|
| `src/app/insurance/components/styles.ts` | `inputClass`, `labelClass`, `helpClass`, `btnPrimary`, `btnGhost`, `btnDanger`, `linkClass`, `errorBlock`/`warningBlock`/`infoBlock`, `dialogClass` (native dialog: full-screen sheet on phones). |
| `components/insurance-tabs.tsx` | `InsuranceTabs` (§3.2: `<nav aria-label="Insurance sections">` of links, `aria-current`, badges: in force, gaps in rust, drafts + requests awaiting reply; scrolls sideways in its own strip), `viewFor` (legacy `?view=policy` → overview). |
| `components/status-chip.tsx` | `Chip`, `policyChip`/`StatusChip` (§9.2 chip words and tones), `ClaimStatusChip`. |
| `components/basis-chip.tsx`, `money-text.tsx`, `page-header.tsx` | `BasisChip`/`basisLabel`, `MoneyText`, `InsuranceHeader` (board/accountant blurbs), `Disclaimer` (decision-point copy), `BackLink`. |
| `components/provenance.tsx` | `Provenance` (form and tile variants, every §9.3.4 source line, snippet always inline) and `OpenFileButton` (mints the URL on click via `getDownloadUrl`, `#page=n`; "Open the file (look at page n)" on coarse pointers). |
| `components/insurance-uploader.tsx` | `InsuranceUploader` on Foundation's `DirectUpload` with `prepareFiles` (re-encode every image; two or more photos join into "{name} (photos).pdf" when "These photos are pages of one document", the default) and `beforeList` (that choice); always `categorySlug: "insurance"`. `ImportUploader`: upload then `startInsuranceRead` per document, one file → progress page, several → `/insurance/import`; AI off → manual form with `?document=`. |
| `components/field-input.tsx`, `section-toggles.tsx`, `list-editor.tsx` | `FieldInput` (kind-specific input, `$` / `%` adornments, `inputMode="decimal"`, "Not stated" selects, "Is this right?" candidates with "Use this" / "Use {short form}", help, errors), `FieldGrid`, `SectionToggles`, `ListEditor`. |
| `components/review-form.tsx`, `review-types.ts` | `ReviewForm` v2 (§9.3.4): all five intents plus quotes; client token in a ref; coverage switch with "Will be cleared when you save"; "Check {n} things" mode (one field per screen on phones, Back, sticky bar "{k} of {n} checked · Next" becoming Save, hidden while an input has focus, safe-area padding), "All details ({m})", "Show everything"; rail (to-check links, live warnings, "Where this came from"); policy-number-redacted note; quote-mode note; legacy values with "Clear these when I save"; endorsements/exclusions/premium lines with page links and the "Adds up to" check; After saving (reminder days, This replaces with the 45-day default, premium bill with live preview); quote extras; duplicate warning with both buttons; 40001 "Reload"; "already saved" "Open it"; `AiWritten` reading note; the §10.7 read-vs-saved diff ("Walkup read {new}; saved value {old}", "Use the new value" / "Keep the saved value"). |
| `components/finding-card.tsx` | `FindingCard` (dot plus words, basis chip, policy chip, "Why Walkup says this" with quote, ilga.gov link and verified date, buttons in §9.5 order), `AgentAnswerDialog` (Yes/No/Not sure radios, money/enum/date inputs, answered-on date, optional attachment through the insurance uploader, calls `recordAgentAnswer`), the dismiss dialog, `RestoreButton`, toast "Saved. The check is updated." |
| `components/contact-card.tsx`, `policy-row.tsx`, `read-banner.tsx`, `mark-request-done.tsx`, `confirm-dialog.tsx`, `toast.tsx`, `year-by-year.tsx`, `desktop-open-details.tsx` | `ContactCard`, `PolicyRow`, `ReadBanners` (item 0, max three), "Mark done", `ConfirmDialog` (native dialog, error inside), `Toast` (`role="status"`), `YearByYear` (table from sm, stacked dl on phones; every money/percent column `::text`), `DesktopOpenDetails`. |
| `src/app/insurance/page.tsx` | Rewritten: context, Restricted/owner/reader routing (§3.3), badges, tab dispatch, `maxDuration = 300`. |
| `tabs/overview.tsx` | §9.1: empty state (AI on/off copy, uploader, small print, documents request link, books hint, manual link, "While you're here"); banners (reads waiting, failed reads, owner requests with "Mark done", stale owner summary, possible duplicate premium bills); renewal answer (ended / within window / renewal saved); coverage map with status words and "Other kinds of coverage"; Cost (premiums, per unit, neutral change at last renewal, share of assessments, budget line, tracked bills with `TrackPremium`); top 3 findings; agent card with claims line and buttons; For owners. |
| `tabs/policies.tsx` | §9.2: toolbar, In force / Starting soon / Ended or replaced / Archived (board), claims (table, stacked on phones), Year by year. |
| `tabs/check.tsx` | §9.5: the five answers, legal-checks card, facts-needed card, four basis groups (gaps first, then not on file), dismissed list with who, when and Restore, disclaimer, empty state (Illinois / not). |
| `tabs/market.tsx`, `tabs/quotes.tsx`, `tabs/owner-view.tsx` | **Interim** stand-ins so the page routes every view today: saved contacts + lookup links; quotes received with "Start a policy from this quote"; the published owner summary's headline or "not published". The second UI half replaces these three files whole. |
| `import/page.tsx`, `import/import-screen.tsx`, `import/read-state.ts` | §9.3.1: Our policy / A quote, "From" (sets the open request), uploader, small print, manual link (`?coverage=` carried), "Reading now and recently" (last 20, mode and state chips, "{n} policies found"). `read-state.ts`: stale running/queued → timed out, item states, chips, `canRetry`. |
| `import/[readId]/page.tsx`, `read-progress.tsx`, `item-actions.tsx` | §9.3.2 progress (3 s polling capped at 6 min, status region holds only state text, elapsed seconds `aria-hidden`, 90-second notice, "Still reading… Check again", every failure state and its buttons, three-tries copy, quota retry only from the next day) and §9.3.3 package list (one policy redirects to `/0`, reader notes quoted, truncation and redaction notes, per-item card with "Also covers" chips, "{k} details read, {r} to check", Review and save / Skip / Undo / Saved + Open, detail-error buttons, "Update an existing policy instead", Done / Finish later, "Saved." toast). |
| `import/[readId]/[index]/page.tsx` | §9.3.4 import review; "already saved" screen; `?update=` (§10.7) edit with read diffs. |
| `policies/new/page.tsx` | Manual (`?coverage`, `?carrier`, `?number` from a failed item, `?document`), `?from_quote` (§9.4.2 date assumptions flagged, document carried, accepted quote, replaces the current policy), `?renews` (§9.4.1 copy last term: dates shifted and flagged, premium blank and asked for, lists kept, premium breakdown dropped). |
| `policies/[id]/page.tsx`, `more-menu.tsx`, `summary-card.tsx` | §9.4: header, More menu (Escape returns focus, sheet on phones, admin-only Archive/Restore and Delete with the spec's confirms), summary card (edit, rewrite with confirm over a board summary, refresh at 10 s and 30 s after a save, error/quota/AI-off copy, `AiWritten`), key-figure tiles (claims line first, percent deductibles with "about $x"), All details per section with "Not recorded", lists, premium and bill, agent, claims, documents, history (replaced by / replaces, year rows). `?saved=1` toast "Policy saved." |
| `policies/[id]/edit/page.tsx`, `policies/[id]/renew/page.tsx` | Edit (stored provenance kept, legacy values, expected_updated_at); Renew (three option cards). |
| `claims-panel.tsx` (rewritten), `claims/new/page.tsx`, `claims/new/new-claim.tsx` | §9.4.3: list rows, `ClaimDialog` (every field, "First, report it" claims line with a full-width call button on phones, ticket filter, paid/closed fields shown by status), per-claim documents section in the edit dialog, "Email the agent about this claim", admin-only delete; the page wrapper with policy select and ticket prefill. |
| `track-premium.tsx` | Re-pointed to `trackPremium` (policy-actions). |
| `facts/page.tsx`, `facts/facts-form.tsx`, `facts/building-basics.tsx`, `facts/questions.ts` | §9.8: From Building Info (basics form via `saveBuildingBasics`, address read-only with admin link or the "Only {admin names}…" copy), the five sections with 44 px yes/no/not-sure radios, follow-ups, FEMA link, "Shared with agencies only…" help, upkeep guesses ("Walkup guessed this… Confirm."), hidden `_keys`, `?only=` mode (title "{n} questions…", "Show all the facts", one question per screen on phones with Back/Next/Save answers), accountants read-only, toast. |
| `review-data.ts` (server-only) | Review support loader (replaceable policies with their bills, expense accounts, contacts), list/meta/resolution helpers, stored provenance, `baseReviewProps`, `pagesLabel`. |
| `loading.tsx` | `RouteLoading`. |
| `tests/unit/insurance-max-duration.test.ts` | Globs every insurance page, follows local imports to the six action modules, asserts the literal; also the §3.1 table for pages that exist. |
| `tests/unit/insurance-ui-helpers.test.ts` | read-state, facts questions (every fact key in exactly one question), `pagesLabel`, `viewFor`, `basisLabel`, `policyChip`. |

Small edits to I3's files (same workstream):
- `src/app/insurance/import-actions.ts` `retryInsuranceRead`: also accepts a stale `running` read (started over 330 s ago) or a `queued` read created over 330 s ago (the page shows both as timed out; `claim_insurance_read` already claims them), and a `done` read where some item has `detailError` and nothing is saved or skipped yet ("Try reading the file again", §9.3.3). Before this, the progress page's "Try again" on a killed run would have been refused.
- `src/lib/insurance/queries.ts` `loadInsuranceBanners`: the owner-requests banner now links to `/insurance/emails/new?kind=certificate_request&owner_request={oldest open id}` (it pointed at `/insurance`) and carries `ownerRequestId` for "Mark done".
- `src/app/insurance/review/[documentId]/page.tsx` (legacy): only `export const maxDuration = 300;` added so the new test passes until the shim replaces the page.

## Deliberately different from the spec, and why

1. **Interim Marketplace, Quotes & emails and owner view.** `page.tsx` must route every view now; the full tabs are the second UI half. The interim files are small and honest (no "coming soon" copy) and are meant to be replaced whole.
2. **"Upload the renewal declarations" in the More menu links to the renew page**, whose first card is that uploader, rather than an uploader inside the menu.
3. **"Ask your agent about this policy"** links to `/insurance/emails/new?kind=coverage_question&policy={id}&question=own`; finding cards use `&finding={finding.id}` (plus `&policy=`). The compose page (second half) should read `question=own` as "My own question" selected.
4. **"Several photos?" choice is always shown** (before picking), because `prepareFiles` runs on the picked list and the choice has to exist first (F3 placed `beforeList` above the list for this reason).
5. **Quote "From" select** offers saved contacts plus "Someone else (from the agent details above)"; there is no inline "Add a contact": `saveQuote` already creates the contact from the agent fields (`upsertAgentContact`).
6. **Review form "checked"** = a field the board acted on (Use this, typed, Next) or that now holds a value; a read-vs-saved diff counts only once acted on. Leaving a field blank is done with Next. On desktop the bar's Next walks the list and a second button saves at any time (the server still enforces required fields).
7. **Key figures** use a fixed headline list per section (limits, main deductibles, coverage form, valuation); everything else is under All details. The spec says "the policy's sections, only the non-null ones" without naming which fields; listing all ~90 as tiles would bury the important ones.
8. **Coverage-check Answer for not-on-file lines** joins lowercase line labels ("building and property", "crime and fidelity bond").
9. **Facts:** an unanswered follow-up (employee count, management company, owners' minimum liability) is cleared when its yes/no isn't "Yes", because the question's keys are listed in `_keys`.
10. **Owner-requests banner href** changed in `queries.ts` (above): the spec's compose link needs the oldest request id.
11. **Read list chip** adds "Nothing found" (done, no policies) and "Skipped" (every item skipped) to the five §9.3.1 words, which didn't cover those cases.
12. The claim page wrapper's "First, report it" line follows the default policy only (it doesn't change with the policy select).

## Not verified in a browser

Every insurance route redirects to `/login` without a session, and the dev
Supabase project doesn't have 0052 yet, so the pages can't be exercised
signed in. `curl` of `/insurance`, `?view=check`, `/insurance/import`,
`/insurance/facts`, `/insurance/policies/new`, `/insurance/claims/new` and two
detail routes: all 307 to `/login`, no 500. Server/client boundaries were
checked by hand (no client-module function is called from a server module:
`questionFor` and `ClaimStatusChip` were moved to plain modules for that).
Manual checks §13.3 remain for the lead after 0052 is applied.

## Left undone (second UI half, §15 step 5 continued)

Quotes & emails (§9.7, compose page, request quotes flow), Compare and the
switching checklist (§9.10), Marketplace (§9.6), owner summary editor and the
full owner view (§9.9), contact detail (§9.11), facts sheet (§9.12), quote
detail/new/edit pages, the legacy shim (§8.1). Links to those routes already
exist in the pages built here: `/insurance/emails/new?…`, `/insurance?view=quotes&new=1&coverage=`,
`/insurance/quotes/{id}`, `/insurance/quotes/new?document=&request=&contact=&coverage=`,
`/insurance/owner-summary`, `/insurance/sheet`. Step 6 deletions
(`actions.ts`, `upload-declarations.tsx`, `quote-request-form.tsx`,
`request-row.tsx`, `review/[documentId]/review-form.tsx`, `waiting.tsx`):
nothing new imports them; the legacy review page still does.

## Cross-workstream requests

- **Foundation:** `src/app/documents/upload/link-targets.ts` `LINKABLE_TABLES`
  lacks `insurance_quotes` and `insurance_claims` (0052 widened the DB check).
  Until added, `EntityDocuments` for a claim (policy page, edit-claim dialog)
  lists linked documents but shows "Don't know how to attach a document to
  that." instead of the upload.
- **Integration:** `src/components/sidebar/**` `pageTitleFor` should know the
  new views (`overview`, `policies`, `check`, `market`, `quotes`) and the new
  sub-routes (`/insurance/import`, `/insurance/policies/*`, `/insurance/facts`,
  `/insurance/claims/new`).
- **Repairs (R-1):** "Start an insurance claim" → `/insurance/claims/new?ticket={id}`
  (exists; saves back to `/maintenance/{id}`).

## Commands run

- `npx tsc --noEmit`: clean at the end (intermediate errors were all in my own files and fixed; the old `page.tsx` error went when it was rewritten).
- `npx eslint src/app/insurance src/lib/insurance/queries.ts tests/unit/insurance-max-duration.test.ts tests/unit/insurance-ui-helpers.test.ts`: first run 3 `react-hooks/purity` errors (`Date.now()` in render/handler), fixed; then clean.
- `npx vitest run tests/unit/insurance-max-duration.test.ts`: first run 1 failure (legacy `review/[documentId]/page.tsx` without the literal), fixed; 26 passed.
- `npx vitest run tests/unit/insurance-ui-helpers.test.ts`: 10 passed.
- `npx vitest run tests/unit`: 106 files, 1332 passed.
- `curl -s -o /dev/null -w "%{http_code}"` on eight insurance routes at `http://localhost:3100`: all 307 to `/login`.
