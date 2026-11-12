import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { loadStatement } from "../data";
import { buildReport, lastColumn, lastColumnLabel, loadForReport, shownAmount } from "../report";
import type { PeriodGrain, ViewMode } from "../periods";
import { BRAND, banner, bottomRow, brandedSheet, footnote, headerRow, lineRow, preparedNote, sectionBand, totalRow } from "./excel-style";

export const dynamic = "force-dynamic";

/**
 * Excel export of exactly what the Financial Statements page shows for the
 * given view/period/offset — same data.ts loader the page itself uses, so
 * this can never drift from what's on screen. Route Handlers don't inherit
 * a page's access check, so loadStatement does its own (association lookup
 * + can_read_financials), matching every page.tsx's own convention.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const view: ViewMode = params.get("view") === "expenses" ? "expenses" : "total";
  const period: PeriodGrain =
    params.get("period") === "quarterly" ? "quarterly" : params.get("period") === "annual" ? "annual" : "monthly";
  const offset = Math.max(0, Math.trunc(Number(params.get("offset") ?? 0)) || 0);
  const yearEnd = params.get("pack") === "year-end";

  const supabase = await createClient();

  // Several periods chosen: one sheet, a column per period and a Total, the same figures the page shows.
  if ((params.get("periods") || params.get("from") || params.get("cmp")) && !yearEnd) {
    const loaded = await loadForReport(supabase, { query: params, period, offset });
    if (loaded === "restricted") return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    const report = buildReport(loaded.statements, { compare: loaded.compare, blank: loaded.blank });
    if (!report) return NextResponse.json({ error: "No fiscal year is set up yet." }, { status: 404 });

    const wb = new ExcelJS.Workbook();
    wb.creator = "Walkup";
    wb.created = new Date();
    const lastCol = report.labels.length + 2;
    const ws = brandedSheet(wb, "Profit & Loss", { landscape: report.labels.length > 3, freezeRow: 5 });
    ws.getColumn(1).width = 38;
    for (let c = 2; c <= lastCol; c++) ws.getColumn(c).width = 17;
    banner(ws, lastCol, report.associationName, `Profit & Loss  ·  ${report.rangeLabel}`);
    headerRow(ws.addRow(["Category", ...report.labels, lastColumnLabel(report)]), lastCol, 2);
    // A period with nothing posted is left blank, never zero; so is a difference that can't be worked out.
    const cellsFor = (amounts: number[]) => [...amounts.map((n, i) => shownAmount(report, i, n)), lastColumn(report, amounts)];
    const addBlock = (label: string, rows: typeof report.income, totals: number[], totalLabel: string) => {
      sectionBand(ws, lastCol, label);
      for (const r of rows) lineRow(ws.addRow([r.account_name, ...cellsFor(r.amounts)]), lastCol, 2, { tintLast: true });
      totalRow(ws.addRow([totalLabel, ...cellsFor(totals)]), lastCol, 2);
    };
    addBlock("Income", report.income, report.incomeTotals, "Total income");
    ws.addRow([]).height = 8;
    addBlock("Expenses", report.expenses, report.expenseTotals, "Total expenses");
    ws.addRow([]).height = 8;
    // The bottom line, worded like the page: Excess or Deficit (no minus sign). Comparisons show the signed difference.
    const netCells = cellsFor(report.netTotals);
    const overall = report.compare ? report.netTotals[0] : lastColumn(report, report.netTotals);
    const shownNet = netCells.map((v) => (v === null ? null : report.compare && v === netCells[netCells.length - 1] ? v : Math.abs(v)));
    const netRow = ws.addRow([(overall ?? 0) < 0 ? "Deficit" : "Excess", ...shownNet]);
    bottomRow(
      netRow,
      lastCol,
      2,
      netCells.map((v, i) => (v === null ? "plain" : report.compare && i === netCells.length - 1 ? "plain" : v < 0 ? "bad" : "good")),
    );
    footnote(ws, lastCol, preparedNote());
    const fname = `${report.associationName} - Profit & Loss - ${report.rangeLabel}.xlsx`.replace(/[/\\?%*:|"<>]/g, "-");
    return new NextResponse((await wb.xlsx.writeBuffer()) as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fname.replace(/[^\x20-\x7e]/g, "-")}"; filename*=UTF-8''${encodeURIComponent(fname)}`,
      },
    });
  }

  const statement = await loadStatement(supabase, view, period, offset);
  if ("restricted" in statement) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (!statement.bounds) {
    return NextResponse.json({ error: "No fiscal year is set up yet." }, { status: 404 });
  }

  const { association, bounds, incomeRows, expenseRows, totalIncome, totalExpenses, netIncome } =
    statement;
  const title = view === "total" ? "Profit & Loss" : "Expenses";

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Walkup";
  workbook.created = new Date();
  const sheet = brandedSheet(workbook, bounds.label || "Statement", { freezeRow: 5 });
  sheet.getColumn(1).width = 42;
  sheet.getColumn(2).width = 20;
  banner(sheet, 2, association.display_name, `${title}  ·  ${bounds.label}`);
  headerRow(sheet.addRow(["Category", "Amount"]), 2, 2);

  const addSection = (label: string, rows: typeof incomeRows, total: number, totalLabel: string) => {
    sectionBand(sheet, 2, label);
    for (const r of rows) lineRow(sheet.addRow([r.account_name, r.amount]), 2, 2, { tintLast: true });
    totalRow(sheet.addRow([totalLabel, total]), 2, 2);
  };

  if (view === "total") {
    addSection("Income", incomeRows, totalIncome, "Total income");
    sheet.addRow([]).height = 8;
    addSection("Expenses", expenseRows, totalExpenses, "Total expenses");
    sheet.addRow([]).height = 8;
    bottomRow(sheet.addRow([netIncome < 0 ? "Deficit" : "Excess", Math.abs(netIncome)]), 2, 2, [netIncome < 0 ? "bad" : "good"]);
  } else {
    addSection("Expenses", expenseRows, totalExpenses, "Total expenses");
  }
  footnote(sheet, 2, preparedNote());

  // Year-end package: the statement plus what an accountant asks for —
  // a trial balance and the general ledger for the fiscal year. Same RLS-
  // scoped views the app reads everywhere else; nothing new is computed.
  if (yearEnd) {
    const { data: fy } = await supabase
      .from("fiscal_years")
      .select("id, label, starts_on, ends_on")
      .eq("association_id", association.id)
      .eq("label", bounds.label)
      .limit(1);
    const fiscalYear = fy?.[0];
    if (fiscalYear) {
      const [{ data: tb }, { data: gl }] = await Promise.all([
        supabase
          .from("trial_balance")
          .select("code, name, type, total_debit, total_credit, net_debit")
          .eq("association_id", association.id)
          .eq("fiscal_year_id", fiscalYear.id)
          .order("code"),
        supabase
          .from("journal_lines")
          .select("debit, credit, line_memo, account:accounts!inner(code, name), entry:journal_entries!inner(entry_date, memo, source, is_posted)")
          .eq("association_id", association.id)
          .eq("entry.is_posted", true)
          .gte("entry.entry_date", fiscalYear.starts_on)
          .lte("entry.entry_date", fiscalYear.ends_on)
          .limit(10000),
      ]);

      const tbSheet = brandedSheet(workbook, "Trial balance", { landscape: true, freezeRow: 5, tab: BRAND.gold });
      [10, 36, 12, 16, 16, 16].forEach((w, i) => (tbSheet.getColumn(i + 1).width = w));
      banner(tbSheet, 6, association.display_name, `Trial balance  ·  ${bounds.label}`);
      headerRow(tbSheet.addRow(["Code", "Account", "Type", "Debits", "Credits", "Net (debit +)"]), 6, 4, { 1: "left", 2: "left", 3: "left" });
      const byCode = new Map<string, { code: string; name: string; type: string; debit: number; credit: number; net: number }>();
      for (const r of tb ?? []) {
        const row = byCode.get(r.code) ?? { code: r.code, name: r.name, type: r.type, debit: 0, credit: 0, net: 0 };
        row.debit += Number(r.total_debit);
        row.credit += Number(r.total_credit);
        row.net += Number(r.net_debit);
        byCode.set(r.code, row);
      }
      for (const row of byCode.values()) {
        lineRow(tbSheet.addRow([row.code, row.name, row.type.charAt(0).toUpperCase() + row.type.slice(1), row.debit, row.credit, row.net]), 6, 4, { tintLast: true });
      }
      const totals = [...byCode.values()].reduce(
        (acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }),
        { debit: 0, credit: 0 },
      );
      totalRow(tbSheet.addRow(["", "Totals", "", totals.debit, totals.credit, totals.debit - totals.credit]), 6, 4);
      footnote(tbSheet, 6, preparedNote());

      const glSheet = brandedSheet(workbook, "General ledger", { landscape: true, freezeRow: 5, tab: BRAND.gold });
      [14, 44, 10, 32, 15, 15, 12].forEach((w, i) => (glSheet.getColumn(i + 1).width = w));
      banner(glSheet, 7, association.display_name, `General ledger  ·  ${bounds.label}`);
      headerRow(glSheet.addRow(["Date", "Memo", "Code", "Account", "Debit", "Credit", "Source"]), 7, 5, { 1: "left", 2: "left", 3: "left", 4: "left", 7: "left" });
      type GlLine = {
        debit: string | number;
        credit: string | number;
        line_memo: string | null;
        account: { code: string; name: string } | { code: string; name: string }[];
        entry: { entry_date: string; memo: string | null; source: string } | { entry_date: string; memo: string | null; source: string }[];
      };
      const glRows = ((gl ?? []) as unknown as GlLine[])
        .map((l) => ({
          ...l,
          account: Array.isArray(l.account) ? l.account[0] : l.account,
          entry: Array.isArray(l.entry) ? l.entry[0] : l.entry,
        }))
        .sort((a, b) => a.entry.entry_date.localeCompare(b.entry.entry_date) || a.account.code.localeCompare(b.account.code));
      for (const l of glRows) {
        const added = glSheet.addRow([
          new Date(`${l.entry.entry_date}T00:00:00Z`),
          l.entry.memo ?? l.line_memo ?? "",
          l.account.code,
          l.account.name,
          Number(l.debit) || null,
          Number(l.credit) || null,
          l.entry.source,
        ]);
        lineRow(added, 7, 5, { money: [5, 6] });
        added.getCell(1).numFmt = "mmm d, yyyy";
        added.getCell(1).alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        for (const c of [2, 3, 4, 7]) added.getCell(c).alignment = { vertical: "middle", horizontal: "left" };
        
      }
      glSheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: 7 } };
      footnote(glSheet, 7, preparedNote());
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${association.display_name} - ${yearEnd ? "Year-end package" : title} - ${bounds.label}.xlsx`.replace(/[/\\?%*:|"<>]/g, "-");

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "-")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
