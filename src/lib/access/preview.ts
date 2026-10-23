// "See what they see": plain notes per role for the preview on People & Access. The tabs themselves
// come from navFor(role), so a nav change shows here without an edit; these notes are what the tabs
// do not say. Kept in step with docs/specs/access-audit-2026-10-20.md.

export const PREVIEW_ROLES = ["board_admin", "board_member", "accountant", "property_manager", "attorney", "observer", "owner"] as const;

export const PREVIEW_LABEL: Record<string, string> = {
  board_admin: "Board admin",
  board_member: "Board member",
  accountant: "Accountant",
  owner: "Owner",
  property_manager: "Property manager",
  attorney: "Attorney",
  observer: "Observer",
};

export const PREVIEW_NOTES: Record<string, string[]> = {
  board_admin: [
    "Everything a board member can do, plus roles and invites, connecting the bank, billing, email approval and deleting records.",
    "Has every position's duties (Treasurer and Secretary).",
  ],
  board_member: [
    "Reads everything the board reads and works on repairs, dues, documents, taxes and announcements.",
    "Bank Feed is read only, unless they hold the Treasurer position.",
    "Cannot change roles, send invites other than to owners, connect the bank, or approve email (the Secretary approves announcement emails).",
  ],
  accountant: [
    "Reads the financials, budget, dues standing, taxes, insurance and the accounting and tax documents.",
    "Read only everywhere. Cannot see the Building page, owner contact details, or the board's legal papers.",
    "Access ends after 90 days unless the board extends it.",
  ],
  owner: [
    "Sees their own unit's statement and how to pay, the building's announcements, repairs they reported or that touch their unit, the budget plan, the insurance summary and documents shared with them.",
    "Never sees costs, contractor details, other owners' details or the ledger.",
  ],
  property_manager: [
    "Works on repairs and reads contractors, units and people for the whole building.",
    "No financial statements, bank feed, taxes, budget actuals, or email. Access ends after 90 days.",
  ],
  attorney: [
    "Reads only the legal documents the board has shared with them, for the units shared. Access ends after 90 days.",
  ],
  observer: [
    "Reads what owners read plus the building's finances summary. Read only. Access ends after 90 days.",
  ],
};

/**
 * The rows of the "what a role sees" table. A row is a feature, not a sidebar label: owners, observers and
 * attorneys have their own versions of some pages (Home, "How to pay", the Finances summary, Collections), and the
 * board reaches the same information through its bigger pages (the Dashboard, HOA Dues, Financial Statements). A
 * role has a row when any item in its sidebar goes to one of the row's routes, so the board is not marked as
 * missing something it can see under another name.
 */
export const PREVIEW_FEATURES: { label: string; hrefs: string[] }[] = [
  { label: "Dashboard or Home", hrefs: ["/", "/owner"] },
  { label: "Announcements", hrefs: ["/announcements"] },
  { label: "Unit statements and how to pay", hrefs: ["/owner/statement", "/owner/pay", "/dues"] },
  { label: "HOA Dues and email", hrefs: ["/dues"] },
  { label: "Collections", hrefs: ["/collections", "/dues"] },
  { label: "Bank feed", hrefs: ["/bank-feed"] },
  { label: "Financial statements or finances summary", hrefs: ["/financial-statements", "/owner/finances"] },
  { label: "Budget", hrefs: ["/budget"] },
  { label: "Taxes", hrefs: ["/tax"] },
  { label: "Insurance", hrefs: ["/insurance"] },
  { label: "Building and owners", hrefs: ["/building", "/owner/building"] },
  { label: "People and access", hrefs: ["/access"] },
  { label: "Repairs and upkeep", hrefs: ["/repairs"] },
  { label: "Find a contractor", hrefs: ["/repairs/find"] },
  { label: "Documents", hrefs: ["/documents"] },
];

/** A few words under a check where the role gets a smaller version of the page. Keyed by role, then feature label. */
export const PREVIEW_LIMITS: Record<string, Record<string, string>> = {
  board_member: { "Bank feed": "read only unless Treasurer" },
  accountant: {
    "Unit statements and how to pay": "read only",
    "HOA Dues and email": "read only",
    "Bank feed": "read only",
    "Documents": "accounting and tax",
  },
  property_manager: {
    "Building and owners": "read only",
    "Documents": "maintenance and vendor files",
  },
  attorney: { "Collections": "shared units", "Documents": "shared with them" },
  observer: {
    "Dashboard or Home": "owner view",
    "Financial statements or finances summary": "summary",
    "Budget": "plan only",
    "Insurance": "summary",
    "Building and owners": "summary",
    "Documents": "shared with owners",
  },
  owner: {
    "Dashboard or Home": "own unit",
    "Unit statements and how to pay": "own unit",
    "Financial statements or finances summary": "if the board turns it on",
    "Budget": "plan only",
    "Insurance": "summary",
    "Building and owners": "summary",
    "Documents": "shared with owners",
  },
};
