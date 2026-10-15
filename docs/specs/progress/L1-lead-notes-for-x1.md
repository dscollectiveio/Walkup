# L1: lead engineer notes for X1-integration (2026-10-14)

Numbering, so the entries don't collide when X1 writes docs/DECISIONS.md:
- DECISIONS #35: the insurance/repairs overhaul (brief section 1 decisions + spec sub-decisions).
- DECISIONS #36: "no email unless a board admin approved it" (money-and-reminders spec, once written).
- DECISIONS #37: the Plaid webhook's second narrow service-role use (text proposed in PL3-plaid-webhook-and-sync.md; renumber from its draft "#35").
- Migrations in the tree: 0051 foundation, 0052 insurance, 0053 repairs, 0057 integrity guards (role_grants/unit_owners), 0058 plaid webhook flag. 0054-0056 are reserved for owner portal, email reminders/statements, imports.

Also for X1:
- docs/SECURITY_POLICY.md: add Anthropic as a subprocessor, the Plaid webhook (section 8), and the accepted dev-dependency risk is already added.
- Keep the redesigned "Worth a minute today" card (docs/specs/progress/D1-worth-a-minute.md) when adding repair/upkeep/insurance items.
- Contact addresses: hello@ (general), support@, sales@, security@ (src/lib/site-config.ts). Use SUPPORT_EMAIL for in-app help and error messages.

Update (owner portal finished, see O1-owner-portal.md): its DECISIONS entry is #38 (the spec called it #37, which is the Plaid webhook).
The owner-portal Integration tasks (Home redirect for owner-only users, sidebar per role, tour steps, setup guide,
board-only guards, Building Info mount line in person-row.tsx, reportOutsidePayment changes, Terms/Privacy lines)
are listed in O1-owner-portal.md and must be applied after X1 finishes, because X1 owns those files right now.
Migration 0054 is NOT applied to dev yet; apply 0051-0058 to dev in order before any live check.

Update (tax views): migration 0059_tax_views_net_reversals.sql (lead engineer) fixes the flaw found in N1-import.md: a reversed
entry no longer counts in cash_basis_receipts/disbursements, so Undo on an import and the bank feed's unpost now correct the
Form 1120-H figures. Tests: tests/db/tax-views-reversals.test.ts. The import Done page can say the undone rows no longer count.
Apply order on dev: 0051, 0052, 0053, 0054, 0055, 0056, 0057, 0058, 0059.
