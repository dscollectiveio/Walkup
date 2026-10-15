import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Restricted } from "@/components/ui";
import { Pill } from "@/components/repairs/pills";
import { StatusPill } from "@/components/repairs/pills";
import { btnSecondary, linkClass } from "@/components/repairs/styles";
import { tradeLabel } from "@/lib/contractors/trades";
import { humanDate, moneyText } from "@/lib/repairs/format";
import type { TicketStatus } from "@/lib/repairs/labels";
import { loadViewer } from "@/lib/repairs/page-data";
import { isUuid } from "@/lib/repairs/server";
import { cadenceWords } from "@/lib/upkeep/schedule";
import { historyTotals, whenLabel } from "@/lib/upkeep/view";
import { ArchiveTaskButton, DeleteTaskButton, EditTaskButton, MarkDoneButton, TurnIntoProblem, type TaskForForm } from "../../upkeep-forms";
import { TaskHistory, type LogRow } from "./task-history";

export const dynamic = "force-dynamic";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const OPEN = new Set(["open", "in_progress", "waiting_on_contractor"]);

/**
 * One upkeep job (repairs-spec §12.3): when it's next due, who usually does
 * it, its history, and the problems it turned into. Members read (RLS); the
 * board acts.
 */
export default async function UpkeepTaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  if (!isUuid(taskId)) return <Restricted what="this upkeep job" />;
  const supabase = await createClient();
  const viewer = await loadViewer(supabase);
  if (!viewer || !viewer.isMember) return <Restricted what="this upkeep job" />;

  const { data: rows } = await supabase
    .from("upkeep_tasks")
    .select("id, name, description, interval_months, due_month, last_done_on, next_due_on, trade, vendor_id, estimated_cost::text, is_active, vendors(name)")
    .eq("id", taskId)
    .limit(1);
  const t = rows?.[0];
  if (!t) return <Restricted what="this upkeep job" />;

  const today = viewer.todayIso;
  const seesMoney = viewer.canReadFinancials;
  const isBoard = viewer.isBoard;
  const [{ data: log }, { data: tickets }, { data: vendors }] = await Promise.all([
    supabase
      .from("upkeep_log")
      .select("id, done_on, cost::text, note, vendor_id, vendors(name), ticket_id, tickets(id, reference)")
      .eq("task_id", taskId)
      .order("done_on", { ascending: false })
      .order("created_at", { ascending: false }),
    isBoard
      ? supabase.from("tickets").select("id, reference, title, status, opened_on").eq("upkeep_task_id", taskId).order("opened_on", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; reference: number; title: string; status: string; opened_on: string }[] }),
    isBoard
      ? supabase.from("vendors").select("id, name").is("archived_at", null).neq("status", "do_not_use").order("name")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const active = t.is_active === true;
  const dueMonth = (t.due_month as number | null) ?? null;
  const when = whenLabel(t.next_due_on as string, dueMonth, today);
  const vendorName = seesMoney ? (one(t.vendors as { name: string } | { name: string }[] | null)?.name ?? null) : null;
  const history: LogRow[] = (log ?? []).map((l) => {
    const ticket = one(l.tickets as { id: string; reference: number } | { id: string; reference: number }[] | null);
    return {
      id: l.id as string,
      doneOn: l.done_on as string,
      cost: seesMoney ? ((l.cost as string | null) ?? null) : null,
      vendorId: (l.vendor_id as string | null) ?? null,
      vendorName: seesMoney ? (one(l.vendors as { name: string } | { name: string }[] | null)?.name ?? null) : null,
      note: (l.note as string | null) ?? null,
      ticket: ticket ? { id: ticket.id, reference: ticket.reference } : null,
    };
  });
  const totals = historyTotals(
    history.map((h) => ({ done_on: h.doneOn, cost: h.cost })),
    seesMoney,
  );
  const openTicket = (tickets ?? []).find((x) => OPEN.has(x.status as string)) ?? null;
  const vendorOptions = (vendors ?? []).map((v) => ({ id: v.id as string, name: v.name as string }));
  const task: TaskForForm = {
    id: t.id as string,
    name: t.name as string,
    description: (t.description as string | null) ?? null,
    interval_months: t.interval_months as number,
    due_month: dueMonth,
    next_due_on: t.next_due_on as string,
    trade: (t.trade as string | null) ?? null,
    vendor_id: (t.vendor_id as string | null) ?? null,
    estimated_cost: (t.estimated_cost as string | null) ?? null,
  };
  const meta = [cadenceWords(task.interval_months, dueMonth), task.trade ? tradeLabel(task.trade) : null].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/repairs?view=upkeep" className="inline-flex min-h-[44px] items-center text-[13px] text-mute hover:underline">
          ← Upkeep schedule
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[20px] font-bold tracking-tight text-ink">{task.name}</h1>
          {active ? <Pill tone={when.tone === "bad" ? "bad" : when.tone === "warning" ? "warning" : "neutral"}>{when.text}</Pill> : null}
        </div>
        <p className="text-[13px] text-mute">{meta}</p>
        {!active ? (
          <div className="flex flex-wrap items-center gap-3 border-l-[3px] border-line-strong bg-fill px-3 py-2 text-[13px] text-ink">
            <span>Archived. It&rsquo;s off the schedule; its history stays.</span>
            {isBoard ? <ArchiveTaskButton taskId={task.id} archived /> : null}
          </div>
        ) : null}
      </div>

      <Card navy title="Next time">
        <div className="space-y-3 text-[13px]">
          {active ? (
            <p className="text-[15px] text-ink">
              Due {humanDate(task.next_due_on, today)}
              {when.status === "overdue" ? <span className="text-bad-text"> ({when.text})</span> : null}
            </p>
          ) : null}
          {seesMoney ? (
            <p className="text-ink">
              {vendorName && task.vendor_id ? (
                <>
                  Usually done by{" "}
                  {isBoard ? (
                    <Link href={`/contractors/${task.vendor_id}`} className={linkClass}>
                      {vendorName}
                    </Link>
                  ) : (
                    vendorName
                  )}
                </>
              ) : (
                "No usual contractor"
              )}
              {task.estimated_cost ? ` · about ${moneyText(task.estimated_cost)}` : ""}
            </p>
          ) : null}
          {task.description ? <p className="whitespace-pre-wrap text-mute">{task.description}</p> : null}
          {isBoard ? (
            <div className="flex flex-wrap gap-2 pt-1 max-sm:[&>*]:flex-1">
              {active ? <MarkDoneButton task={task} vendors={vendorOptions} todayIso={today} /> : null}
              {openTicket ? (
                <Link href={`/maintenance/${openTicket.id as string}`} className={btnSecondary}>
                  Open problem #{openTicket.reference as number}
                </Link>
              ) : active ? (
                <TurnIntoProblem taskId={task.id} />
              ) : null}
              <Link href={`/repairs/find?task=${task.id}`} className={btnSecondary}>
                Find someone
              </Link>
              <EditTaskButton task={task} vendors={vendorOptions} todayIso={today} />
              {active ? <ArchiveTaskButton taskId={task.id} archived={false} /> : null}
              {viewer.isAdmin && history.length === 0 ? <DeleteTaskButton taskId={task.id} name={task.name} /> : null}
            </div>
          ) : null}
        </div>
      </Card>

      <Card navy title="History" hint={totals ?? undefined}>
        <TaskHistory rows={history} seesMoney={seesMoney} isBoard={isBoard} isAdmin={viewer.isAdmin} vendors={vendorOptions} todayIso={today} />
      </Card>

      {isBoard ? (
        <Card navy title="Problems from this job">
          {(tickets ?? []).length === 0 ? (
            <p className="text-[13px] text-mute">None yet. Turn it into a problem when it needs someone to come out.</p>
          ) : (
            <ul className="divide-y divide-line text-[13px]">
              {(tickets ?? []).map((x) => (
                <li key={x.id as string} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/maintenance/${x.id as string}`} className={linkClass}>
                    #{x.reference as number} {x.title as string}
                  </Link>
                  <span className="flex items-center gap-2 text-mute">
                    {humanDate(x.opened_on as string, today)}
                    <StatusPill status={x.status as TicketStatus} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
