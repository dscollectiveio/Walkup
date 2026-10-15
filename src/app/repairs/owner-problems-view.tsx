import Link from "next/link";
import { Answer, Card } from "@/components/ui";
import { Pill, StatusPill } from "@/components/repairs/pills";
import { btnPrimary } from "@/components/repairs/styles";
import { humanDate, whereLabel } from "@/lib/repairs/format";
import { eventSentence, isDone, type Actor, type TicketEventRow } from "@/lib/repairs/labels";
import type { RepairsViewer } from "@/lib/repairs/page-data";
import { parseProblemParams } from "@/lib/repairs/problems-params";
import type { Supabase } from "@/lib/repairs/server";
import { MeTooButton } from "@/app/maintenance/[ticketId]/owner-actions";
import { loadProblems, type ProblemRow } from "./problems-data";

/**
 * Repairs for owners (repairs-spec §14.1): their reports, problems in their
 * unit, shared areas, and what changed since they last looked. Everything
 * comes through RLS and the narrow readers; owners never see costs, quotes or
 * the contractors table.
 */

const ROLE_ACTOR: Record<string, Actor> = {
  you: { kind: "you" },
  board: { kind: "board" },
  accountant: { kind: "accountant" },
  owner: { kind: "owner" },
};

function daysAgo(todayIso: string, n: number): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

export async function OwnerProblemsView({ supabase, viewer, since }: { supabase: Supabase; viewer: RepairsViewer; since: string | null }) {
  const today = viewer.todayIso;
  const me = viewer.personId;
  const all = parseProblemParams({ status: "all" }, viewer);
  const [rows, ownedRes, meTooRes] = await Promise.all([
    loadProblems(supabase, viewer, all, { mode: "list", status: "all", limit: 400 }),
    supabase.rpc("owned_unit_ids", { assoc: viewer.associationId }),
    me ? supabase.from("ticket_comments").select("ticket_id").eq("kind", "me_too").eq("person_id", me) : Promise.resolve({ data: [] }),
  ]);
  const owned = new Set<string>(((ownedRes.data as string[] | null) ?? []).map(String));
  const meToo = new Set<string>(((meTooRes.data ?? []) as { ticket_id: string }[]).map((r) => r.ticket_id));

  const mine = rows.filter((t) => me && t.reportedBy === me).sort((a, b) => Number(isDone(a.status)) - Number(isDone(b.status)) || b.createdAt.localeCompare(a.createdAt));
  const mineIds = new Set(mine.map((t) => t.id));
  const inUnit = rows.filter((t) => !mineIds.has(t.id) && t.unitId && owned.has(t.unitId) && !isDone(t.status));
  const shared = rows.filter((t) => !mineIds.has(t.id) && t.unitId === null && !isDone(t.status));
  const ninety = daysAgo(today, 90);
  const recentlyFixed = rows
    .filter((t) => isDone(t.status) && t.resolvedAt && t.resolvedAt.slice(0, 10) >= ninety && !mineIds.has(t.id))
    .sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""))
    .slice(0, 10);

  // What changed on their reports and their unit's problems, by someone else.
  const watched = [...mine, ...inUnit];
  const watchedIds = watched.map((t) => t.id);
  const byId = new Map(rows.map((t) => [t.id, t]));
  let updates: { ticket: ProblemRow; sentence: string; at: string }[] = [];
  let latest: { ticket: ProblemRow; sentence: string; at: string } | null = null;
  if (watchedIds.length) {
    const { data: events } = await supabase
      .from("ticket_events")
      .select("id, ticket_id, kind, from_value, to_value, data, created_at, actor_person_id")
      .in("ticket_id", watchedIds.slice(0, 200))
      .order("created_at", { ascending: false })
      .limit(60);
    const evs = (events ?? []) as unknown as (TicketEventRow & { ticket_id: string })[];
    const tickets = [...new Set(evs.slice(0, 20).map((e) => e.ticket_id))].slice(0, 6);
    const roles = new Map<string, string>();
    await Promise.all(
      tickets.map(async (id) => {
        const { data } = await supabase.rpc("ticket_event_actor_roles", { p_ticket_id: id });
        for (const r of (data ?? []) as { event_id: string; actor_role: string }[]) roles.set(r.event_id, r.actor_role);
      }),
    );
    const described = evs
      .filter((e) => tickets.includes(e.ticket_id))
      .map((e) => ({
        ticket: byId.get(e.ticket_id)!,
        sentence: eventSentence(e, ROLE_ACTOR[roles.get(e.id) ?? ""] ?? { kind: "unknown" }, today),
        at: e.created_at,
        mine: roles.get(e.id) === "you" || (me !== null && e.actor_person_id === me),
      }))
      .filter((x) => x.ticket);
    latest = described.find((x) => !isDone(x.ticket.status) && x.ticket.reportedBy === me) ?? described[0] ?? null;
    if (since) {
      const sinceMs = Date.parse(since);
      updates = described.filter((x) => !x.mine && Date.parse(x.at) > sinceMs).slice(0, 5);
    }
  }

  const openMine = mine.filter((t) => !isDone(t.status)).length;
  const nothing = rows.length === 0;

  return (
    <div className="space-y-6">
      <Answer
        status={openMine > 0 ? "neutral" : "good"}
        headline={openMine > 0 ? `You have ${openMine} open ${openMine === 1 ? "report" : "reports"}` : "Nothing you reported is open"}
        detail={latest ? `#${latest.ticket.reference} ${latest.ticket.title}: ${latest.sentence}` : undefined}
      />

      {updates.length > 0 ? (
        <Card navy title="Updates since you last looked">
          <ul className="space-y-2">
            {updates.map((u, i) => (
              <li key={`${u.ticket.id}-${i}`} className="text-[14px]">
                <Link href={`/maintenance/${u.ticket.id}`} className="text-ink underline-offset-2 hover:underline">
                  #{u.ticket.reference} {u.ticket.title}: {u.sentence}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {nothing ? (
        <p className="rounded-xl border border-dashed border-line-strong bg-paper px-5 py-8 text-center text-[14px] text-mute">
          Nothing has been reported yet. If something&rsquo;s broken, report it and the board sees it here and takes it from there.
        </p>
      ) : null}

      {mine.length > 0 ? (
        <Card navy title="Your reports">
          <OwnerList rows={mine} viewer={viewer} />
        </Card>
      ) : null}
      {inUnit.length > 0 ? (
        <Card navy title="In your unit">
          <OwnerList rows={inUnit} viewer={viewer} />
        </Card>
      ) : null}
      {shared.length > 0 ? (
        <Card navy title="Shared areas">
          <OwnerList rows={shared} viewer={viewer} meToo={meToo} />
        </Card>
      ) : null}
      {recentlyFixed.length > 0 ? (
        <Card navy title="Recently fixed">
          <OwnerList rows={recentlyFixed} viewer={viewer} />
        </Card>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {nothing && viewer.canReport ? (
          <Link href="/repairs/report" className={`${btnPrimary} w-full sm:w-auto`}>
            Report a problem
          </Link>
        ) : (
          <span />
        )}
        <Link href="/repairs/emergency-info" className="inline-flex min-h-[44px] items-center text-[14px] text-ink underline underline-offset-2">
          What to do in an emergency
        </Link>
      </div>
    </div>
  );
}

/** Line 3 of a row (§14.1), first that applies. */
function progressLine(t: ProblemRow, todayIso: string): string | null {
  if (t.status === "resolved" && t.resolvedAt && t.resolvedAt.slice(0, 10) >= daysAgo(todayIso, 30)) {
    return `Fixed ${humanDate(t.resolvedAt.slice(0, 10), todayIso)}: is it fixed?`;
  }
  if (isDone(t.status)) return null;
  if (t.scheduledFor && t.scheduledFor >= todayIso) {
    return `Visit planned for ${humanDate(t.scheduledFor, todayIso)}${t.scheduledWindow ? `, ${t.scheduledWindow}` : ""}`;
  }
  if ((t.status === "in_progress" || t.status === "waiting_on_contractor") && t.contractorName) return `${t.contractorName} is handling it`;
  if (t.contractorName && t.status === "open") return `The board chose ${t.contractorName} for this.`;
  return null;
}

function OwnerList({ rows, viewer, meToo }: { rows: ProblemRow[]; viewer: RepairsViewer; meToo?: Set<string> }) {
  const today = viewer.todayIso;
  return (
    <ul className="divide-y divide-line">
      {rows.map((t) => {
        const line3 = progressLine(t, today);
        const canMeToo = meToo && viewer.canReport && t.reportedBy !== viewer.personId && !isDone(t.status);
        return (
          <li key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link href={`/maintenance/${t.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                  {t.title}
                </Link>
                <StatusPill status={t.status} />
                {t.priority === "urgent" && !isDone(t.status) ? <Pill tone="bad">Urgent</Pill> : null}
              </div>
              <p className="mt-1 text-[13px] text-mute">
                #{t.reference} · {whereLabel(t.unitLabel, t.locationDetail)} · reported {humanDate(t.openedOn, today)}
              </p>
              {line3 ? (
                line3.endsWith("is it fixed?") ? (
                  <Link href={`/maintenance/${t.id}`} className="mt-1 inline-block text-[13px] text-good-text underline underline-offset-2">
                    {line3}
                  </Link>
                ) : (
                  <p className="mt-1 text-[13px] text-ink">{line3}</p>
                )
              ) : null}
            </div>
            {canMeToo ? (
              <div className="shrink-0">
                <MeTooButton ticketId={t.id} already={meToo.has(t.id)} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
