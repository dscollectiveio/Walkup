import Link from "next/link";
import { Answer, Card } from "@/components/ui";
import { Pill, StagePill, StatusPill } from "@/components/repairs/pills";
import { btnPrimary } from "@/components/repairs/styles";
import { tradeLabel } from "@/lib/contractors/trades";
import { humanDate, moneyText, whereLabel } from "@/lib/repairs/format";
import { isDone } from "@/lib/repairs/labels";
import type { RepairsViewer } from "@/lib/repairs/page-data";
import { clearedParams, hasFilters, problemsHref, type ProblemParams } from "@/lib/repairs/problems-params";
import type { Supabase } from "@/lib/repairs/server";
import { ProblemFilters } from "./problem-filters";
import { ProblemsBoard } from "./problems-board";
import { loadProblems, sortProblems, tradesInUse, type ProblemRow } from "./problems-data";

/**
 * Problems (repairs-spec §5.7) for the board and the accountant: one answer,
 * the filters, the list (or the pipeline board), recently fixed. Owners get
 * owner-problems-view.tsx instead.
 */
export async function ProblemsView({ supabase, viewer, params }: { supabase: Supabase; viewer: RepairsViewer; params: ProblemParams }) {
  const p = params;
  const filtered = hasFilters(p);
  const clearHref = filtered ? problemsHref(clearedParams(p)) : null;
  const listHref = problemsHref(p, { layout: "list", layoutFromUrl: true });
  const boardHref = problemsHref(p, { layout: "board" });

  const [trades, openAll] = await Promise.all([
    tradesInUse(supabase),
    // The answer always speaks about every open problem, filters or not.
    loadProblems(supabase, viewer, clearedParams(p), { mode: "list", status: "open" }),
  ]);

  const filters = (
    <ProblemFilters
      params={p}
      trades={trades}
      isBoard={viewer.isBoard}
      canReadFinancials={viewer.canReadFinancials}
      clearHref={clearHref}
      listHref={listHref}
      boardHref={boardHref}
    />
  );

  const emergencies = openAll.filter((t) => t.emergency_kind);
  const urgent = openAll.filter((t) => t.priority === "urgent");
  const answer =
    emergencies.length > 0 ? (
      <Answer
        status="bad"
        headline={`${emergencies.length} emergency ${emergencies.length === 1 ? "problem" : "problems"} open`}
        detail={emergencies.map((t) => t.title).join(" · ")}
      />
    ) : urgent.length > 0 ? (
      <Answer status="bad" headline={`${urgent.length} ${urgent.length === 1 ? "problem" : "problems"} marked urgent`} detail={urgent.map((t) => t.title).join(" · ")} />
    ) : openAll.length > 0 ? (
      <Answer status="neutral" headline={`${openAll.length} open ${openAll.length === 1 ? "problem" : "problems"}`} detail="None of them urgent." />
    ) : (
      <Answer status="good" headline="Nothing outstanding" detail="No open problems." />
    );

  if (p.layout === "board" && viewer.canReadFinancials) {
    const rows = await loadProblems(supabase, viewer, p, { mode: "board" });
    return (
      <div className="space-y-6">
        {answer}
        {filters}
        <ProblemsBoard rows={rows} params={p} viewer={viewer} />
      </div>
    );
  }

  const rows = await sortProblems(supabase, await loadProblems(supabase, viewer, p, { mode: "list" }), p.sort, viewer.todayIso);
  const showRecent = p.status === "open" && !p.stage;
  const recent = showRecent
    ? await loadProblems(supabase, viewer, { ...p, stage: null }, { mode: "list", status: "done", limit: 10 })
    : [];
  const anyTickets = openAll.length > 0 || recent.length > 0 || rows.length > 0;

  const title = p.status === "done" ? "Done" : p.status === "all" ? "All problems" : "Open problems";

  return (
    <div className="space-y-6">
      {answer}
      {filters}
      <Card navy title={title}>
        {rows.length === 0 ? (
          filtered ? (
            <div className="py-4 text-center text-[13px] text-mute">
              <p>No problems match these filters.</p>
              {clearHref ? (
                <Link href={clearHref} className="mt-2 inline-flex min-h-[44px] items-center underline underline-offset-2">
                  Clear filters
                </Link>
              ) : null}
            </div>
          ) : !anyTickets ? (
            <EmptyState canReport={viewer.canReport} />
          ) : (
            <p className="py-4 text-center text-[13px] text-mute">Nothing open.</p>
          )
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((t) => (
              <ProblemListRow key={t.id} t={t} viewer={viewer} />
            ))}
          </ul>
        )}
        {p.status === "done" && !p.older && rows.length >= 50 ? (
          <Link href={problemsHref(p, { older: true })} className="mt-3 inline-flex min-h-[44px] items-center text-[13px] underline underline-offset-2">
            Show older
          </Link>
        ) : null}
      </Card>

      {showRecent && recent.length > 0 ? (
        <Card navy title="Recently fixed">
          <ul className="divide-y divide-line">
            {recent.map((t) => (
              <li key={t.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <Link href={`/maintenance/${t.id}`} className="text-[14px] text-ink underline-offset-2 hover:underline">
                  {t.title}
                </Link>
                <span className="text-[12px] text-mute">
                  #{t.reference}
                  {t.resolvedAt ? ` · fixed ${humanDate(t.resolvedAt.slice(0, 10), viewer.todayIso)}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <Link href={problemsHref(p, { status: "done" })} className="mt-2 inline-flex min-h-[44px] items-center text-[13px] underline underline-offset-2">
            See all done problems
          </Link>
        </Card>
      ) : null}
    </div>
  );
}

function EmptyState({ canReport }: { canReport: boolean }) {
  return (
    <div className="space-y-3 py-4 text-center">
      <p className="text-[14px] text-mute">
        Nothing has been reported yet. When something breaks, report it here: the board sees it here and takes it from there.
      </p>
      {canReport ? (
        <Link href="/repairs/report" className={btnPrimary}>
          Report a problem
        </Link>
      ) : null}
    </div>
  );
}

export function ProblemListRow({ t, viewer }: { t: ProblemRow; viewer: RepairsViewer }) {
  const today = viewer.todayIso;
  const overdue = viewer.isBoard && t.dueOn && t.dueOn < today && !isDone(t.status);
  const visit = t.scheduledFor && !isDone(t.status) ? ` · visit ${humanDate(t.scheduledFor, today)}` : "";
  const money = viewer.canReadFinancials ? (t.actualCost ? moneyText(t.actualCost) : t.estimatedCost ? `~${moneyText(t.estimatedCost)}` : null) : null;
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <Link href={`/maintenance/${t.id}`} className="group min-w-0 flex-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-ink group-hover:underline">{t.title}</span>
            {t.emergency_kind ? <Pill tone="bad">Emergency</Pill> : t.priority === "urgent" ? <Pill tone="bad">Urgent</Pill> : null}
            {viewer.isBoard ? <StagePill stage={t.stage} outline /> : <StatusPill status={t.status} />}
            {overdue ? <Pill tone="warning">Overdue</Pill> : null}
          </div>
          <div className="mt-1 text-[13px] text-mute">
            #{t.reference} · {whereLabel(t.unitLabel, t.locationDetail)} · {t.trade ? tradeLabel(t.trade) : "Kind of work not set"} · reported {humanDate(t.openedOn, today)} ·{" "}
            {t.contractorName ?? "No contractor yet"}
            {visit}
          </div>
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-3">
        {money ? <span className="figures text-[13px] text-mute">{money}</span> : null}
        <Link href={`/maintenance/${t.id}`} aria-label={`Open problem #${t.reference}: ${t.title}`} className="inline-flex min-h-[40px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill">
          Open
        </Link>
      </div>
    </li>
  );
}
