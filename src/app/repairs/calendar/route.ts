import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildingTodayIso } from "@/lib/dates";
import { buildRepairsCalendar, upkeepCalendarItems } from "@/lib/upkeep/ics";

export const dynamic = "force-dynamic";

/** The app's public origin for the links inside the file: NEXT_PUBLIC_APP_URL when set, else this request's origin. */
function appOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return (configured || request.nextUrl.origin).replace(/\/+$/, "");
}

/**
 * "Add to your calendar" on Repairs (repairs-spec §12.5): upkeep due dates,
 * planned contractor visits and, for the board and accountant, insurance
 * renewals, as an .ics file imported once. Walkup sends no updates
 * (DECISIONS #28); downloading again after the schedule changes updates the
 * same events (one UID per task, visit or policy). Route handlers don't
 * inherit a page's access check, so it's repeated here; RLS limits owners to
 * the visits they can see.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: assoc } = await supabase.from("associations").select("id, display_name, legal_name").limit(1);
  const association = assoc?.[0];
  if (!association) return NextResponse.json({ error: "Members of this building only." }, { status: 403 });
  const [{ data: member }, { data: financial }] = await Promise.all([
    supabase.rpc("is_member", { assoc: association.id }),
    supabase.rpc("can_read_financials", { assoc: association.id }),
  ]);
  if (member !== true) return NextResponse.json({ error: "Members of this building only." }, { status: 403 });

  const today = buildingTodayIso();
  const [tasks, visits, policies] = await Promise.all([
    supabase
      .from("upkeep_tasks")
      .select("id, name, next_due_on, interval_months, due_month, description, updated_at")
      .eq("association_id", association.id)
      .eq("is_active", true)
      .not("next_due_on", "is", null),
    supabase
      .from("tickets")
      .select("id, reference, title, scheduled_for, scheduled_window, updated_at")
      .eq("association_id", association.id)
      .gte("scheduled_for", today),
    financial === true
      ? supabase
          .from("insurance_policies")
          .select("id, coverage, carrier_name, effective_to, renewal_reminder_days, updated_at")
          .eq("association_id", association.id)
          .is("replaced_at", null)
          .is("archived_at", null)
          .gte("effective_to", today)
      : Promise.resolve({ data: [] as never[], error: null }),
  ]);
  const failed = tasks.error ?? visits.error ?? policies.error;
  if (failed) {
    console.error("[repairs] calendar", failed.code ?? "-", failed.message ?? "");
    return NextResponse.json({ error: "Couldn't build the calendar. Try again." }, { status: 500 });
  }

  const ics = buildRepairsCalendar({
    associationId: association.id,
    associationName: association.display_name || association.legal_name || "Your building",
    items: upkeepCalendarItems({
      tasks: tasks.data ?? [],
      visits: visits.data ?? [],
      policies: policies.data ?? [],
      appUrl: appOrigin(request),
    }),
    generatedAt: new Date().toISOString(),
  });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="Walkup upkeep.ics"',
      "Cache-Control": "no-store",
    },
  });
}
