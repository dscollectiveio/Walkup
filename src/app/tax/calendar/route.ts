import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildCalendar } from "@/lib/tax/ics";
import { loadTaxContext } from "../data";

export const dynamic = "force-dynamic";

/** The app's public origin for the links inside the file: NEXT_PUBLIC_APP_URL when set, else the origin this request came in on. */
function appOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return (configured || request.nextUrl.origin).replace(/\/+$/, "");
}

/**
 * "Add these dates to your calendar": the filing year's tax deadlines as an
 * .ics file the board imports once — one all-day event per dated deadline
 * and per milestone, with display alarms. The same list the Taxes tab and
 * Home show (lib/tax/deadlines), so the calendar can't disagree with the
 * screen; estimated dates are tentative and say "(estimated)" in the title.
 * Walkup has no email service and runs no cron (DECISIONS #28) — a file is
 * the honest reminder. Route handlers don't inherit the page's access check,
 * so it's repeated here.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await loadTaxContext(supabase);
  if (!ctx) return NextResponse.json({ error: "No fiscal year is set up yet." }, { status: 404 });
  const { data: canRead } = await supabase.rpc("can_read_financials", { assoc: ctx.association.id });
  if (canRead !== true) return NextResponse.json({ error: "Board members and the accountant only." }, { status: 403 });

  const ics = buildCalendar({
    associationId: ctx.association.id,
    associationName: ctx.association.display_name,
    deadlines: ctx.deadlines,
    generatedAt: new Date().toISOString(),
    appUrl: appOrigin(request),
  });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="Walkup tax dates.ics"',
      "Cache-Control": "no-store",
    },
  });
}
