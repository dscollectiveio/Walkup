# Access control plan: who can see and do what

Status: **proposal, waiting on Doug's answers in Part 6.** Nothing here is
built yet. It starts from how access works today (Part 1), so every change is a
step from the real system, not a rewrite.

---

## Part 1. How it works today

Four roles exist, in `role_grants` (enum `app_role`, 0001): **board admin,
board member, accountant, owner**. A person can hold several; the most
permissive wins (DECISIONS #6). Every check runs in the database (RLS and
SECURITY DEFINER functions), and every role needs two-step sign-in (#26).

| Area | Board admin | Board member | Accountant | Owner (not on board) |
|---|---|---|---|---|
| Dashboard | Full | Full | Read | Own unit home instead |
| Bank feed | Connect, post, categorize | Read | Read | None |
| Ledger, statements | Edit | Edit | Read, download | Shared PDFs only |
| Budget | Edit | Edit | Read with actuals | Budget lines, no actuals |
| Dues | Edit, approve emails | Edit, prepare emails | Read, delinquency | Own balance, report a payment |
| Taxes | Edit | Edit | Read | None |
| Insurance | Edit, delete | Edit | Read | Published summary |
| Building info, people | Edit, give roles | Edit, invite owners | "Restricted" (bug) | Address, board names, emergency info |
| Repairs | Edit, delete | Edit | Read, no internal notes | Report, own unit's tickets |
| Contractors | Edit | Edit | Read (no reviews) | None |
| Documents | All, purge | All | All "board only" ones | "All owners" and own unit's |
| Announcements | Post, read receipts | Post, read receipts | Read | Read what's addressed to them |
| Walkup billing | Manage | See status | None | None |

**How roles are given today:** a board admin ticks role boxes on Building
Info, or sends an invite link (7 days). A board member can invite owners only.
Owner access ends by itself when the person stops owning a unit. Accountant
access ticked on Building Info ends after 90 days. Every grant and revoke is in
the audit log.

**Gaps found (with file references in the research notes):**

1. **Accountants invited by link never expire.** `redeem_invite` sets no end
   date; only the checkbox path sets 90 days. This contradicts the spec and
   what we told Plaid. *Fix first.*
2. **Nothing stops the last board admin removing themself**, or one admin
   removing all others. A building can end up with no admin.
3. Extending an accountant means untick, save, tick again.
4. The accountant sees Building Info in the sidebar but gets "Restricted";
   "board only" documents include the accountant (legal notices, contracts).
5. **No way to add a lawyer, property manager or other helper** except as an
   accountant (too much) or a board member (far too much).
6. **No officer titles or terms.** "Treasurer" is free text in the board
   contact name. No record of when someone's board term ends.
7. Small UI and database mismatches: the invite form offers roles a board
   member can't give; "only an admin can revoke an invite" is shown but any
   board member can.
8. Owners see no live financial summary (the original spec said they would).
9. The audit log has no screen.
10. One login works for one association, so an accountant or manager with
    several buildings needs several logins (#11).

---

## Part 2. The proposed model

Keep the four roles. Add **positions** (titles, not powers) and **three
outside roles**, each with a clear, fixed set of areas. Everything outside the
board can have an end date, and outside roles must.

### 2.1 Board

| Role | Who | Can do |
|---|---|---|
| **Board admin** | Usually the president and treasurer | Everything, plus: give and remove roles, bank connection and posting, approve emails to owners, Walkup billing, delete and purge |
| **Board member** | Other elected directors | Everything in the building's records except the admin steps above |

**Positions** (new): President, Vice President, Treasurer, Secretary,
Director. Each has a start date and an optional term end. Positions are labels
for owners and records ("Maria Lopez, Treasurer") and drive reminders ("Cy's
term ends in 30 days"). They grant nothing by themselves, so an election never
changes access by accident.

**Rules:**
- At least one board admin, always (database rule). Walkup recommends two and
  shows a banner while there's only one.
- You can't remove your own admin role if you're the last admin.
- When a term ends, Walkup reminds the admins; it doesn't remove access by
  itself (boards often run late on elections).
- Leaving the board keeps the person's owner access if they own a unit.

### 2.2 Outside helpers (new, except the accountant)

| Role | For | Can see | Can change | Default end |
|---|---|---|---|---|
| **Property manager** | A paid manager or management company running day to day | Everything a board member sees | Dues, repairs, contractors, documents, announcements (drafts the board approves). **Not**: roles, bank connection, posting, email approval, billing, deleting | 1 year, renewable |
| **Accountant** (exists) | CPA or bookkeeper | Books, statements, budget, taxes, financial documents, delinquency | Nothing (read only) | 90 days, renewable in one click |
| **Attorney** | The association's lawyer, for collections or a dispute | Governing documents, minutes, legal notices, contracts, correspondence; unit statements and owner contact details for units the board shares with them | Nothing (read only) | 90 days, renewable |
| **Observer** | Incoming board member, auditor, reserve-study firm | What a board member sees | Nothing | 30 days |

Outside helpers:
- don't count toward Walkup's price;
- never see the bank connection screens or Walkup billing;
- always need two-step sign-in;
- are added only by a board admin.

### 2.3 Owners (not on the board)

Unchanged, plus two board-controlled options:
- **Association finances page** (off by default): a simple yearly income and
  spending summary and reserve balance, the numbers from the financial
  statements, no individual transactions.
- **Who's who**: the board roster shows positions and how to reach the board.

Owners never see other owners' details, balances or the bank feed.

### 2.4 Documents

Today: "board only" (which includes the accountant), "all owners", or one
unit. Proposed: **Board only** (board and property manager), **Board and
advisers** (adds accountant, attorney, observer), **All owners**, **One unit**.
Each document category keeps a sensible default; legal notices default to
"Board and advisers" so the attorney sees them.

---

## Part 3. How the board appoints people (the screens)

A new **People and access** page for the board (Building Info keeps units and
ownership; people move here):

1. **Board**: each member with role, position and term dates. "Change of
   board" button after an election: pick who's in, who's out, positions, and
   who's admin, in one step. It refuses to save without an admin.
2. **Outside helpers**: each with role, firm, what they can see, and when
   access ends. "Extend 90 days" and "End access now" buttons.
3. **Owners**: by unit, with sign-in status and "Invite to sign in".
4. **Invites waiting**: with expiry and "Cancel".
5. **Activity**: who gave or removed access, and when (from the audit log).
6. **Access review**: the existing quarterly review, moved here.

**Adding someone** (one form): name and email, then "What are they?"
(board member, property manager, accountant, attorney, observer, owner), then
the end date (required for outside helpers, prefilled), then **Send invite**.
The invite email goes out only after a board admin approves it, like every
other Walkup email. The person signs up with two-step sign-in and lands on a
dashboard limited to their areas.

**Preview**: "See what they see" opens a read-only preview of the sidebar and
pages for that role, so the board can check before inviting.

---

## Part 4. How it's built (engineering)

- **One area map in the database.** A function `can_access(association,
  area, level)` (`level` = read or write) backed by a fixed table of role to
  area to level. Every RLS policy and RPC uses it instead of listing roles. New
  roles become one table change plus tests, not 40 policy edits.
- **Roles:** add `property_manager`, `attorney`, `observer` to `app_role`.
  Expiry required (check constraint) for the three plus `accountant`.
- **Positions:** new `board_positions` (person, title, starts_on, ends_on).
  Shown by `board_roster()`.
- **Guards:** trigger on `role_grants` that refuses to leave an association
  with no active board admin. `redeem_invite` sets `expires_on` from the
  invite (fixes gap 1).
- **Attorney's units:** `attorney_unit_shares` (attorney grant, unit), set by
  the board.
- **App:** `getViewer()` gains `areas`; the sidebar, page guards and buttons
  read areas instead of role names. One test asserts the sidebar never shows a
  page the role would get "Restricted" on (fixes gap 4 for good).
- **Security:** a DECISIONS entry; a new attack test set (each new role tries
  every write RPC and every table); MFA and audit unchanged.

---

## Part 5. Order of work

| Phase | What | Size |
|---|---|---|
| **1. Fixes** | Invite-link accountants expire at 90 days; keep-one-admin rule; one-click extend; invite form offers only roles you can give; accountant sidebar fix; correct the revoke message | Small, no new screens |
| **2. Positions** | Titles and terms, roster shows them, term-ending reminders, change-of-board flow | Medium |
| **3. People and access page** | The page in Part 3, activity log, see what they see | Medium |
| **4. Area map and new roles** | `can_access`, property manager, attorney, observer, document tiers | Large (touches every policy; needs the full security test pass) |
| **5. Owners** | Association finances page (board switch) | Small |
| **Later** | One login across several associations, for managers and accountants (changes #11) | Large |

Phase 1 can ship on its own any time and closes the Plaid-promise gap.

---

## Part 6. Decisions for Doug

1. **Property manager power.** Recommended: like a board member minus the
   admin steps (no roles, bank connection, posting, email approval, billing).
   Alternative: full admin.
2. **Attorney scope.** Recommended: legal documents plus statements and
   contact details only for units the board shares. Alternative: all units'
   delinquency.
3. **Outside access always ends?** Recommended: yes. Defaults: accountant and
   attorney 90 days, property manager 1 year, observer 30 days. All renewable.
4. **Do positions grant powers?** Recommended: no, titles only.
5. **Who can add outside helpers?** Recommended: board admins only.
6. **Owners' finances page?** Recommended: build it, off by default, the
   board switches it on.
7. **Does a term ending remove access?** Recommended: no, remind only.
8. **Multi-building logins.** Recommended: later, after a property manager
   actually asks.
