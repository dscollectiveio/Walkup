# Repairs & Upkeep: what's built, what Integration still has to do, known gaps

Written by R6-selfcheck, 2026-10-14. Steps R1 to R6 built repairs-spec.md
(migration `0053_repairs_v2`, libraries, server actions, every page). Details
and deviations are in `R1-migration.md` to `R6-selfcheck.md`.

## What Doug can now do in Repairs & Upkeep

**Problems (tickets)**
- Anyone in the building (owners and the board) reports a problem on its own
  page, from a phone: what's wrong, where (shared area or their unit), where
  exactly, details, urgency, access notes, and up to 6 photos that are shrunk
  on the phone before upload.
- If the text sounds like an emergency (gas smell, flooding, sparking, no heat
  in winter, fire, carbon monoxide, sewage...), safety steps appear while
  typing, with the building's own shut-off and utility numbers if the board
  entered them. The reporter says whether it's happening now; only then is it
  marked an emergency. The steps never depend on AI.
- Before reporting, owners see "Already reported?" matches and can tap
  "I'm seeing this too" instead of filing a duplicate.
- After reporting: "Walkup doesn't alert anyone", plus the board's listed
  phone numbers when it's urgent (nothing is ever sent automatically).
- In the background, AI suggests the kind of work, an urgency, follow-up
  questions and a possible emergency the rules missed. The board accepts or
  dismisses each suggestion.
- The board's problem page: one "what happens next" card per stage (new,
  getting quotes, contractor chosen, visit planned, being worked on, fixed,
  closed), photos, who's handling it (contractor, board member following it,
  visit date and time window, target date, estimate), quotes, a full timeline
  of every change and note (with internal board-only notes), and under "More":
  money (estimate, final cost, the payment in the books, the improvement
  threshold note), insurance claims and the deductible nudge, emails to
  contractors, documents, the AI suggestion, and "mark as duplicate".
- Edit details, change urgency (lowering an owner's report asks for a reason
  they will see), mark fixed with what was done, the final cost and the
  payment in one step, then rate the contractor. Reopen, close, "this is the
  owner's to fix", close fixed problems in bulk after 30 days.
- Tell owners about a visit (water/heat/power off, unit access) as an email
  draft with owners in Bcc.
- Lists: filter by status, stage, kind of work, where, urgent, mine; search by
  words or #number; sort; and a pipeline board with one quick action per card.
- **Today** view for the board: emergencies, what's new since the last visit,
  what needs a decision, visits this week, overdue items, coming up, ready to
  close, and four headline numbers.

**Quotes**
- Ask up to 5 contractors at once: Walkup drafts each email (or a phone
  script for contractors without email), or one email to all in Bcc. You send
  from your own mail app and mark it sent.
- Record each quote by hand, from an uploaded PDF, or by pasting a text, with
  "Read it for me" filling the fields. Compare side by side (like for like
  where possible, saying so where not), accept one (sets the contractor and
  estimate), tell the others politely, send the go-ahead.

**Finding contractors**
- For any problem, upkeep job or kind of work: your saved contractors first,
  then Google and a web search, each result with the reasons it ranks where it
  does (ratings weighted by review count, distance, your history, insured,
  takes emergency calls...). Web results are kept only when verified against
  their sources. Save them, or save and ask for quotes in one go.

**Contractor directory**
- Search, filter, sort; clickable phone/email/website; archive and restore;
  delete (admins). Paperwork at a glance: certificate and license expiring or
  expired, W-9 missing (only for contractors in use). Ask for a certificate, a
  W-9, or both (the certificate request names the association, its board and
  its managing agent as additional insureds, with the Illinois rule shown).
  Read a certificate PDF to fill the expiry date. Rates, second contact,
  payment methods, emergency service, job tags. Reviews with quick tags (edit
  your own), a dated notes log, full job history (problems, upkeep, payments),
  every email drafted or sent, and a working Google refresh.

**Upkeep**
- A schedule with month-end due dates that follow the usual month, the usual
  checklist (unticked extras for things only some buildings have), add/edit,
  mark done (logs it, rolls the date, offers a quick review), per-job history
  with edit and delete, archive, "turn into a problem", "find someone", and a
  calendar file (.ics) for your calendar app, including visits and insurance
  renewals.

**Bills**
- Regular bills: add, edit, pause, archive; mark paid once per period (moves
  the next due date), confirm autopay went through, payment history, insurance
  premium bills linked to their policy.

**Owners** see their reports, their unit's problems and shared-area problems
with photos, status updates told as roles ("The board marked it being worked
on"), who's handling it and when they're coming; they confirm a fix or reopen
it within 30 days, say how the visit went, and read the building's emergency
information. They never see costs, internal notes, or contractor records.

## Integration tasks still to do (repairs-spec §18)

None of these has been started (checked against the tree on 2026-10-14).

1. **§18.1 Home data** (`src/app/page.tsx`): open tickets with
   `ticket_board_details(due_on, triage)`, active upkeep tasks, more vendor
   columns, in-use contractor ids, `recurring_bills.paused_at`; feed
   `complianceFor`.
2. **§18.2 Urgent items** (`src/lib/home/urgent-items.ts`,
   `src/components/home/worth-a-minute.tsx`): six new keys
   (`repairs_emergency`, `repairs_possible_emergency`, `repairs_urgent`,
   `repairs_overdue`, `upkeep_overdue`, `contractor_paperwork`) with the
   spec's copy and icons; the existing `w9` action still links `/contractors`
   (should be `/repairs?view=contractors`). Tests `urgent-items-sync`,
   `home-snapshot`.
3. **§18.3 Coming up** (`src/lib/home/reminders.ts`): upkeep, repair visits,
   contractor paperwork expiries; skip paused bills.
4. **§18.4 Snapshot tile** (`src/lib/home/snapshot.ts`): exclude archived,
   count expired paperwork among in-use contractors, link
   `/repairs?view=contractors` (three `/contractors` hrefs today).
5. **§18.5 Setup guide** (`src/lib/home/setup-guide.ts`): `upkeep_schedule`
   and `emergency_info` steps; `vendors`/`w9` hrefs (two `/contractors` today)
   and counts.
6. **§18.6 Sidebar**: `badgeKey: "repairs"`, `EXTRA_TITLES` for
   `/repairs/report`, `/repairs/find`, `/repairs/emergency-info`,
   `/repairs/upkeep/`, `activePrefixes` so `/maintenance/*`,
   `/contractors/*`, `/bills` highlight Repairs & Upkeep; `repairsCount` in
   `src/app/layout.tsx` (board and owner rules; `loadRepairsSince` in
   `src/lib/repairs/page-data.ts` has the "since" rule). Update
   `sidebar-collapse.test.ts`.
7. **§18.7 Tour** (`src/lib/tour/steps.ts`): new `repairsBoard` and
   `repairsOwner` bodies.
8. **§18.8 DECISIONS #35** (a) to (m) in `docs/DECISIONS.md`.
9. **§18.9 Privacy page** (Foundation's file): confirm the Anthropic entry
   lists triage text (scrubbed), quote text, certificate text, and the
   contractor-search inputs; Google gets the vocabulary-only phrase when the
   board chooses it.
10. **§18.11 Other files**: `src/app/tax/this-year.tsx:101` and
    `src/app/tax/forms/[formId]/page.tsx:84` link `/contractors` (shim works;
    change to `/repairs?view=contractors`); `src/app/building/actions.ts`
    revalidates `/maintenance` (lines 176, 198, 220; change to `/repairs`);
    optional Building Info link to `/repairs/emergency-info`;
    `src/app/delinquency/reminder-letter-button.tsx:19` comment names the
    deleted `draft-panel.tsx`; Budget owner may delete
    `src/app/budget/add-bill-form.tsx` and `addRecurringBill` (unused by
    Repairs now).
11. **§18.12 Foundation requests**: all five landed (foundation-spec §17); nothing left.

## Known gaps and things to check

- **Migrations not applied anywhere.** 0053 (with 0052) must go to dev before
  any Repairs page works there: the new code reads 0053 columns and tables.
  Before applying, run R1's legacy-length queries (ticket titles 4 to 120
  characters, descriptions up to 4,000, contractor message subject/body,
  comment bodies) because rows outside them can't be edited afterwards.
- **No page has been opened in a browser.** After the migrations: §17.5
  manual checks (PostgREST with real JWTs for the owner insert-returning,
  reopen, roles, emergency info; mark upkeep done; close out from an upkeep
  task; double mark-paid; accept a quote; three quote requests in one call;
  triage as the reporter), Supabase advisors, the iPhone Safari photo check
  (arrives as JPEG under 2,560 px), VoiceOver on the report form, and every
  page at 375px wide with no sideways scroll.
- **Trade guessing** in the app follows the spec's keyword list; the one-off
  SQL backfill of legacy tickets used a slightly different order, so a few old
  tickets with two trades' words may carry a different trade than the app
  would guess (R2 note).
- **Nothing notifies anyone** (by design, DECISIONS #22): the board learns of
  reports from Today, the timeline and (once Integration adds it) the sidebar
  badge; the report confirmation says so.
- HEIC photos from browsers that can't decode them are stored as HEIC and
  shown as a download (Safari, where iPhone photos come from, converts).
- Report-time photos don't show the "already on another problem with a
  smaller audience" note (the ticket page's Add photos does); safe either way.
- `npm run lint` and `tsc` currently fail only on files outside Repairs
  (`src/lib/email-outbox/sanitize.ts`, `tests/db/email-reminders.test.ts`).
