import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { loadStatement } from "../../data";
import { FinancialStatementPdf } from "../../pdf-document";
import type { PeriodGrain, ViewMode } from "../../periods";

export const dynamic = "force-dynamic";

/**
 * PDF export, same data.ts loader as the page and the Excel export. This is
 * a plain download, not an attachment on an outbound email — Walkup has no
 * email-sending service (mailto: is the only "send" path anywhere in this
 * app, by design), and mailto: can't carry a binary attachment. The page's
 * "Draft email" button tells the board admin to attach this file by hand.
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

  const title = view === "total" ? "Profit & Loss" : "Expenses";
  const buffer = await renderToBuffer(
    <FinancialStatementPdf
      associationName={statement.association.display_name}
      view={view}
      statement={statement}
    />,
  );

  const filename = `${statement.association.display_name} — ${title} — ${statement.bounds.label}.pdf`.replace(
    /[/\\?%*:|"<>]/g,
    "-",
  );

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
