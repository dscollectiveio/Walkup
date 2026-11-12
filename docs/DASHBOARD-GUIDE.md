# Dashboard guide (for Doug)

A complete reference for the Dashboard tab (`/`): who sees it, what every card shows, where every number
comes from, and a review of what is wrong or missing.

**Written:** 2026-11-11, from a read of the code in the working tree (which has uncommitted Dashboard changes on
top of commit `1bbbc96`). Nothing here was checked on screen: the signed-in Dashboard sits behind two-step
sign-in. Where a statement is an inference and not something read directly from code, it says so.

**Main files**

| What | File |
|---|---|
| The page: every query, every calculation, the layout | `src/app/page.tsx` |
| Server actions (reserve target, setup guide, tasks) | `src/app/home-actions.ts` |
| Cards | `src/components/home/*` |
| Pure rules (testable) | `src/lib/home/*` (`snapshot.ts`, `urgent-items.ts`, `reminders.ts`, `setup-guide.ts`, `finished-runs.ts`) |
| Bank cash | `src/lib/bank/position.ts`, `src/app/bank-feed/balances.tsx` |
| Money helpers shared with Budget | `src/lib/money/*` |
| Who is looking | `src/lib/owner/viewer.ts`, `src/lib/access/outside-roles.ts` |

---

## 1. Who sees the Dashboard

`/` is three different things depending on who asks.

| Visitor | What `/` does |
|---|---|
| Signed out | Shows the landing page. This is the only version search engines see. |
| Board admin, board member, accountant ("staff") | Shows the Dashboard. |
| Property manager | Redirects to `/repairs`. |
| Attorney | Redirects to `/documents`. |
| Observer, owner | Redirects to `/owner` (the owner Home, a separate page not covered here). |
| Signed in, but no person record or two-step sign-in not finished | Falls through to the Dashboard code. Row-level security then returns no association, and the page says "No association is visible to you." |

The rule is in `homePathFor()` (`outside-roles.ts`). A person's highest role decides, in this order: board admin,
board member, accountant, property manager, attorney, observer, owner.

### The three permission checks the page makes

All three are database functions, so the database is the real gate and the page only decides what to draw.

| Flag in `page.tsx` | Database check | True for |
|---|---|---|
| `isAdmin` | `has_role_in(assoc, ['board_admin'])` | Board admin |
| `isBoard` | `has_role_in(assoc, ['board_admin','board_member'])` | Board admin, board member |
| `canReadFinancials` | `can_read_financials(assoc)` | Board admin, board member, accountant |

`has_role_in` (migration 0025) also requires a two-step session, a grant that is not revoked, and an end date that
has not passed. So an accountant whose 90 days ran out stops being staff and lands on `/owner`.

### What each staff role sees

| Part of the Dashboard | Board admin | Board member | Accountant |
|---|---|---|---|
| Greeting and status line | Yes | Yes | Yes |
| "Books balance" pill (top bar) | Yes | Yes | Yes |
| Walkup plan notices (billing) | Yes, with a button | Yes, told to ask an admin | No |
| Where the association stands | Yes | Yes | Yes |
| Bank balance refreshed live from Plaid on visit | Yes | No, sees the last stored balance | No, sees the last stored balance |
| "Set a reserve target" | Yes | No | No |
| Status Check tiles | Yes | Yes | Yes (one tile is wrong for them, see finding 4) |
| Setup guide | Yes, can tick steps and "Skip for now" | Yes, read-only | No |
| "Show setup guide" (after a skip) | Yes | No | No |
| Your list | Yes, can add and tick | Yes, can add and tick | Reads manual tasks only, cannot add |
| Coming up: bills, insurance renewal, dues, taxes, W-9s | Yes | Yes | Yes |
| Coming up: quotes, upkeep, contractor visits, contractor paperwork | Yes | Yes | No |
| Coming up: access review | Yes | No | No |
| Announcements card | Yes, with "Post one" | Yes, with "Post one" | Yes, hidden when empty |
| The building | Yes | Yes | Yes |
| Your HOA Financials, Wrapped | Yes | Yes | Yes |
| Alerts (currently hidden for everyone, see section 5) | Repairs, access, terms, email, AI runs, plus the shared ones | Repairs, AI runs, plus the shared ones | Shared ones only |

Row-level security also narrows the underlying data. The views the page reads are `security_invoker`, so each
person's own permissions apply inside them.

---

## 2. Layout, top to bottom

1. **Alerts and announcements banner.** Built, but switched off by `SHOW_ANNOUNCEMENTS_STRIP = false` at the top
   of `page.tsx`.
2. **Greeting** and a one-sentence status line. The "Books balance" pill is drawn in the top bar, not in the page.
3. **Walkup plan notices**, only when billing has something to say (board only).
4. **A red notice** if the fund balances or the totals failed to load.
5. **Row one**, 60% and 40% on large screens (`lg:grid-cols-[3fr_2fr]`), stacked on small ones:
   - Left: **Where the association stands**.
   - Right: **Set up your building** while setup is unfinished and not skipped. Otherwise **Your list**.
     If setup was skipped, an admin also gets a slim card with "Show setup guide".
6. **Row two**, 60% and 40%:
   - Left: **Coming up**, with the **Announcements** card under it. With no reminders, Announcements takes the
     whole left side.
   - Right: **The building**.
7. **Your HOA Financials, Wrapped**: a full-width card that rotates through three charts.

The left card sets the height of each row. The right column matches that height and scrolls inside.

The page is `force-dynamic`: nothing is cached, and every visit re-runs every query.

---

## 3. "Today" and time

- Every date comparison uses the building's calendar day from `buildingTodayIso()`, which is America/Chicago.
  The server runs on UTC, so this stops the page from flipping to tomorrow at 7pm Chicago time.
- The greeting ("Good morning") uses Chicago time when the association's state is IL, and UTC for any other state.
- Role end dates are checked in the database with `current_date`, which is the database's day (UTC), not the
  building's.

---

## 4. Card by card

### 4.1 Greeting and status line

- **Name:** first word of the signed-in person's `persons.full_name`. Falls back to the part of their email
  before the @, then "there".
- **Status line**, first match wins:
  1. No posted activity: "No financial activity has been recorded yet."
  2. Any unit past due: "$X is past due across N units." Adds "Everything else looks in order." only when no
     other alert exists.
  3. No unit past due but other alerts exist: "Every unit is current. A few other things need a look below."
  4. Otherwise: "Every unit is current and nothing is overdue."
- **Past due** is the sum of the three late buckets in the `delinquency_aging` view (1 to 30, 31 to 60, over 60
  days). A charge entered ahead of its due date is not late and does not count.
- **Books pill:** shown once anything is posted (`association_totals.visible_tb_rows > 0`). Green "Books
  balance" when total debits equal total credits in the trial balance, red "Books don't match" otherwise.

### 4.2 Walkup plan notices (board only)

Two separate blocks, both about Walkup's own subscription:

- **`BillingNotices`:** the notices the Terms promise (price change, read-only, end of early access, end of a
  founding year). Shown until the date they take effect. A read-only notice shows only while the building is
  still behind on payment.
- **`BillingNotice`:** one banner, only when action is needed soon: payment past due, grace, read-only, a trial
  in its last 7 days with no plan chosen, or a complimentary period in its last 30 days. Nothing shows while
  billing is off. A board admin gets "Choose a plan" or "Manage billing" (to `/account?tab=billing`).

### 4.3 Where the association stands

**Which balance is shown**

- **A bank is connected** (any connection not "disconnected") and has reported a balance: the figures are the
  bank's. They come from `bank_account_balances`, counting only `depository` accounts (checking, savings, money
  market, CDs). Cards, loans and investments are never counted. The header reads "Your bank's balance across
  all accounts".
- **No bank:** the figures come from the books: `fund_cash_balances`, which is debits minus credits on cash
  accounts in posted journal entries, per fund. The header reads "Balance across all accounts, from the books".

**Day-to-day versus reserve.** Each bank account takes the fund kind of its connection, unless a board admin
assigned that one account to a fund (`bank_account_funds`). A connection with no fund counts as operating.

**Live refresh.** When a board admin opens the Dashboard, the page asks Plaid for fresh balances for every
active connection, stores them, and remembers the answer for a few minutes. Members and the accountant read
whatever was stored last.

**Books versus bank warning.** When both exist and differ, a red line says "Books are $X above/below the bank."
It adds "N to categorize" when bank transactions are still waiting, or "Check the opening balance" when none
are. N is the uncategorized count: bank transactions with no posting, not excluded, not removed, not pending.

**Left ring: Bank Account Balances.** Reserve as a share of all money, with day-to-day, reserve and total
underneath. The ring is skipped when the total is zero or either figure is negative.

**Right ring: Reserve Fund.** Reserve held against `associations.reserve_target`. The percentage is rounded
down, so 99.6% never reads as 100%. The label can pass 100% while the ring stops at full. A board admin can
set or clear the target here. The target is a goal the board types in, not a ledger figure.

**Status Check tiles** (`buildSnapshot` in `snapshot.ts`). Four tiles, each a link:

| Tile | What it says | Where it comes from |
|---|---|---|
| Bank connection and sync | "Not linked yet"; "Needs reconnecting" when no connection is active; otherwise "Linked" with the bank name, when it last synced, and how many transactions need a category | `bank_connections` (status, `last_synced_at`) and the uncategorized count. Marked for attention when a connection is in error, the last sync is 3 or more days old, or anything needs a category. |
| Insurance information | "No policy recorded yet"; "Policy recorded" with "Owner summary not published yet"; or "Complete" | Whether a policy is active today (computed from dates, never stored) and whether `insurance_owner_summaries.published_at` is set |
| Tax information | "EIN not on file yet"; "EIN on file" with "Tax review not started yet"; or "Set up" | `association_tax_ids.ein`, and whether this fiscal year's 1120-H figures were saved or any tax form was started |
| Contractor W-9s and paperwork | "None added yet"; "In order"; or "N gaps" listing W-9s missing, insurance certificates expired, licenses expired | `vendors`, excluding "do not use" and archived. Paperwork only counts for contractors in use. |

"In use" means: assigned to an open problem, the usual contractor on an active upkeep job, or paid or used in
the last 365 days.

The insurance and tax tiles reuse the setup guide's automatic answers and ignore any step an admin ticked by
hand, so a hand tick cannot make a tile say "Complete".

### 4.4 Set up your building (the setup guide)

Shown to the board while setup is unfinished and the guide has not been skipped.

- **How steps get ticked:** every step is worked out from real rows (`buildSetupGuide` in `setup-guide.ts`).
  A step is done because the thing exists, not because someone ticked a box.
- **Progress:** counts only required steps. Optional steps (the three imports, the welcome announcement,
  financial statements, email sending) never block "complete".
- **Hand ticks:** a board admin can mark a step done or not done by hand, or return it to automatic. Stored in
  `associations.setup_overrides`. The "Categorize and post the backlog" step cannot be ticked by hand while
  transactions still need a category.
- **Skip for now:** sets `associations.setup_dismissed_at`, which hides the guide for everyone in the
  association. A board admin can bring it back.
- **Board members** see the guide read-only.

The steps and what makes each one done:

| Section | Step | Done when |
|---|---|---|
| Building & Owners | Fill in the association's details | EIN, city, county and incorporation date are all set |
| | Say who owners should write to | `board_contact_email` is set |
| | Import units and owners (optional) | A committed `units_owners` import exists |
| | Add every unit | At least one unit exists |
| | Assign an owner to each unit | Every unit has a current owner |
| | Add the rest of the board | Another person holds an active board or accountant grant |
| | Invite them to sign in | Any invite exists |
| | Post a welcome note (optional) | Any non-draft announcement exists |
| Finances & Dues | Opening balances (optional) | A committed `opening_accounts` import exists |
| | Connect the bank account | A connection is active |
| | Sync transactions | An active connection has synced |
| | Categorize and post the backlog | Synced, and nothing needs a category |
| | Import last year's transactions (optional) | A committed `transactions` import exists |
| | Financial statements (automatic) | Any posted journal entry exists |
| | Set this year's budget | The current fiscal year has a budget line |
| | Tell owners how to pay dues | A payee name, account number or Zelle handle is set |
| | Turn on email (optional) | `email_settings.sending_enabled` |
| | Set the dues schedule | A non-special assessment schedule exists |
| Taxes & Insurance | EIN on file | EIN is set |
| | Review Taxes at year end | This year's 1120-H figures were saved, or a tax form was started |
| | Record the insurance policy | A policy is active today |
| | Tell owners what the master policy covers | The owner summary is published |
| Building upkeep | Set up the upkeep schedule | An active upkeep task exists |
| | Add emergency info | At least 2 emergency facts or contacts are filled in |
| | Add your contractors | A saved, non-archived contractor exists |
| | Collect contractor W-9s | Contractors exist, and every one in use has a W-9 or is 1099-exempt |
| | Upload the declaration and insurance certificate | A current document in "governing" and one in "insurance" |

### 4.5 Your list

Takes the setup guide's place once setup is finished or skipped. Also what the accountant sees in that spot.

- **Setup rows:** the still-open required setup steps, as links. They tick themselves. Board only.
- **Manual tasks:** rows in `board_tasks`, each with an optional owner. Board and accountant can read them. The
  board can add and tick them. Only a board admin may delete one in the database, and there is no delete
  button in the app.
- **Progress bar:** finished setup steps plus finished manual tasks, over the total of both.

### 4.6 Coming up

`assembleReminders` in `reminders.ts`. Sorted soonest first. **Only the first 6 are shown.** Each row has a day
count, a colored rail (red inside 30 days or overdue, amber inside 90, grey beyond), and the date.

| Row | Appears when | Source |
|---|---|---|
| Bill to pay by hand | An active, unpaused recurring bill without autopay is due within 120 days, or its date has passed (shown as late) | `recurring_bills` |
| Insurance renewal | The soonest policy end date within 120 days | `insurance_policies` |
| Get insurance quotes | A policy not yet renewed reaches its own lead time (`renewal_reminder_days`, default 60) | `insurance_policies` |
| Follow up about your quote (board) | A sent quote request has a follow-up date within 120 days | `insurance_quote_requests` |
| Quote expires (board) | An open quote lapses within 7 days | `insurance_quotes` |
| Upkeep job (board) | An active upkeep job is due within 60 days, or overdue | `upkeep_tasks` |
| Contractor visit (board) | A visit on an open problem is scheduled within 14 days | `tickets.scheduled_for` |
| Contractor paperwork (board) | An in-use contractor's certificate or license expires within 60 days | `vendors` |
| Assessments due from N units | The next due date among open charges after today | `charge_balances` |
| Tax filings and their nudges | Every dated deadline for the filing year, with "send to your accountant" and "start it" nudges | `lib/tax/deadlines`, the same list the Taxes tab uses |
| Collect N W-9s | Contractors paid at or over the 1099 threshold have no W-9. Dated December 1, or today once that has passed. | `vendor_1099_calendar_totals`, `tax_parameters` |
| Access review (admin) | 90 days after the last recorded review, or today if never done | `access_reviews` |

Tax notes:

- A date comes from a verified template's rule, or from a built-in estimate. An estimate is labelled
  "estimated, not yet checked" until you or the CPA verify it on `/admin/tax-templates`.
- All 1099-NECs are grouped into one row on the earliest date.
- The Dashboard cannot run the two 1120-H qualification tests (it has no ledger figures), so it never says
  whether the association qualifies. The Taxes tab does.
- The 1099 year is last year during January and February, the current year otherwise.

### 4.7 Announcements card

- Loads the 6 newest published, unexpired announcements. Shows 3: pinned first, then newest.
- A gold dot marks ones this person has not opened (`announcement_reads`).
- "Post one" for the board. The card is hidden for a person who cannot post when nothing is posted.

### 4.8 The building

- One floor per unit from `unit_balances`, lowest unit at the bottom. The drawing appears for 2 to 6 units.
  Outside that range only the list shows.
- **Status per unit**, first match wins:
  1. "not shown to you": no visible charges and no visible books.
  2. "no owner on file": no current owner (`unit_owners` by effective dates).
  3. "behind", with "owes $X": the unit has a late balance in `delinquency_aging`.
  4. "up to date".
- Clicking a floor opens that unit in Building & Owners.
- **Footer line:** "Dues run $X a month · N of M units current." X is the `charged` total of the latest month in
  `monthly_dues_collection`. N counts units whose status is "up to date".

### 4.9 Your HOA Financials, Wrapped

One card, three views. It rotates every 12 seconds, pauses on hover or keyboard focus, and has tabs. A view
with no data is left out. With none, the card says nothing has been recorded yet.

**In the bank**

- A line of month-end balances for up to the last 12 months, with the net change over that window.
- With a bank connected: starts from today's bank total and works backwards through bank transactions on the
  cash accounts. Months before the synced history are left out.
- Without a bank: a running total of posted cash movements from `monthly_cash_activity`, starting at the first
  month with activity.

**In & out**

- Bars for the last 6 months: money in against money out.
- With a bank: every settled bank transaction on a cash account, positive as in, negative as out.
- Without a bank: the books, with transfers between the association's own accounts taken out.
- A month where more went out than came in is marked as a shortfall. The most recent one gets a "mostly
  {category}" caption from that month's top expense account.
- **Headline figure:** spending against budget for the fiscal year to date, operating fund only. For each
  budgeted expense category: spent so far minus that category's share of the annual budget for the months
  elapsed (the current month counts in full). The sum is shown as over (red, plus) or under (green, minus).
  With no budget it shows a dash. This is the same arithmetic as the Budget page's fiscal-year view.

**Where it went**

- Spending by expense account over every month on record, all funds, from `monthly_expense_actuals` (built
  from the `expenses` table by paid date).
- **Headline figure:** average monthly spend, which is total spending divided by the number of months that
  have at least one expense.

---

## 5. Alerts (built, currently switched off)

`urgentItems()` in `urgent-items.ts` still runs on every visit and its result still shapes the status line, but
nothing draws the list. The old "Worth a minute" card was deleted and the banner that replaced it is behind
`SHOW_ANNOUNCEMENTS_STRIP = false`. Flipping that to `true` brings back a banner that rotates alerts and
announcements every 5 seconds, with arrows and pause on hover.

The rules, most important first:

| Alert | Fires when | Who |
|---|---|---|
| Emergency problem open | An open repair has an emergency kind | Board |
| Books don't match | Posted debits and credits differ | Staff |
| Report may be an emergency | AI triage flagged one and nobody dismissed it | Board |
| Urgent problem open | Open, priority urgent, not an emergency | Board |
| Units behind on dues | Any unit has a late balance | Staff |
| Insurance to-do (failed read) | A document read failed | Board |
| Walkup couldn't send your last email | The email service rejected the key in the last 7 days | Admin |
| Problem past its target date | Open repair past `due_on` | Board |
| Upkeep overdue | An active upkeep job is past its date | Board |
| Access ends soon | A timed role ends within 14 days, or ended in the last 14 | Admin |
| Officer term ending | A term ends within 30 days, or has ended and was not handed on | Admin |
| Contractor paperwork expired | An in-use contractor's certificate or license has expired | Board |
| Contractors owe a W-9 | Missing W-9s and the 1099 deadline is within 180 days | Staff |
| Insurance renews in N days | An unrenewed policy is inside its own reminder window | Staff |
| Insurance to-dos | A read waiting for review, owner certificate requests, a stale owner summary | Board |
| Category over budget | A category is more than 10% over its share of the budget so far | Staff |
| Emails failed or bounced | Any in the last 7 days | Admin |
| Bank hasn't synced | Last sync 3 or more days ago | Staff |
| Bank not connected | No connection at all | Staff |
| Background search finished | A contractor or insurance market search ended in the last 24 hours | Board |

---

## 6. What a person can change from the Dashboard

| Action | Who the database allows | Stored in |
|---|---|---|
| Set or clear the reserve target | Board admin | `associations.reserve_target` |
| Skip the setup guide, or bring it back | Board admin | `associations.setup_dismissed_at` |
| Tick or untick a setup step by hand | Board admin | `associations.setup_overrides` |
| Add a task to Your list | Board | `board_tasks` |
| Tick a task | Board | `board_tasks.completed_at`, `completed_by` |

Each action relies on row-level security as the gate. When the update matches no rows, the action reports
that only a board admin can do it.

---

## 7. Every query the page runs

One batch of 34 in parallel, then a second round. All run as the signed-in person, so row-level security
applies to each.

| Data | Table or view | Used for |
|---|---|---|
| Association | `associations` | Reserve target, setup details, state, fiscal year end |
| EIN | `association_tax_ids` | Setup, tax tile |
| Fiscal years | `fiscal_years` | Current year, tax filing year |
| Fund cash from the books | `fund_cash_balances` (view) | Standing, when no bank |
| Unit balances | `unit_balances` (view) | The building |
| Totals | `association_totals` (view) | Books pill |
| Owners | `unit_owners`, `persons` | Owner names, setup |
| Bank connections | `bank_connections` | Bank tile, alerts, setup |
| Bank balances | `bank_account_balances`, `bank_account_funds`, `funds` | Standing, charts |
| Bank transactions | `bank_transactions` | Uncategorized count, bank charts |
| Insurance | `insurance_policies`, `insurance_quote_requests`, `insurance_quotes`, `insurance_owner_summaries`, `insurance_document_reads` | Tiles, reminders, alerts |
| Contractors | `vendors`, `expenses`, `vendor_1099_calendar_totals` | Paperwork tile, W-9s, in use |
| Documents | `documents` with `document_categories` | Setup |
| People and access | `role_grants`, `invites`, `board_positions`, `access_reviews` | Setup, access alerts, review reminder |
| Budget | `budget_lines`, `budget_vs_actual` (view) | Setup, budget variance, over-budget alert |
| Dues | `assessment_schedules`, `charge_balances`, `delinquency_aging`, `monthly_dues_collection` | Setup, reminders, past due, dues line |
| Tax | `tax_filings`, `tax_form_templates`, `tax_forms`, `tax_parameters` | Deadlines, tax tile |
| Bills | `recurring_bills` | Reminders |
| Tasks | `board_tasks` | Your list |
| Cash by month | `monthly_cash_activity` (view) | Charts, when no bank |
| Spending by month | `monthly_expense_actuals` (view) | Where it went, budget variance |
| Announcements | `announcements`, `announcement_reads` | Announcements card, setup |
| Imports and email | `import_batches`, `email_settings`, `email_outbox` | Setup, email alerts |
| Repairs | `tickets` with `ticket_board_details`, `upkeep_tasks` | Alerts, reminders, in use |
| Background searches | `contractor_search_cache`, `insurance_market_research` | Finished-run alerts |
| Billing | `getBilling()` | Plan notices |

Money handling: figures from the older views arrive as numbers and go through `looseCents`. Figures from the
0017 and later views arrive as text and go through the strict `toCents` (DECISIONS #20). All arithmetic is in
whole cents.

---

## 8. Tests that cover this

- **Pure rules (unit):** `home-snapshot`, `urgent-items`, `urgent-items-sync`, `home-reminders`, `tax-reminders`,
  `insurance-reminder`, `access-review-reminder`, `setup-guide`, `home-finished-runs`, `bank-position`, `plan`,
  `standing-words`.
- **Database:** `tests/db/home-dashboard.test.ts` (task permissions, reserve target is admin only, the monthly
  views and that owners cannot read them), `cash-activity-transfers`.
- **Not covered:** `page.tsx` itself. Nothing tests the page as a board member or accountant, the 60/40 layout,
  or which cards appear for which role.

---

## 9. Review: what is wrong or at risk

Ordered by how much it matters.

1. **Alerts have nowhere to appear.** With the banner flag off and the old card deleted, an open emergency
   repair, failed emails, expiring access, an over-budget category and a finished background search are all
   computed and then dropped. The status line can still say "A few other things need a look below" with
   nothing below. Either turn the banner on or give alerts a card.
2. **A failed query can read as good news.** Only the fund balances and the totals show an error. If the
   delinquency query fails, the page says "Every unit is current". If the bank query fails, the page quietly
   falls back to book figures. Every other failure reads as empty.
3. **Nothing on the page is filtered by association.** Every query trusts row-level security to return one
   building, and the page takes `associations[0]` with no ordering (`getViewer` orders by creation date, so
   the two could pick differently). A person on the board of two buildings would get sums across both. One
   login for several buildings is deferred, but nothing stops the same email being added to a second
   building today.
4. **The accountant's insurance tile is wrong.** The owner-summary date is loaded only for the board, so an
   accountant sees "Owner summary not published yet" even when it is published.
5. **Bank-sourced "In & out" counts internal transfers.** The comment in `page.tsx` says transfers between the
   association's own accounts are excluded. That is true for the books path only. With a bank connected, a
   move from checking to the reserve account shows as money out and money in.
6. **Coming up silently stops at 6 rows.** There is no "show more" and no count of what is hidden. A building
   with several bills and tax nudges can lose a later deadline off the bottom.
7. **Average monthly spend is overstated when months are skipped.** It divides by months that have an expense,
   not by months elapsed. Spending in 3 of 12 months divides by 3.
8. **"Dues run $X a month" can be wrong.** It reads the latest month in the dues view, which can be a future
   month, a quarterly or annual charge, or a month with a special assessment.
9. **Row limits are unverified.** The bank chart asks for up to 50,000 transactions, but Supabase caps a
   response at its project "max rows" setting (1,000 by default). I could not check the project's setting.
   `monthly_expense_actuals` is read for all time and will pass 1,000 rows after a few years. If either is
   cut off, the charts are wrong with no warning.
10. **Time zone is hard-wired to Chicago.** Dates always use America/Chicago. The greeting uses UTC for any
    state other than IL. A building outside Central time gets wrong day boundaries.
11. **Funds that are neither operating nor reserve.** Their money is in the total but not in either figure
    under the ring, so day-to-day plus reserve may not add up to the total. The ring folds them into the
    day-to-day share.
12. **Units are matched to late balances by label, not id.** Two units with the same label would share one
    late figure.
13. **Unreachable code.** The "What the building's insurance covers" card needs a person who is neither board
    nor a reader of financials, and those people are redirected before the page renders.
    `nextFilingReminder()` is exported and never used. The dues view's `collected` and `collected_on_time`
    are loaded and never used.
14. **Small inconsistencies.** The access-ending alert and the access-review reminder link to `/building`,
    while the People & Access page now lives at `/access`. "Not set up" and "needs attention" tiles share one
    color.
15. **Page weight.** Roughly 50 to 60 queries per visit with no caching, plus a call to Plaid on an admin's visit. Fine
    at 7 buildings. Worth watching as the count grows.

---

## 10. What I think is missing

- **An "as of" time on the bank balance.** The code already knows when the oldest balance was reported
  (`BankCash.asOf`) and never shows it. Members and the accountant may be looking at a stale figure.
- **A dues collection figure.** The on-time and collected amounts are already loaded. "Collected this month:
  $X of $Y" would answer the treasurer's first question.
- **A next tax filing tile.** `nextFilingReminder()` exists for exactly this and is not used.
- **A way to delete or edit a task** in Your list.
- **A home for alerts**, per finding 1.
- **An "all clear" state.** The earlier design had one. Now, a building with nothing wrong just sees less.
- **A test of the page per role**, so a change cannot quietly show an accountant a board-only row.
- **A written decision on the accountant's Dashboard.** It currently falls out of permission checks card by
  card. A short paragraph in `docs/DECISIONS.md` on what an accountant should see would make it deliberate.
- **Loading and error states per card.** One slow or failed query currently affects the whole page.
- **The owner Home** (`/owner`) and the property manager and attorney front doors deserve the same kind of
  guide. They are separate pages with their own rules.
