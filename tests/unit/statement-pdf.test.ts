import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { renderToBuffer } from "@react-pdf/renderer";
import { FIRST_PAGE_ROWS, NEXT_PAGE_ROWS, OwnerStatementPdf, paginate, pdfText } from "@/lib/statements/pdf-document";
import { LateFeeLetterPdf } from "@/lib/statements/late-fee-letter";
import { totalsOf } from "@/lib/statements/summary";
import type { StatementData } from "@/lib/statements/data";
import type { StatementLine } from "@/lib/owner/statement";
import { fromCents } from "@/lib/tax/form1120h";

function line(seq: number, kind: StatementLine["kind"], desc: string, charge: string | null, payment: string | null, balance: string): StatementLine {
  return { seq, line_date: `2026-0${(seq % 9) + 1}-05`, kind, description: desc, charge, payment, adjustment: kind === "waiver" ? "25.00" : null, balance, charge_id: null, payment_id: null };
}

function data(lines: StatementLine[], over: Partial<StatementData> = {}): StatementData {
  return {
    associationName: "2158 N. Damen", unit: { id: "u1", label: "Unit 1" }, ownerNames: ["Ada Okonkwo"], mailingAddress: "12 Elm St\nChicago, IL 60601",
    from: "2026-01-01", to: "2026-09-30", generatedOn: "2026-10-14", allHistory: false, lines, totals: totalsOf(lines),
    position: { owed: "0.00", overdue: "0.00", credit: "0.00", net: "0.00" }, paymentNote: "To pay, sign in to Walkup and open How to pay.", ...over,
  };
}

const head = (b: Uint8Array) => Buffer.from(b).subarray(0, 5).toString("latin1");

describe("OwnerStatementPdf", () => {
  it("renders an empty period to a PDF", async () => {
    const buf = await renderToBuffer(OwnerStatementPdf({ data: data([]), annual: false }));
    expect(head(buf)).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("renders one line, an opening balance and a waiver", async () => {
    const lines = [line(0, "opening", "Balance before this statement", null, null, "100.00"), line(1, "charge", "Dues for January 2026", "500.00", null, "600.00"), line(2, "waiver", "Charge waived: late fee", null, null, "575.00")];
    const buf = await renderToBuffer(OwnerStatementPdf({ data: data(lines), annual: false }));
    expect(head(buf)).toBe("%PDF-");
  });

  it("paginates 120 lines onto several pages", async () => {
    const lines = Array.from({ length: 120 }, (_, i) => line(i + 1, "charge", `Dues for month ${i + 1}`, "10.00", null, fromCents((i + 1) * 1000)));
    const buf = await renderToBuffer(OwnerStatementPdf({ data: data(lines), annual: false }));
    expect(head(buf)).toBe("%PDF-");
    const pages = (Buffer.from(buf).toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(4);
  });

  it("renders a negative closing balance and an annual statement", async () => {
    const lines = [line(1, "payment", "Payment received by check", null, "50.00", "-50.00")];
    const buf = await renderToBuffer(OwnerStatementPdf({ data: data(lines, { from: "2025-01-01", to: "2025-12-31" }), annual: true }));
    expect(head(buf)).toBe("%PDF-");
  });

  it("copes with accents, markup and very long text in names and descriptions", async () => {
    const lines = [line(1, "charge", `<b>${"Dues ".repeat(40)}</b> café — “quoted” 中文`, "10.00", null, "10.00")];
    const buf = await renderToBuffer(OwnerStatementPdf({ data: data(lines, { ownerNames: ["Björn Müller", "中文"] }), annual: false }));
    expect(head(buf)).toBe("%PDF-");
  });

  it("renders the late fee letter", async () => {
    const buf = await renderToBuffer(
      LateFeeLetterPdf({ data: { associationName: "2158 N. Damen", boardContact: { name: "Cy Ferreira", email: "board@example.test", phone: null }, ownerName: "Bo Lindqvist", mailingAddress: "9 Oak St", unitLabel: "Unit 2", feeAmount: "25.00", feeChargedOn: "2026-02-15", owed: "775.00", generatedOn: "2026-10-14" } }),
    );
    expect(head(buf)).toBe("%PDF-");
  });
});

describe("paginate", () => {
  it("puts the first rows on a short first page, the rest on full pages, and decides where the box goes", () => {
    expect(paginate([]).pages).toEqual([[]]);
    const one = paginate([1]);
    expect(one.pages).toEqual([[1]]);
    expect(one.boxOnOwnPage).toBe(false);
    const full = paginate(Array.from({ length: FIRST_PAGE_ROWS }, (_, i) => i));
    expect(full.pages).toHaveLength(1);
    expect(full.boxOnOwnPage).toBe(true);
    const many = paginate(Array.from({ length: FIRST_PAGE_ROWS + NEXT_PAGE_ROWS + 3 }, (_, i) => i));
    expect(many.pages.map((p) => p.length)).toEqual([FIRST_PAGE_ROWS, NEXT_PAGE_ROWS, 3]);
    expect(many.boxOnOwnPage).toBe(false);
  });
});

describe("pdfText", () => {
  it("folds characters the core font cannot draw", () => {
    expect(pdfText("“x” — y 中")).toBe('"x" - y ?');
    expect(pdfText("café")).toBe("café");
  });
});
