import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  redirect: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown } & Record<string, unknown>) => h("a", { href, ...rest }, children as never),
}));
// The actions pull in the Supabase server client; the render never calls them.
vi.mock("@/app/building/import/actions", () => {
  const fn = async () => ({ error: "not in a render test" });
  return {
    startImport: fn, saveImportOptions: fn, fixImportRow: fn, setRowDecision: fn, skipProblemRows: fn, createImportCategory: fn,
    ensureFiscalYear: fn, commitImport: fn, undoImport: fn, cancelImport: fn, markImportUpload: fn, removeUnfinishedUpload: fn,
    suggestColumnMapping: fn, splitSharesEqually: fn, revalidateImport: fn,
  };
});
vi.mock("@/components/upload/direct-upload", () => ({ DirectUpload: () => h("div", { "data-testid": "direct-upload" }) }));
vi.mock("@/app/building/invite-to-sign-in", () => ({ InviteToSignIn: () => h("div", null, "invite") }));

import { Preview } from "@/app/building/import/[batchId]/preview";
import { OptionsPanel, type OptionsPanelProps, type PanelAccount } from "@/app/building/import/[batchId]/options-panel";
import { FixTable, type FixRow } from "@/app/building/import/[batchId]/fix-table";
import { CommitBar } from "@/app/building/import/[batchId]/commit-bar";
import { DoneActions } from "@/app/building/import/[batchId]/done-actions";
import { InviteList } from "@/app/building/import/[batchId]/invite-list";
import { Steps } from "@/app/building/import/[batchId]/steps";
import { History } from "@/app/building/import/history";
import { StartCards } from "@/app/building/import/start-cards";
import { Unfinished } from "@/app/building/import/unfinished";
import { MappingStep } from "@/app/building/import/new/mapping-step";
import { UploadStep } from "@/app/building/import/new/upload-step";
import { RemoveAndRetry } from "@/app/building/import/new/remove-and-retry";
import { BoardOnly } from "@/app/building/import/ui";
import { detectColumns } from "@/lib/import/columns";
import { IMPORT_KINDS, type ImportKind } from "@/lib/import/kinds";
import type { ImportSummary } from "@/lib/import/types";

const html = (el: ReactElement) => renderToStaticMarkup(el);

const ACCOUNTS: PanelAccount[] = [
  { id: "a1", code: "1000", name: "Operating Cash", type: "asset", is_cash_account: true, is_active: true, is_exempt_function_income: null, is_exempt_expenditure: null },
  { id: "a2", code: "1200", name: "Assessments Receivable", type: "asset", is_cash_account: false, is_active: true, is_exempt_function_income: null, is_exempt_expenditure: null },
  { id: "a3", code: "4000", name: "Regular Assessments", type: "income", is_cash_account: false, is_active: true, is_exempt_function_income: true, is_exempt_expenditure: null },
  { id: "a4", code: "5020", name: "Repairs & Maintenance", type: "expense", is_cash_account: false, is_active: true, is_exempt_function_income: null, is_exempt_expenditure: true },
];
const FUNDS = [{ id: "f1", name: "Operating", kind: "operating" }, { id: "f2", name: "Reserve", kind: "reserve" }];

const SUMMARY: ImportSummary = {
  counts: { rows: 4, ok: 2, errors: 1, duplicates: 1, skipped: 0 },
  batch_errors: [{ field: "balance", code: "unbalanced", message: "Debits are 5000.00 and credits are 4000.00. They must be equal." }],
  digest: "a".repeat(64),
  money_in: "350.00", money_out: "450.00", debits: "5000.00", credits: "4000.00", unit_total: "900.00",
  by_account: { a4: { account: "5020 Repairs & Maintenance", type: "expense", exempt: true, count: 1, total: "450.00" } },
  new_units: 1, existing_units: 2, new_people: 1, owners_assigned: 2, dues_plans: 1, dues_plans_skipped_no_fund: 0, percent_total: "100",
};

describe("pages render without throwing", () => {
  it("start page pieces", () => {
    const cards = html(h(StartCards));
    expect(cards).toContain("Units and owners");
    expect(cards).toContain("/building/import/template/units-owners?format=xlsx");
    expect(html(h(History, { rows: [], canUndo: true }))).toContain("Nothing imported yet.");
    const past = html(
      h(History, {
        canUndo: true,
        rows: [{ id: "b1", kind: "transactions", filename: "bank.csv", status: "committed", rowCount: 10, created: 9, who: "Cy", when: "2026-10-01T10:00:00Z" }],
      }),
    );
    expect(past).toContain("Undo");
    expect(past).toContain("bank.csv");
    expect(html(h(Unfinished, { batches: [{ id: "b", kind: "units_owners", filename: "u.csv", when: "2026-10-01T10:00:00Z" }], uploads: [{ documentId: "d", filename: "t.csv", when: "2026-10-01T10:00:00Z" }] }))).toContain("Continue");
    expect(html(h(BoardOnly, { what: "Importing", why: "Only a board admin can bring in spreadsheets." }))).toContain("Back to Building Info");
  });

  it("upload and mapping steps", () => {
    expect(html(h(UploadStep, { kind: "transactions" }))).toContain("Keep a copy of this file in the Document Hub (board only)");
    expect(html(h(RemoveAndRetry, { documentId: "d", kind: "transactions" }))).toContain("Remove this file and upload another");
    const headers = ["Date", "Description", "Amount", "SSN", "Category"];
    const rows = [["3/14/2026", "Boiler", "-450.00", "123-45-6789", "Repairs"]];
    const d = detectColumns("transactions", headers, rows);
    const out = html(
      h(MappingStep, {
        kind: "transactions", documentId: "d", filename: "bank.csv", rowCount: 1,
        columns: headers.map((header, index) => ({ index, header, sensitive: index === 3, samples: index === 3 ? [] : [rows[0][index]] })),
        detected: d.detected.map((x) => ({ field: x.field, index: x.index, score: x.score, reason: x.reason })),
        initialMapping: d.mapping, keepCopyDefault: false, aiAvailable: false, warnings: ["Read 1 row."],
      }),
    );
    expect(out).toContain("Match your columns");
    expect(out).toContain("Dates look like");
    expect(out).toContain("Not imported:");
    expect(out).toContain("left out on purpose (looks like a tax ID or account number)");
    expect(out).toContain("AI help isn’t available on this account. Match by hand.");
    // The sensitive column is not offered in any select, and its sample is nowhere on the page.
    expect(out).not.toContain("123-45-6789");
    expect(out.match(/<option[^>]*>SSN/g)).toBeNull();
  });

  for (const kind of IMPORT_KINDS) {
    it(`options panel: ${kind}`, () => {
      const props: OptionsPanelProps = {
        batchId: "b", kind, options: { as_of: "2025-12-31", account_map: { "repairs & maintenance": "a4" } },
        accounts: ACCOUNTS, funds: FUNDS, vendors: [{ id: "v1", name: "Acme Plumbing" }],
        categories: [{ key: "repairs & maintenance", sample: "Repairs & Maintenance", count: 2, totalIn: "0.00", totalOut: "450.00" }, { key: "mystery", sample: "Mystery", count: 1, totalIn: "5.00", totalOut: "0.00" }],
        fundValues: [{ key: "reserve", sample: "Reserve", count: 1 }], payeeValues: [{ key: "acme", sample: "Acme", count: 2 }],
        fiscalYears: [{ label: "2026", starts_on: "2026-01-01", ends_on: "2026-12-31", status: "open" }],
        hasDues: true, hasPercent: true, hasUnitColumn: true,
      };
      const out = html(h(OptionsPanel, props));
      if (kind === "transactions") {
        expect(out).toContain("Create a new category...");
        expect(out).toContain("I’ve checked that each category is matched to the right account.");
        expect(out).toContain("Counts toward the 90% spending test");
        expect(out).toContain("Matched by name");
        // Cash accounts and receivables are never offered as a category.
        expect(out).not.toMatch(/<option[^>]*value="a2"/);
        expect(out).toContain("Don’t link");
      }
      if (kind === "opening_units") expect(out).toContain("Income account");
      if (kind === "opening_accounts") expect(out).toContain("No fiscal year covers 2025-12-31. Add 2025 to import it.");
      if (kind === "units_owners") expect(out).toContain("Replace the current owner");
    });
  }

  it("fix table, commit bar, done actions, steps", () => {
    const rows: FixRow[] = [
      { id: "r1", rowNumber: 3, status: "error", decision: "import", mapped: { date: "banana", amount: "-450.00" }, raw: { date: "banana" }, errors: [{ field: "date", code: "date_bad", message: "The date is missing or not a real date." }, { field: "category", code: "category_unmapped", message: "Choose which of your accounts \"Mystery\" belongs to." }] },
      { id: "r2", rowNumber: 4, status: "ok", decision: "skip", mapped: { description: "Skipped" }, raw: null, errors: [] },
    ];
    const out = html(h(FixTable, { batchId: "b", kind: "transactions", rows, unitLabels: ["Unit 1"], problemCount: 1, tab: "fix" }));
    expect(out).toContain("Skip all 1 row with problems");
    expect(out).toContain("Your file says: banana");
    expect(out).toContain("Save fix");
    expect(out).toContain("Include again");
    expect(out).toContain("/building/import/b/errors.csv");
    expect(html(h(CommitBar, { batchId: "b", digest: "a".repeat(64), okCount: 2, hasBatchErrors: false, things: "rows" }))).toContain("Import 2 rows");
    expect(html(h(CommitBar, { batchId: "b", digest: "a".repeat(64), okCount: 1, hasBatchErrors: true, things: "rows" }))).toContain("Fix the problems at the top first.");
    const done = html(h(DoneActions, { batchId: "b", canUndo: true, links: [{ href: "/ledger", label: "See the trial balance" }] }));
    expect(done).toContain("Undo this import");
    expect(done).toContain("See the trial balance");
    expect(html(h(Steps, { batchId: "b", current: "fix", canJump: true }))).toContain("Fix problems");
    expect(html(h(InviteList, { people: [{ id: "p", full_name: "Dee Park", email: "dee@example.com" }], associationName: "A", boardContactName: null }))).toContain("Dee Park");
  });

  for (const kind of IMPORT_KINDS as readonly ImportKind[]) {
    it(`preview: ${kind}`, () => {
      const row = (n: number, mapped: Record<string, string>, status = "ok") => ({ row_number: n, mapped, status });
      const rows =
        kind === "transactions"
          ? [row(1, { date: "2026-03-14", description: "Boiler", amount: "-450.00", category_key: "Repairs", payee: "Acme" }), row(2, { date: "2026-03-15", description: "Dues, Unit 2", amount: "350.00", category_key: "Regular Assessments", unit_label: "Unit 2" })]
          : kind === "opening_accounts"
            ? [row(1, { account_key: "1000", fund_key: "Operating", debit: "5000.00" }), row(2, { account_key: "3000", fund_key: "Operating", credit: "4000.00" })]
            : kind === "opening_units"
              ? [row(1, { unit_label: "Unit 2", amount: "750.00" })]
              : kind === "units_owners"
                ? [row(1, { unit_label: "Unit 1", owner_name: "Ada", ownership_percent: "50" }), row(2, { unit_label: "Unit 2", owner_name: "Bo", ownership_percent: "50" }), row(3, { unit_label: "Unit 3" }, "skipped")]
                : [row(1, { name: "Acme", trade: "Plumbing" }), row(2, { name: "Old Co" }, "duplicate")];
      const out = html(
        h(Preview, {
          kind, summary: SUMMARY, options: { cash_account_id: "a1", account_map: { repairs: "a4", "regular assessments": "a3" }, payee_map: { acme: "v1" }, as_of: "2025-12-31", income_account_id: "a3" },
          sample: rows.filter((r) => r.status === "ok"), rows, accounts: ACCOUNTS, funds: FUNDS, vendors: [{ id: "v1", name: "Acme Plumbing" }], fyLabel: "2025", notes: ["Removed a number that looked like a tax ID from 1 row."],
        }),
      );
      expect(out).toContain("Nothing is saved until you press Import. You can undo it afterwards.");
      expect(out).toContain("Debits are 5000.00 and credits are 4000.00. They must be equal.");
      if (kind === "transactions") {
        expect(out).toContain("Debit 5020 Repairs &amp; Maintenance");
        expect(out).toContain("Credit 1000 Operating Cash");
        expect(out).toContain("1 payment will count toward Acme Plumbing’s 1099 total.");
        expect(out).toContain("They don’t change what the unit owes now.");
      }
      if (kind === "opening_units") expect(out).toContain("Balance carried forward");
      if (kind === "contractors") expect(out).toContain("Already there");
    });
  }
});
