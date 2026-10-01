import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Restricted } from "@/components/ui";
import { ProblemsView } from "./problems-view";
import { UpkeepView } from "./upkeep-view";
import { ContractorsView } from "./contractors-view";

export const dynamic = "force-dynamic";

type View = "problems" | "upkeep" | "contractors";

const VIEWS: { key: View; label: string; blurb: string }[] = [
  { key: "problems", label: "Problems", blurb: "Something's broken — report it, assign it, close it." },
  { key: "upkeep", label: "Upkeep", blurb: "The recurring care the building needs, on a calendar." },
  { key: "contractors", label: "Contractors", blurb: "Who you call, their paperwork, and how they've done." },
];

/**
 * Repairs & Upkeep: the Building section's three working pages in one tab.
 * One question per view — what's broken, what's due, who do we call — with
 * the details (tickets, contractor profiles) on their existing pages.
 */
export default async function RepairsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; tab?: string; trade?: string | string[]; status?: string }>;
}) {
  const sp = await searchParams;
  const view: View = sp.view === "upkeep" || sp.view === "contractors" ? sp.view : "problems";

  const supabase = await createClient();
  const { data: associations } = await supabase.from("associations").select("id").limit(1);
  const association = associations?.[0];
  if (!association) return <Restricted what="repairs and upkeep" />;
  const [{ data: isMemberRes }, { data: isBoardRes }, { count: openCount }, { count: overdueCount }] = await Promise.all([
    supabase.rpc("is_member", { assoc: association.id }),
    supabase.rpc("is_board", { assoc: association.id }),
    supabase.from("tickets").select("id", { count: "exact", head: true }).not("status", "in", '("resolved","closed")'),
    supabase
      .from("upkeep_tasks")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .lt("next_due_on", new Date().toISOString().slice(0, 10)),
  ]);
  if (isMemberRes !== true) return <Restricted what="repairs and upkeep" />;
  const isBoard = isBoardRes === true;
  const counts: Partial<Record<View, number>> = { problems: openCount ?? 0, upkeep: overdueCount ?? 0 };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Repairs &amp; Upkeep</h1>
        <p className="mt-1 text-mute">{VIEWS.find((v) => v.key === view)?.blurb}</p>
      </div>

      <nav aria-label="Repairs and upkeep" className="inline-flex rounded-full border border-line bg-paper p-0.5">
        {VIEWS.map((v) => {
          const n = counts[v.key] ?? 0;
          return (
            <Link
              key={v.key}
              href={v.key === "problems" ? "/repairs" : `/repairs?view=${v.key}`}
              aria-current={v.key === view ? "page" : undefined}
              className={`inline-flex min-h-[40px] items-center gap-2 rounded-full px-4 text-[13px] font-medium ${
                v.key === view ? "bg-ink text-paper" : "text-mute hover:text-ink"
              }`}
            >
              {v.label}
              {n > 0 ? (
                <span
                  className={`rounded-full px-1.5 text-[11px] ${
                    v.key === view ? "bg-paper/20 text-paper" : v.key === "upkeep" ? "bg-warning-tint text-warning-text" : "bg-fill text-mute"
                  }`}
                >
                  {n}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {view === "problems" ? <ProblemsView /> : view === "upkeep" ? <UpkeepView isBoard={isBoard} /> : <ContractorsView sp={sp} />}
    </div>
  );
}
