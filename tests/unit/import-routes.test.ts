import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

const viewer = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/import/server", () => ({ importViewer: async () => viewer.value }));

import { GET as getTemplate } from "@/app/building/import/template/[kind]/route";
import { GET as getErrors } from "@/app/building/import/[batchId]/errors.csv/route";

const BATCH = "33333333-3333-4333-8333-333333333333";

function supa(tables: Record<string, unknown[]>) {
  const b = (table: string) => {
    const o: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "order", "limit", "range"]) o[m] = () => o;
    o.then = (r: (v: unknown) => void) => r({ data: tables[table] ?? [], error: null });
    return o;
  };
  return { from: (t: string) => b(t) };
}
const req = (url: string) => ({ nextUrl: new URL(url) }) as never;

describe("template route", () => {
  beforeEach(() => {
    viewer.value = { supabase: supa({ funds: [{ name: "Operating" }], units: [{ label: "Unit 1" }], accounts: [{ code: "1000", name: "Operating Cash" }, { code: "1200", name: "Assessments Receivable" }] }), associationId: "a", role: "board_admin" };
  });

  it("serves a CSV with safe headers", async () => {
    const res = await getTemplate(req("http://x/building/import/template/units-owners?format=csv"), { params: Promise.resolve({ kind: "units-owners" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="walkup-units-and-owners.csv"');
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: false }).decode(bytes).startsWith("Unit,Owner name")).toBe(true);
  });

  it("serves an XLSX whose dropdowns come from the building", async () => {
    const res = await getTemplate(req("http://x/t/opening-accounts?format=xlsx"), { params: Promise.resolve({ kind: "opening-accounts" }) });
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(expect.arrayContaining(["Read me", "Account balances", "Unit balances"]));
    const lists = wb.getWorksheet("Lists")!;
    expect(String(lists.getCell("C1").value)).toBe("Operating Cash");
    expect(lists.getCell("C2").value).toBeNull(); // the receivable is never offered
  });

  it("is board admin only, with a plain JSON answer", async () => {
    for (const role of ["board_member", "other", "none"]) {
      viewer.value = { supabase: supa({}), associationId: "a", role };
      const res = await getTemplate(req("http://x/t/units-owners"), { params: Promise.resolve({ kind: "units-owners" }) });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Importing is for board admins." });
    }
    viewer.value = { supabase: supa({}), associationId: null, role: "none" };
    expect((await getTemplate(req("http://x/t/units-owners"), { params: Promise.resolve({ kind: "units-owners" }) })).status).toBe(403);
  });

  it("404s an unknown template", async () => {
    const res = await getTemplate(req("http://x/t/payroll"), { params: Promise.resolve({ kind: "payroll" }) });
    expect(res.status).toBe(404);
  });
});

describe("errors.csv route", () => {
  it("writes the problem rows in template order with a problem column, and neutralises formulas", async () => {
    viewer.value = {
      supabase: supa({
        import_batches: [{ id: BATCH, kind: "transactions", filename: "bank.csv" }],
        import_rows: [
          { row_number: 3, mapped: { date: "banana", description: "=HYPERLINK(\"http://evil\",\"x\")", amount: "-450.00", category_key: "+cmd", payee: "@SUM(A1)" }, errors: [{ message: "The date is missing or not a real date." }, { message: "Choose which of your accounts \"+cmd\" belongs to." }] },
        ],
      }),
      associationId: "a",
      role: "board_admin",
    };
    const res = await getErrors(req(`http://x/building/import/${BATCH}/errors.csv`), { params: Promise.resolve({ batchId: BATCH }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="walkup-import-problems.csv"');
    const lines = (await res.text()).replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Row,Date,Description,Amount,Payee,Category,Fund,Unit,Problem");
    // Every cell that would be a formula starts with a quote instead; a plain negative number is left alone.
    expect(lines[1]).toContain("'=HYPERLINK");
    expect(lines[1]).toContain(",'@SUM(A1),'+cmd,");
    expect(lines[1]).toContain(",-450.00,");
    expect(lines[1].startsWith("3,banana,")).toBe(true);
    for (const cell of lines[1].split(",")) expect(cell).not.toMatch(/^[=+@]/);
  });

  it("is board admin only and rejects a malformed id", async () => {
    viewer.value = { supabase: supa({}), associationId: "a", role: "board_member" };
    expect((await getErrors(req("http://x/e"), { params: Promise.resolve({ batchId: BATCH }) })).status).toBe(403);
    viewer.value = { supabase: supa({}), associationId: "a", role: "board_admin" };
    expect((await getErrors(req("http://x/e"), { params: Promise.resolve({ batchId: "../../etc" }) })).status).toBe(404);
    expect((await getErrors(req("http://x/e"), { params: Promise.resolve({ batchId: BATCH }) })).status).toBe(404);
  });
});
