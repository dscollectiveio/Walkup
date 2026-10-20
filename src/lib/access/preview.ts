// "See what they see": plain notes per role for the preview on People & Access. The tabs themselves
// come from navFor(role), so a nav change shows here without an edit; these notes are what the tabs
// do not say. Kept in step with docs/specs/access-audit-2026-10-20.md.

export const PREVIEW_ROLES = ["board_admin", "board_member", "accountant", "owner"] as const;

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
