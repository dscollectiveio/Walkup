import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseImportFile } from "@/lib/import/parse-file";
import { detectColumns } from "@/lib/import/columns";
import { buildStagedRows } from "@/lib/import/stage";
import type { ParsedFile } from "@/lib/import/types";
import { unitsCsvWithSsn, utf8 } from "../fixtures/import/build";

function file(headers: string[], rows: string[][], issues: ParsedFile["issues"] = []): ParsedFile {
  return { kind: "csv", sheetName: null, headers, rows, rowCount: rows.length, sha256: "0".repeat(64), warnings: [], issues };
}

describe("buildStagedRows", () => {
  it("reads only the mapped columns: a fixture with an SSN and an account number never exposes them", async () => {
    const parsed = await parseImportFile(utf8(unitsCsvWithSsn()), "units.csv");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const d = detectColumns("units_owners", parsed.file.headers, parsed.file.rows);
    expect(d.unmapped.filter((u) => u.sensitive).map((u) => u.header)).toEqual(["SSN", "Bank account number"]);
    const { rows, notes } = buildStagedRows({ kind: "units_owners", file: parsed.file, mapping: d.mapping, dateHint: "mdy" });
    const json = JSON.stringify(rows);
    expect(json).not.toContain("123-45-6789");
    expect(json).not.toContain("987-65-4321");
    expect(json).not.toContain("000123456789");
    expect(rows[0].mapped).toEqual({ unit_label: "Unit 1", owner_name: "Ada Okonkwo", email: "ada@example.com", phone: "312-555-0142" });
    expect(rows[0].raw).toEqual({ unit_label: "Unit 1", owner_name: "Ada Okonkwo", email: "ada@example.com", phone: "312-555-0142" });
    expect(notes).toEqual([]);
  });

  it("even a hostile mapping that points at the SSN column only reads what it is told to", () => {
    // The page never offers a sensitive header; if a forged mapping named one, it would be read here,
    // which is why saveMapping (actions) drops sensitive columns before staging. This proves the unmapped path.
    const f = file(["Unit", "SSN"], [["Unit 1", "123-45-6789"]]);
    const { rows } = buildStagedRows({ kind: "units_owners", file: f, mapping: { unit_label: 0 }, dateHint: "mdy" });
    expect(Object.keys(rows[0].raw)).toEqual(["unit_label"]);
  });

  it("normalises transactions: dates, money, text, keys; every value is a string", () => {
    const f = file(
      ["Date", "Description", "Amount", "Payee", "Category", "Fund", "Unit"],
      [["3/14/2026", "  Boiler   repair ", "($450.5)", "Acme Plumbing", "Repairs", "Operating", "Unit 2"]],
    );
    const { rows } = buildStagedRows({
      kind: "transactions", file: f, dateHint: "mdy",
      mapping: { date: 0, description: 1, amount: 2, payee: 3, category_key: 4, fund_key: 5, unit_label: 6 },
    });
    expect(rows[0].mapped).toEqual({
      date: "2026-03-14", description: "Boiler repair", amount: "-450.50", payee: "Acme Plumbing", category_key: "Repairs", fund_key: "Operating", unit_label: "Unit 2",
    });
    expect(rows[0].raw.amount).toBe("($450.5)");
    for (const v of Object.values(rows[0].mapped)) expect(typeof v).toBe("string");
  });

  it("keeps an unreadable value as typed so the database can name it, and explains a decimal comma", () => {
    const f = file(["Date", "Description", "Amount", "Category"], [["banana", "x", "12,50", "Repairs"], ["3/14/2026", "y", "12.345", "Repairs"]]);
    const { rows } = buildStagedRows({ kind: "transactions", file: f, dateHint: "mdy", mapping: { date: 0, description: 1, amount: 2, category_key: 3 } });
    expect(rows[0].mapped.date).toBe("banana");
    expect(rows[0].mapped.amount).toBe("12,50");
    expect(rows[0].errors).toEqual([{ field: "amount", code: "parse_amount_comma", message: "That amount uses a comma for decimals. Change it to 1234.50." }]);
    expect(rows[1].mapped.amount).toBe("12.345");
    expect(rows[1].errors).toEqual([]);
  });

  it("combines deposit and withdrawal columns into one signed amount in cents", () => {
    const f = file(
      ["Date", "Memo", "Deposits", "Withdrawals", "Category"],
      [
        ["2026-03-01", "dues", "$350.00", "", "A"],
        ["2026-03-02", "repair", "", "450.10", "B"],
        ["2026-03-03", "both", "5.00", "2.00", "C"],
        ["2026-03-04", "zero deposit", "0.00", "7.25", "D"],
        ["2026-03-05", "neither", "", "", "E"],
        ["2026-03-06", "negative withdrawal", "", "-60.00", "F"],
        ["2026-03-07", "bad", "x", "", "G"],
      ],
    );
    const { rows } = buildStagedRows({ kind: "transactions", file: f, dateHint: "ymd", mapping: { date: 0, description: 1, money_in: 2, money_out: 3, category_key: 4 } });
    expect(rows.map((r) => r.mapped.amount)).toEqual(["350.00", "-450.10", undefined, "-7.25", undefined, "-60.00", "x"]);
    expect(rows[2].errors).toEqual([{ field: "amount", code: "parse_amount_conflict", message: "This row has both a deposit and a withdrawal." }]);
    for (const r of rows) {
      expect(r.mapped).not.toHaveProperty("money_in");
      expect(r.mapped).not.toHaveProperty("money_out");
    }
  });

  it("skips fully empty rows but keeps the file's row positions", () => {
    const f = file(["Unit", "Owner"], [["Unit 1", "Ada"], ["", ""], ["Unit 3", ""], ["  ", " "]]);
    const { rows } = buildStagedRows({ kind: "units_owners", file: f, dateHint: "mdy", mapping: { unit_label: 0, owner_name: 1 } });
    expect(rows.map((r) => r.row_number)).toEqual([1, 3]);
    expect(rows[1].mapped).toEqual({ unit_label: "Unit 3" });
  });

  it("removes tax-ID-like numbers from free text and says how many rows", () => {
    const f = file(["Unit", "Owner", "Notes"], [["Unit 1", "Ada 123-45-6789", ""], ["Unit 2", "Bo", ""], ["Unit 3", "Cy 12-3456789", ""]]);
    const { rows, notes } = buildStagedRows({ kind: "units_owners", file: f, dateHint: "mdy", mapping: { unit_label: 0, owner_name: 1 } });
    expect(rows[0].mapped.owner_name).toBe("Ada [redacted]");
    expect(rows[2].mapped.owner_name).toBe("Cy [redacted]");
    expect(notes).toEqual(["Removed a number that looked like a tax ID from 2 rows."]);
    const one = buildStagedRows({ kind: "units_owners", file: file(["Unit", "Owner"], [["U", "A 123456789"]]), dateHint: "mdy", mapping: { unit_label: 0, owner_name: 1 } });
    expect(one.notes).toEqual(["Removed a number that looked like a tax ID from 1 row."]);
  });

  it("treats the ownership column as a whole: fractions are multiplied, a mix is reported", () => {
    const f = file(["Unit", "Share"], [["A", "0.25"], ["B", "0.25"], ["C", "0.5"]]);
    const r = buildStagedRows({ kind: "units_owners", file: f, dateHint: "mdy", mapping: { unit_label: 0, ownership_percent: 1 } });
    expect(r.rows.map((x) => x.mapped.ownership_percent)).toEqual(["25", "25", "50"]);
    expect(r.notes).toEqual(["Ownership values were read as fractions of the whole and multiplied by 100."]);
    const mix = buildStagedRows({ kind: "units_owners", file: file(["Unit", "Share"], [["A", "0.25"], ["B", "40"], ["C", "35"]]), dateHint: "mdy", mapping: { unit_label: 0, ownership_percent: 1 } });
    expect(mix.notes).toContain("Some ownership values look like fractions and some like percents.");
    expect(mix.rows.map((x) => x.mapped.ownership_percent)).toEqual(["0.25", "40", "35"]);
  });

  it("picks the date order for a whole column when asked to detect it", () => {
    const f = file(["Date", "Memo", "Amount", "Cat"], [["13/2/2026", "a", "1", "x"], ["1/2/2026", "b", "1", "x"]]);
    const base = { kind: "transactions" as const, file: f, mapping: { date: 0, description: 1, amount: 2, category_key: 3 } };
    expect(buildStagedRows({ ...base, dateHint: "auto" }).rows.map((r) => r.mapped.date)).toEqual(["2026-02-13", "2026-02-01"]);
    expect(buildStagedRows({ ...base, dateHint: "mdy" }).rows.map((r) => r.mapped.date)).toEqual(["13/2/2026", "2026-01-02"]);
  });

  it("maps a trade to the shared list and keeps a stray one as typed", () => {
    const f = file(["Name", "Trade", "Email"], [["Acme", "plumber", "SAM@ACME.EXAMPLE"], ["Piano Co", "Piano Tuning", ""]]);
    const { rows } = buildStagedRows({ kind: "contractors", file: f, dateHint: "mdy", mapping: { name: 0, trade: 1, email: 2 } });
    expect(rows[0].mapped).toEqual({ name: "Acme", trade: "Plumbing", trade_slug: "plumbing", email: "sam@acme.example" });
    expect(rows[1].mapped).toEqual({ name: "Piano Co", trade: "Piano Tuning", trade_slug: "piano tuning" });
  });

  it("carries the parser's problems onto the row only when the column was mapped", () => {
    const f = file(["Unit", "Notes", "Memo"], [["U1", "", ""], ["U2", "", ""]], [
      { row: 0, col: 2, code: "parse_formula", message: "formula" },
      { row: 1, col: 1, code: "parse_cell_long", message: "long" },
    ]);
    const { rows } = buildStagedRows({ kind: "contractors", file: { ...f, headers: ["Name", "Notes", "Trade"] }, dateHint: "mdy", mapping: { name: 0, trade: 2 } });
    expect(rows[0].errors).toEqual([{ field: "trade", code: "parse_formula", message: "formula" }]);
    expect(rows[1].errors).toEqual([]);
  });

  it("stages opening balance and unit balance files", () => {
    const a = buildStagedRows({ kind: "opening_accounts", file: file(["Account", "Fund", "Debit", "Credit"], [["1000", "Operating", "18,400.00", ""], ["3000", "Operating", "", "$18,400"]]), dateHint: "mdy", mapping: { account_key: 0, fund_key: 1, debit: 2, credit: 3 } });
    expect(a.rows.map((r) => r.mapped)).toEqual([
      { account_key: "1000", fund_key: "Operating", debit: "18400.00" },
      { account_key: "3000", fund_key: "Operating", credit: "18400.00" },
    ]);
    const u = buildStagedRows({ kind: "opening_units", file: file(["Unit", "Amount owed"], [["Unit 2", "750"]]), dateHint: "mdy", mapping: { unit_label: 0, amount: 1 } });
    expect(u.rows[0].mapped).toEqual({ unit_label: "Unit 2", amount: "750.00" });
  });
});
