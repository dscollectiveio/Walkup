# Insurance workstream report

Date: 2026-10-14. Covers insurance-spec steps 1 to 6 (I1 to I5) and the
self-check (I6). Nothing is applied to any Supabase project and nothing is
committed. Migration `0052_insurance_v2.sql` waits for the lead to apply it to
dev; production waits for "General Kenobi".

State of the checks: `npx tsc --noEmit` clean for the whole project, eslint clean
on every insurance file, `tests/unit` 116 files / 1434 tests green, insurance DB
tests (`insurance-v2`, `insurance`, `insurance-actions-contract`,
`insurance-select-columns`) 141 green, `migrations` and `rls` green.

## What Doug can now do on /insurance

Board members (admins and members):

- **Bring the policies in.** Drop a declarations PDF, a whole renewal package, or
  phone photos of the pages (several photos become one PDF in the browser).
  Walkup reads it, finds each policy in a package, and shows a review screen
  where every figure says where it came from ("page 2 of your declarations",
  with the line it read). Nothing is saved until the board checks it. A read can't
  spin forever: it times out, says why, and offers a retry (three tries). Without
  an AI key, the upload is kept on file and the board types the figures in.
- **Keep the records right.** Each policy has its own page: key figures, every
  detail by section, a plain-English summary (written by Walkup, editable),
  premium and bill, agent, claims, documents and history. Edit, renew (from the
  renewal declarations, from a chosen quote, or by copying last term), archive
  and delete (admins only). The premium becomes one recurring bill per policy;
  a renewal gets its own bill and the old one retires after its last installment.
- **See what's missing.** The Coverage check compares the building's facts with
  its policies and lists findings, each with its basis: Illinois law (quoted and
  linked to ilga.gov, checked 2026-10-14), your declaration, your own numbers, or
  what's commonly carried. A short Building facts form answers what the check
  needs. Each finding can become an email to the agent, be marked "Our agent
  answered", or be dismissed with a reason.
- **Shop around without being sold to.** Marketplace finds independent agencies
  near the building and insurers active in the state on the web, shows only
  contact details the cited pages actually contain, links the state license and
  NAIC lookups, and lets the board save them as contacts. It never ranks them or
  quotes a price.
- **Ask for quotes and compare them.** Pick contacts and coverages, and Walkup
  drafts one email per contact (the board edits and sends from its own mail app,
  then marks it sent). Quotes can be read from a PDF (nothing auto-filled) or
  typed in, then compared side by side with what the building has now. "Record
  our choice" starts the new policy and a switching checklist.
- **Write the routine emails.** Ask a coverage question, request a certificate of
  insurance, report a claim, ask for a change, ask for the declarations, follow
  up on or decline a quote, or write a blank email. Every one is a draft first.
- **Track claims**, linked to a repair ticket when there is one.
- **Tell owners what the master policy covers.** Write and publish an owner
  summary (coverage form in plain words, deductibles, what's left to their HO-6,
  who to ask for a lender certificate). Owners can ask the board for proof of
  insurance; the request shows on the board's Overview and closes when the
  certificate request is marked sent.
- **Print a one-page insurance facts sheet** of every policy in force.

Accountants see everything read-only (no Marketplace search, no drafting).
Owners see only the published summary and their own proof requests.

## Integration workstream tasks still to do (insurance-spec §12)

None of these are in the tree yet unless noted.

| Task | Files | Status |
|---|---|---|
| **I-1 Home data** | `src/app/page.tsx` | Not done: still the old policies query, `insuranceExpiry` and `insuranceExpiresOn`. Needs the new select, `withStatus`/`renewalFor` from `@/lib/insurance/status`, reminders with `renewed`, setup-guide status, optional owner card via `rpc("owner_insurance_summary")`, and board banners from `loadInsuranceBanners()` (`src/lib/insurance/queries.ts`). |
| **I-2 Reminders and urgent items** | `src/lib/home/urgent-items.ts`, `snapshot.ts`, `reminders.ts` + tests | Not done. Honour `renewal_reminder_days` (`withinReminder`), "renewal saved" tone, skip quotes nudge when renewed, short coverage labels, computed follow-up and quote-expiry reminders. D1 rewrote Worth a minute: add keys to `UrgentItem["key"]` and `ICONS`. |
| **I-3 Setup guide** | `src/lib/home/setup-guide.ts` + test | Not done: AI on/off copy, done = an `active` policy, new step `insurance_owner_summary`. |
| **I-4 Tour** | `src/lib/tour/steps.ts` | Not done: the three insurance steps. |
| **I-5 Sidebar** | `src/components/sidebar/config.tsx` | Not done: "Insurance" label for owners and accountants (`insuranceNavLabel(role)`), and `EXTRA_TITLES` for `/insurance/policies/`, `/import`, `/compare`, `/facts`, `/owner-summary`, `/emails/`, `/claims/`, `/contacts/`, plus `/insurance/quotes/` and `/insurance/sheet` (I4/I5). |
| **I-6 Building Info** | `src/app/building/association-profile-form.tsx` (l.195, still has an em dash), `src/app/building/page.tsx` | Not done: caption, "Insurance facts" card, master policy line, owners' link. |
| **I-7 DECISIONS** | `docs/DECISIONS.md` | Not done (ends at #34): #35 from the brief (with the referral-fees line for Doug), #36 (a) to (l). |
| **I-8 Documents** | `src/app/documents/upload/link-targets.ts` (Foundation moved `LINKABLE_TABLES` here), `src/app/documents/[documentId]/page.tsx` | Not done: add `insurance_quotes` and `insurance_claims` (until then the quote page and the claim dialog list documents but can't attach new ones), revalidate `/insurance` layout, "Read it as a policy / quote" buttons (AI off: "Enter it as …"), "Linked to" list. `maxDuration = 300` is already there. |
| **I-9 Pipeline** | `src/lib/documents/pipeline.ts` | Not done: still calls `readDeclarationsIfInsurance` (the second Opus call per insurance upload, now with the 89 v2 fields). Skip the classifier for manually filed insurance documents, delete that function, stop the tag rules overwriting a person's category. |
| **I-10 Privacy** | `src/app/privacy/page.tsx` (Foundation) | Mostly done by F3. Still worth adding: the policy summary never sends the policy number, named insured, address or agent's details; insurance email drafts send only the kind of email and coverage types (the current "Writing drafts" paragraph says "such as a policy's limits", which is true for summaries, not insurance drafts). |
| **I-11 Budget hint** (optional) | `src/app/budget/**` | Not done. |
| **I-12 Cents helpers** | `src/lib/money/cents.ts` (new), `src/lib/tax/form1120h.ts` re-export | Not done. Then switch `src/lib/insurance/{premium,queries,format}.ts` and the other insurance imports from `@/lib/tax/form1120h` to `@/lib/money/cents` (Insurance's change, one line each). |

## Repairs workstream tasks still to do (insurance-spec §12)

| Task | Status |
|---|---|
| **R-1 Ticket shows and starts claims** (`src/app/maintenance/[ticketId]/`) | Partly. R4 built `insurance-prompt.tsx` (repairs-spec §5.3 card 10): it lists claims (number, status, date of loss) linked to `/insurance`, and offers "Start a claim with this problem" only when its prompt line shows. Still to do per §12 R-1: amounts (`amount_claimed::text`, `amount_paid::text`), link each claim to `/insurance/policies/{policy_id}`, and the board's "Start an insurance claim" button on every ticket (it currently hides when the damage isn't water or fire and the cost isn't above the deductible). |
| **R-2 Bills and the premium link** | SQL done in 0053 (`mark_bill_paid` calls `insurance_premium_bill_advance`; 0052's trigger, unique index and link targets kept). UI not done in `src/app/bills/**`: keep `insurance_policy_id` on edit, "Premium for {coverage short} with {carrier}" link, "Last payment for this policy. The renewal has its own bill." for a retired bill, and "{coverage short} {period}" labels during a renewal overlap. |
| **R-3 Contractor certificates, 605/12(i)** | Not done: the certificate request copy naming the association, board and managing agent as additional insureds, and the over-$10,000 note with `CITATIONS.ICPA_12_I_COI`. |
| **R-4 Upkeep copy** (`src/app/repairs/upkeep-view.tsx:241`) | Not done: still "added here automatically when a policy is recorded". |
| **R-5 Repairs and the deductible** | Partly, in Repairs' own wording (`insuranceLine()` in `insurance-prompt.tsx`). Not using `deductibleHint()` from `@/lib/insurance/status` (plumbing trade, sewage, `coalesce(actual, estimated)` against the right deductible); no "Ask your agent" button → `/insurance/emails/new?kind=coverage_question&policy={masterId}`. Hidden-when-claimed is done. |

## Foundation requests still open

- Metered follow-up calls: `runStructured` has no `step: "followup"`, so each
  pass-2 read call and the summary's one retry claim their own quota unit (a
  3-policy package costs 4 `insurance_read` units). `record_ai_call` allows 3
  follow-ups per parent; a read can make up to 8.
- `webResearch`'s `verify()` gets only the item's own citations, so an AM Best
  rating survives only when the rating page is one of the item's sources. Safe,
  but ratings will rarely show. Option: `allCitations` in the verify context.
- `LINKABLE_TABLES` (I-8 above).
- `DraftEmail`'s copy button reads "Copy text"; insurance-spec §7.4 says "Copy the
  email". Cosmetic.

## Known gaps

- **Not exercised signed in.** 0052 isn't on dev, so no insurance page has been
  rendered with data; every route 307s to `/login` without a session and none
  500s. §13.3 manual checks (text, scanned and iPhone uploads incl. HEIC; a
  3-policy package; live agency and insurer searches with the spot-check of
  phone numbers against cited pages; the quote flow end to end; owner summary as
  Ada/Cy; AI key unset; 375 px and VoiceOver; `state_code = 'WI'`; printing the
  facts sheet) are for the lead after applying 0052.
- **Statute data** is pinned to the Act as fetched on 2026-10-14; re-verify when
  the Act is amended (`STATUTE_VERIFIED_ON` in `src/lib/insurance/statute.ts`).
- **Market search polling** follows Foundation's 330 s stale window and
  `PollWhileRunning`, not §11.1's 3 minutes (a 3-minute retry would be refused by
  the server while the first run is still live).
- **The request-quotes flow** is an inline panel at the top of Quotes & emails
  on every screen size, not a desktop dialog.
- **Dismissing DOC-REQ-01** dismisses every "your declaration requires X"
  finding at once (dismissals are per rule).
- `src/lib/insurance/declarations.ts` still exports the legacy `GROUP_LABEL` and
  `policyWarnings`, used only by `tests/unit/insurance-declarations.test.ts`; they
  can go with those tests.
- Doug's decision needed: whether Walkup states it takes no referral fees from
  listed brokers (I-7). The app doesn't say it today.
- Security note from S1 (not insurance): `role_grants` and `unit_owners` insert
  checks (findings 4 and 5) need their own migrations.
