# P1-specs: owner portal, money and reminders, imports

Step owner: Product design (specs only). Date: 2026-10-14. No source code or
migration file in the repo was touched, no git command run, nothing applied to
any Supabase project. The draft SQL in the three specs was applied to a
scratch PGlite database (migrations 0001 to 0053 plus the three drafts) and
exercised with scripts outside the repo before being embedded; the DB test plans
in each spec turn those checks into `tests/db/*.test.ts`.

## Written

| File | What |
|---|---|
| `docs/specs/owner-portal-spec.md` | Owner home `/owner`, unit statement with running balance, how to pay and "I paid another way", announcements (board posts, audience all or chosen units, pinned, attachment from the Document Hub, read counts for the board, no comments), building contacts and emergency facts, profile, `BoardOnly` guard for every board-only page, role-aware sidebar and tour change list. Migration **0054**: `unit_statement_summary`, `unit_statement` (+ internal `_core` functions), `viewer_context`, announcements tables and RPCs, `invites.person_id` and a redefined `redeem_invite`, persons self-edit guard, board contact columns, report withdraw and cap. |
| `docs/specs/money-and-reminders-spec.md` | DECISIONS #36 (email only after a board admin approves: batch or standing rule), Resend sending pipeline, templates with exact copy, statement PDF and email, annual statements, late-fee notices (letters about posted fees only), Collections view, unsubscribe, cron, webhook, security review, CAN-SPAM checklist, Terms and Privacy text. Migration **0055**: settings, rules, preferences, suppressions, batches, outbox, log; every cap in SQL; service-only functions; anon unsubscribe pair; `redact_person` reaches the email tables. |
| `docs/specs/import-spec.md` | Import wizard under Building Info: templates (CSV and XLSX), parsing caps, column mapping with optional PII-free AI help, explicit account mapping, fix table, dry-run preview, atomic commit through the ledger RPCs, idempotency, undo by reversal, ownership percentages, opening balances designed around the 1120-H's branch-1 receipt tracing, setup-guide integration. Migration **0056**: `import_batches`, `import_rows`, board_admin functions. |
| `docs/specs/progress/P1-specs.md` | This file. |

## Findings that shaped the designs

1. **`redeem_invite` never links an invited owner to the person the board
   already entered.** It always inserts a new `persons` row, so an invited
   owner would see no unit; with a prefilled email it fails on the unique
   index. Fixed in 0054 (`invites.person_id`, claim-your-record) and used by
   the import's "invite your owners" step.
2. **`cash_basis_receipts` branch 1 traces a payment to the income account its
   charge credited.** A carried-forward receivable that credits equity would make
   those payments vanish from the 60% test. The import posts unit balances as
   charges crediting an income account the board chooses, and keeps receivables
   out of the opening entry (import-spec section 10).
3. **`persons_update` lets an owner edit their own name and email.** 0054 narrows
   non-board self-edits to phone and mailing address.
4. **Owners reach several board pages with misleading empties** ("No bank
   connected", "Nobody is behind"). Owner-portal 2.4 lists each fix.
5. **The sidebar is not role-aware;** exact change list in owner-portal 7.

## Decisions the lead engineer needs to make (also in each spec)

1. Service-role shape for the reminder cron and the Resend webhook: one
   allowlist helper `serviceRpc()` (default) or one client per route like the bank cron.
2. DS Collective LLC's postal address for the email footer (`LEGAL_ADDRESS`);
   until it is set, sending stays "not set up".
3. Resend: confirm the verified sender, DNS, rate limit, webhook event names and
   the bounce payload field at build time (the docs page fetched did not state the rate limit).
4. Import AI mapping reuses `document_classify` (default) or gets its own kind
   (constraint swap plus edits to 0051's functions and `ai-usage.test.ts`).
5. Warm-up (20 emails a day for a week), history retention (24 months), whether
   the uploaded import file is kept in the Document Hub (default: not).
6. Lint-test change: `tests/db/migrations.test.ts` anon exception list grows from
   one function to three (the two unsubscribe functions).

## Migration order and cross-spec contracts

0054 (portal) -> 0055 (email; uses `unit_position_core`, `unit_statement_core`,
`associations.board_contact_email`, `announcements`) -> 0056 (imports; uses
`email_address_ok`, widens `document_links` with 0054's `announcements` kept).
Each of 0054 and 0056 replaces the `document_links` target check with the full
list; 0052's list plus `announcements`, then plus `import_batches`.

## Left for the Integration workstream

Listed per spec under "Integration tasks": Home (`src/app/page.tsx`, urgent
items, setup guide), sidebar (`config.tsx`, `sidebar.tsx`, `layout.tsx`), tour
(`steps.ts`), `proxy.ts` public paths, `vercel.json`, `.env.local.example`,
Terms and Privacy pages, the data-retention policy, `DECISIONS.md` (#36, #37,
#38), and the lint test edit.
