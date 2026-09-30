import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { parsePeriod, resolvePeriod } from "@/lib/money/period";
import { isNeedsCategory, loadTransactions } from "../transactions";

export const dynamic = "force-dynamic";

/**
 * The Budget & spending transactions table as a spreadsheet, for the same
 * period, category and search as the page — built from the same loader, so
 * the file can't disagree with the screen. Route handlers don't inherit the
 * page's access check, so it's repeated here.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const supabase = await createClient();

  const { data: associations } = await supabase.from("associations").select("id, display_name").limit(1);
  const association = associations?.[0];
  if (!association) return NextResponse.json({ error: "No association is visible to you." }, { status: 403 });
  const { data: canRead } = await supabase.rpc("can_read_financials", { assoc: association.id });
  if (canRead !== true) return NextResponse.json({ error: "Board members and the accountant only." }, { status: 403 });

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const { data: fiscalYears } = await supabase
    .from("fiscal_years")
    .select("label, starts_on, ends_on")
    .order("starts_on", { ascending: false });
  const fy = (fiscalYears ?? []).find((f) => f.starts_on <= todayIso && f.ends_on >= todayIso) ?? fiscalYears?.[0];
  if (!fy) return NextResponse.json({ error: "No fiscal year is set up yet." }, { status: 404 });

  const period = resolvePeriod(parsePeriod(sp.get("period") ?? undefined), fy, today);
  const [tx, { data: accounts }, { data: units }] = await Promise.all([
    loadTransactions(supabase, {
      startDate: period.startDate,
      endDate: period.endDate,
      category: sp.get("cat") || null,
      query: sp.get("q") || null,
      limit: 5000,
    }),
    supabase.from("accounts").select("id, name"),
    supabase.from("units").select("id, label"),
  ]);
  const accountName = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const unitLabel = new Map((units ?? []).map((u) => [u.id, u.label]));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Transactions");
  ws.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Paid to / from", key: "desc", width: 42 },
    { header: "Category", key: "cat", width: 28 },
    { header: "Amount", key: "amount", width: 14, style: { numFmt: '"$"#,##0.00;[Red]-"$"#,##0.00' } },
    { header: "Status", key: "status", width: 16 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const t of [...tx.needs, ...tx.rows]) {
    const category = isNeedsCategory(t)
      ? "Needs a category"
      : t.posting_kind === "dues"
        ? `Dues${t.matched_unit_id ? ` · ${unitLabel.get(t.matched_unit_id) ?? ""}` : ""}`
        : t.posting_kind === "transfer"
          ? "Moved between accounts"
          : t.excluded_at
            ? "Not for the books"
            : (accountName.get(t.account_id ?? "") ?? "");
    ws.addRow({
      date: t.posted_on,
      desc: t.description,
      cat: category,
      amount: t.amount,
      status: t.journal_entry_id ? "In the books" : t.pending ? "Pending" : isNeedsCategory(t) ? "Needs a category" : "Not posted",
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `${association.display_name} transactions ${period.startDate} to ${period.endDate}.xlsx`.replace(
    /[/\\?%*:|"<>]/g,
    "-",
  );
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
