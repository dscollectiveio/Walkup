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
  const yearEnd = params.get("pack") === "year-end";

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
    { header: "Account", key: "account", width: 36 },
    { header: "Amount", key: "amount", width: 16 },
  ];

  sheet.mergeCells("A1:B1");
  sheet.getCell("A1").value = association.display_name;
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.mergeCells("A2:B2");
  sheet.getCell("A2").value = `${title} — ${bounds.label}`;
  sheet.getCell("A2").font = { size: 11, color: { argb: "FF6E7385" } };
  sheet.addRow([]);

  const headerRow = sheet.addRow(["Account", "Amount"]);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.border = { bottom: { style: "thin", color: { argb: "FFDCD8CF" } } };
  });

  const moneyFormat = '"$"#,##0.00;[Red]-"$"#,##0.00';
  const addSection = (label: string, rows: typeof incomeRows, total: number, totalLabel: string) => {
    const sectionRow = sheet.addRow([label]);
    sectionRow.font = { bold: true, color: { argb: "FF6E7385" } };
    for (const r of rows) {
      const row = sheet.addRow([r.account_name, r.amount]);
      row.getCell(2).numFmt = moneyFormat;
    }
    const totalRow = sheet.addRow([totalLabel, total]);
    totalRow.font = { bold: true };
    totalRow.getCell(2).numFmt = moneyFormat;
  };

  if (view === "total") {
    addSection("Income", incomeRows, totalIncome, "Total income");
    addSection("Expenses", expenseRows, totalExpenses, "Total expenses");
    const netRow = sheet.addRow(["Net income", netIncome]);
    netRow.font = { bold: true, size: 12 };
    netRow.getCell(2).numFmt = moneyFormat;
    netRow.eachCell((cell) => {
      cell.border = { top: { style: "medium", color: { argb: "FFC9C4B8" } } };
    });
  } else {
    addSection("Expenses", expenseRows, totalExpenses, "Total expenses");
  }

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

      const tbSheet = workbook.addWorksheet("Trial balance");
      tbSheet.columns = [
        { header: "Code", key: "code", width: 10 },
        { header: "Account", key: "name", width: 36 },
        { header: "Type", key: "type", width: 12 },
        { header: "Debits", key: "debit", width: 16 },
        { header: "Credits", key: "credit", width: 16 },
        { header: "Net (debit +)", key: "net", width: 16 },
      ];
      tbSheet.getRow(1).font = { bold: true };
      const byCode = new Map<string, { code: string; name: string; type: string; debit: number; credit: number; net: number }>();
      for (const r of tb ?? []) {
        const row = byCode.get(r.code) ?? { code: r.code, name: r.name, type: r.type, debit: 0, credit: 0, net: 0 };
        row.debit += Number(r.total_debit);
        row.credit += Number(r.total_credit);
        row.net += Number(r.net_debit);
        byCode.set(r.code, row);
      }
      for (const row of byCode.values()) {
        const added = tbSheet.addRow(row);
        for (const c of [4, 5, 6]) added.getCell(c).numFmt = moneyFormat;
      }
      const totals = [...byCode.values()].reduce(
        (acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }),
        { debit: 0, credit: 0 },
      );
      const totalRow = tbSheet.addRow({ name: "Totals", debit: totals.debit, credit: totals.credit, net: totals.debit - totals.credit });
      totalRow.font = { bold: true };
      for (const c of [4, 5, 6]) totalRow.getCell(c).numFmt = moneyFormat;

      const glSheet = workbook.addWorksheet("General ledger");
      glSheet.columns = [
        { header: "Date", key: "date", width: 12 },
        { header: "Memo", key: "memo", width: 44 },
        { header: "Code", key: "code", width: 10 },
        { header: "Account", key: "account", width: 32 },
        { header: "Debit", key: "debit", width: 14 },
        { header: "Credit", key: "credit", width: 14 },
        { header: "Source", key: "source", width: 12 },
      ];
      glSheet.getRow(1).font = { bold: true };
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
        const added = glSheet.addRow({
          date: l.entry.entry_date,
          memo: l.entry.memo ?? l.line_memo ?? "",
          code: l.account.code,
          account: l.account.name,
          debit: Number(l.debit) || null,
          credit: Number(l.credit) || null,
          source: l.entry.source,
        });
        added.getCell(5).numFmt = moneyFormat;
        added.getCell(6).numFmt = moneyFormat;
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${association.display_name} — ${yearEnd ? "Year-end package" : title} — ${bounds.label}.xlsx`.replace(/[/\\?%*:|"<>]/g, "-");

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "-")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
