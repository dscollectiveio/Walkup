import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { loadStatement } from "../data";
import type { PeriodGrain, ViewMode } from "../periods";

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

  const supabase = await createClient();
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
  const sheet = workbook.addWorksheet(bounds.label.slice(0, 31) || "Statement");

  sheet.columns = [
    { header: "Code", key: "code", width: 10 },
    { header: "Account", key: "account", width: 36 },
    { header: "Amount", key: "amount", width: 16 },
  ];

  sheet.mergeCells("A1:C1");
  sheet.getCell("A1").value = association.display_name;
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.mergeCells("A2:C2");
  sheet.getCell("A2").value = `${title} — ${bounds.label}`;
  sheet.getCell("A2").font = { size: 11, color: { argb: "FF6E7385" } };
  sheet.addRow([]);

  const headerRow = sheet.addRow(["Code", "Account", "Amount"]);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.border = { bottom: { style: "thin", color: { argb: "FFDCD8CF" } } };
  });

  const moneyFormat = '"$"#,##0.00;[Red]-"$"#,##0.00';
  const addSection = (label: string, rows: typeof incomeRows, total: number, totalLabel: string) => {
    const sectionRow = sheet.addRow([label]);
    sectionRow.font = { bold: true, color: { argb: "FF6E7385" } };
    for (const r of rows) {
      const row = sheet.addRow([r.code, r.account_name, r.amount]);
      row.getCell(3).numFmt = moneyFormat;
    }
    const totalRow = sheet.addRow(["", totalLabel, total]);
    totalRow.font = { bold: true };
    totalRow.getCell(3).numFmt = moneyFormat;
  };

  if (view === "total") {
    addSection("Income", incomeRows, totalIncome, "Total income");
    addSection("Expenses", expenseRows, totalExpenses, "Total expenses");
    const netRow = sheet.addRow(["", "Net income", netIncome]);
    netRow.font = { bold: true, size: 12 };
    netRow.getCell(3).numFmt = moneyFormat;
    netRow.eachCell((cell) => {
      cell.border = { top: { style: "medium", color: { argb: "FFC9C4B8" } } };
    });
  } else {
    addSection("Expenses", expenseRows, totalExpenses, "Total expenses");
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${association.display_name} — ${title} — ${bounds.label}.xlsx`.replace(/[/\\?%*:|"<>]/g, "-");

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
