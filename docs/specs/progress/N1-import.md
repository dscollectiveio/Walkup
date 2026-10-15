# N1-import: spreadsheet import (import-spec.md)

Owner: N1. Date: 2026-10-14. No git commit, push, stash, reset or checkout was run.
Nothing was applied to any remote Supabase project, no Supabase write tool was
used, no dev server was started or stopped (the one on :3100 was only curled),
no secret was printed, and no test sent real data to a model (the AI call is
mocked, and a test proves what would be sent).

Decisions the lead engineer took on Doug's behalf were followed: the upload is
not kept in the Document Hub and is purged after staging unless the board ticks
"Keep a copy"; every category mapping is explicit (no default exempt flag); the
opening balances follow the spec's income-account treatment.

## What was built

### Migration

| File | What |
|---|---|
| `supabase/migrations/0056_imports.sql` | `import_batches`, `import_rows` (association_id on delete restrict, RLS select for the board only, same-association guard triggers, audit on batches); the board_admin functions `import_start`, `import_stage_rows`, `import_set_options`, `import_update_row`, `import_set_row_decision`, `import_skip_problem_rows`, `import_cancel`, `import_validate`, `import_commit`, `import_undo`, `import_create_account`, `import_ensure_fiscal_year`; helpers `import_num`, `import_pct`, `import_date` (callable), `import_row_key`, `import_uuid`, `import_fiscal_year`, `import_err` (internal, not executable by authenticated). All SECURITY DEFINER functions pin `search_path = ''`, are revoked from public and anon. The `document_links` target check is widened (includes 0054's `announcements` and `import_batches`). |

### Libraries (`src/lib/import/`)

`kinds.ts` (fields, synonyms, labels, template slugs), `safe-cell.ts`, `csv.ts`, `cell-text.ts`, `zip-stats.ts`, `xlsx.ts` (server-only), `parse-file.ts` (server-only, caps and the spec's refusal messages), `normalize.ts` (dates, money, percent, phone, email, trade, key), `sensitive.ts`, `columns.ts` (auto-detect), `shape.ts` (character masks), `ai-verify.ts` (zod schema, verification of the model's answer), `ai-mapping.ts` (server-only, `runStructured` with the existing `document_classify` kind), `stage.ts` (parsed file plus mapping to staged rows), `split.ts` (`equalShares`, `parseShare`), `options.ts` (option schemas, merge, starting options, exact-name matching), `preview.ts` (entry preview, payee link counts, category totals), `tax-effect.ts`, `messages.ts` (error headings and Postgres error to plain words), `templates.ts` (server-only, CSV and XLSX via exceljs, dropdowns from the building's own funds, units and accounts), `limits.ts`, `types.ts`, `batch-data.ts`, `server.ts` (board-admin context, file loading, unfinished-upload helpers, 14-day stale cancel).

### App (`src/app/building/import/`)

| Route | Files |
|---|---|
| `/building/import` | `page.tsx`, `loading.tsx`, `start-cards.tsx`, `history.tsx` (Undo with inline confirm), `unfinished.tsx`, `ui.tsx` |
| `/building/import/template/[kind]?format=csv\|xlsx` | `template/[kind]/route.ts` (board admin only, 403 JSON otherwise) |
| `/building/import/new?kind=...&doc=...` | `new/page.tsx`, `new/upload-step.tsx` (DirectUpload, `read={false}`), `new/mapping-step.tsx` (auto-detect, date format, optional AI banner with "What was sent"), `new/remove-and-retry.tsx` |
| `/building/import/[batchId]?step=options\|fix\|preview\|done` | `[batchId]/page.tsx`, `steps.tsx`, `options-panel.tsx` (books, categories, new-category dialog, payees, fiscal year, units options), `fix-table.tsx`, `preview.tsx`, `commit-bar.tsx`, `done-actions.tsx`, `invite-list.tsx` (reuses the owner portal's `InviteToSignIn`) |
| `/building/import/[batchId]/errors.csv` | `[batchId]/errors.csv/route.ts` (formula-injection safe) |
| server actions | `actions.ts`: `startImport`, `saveImportOptions`, `revalidateImport`, `fixImportRow`, `setRowDecision`, `skipProblemRows`, `splitSharesEqually`, `createImportCategory`, `ensureFiscalYear`, `commitImport`, `undoImport`, `cancelImport`, `markImportUpload`, `removeUnfinishedUpload`, `suggestColumnMapping` |

### Tests

`tests/db/imports.test.ts` (50 tests, the spec's 37 plus further rules);
`tests/unit/import-{actions,ai-mapping,columns,copy,csv,normalize,options,render,routes,safe-cell,shape,split,stage,templates,xlsx,zip-stats}.test.ts`;
`tests/fixtures/import/build.ts` (workbooks and CSVs are generated in memory, no binary fixtures).

## Deviations from the spec, and why

1. **Expense rows are `source = 'expense'`, not `'import'`.** The spec (decision 4) routes money out through `record_expense`, which posts its own entry with source `expense` and no source id, and posted entries are immutable. The batch is traceable through `import_rows.created_id`; non-expense entries carry `source = 'import'` and `source_id = batch id` as specified. Unit balance charges are `source = 'assessment'` for the same reason (`record_assessment_charge`). Spec test 16's "every entry has source import" is therefore asserted for the entries the import itself posts.
2. **Funds: a fund named in the file must be matched** (`fund_unmapped`). The draft SQL fell back to the default fund for any unmatched fund value, which would file a typo silently. Only a blank fund cell takes the default. The UI starts exact-name matches already chosen.
3. **Unreadable values are staged as typed** (cut to 200 characters), not blanked, so the database names the problem (`date_bad`, `amount_bad`, ...) and the fix table shows what the file said. The spec said "left empty and not repeated". A decimal comma also gets `parse_amount_comma`.
4. **Performance and correctness fixes in the SQL** (draft kept its shape): one `import_row_key()` and one window query for occurrence numbers (linear, not quadratic, for 5,000 rows); the preview digest also fingerprints the association's units, accounts, funds, fiscal years, contractors and committed batches so a change since the preview makes the commit refuse (spec 3.2 says this, the draft digest did not do it); contractor duplicates are marked at validation; a co-owner next to a current owner is not an `owner_conflict`, and replacing owners keeps a co-owner the file lists; units are matched case-insensitively at commit; undo restores owner links that "replace" ended; `restrict_violation` (23001, what `on delete restrict` raises) is handled in undo; ownership shares count for rows already imported earlier so a re-upload can still set them; `by_account.exempt` is set for asset (capital) accounts; `import_create_account` stamps income classification as confirmed (the board answered it) and cannot overflow on odd account codes.
5. **`email_address_ok()` from 0055 is used as specified.** 0056 therefore applies after 0055 (as the spec's order says).
6. **Contractor trade:** staged `trade` is the shared trade list's label and a new `trade_slug` key carries the slug, which the commit stores in `vendors.trades` (the contractor form stores slugs there). Unknown trades are kept as typed.
7. **Document purge safety:** `DirectUpload` cannot set a title, so after upload the wizard titles the document `Import: <file>` (`markImportUpload`, only for a fresh, untouched, unlinked document) and the wizard removes only documents with that title. A file that was already in the Hub (identical bytes) is imported from but never removed.
8. **`BoardOnly` / `getViewer`:** the owner portal's `getViewer` and a `BoardOnly` component did not exist when this was written, so the wizard has its own small `BoardOnly` (`ui.tsx`) and `importViewer()` (`lib/import/server.ts`). Board members see the history read-only on the start page, as specified.
9. **Kept copy and cancel:** a copy the board chose to keep is referenced by the batch (`source_document_id`, on delete restrict), so cancelling an import leaves that copy in the Hub for the board to delete there. Without "keep", the file is already gone after staging.
10. **UTF-16 CSV:** the parser reads it (byte order mark), but the foundation's upload gate (`sniff`) rejects any file with NUL bytes, so a UTF-16 "Unicode Text" file cannot reach the parser through `DirectUpload`. Windows-1252 and UTF-8 with BOM work end to end.
11. **Row numbering:** `row_number` is the position among data rows (header excluded, blank rows skipped), as specified; the fix table says "Row N" and the start of the page explains nothing more. Blank rows are reported in the parse warnings for XLSX only.
12. **Undo copy:** the spec's "Undone. Nothing from this import is counted any more." is NOT shown. The tax views do not subtract reversals (Open issue 1), so the sentence would be false for the 60% and 90% figures. The page says "Undone. The entries are reversed, and both stay in the ledger history." Restore the spec's sentence once the views are fixed.
13. **Mapping step stores `_date_hint` and `_notes`** inside `import_batches.mapping` so the fix table normalises edits with the same date order and the preview can show the "removed a tax ID" note.

## Tests and commands (all run on 2026-10-14)

| Command | Result |
|---|---|
| `npx vitest run tests/db/imports.test.ts` | 50 passed |
| `npx vitest run tests/unit/import-*.test.ts` | passed (see combined line below) |
| `npx vitest run tests/db/migrations.test.ts tests/db/rls.test.ts` | passed, unchanged |
| `npx vitest run` (everything) | 204 files, 2,657 tests, all passed (exit 0). Focused run of `imports.test.ts`, `migrations.test.ts`, `rls.test.ts` and the `import-*` unit tests: 19 files, 263 tests, all passed. |
| `npx eslint src/lib/import src/app/building/import tests/unit/import-*.test.ts tests/db/imports.test.ts tests/fixtures/import` | clean |
| `npx tsc --noEmit` | no errors in any N1 file. It reports errors in other engineers' in-flight files only (`src/app/page.tsx`, `tests/db/email-reminders.test.ts`, `tests/unit/email-send-batch.test.ts`, `tests/unit/home-snapshot.test.ts` at the time of the run), which I did not touch. |
| `curl -s -o /dev/null -w "%{http_code}" http://localhost:3100/building/import` (also `/building/import/new?kind=transactions` and a template URL) | 307 (to sign-in) for all three; no 500. A signed-in browser check of the pages was not possible here (no test login), so the pages are covered by `import-render.test.ts` (server rendering of every component and preview with realistic props) instead. |

What the tests prove, in the spec's words: cross-association (a board admin of another association, every `import_*` function refused with 42501; accounts, funds, payees and documents of another association rejected); idempotent re-upload (same bytes refused with the earlier batch id, overlapping file adds only new rows, identical rows inside one file both import by occurrence number); balanced entries (trial balance debits equal credits after every commit, one unbalanced opening file refused with both totals); undo (every entry has one reversal partner and nets to zero, expenses removed, file hash free again, refused on a closed year, on a linked expense, on an applied payment, on a later ownership amendment); bad rows (all error codes in 7.1); ownership percentages (all or nothing, sum 100, conflict, skip, one amendment with a line per unit); locked/closed fiscal years (`fiscal_year_closed` at validation, `year_closed` at undo, `fiscal_year_missing`, `import_ensure_fiscal_year` rules); 1120-H effects (`cash_basis_receipts` and `form_1120h_figures` after a commit: exempt income, taxable income, exempt and total spending, liabilities neutral; an owner's payment on an imported opening balance traces to the chosen income account). Parsers are tested against generated CSV and XLSX including `=` `+` `-` `@` cells, a 2,500 character cell, 5,001 rows, 41 columns, hidden and merged cells, formulas with and without results, a forged zip central directory (61 MB, 301 entries), BOM, Windows-1252, UTF-16, and semicolon and tab delimiters.

## Integration tasks (not done by N1; exact files and text)

1. **`docs/DECISIONS.md`**: append the following as the next decision (the spec calls it #38; renumber if #35 to #37 are not yet taken):

   > ## 38. Imports: staged, validated in the database, committed through the ledger's own paths, undone by reversal
   >
   > Decided by the lead engineer on Doug's behalf, 2026-10-14. Units and owners, past transactions, opening balances and contractors can be imported from CSV or XLSX by a board admin. Only the columns the board maps are kept; the rest of the file never reaches the database. Every category must be mapped to an account by a person, a fund named in a file must be matched to a fund, and a new category must be declared exempt or not exempt with no default. Rows are staged, validated and committed by SECURITY DEFINER functions: expenses go through `record_expense`, other transactions through `post_journal_entry` with source `import`, unit receivables through `record_assessment_charge` crediting an income account the board chooses (so the 1120-H, which traces a payment to the income account its charge credited, still counts the cash), ownership through `record_ownership_amendment`. A file imports once; rows are hash-matched so overlapping files add only what is new; one opening balance at a time. Undo reverses the entries (#9) only while their fiscal years are open and refuses if anything now depends on them. The uploaded file is not kept in the Document Hub and is removed once its rows are staged, unless the board chooses to keep a copy. Optional AI mapping sees column names and character masks of sample values, never the values, and runs as the existing `document_classify` kind.

2. **`src/app/building/page.tsx`** (one link, board admins; re-read the file first): a small row near the top of the page, for example

   ```tsx
   {isBoardAdmin ? (
     <Link href="/building/import" className="...">Import from a spreadsheet</Link>
   ) : null}
   ```
   with the sentence `Bring in units, owners, transactions and opening balances.` The Units card empty state becomes `No units yet. Add them one at a time, or import a spreadsheet.` linking `/building/import`.

3. **`src/components/sidebar/config.tsx`**: add to `EXTRA_TITLES`, before the nav match: `{ prefix: "/building/import", label: "Import" },`. No new nav item.

4. **`src/lib/home/setup-guide.ts`** and **`tests/unit/setup-guide.test.ts`** (spec section 16): add `importBatches: { kind: string; status: string }[]` to `SetupInputs` (select `kind, status` from `import_batches`, board only). In section `building`, before `units`, an informational step `{ key: "import_units", name: "Import your units and owners (optional)", detail: committed ? "Imported from a spreadsheet." : "Faster than typing them one at a time.", href: "/building/import", done: importBatches.some(b => b.kind === "units_owners" && b.status === "committed"), doneOn: null, informational: true, instructions: ["On Building Info, open Import from a spreadsheet and download the template.", "Fill it in, upload it, check the preview, and import."] }`. In section `money`, before `bank`, informational `import_opening` ("Enter your opening balances (optional)", done when an `opening_accounts` batch is committed) and after `backlog` informational `import_history` ("Import last year's transactions (optional)", done when a `transactions` batch is committed). In the `vendors` step detail add `Or import them from a spreadsheet.` When `units.length === 0` the next-step hint becomes `Add your units, or import them from a spreadsheet.` Informational steps never block `isSetupComplete`.

5. **`src/lib/tour/steps.ts`**: `building.body` becomes `Units, owners, the board and the association's details. Import them from a spreadsheet, or invite the rest of the board from here.`

6. **`src/app/privacy/page.tsx`** and **`tests/unit/privacy-page.test.ts`**: in the Anthropic list add `Importing a spreadsheet. If your board asks for help matching columns, the column names and a character-by-character mask of a few sample cells (letters shown as x, digits as 9) are sent, never the values themselves.` In "What we collect": `Spreadsheets your board imports are read to create records and then removed, unless the board keeps a copy in the Document Hub.` Add an assertion on both lines.

7. **Empty states** (spec section 16): contractors list (`src/app/repairs/contractors-view.tsx` or wherever the empty state now lives) gets a link `Import contractors` to `/building/import/new?kind=contractors`; `src/app/dues/page.tsx` empty plan state: `Set each unit's dues, or import them with your units.` linking `/building/import`.

8. **`tests/e2e/app.spec.ts`** admin smoke: `/building/import` loads; downloading `/building/import/template/units-owners?format=csv` returns a file; an owner account gets the board-only message.

9. **`docs/SECURITY_POLICY.md`** (if it lists data flows): the import reads uploaded spreadsheets server-side with caps (5 MB, 5,000 rows, 40 columns, 2,000 characters a cell, zip central-directory check before unpacking), never evaluates formulas, and sends the AI only column names and masks.

10. **Dev/production**: apply 0056 to the dev project only after 0054 and 0055 (it uses 0055's `email_address_ok`); production waits for "General Kenobi".

## Open issues

1. **Reversals are not netted by the tax views (pre-existing, affects Undo).** `cash_basis_receipts` and `cash_basis_disbursements` (0006, redefined 0022) count the original entry and never look at `reverses_entry_id`. A reversal (Dr income, Cr cash) matches neither branch, so after an import is undone its income and spending still count toward the 60% and 90% tests and on `form_1120h_figures`. The same is true of the bank feed's `unpost_bank_transaction` (0036). The ledger itself nets to zero (tested). Proposed fix, in a new migration owned by the tax workstream: add `and e.reverses_entry_id is null and not exists (select 1 from public.journal_entries r where r.reverses_entry_id = e.id and r.is_posted)` to the `where e.is_posted` of both branches of both views, with a test that an undone import changes neither figure. Verified on 2026-10-14 with a scratch database: post a 100.00 deposit to an exempt income account, reverse it, and `form_1120h_figures` still reports `exempt_income 100.00`. Until the views are fixed an undone import still counts toward the tax tests, so Undo is safe for the ledger and statements but NOT yet for the Taxes page; the lead should decide whether to fix the views before "General Kenobi" or hide Undo for `transactions` batches until then.
2. **The existing Budget export writes typed text into cells unguarded** (`src/app/budget/export/route.ts` writes descriptions and categories with `ws.addRow`), so a bank description starting with `=` is a formula when opened in Excel. Outside N1's ownership; `safeCell`/`toXlsxCell` from `src/lib/import/safe-cell.ts` is ready to reuse. This is now more relevant because imported descriptions come from spreadsheets.
3. **UTF-16 text files cannot be uploaded** (see Deviation 10).
4. **Manual checks 14.3 not done** (they need a signed-in browser and real exports): the 12-unit Excel export with an SSN column and merged cells, a year of bank CSV with 40 categories, the first dues payment landing as exempt income after an opening balance, hostile files opened in Excel, phone layout. The pure and database halves of each are tested.
5. **Pages were not exercised in a browser** (no test login): `tsc`, eslint, server-rendering tests and 307s from curl only.
6. **Equal split needs every existing unit in the file.** `Split equally` refuses (with a sentence) when the building has units the file does not list, because a share cannot be placed on a row that does not exist.
7. **Percent-sign and fraction detection** is column-level and conservative: a column of values that are all at most 1 and add up to 1 (+/- 0.01) is read as fractions; a mix of small and large values that does not add up to 100 is reported rather than guessed.
8. `import_batches.source_document_id` keeps a "kept copy" tied to its batch; deleting that copy from the Hub is refused while the batch exists (23503 mapped by `purgeDocument` to its existing message).
