# X1-integration: Home, sidebar, tour, Building Info, documents, decisions, full checks

Step owner: Integration. Date: 2026-10-14. No git commands run; no migration
written, touched or applied; no dev server started or stopped; no dependencies
added. Read every note in this folder first (L1's numbering and D1's card
design are followed).

## Built

| Task | Files |
|---|---|
| **Worth a minute** (insurance I-1/I-2, repairs §18.2, foundation 5.3): renewal nudge on each policy's own `renewal_reminder_days` with the short coverage label and `Get quotes` → `/insurance?view=quotes&new=1`; Insurance's own to-dos from `loadInsuranceBanners()` (key `insurance_task`, a failed read is "Needs attention"); the six repairs keys with the spec's copy; W-9 link → `/repairs?view=contractors`; finished background runs (key `ai_finished`). D1's card kept, icons added to `ICONS`. | `src/lib/home/urgent-items.ts`, `src/components/home/worth-a-minute.tsx` |
| **Background runs on Home**: contractor web searches and Marketplace searches whose `ai_finished_at` is in the last 24 hours (done or failed), newest first, linking back to the same search (phrase and wants rebuilt from `query_key`). | `src/lib/home/finished-runs.ts` (new, pure) |
| **Snapshot tile**: insurance input is now `insuranceRenewal` (soonest policy in force, `withinReminder`, `renewed` → "renewal saved", neutral); contractor tile drops archived contractors, counts W-9s and expired certificates and licenses among contractors in use, links `/repairs?view=contractors`. Removed the em dash in the bank tile ("Linked, one needs attention"). | `src/lib/home/snapshot.ts` |
| **Coming up**: `renewed` skips "Get insurance quotes"; coverage short labels; quote follow-ups (on `follow_up_on`, overdue reads as today) and quote expiries (from 7 days before `valid_until`, not declined or chosen); upkeep within 60 days (overdue kept on its date), visits within 14 days, contractor certificate/license expiries within 60 days; paused bills skipped. Reminders gained an optional `href`, which `ComingUp` renders as a link. | `src/lib/home/reminders.ts`, `src/components/home/coming-up.tsx` |
| **Setup guide**: insurance done = a policy whose computed status is `active`; AI on/off copy; new `insurance_owner_summary` step; `upkeep_schedule` and `emergency_info` lead the upkeep section; contractor steps link `/repairs?view=contractors`, ignore archived, W-9 counts only contractors in use. | `src/lib/home/setup-guide.ts` |
| **Home data**: new policy select (archived filtered, `withStatus`/`renewalFor`), board-only loaders (banners, quote requests and quotes, owner summary, emergency info, finished runs), financial-reader loader (open tickets with `ticket_board_details`, active upkeep, expenses in the last year → in-use contractors, `complianceFor`), bills from `recurring_bills` with `paused_at`, owner card "What the building's insurance covers" when `owner_insurance_summary` returns a summary. | `src/app/page.tsx` |
| **Sidebar**: `insuranceNavLabel(role)` / `navGroupsFor(role)` ("Insurance" for owners and the accountant), `activePrefixes` on Repairs & Upkeep (`/repairs`, `/maintenance`, `/contractors`, `/bills`) via `isNavItemActive`, `badgeKey: "repairs"` with a gold badge, `EXTRA_TITLES` for every insurance and repairs sub-page, read before the nav items so sub-pages get their own name. `TopBar` takes `role`. | `src/components/sidebar/config.tsx`, `sidebar.tsx`, `top-bar.tsx` |
| **Repairs badge**: rules in a pure module; queries in the root layout (board: urgent/emergency, undismissed AI emergencies, someone else's reports since `loadRepairsSince`, overdue upkeep, each problem once; owner: owner-visible events by someone else on their reports or units since their last visit, plus their reports resolved in the last 30 days). Errors read as 0. The layout also passes `role` and `stateCode`. | `src/lib/home/repairs-badge.ts` (new), `src/app/layout.tsx` |
| **Tour**: the three insurance steps (after Taxes for the board and accountant, after HOA Dues for owners), "Illinois law" swapped out for non-IL associations (`AppTour` gets `stateCode`), new `repairsBoard`/`repairsOwner` bodies. | `src/lib/tour/steps.ts`, `src/components/tour/app-tour.tsx` |
| **Building Info** (I-6, §18.11): caption without the em dash; board card "Insurance facts" (replacement cost and date, flood zone, boiler or elevator, who handles the money, or "Not answered yet"), "Master policy: {carrier}, renews {date}" → `/insurance`, "Edit on Insurance", "Emergency information"; non-board viewers keep `Restricted` plus links to `/insurance` and `/repairs/emergency-info`; `actions.ts` revalidates `/repairs` instead of `/maintenance`. | `src/app/building/page.tsx`, `association-profile-form.tsx`, `actions.ts` |
| **Documents** (I-8): `insurance_quotes` and `insurance_claims` are linkable; policies/quotes/claims revalidate the `/insurance` layout; document page shows "Use it on Insurance" for board users on insurance documents (Insurance's `ReadButtons` with AI on; "Enter it as a policy/quote" links with AI off) and a "Linked to" list of policies, quotes and claims. | `src/app/documents/upload/link-targets.ts`, `src/app/documents/[documentId]/page.tsx` |
| **Pipeline** (I-9): `readDeclarationsIfInsurance` and its `FIELD_DEFS`/`extractPdfPages` imports deleted; a document a person filed as Insurance stores its text and is done without the classifier; filing rules no longer touch a category a person chose. | `src/lib/documents/pipeline.ts` |
| **Privacy** (I-10, §18.9): reading quotes and certificates; triage sends location detail with emails, phones, unit numbers and amounts removed; summaries never send policy number, named insured, address or agent details; insurance drafts send only kind and coverage types; web search and Google receive only the repair-vocabulary phrase. | `src/app/privacy/page.tsx` |
| **Security** (foundation §14, L1): Anthropic as a subprocessor with its four uses on `/security` and in SECURITY_POLICY §7; §8's "no Plaid webhook" gap replaced with PL3's webhook text (DECISIONS #37). The braces accepted-risk text was already there. | `src/app/security/page.tsx`, `docs/SECURITY_POLICY.md` |
| **DECISIONS**: #35 (brief §1's eleven decisions, the referral-fee line for Doug, foundation sub-decisions, insurance (a)-(l), repairs (a)-(m), integration choices), #36 reserved for the email build, #37 the Plaid webhook (PL3's text, per L1's numbering). | `docs/DECISIONS.md` |
| **Other**: `maxDuration = 300` on `/units/[unitId]` (and in `ai-max-duration.test.ts`); tax links → `/repairs?view=contractors`; I-12 `src/lib/money/cents.ts` (moved verbatim, re-exported from `form1120h.ts`) and Insurance's eight imports switched to it; I-11 Budget hint "Current premiums: {total} a year" under the Insurance category (financial readers); unused `src/app/budget/add-bill-form.tsx` and `addRecurringBill` deleted (§18.11); `eslint.config.mjs` ignores `playwright-report/**` and `test-results/**` (generated by E1's harness; `npm run lint` was failing with 250+ errors from minified trace JS). | as named |
| **Build fix**: `npm run build` failed: `entity-documents.tsx` (client) imports `isLinkableTable` from `link-targets.ts`, which imported `next/cache` for `revalidateLinked`. Moved `revalidateLinked` to a new server-only `link-revalidate.ts`; `link-actions.ts` and `upload/actions.ts` import it from there. | `src/app/documents/upload/link-targets.ts`, `link-revalidate.ts` (new), `src/app/documents/link-actions.ts`, `src/app/documents/upload/actions.ts` |
| **Tests**: updated `urgent-items`, `urgent-items-sync`, `home-snapshot`, `setup-guide`, `insurance-reminder`, `tour-steps`, `sidebar-collapse`, `ai-max-duration`; new `home-reminders.test.ts` (repairs rows, paused bills) and `home-finished-runs.test.ts` (finished runs, both badge rules). | `tests/unit/*` |

## Deliberately different from the spec, and why

1. **Insurance sub-decisions are inside #35, not a separate #36.** L1 reserves
   #36 for the email decision and #37 for the Plaid webhook; insurance-spec I-7
   predates that numbering. #36 is a "Reserved" stub pointing at
   money-and-reminders-spec §1.1, so the file has no gap.
2. **DECISIONS #37 numbering collides with owner-portal-spec 1.4 (#37) and
   import-spec (#38).** I followed L1 (Plaid = #37). Owner portal and imports
   should take #38 and #39 when they append theirs.
3. **The snapshot's insurance input is not `renewalFor()`'s object.**
   `renewalFor` excludes renewed policies, so "renewal saved" could never show.
   Home passes the soonest policy in force (renewed or not) with `renewed` and
   `withinReminder`; urgent items still get `renewalFor()`.
4. **Insurance banners became Worth-a-minute items** (key `insurance_task`)
   rather than a separate banner strip, with a one-line "why" per kind, so
   D1's card stays the one place for to-dos.
5. **Background-run card = Worth-a-minute items**, shown for 24 hours after
   `ai_finished_at`, board-wide. `contractor_search_cache` has no `created_by`,
   and `insurance_market_research.created_by` is only the row's first creator,
   so "the person who left" can't be identified; the 24-hour window keeps it
   from nagging.
6. **Snapshot and W-9 step count only contractors in use** (repairs §18.4,
   §18.5); an expired certificate of a contractor not in use is not a gap on
   Home (Repairs' directory still shows it, per `complianceFor`).
7. **Pipeline, manual Insurance with no text layer:** text extraction runs
   first, so a scanned insurance PDF ends `skipped` with the reader's reason
   (as before), not `done`. The document page's "Use it on Insurance" buttons
   are the way forward for it.
8. **Owners on `/building`** keep `Restricted` plus two links, not
   owner-portal's `BoardOnly` (that guard needs 0054's `viewer_context` and is
   the owner-portal integration's change; see requests below).
9. **Bills on Home read `recurring_bills`** (`is_active`), not the 0013
   `upcoming_bills` view, which has no `paused_at`.
10. **Pipeline category guard**: rules are skipped (not just prevented from
    overwriting) when a person chose the category; the folder a rule would set
    is skipped with it.

## Not done

- Optional items: metering `classify.ts` as `document_classify` (foundation §14),
  `/units/[id]` listing the unit's tickets (repairs §18.11).
- `src/app/delinquency/reminder-letter-button.tsx` comment (§18.11): the file was
  deleted by the email workstream while this step ran; nothing to change.
- Foundation's `DraftEmail` "Copy text" label (insurance-report): foundation-spec
  §8 names it "Copy text", and that spec is authoritative for its component.
- Foundation requests in insurance-report (`runStructured` follow-up metering,
  `allCitations` in `verify`): Foundation's design changes, not integration.
- Not checked signed in: the dev DB has none of 0051 to 0058, so Home, the
  badge and Building Info would error on dev until the lead applies them. The
  columns and functions every new query names were checked against the
  migrated PGlite schema (throwaway probe, deleted).

## Cross-workstream requests

- **Owner portal (its integration step):** sidebar (`src/lib/owner/nav.ts` plus
  `config.tsx`/`sidebar.tsx`): `navGroupsFor(role)` and `insuranceNavLabel` now
  exist, and the layout already computes `repairsCount` for owners (badge key
  `repairs`). Swap `/building`'s non-board branch for `BoardOnly` (keep a link to
  `/insurance`). Tour: insert `insuranceOwner` into the new owner order.
  DECISIONS: use #38, not #37.
- **Imports:** DECISIONS #39 (not #38) if owner portal takes #38.
- **Email:** append #36 in place of the reserved stub.

## Commands run

- Baseline: `npx tsc --noEmit` exit 2, 14 errors, all in
  `tests/db/email-reminders.test.ts` and `tests/unit/email-send-batch.test.ts`
  (email workstream, in progress). `npm run lint` exit 1: 259 errors, almost all
  in `playwright-report/**` (generated), plus `src/lib/import/normalize.ts` and
  `tests/db/email-reminders.test.ts` (in progress then). `npx vitest run`
  (started during my first edits): 189 files, 7 failed tests, all expectation
  changes from this step plus `email-service-rpc` (email workstream; green on
  later runs).
- During: `npx vitest run` on the nine home/tour/sidebar files: 85 passed;
  `tests/unit/privacy-page.test.ts`: 5 passed; throwaway
  `tests/db/zz-x1-probe.test.ts` (every new column/function exists): passed,
  deleted; `npx eslint` on every touched file: clean; `npx vitest run
  tests/unit`: 161 files, 1966 passed.
- `npm run build` (first): failed on the `link-targets.ts` client/server import
  above; fixed; second run exit 0 ("Compiled successfully", every route listed).
- Final: `npx tsc --noEmit` exit 0 (whole project, 0 errors); `npm run lint`
  0 errors, 4 warnings (pre-existing, `scripts/security/attack-rls.mjs`);
  `npx vitest run` (full suite, every migration via PGlite) 209 files, 2724
  tests passed; after the last two small edits (build fix, license wording)
  `npx vitest run tests/unit` 161 files, 1967 passed and tsc/lint re-run clean;
  `npm run build` exit 0.
