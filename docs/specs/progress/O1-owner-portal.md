# O1: owner portal (build of docs/specs/owner-portal-spec.md)

Engineer: Owner portal workstream. Date: 2026-10-14. No git command run, nothing applied to any Supabase
project, no dev server started or stopped, no secret printed. Migration 0054 exists only as a file and in
PGlite; **the dev project (`xhrivmdkrcfkhjyhkhye`) does not have it yet**, so against the real dev app every
owner page currently shows the "We couldn't load this page" state (see Open issues).

## What was built

Migration
- `supabase/migrations/0054_owner_portal.sql`: the spec's SQL, with one fix (see Deviations 1). Board contact
  columns on `associations`; `invites.person_id` plus `invites_person_guard` and a redefined `redeem_invite`
  (claim your record); `persons_self_edit_guard` and `update_my_profile`; `viewer_context`;
  `unit_position_core` / `unit_statement_core` (internal, revoked from authenticated) and
  `unit_statement_summary` / `unit_statement`; `announcements`, `announcement_units`, `announcement_reads`
  (RLS select-only, same-association guards, lifecycle trigger, audit on the first two) and their RPCs
  (`save_announcement`, `set_announcement_status`, `set_announcement_pinned`, `delete_announcement_draft`,
  `mark_announcement_read`, `announcements_unread`, `announcement_reader_stats`); `document_links` target check
  widened with `announcements`; `board_roster`; `withdraw_payment_report`; the pending-report cap trigger.
  Every definer function pins `search_path = ''`, is revoked from `public, anon` and granted to `authenticated`
  (the two `_core` functions to nobody). Every new table has `association_id ... on delete restrict`, RLS and
  a same-association guard.

Libraries (`src/lib/owner/`)
- `standing.ts` (ownerStanding, moneyAnswer with the exact copy table), `statement.ts` (periods, lineAmount,
  balanceWords, lineSummary), `announcements.ts` (zod schema, preview, sort, readSummary, audienceLabel,
  mapSaveError, plus attachmentReadable / attachmentFix / ownersReached for the composer), `profile.ts`,
  `pay.ts` (memo, report words), `repairs-glance.ts` (pure) and `repairs-summary.ts` (server query),
  `viewer.ts` (cached `getViewer`), `viewer-types.ts`, `viewer-names.ts`, `load.ts` (shared reads),
  `flags.ts` (`STATEMENT_PDF_ENABLED = false`), `nav.ts` (owner navigation as data), `invite-email.ts`.

Components
- `src/components/board-only.tsx` (async server wrapper + `viewerIsOwnerOnly()`), `board-only-view.tsx`
  (presentational, rendered in tests), `owner/contact-line.tsx`, `owner/money-answer.tsx`,
  `owner/copy-field.tsx` (client), `owner/statement-download.tsx` (renders nothing while the flag is off),
  `owner/announcement-item.tsx`, `owner/viewer-unavailable.tsx`.

Pages and actions
- `src/app/owner/`: `page.tsx` (home), `loading.tsx`, `statement/page.tsx` (redirect or chooser),
  `statement/[unitId]/page.tsx` + `statement-table.tsx` (table from `sm`, cards on phones, period picker as a
  GET form), `pay/page.tsx` + `my-reports.tsx` (Withdraw with inline confirm), `building/page.tsx`,
  `profile/page.tsx` + `profile-form.tsx` + `email-preferences-slot.tsx` (returns null), `actions.ts`
  (`updateMyProfile`, `withdrawPaymentReport`).
- `src/app/announcements/`: `page.tsx` (owner list; board list with tabs, audience, read counts, actions),
  `[id]/page.tsx`, `[id]/mark-read.tsx`, `[id]/edit/page.tsx`, `new/page.tsx`, `composer.tsx` (units
  checklist, pin, show-until, DirectUpload or Document Hub pick, share prompt, two-step Post with the
  "goes to n owners" sentence, preview), `composer-data.ts`, `board-row.tsx`, `actions.ts` (`saveAnnouncement`,
  `setAnnouncementStatus`, `setAnnouncementPinned`, `deleteAnnouncementDraft`, `markAnnouncementRead`,
  `shareDocumentWithOwners`).
- Claim-your-record invites, as new files so Building Info only needs one mount line:
  `src/app/building/owner-invite-actions.ts` (`createOwnerInvite`) and `src/app/building/invite-to-sign-in.tsx`
  (button, link, copy, and a `DraftEmail` with the spec's text).

Tests
- `tests/db/owner-portal.test.ts` (43 tests: spec 10.1 numbers 1 to 39, 41, 42, plus a table-hygiene test and
  the restrict-delete check; 40 is the two lint suites below).
- `tests/unit/owner-standing.test.ts`, `owner-statement.test.ts`, `owner-announcements.test.ts`,
  `owner-misc.test.ts` (profile, pay words, repairs glance, names, StatementDownload flag, invite email),
  `owner-nav.test.ts`, `owner-copy.test.ts` (no em dash, no "vendor", no dangerouslySetInnerHTML, in all the
  files above and in the migration's error messages), `board-only.test.ts` (BoardOnlyView and ContactLine
  rendered to markup).
- `tests/e2e/owner.spec.ts` (read-only; new Playwright project `owner` added to `playwright.config.ts`).

## Deviations from the spec, and why

1. **Pin cap bug fixed in the migration.** The spec's `tg_announcements_lifecycle` returned early on INSERT,
   so a fourth announcement posted already pinned (`save_announcement(..., p_pinned => true, p_publish => true)`)
   skipped the three-pinned cap. The cap now also runs on INSERT. DB test 20 covers it.
2. **`ViewerUnavailable` instead of `Restricted`** when `getViewer()` is null (no person yet, aal1, failed
   lookup, or, today, a database without 0054). "You don't have access" would be false; this says reload.
3. **`shareDocumentWithOwners` also refuses a file pinned to one unit** (not only `legal_notice` and
   `unit_record`), because it clears `restricted_to_unit_id` and would otherwise widen a unit's private file.
   The composer shows "post to that unit only, or pick another file" for such a file.
4. **Home "Announcements" card is always shown** (the spec's "hidden when the board has never posted" cannot be
   known to an owner); empty text as specified.
5. **Composer**: Post is two-step (click Post announcement, then the inline "This goes to n owners now..."
   sentence with Post now / Back). The success "toast" is a `role="status"` banner on `/announcements`
   (`?notice=posted|draft`); there is no toast system in the app. "Save draft" sends `pinned=false`
   (a pin takes effect when posted; the hint says so).
6. **`announcementPreview` drops tag-like text** (`<b>`, `<script>`) and keeps plain `<` / `>` ("5 < 6" survives).
   Bodies are still only ever rendered as text.
7. **Test 38** proves "a report the board already answered cannot be withdrawn" with a board-dismissed
   report instead of a matched one (a matched report needs a bank transaction fixture). Same code path
   (`status <> 'pending'`).
8. **File placement**: `CopyField` is `src/components/owner/copy-field.tsx` (spec listed it twice, under
   `owner/pay/` and in 4.6). `nav.ts` is new: the owner navigation as plain data so a test can prove no board
   page is in it and every link exists; `config.tsx` should import it (Integration 2).
9. **Statement closing row** reads `Balance on {to or today}` with the last running balance. A year preset
   ends on 31 December, so charges due later in the year are in the balance, the same rule as the summary.
10. **`playwright.config.ts`**: one additive project (`owner`) so `owner.spec.ts` runs; `--project=app` is unchanged.
11. Not delivered here because they edit files I may not touch: the updates to `tests/unit/tour-steps.test.ts`,
    `sidebar-collapse.test.ts`, `setup-guide.test.ts` (Integration), and the sidebar/tour/home changes.
    The spec's `owner-nav.test.ts` covers `navFor` indirectly through `src/lib/owner/nav.ts`.

## Tests and commands (all run after the final edit)

| Command | Result |
|---|---|
| `npx vitest run tests/db/owner-portal.test.ts` | 43 passed |
| `npx vitest run tests/db/migrations.test.ts tests/db/rls.test.ts` (no exception-list change needed) | passed |
| `npx vitest run tests/unit/owner-*.test.ts tests/unit/board-only.test.ts` | 8 files passed (all green; combined run with the three DB files: 10 files, 147 tests) |
| `npx eslint` on every file listed above, `tests/e2e/owner.spec.ts`, `playwright.config.ts` | clean (0 warnings) |
| `npx tsc --noEmit` | no errors in my files. Errors present in other engineers' mid-edit files, ignored: `tests/db/email-reminders.test.ts` and `tests/unit/email-send-batch.test.ts` (0055), `src/app/building/import/actions.ts` (0056), `src/app/page.tsx` (`insuranceExpiry`, insurance rows), `.next/dev/types/validator.ts` (`/dues/send/[batchId]`). Earlier in the session a syntax error in `src/lib/email-outbox/sanitize.ts` hid all type errors; it was fixed by its owner. |
| `curl http://localhost:3100` on `/owner`, `/owner/statement`, `/owner/statement/<id>`, `/owner/pay`, `/owner/building`, `/owner/profile`, `/announcements`, `/announcements/new`, `/announcements/<id>`, `/announcements/<id>/edit` | all 307 to `/login`, none 500 |
| `npx playwright test --project=owner` (dev account is a Damen board account that owns no unit) | 14 passed, 2 skipped (the unit-statement test skips when the account owns no unit). Six routes at phone and desktop: status < 500, not bounced, an H1, no horizontal overflow, no console or CSP errors; composer test. Screenshots in `test-results/screens/owner-*-{phone,desktop}.png`. Note: because dev has no 0054 yet these screens are the "We couldn't load this page" state. Sign-in in the setup project failed on several back-to-back runs (likely auth rate limiting or dev-server load); it recovered after a pause. |

## Integration tasks for the lead engineer (exact files and text)

1. **Apply 0054 to the dev project** (I did not), then do the manual checks in spec 10.3. Order is 0054, 0055, 0056.
   0055 already redefines `redact_person`; the DB suite passes on the full chain.

2. **Sidebar** (`src/components/sidebar/config.tsx`, `sidebar.tsx`, `src/app/layout.tsx`): spec 7.1 to 7.3
   verbatim. Use `src/lib/owner/nav.ts` as the source of hrefs, labels, `tourId` and `badgeKey`: map icons by
   `tourId` (Home: `Home`, owner-statement: `Receipt`, dues: `HandCoins`, announcements: `Megaphone`,
   repairs: `Hammer`, budget: `BarChart3`, insurance: `Shield`, owner-building: `LifeBuoy`, documents:
   `Folder`, owner-profile: `UserRound`, my-unit: `UserRound`). Staff get `STAFF_ANNOUNCEMENTS` after Building
   Info and `STAFF_MY_UNIT` only when they own a unit (one `rpc("owned_unit_ids", { assoc })` in the layout's
   `Promise.all`). Add `announcements` to `badgeKey` and pass `announcementsCount` from
   `rpc("announcements_unread", { p_association_id })`. `isActive` for `/owner` must match exactly.
   `EXTRA_TITLES`: `{ prefix: "/owner/statement/", label: "Statement" }`, `{ prefix: "/announcements/", label: "Announcement" }`.
   Update `tests/unit/sidebar-collapse.test.ts` for the new prefixes and the optional `role` argument.

3. **Tour** (`src/lib/tour/steps.ts`): spec 7.4 verbatim (new steps `ownerHome`, `ownerStatement`, `ownerPay`,
   `announcements`, `ownerBuilding`, `myUnit`; owner order `[WELCOME, ownerHome, ownerStatement, ownerPay,
   announcements, repairsOwner, ownerBuilding, FINISH]`; staff gets `myUnit` after `dashboard` and
   `announcements` after `building`; remove `duesOwner`). Update `tests/unit/tour-steps.test.ts` to the ids
   `["welcome","dashboard","owner-statement","dues","announcements","repairs","owner-building","finish"]`
   and make its "targets exist" test read `ownerNavItems()` from `@/lib/owner/nav`.

4. **Home redirect** (`src/app/page.tsx`), directly after `getUser()`:
   ```ts
   import { redirect } from "next/navigation";
   import { getViewer } from "@/lib/owner/viewer";
   // ...
   const viewer = await getViewer();
   if (viewer && !viewer.isStaff) redirect("/owner");
   ```
   (`getViewer()` is null for a person with no record or an aal1 session; they fall through as today.)

5. **Board-only pages**: each gets the guard from spec 2.4 using the helper:
   `if (await viewerIsOwnerOnly()) return <BoardOnly what="..." why="..." alternative={{ label: "...", href: "..." }} />;`
   (imports `BoardOnly, viewerIsOwnerOnly` from `@/components/board-only`). Put it before the page's own
   empty or `Restricted` branch. Texts, per page, exactly as spec section 2.4:
   - `/bank-feed`: what "The bank feed", why "It shows the association's bank transactions, which only the board and the accountant can see.", alt "See your statement" -> `/owner`
   - `/financial-statements`: "Financial statements", "Profit and loss reports are shared with owners as documents when the board decides to.", alt "See documents shared with you" -> `/documents`
   - `/delinquency`: "Who owes money", "It lists every unit's balance, which is private to the board.", alt "See your own balance" -> `/owner`
   - `/ledger`: "The general ledger", "It holds every transaction, including other owners' payments.", alt "See your statement" -> `/owner`
   - `/tax`: "Taxes", "The association's tax returns and 1099s are prepared by the board with the accountant.", alt "See documents shared with you" -> `/documents`
   - `/building`: "Building Info", "It is where the board manages units, owners and who can sign in.", alt "See your building" -> `/owner/building`
   - `/contractors/[vendorId]`: what "Contractor details" (non-financial readers only)
   - `/dues`: owner-only users `redirect("/owner/pay")`; delete the inline owner branch (`if (!canReadFinancials) {...}` through its return) and keep the `howToPay` card for the board.
   - `/units/[unitId]`: an owner (not `can_read_financials`) who owns it: `redirect("/owner/statement/" + unitId)`.

6. **Building Info** (`src/app/building/*`):
   - `person-row.tsx`: for a person with no login who has an owner role or a unit, render
     `<InviteToSignIn personId={p.id} associationName={association.display_name} boardContactName={association.board_contact_name ?? null} />`
     (component and `createOwnerInvite` already exist in `invite-to-sign-in.tsx` / `owner-invite-actions.ts`).
   - Association profile form: three optional fields under the heading `Who owners write to` with `id="contact"`:
     `Board contact name`, `Board contact email`, `Board contact phone`; add `board_contact_name`,
     `board_contact_email`, `board_contact_phone` to the `updateAssociationProfile` update (validate the email
     with `^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$`, 254 characters; name 120; phone 40) and to the select in
     `page.tsx`.
   - Generic invite form: keep the role select; add a person select shown only for `owner` ("Link to someone
     already in your list, or leave blank to create a new person"), passing `person_id` on the insert.
   - The invite page (`src/app/invite/[token]/redeem-invite-form.tsx`) still asks for a name; for a claimed
     record the board's spelling is kept, so consider the hint "If the board already entered you, your name
     comes from their records."

7. **`src/app/dues/actions.ts` `reportOutsidePayment`**: map `error.code === "53400"` (hint `report_cap`) to
   `There are already ten reports waiting for this unit. The board will answer them first.`; reject a future
   `paid_on` with `Enter the date you paid, not a future date.`; add `revalidatePath("/owner/pay")` and
   `revalidatePath("/owner")`.

8. **Setup guide** (`src/lib/home/setup-guide.ts`, `src/app/page.tsx` select, `tests/unit/setup-guide.test.ts`):
   spec section 12 row for `setup-guide.ts` verbatim: step `board_contact`
   (`name: "Say who owners should write to"`, detail `Owners see {name} on their home page.` or `A name and an email, so owners know who to ask.`,
   `href: "/building#contact"`, done when `board_contact_email` is set, instructions `On Building Info, open the
   association profile and fill in Who owners write to.` / `Owners see it on their home page and your reminder
   emails reply to it.`), rework step `invites` ("Invite them to sign in") to done when any invite carries a
   `person_id` or any invite exists, and informational step `first_announcement` (`Post a welcome note`, href
   `/announcements/new`, done when `announcementCount > 0`, never blocks "complete").

9. **Terms** (`src/app/terms/page.tsx`), "1. Who can use Walkup": `Owners can sign in to see their own balance,
   statements and the notices the board posts. The board decides who is an owner of which unit.`
   **Privacy** (`src/app/privacy/page.tsx`), "What we collect": `Announcements your board posts, and a record of
   which owners opened them. The board sees how many owners opened a post, not who.` and `A phone number and
   mailing address you add to your own profile.` (update `tests/unit/privacy-page.test.ts` if it pins the list).

10. **docs/DECISIONS.md**: append the text in spec 1.4. **Number clash:** L1 allocated #37 to the Plaid
    webhook, so renumber this one (next free number) and fix the "#37" in the spec header and section 1.3.
    Mention in it the three things beyond the spec: pin cap enforced on insert, `shareDocumentWithOwners`
    never widens a unit-pinned file, a viewer that cannot be resolved sees "We couldn't load this page".

11. **`tests/e2e/app.spec.ts`**: optional owner-account smoke (`/` -> `/owner`) once a dev owner account exists;
    `owner.spec.ts` already covers the pages as whoever the dev account is.

12. **When the money spec ships**: set `STATEMENT_PDF_ENABLED = true` in `src/lib/owner/flags.ts` together with
    the `/statements/{unitId}/pdf` route; replace the body of `src/app/owner/profile/email-preferences-slot.tsx`
    with the preferences card; add the "Email this to owners" button to posted rows in
    `src/app/announcements/page.tsx`. The 0055 sender can call `unit_position_core` / `unit_statement_core`
    (no access check, not callable by `authenticated`).

## Open issues

- **Dev database has no 0054** (above). Until it is applied, `getViewer()` fails on the missing columns and
  functions and every owner page shows the unavailable state; the PostgREST layer of the new pages (embedded
  selects such as `documents` with `document_categories(slug)`, `announcement_units` with `units(label)`,
  array and null RPC arguments) has been type-checked but not exercised against a live database.
- **Board contact is not editable anywhere yet** (Integration 6); until then the contact line says
  "Ask a board member." and a board admin sees "Add the board contact" linking to `/building#contact`.
- **Announcement expiry uses UTC `current_date`** in SQL (spec section 3.1): a post ending "today" disappears
  at about 7 pm Central in summer. The board list uses the building's day for its "Ended" label. Accepted in the spec.
- A statement's closing balance for a future-dated `to` includes charges due later that year (consistent with
  `owed`, but an owner may read it as "what I owe today"; the answer card above it states today's figures).
- The unit-statement e2e test has never run against a real owner account (the dev account owns no unit).
- Attachments of "duplicate" uploads: if `DirectUpload` reports only `duplicateOf`, the composer treats that
  file as board-only until it is picked from the list or shared; the database check is the final word either way.
