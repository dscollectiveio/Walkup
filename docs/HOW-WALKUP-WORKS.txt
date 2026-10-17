# How Walkup works, and what is not working

A plain-text map of the whole app, written on 2026-10-16 from a read of the code,
the migrations and the repo's own docs. It is a snapshot: it covers everything
up to commit c1d28be plus the uncommitted access-control work (migration 0065).

How to read the "not working" lists: each item was found in the code, a comment
or a repo doc. "Unverified" means it depends on something the code cannot show
(a dashboard setting, what is applied in production, how a screen looks in
real use). Nothing in this file was tested by running the app.

Contents
  Part 1. The big picture and who can do what
  Part 2. Getting in: sign up, two-step sign-in, invites, onboarding
  Part 3. The Dashboard
  Part 4. Money: bank feed, ledger, statements, budget, dues, email, bills, imports
  Part 5. Taxes
  Part 6. Insurance
  Part 7. Repairs and upkeep, contractors
  Part 8. Documents and announcements
  Part 9. Building Info, people and access
  Part 10. The owner portal
  Part 11. Your account and Walkup's own billing
  Part 12. Platform admin, background jobs, security, deployment
  Part 13. The public website
  Part 14. WHAT IS NOT WORKING (the list you asked for)

==============================================================================
PART 1. THE BIG PICTURE AND WHO CAN DO WHAT
==============================================================================

What Walkup is: bookkeeping, dues, tax prep support, insurance, repairs,
document storage and owner communication for self-managed condo associations
(built around Illinois, 2 to 20 units). It prepares and organizes. It does not
hold money, file taxes, send payments or give tax, legal or insurance advice.

Standing rules built into the product:
  - Walkup never moves money. Dues are paid to the association's own bank.
  - Walkup sends email only after a board admin approves it. Everything else is
    a draft that opens in the person's own mail app ("mailto").
  - Bank access is read-only, through Plaid.
  - Every number shows where it came from. Mistakes are fixed by a visible
    reversing entry, never by deleting.
  - Two-step sign-in is required for everyone and cannot be turned off.
  - Each association is walled off from every other, enforced in the database.

Four roles (one person can hold several; the most permissive wins):
  BOARD ADMIN   Everything a board member can do, plus: give and remove roles,
                connect/disconnect the bank, categorize and post bank
                transactions, run imports, approve email, manage Walkup's plan,
                delete and permanently remove things.
  BOARD MEMBER  Sees and works on books, dues, taxes, insurance, repairs and
                documents. Can invite owners. Cannot do the admin steps.
  ACCOUNTANT    Read-only on books, statements, budget, taxes, board documents.
                Access ends after 90 days unless a board admin extends it.
  OWNER         Own unit's dues and statement, announcements, shared
                documents, reporting repairs, building contacts.
  (Platform admin is a fifth, separate thing: Doug only, for global settings.)

What each role sees
  Area                  Board admin   Board member   Accountant     Owner
  Dashboard             Full          Full           Read           Own unit home
  Bank feed             Connect/post  Read           Read           None
  Ledger, statements    Edit          Edit           Read/download  Shared PDFs
  Budget                Edit          Edit           Read + actuals Lines, no actuals
  Dues                  Edit/approve  Edit/prepare   Read           Own balance
  Taxes                 Edit          Edit           Read           None
  Insurance             Edit/delete   Edit           Read           Published summary
  Building Info         Edit + roles  Edit, invite   Hidden         Owner building page
                                      owners only
  Repairs               Edit/delete   Edit           Read           Report, own tickets
  Contractors/Find      Edit          Edit           Read           None
  Documents             All           All            Board-only too All-owners + own unit
  Announcements         Post          Post           Read           Read
  Walkup billing        Manage        See status     None           None

Every access check runs in the database (row level security), not just in the
screens. A password-only session (before the two-step code) reads nothing.

==============================================================================
PART 2. GETTING IN
==============================================================================

SIGN UP (/signup)
  1. Email, password twice, tick agreement to Terms and Privacy.
  2. Password must be 12+ characters and not contain the email's name.
  3. The screen answers the same whether or not the email already has an
     account (so it cannot be used to find out who is registered).
  4. If email confirmation is on in Supabase, the person gets a link. Either
     way the account has a login but no building yet.

TWO-STEP SIGN-IN (authenticator app)
  Enrollment (/account/mfa): scan a QR code, type the 6-digit code.
  Every sign-in after: email and password, then the 6-digit code.
  The website redirects are a convenience; the database enforces it.

EMAIL LINKS (/auth/confirm) handle confirm, reset and invite links. Opening a
link in a different browser than the one that started it shows a notice
instead of signing in.

PASSWORD RESET: /forgot-password always answers "sent". The link leads to
/reset-password (after the two-step code if the account has one).

INVITES (Building Info, "Sign-in invites")
  - Board admin can invite any role. A board member can invite owners only.
  - An invite is a link, valid 7 days, usable once. Walkup does NOT email it;
    the board copies the link or uses a prepared email draft.
  - A new person: types their name and gets the invited role. Accountants get
    90 days (new in 0065).
  - A person already on the board's list: can only be an owner; the login's
    email must match the email on file.
  - One login belongs to exactly one building.

ONBOARDING (/onboarding): legal name, display name, state, your name, address,
ZIP. Creates the association, you as board admin, funds (operating, reserve),
the chart of accounts, a calendar fiscal year, and a 14-day trial record.
Units and owners are added afterwards (Building Info, or import).

SESSIONS: refreshed on every request. "Sign out of other devices" and "Sign
out here" are on Your account.

==============================================================================
PART 3. THE DASHBOARD  (board and accountant; owners go to /owner)
==============================================================================

  - Announcements banner: gold, up to 3 posted notices, pinned first. Hidden
    when there are none.
  - Greeting and one status line ("$X past due across N units" or "Every unit
    is current"); a chip says whether the books balance.
  - Billing notice: board only, only when billing is on and something needs
    attention (payment problem, plan ended, trial in last 7 days).
  - Worth a minute today: ranked to-dos built from real conditions (emergency
    repairs, books out of balance, late dues, expired contractor paperwork,
    insurance to-dos, over-budget categories, stale bank sync, failed emails).
  - Where the association stands: the bank's balances (checking, savings, CDs,
    money market only) split into operating, reserve and other; reserve
    progress bar to a target the admin sets; a banner if books and bank differ;
    four tiles (Bank, Insurance, Next filing, Contractor paperwork).
  - Coming up: next 120 days, top 6 (bills, insurance renewals, upkeep,
    visits, certificate expiries, assessments, tax deadlines, W-9 time, the
    90-day access review).
  - The building: a cross-section drawing (2 to 6 units) with each unit's
    standing; dues run-rate line.
  - Setup checklist (board admin) of 26 steps that tick themselves from real
    data; "Your list" afterwards, plus manual tasks you can assign.
  - Rotating chart card (12 seconds, pausable): In the bank (12-month cash),
    In and out (6 months vs budget), Where it went (spending by category).
  Cash figures use the bank's balances when a bank is connected, otherwise the
  books.

==============================================================================
PART 4. MONEY
==============================================================================

4.1 BANK FEED AND PLAID  (/bank-feed)
  Connect (admin): Plaid Link (up to 730 days of history); token encrypted and
  saved where no user role can read it. First bank defaults to ledger account
  1000 Operating Cash; a second bank must be assigned by the board.
  Sync: "Sync now"; automatic when an admin opens the page and the last sync
  is over 12 hours old; and a daily cron (18:00 UTC). It never posts to the
  ledger on its own. Plaid retractions are marked, never deleted.
  Plaid webhook: only flags a connection as "needs reconnect".
  Categorize: five kinds (expense, income, dues, transfer, not for the books).
  Suggestions come from the board's history with that payee, then keywords.
  Bulk actions, keyboard shortcuts, "always file X as Y" rules. A deposit that
  matches a payment recorded by hand is suggested as "not for the books".
  Post (admin): writes the ledger entry (expense, dues applied to oldest
  charge, other income, or a transfer between own accounts). Undo ("unpost")
  writes a reversing entry and clears the link.
  Balances: stored per account; admins can choose which fund each bank account
  counts as. Disconnect: asks Plaid to remove the connection, then deletes the
  local token; history stays. A broken connection shows Reconnect.

4.2 LEDGER  (/ledger, labelled "All transactions")
  Double-entry. One door in (post_journal_entry), balanced by a database
  trigger, posted entries cannot be edited or deleted, closed years refuse
  writes. Money stored to the cent. Seeded chart: cash 1000/1010, receivables
  1200/1250, payables 2000, prepaid 2100, income 4000-4090 and non-exempt
  lines, expenses 5000-5080, 5900 income tax. Page shows a trial balance by
  fund and whether debits equal credits.

4.3 FINANCIAL STATEMENTS  (/financial-statements)
  Profit and loss for a month, quarter or year, several periods side by side,
  click any line to see the entries behind it, a prorated budget column, a
  banner counting bank transactions not yet posted. Exports: Excel (P&L), PDF,
  and a year-end accountant package (adds trial balance and general ledger up
  to 10,000 lines). "Draft email" opens your mail app (no attachment).
  Unpaid dues count as income when charged (accrual), so this differs from the
  cash-method tax test.

4.4 BUDGET AND SPENDING  (/budget)
  Pick year/quarter/month. Each category shows spent vs its share of the annual
  budget: on track, watch (up to 10% over), over. Board sets annual amounts;
  "suggested budget" uses last year after confirmation; add a category
  (admin); categorize leftover transactions from here; a year-end forecast
  after 3 months; reserve plan; comparison with last year. Operating fund only.

4.5 HOA DUES  (/dues, /delinquency "Collections", /dues/statements)
  Setup: yearly dues and cadence per unit; admin enters payment instructions
  (payee, bank, account, routing, Zelle, notes) shown to owners; optional
  late-fee rule (flat amount and grace days, blank by default).
  Charging is manual: "Charge what's due" posts, per unit, debit 1200 and
  credit 4000, for the current period only. One-off charges are allowed.
  Late fees are proposed for each overdue assessment past grace; the board
  confirms each; no duplicates for the same unit and period.
  Receiving payments: owners file "I paid" reports (moves no money, 10 pending
  per unit); the treasurer confirms a bank deposit as dues for a unit (applies
  to oldest charge); reports can be dismissed with a reason; "Record a payment"
  on Collections handles check/cash.
  Collections page: aging (30/60/60+), suggested next step per unit.
  Statements: per-unit PDF or email for chosen periods; late-fee letter PDF.

4.6 EMAIL FROM WALKUP  (/dues/email)
  Kinds: dues reminders, owner statements, late-fee notices, announcements.
  Drafts are built from templates plus ledger facts; no AI writes email.
  A board member prepares a batch; a board admin presses Send; sending runs in
  the background through Resend (about one per 0.6 seconds, one recipient per
  call, 3 attempts). Standing rules (dues reminders only) can be switched on by
  an admin; a daily cron (15:00 UTC) runs them.
  Limits enforced in SQL: one per person per week per kind; 20 a day in the
  first week then the board's limit (default 60, max 200); 300 an hour for the
  whole platform; never to bounced/complained/opted-out; skip if the balance no
  longer matches. Every email carries one-click unsubscribe, a reply-to for the
  board, and DS Collective LLC's address. No account numbers ever.
  If sending is not configured, drafts open in the person's mail app and are
  marked sent by hand.

4.7 BILLS  (Repairs and Upkeep, Bills view)
  Recurring bills with a due date and typical amount. "Mark paid" records that
  it was paid and moves the date. It never pays anything and writes no ledger
  entry; the real expense enters the books when the bank row is posted.

4.8 IMPORTS  (/building/import, admin to run)
  Five kinds: units and owners, past transactions, opening balances, what each
  unit owed, contractors. Upload CSV/XLSX (5 MB, 5,000 rows) -> match columns
  (optional AI suggestion that sees only column names and masks) -> map
  categories to accounts by hand -> fix or skip rows -> preview -> commit in
  one transaction -> undo by reversal while years are open. Same file cannot be
  committed twice; sensitive columns (SSN, account numbers) are never staged.

==============================================================================
PART 5. TAXES  (/tax)
==============================================================================

Works out which forms the building needs and when, tests for the simpler Form
1120-H, estimates tax, lists contractors needing a 1099, prefills official PDFs
when a verified template is active, drafts emails to the accountant, and makes
calendar reminders. Walkup never files anything.
  - 1120-H tests use cash actually received and spent. Rates and thresholds
    come from a table; if missing the page says "Ask your CPA". Within 5 points
    of a threshold it warns. Eligible means filing 1120-H is an election.
  - Each income account is suggested as member income (exempt) or taxable and a
    board member confirms each once; until then it says ask your CPA.
  - 1099-NEC by calendar year: payments at the threshold, W-9 status, "Ask for
    a W-9" draft, exempt flag. Recipient copies only; contractor taxpayer IDs
    are never stored. Form 1096 depends on the answer to paper vs electronic.
  - Deadlines each say their source: a verified rule, an "Estimated - not yet
    checked" built-in, or "ask your CPA". Nudges at 60 and 45 days.
  - Accountant: named once; three mailto drafts (1120-H figures, 1099 list,
    early heads-up), under 1,800 characters, no attachments, IDs stripped.
  - Annual 1120-H flow: fill Building Info -> confirm income classes -> add
    accountant -> save year's figures -> Start the form (prefilled if a
    template is active) -> confirm lines -> export Excel/editable PDF ->
    export signable packet -> mark filed (locks figures, files proof).
  - Platform admin installs and verifies templates, links, rates and
    thresholds. Nothing is active until a person verifies it.

==============================================================================
PART 6. INSURANCE  (/insurance)
==============================================================================

Tabs: Overview, Policies, Coverage check, Marketplace, Quotes and emails.
  - Policy import with AI reading: upload under Insurance, pick "our policy" or
    "a quote"; text layer, PDF, photo or Word read in two passes; taxpayer-ID
    shaped numbers stripped; board reviews every figure with its source page
    before saving. Quote figures never prefill. Up to 8 policies per file, 20
    reads a building a day. Without the Anthropic key: enter by hand.
  - Plain-English summary written by AI, kept only if every figure and date
    appears in the recorded fields.
  - Coverage check: about 37 rules (Illinois Condominium Property Act, your own
    declaration, your own data, common practice), each with its basis; needs
    "building facts"; findings can be dismissed with a reason. Statute checks
    run for Illinois only.
  - Marketplace: agency and insurer search through Anthropic web search; only
    city, state, ZIP, units, stories, year built, construction and coverage
    types leave Walkup; every result needs a returned URL; cached 30 days; 6
    searches a building a day. Optional "Listed with Walkup" partners (empty).
  - Quotes and emails: ask up to 10 contacts for quotes (AI words the draft
    using placeholders, code fills real values, template fallback); board
    opens it in their mail app and marks sent; follow-up after 7 days; record
    quotes; Compare lines up current policy and quotes and never ranks; "Record
    our choice" only opens a prefilled new-policy form.
  - Claims linked to repair tickets; contacts; building facts and printable
    fact sheet; owner summary (board edits and publishes a frozen snapshot).
  - Owners see only the published summary and can ask for proof of insurance.

==============================================================================
PART 7. REPAIRS AND UPKEEP, CONTRACTORS
==============================================================================

Hub (/repairs): Today (board), Problems, Upkeep, Contractors, Bills.
REPORTING: title, place (shared area or a unit), details, urgency, access
notes, up to 6 photos. Emergency words (gas, CO, fire, flood, sewage, stuck
elevator, sparking, no heat Oct-Apr) show fixed safety steps with the board's
shut-off locations. Only "happening right now = yes" makes it an emergency.
Look-alike open problems are shown; owners can tap "I'm seeing this too".
Walkup does not alert anyone; the board sees it next time they open Walkup.
Optional AI triage only suggests (kind of work, urgency, questions).
LIFECYCLE: Open -> quotes asked -> a quote accepted (contractor set; nobody
contacted) -> "tell them to go ahead" draft -> visit date -> Mark fixed
(close-out: what was done, final cost, optional link to a payment) ->
reporter confirms or reopens within 30 days -> Closed. Board can edit, mark
duplicate, mark "owner's to fix", bulk-close old fixed items.
VIEWS: list with filters; pipeline board (New, Getting quotes, Contractor
chosen, Visit planned, Being worked on, Fixed); Today with seven sections.
QUOTES: ask up to 5 contractors by email draft or phone script; record by hand,
PDF or pasted text ("Read it for me", PDFs with a text layer only, 25 a day);
Compare marks lowest price but never "best"; accept or decline with reason.
NOTES: internal board-only notes, photo timeline, owners see roles not names.
UPKEEP: repeating jobs (1 to 60 months) with due dates on month-ends, "Mark
done", 18-item starter checklist (written for a small Chicago walk-up), turn
into a problem, .ics calendar download.
FIND A CONTRACTOR (/repairs/find, board only): your own contractors ranked
first (history, your reviews, ratings, distance, emergency calls, insurance);
then Google Places results (about 10 miles, 24-hour cache, 60 calls a building
a day) and web-search results (AI, 12 a day, 7-day cache, URL-verified). Save
a result as a contractor; "Ask bar" saves and opens Get quotes.
CONTRACTOR RECORDS: contact, emergency flag, insurance and license expiry, W-9,
1099-exempt, rates, Google and web ratings, board-only reviews, notes, job
history, drafted emails, W-9/certificate requests, "Read it" for certificates.

==============================================================================
PART 8. DOCUMENTS AND ANNOUNCEMENTS
==============================================================================

DOCUMENTS (/documents)
  Upload (board): PDF, images, Word, Excel, text, CSV, 25 MB; duplicates reused
  by checksum; linkable to units, people, contractors, entries, policies,
  claims, repairs, tax forms, etc. 16 seeded categories with default
  visibility (only Governing, Minutes, Financial statement default to owners).
  AI filing: text-layer PDFs and text only (no OCR); board's own rules win;
  confidence 0.85+ files itself, lower goes to "Needs review". Search by title
  or contents. Bin (any board member) / Restore / Destroy (admin; refused if a
  posted entry cites it).
ANNOUNCEMENTS (/announcements)
  Board writes plain text (title 120, body 5,000), audience everyone or chosen
  units, pin (max 3), end date, attachment readable by that audience. Draft,
  post, edit, archive. Owners see unread dots and a sidebar badge. Board sees
  read counts (never names). "Email this to owners" needs admin approval and
  includes the text only if it has no links or addresses. No replies.

==============================================================================
PART 9. BUILDING INFO, PEOPLE AND ACCESS  (/building, board only)
==============================================================================

  - Association profile (admin edits): names, address (with a Google map
    image), county, year built, construction, stories, roof year, EIN,
    incorporation date, fiscal year end, capitalization threshold, accountant,
    Illinois SOS number, 1099 filing method, owner contact.
  - Units: add (label, type, floor, sq ft, bedrooms), delete only with no
    history (admin). Ownership over time; percentage amendments must total
    exactly 100 and feed the 1120-H.
  - People and roles: board members edit contact details; only admins see the
    role checkboxes. Accountant grants end in 90 days, with an "Extend 90
    days" button (new). A building can never lose its last board admin who can
    sign in (new, 0065).
  - Access review (admin): every 90 days; revokes expired and sold-unit access,
    saves an append-only snapshot.
  - Remove personal data (admin): for people with no access and no unit; name
    becomes "Former member"; audit log scrubbed of those fields.

==============================================================================
PART 10. THE OWNER PORTAL  (/owner)
==============================================================================

  Home: money answer per unit (behind, due soon, all paid up, ahead, not
  charged), latest announcements, repair summary, shared documents, board
  contact, emergency info.
  Statement: running balance, periods, PDF download.
  How to pay: the board's payment details and "Tell the board you paid".
  Announcements, Repairs (own and shared-area problems), Budget (no actuals),
  Building insurance (published summary), Your building (address, board
  roster, emergency facts).
  Your account holds profile, units, email choices.
  Owners are read-only apart from reports, notes, photos, payment reports and
  their own phone/address.

==============================================================================
PART 11. YOUR ACCOUNT AND WALKUP'S OWN BILLING
==============================================================================

YOUR ACCOUNT (/account, gold circle top right). Tabs:
  Profile (name/email read-only, phone, address, roles, board contact);
  Your units (owners); Sign-in and security (password, two-step status, sign
  out of other devices); Plan and billing (board only); Notifications (email
  choices, light/dark); Privacy and data (what is kept, "Download your
  details" JSON, how to close the account by emailing support).

BILLING
  Prices: Starter 2-6 units $19/mo or $190/yr; Building 7-12 $39/$390;
  Association 13-20 $59/$590. All features on every plan. Over 20 units: email
  sales. Yearly = 10 months.
  Trial: 14 days, no card, set when a building is created (a trial already
  running keeps its old date). Choosing a plan during the trial keeps the free
  days: Stripe takes the first payment when the trial ends.
  Comps: a platform admin can give free access with a reason and optional end;
  every building that existed at launch is comped "Early access".
  Status order: comp, active/trialing subscription, past due (14 days), trial,
  grace (14 days), read-only.
  Board admin can choose a plan (Stripe hosted checkout), open Manage billing
  (Stripe portal), and switch monthly to yearly (Stripe credits the unused
  month; needs the key's Subscriptions permission set to Write).
  Stripe webhook verifies the signature, claims each event once, re-fetches
  the subscription, and records through five narrow database functions.
  Switches: BILLING_ENABLED (on in production) and BILLING_ENFORCE (off).

==============================================================================
PART 12. PLATFORM ADMIN, BACKGROUND JOBS, SECURITY, DEPLOYMENT
==============================================================================

PLATFORM ADMIN (Doug only, two-step required; no link in the app, type the URL)
  /admin/billing (comps, trials, refresh from Stripe), /admin/partners
  (insurance brokers), /admin/tax-templates (PDF templates, links, rates).

BACKGROUND JOBS (vercel.json; both need CRON_SECRET)
  18:00 UTC daily: sync every bank, then revoke expired/sold-unit access.
  15:00 UTC daily: run standing email rules, finish queued emails, purge email
  history older than 24 months.
WEBHOOKS (all signature-verified): Plaid, Stripe, Resend.
EMAIL: Resend from notifications@walkuphoa.com; replies go to the board.
KEYS THE APP USES (names only): Supabase URL/anon/service role; ANTHROPIC_API_KEY;
PLAID_CLIENT_ID/SECRET/ENV/REDIRECT_URI/WEBHOOK_URL, BANK_TOKEN_KEY;
GOOGLE_PLACES_KEY (contractor search, map, address suggestions);
RESEND_API_KEY and RESEND_WEBHOOK_SECRET; CRON_SECRET; BILLING_ENABLED,
BILLING_ENFORCE, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, six STRIPE_PRICE_*.
SECURITY: per-request Content-Security-Policy with a nonce; HSTS; no framing;
read-only bank tokens encrypted; audit log on people, roles, associations,
invites; quarterly access review; 17 escalation attacks against board admin
were all refused in the last security round.
DEPLOYMENT: code on GitHub dscollectiveio/Walkup main, Vercel deploys from it
(region sfo1). Supabase production oeqgtakyhtauldaebwcn, dev
xhrivmdkrcfkhjyhkhye. Production has migrations through 0064; 0065 (access
fixes) is written, tested and not yet applied.
TESTS: about 190 unit files, 51 database files on an in-memory Postgres, 5
browser (Playwright) files. GitHub runs only a dependency audit; the test
suites run by hand.

==============================================================================
PART 13. THE PUBLIC WEBSITE
==============================================================================

Landing page (signed-out "/"): sticky header, hero with a six-screen slideshow,
problem cards, six feature cards (Financial Management, HOA Dues and Reminders,
Tax Prep Support, Insurance Marketplace, Repairs Tracking, Find a Contractor),
five-step timeline, founder section, trust cards, who it is for (with a state
waitlist), pricing, 15 FAQs, final call to action with a Calendly booking
link, footer. /features: searchable catalog of 68 features in 11 categories.
Legal: /terms, /privacy, /security, /policies (access controls, data
retention, vulnerability management), security.txt. Public emails: hello@,
support@, sales@, security@ walkuphoa.com (forwarded to Doug).

==============================================================================
PART 14. WHAT IS NOT WORKING, INCOMPLETE OR RISKY
==============================================================================

Labels: BROKEN or WRONG (does the wrong thing now) | MISSING (planned or
expected, not built) | NEEDS A SETTING | DOUG'S DECISION | RISK | UNVERIFIED.
Within each group, most important first.

----------------------------------------------------------------------
A. DOES THE WRONG THING OR CONTRADICTS WHAT THE SCREEN SAYS
----------------------------------------------------------------------
 1. WRONG: Read-only mode does nothing. The function that blocks edits for a
    lapsed building (assertCanWrite) is never called by any action. The Terms
    promise read-only behavior. Turning BILLING_ENFORCE on today would change
    notices only. (src/lib/billing/entitlement.ts; checklist says about 270
    actions would need it.)
 2. WRONG: Plan size does not change at renewal. The screens and Terms say a
    building moves to the plan for its unit count at renewal. The only
    subscription change in code is monthly to yearly. A building that signs up
    small and grows keeps the lower price until someone changes it by hand.
 3. WRONG: Financial statements do not use the bank balance. Comments say the
    statements, Home, Bank Feed and insurance all read the bank figure; only
    Home and the insurance check do. The statements compute cash from the
    ledger, and that position is calculated and then never shown.
 4. WRONG: The statements page says its figures are "the same numbers as your
    tax filing". They are not: the ledger counts dues as income when charged,
    while the tax test uses cash received.
 5. WRONG (fixed locally, not yet released): the Profile tab said a corrected
    email is also the one you sign in with. It is not; there is no
    change-your-sign-in-email feature anywhere.
 6. WRONG: Two bank accounts, one ledger account. All accounts under one bank
    login post to one ledger cash account, and posting uses the connection's
    fund, while the per-account fund choice only changes how Home reports
    cash. A reserve savings account at the same bank shows as reserve on Home
    but its transactions post to operating. Credit cards are not filtered out
    of sync.
 7. WRONG: Whether a ledger account is "reserve" is guessed from whether its
    name contains the word "reserve".
 8. WRONG: "Record a payment" on Collections always uses account 1000, the most
    recent fiscal year (not the year of the payment date), and the operating
    fund, whatever bank received the money.
 9. WRONG: Home still counts a bank in "error" status, using its last stored
    balance, so cash can look fine for a bank nobody has reconnected.
10. WRONG: Opening Find a Contractor can spend a Google call (it searches when
    nothing is cached), against the stated intent that opening a link is free.
11. WRONG: Ownership percentages are checked by the app within 0.0001 of 100,
    the database requires exactly 100, so an even three-way split can pass the
    app and fail in the database with a raw error.
12. WRONG: New budget categories are always created as "exempt expenditure"
    with no question asked. That feeds the 90% tax test.
13. WRONG: Owner "Your building" omits the electric company and "other notes"
    that the board's emergency page shows.
14. WRONG: Dashboard greeting uses UTC outside Illinois; dates for charges
    use the server's clock in places, so a charge near midnight on the 1st
    could land in the wrong month (unverified in production).
15. WRONG: Stale text: README (says migrations 0001-0048, "no service-role
    client", 2 to 6 units), some code comments (statements "not built from the
    bank feed", "no email service"), DECISIONS #27 and #37, progress notes that
    say things are not started that were later done.

----------------------------------------------------------------------
B. FEATURES THAT EXIST IN THE DATABASE BUT CANNOT BE USED IN THE APP
----------------------------------------------------------------------
 1. No balance sheet anywhere. Statements are profit and loss only (plus a
    trial balance in the Excel package and /ledger).
 2. Auto-post rules cannot be switched on. The sync honors them, but the screen
    always saves auto_post = false.
 3. No way to waive or write off a charge, though the columns, statuses and
    account 4090 exist.
 4. No manual expense entry and no manual journal entry in the screens. The
    only manual money entry is "Record a payment".
 5. No screen to close a fiscal year (the database enforces it, nothing closes).
 6. Dues: only the current period can be charged (a missed month is never
    back-charged); no special assessments; no percentage allocation.
 7. Documents: no way to upload a new version; no screen to create filing
    rules; no folders screen; no OCR (scans, photos, Word, Excel are stored but
    not read or searchable); extracted dates and amounts feed nothing.
 8. Binned documents are described as recoverable for 30 days, but no job ever
    removes them.
 9. Setup checklist "Skip for now" has no way to bring it back in the app.
10. Invites are never emailed by Walkup (link or draft only).
11. No audit-log screen, though the log is recorded and admins can read it.
12. No self-service account closing; no two-step recovery codes or re-enroll.
13. Help dialog and the downloadable walkthrough are written for the board;
    owners and accountants see the same list.
14. Access control: only phase 1 of 5 is built (see C).

----------------------------------------------------------------------
C. ACCESS CONTROL (decision 43; plan in docs/specs/access-control-plan.md)
----------------------------------------------------------------------
 BUILT, NOT YET RELEASED (migration 0065 written and tested, not applied to
 production): invite-link accountants expire in 90 days; existing accountants
 with no end date get one; a building cannot lose its last board admin;
 "Extend 90 days"; invite form shows only roles you can give; accountants no
 longer see a dead "Building Info" link.
 MISSING: board positions and terms; the People and access page; property
 manager, attorney and observer roles and the access map behind them; the
 owners' finances page. One login still means one building.
 RISK: any board member can read invite links for roles they cannot give
 (inferred from the policies, unverified in practice). A board-only document
 still includes the accountant, so legal notices and contracts are visible to
 them. A document tied to a unit is visible to that unit's owners regardless
 of its "board only" setting. Accountants cannot see contractor reviews or
 internal ticket notes, but can see delinquency.
 RISK: redacting a person clears the link to their login but never deletes the
 sign-in account itself.

----------------------------------------------------------------------
D. NEEDS A KEY OR A SETTING TO WORK
----------------------------------------------------------------------
 Known good today (from this project's history): Stripe live key works
 (checkout tested); Resend domain verified and sending configured; Plaid
 connected for the real bank; Google key works for Places.
 STILL TO DO:
 1. Stripe key permission: Subscriptions must be Write for "Switch to yearly".
 2. Google Cloud: Maps Static API must be enabled and allowed on the key, or the
    Building Info map will silently not appear. Note .env.local.example still
    tells people to restrict the key to Places, Place Details and Geocoding,
    which would block the map.
 3. Delete the old "Walkup Prices" restricted key in Stripe once unused.
 4. Plaid: confirm OAuth institution approval and the security questionnaire;
    PLAID_REDIRECT_URI; PLAID_WEBHOOK_URL (banks connected before it was set
    keep an empty webhook until re-registered); BANK_TOKEN_KEY (without it,
    tokens are stored unsealed with only a logged warning, and there is no key
    rotation procedure: losing the key means reconnecting every bank).
 5. CRON_SECRET and SUPABASE_SERVICE_ROLE_KEY in Vercel: without CRON_SECRET
    both daily jobs return 500 and bank sync, access clean-up and reminders
    do not run (confirm they are set).
 6. Anthropic key: insurance reading, summaries, Marketplace search, document
    filing, repair triage, quote and certificate reading, web contractor
    search. Without it each shows a by-hand path.
 7. Supabase dashboard settings the code assumes but cannot show: minimum
    password length and leaked-password check, email confirmation, session
    length, login/MFA/reset rate limits.
 8. Security hygiene items in SECURITY_POLICY section 8 are unticked
    (Dependabot alerts, remove SMS as a second factor on GitHub/Google, Vercel
    Node version, a recorded production access review). The Dependabot
    moderate alert is dev tooling only.
 9. security.txt expires 2027-10-14 and must be renewed by hand each year.

----------------------------------------------------------------------
E. WAITING ON DOUG'S DECISION OR SOMEONE ELSE'S REVIEW
----------------------------------------------------------------------
 1. Terms of Service: about a dozen LAWYER comments (renewal notice and
    auto-renewal wording, refund policy, price-change notice, read-only
    notice, sales tax, the founding offer). Terms are reviewed by Doug only.
 2. Founding offer ("free for the first 25 associations"): no code counts
    associations or enforces it; duration undecided.
 3. Chicago lease transaction tax and Stripe Tax: CPA question.
 4. Refund policy; when early-access buildings start paying; read-only notice
    period; comp codes not built; "comp expiry grace gap" (a comp ending when
    enforcement starts would flip a building to read-only with no grace).
 5. Tax logic has not been reviewed by a CPA. Unchecked until a platform
    admin verifies each: the $2,000 1099 threshold, 19 official links, due
    rules, field maps. Open tax items: a July-June fiscal year takes its tax
    year from the year it ends; line 19 prints 0 under $100; whether IL-1120
    needs the 1120-H attached is unsourced; a verified Illinois SOS date can
    never read overdue; after 120 days an unfiled form reads "not on file".
    Only a 2025 1120-H and a 2026 1099-NEC field map exist; the next year
    needs new maps. Illinois only.
 6. Does a disconnected bank's transaction history stay (policy question).
 7. Property-manager positioning: the landing page still says a professionally
    managed community is "not yet" a fit, and the intro says "volunteer board".
 8. Insurance: copy about referral fees is intentionally absent until decided;
    statute text was verified 2026-10-14 and amendments start 2027-01-01 with
    nothing in the app reminding anyone to re-check.
 9. Placeholders: testimonial (null), founder caption duplicates the signature.

----------------------------------------------------------------------
F. OTHER RISKS (evidence in code, not currently failing)
----------------------------------------------------------------------
 Money and data
  - Posting a deposit and also recording the same money by hand double-counts;
    guards exist for checks/cash within 45 days and for imports (flag only).
  - No unique index stops duplicate late fees from a true simultaneous double
    submit; production may already hold duplicates.
  - Unposting a bank row hard-deletes the matching expense/payment rows (the
    audit log is the only record).
  - Collections preview and "dues upcoming" emails use gross balances; the SQL
    decides who is emailed, so only the preview can be misleading.
  - An import cell like "100 200" is read as 100,200.
  - Dues payment account and routing numbers are plain columns, readable by
    every member including owners (by design; not in emails).
  - The owner Budget screen is passed actual spending; owners should get zero
    under database rules (unverified).
  - Bills "mark paid" writes no ledger entry, so the Bills view and the books
    can drift.
 Operations
  - Daily bank sync runs one bank after another within a 300-second limit
    (behavior with many buildings unverified). It is fixed at 18:00 UTC, which
    is 1 p.m. Central for about eight months of the year.
  - The reminder job returns early when sending is off, so the 24-month email
    purge does not run then.
  - Rate limiting in the app is in memory per server instance, only on address
    lookups; cooldowns for sync and balances are also per instance.
  - Plaid: a dead-token connection shows a Reconnect button that will fail; a
    failed item-remove is not shown; closing an association does not
    disconnect its banks; a bank not removed at Plaid stays billable.
  - Invite link opened in a second browser after sign-up can lose the invite.
 Repairs
  - Nobody is alerted to a new report, even an emergency. The board learns by
    opening Walkup. This is a stated design choice, but it is the biggest
    safety gap in the product.
  - Emergency detection is keyword matching plus the reporter's answer; odd
    wording will not fire it.
  - Scanned or photographed quotes and certificates cannot be read.
  - Quote and visit emails count as sent when the board says so.
  - Starter upkeep list and time zone assume Chicago.
  - Access notes on shared-area problems are visible to every owner.
 Security (from the two attack rounds; most fixed, these remain)
  - Owners can read internal actor ids on ticket events through three reads;
    a photo-registration existence check; no cleanup job for abandoned ticket
    photo uploads; a board member can still write AI result rows directly; a
    reporter can plant a triage within the daily cap; redeem_invite refusals
    surface as server errors.
  - Round 2 mutated 6 of about 80 tables and skipped about 15 checks for
    missing test data. No penetration test, no documented backups/PITR, and
    the incident-notification deadline and backup contact are unset.
 Testing
  - Signed-in browser tests skip themselves when no dev login is saved.
  - GitHub does not run the unit, database or browser tests on push.
  - Browser checks listed as pending in the repairs report (iPhone photo
    upload, VoiceOver, 375px layouts) were not confirmed done.

----------------------------------------------------------------------
G. UNVERIFIED (cannot be seen from the code)
----------------------------------------------------------------------
  - Which migrations are applied where. Known from this project: production has
    0001 through 0064 (0064 applied by hand 2026-10-16); 0065 is not applied.
    Older review docs say production lagged; they appear out of date.
  - Whether the landing, Terms and Privacy billing copy is final, and whether
    the Stripe dashboard portal settings (cancel at period end, no plan
    switching) are set as the checklist wants.
  - How non-admin board members see failures on the Bank feed.
  - Whether anything surfaces the book-to-tax reconciliation view.
  - Whether the full test suite currently passes (last full run before the
    latest changes: 3,128 passed; two stale owner-navigation expectations were
    fixed afterwards).

----------------------------------------------------------------------
H. IF YOU ONLY FIX FIVE THINGS
----------------------------------------------------------------------
  1. Wire read-only mode and renewal tier changes before turning enforcement
     on (A1, A2).
  2. Alert the board when a repair is reported, at least for emergencies.
  3. Release access phase 1 (0065) and build the rest of decision 43.
  4. Make the statements and the dashboard agree on cash, and add a balance
     sheet (A3, B1).
  5. Finish the ledger tools a treasurer will ask for in week one: waive or
     write off a charge, manual entry, close a year, back-charge a missed
     dues period (B3 to B6).
