import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Restricted } from "@/components/ui";
import { loadEmergencyContractors, loadEmergencyInfo, loadViewer } from "@/lib/repairs/page-data";
import { ReportForm } from "./report-form";

export const dynamic = "force-dynamic";
// createTicket starts AI triage in after(), and photos upload from this page.
export const maxDuration = 300;

/**
 * Report a problem (repairs-spec §5.2): a full page, single column, for
 * owners and the board. The accountant reads Repairs but doesn't report.
 */
export default async function ReportPage() {
  const supabase = await createClient();
  const viewer = await loadViewer(supabase);
  if (!viewer || !viewer.isMember) return <Restricted what="reporting problems" />;
  if (!viewer.canReport) {
    return (
      <div className="space-y-3">
        <Restricted what="reporting problems" />
        <p className="text-center text-[13px] text-mute">Accountants, observers and attorneys can read problems but not report them.</p>
      </div>
    );
  }

  const [unitsRes, ownedRes, openRes, info, contractors] = await Promise.all([
    supabase.from("units").select("id, label, sort_order").order("sort_order"),
    viewer.canManage ? Promise.resolve({ data: null }) : supabase.rpc("owned_unit_ids", { assoc: viewer.associationId }),
    supabase
      .from("tickets")
      .select("id, reference, title, unit_id")
      .not("status", "in", '("resolved","closed")')
      .order("created_at", { ascending: false })
      .limit(100),
    loadEmergencyInfo(supabase, viewer.associationId),
    viewer.canManage ? loadEmergencyContractors(supabase) : Promise.resolve([]),
  ]);

  const allUnits = (unitsRes.data ?? []).map((u) => ({ id: u.id as string, label: u.label as string }));
  const owned = new Set<string>(((ownedRes.data as string[] | null) ?? []).map(String));
  const units = viewer.canManage ? allUnits : allUnits.filter((u) => owned.has(u.id));

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-6">
      <div>
        <Link href="/repairs" className="inline-flex min-h-[44px] items-center text-[13px] text-mute hover:underline">
          ← Repairs &amp; Upkeep
        </Link>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Report a problem</h1>
        <p className="mt-1 text-mute">Tell the board what&rsquo;s wrong and where. Photos help a contractor quote without a visit.</p>
      </div>
      <ReportForm
        units={units}
        openTickets={(openRes.data ?? []).map((t) => ({
          id: t.id as string,
          reference: t.reference as number,
          title: t.title as string,
          unit_id: (t.unit_id as string | null) ?? null,
        }))}
        building={info.building}
        contacts={viewer.canManage ? [] : info.contacts}
        boardContractors={contractors}
        isBoard={viewer.canManage}
      />
    </div>
  );
}
