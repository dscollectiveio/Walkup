import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/email-outbox/actions-core";
import { safeFilename } from "@/lib/email-outbox/sanitize";
import { loadStatementData } from "@/lib/statements/data";
import { OwnerStatementPdf } from "@/lib/statements/pdf-document";
import { buildingTodayIso } from "@/lib/dates";
import { getViewer } from "@/lib/owner/viewer";
import { ALL_HISTORY_FROM, isAnnual, isValidIso, parsePeriod, rangeLabel } from "@/lib/statements/period";

export const dynamic = "force-dynamic";

/**
 * A unit's statement as a PDF (money spec 8.6). Read through the caller's own
 * session: unit_statement() answers a financial reader (any unit) or the
 * unit's owner (that unit) and nobody else, so a stranger and a unit that does
 * not exist look the same: 403.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await context.params;
  const sp = request.nextUrl.searchParams;
  // No start date means all activity on record (the owner's "Everything" choice); no end date means today.
  const fromParam = sp.get("from") || null;
  const toParam = sp.get("to") || null;
  const allHistory = fromParam === null;
  const to = toParam ?? buildingTodayIso();
  const period = allHistory ? (isValidIso(to) ? { from: ALL_HISTORY_FROM, to } : null) : parsePeriod(fromParam, to);
  if (!isUuid(unitId) || !period) {
    return NextResponse.json({ error: "Choose a start and end date, with the end on or after the start." }, { status: 400 });
  }

  const supabase = await createClient();
  // The accountant may read statements but not owners' mailing addresses (0082), so the PDF leaves the address out for them.
  const viewer = await getViewer();
  const data = await loadStatementData(supabase, unitId, period.from, period.to, {
    allHistory,
    skipAddresses: Boolean(viewer?.isStaff && !viewer.isBoard),
  });
  if (!data) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const annual = !allHistory && isAnnual(period.from, period.to);
  const buffer = await renderToBuffer(OwnerStatementPdf({ data, annual }));
  const filename = `${safeFilename(`${annual ? "Annual statement" : "Statement"} ${data.unit.label} ${rangeLabel(period.from, period.to, allHistory)}`)}.pdf`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
