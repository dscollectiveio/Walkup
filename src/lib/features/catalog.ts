import type { Category } from "./types";

/**
 * Every feature Walkup ships today, for the public /features page. Written
 * from a read of the code and docs (2026-10-16): leave out anything not live,
 * say "drafted for you" for email the user sends from their own mail app, and
 * "sends after a board admin approves" only for the four things Walkup itself
 * emails (dues reminders, late fee notices, owner statements, announcements).
 * No em dashes in anything a visitor reads.
 */
export const CATEGORIES: Category[] = [
  {
    id: "finance",
    title: "Financial management",
    icon: "finance",
    blurb:
      "Your bank feed, budget and financial statements in one place. Transactions arrive sorted, spending is tracked against the plan, and board-ready reports are a click away.",
    features: [
      {
        id: "bank-feed",
        name: "Bank feed",
        summary: "Every bank transaction lands in one list, ready to categorize.",
        details: [
          "Connects through Plaid with read-only access, so Walkup can never move money",
          "Syncs every day, and again when you open the page if the data is over 12 hours old",
          "Connect more than one account and map each to a ledger account and fund",
          "Reconnecting a bank never double-counts a transaction",
        ],
        who: ["board", "accountant"],
      },
      {
        id: "bank-balances",
        name: "Bank balances and connection alerts",
        summary: "See what's in the bank, and hear when a bank needs you to sign in again.",
        details: [
          "Live balances for every connected account, split into day-to-day and reserve",
          "Choose which fund each account counts as, so reserve savings at the same bank stay separate",
          "An alert flags a connection that needs a fresh sign-in",
        ],
        who: ["board", "accountant"],
      },
      {
        id: "suggestions",
        name: "Categorization suggestions with reasons",
        summary: "Each waiting transaction gets a suggested category and the reason for it, in plain words.",
        details: [
          "Reasons come from how you filed that payee before, or from a keyword table",
          "Flags a deposit that matches a payment already recorded by hand",
          "Nothing is saved until a person clicks, and every action can be undone",
        ],
        who: ["board"],
      },
      {
        id: "rules",
        name: "Categorization rules",
        summary: "File a payee the same way twice and Walkup offers to remember it.",
        details: [
          "\"Always file this payee as that category?\" after the second time",
          "Rules only pre-fill the choice; a person still posts the transaction",
          "Bulk categorize many rows at once, and get offered look-alike payees",
        ],
        who: ["board"],
      },
      {
        id: "posting",
        name: "Post to the books, and undo",
        summary: "Turn a categorized transaction into a proper double-entry record in one click.",
        details: [
          "Kinds: expense, other income, dues, transfer, or not for the books",
          "Post everything that's ready with one button, after a preview",
          "Undo is a reversal entry, never a deletion, so the history stays honest",
          "A dues deposit is applied to the unit's open charges, oldest first",
        ],
        who: ["board"],
      },
      {
        id: "dashboard",
        name: "Dashboard",
        summary: "One page that tells the board what needs attention today.",
        details: [
          "Balances from your bank, a reserve target meter and a spending breakdown",
          "\"Worth a minute\" items ranked by importance, and a \"coming up\" list of deadlines",
          "A setup checklist that ticks itself off as you finish each step",
          "Your building drawn as a cross-section, one floor per unit, with who's behind",
        ],
        who: ["board", "accountant"],
      },
      {
        id: "budget",
        name: "Budget and spending",
        summary: "One number per category for the year, and one sentence on whether you're on plan.",
        details: [
          "Plan against spent for the period, with a marker for where you should be by now",
          "Spending with no budget behind it is called out",
          "Reserve transfers count as savings, not spending",
          "A suggested starting budget from last year, with an optional 0, 2, 3 or 5% increase",
          "Click any slice or row to see the transactions behind it, or export them to a spreadsheet",
        ],
        who: ["board", "accountant", "owners"],
      },
      {
        id: "statements",
        name: "Financial statements",
        summary: "Profit and loss for any month, quarter or year, ready for the board meeting.",
        details: [
          "Side-by-side periods, with budget variance, as total or expenses only",
          "Click any line to see the entries behind it",
          "Download a PDF, or open a financial report email drafted for you in your own mail app",
        ],
        who: ["board", "accountant"],
        email: "draft",
      },
      {
        id: "ledger",
        name: "All transactions and trial balance",
        summary: "The full ledger, with a check that the books balance.",
        details: ["Totals by account and fund", "A clear balanced or not balanced check", "Open any total to see the entries behind it"],
        who: ["board", "accountant"],
      },
      {
        id: "imports",
        name: "Spreadsheet imports",
        summary: "Bring in your existing records instead of retyping them.",
        details: [
          "Five imports from CSV or Excel: units and owners, past transactions, opening account balances, opening unit balances and contractors",
          "Up to 5,000 rows, and every category is mapped by a person",
          "Importing an overlapping file adds only the new rows, and an import can be undone",
        ],
        who: ["board"],
      },
    ],
  },
  {
    id: "dues",
    title: "HOA dues and reminders",
    icon: "dues",
    blurb:
      "Set each unit's dues once. Walkup matches deposits, shows who's behind, and prepares friendly reminders and statements for a board admin to approve.",
    features: [
      {
        id: "dues-plans",
        name: "Dues plans",
        summary: "Give every unit its own amount and schedule.",
        details: [
          "A yearly amount per unit, paid monthly, quarterly, annually or once",
          "Units don't have to match",
          "Changing a plan never rewrites charges already posted",
          "\"Charge dues now\" posts the period's charges",
        ],
        who: ["board"],
      },
      {
        id: "dues-standing",
        name: "Where every unit stands",
        summary: "A clear status for each unit, at a glance.",
        details: ["Up to date, behind, paid ahead or not charged yet", "Amount owed and the next charge for each unit"],
        who: ["board", "accountant"],
      },
      {
        id: "charges-fees",
        name: "One-off charges and late fees",
        summary: "Add a special assessment, or set a late fee rule.",
        details: [
          "A late fee has an amount and a grace period",
          "Fees are proposed, and a person posts them, so nothing is charged on its own",
        ],
        who: ["board"],
      },
      {
        id: "payments",
        name: "Recording payments",
        summary: "Log a check, cash or transfer in seconds.",
        details: [
          "Unit, amount, date, method and reference",
          "Confirm that a bank deposit is dues, or confirm or dismiss an owner's \"I paid\" note",
        ],
        who: ["board"],
      },
      {
        id: "collections",
        name: "Collections",
        summary: "See who is late and what to do next.",
        details: [
          "Aging buckets: current, 1 to 30, 31 to 60 and over 60 days",
          "Friendly stage labels with a suggested next step: remind, send a fee notice, call or wait",
          "Shows reminders already sent and whether the last email was delivered or bounced",
        ],
        who: ["board", "accountant"],
      },
      {
        id: "reminder-emails",
        name: "Reminder and late fee emails",
        summary: "Prepare a batch, review each message, and a board admin approves it.",
        details: [
          "Fixed, plain templates (no AI writes your emails), with room for your own note",
          "Never includes bank details, and every email has an unsubscribe link",
          "One email per person per week per kind, and nothing goes to bounced or opted-out addresses",
          "If sending isn't switched on for your account, the same message opens as a draft in your mail app",
        ],
        who: ["board"],
        email: "approval",
      },
      {
        id: "reminder-rules",
        name: "Standing reminder rules",
        summary: "Have reminders prepared automatically, on a schedule you choose.",
        details: [
          "\"Days before due\" and \"days overdue\" rules, with a repeat interval and a maximum count",
          "A board admin switches each rule on and can pause it any time",
          "A daily job prepares the batch, and each batch still waits for approval",
          "See the send log, blocked addresses and opt-outs",
        ],
        who: ["board"],
        email: "approval",
      },
      {
        id: "owner-statements",
        name: "Owner statements",
        summary: "A statement for any unit, for any date range.",
        details: [
          "PDF with a running balance, and an annual statement for a full calendar year",
          "Email statements to owners as a batch after a board admin approves",
          "A late fee notice also comes as a printable letter",
        ],
        who: ["board", "owners"],
        email: "approval",
      },
    ],
  },
  {
    id: "tax",
    title: "Tax prep support",
    icon: "tax",
    blurb:
      "Walkup checks whether your association qualifies for Form 1120-H, prepares the figures from your books, and keeps every deadline in front of you. It prepares; your board and accountant file.",
    features: [
      {
        id: "form-1120h",
        name: "Form 1120-H check",
        summary: "Find out whether the short federal return fits your association.",
        details: [
          "Runs the 60% member income test and the 90% spending test from your books",
          "Estimates the tax on any income that isn't from members",
          "A board member confirms how each income account is classified, once",
        ],
        who: ["board", "accountant"],
      },
      {
        id: "tax-forms",
        name: "Tax forms workflow",
        summary: "Five steps from the numbers to a filed return.",
        details: [
          "Check the figures, send to your accountant, confirm each line, export to sign, mark as filed",
          "Every figure traces to the transactions behind it",
          "A figures worksheet in Excel, plus a to-sign PDF whenever a verified official template is active",
          "Marking a return as filed records the date and proof, and locks the figures",
        ],
        who: ["board", "accountant"],
      },
      {
        id: "form-1099",
        name: "1099-NEC tracking",
        summary: "Know which contractors need a 1099, and who still owes you a W-9.",
        details: [
          "Totals paid to each contractor in the calendar year, against the filing threshold",
          "Flags missing W-9s, and asks for them with a drafted email",
          "Recipient copies with the tax ID left blank for you to complete; Walkup does not e-file",
        ],
        who: ["board", "accountant"],
        email: "draft",
      },
      {
        id: "state-filings",
        name: "Illinois filings",
        summary: "Links and instructions for the filings Walkup doesn't fill.",
        details: [
          "The Illinois annual report and IL-1120 come with official links and filing steps",
          "How you file 1099s with the IRS is your CPA's call; Walkup prepares the recipient copies",
        ],
        who: ["board", "accountant"],
      },
      {
        id: "tax-deadlines",
        name: "Deadlines and calendar",
        summary: "Every date, marked verified or estimated.",
        details: [
          "Download a calendar file for your phone or computer",
          "A \"coming up\" card on the dashboard with the next filing",
          "Walkup won't guess a date it can't back up",
        ],
        who: ["board", "accountant"],
      },
      {
        id: "accountant-handoff",
        name: "Accountant handoff",
        summary: "Send your accountant exactly what they need.",
        details: [
          "Three emails drafted for you: the 1120-H package, the 1099 list and a heads-up",
          "None contains your EIN or anyone's tax ID",
          "Optionally give your accountant a time-limited, read-only login",
        ],
        who: ["board", "accountant"],
        email: "draft",
      },
    ],
  },
  {
    id: "insurance",
    title: "Insurance",
    icon: "insurance",
    blurb:
      "Keep every policy and renewal in one place, find out what your coverage leaves out, and request quotes without starting from a blank email.",
    features: [
      {
        id: "policies",
        name: "Policies and renewals",
        summary: "Every policy, what it costs and when it renews.",
        details: [
          "Twelve coverage types, with premium history and a year-by-year comparison",
          "Renewal reminders that arrive early enough to shop around",
          "A claims log, and archiving for old policies",
        ],
        who: ["board", "accountant"],
      },
      {
        id: "declarations-reading",
        name: "Declarations page reading",
        summary: "Upload a PDF or photo and Walkup fills in the policy for you to check.",
        details: [
          "Finds each policy in a renewal package",
          "The board checks every figure before anything is saved",
          "Tax IDs are removed before anything is read",
        ],
        who: ["board"],
      },
      {
        id: "coverage-check",
        name: "Coverage check",
        summary: "Spot gaps and worth-asking items before a claim does.",
        details: [
          "Around 36 checks, each marked as based on Illinois condominium law, your documents, your data or common practice",
          "Findings are worded as questions to put to your agent, not as advice",
        ],
        who: ["board", "accountant"],
      },
      {
        id: "marketplace",
        name: "Insurance marketplace",
        summary: "Find agencies and insurers near your building.",
        details: [
          "Search results are kept only when they link to a source",
          "Brokers who asked to be listed appear too; a listing isn't an endorsement",
          "Walkup doesn't broker insurance or rank agents",
        ],
        who: ["board"],
      },
      {
        id: "quote-requests",
        name: "Quote requests and comparison",
        summary: "Ask several agents for quotes, then compare what comes back.",
        details: [
          "A quote request email drafted for each agent, which you send from your own mail app",
          "Tracks follow-ups and the quotes you receive",
          "Compare quotes with the current policy side by side, with no scoring",
        ],
        who: ["board"],
        email: "draft",
      },
      {
        id: "agent-emails",
        name: "Emails to your agent",
        summary: "Drafts for the notes you send most.",
        details: [
          "Certificate requests, claim reports, coverage questions and more, eight kinds in all",
          "A plain template is always available",
        ],
        who: ["board"],
        email: "draft",
      },
      {
        id: "owner-insurance",
        name: "Owner insurance summary",
        summary: "Tell owners what the master policy means for their own condo policy.",
        details: [
          "The board publishes a short summary, written in plain language",
          "Owners can read it, ask for a certificate, or send the board a question",
        ],
        who: ["board", "owners"],
      },
      {
        id: "facts-sheet",
        name: "Insurance facts sheet",
        summary: "A print-ready one-pager of your policies in force.",
        details: ["Hand it to a new board member, a lender or an agent"],
        who: ["board"],
      },
    ],
  },
  {
    id: "repairs",
    title: "Repairs and upkeep",
    icon: "repairs",
    blurb:
      "Anyone in the building can report a problem, and the board can follow each one from report to done. Yearly upkeep runs on a schedule instead of someone's memory.",
    features: [
      {
        id: "report-problem",
        name: "Report a problem",
        summary: "Owners and the board can report what needs fixing.",
        details: [
          "Choose a shared area or a unit, add details and photos",
          "The confirmation is honest that the board isn't alerted instantly, and points to the right number for emergencies",
        ],
        who: ["board", "owners"],
      },
      {
        id: "emergency",
        name: "Emergency guidance",
        summary: "Safety steps appear straight away for the situations that can't wait.",
        details: [
          "Fixed guidance for gas, carbon monoxide, fire, elevator entrapment, electrical danger, flooding, sewage and no heat",
          "Shown instantly, with no AI involved",
        ],
        who: ["board", "owners"],
      },
      {
        id: "tickets",
        name: "Repair tickets",
        summary: "Follow each problem from open to closed.",
        details: [
          "Open, being worked on, waiting on contractor, fixed and closed",
          "Priority from can wait to needs attention now, with a timeline, notes and costs",
          "Mark duplicates, close out the job, and view as a list or a board",
        ],
        who: ["board"],
      },
      {
        id: "triage",
        name: "Triage suggestions",
        summary: "A suggested trade, urgency and questions to ask for each new problem.",
        details: ["It's only a suggestion, and the board decides"],
        who: ["board"],
      },
      {
        id: "repair-quotes",
        name: "Quotes for a repair",
        summary: "Ask contractors for quotes and record what they say.",
        details: [
          "A quote request drafted for each contractor",
          "Record each quote, then accept or decline it",
          "Accepting a quote doesn't place the work for you",
        ],
        who: ["board"],
        email: "draft",
      },
      {
        id: "owner-actions",
        name: "Owner follow-through",
        summary: "Owners stay in the loop without taking over.",
        details: [
          "Comment on a problem, or tap \"me too\"",
          "Confirm a fix, or reopen it within 30 days",
          "Give feedback on a contractor visit",
          "A notice to owners drafted for you to send",
        ],
        who: ["owners", "board"],
        email: "draft",
      },
      {
        id: "upkeep",
        name: "Upkeep schedule",
        summary: "Recurring jobs that run on a calendar, not on memory.",
        details: [
          "18 starter templates, offered and never added behind your back",
          "Due dates that roll forward as jobs are done",
          "A calendar file that also carries contractor visits and insurance renewals",
        ],
        who: ["board"],
      },
      {
        id: "bills",
        name: "Bills the board pays by hand",
        summary: "Never miss the water bill, the elevator contract or the insurance premium.",
        details: [
          "Recurring bills with autopay notes and payment history",
          "Walkup reminds you; it never pays anything",
          "A bill past its date stays on the dashboard until you mark it paid",
        ],
        who: ["board"],
      },
      {
        id: "emergency-info",
        name: "Emergency information",
        summary: "Shut-offs and contacts, where owners can find them.",
        details: ["Water, gas and electrical shut-offs and key contacts, shown to every owner"],
        who: ["board", "owners"],
      },
    ],
  },
  {
    id: "contractors",
    title: "Contractors",
    icon: "contractors",
    blurb:
      "Keep every contractor's paperwork in order, find new ones when you need them, and ask for quotes without retyping the job.",
    features: [
      {
        id: "directory",
        name: "Contractor directory",
        summary: "Everyone you've used, in one place.",
        details: [
          "Trades, rates, ratings, board reviews and notes",
          "Email a contractor from their page",
          "Import contractors from a spreadsheet",
        ],
        who: ["board", "accountant"],
      },
      {
        id: "paperwork",
        name: "Paperwork tracking",
        summary: "W-9s, insurance certificates and licenses, with expiry alerts.",
        details: [
          "W-9 on file or marked 1099-exempt",
          "Certificate expiry, and license number and expiry with a link to check it",
          "Expiry alerts apply only to contractors you actually use",
        ],
        who: ["board", "accountant"],
      },
      {
        id: "certificate-reading",
        name: "Certificate reading",
        summary: "Upload an insurance certificate and Walkup offers the end date.",
        details: ["The board confirms it before it's saved", "Works with PDFs that contain text; scanned images can't be read"],
        who: ["board"],
      },
      {
        id: "paperwork-requests",
        name: "W-9, certificate and quote requests",
        summary: "Ask a contractor for what you need with one click.",
        details: ["Each request is drafted for you and opens in your own mail app"],
        who: ["board"],
        email: "draft",
      },
      {
        id: "find-contractor",
        name: "Find a Contractor",
        summary: "Search for nearby contractors for the job at hand.",
        details: [
          "Search by trade, or describe a job that doesn't fit a trade",
          "Results are ranked, and the reasons are shown: distance, ratings, your own history, and whether insurance and a license are on file",
          "Contractors you've already saved are left out of the results",
          "Details are kept only when a cited source supports them",
        ],
        who: ["board"],
      },
    ],
  },
  {
    id: "documents",
    title: "Documents",
    icon: "documents",
    blurb: "The declaration, the minutes, the budget and the policy, in one searchable place the next board can find.",
    features: [
      {
        id: "upload",
        name: "Upload and organize",
        summary: "Drop in files and Walkup helps file them.",
        details: [
          "PDF, PNG, JPEG, HEIC, Word, Excel, text and CSV files, up to 25 MB each",
          "Sorted into 16 categories, with a summary of what's inside",
          "Anything it isn't sure about waits in a \"needs review\" queue, and your own choice is never overridden",
        ],
        who: ["board"],
      },
      {
        id: "doc-search",
        name: "Search",
        summary: "Find a document by its title or by what's inside it.",
        details: ["Searches the text of your files too", "Scanned images aren't read"],
        who: ["board"],
      },
      {
        id: "doc-preview",
        name: "Preview and details",
        summary: "Read a document without downloading it.",
        details: [
          "Inline preview for PDFs, images and text",
          "Rename it, change its category, and read the summary and key points",
        ],
        who: ["board"],
      },
      {
        id: "doc-sharing",
        name: "Who can see it",
        summary: "Documents are board-only until you share them.",
        details: [
          "Choose board only or all owners for each document",
          "Link a document to a repair, a tax form or an insurance policy",
          "A recycle bin catches deletions",
        ],
        who: ["board", "owners"],
      },
    ],
  },
  {
    id: "building",
    title: "Building and people",
    icon: "building",
    blurb: "Your association, its units and the people in them, with the right access for each.",
    features: [
      {
        id: "profile",
        name: "Association profile",
        summary: "Everything about the association and the building in one place.",
        details: [
          "Legal and display name, address with autocomplete, EIN and fiscal year end",
          "Year built, construction type, stories, and a Google map of the building",
          "Details the insurance check and tax pages use, kept in one spot",
        ],
        who: ["board", "accountant"],
      },
      {
        id: "units-people",
        name: "Units and people",
        summary: "Who owns what, and how that changed over time.",
        details: [
          "Ownership percentage history and owner changes",
          "A building graphic with one floor per unit",
          "Removing a former member's personal data is one action for a board admin",
        ],
        who: ["board", "accountant"],
      },
      {
        id: "roles-invites",
        name: "Roles and invites",
        summary: "Bring in the right people with the right access.",
        details: [
          "Invite by link as board admin, board member, accountant, property manager, attorney, observer or owner",
          "A link for anyone but an owner works only for the email it was made for, and ends in 3 days",
          "Accountant and outside-helper access ends on its own after 90 days unless a board admin renews it",
          "Unlimited board seats on every plan",
        ],
        who: ["board"],
      },
      {
        id: "people-access",
        name: "People and access",
        summary: "See who can see what, and change the board in one place.",
        details: [
          "Edit President, Vice President, Secretary, Treasurer and Directors in place, with their terms",
          "The Treasurer also categorizes and posts bank transactions, and the Secretary also approves announcement emails",
          "A table of what each role sees, and a feed of recent access changes",
          "Changing who has access asks for a fresh two-step code",
        ],
        who: ["board"],
      },
      {
        id: "outside-roles",
        name: "Property managers, attorneys and observers",
        summary: "Give an outside helper exactly the access their job needs.",
        details: [
          "A property manager works the repairs and upkeep and reads units, people and maintenance documents",
          "An attorney reads only the legal documents, and the collections for the units, a board admin shares",
          "An observer sees what owners see plus the finances summary, read only",
        ],
        who: ["board"],
      },
      {
        id: "announcements",
        name: "Announcements",
        summary: "Post a notice and owners see it the next time they sign in.",
        details: [
          "Send to every owner or only to chosen units",
          "Pin up to three, attach a file, and see unread dots",
          "Optionally email it to owners after a board admin approves",
        ],
        who: ["board", "owners"],
        email: "approval",
      },
    ],
  },
  {
    id: "owners",
    title: "Owner portal",
    icon: "owners",
    blurb: "Owners get their own simple view. They see what they owe and what's happening in the building, and nothing about the association's books.",
    features: [
      {
        id: "owner-home",
        name: "Owner home",
        summary: "Announcements and building repairs, the moment they sign in.",
        details: ["What's new from the board", "Repairs they reported or that affect the building"],
        who: ["owners"],
      },
      {
        id: "owner-statement",
        name: "Statement and how to pay",
        summary: "Exactly what they owe, and how to pay it.",
        details: [
          "A statement with a running balance, with a PDF",
          "Payment instructions from the board, and \"tell the board you paid\"",
        ],
        who: ["owners"],
      },
      {
        id: "owner-info",
        name: "Building information",
        summary: "The things owners need to know.",
        details: [
          "The budget plan, the building's insurance summary, contacts and emergency information",
          "Documents the board shared with all owners",
        ],
        who: ["owners"],
      },
      {
        id: "owner-privacy",
        name: "Privacy by design",
        summary: "Owners see their own unit and nobody else's.",
        details: [
          "Owners never see the books, the bank feed, tax pages or other owners' payments",
          "They can edit their own phone and mailing address",
        ],
        who: ["owners"],
      },
    ],
  },
  {
    id: "security",
    title: "Security and trust",
    icon: "security",
    blurb: "Your board stays in control of every dollar and every decision. Walkup records, reminds and prepares.",
    features: [
      {
        id: "read-only",
        name: "Read-only bank access",
        summary: "Walkup can look but never touch.",
        details: [
          "The bank connection can only read transactions and balances",
          "The access token is encrypted, and disconnecting closes it with Plaid",
          "Walkup never moves or holds association money",
        ],
        who: ["board"],
      },
      {
        id: "approval",
        name: "Nothing is emailed without approval",
        summary: "A board admin approves every message Walkup sends.",
        details: [
          "Reminders, fee notices, statements and announcements go out only after approval",
          "Everything else is a draft that opens in your own email app",
        ],
        who: ["board"],
        email: "approval",
      },
      {
        id: "mfa",
        name: "Two-step sign-in for everyone",
        summary: "A password plus a code from your phone, on every account.",
        details: [
          "Required for every user, and enforced in the database itself",
          "Passwords need at least 12 characters",
        ],
        who: ["board", "accountant", "owners"],
      },
      {
        id: "isolation",
        name: "Every association walled off",
        summary: "One association's data can't be read by another.",
        details: ["Enforced at the database level, not just in the app"],
        who: ["board", "accountant", "owners"],
      },
      {
        id: "audit-log",
        name: "Audit log",
        summary: "A record of who changed what.",
        details: ["Every change is logged with the person who made it", "The log can't be edited"],
        who: ["board"],
      },
      {
        id: "access-reviews",
        name: "Access reviews",
        summary: "A regular check that the right people still have access.",
        details: [
          "A review every 90 days, with a saved snapshot",
          "Expired accountants and owners who sold lose access automatically",
        ],
        who: ["board"],
      },
      {
        id: "your-records",
        name: "Your records stay yours",
        summary: "Download what you need, and ask for the rest.",
        details: [
          "Financial statements, budget, tax worksheets and every document you uploaded",
          "No contract to leave",
        ],
        who: ["board"],
      },
    ],
  },
  {
    id: "account",
    title: "Your account",
    icon: "account",
    blurb: "Everything about your own sign-in and preferences, in one simple page.",
    features: [
      {
        id: "account-page",
        name: "Account page",
        summary: "Manage your details, password and preferences.",
        details: [
          "Edit your phone and mailing address, and change your password",
          "Sign out of every other device if you lose a phone or use a shared computer",
          "Choose which emails you receive from your association",
        ],
        who: ["board", "accountant", "owners"],
      },
      {
        id: "appearance",
        name: "Light and dark mode",
        summary: "Pick the look that's easiest on your eyes.",
        details: ["Remembered on each device"],
        who: ["board", "accountant", "owners"],
      },
      {
        id: "tour",
        name: "First-login tour",
        summary: "A short walk through the app, with a replay any time.",
        details: ["Tailored to your role", "Replay it from Help"],
        who: ["board", "accountant", "owners"],
      },
    ],
  },
];
