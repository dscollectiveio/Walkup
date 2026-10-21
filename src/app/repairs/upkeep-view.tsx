import { vendorSource } from "@/lib/contractors/vendor-source";
import { vendorNames } from "@/lib/contractors/vendor-names";
import Link from "next/link";
import { Card, HEADER_BUTTON } from "@/components/ui";
import { btnLink, btnSecondary, linkClass } from "@/components/repairs/styles";
import { tradeLabel } from "@/lib/contractors/trades";
import { humanDate, moneyText } from "@/lib/repairs/format";
import type { RepairsViewer } from "@/lib/repairs/page-data";
import type { Supabase } from "@/lib/repairs/server";
import { cadenceWords } from "@/lib/upkeep/schedule";
import { groupUpkeep, upkeepAnswer, whenLabel, type UpkeepShow, parseUpkeepShow } from "@/lib/upkeep/view";
import { AddToCalendarMenu } from "./add-to-calendar";
import { DismissibleOnceAnswer } from "./dismissible-answer";
import { UpkeepCalendar } from "./upkeep-calendar";
import { AddTaskButton, ArchiveTaskButton, TemplatePicker, UpkeepSchedule, type ScheduleRow } from "./upkeep-forms";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

const FILTERS: { key: UpkeepShow; label: string }[] = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "soon", label: "Next 60 days" },
];


/**
 * Upkeep (repairs-spec §12.2): the care the building needs on a calendar,
 * whether or not anything is broken. The board adds, marks done and edits;
 * everyone else reads. Owners see no costs and no contractor names.
 */
export async function UpkeepView({
  supabase,
  viewer,
  show: showRaw,
  archived,
  layout: layoutRaw,
  month: monthRaw,
}: {
  supabase: Supabase;
  viewer: RepairsViewer;
  show?: string;
  archived: boolean;
  layout?: string;
  month?: string;
}) {
  const today = viewer.todayIso;
  const show = parseUpkeepShow(showRaw);
  const layout = layoutRaw === "calendar" ? "calendar" : "list";
  const month = monthRaw && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthRaw) ? monthRaw : today.slice(0, 7);
  const upkeepHref = (o: { show?: UpkeepShow; layout?: "list" | "calendar"; month?: string }) => {
    const qs = new URLSearchParams({ view: "upkeep" });
    const l = o.layout ?? layout;
    if (l === "calendar") {
      qs.set("layout", "calendar");
      if (o.month) qs.set("month", o.month);
    } else if (o.show && o.show !== "all") qs.set("show", o.show);
    return `/repairs?${qs.toString()}`;
  };
  // isBoard here means "runs the upkeep": the board and a property manager. seesMoney: the full table, estimates included.
  const isBoard = viewer.canManage;
  const seesMoney = viewer.staffView;

  if (archived) return <ArchivedJobs supabase={supabase} isBoard={isBoard} seesMoney={seesMoney} />;

  const [{ data: tasks }, { data: vendors }, { data: recentLog }, { count: archivedCount }, { data: openTickets }] = await Promise.all([
    // Estimates and contractors are only readable by board and accountant; everyone else reads the member views.
    (seesMoney
      ? supabase.from("upkeep_tasks").select("id, name, description, interval_months, due_month, last_done_on, next_due_on, trade, vendor_id, estimated_cost::text")
      : supabase.from("upkeep_tasks_member").select("id, name, description, interval_months, due_month, last_done_on, next_due_on, trade")
    )
      .eq("is_active", true)
      .order("next_due_on") as unknown as PromiseLike<{ data: Record<string, unknown>[] | null }>,
    isBoard
      ? supabase.from(vendorSource(viewer.canReadFinancials)).select("id, name").is("archived_at", null).neq("status", "do_not_use").order("name")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    (seesMoney
      ? supabase.from("upkeep_log").select("id, task_id, done_on, cost::text, note, vendor_id, upkeep_tasks(name)")
      : supabase.from("upkeep_log_member").select("id, task_id, done_on, note, task_name")
    )
      .order("done_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null }>,
    supabase.from(seesMoney ? "upkeep_tasks" : "upkeep_tasks_member").select("id", { count: "exact", head: true }).eq("is_active", false),
    isBoard
      ? supabase.from("tickets").select("id, reference, upkeep_task_id").not("upkeep_task_id", "is", null).not("status", "in", '("resolved","closed")')
      : Promise.resolve({ data: [] as { id: string; reference: number; upkeep_task_id: string }[] }),
  ]);

  const list = tasks ?? [];
  // Contractor names are read by id, not embedded: a property manager has no vendors table (0081).
  const names = seesMoney
    ? await vendorNames(supabase, [...list.map((t) => t.vendor_id as string | null), ...(recentLog ?? []).map((l) => l.vendor_id as string | null)], viewer.canReadFinancials)
    : new Map<string, string>();
  const vendorOptions = (vendors ?? []).map((v) => ({ id: v.id as string, name: v.name as string }));
  const ticketByTask = new Map((openTickets ?? []).map((t) => [t.upkeep_task_id as string, { id: t.id as string, reference: t.reference as number }]));

  const rows: ScheduleRow[] = list.map((t) => {
    const vendorName = seesMoney ? (names.get((t.vendor_id as string | null) ?? "") ?? null) : null;
    const parts = [
      cadenceWords(t.interval_months as number, (t.due_month as number | null) ?? null),
      t.trade ? tradeLabel(t.trade as string) : null,
      seesMoney ? (vendorName ?? "No usual contractor") : null,
      seesMoney && t.estimated_cost ? `about ${moneyText(t.estimated_cost as string)}` : null,
      t.last_done_on ? `last done ${humanDate(t.last_done_on as string, today)}` : "not done yet",
    ].filter(Boolean);
    return {
      id: t.id as string,
      name: t.name as string,
      description: (t.description as string | null) ?? null,
      interval_months: t.interval_months as number,
      due_month: (t.due_month as number | null) ?? null,
      next_due_on: t.next_due_on as string,
      trade: (t.trade as string | null) ?? null,
      // Costs and the usual contractor go to the client only for people allowed to see them.
      vendor_id: isBoard ? ((t.vendor_id as string | null) ?? null) : null,
      estimated_cost: seesMoney ? ((t.estimated_cost as string | null) ?? null) : null,
      when: whenLabel(t.next_due_on as string, (t.due_month as number | null) ?? null, today),
      line: parts.join(" · "),
      openTicket: ticketByTask.get(t.id as string) ?? null,
    };
  });

  const answer = upkeepAnswer(rows, today);
  const groups = groupUpkeep(rows, today);
  const shownGroups = [
    { key: "overdue", label: "Overdue", tone: "bad" as const, rows: show === "soon" ? [] : groups.overdue },
    { key: "soon", label: "Next 60 days", tone: "normal" as const, rows: show === "overdue" ? [] : groups.soon },
    { key: "later", label: "Later", tone: "normal" as const, rows: show === "all" ? groups.later : [] },
  ];
  const nothingShown = shownGroups.every((g) => g.rows.length === 0);

  if (list.length === 0) {
    return (
      <div className="space-y-6">
        <Card navy title={isBoard ? "Upkeep schedule" : "Building care calendar"}>
          {isBoard ? (
            <div className="space-y-4 py-2">
              <p className="text-[13px] text-mute">
                Nothing on the calendar yet. Most buildings have the same dozen jobs each year. Start from that list, or add your own.
              </p>
              <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
                <TemplatePicker existingNames={[]} primary />
                <AddTaskButton vendors={vendorOptions} todayIso={today} />
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-mute">The board hasn&rsquo;t set up the upkeep schedule yet.</p>
          )}
        </Card>
        {(archivedCount ?? 0) > 0 ? <ArchivedLink n={archivedCount ?? 0} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {answer ? <DismissibleOnceAnswer key={answer.headline} status={answer.status} headline={answer.headline} detail={answer.detail} /> : null}

      {/* One row: how to look at the schedule on the left, what to do with it on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {layout === "list" ? (
            <nav aria-label="Show" className="inline-flex rounded-full border border-line bg-paper p-0.5">
              {FILTERS.map((f) => (
                <Link
                  key={f.key}
                  href={upkeepHref({ show: f.key, layout: "list" })}
                  aria-current={show === f.key ? "page" : undefined}
                  className={`inline-flex min-h-[40px] items-center rounded-full px-4 text-[13px] font-medium ${show === f.key ? "bg-ink text-paper" : "text-mute hover:text-ink"}`}
                >
                  {f.label}
                </Link>
              ))}
            </nav>
          ) : null}
          <nav aria-label="Layout" className="inline-flex rounded-full border border-line bg-paper p-0.5">
            {(["list", "calendar"] as const).map((l) => (
              <Link
                key={l}
                href={upkeepHref({ layout: l, show, month })}
                aria-current={layout === l ? "page" : undefined}
                className={`inline-flex min-h-[40px] items-center rounded-full px-4 text-[13px] font-medium ${layout === l ? "bg-ink text-paper" : "text-mute hover:text-ink"}`}
              >
                {l === "list" ? "List" : "Calendar"}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddToCalendarMenu buttonClass={btnSecondary} />
        </div>
      </div>

      <Card navy
        title={isBoard ? "Upkeep schedule" : "Building care calendar"}
        action={
          isBoard ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <AddTaskButton vendors={vendorOptions} todayIso={today} buttonClass={HEADER_BUTTON} />
              <TemplatePicker existingNames={list.map((t) => t.name as string)} buttonClass={HEADER_BUTTON} />
            </div>
          ) : null
        }
        hint={
          isBoard
            ? "What, how often, who usually does it. Mark a job done and the next date rolls forward."
            : "What the board keeps up with each year. If a job needs access to your unit, the board will let you know."
        }
      >
        {layout === "calendar" ? (
          <UpkeepCalendar
            tasks={list.map((t) => ({ id: t.id as string, name: t.name as string, next_due_on: t.next_due_on as string, interval_months: t.interval_months as number, due_month: (t.due_month as number | null) ?? null }))}
            todayIso={today}
            month={month}
            hrefFor={(m) => upkeepHref({ layout: "calendar", month: m })}
          />
        ) : nothingShown ? (
          <p className="text-[13px] text-mute">{show === "overdue" ? "Nothing is overdue." : "Nothing due in the next 60 days."}</p>
        ) : (
          <UpkeepSchedule groups={shownGroups} isBoard={isBoard} vendors={vendorOptions} todayIso={today} />
        )}
      </Card>

      {(recentLog ?? []).length > 0 ? (
        <Card navy title="Recently done">
          <ul className="divide-y divide-line text-[13px]">
            {(recentLog ?? []).map((l) => {
              const task = seesMoney ? one(l.upkeep_tasks as { name: string } | { name: string }[] | null) : { name: (l.task_name as string | null) ?? "" };
              const vendorName = seesMoney ? (names.get((l.vendor_id as string | null) ?? "") ?? null) : null;
              return (
                <li key={l.id as string} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <Link href={`/repairs/upkeep/${l.task_id as string}`} className={linkClass}>
                      {task?.name ?? "Upkeep job"}
                    </Link>
                    <span className="ml-2 text-[12px] text-mute">
                      {humanDate(l.done_on as string, today)}
                      {vendorName ? ` · ${vendorName}` : ""}
                      {l.note ? ` · ${l.note as string}` : ""}
                    </span>
                  </span>
                  {seesMoney && l.cost ? <span className="figures text-ink">{moneyText(l.cost as string)}</span> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <div className="space-y-1 text-[13px]">
        {(archivedCount ?? 0) > 0 ? <ArchivedLink n={archivedCount ?? 0} /> : null}
        {viewer.canReadFinancials ? (
          <p className="text-mute">
            Regular bills and service contracts are on the{" "}
            <Link href="/repairs?view=bills" className={linkClass}>
              Bills tab
            </Link>
            .
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ArchivedLink({ n }: { n: number }) {
  return (
    <Link href="/repairs?view=upkeep&archived=1" className={btnLink}>
      Archived jobs ({n})
    </Link>
  );
}

async function ArchivedJobs({ supabase, isBoard, seesMoney }: { supabase: Supabase; isBoard: boolean; seesMoney: boolean }) {
  const { data } = await supabase
    .from(seesMoney ? "upkeep_tasks" : "upkeep_tasks_member")
    .select("id, name, interval_months, due_month, last_done_on")
    .eq("is_active", false)
    .order("name");
  const rows = data ?? [];
  return (
    <div className="space-y-4">
      <Link href="/repairs?view=upkeep" className="inline-flex min-h-[44px] items-center text-[13px] text-mute hover:underline">
        ← Upkeep schedule
      </Link>
      <Card navy title="Archived jobs" hint="Off the schedule, with their history kept.">
        {rows.length === 0 ? (
          <p className="text-[13px] text-mute">No archived jobs.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((t) => (
              <li key={t.id as string} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/repairs/upkeep/${t.id as string}`} className="text-[14px] font-medium text-ink underline-offset-2 hover:underline">
                    {t.name as string}
                  </Link>
                  <p className="text-[12px] text-mute">{cadenceWords(t.interval_months as number, (t.due_month as number | null) ?? null)}</p>
                </div>
                {isBoard ? <ArchiveTaskButton taskId={t.id as string} archived /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
