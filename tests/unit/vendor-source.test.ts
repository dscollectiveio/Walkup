import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  VENDOR_MANAGER_VIEW,
  VENDOR_TAX_COLUMNS,
  asksForTaxColumns,
  taxFlag,
  vendorColumns,
  vendorRows,
  vendorSource,
} from "@/lib/contractors/vendor-source";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIGRATION = readFileSync(path.join(ROOT, "supabase/migrations/0081_accountant_uploads_and_manager_view.sql"), "utf8");

describe("vendorSource", () => {
  it("the board and accountant read the table, everyone else the view", () => {
    expect(vendorSource(true)).toBe("vendors");
    expect(vendorSource(false)).toBe(VENDOR_MANAGER_VIEW);
    expect(VENDOR_MANAGER_VIEW).toBe("vendors_manager");
  });
});

describe("vendorColumns", () => {
  const LIST =
    "id, name, w9_on_file, is_1099_exempt, tin_last4, entity_type, w9_received_on, insured_until, rate_hourly::text, phone";

  it("leaves a financial reader's list alone", () => {
    expect(vendorColumns(LIST, true)).toBe(LIST);
  });

  it("drops exactly the five tax columns for anyone else, keeping the order of the rest", () => {
    expect(vendorColumns(LIST, false)).toBe("id, name, insured_until, rate_hourly::text, phone");
    for (const c of VENDOR_TAX_COLUMNS) expect(vendorColumns(c, false)).toBe("");
  });

  it("knows a cast or an alias is still the same column", () => {
    expect(vendorColumns("id, tin_last4::text, tax:w9_on_file, name", false)).toBe("id, name");
  });

  it("does not split an embed on the commas inside it", () => {
    expect(vendorColumns("id, tickets(id, reference), w9_on_file", false)).toBe("id, tickets(id, reference)");
  });

  it("does not drop a column whose name merely contains a tax column", () => {
    expect(vendorColumns("w9_on_file_note, id", false)).toBe("w9_on_file_note, id");
  });

  it("asksForTaxColumns says whether a list needs the table", () => {
    expect(asksForTaxColumns("id, name")).toBe(false);
    expect(asksForTaxColumns("id, name, tin_last4")).toBe(true);
    expect(asksForTaxColumns(vendorColumns(LIST, false))).toBe(false);
  });
});

describe("taxFlag", () => {
  it("is the real value for a financial reader and never 'missing' for anyone else", () => {
    expect(taxFlag(true, true)).toBe(true);
    expect(taxFlag(false, true)).toBe(false);
    expect(taxFlag(undefined, true)).toBe(false);
    expect(taxFlag(undefined, false)).toBe(true);
    expect(taxFlag(false, false)).toBe(true);
  });
});

describe("vendorRows", () => {
  it("is an array, whatever came back", () => {
    expect(vendorRows(null)).toEqual([]);
    expect(vendorRows(undefined)).toEqual([]);
    expect(vendorRows({ message: "x" })).toEqual([]);
    expect(vendorRows([{ id: "a" }])).toEqual([{ id: "a" }]);
  });
});

describe("the view in the migration", () => {
  const view = MIGRATION.slice(MIGRATION.indexOf("create or replace view public.vendors_manager"), MIGRATION.indexOf("revoke all on public.vendors_manager"));

  it("selects none of the tax columns", () => {
    expect(view.length).toBeGreaterThan(100);
    for (const c of VENDOR_TAX_COLUMNS) expect(view, c).not.toMatch(new RegExp(`\\bv\\.${c}\\b`));
  });

  it("is a security barrier view that checks the reader itself", () => {
    expect(view).toContain("security_barrier = true");
    expect(view).toContain("public.can_read_financials(v.association_id) or public.can_manage_repairs(v.association_id)");
  });

  it("narrows vendors_select to the financial readers", () => {
    expect(MIGRATION).toMatch(/create policy vendors_select on public\.vendors\s+for select to authenticated\s+using \(public\.can_read_financials\(association_id\)\);/);
  });
});

// A guard against the next page that reads `vendors` straight from the table for a property manager.
describe("who reads the vendors table in the app", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }
  const files = walk(path.join(ROOT, "src")).map((f) => path.relative(ROOT, f).split(path.sep).join("/"));

  // Every file that names the table, and why a property manager cannot reach it (or does not need to).
  const TABLE_READERS: Record<string, string> = {
    "src/app/page.tsx": "dashboard: board and accountant",
    "src/app/bank-feed/page.tsx": "bank feed: board and accountant",
    "src/app/repairs/bills-view.tsx": "bills: board and accountant",
    "src/app/tax/page.tsx": "taxes: board and accountant",
    "src/app/tax/forms/[formId]/page.tsx": "taxes: board and accountant",
    "src/app/tax/forms/[formId]/export/route.ts": "taxes: board and accountant",
    "src/app/bills/actions.ts": "bills: board",
    "src/app/building/import/[batchId]/page.tsx": "imports: board",
    "src/app/contractors/actions.ts": "writing to a contractor: board",
    "src/app/contractors/vendor-actions.ts": "editing a contractor: board",
    "src/app/repairs/find/page.tsx": "Find a Contractor: board",
    "src/app/repairs/find/actions.ts": "Find a Contractor: board",
    "src/app/repairs/problem-actions.ts": "W-9 box: board; the panel list goes through vendorSource",
    "src/app/repairs/problems-data.ts": "board and accountant embed; a manager's query has none",
    "src/app/repairs/contractors-view.tsx": "draft emails embed: board only",
    "src/app/maintenance/actions.ts": "payments embed: board only",
    "src/lib/contractors/recommend.ts": "Find a Contractor: board",
    "src/lib/contractors/found.ts": "Find a Contractor: board",
    "src/lib/contractors/vendor-source.ts": "the helper",
    "src/lib/contractors/vendor-names.ts": "the helper",
    "src/lib/home/setup-guide.ts": "dashboard checklist text",
    "src/app/documents/upload/link-targets.ts": "a table name in a list",
    "src/app/documents/upload/link-revalidate.ts": "a table name in a list",
    "src/app/contractors/[vendorId]/page.tsx": "text and the helper only",
  };

  it("only the listed files read from the table or embed it", () => {
    const reading = files.filter((f) => /\.from\(\s*["']vendors["']\s*\)|\bvendors\(|vendors!/.test(readFileSync(path.join(ROOT, f), "utf8")));
    const unknown = reading.filter((f) => !(f in TABLE_READERS));
    expect(unknown, "a new file reads the vendors table: a property manager cannot, so go through vendorSource() or vendors_manager").toEqual([]);
  });

  it("the pages a property manager reaches build their contractor reads through the helper", () => {
    const REACHED = [
      "src/app/repairs/page.tsx",
      "src/app/repairs/today-view.tsx",
      "src/app/repairs/upkeep-view.tsx",
      "src/app/repairs/upkeep/[taskId]/page.tsx",
      "src/app/repairs/contractors-view.tsx",
      "src/app/contractors/[vendorId]/page.tsx",
      "src/app/maintenance/[ticketId]/load.ts",
      "src/lib/repairs/page-data.ts",
    ];
    for (const f of REACHED) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      expect(src, f).toMatch(/vendorSource|VENDOR_MANAGER_VIEW/);
      expect(src, f).not.toMatch(/\.from\(\s*["']vendors["']\s*\)/);
    }
  });

  it("a manager's queries never ask the view for a tax column", () => {
    for (const f of files) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      for (const m of src.matchAll(/from\(\s*VENDOR_MANAGER_VIEW\s*\)\s*\.select\(\s*(["'`])([^"'`]*)\1/g)) {
        expect(asksForTaxColumns(m[2]), `${f}: ${m[2]}`).toBe(false);
      }
    }
  });
});
