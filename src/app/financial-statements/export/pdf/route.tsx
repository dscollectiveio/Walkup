import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { FinancialStatementPdf } from "../../pdf-document";
import { buildReport, loadForReport } from "../../report";
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
  const loaded = await loadForReport(supabase, { periods: params.get("periods"), period, offset });
  if (loaded === "restricted") {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const report = buildReport(loaded);
  if (!report) {
    return NextResponse.json({ error: "No fiscal year is set up yet." }, { status: 404 });
  }

  const title = view === "total" ? "Profit & Loss" : "Expenses";
  const buffer = await renderToBuffer(<FinancialStatementPdf report={report} view={view} />);

  const filename = `${report.associationName} - ${title} - ${report.rangeLabel}.pdf`.replace(/[/\\?%*:|"<>]/g, "-");
  // HTTP headers must be plain ASCII (an em dash in a header throws and the download 500s),
  // so send an ASCII fallback plus the real name in the RFC 5987 form.
  const asciiName = filename.replace(/[^\x20-\x7e]/g, "-");

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
