import Link from "next/link";
import { Answer } from "@/components/ui";
import { Pill } from "@/components/repairs/pills";
import { btnPrimary } from "@/components/repairs/styles";
import { tradeLabel } from "@/lib/contractors/trades";
import { humanDate, moneyText, whereLabel } from "@/lib/repairs/format";
import { PRIORITY_LABEL, isDone } from "@/lib/repairs/labels";
import type { RepairsViewer } from "@/lib/repairs/page-data";
import { clearedParams, hasFilters, problemsHref, type ProblemParams } from "@/lib/repairs/problems-params";
import type { Supabase } from "@/lib/repairs/server";
import { DismissibleAnswer } from "./dismissible-answer";
import { ProblemFilters, ProblemViewControls } from "./problem-filters";
import { ExpandableRow } from "./problem-expand";
import { ProblemRowLinks, ProblemStatusSelect, ProblemW9Check } from "./problem-row-actions";
import { WriteToContractor } from "@/app/contractors/write-dialog";
import { atOrPastContractorSelected, effectiveWorkStatus, numberedWorkStatus } from "@/lib/repairs/work-status";
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
      key={problemsHref(p)}
      params={p}
      trades={trades}
      isBoard={viewer.canManage}
      canReadFinancials={viewer.staffView}
      canReport={viewer.canReport}
      clearHref={clearHref}
      listHref={listHref}
      boardHref={boardHref}
    />
  );

  const emergencies = openAll.filter((t) => t.emergency_kind);
  const urgent = openAll.filter((t) => t.priority === "urgent");
  const answer =
    emergencies.length > 0 ? (
      <DismissibleAnswer
        storageKey="walkup:dismissed-problems-banner"
        signature={`emergency:${emergencies.map((t) => t.id).sort().join(",")}`}
        status="bad"
        headline={`${emergencies.length} emergency ${emergencies.length === 1 ? "problem" : "problems"} open`}
        detail={emergencies.map((t) => t.title).join(" · ")}
      />
    ) : urgent.length > 0 ? (
      <DismissibleAnswer
        storageKey="walkup:dismissed-problems-banner"
        signature={`urgent:${urgent.map((t) => t.id).sort().join(",")}`}
        status="bad"
        headline={`${urgent.length} ${urgent.length === 1 ? "problem" : "problems"} marked urgent`}
        detail={urgent.map((t) => t.title).join(" · ")}
      />
    ) : openAll.length > 0 ? (
      <Answer status="neutral" headline={`${openAll.length} open ${openAll.length === 1 ? "problem" : "problems"}`} detail="None of them urgent." />
    ) : (
      <Answer status="good" headline="Nothing outstanding" detail="No open problems." />
    );

  if (p.layout === "board" && viewer.staffView) {
    const rows = await loadProblems(supabase, viewer, p, { mode: "board" });
    return (
      <div className="space-y-6">
        {answer}
        {filters}
        <ProblemsBoard rows={rows} params={p} viewer={viewer} />
      </div>
    );
  }

  const sorted = await sortProblems(supabase, await loadProblems(supabase, viewer, p, { mode: "list" }), p.sort, viewer.todayIso);
  // Everything in one table: open tickets first (in the chosen order), completed ones after.
  const rows = [...sorted.filter((t) => !isDone(t.status)), ...sorted.filter((t) => isDone(t.status))];
  const anyTickets = openAll.length > 0 || rows.length > 0;

  return (
    <div className="space-y-6">
      {answer}
      <section aria-labelledby="problems-card-title" className="rounded-xl border border-line bg-paper">
        {/* On desktop everything down to the column headers stays put while the rows scroll under it. */}
        <div className="z-20 rounded-t-xl bg-paper xl:sticky xl:top-[56px]">
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-t-[11px] band bg-ink px-5 py-3">
            <h2 id="problems-card-title" className="eyebrow text-paper">
              All Tickets
            </h2>
            <div className="flex items-center gap-2">
              <ProblemViewControls
                canReadFinancials={viewer.staffView}
                canReport={viewer.canReport}
                isBoardLayout={false}
                listHref={listHref}
                boardHref={boardHref}
              />
            </div>
          </header>

          {/* Search and filters, set apart from the list by a hard line. */}
          <div className="border-b-2 border-line-strong bg-fill/40">
            <ProblemFilters
              key={problemsHref(p)}
              params={p}
              trades={trades}
              isBoard={viewer.canManage}
              canReadFinancials={viewer.staffView}
              clearHref={clearHref}
              listHref={listHref}
              boardHref={boardHref}
              embedded
            />
          </div>

          {rows.length > 0 ? (
            <div className="hidden px-5 pt-3 xl:block">
              <div className="relative isolate">
                <ColumnLines />
                <div aria-hidden="true" className={`${COLUMNS} border-b border-line pb-2 text-[11px] font-bold uppercase tracking-wide text-ink`}>
                  <span className="text-center">Problem</span>
                  <span className="text-center">Status</span>
                  <span className="text-center">Links</span>
                  <span className="text-center">Cost</span>
                  <span className="text-center">W-9 collected</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="px-5 pb-3 pt-1">
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
              <p className="py-4 text-center text-[13px] text-mute">Nothing here.</p>
            )
          ) : (
            <div className="relative isolate">
              <ColumnLines />
              {/* Every other ticket gets a faint blue band, edge to edge. */}
              <ul className="divide-y divide-line [&>li:nth-child(even)]:bg-ink/[0.045]">
                {rows.map((t) => (
                  <ProblemListRow key={t.id} t={t} viewer={viewer} />
                ))}
              </ul>
            </div>
          )}
        </div>
        {p.status === "done" && !p.older && rows.length >= 50 ? (
          <Link href={problemsHref(p, { older: true })} className="mt-3 inline-flex min-h-[44px] items-center text-[13px] underline underline-offset-2">
            Show older
          </Link>
        ) : null}
      </section>

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

/** The list's fixed columns, desktop only. Below that, each line wraps into one block. */
const COLUMNS =
  "hidden xl:grid xl:grid-cols-[minmax(0,1fr)_10.5rem_9.5rem_4.5rem_7.5rem] xl:items-center xl:gap-x-3 xl:pl-8";

/**
 * Thin vertical rules between the columns, drawn once down the whole table
 * (header and every row) at the columns' fixed right-hand offsets: each is the
 * running width of the columns to its right plus half a 0.75rem gap. Desktop only.
 */
function ColumnLines() {
  const lines = ["xl:right-[7.875rem]", "xl:right-[13.125rem]", "xl:right-[23.375rem]", "xl:right-[34.625rem]"];
  return (
    <>
      {lines.map((c) => (
        <span key={c} aria-hidden="true" className={`pointer-events-none absolute inset-y-0 -z-10 hidden w-px bg-line xl:block ${c}`} />
      ))}
    </>
  );
}

const URGENCY_PILL = { low: "good", normal: "warning", urgent: "bad" } as const;

export function ProblemListRow({ t, viewer }: { t: ProblemRow; viewer: RepairsViewer }) {
  const today = viewer.todayIso;
  const open = !isDone(t.status);
  const overdue = viewer.canManage && t.dueOn && t.dueOn < today && open;
  const visit = t.scheduledFor && open ? ` · visit ${humanDate(t.scheduledFor, today)}` : "";
  const money = viewer.staffView ? (t.actualCost ? moneyText(t.actualCost) : t.estimatedCost ? `~${moneyText(t.estimatedCost)}` : null) : null;
  const status = effectiveWorkStatus(t.workStatus, t.stage);
  return (
    <ExpandableRow
      ticketId={t.id}
      reference={t.reference}
      title={t.title}
      workStatus={status}
      todayIso={today}
      canExpand={viewer.canManage}
    >
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 xl:grid xl:grid-cols-[minmax(0,1fr)_10.5rem_9.5rem_4.5rem_7.5rem] xl:gap-x-3">
      <Link href={`/maintenance/${t.id}`} className="group min-w-0 basis-full xl:basis-auto">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-ink group-hover:underline">{t.title}</span>
          {t.emergency_kind ? (
            <Pill tone="bad">Emergency</Pill>
          ) : (
            <Pill tone={URGENCY_PILL[t.priority]}>{PRIORITY_LABEL[t.priority]}</Pill>
          )}
        </span>
        <span className="mt-1 block text-[13px] text-mute">
          #{t.reference} · {whereLabel(t.unitLabel, t.locationDetail)} · {t.trade ? tradeLabel(t.trade) : "Kind of work not set"} · reported{" "}
          {humanDate(t.openedOn, today)} · {t.contractorName ?? "No contractor yet"}
          {visit}
          {overdue ? <span className="font-medium text-warning-text"> · Overdue</span> : null}
        </span>
      </Link>
      <div className="text-center">
        {viewer.canManage ? (
          <ProblemStatusSelect id={t.id} reference={t.reference} value={status} />
        ) : (
          <span className="text-[12px] text-mute">{numberedWorkStatus(status)}</span>
        )}
      </div>
      <div>
        <ProblemRowLinks
          id={t.id}
          reference={t.reference}
          title={t.title}
          status={status}
          canWrite={viewer.canManage}
          open={open}
          contractorEmail={t.contractorEmail}
          contractorPhone={t.contractorPhone}
        />
      </div>
      <div className="figures text-center text-[13px] text-mute xl:min-h-[1px]">{money}</div>
      <div className="flex flex-col items-center gap-0.5">
        <ProblemW9Check key={`${t.id}-${t.vendorW9}`} vendorId={t.assignedVendorId} collected={t.vendorW9} contractorName={t.contractorName} canEdit={viewer.isBoard} />
        {/* Once a contractor is chosen, and until their W-9 is in, a way straight to the request email. */}
        {viewer.isBoard && t.assignedVendorId && t.vendorW9 !== true && atOrPastContractorSelected(status) ? (
          <WriteToContractor
            vendorId={t.assignedVendorId}
            contractors={[{ id: t.assignedVendorId, name: t.contractorName ?? "the contractor", email: t.contractorEmail }]}
            tickets={[]}
            preset={{ kind: "w9_request" }}
            label="Request W-9"
            variant="link"
          />
        ) : null}
      </div>
    </div>
    </ExpandableRow>
  );
}
