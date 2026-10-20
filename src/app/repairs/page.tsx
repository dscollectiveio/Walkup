import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Restricted } from "@/components/ui";
import { btnPrimary } from "@/components/repairs/styles";
import { loadRepairsSince, loadViewer, type RepairsViewer } from "@/lib/repairs/page-data";
import { parseProblemParams, problemsHref, resolveView, viewsFor, type RepairsView, type SearchParams } from "@/lib/repairs/problems-params";
import type { Supabase } from "@/lib/repairs/server";
import { parseDirectoryParams } from "@/lib/contractors/directory";
import { ContractorsView } from "./contractors-view";
import { OwnerProblemsView } from "./owner-problems-view";
import { ProblemsView } from "./problems-view";
import { LayoutMemory, MarkSeen } from "./repairs-islands";
import { TodayView } from "./today-view";
import { UpkeepView } from "./upkeep-view";
import { BillsView } from "./bills-view";

export const dynamic = "force-dynamic";
// Contractor drafts and photo uploads run from views on this page.
export const maxDuration = 300;

const LABEL: Record<RepairsView, string> = {
  problems: "Problems",
  upkeep: "Upkeep",
  contractors: "Contractors",
  bills: "Bills",
};

const BLURB: Record<RepairsView, string> = {
  problems: "Anything broken in the building, who is fixing it, and where it stands.",
  upkeep: "The care the building needs on a calendar, whether or not anything is broken.",
  contractors: "Who you call, their paperwork, and how they have done.",
  bills: "Regular bills the building pays. Walkup reminds you; it never pays anything.",
};

/**
 * Repairs & Upkeep (repairs-spec §2): one hub with a view per question.
 * The pill nav shows only the views the viewer may use; a view they can't
 * use falls back to Problems (owners) rather than an empty board page.
 */
export default async function RepairsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const viewer = await loadViewer(supabase);
  if (!viewer || !viewer.isMember) return <Restricted what="repairs and upkeep" />;

  const view = resolveView(sp.view, viewer);
  const views = viewsFor(viewer);
  const [badges, since] = await Promise.all([loadBadges(supabase, viewer), loadRepairsSince(supabase, viewer.associationId)]);
  const problemParams = parseProblemParams(sp, viewer);

  return (
    <div className="space-y-6">
      <MarkSeen />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight text-ink">Repairs &amp; Upkeep</h1>
          <p className="mt-1 text-mute">
            {view === "problems" && viewer.isBoard
              ? "What needs you this week, then every problem in the building and where it stands."
              : BLURB[view]}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Repairs and upkeep" className="relative -mx-1 min-w-0 overflow-x-auto px-1">
        <div className="inline-flex rounded-full border border-line bg-paper p-0.5">
          {views.map((v) => {
            const b = badges[v];
            const active = v === view;
            return (
              <Link
                key={v}
                href={`/repairs?view=${v}`}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-full px-3 text-[13px] font-medium sm:px-4 ${
                  active ? "bg-ink text-paper" : "text-mute hover:text-ink"
                }`}
              >
                {LABEL[v]}
                {b && b.count > 0 ? (
                  <span
                    className={`rounded-full px-1.5 text-[11px] ${
                      active ? "bg-paper/20 text-paper" : b.tone === "bad" ? "bg-bad-tint text-bad-text" : b.tone === "warning" ? "bg-warning-tint text-warning-text" : "bg-fill text-mute"
                    }`}
                  >
                    {b.count}
                    <span className="sr-only"> {b.label}</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>
      {viewer.canReport && view === "problems" ? (
        <Link href="/repairs/report" className={`${btnPrimary} shrink-0`}>
          Report a problem
        </Link>
      ) : null}
      </div>

      {view === "problems" && viewer.canReadFinancials ? (
        <LayoutMemory layout={problemParams.layout} fromUrl={problemParams.layoutFromUrl} boardHref={problemsHref(problemParams, { layout: "board" })} />
      ) : null}

      {view === "problems" ? (
        viewer.canReadFinancials ? (
          <>
            {viewer.isBoard ? <TodayView supabase={supabase} viewer={viewer} since={since} /> : null}
            <ProblemsView supabase={supabase} viewer={viewer} params={problemParams} />
          </>
        ) : (
          <OwnerProblemsView supabase={supabase} viewer={viewer} since={since} />
        )
      ) : view === "upkeep" ? (
        <UpkeepView supabase={supabase} viewer={viewer} show={first(sp.show)} archived={first(sp.archived) === "1"} layout={first(sp.layout)} month={first(sp.month)} />
      ) : view === "contractors" ? (
        <ContractorsView supabase={supabase} viewer={viewer} params={parseDirectoryParams(sp)} />
      ) : (
        <BillsView supabase={supabase} viewer={viewer} show={first(sp.show)} q={first(sp.q)} pay={first(sp.pay)} freq={first(sp.freq)} sort={first(sp.sort)} />
      )}
    </div>
  );
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

type Badge = { count: number; tone: "bad" | "warning" | "neutral"; label: string };

/** The nav's counts (repairs-spec §2.2). Each reads under the viewer's RLS. */
async function loadBadges(supabase: Supabase, viewer: RepairsViewer): Promise<Partial<Record<RepairsView, Badge>>> {
  const today = viewer.todayIso;
  const [y, m, d] = today.split("-").map(Number);
  const in14 = new Date(Date.UTC(y, m - 1, d + 14)).toISOString().slice(0, 10);
  const fin = viewer.canReadFinancials;
  const [open, urgent, overdue, expired, bills] = await Promise.all([
    supabase.from("tickets").select("id", { count: "exact", head: true }).not("status", "in", '("resolved","closed")'),
    supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .not("status", "in", '("resolved","closed")')
      .or("priority.eq.urgent,emergency_kind.not.is.null"),
    supabase.from("upkeep_tasks").select("id", { count: "exact", head: true }).eq("is_active", true).lt("next_due_on", today),
    fin
      ? supabase
          .from("vendors")
          .select("id", { count: "exact", head: true })
          .is("archived_at", null)
          .neq("status", "do_not_use")
          .or(`insured_until.lt.${today},license_expires_on.lt.${today}`)
      : Promise.resolve({ count: 0 }),
    fin
      ? supabase
          .from("recurring_bills")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
          .eq("autopay_arranged", false)
          .is("paused_at", null)
          .lte("next_due_on", in14)
      : Promise.resolve({ count: 0 }),
  ]);
  return {
    problems: { count: open.count ?? 0, tone: (urgent.count ?? 0) > 0 ? "bad" : "neutral", label: "open" },
    upkeep: { count: overdue.count ?? 0, tone: "warning", label: "overdue" },
    contractors: { count: expired.count ?? 0, tone: "warning", label: "with expired paperwork" },
    bills: { count: bills.count ?? 0, tone: "warning", label: "due in 14 days" },
  };
}
