import Link from "next/link";
import { Pill } from "@/components/repairs/pills";
import { humanDate, whereLabel } from "@/lib/repairs/format";
import type { RepairsViewer } from "@/lib/repairs/page-data";
import { problemsHref, type ProblemParams } from "@/lib/repairs/problems-params";
import { compareForTriage, STAGE_LABEL, type Stage } from "@/lib/repairs/stage";
import { BoardColumn, CloseItButton } from "./board-pieces";
import type { ProblemRow } from "./problems-data";

/**
 * The pipeline board (repairs-spec §15.2), financial readers. Stages are
 * derived from quotes and visit dates, so there's no drag and drop; each
 * card has one quick action that does the real thing. Below `lg` the
 * columns stack as folding sections, so a phone never scrolls sideways.
 */

const PER_COLUMN = 20;
const COLUMNS: Stage[] = ["new", "quoting", "chosen", "scheduled", "in_progress", "fixed"];
const btnCard =
  "inline-flex min-h-[44px] w-full items-center justify-center rounded-md border border-line-strong bg-paper px-3 text-[13px] font-medium text-ink hover:bg-fill";

export function ProblemsBoard({ rows, params, viewer }: { rows: ProblemRow[]; params: ProblemParams; viewer: RepairsViewer }) {
  const today = viewer.todayIso;
  const columns = params.closed ? [...COLUMNS, "closed" as Stage] : COLUMNS;
  const desktop = params.closed ? "xl" : "lg";
  const sorted = [...rows].sort((a, b) =>
    compareForTriage(
      { emergency_kind: a.emergency_kind, priority: a.priority, due_on: a.dueOn, created_at: a.createdAt, reference: a.reference },
      { emergency_kind: b.emergency_kind, priority: b.priority, due_on: b.dueOn, created_at: b.createdAt, reference: b.reference },
      today,
    ),
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link
          href={problemsHref(params, { closed: !params.closed })}
          className="inline-flex min-h-[44px] items-center text-[13px] text-ink underline underline-offset-2"
        >
          {params.closed ? "Hide closed" : "Show closed"}
        </Link>
      </div>
      <div className={`grid gap-3 ${desktop === "lg" ? "lg:grid-cols-6" : "xl:grid-cols-7"}`}>
        {columns.map((stage) => {
          const cards = sorted.filter((r) => r.stage === stage);
          return (
            <BoardColumn key={stage} label={STAGE_LABEL[stage]} count={cards.length} desktop={desktop}>
              {cards.length === 0 ? (
                <p className="px-2 py-3 text-[12px] text-mute">Nothing here.</p>
              ) : (
                <ul className="space-y-2">
                  {cards.slice(0, PER_COLUMN).map((t) => (
                    <BoardCard key={t.id} t={t} today={today} canWrite={viewer.isBoard} />
                  ))}
                </ul>
              )}
              {cards.length > PER_COLUMN ? (
                <Link
                  href={problemsHref(params, {
                    layout: "list",
                    layoutFromUrl: true,
                    stage,
                    status: stage === "fixed" || stage === "closed" ? "done" : "open",
                  })}
                  className="mt-2 inline-flex min-h-[44px] items-center px-2 text-[13px] underline underline-offset-2"
                >
                  {cards.length - PER_COLUMN} more
                </Link>
              ) : null}
            </BoardColumn>
          );
        })}
      </div>
    </div>
  );
}

function BoardCard({ t, today, canWrite }: { t: ProblemRow; today: string; canWrite: boolean }) {
  const href = `/maintenance/${t.id}`;
  const overdue = t.dueOn && t.dueOn < today && t.stage !== "fixed" && t.stage !== "closed";
  const asked = t.bids.requested + t.bids.received + t.bids.accepted;
  let action: React.ReactNode = null;
  if (canWrite) {
    switch (t.stage) {
      case "new":
        action = <Link href={`${href}?open=quotes`} className={btnCard}>Get quotes</Link>;
        break;
      case "quoting":
        action = <Link href={`${href}#quotes`} className={btnCard}>Compare</Link>;
        break;
      case "chosen":
        action = <Link href={`${href}?open=go-ahead`} className={btnCard}>Send the go-ahead</Link>;
        break;
      case "scheduled":
      case "in_progress":
        action = <Link href={`${href}?open=fix`} className={btnCard}>Mark fixed</Link>;
        break;
      case "fixed":
        action = <CloseItButton ticketId={t.id} actualCost={t.actualCost} expenseId={t.expenseId} />;
        break;
      default:
        action = null;
    }
  }
  return (
    <li className="space-y-2 rounded-lg border border-line bg-paper p-3">
      <Link href={href} className="block text-[14px] font-medium leading-snug text-ink underline-offset-2 hover:underline">
        {t.title}
      </Link>
      <p className="text-[12px] text-mute">
        #{t.reference} · {whereLabel(t.unitLabel, t.locationDetail)}
      </p>
      <p className="text-[12px] text-ink">{t.contractorName ?? "No contractor"}</p>
      <div className="flex flex-wrap gap-1">
        {t.emergency_kind ? <Pill tone="bad">Emergency</Pill> : t.priority === "urgent" ? <Pill tone="bad">Urgent</Pill> : null}
        {overdue ? <Pill tone="warning">Overdue</Pill> : null}
        {t.scheduledFor && t.stage === "scheduled" ? <Pill tone="info">Visit {humanDate(t.scheduledFor, today)}</Pill> : null}
        {t.stage === "quoting" ? <Pill tone="neutral">{`${t.bids.received}/${asked} quotes`}</Pill> : null}
      </div>
      {action}
    </li>
  );
}
