# Access audit: what each group sees and how access is managed (2026-10-20)

Source: the code and migrations 0001 to 0073 as of commit 9189cde. This is what the app does **today**, for Doug to confirm before planning changes. Items marked **CONFIRM** need a product decision.

Roles: **BA** board admin, **BM** board member, **ACC** accountant, **OWN** owner. Y = yes, RO = read only, N = no.
Highest role wins when someone holds several. MFA (aal2) is required for every role, enforced in the database.

## Part 1. What each group can see and do, by tab

### Sidebar

| Item | BA | BM | ACC | OWN |
|---|---|---|---|---|
| Dashboard | Y | Y | Y | N (own Home page) |
| Announcements | Y | Y | Y | Y |
| Bank Feed & Transactions | Y | Y | Y | N |
| Financial Statements | Y | Y | Y | N |
| Budget & Spending | Y | Y | Y | Y (plan only) |
| HOA Dues | Y | Y | Y | N (My unit: Statement, How to pay) |
| Taxes | Y | Y | Y | N |
| Insurance | Y | Y | Y | Y ("Building insurance", summary only) |
| Building & Owners | Y | Y | N (hidden; URL shows Restricted) | N ("Your building") |
| Repairs & Upkeep | Y | Y | Y | Y ("Repairs") |
| Find a Contractor | Y | Y | N | N |
| Documents | Y | Y | Y | Y (only what is shared) |
| Your account | Y | Y | Y | Y |

### Dashboard
| | BA | BM | ACC | OWN |
|---|---|---|---|---|
| Open | Y | Y | Y | N |
| Financial cards and charts | Y | Y | RO | N |
| Post an announcement | Y | Y | N | N |
| Setup guide, reserve target | Y | N | N | N |
| Billing notice (pay button) | Y | RO | N | N |
| Board task list | add/edit/delete | add/edit | UI shows add form, fails | N |

### Announcements
| | BA | BM | ACC | OWN |
|---|---|---|---|---|
| Read published | Y | Y | Y | Y (their audience) |
| Compose, edit, publish, pin, archive, delete draft | Y | Y | N | N |
| Reader counts, unit audience | Y | Y | N | N |
| Prepare email | Y | Y | N | N |
| Approve email | Y | N | N | N |

### Bank Feed
| | BA | BM | ACC | OWN |
|---|---|---|---|---|
| See connections, balances, transactions | Y | RO | RO | N |
| Connect, reconnect, disconnect bank | Y | N | N | N |
| Categorize, post, exclude, bulk, rules, fund mapping | Y | N | N | N |
| Sync now | Y | button shown, fails | button shown, fails | N |

### Financial Statements
BA, BM, ACC: view, export Excel/PDF, year-end pack, drill down (read only). OWN: no access (sees a note; only statements the board files as Documents).

### Budget & Spending
| | BA | BM | ACC | OWN |
|---|---|---|---|---|
| Budget plan | Y | Y | Y | Y |
| Actuals, spending, transactions, export | Y | Y | Y | N |
| Edit lines, apply suggested budget | Y | Y | N | N |
| Add expense category | Y | form shown, fails | N | N |

### HOA Dues (treasurer view)
| | BA | BM | ACC | OWN |
|---|---|---|---|---|
| Per-unit standing, collections | Y | Y | RO | N (own Pay page) |
| Prepare reminders, late-fee notices | Y | Y | N | N |
| Record payment, one-off charge, charge what's due | Y | Y | N | N |
| Make an assessment required | Y | N | N | N |
| Dues schedule: create | Y | Y | N | N |
| Payment instructions, late-fee rule | Y | N | N | N |
| Property manager and main contact | Y | Y | N | N |
| Owner statements (bulk): view / prepare and send | Y / Y | Y / Y | Y / N | N |
| Email from Walkup: view settings | Y | Y | N | N |
| Approve a batch, sending switch, daily cap | Y | N | N | N |

Owners see only their own unit: statement, how to pay, and a form to report an outside payment.

### Taxes
BA, BM, ACC view and export. Edit, confirm, mark filed, reclassify, set accountant, filing settings: BA and BM. ACC read only. OWN none. Accountant emails are mailto drafts only.

### Insurance
| | BA | BM | ACC | OWN |
|---|---|---|---|---|
| Overview, Policies, Coverage check, Quotes and emails (read) | Y | Y | Y | N |
| Marketplace | full | full | contacts only | N |
| Add, edit, renew policy; quotes; claims; write to agents; research | Y | Y | N | N |
| Publish owner summary; handle proof requests | Y | Y | N | N |
| Delete policy, quote, claim | Y | N | N | N |
| Owner view: published summary, request a certificate | n/a | n/a | n/a | Y |

### Building & Owners
| | BA | BM | ACC | OWN |
|---|---|---|---|---|
| Open | Y | Y | N | N (their own Your building page: address, board names, emergency info) |
| Edit association profile | Y | N | N | N |
| Facts used by insurance | Y | Y | N | N |
| Units and people: add, edit, change owner, end ownership | Y | Y | N | N |
| Delete unit, ownership row, former member | Y | N | N | N |
| Change someone's roles | Y | N | N | N |
| Invite an owner | Y | Y | N | N |
| Invite board member or accountant | Y | N | N | N |
| Extend accountant 90 days | Y | N | N | N |
| Import spreadsheets | Y | history only | N | N |
| Access review (90 day) | Y | N | N | N |

### Repairs & Upkeep
Sub-tabs: Problems and Upkeep for everyone; Contractors and Bills for BA, BM, ACC.

| | BA | BM | ACC | OWN |
|---|---|---|---|---|
| Problems: all tickets, costs | Y | Y | RO | N (own reports, own unit, shared areas) |
| Report a problem | Y | Y | N | Y (own units or shared areas) |
| Edit, assign, request quotes, close out, change status | Y | Y | N | N |
| Cost, quotes, contractor contact, messages, internal notes | Y | Y | RO | N (contractor name and visit date only) |
| Confirm fixed, reopen, visit feedback, "me too" | n/a | n/a | N | Y (their own reports, shared areas) |
| Delete note | Y | N | N | N |
| Upkeep: view | Y | Y | RO | Y (no money, no contractor) |
| Upkeep: add, edit, mark done | Y | Y | N | N |
| Upkeep: delete task | Y | N | N | N |
| Contractors tab and profiles | Y | Y | RO | N |
| Add contractor, drafts | Y | Y | N | N |
| Import contractors | Y | N | N | N |
| Find a Contractor | Y | Y | N | N |
| Bills tab (view) | Y | Y | RO | N |
| Add, edit, pause, mark paid | Y | Y | N | N |
| Delete bill | Y | N | N | N |
| Emergency info: view | Y | Y | Y | Y (only what the board marks visible) |

### Documents
| | BA | BM | ACC | OWN |
|---|---|---|---|---|
| See | everything, including binned | same | everything | only "all owners" documents and ones pinned to their unit |
| Upload, rename, refile, re-read, change visibility, bin, restore | Y | Y | N | N |
| Destroy permanently | Y | N | N | N |

Defaults: financial statements, governing documents and minutes are visible to owners; everything else is board only.

### Your account (all roles)
Profile (own phone and address), Units, Security (MFA, sign out others, password), Notifications, Privacy and export. Billing tab: BA manages, BM reads, ACC and OWN do not see it.

## Part 2. How access is given, granted and managed

### Data model
- Roles: `board_admin`, `board_member`, `accountant`, `owner`. Stored as `role_grants` (revoked_at, expires_on). A person can hold several; the most permissive wins.
- A person (`persons`) may have no login (an owner who has not signed in).
- Unit scope for owners comes only from `unit_owners` (dates), not from the owner role.
- Property manager is a per-unit contact record (no login, no access). Walkup emails go to them if the board makes them the main contact.
- Tax accountant contact (for emails) is separate from the accountant role (access).
- Not built: positions/titles and terms, attorney, observer, outside helpers, one login across several buildings.

### The first admin
Anyone can sign up, enrol MFA and create a building. They become its board admin. There is no vetting.

### How people get access
1. **Owner invite** for an existing person (the "claim your record" link). Board admin or board member. Walkup does not email it; the board copies the link or opens an email draft.
2. **Generic invite link** for any role. Board admin: any role. Board member: owner only. Valid 7 days, one use.
3. **After a spreadsheet import**, an invite button per person with an email.
4. **Role checkboxes** on a person: board admin only. Accountant grants last 90 days, all others never expire.
5. Self signup creates a new building, not access to an existing one.

### Accepting an invite
Open the link, sign up, enrol MFA, confirm name, the invite is redeemed. One building per login. A person-bound invite checks the login email against the email the board recorded.

### Changing and removing access
- Change roles: board admin. Extend accountant 90 days: board admin.
- Unit sale: any board member changes or ends ownership. A daily job revokes the owner role once nothing is owned.
- Expiry is immediate for access; a daily job stamps the revoke.
- Cannot remove the last board admin (database trigger).
- Remove personal data and delete a former member: board admin, with safeguards.
- Access review (90 day snapshot): board admin.
- Every change is written to an audit log (board admin can read it; there is no screen for it).

### Enforcement layers
Row level security (the real check), MFA in the database, the sign-in proxy, page and action checks (convenience only), document and storage policies, a few narrow service-role paths. No email or notice goes to anyone when access is granted, changed, expires or is removed.

## Part 3. Things to confirm (decisions needed)

**Surprises in what groups see**
1. Bank Feed: board members are read only, but the Connect and Sync buttons show to them and fail.
2. Budget: board members see Add category, but only admins can create one.
3. Dashboard: the accountant sees the add-task form, which fails.
4. Import: board members can open it; the message says admins only.
5. Setup guide and reserve target show to admins only. Intended?
6. Upkeep costs, estimates and contractor are hidden from owners in the page but readable by owners through the database. Ticket costs are properly separated.
7. Owners can read the whole association row (including EIN) through the database.
8. Accountant can read every owner's contact details and every document, including board-only legal notices and contracts.
9. A document marked board only but pinned to a unit is visible to that unit's owner. Any board member can mark any document visible to all owners (no allow-list on that path).
10. Staff who also own a unit: no "My unit" in the sidebar (reached through Account, Units); Dues shows the treasurer view.
11. A person with no active grant (expired accountant) gets the staff sidebar and then Restricted pages.

**Access management risks**
12. A board member can change a person's email and send an owner invite for a not-yet-claimed board admin, so the redeemer inherits that admin role. Restrict person-bound invites to admins or to people who hold only the owner role?
13. Generic invites are not tied to an email. Whoever holds a board admin or accountant link gets the role. Enforce the email for non-owner roles?
14. Open signup makes anyone a board admin of a new building. Intended?
15. Board members can revoke any invite although the page presents it as admin only.
16. Accountant grants: "Extend" stops working once the daily job stamps the expiry, and nobody is warned before it ends.
17. Former owners keep owner access until the daily job runs.
18. Board member and admin grants never expire. Only accountants have an end date.
19. No recovery codes or admin MFA reset. No session timeout or re-authentication before granting roles.
20. No screen or notification for access changes.
21. A deleted login can leave a building with no admin who can sign in.
22. One building per login limits managers and accountants with several buildings.

## Part 4. Previously planned phases (DECISIONS #43)
1. Fixes: built (migration 0065 and 0060), except item 15.
2. Positions and terms: not built.
3. People and access page (one place to manage everyone, activity feed, preview "see what they see"): not built.
4. Area map and new roles (property manager login, attorney, observer, document tiers): not built.
5. Owner finances page, off by default: not built.

## Part 5. Decisions so far (Doug, 2026-10-20) and the plan

### Decided
1. Person-bound owner invites: admin only, or refused when the person holds any non-owner role.
2. Board admin, board member and accountant invites require the invitee's email; the login must use that exact email. Link life drops to 3 days for those roles.
3. The accountant sees only financials, estimates and anything related to accounting and taxes. No owner contact details, no board-only documents outside accounting and tax (legal notices, contracts, correspondence are out).
4. Owners can no longer read upkeep costs, estimates, contractors or the association's EIN through the database.
5. Documents can only be made visible to owners if they are governing documents, minutes or financial statements.
6. "Extend" revives an accountant whose access just ended; the board is warned 14 days before it ends.
7. Bank Feed connect, sync, categorize and post, and Add category stay admin only; the buttons are hidden from board members. The accountant no longer sees the add-task form.
8. Officer positions (President, Treasurer, Secretary): titles plus a few duties. Board admin stays a separate switch the board chooses. Each position has a term end, with a reminder 30 days before and a guided "Change of board" flow.

### Positions design
- New table `board_positions`: person, position (president, treasurer, secretary, plus vice president and director as titles only), term start, term end. One current holder per officer position.
- Permissions stay role based (admin or member). Duties added by position, checked in the database:
  - Treasurer: bank feed categorize and post, budget categories, tax confirmation and filing.
  - Secretary: documents (visibility, filing), announcement approval.
  - President: title only.
  - Admin still does everything; a Treasurer who is not an admin cannot connect the bank, change roles or approve email.
- The roster and Building & Owners show titles; owners see officer titles on Your building.
- Change of board: pick the office, pick the new person, the old holder's title ends, optionally their board role ends, one audit entry, and a reminder email draft to the new officer.

### Build order
1. Security fixes: items 1, 3, 4, 5 above and the document and association exposure (one migration plus RLS tests).
2. Invites: email required for staff roles, 3-day link, accountant extend and warning, hide the failed buttons.
3. Positions: table, roster UI, term reminders on the dashboard.
4. Duties by position and the Change of board flow.
5. People and access page (one place for board, helpers, owners, invites, an activity feed, the access review).
6. New outside roles (property manager login, attorney, observer) and the owner finances page: decide later.

### Round 2 decisions (Doug, 2026-10-20)
- Import link hidden from board members (admin only).
- Setup guide visible to board members, read only.
- "My unit" added to the sidebar for staff who own a unit.
- A login with no active role sees a single "Your access has ended, ask the board" page.
- Unit-specific documents: owners, board members and everyone with a unit connection can add documents for their unit (details to confirm below). Unit-pinned documents stay visible to that unit's owner.
- Open signup stays for now (revisit before launch).
- Invite revoking is admin only.
- Former owners lose access the day their ownership ends.
- Board terms do not expire access; accountant access stays 90 days, renewable.
- Last-admin safeguard when a login is deleted.
- Recovery codes at MFA enrolment.
- Idle timeout (12 hours) and a fresh check before granting roles.
- Access activity feed for admins; email only to the person whose access changed.
- One login across several buildings: later.
- Outside roles (property manager login, attorney, observer): build now.
- Vice President is a title only; default term 2 years, editable; one person may hold two offices.
