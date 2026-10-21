import { taxFlag, vendorColumns, vendorRows, vendorSource } from "@/lib/contractors/vendor-source";
import { vendorNames } from "@/lib/contractors/vendor-names";
import Link from "next/link";
import { Card } from "@/components/ui";
import { complianceFor } from "@/lib/contractors/compliance";
import { tradeBySlug } from "@/lib/contractors/trades";
import { moneyText, whereLabel } from "@/lib/repairs/format";
import type { RepairsViewer } from "@/lib/repairs/page-data";
import type { Supabase } from "@/lib/repairs/server";
import {
  buildToday,
  recordedRepairCosts,
  TODAY_SECTION_TITLE,
  type TodayItem,
  type TodaySection,
  type TodayTicket,
} from "@/lib/repairs/today";
import { parseStoredTriage } from "@/lib/repairs/validate";
import { fromCents } from "@/lib/tax/form1120h";
import type { TicketPriority, TicketStatus } from "@/lib/repairs/labels";
import { CloseAllButton } from "./board-pieces";

/**
 * Today (repairs-spec §15.1), board only: emergencies, what's new since the
 * last visit, what needs a decision, visits this week, overdue, coming up,
 * and fixed problems ready to close. The rules live in buildToday (pure,
 * tested); this file only loads rows.
 */

/** The sections the Problems tab shows at the top. "Needs a decision", "Coming up" and "Ready to close" are left out. */
const SHOWN_SECTIONS: readonly TodaySection[] = ["emergencies", "new", "visits", "overdue"];

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export async function TodayView({ supabase, viewer, since }: { supabase: Supabase; viewer: RepairsViewer; since: string | null }) {
  const today = viewer.todayIso;
  const year = Number(today.slice(0, 4));
  const sinceIso = since ?? `${addDays(today, -7)}T00:00:00Z`;
  const fourteenAgo = `${addDays(today, -14)}T00:00:00Z`;

  const [ticketsRes, reopenedRes, unsentRes, tasksRes, vendorsRes, usedRes, bills, spentTickets, spentUpkeep] = await Promise.all([
    supabase
      .from("tickets")
      .select(
        "id, reference, title, status, priority, emergency_kind, unit_id, units(label), location_detail, opened_on, created_at, scheduled_for, scheduled_window, assigned_vendor_id, reported_by, resolved_at, ticket_board_details(due_on, triage, emergency_suggestion_dismissed_at), ticket_bids(status, valid_until)",
      )
      .or(`status.neq.closed,created_at.gt.${sinceIso}`)
      .order("created_at", { ascending: false })
      .limit(400),
    supabase.from("ticket_events").select("ticket_id, created_at").eq("kind", "reopened").gte("created_at", fourteenAgo),
    supabase.from("contractor_messages").select("id", { count: "exact", head: true }).eq("kind", "quote_request").eq("status", "draft"),
    supabase.from("upkeep_tasks").select("id, name, next_due_on, vendor_id").eq("is_active", true),
    supabase
      // A property manager reads contractors through vendors_manager, which has no W-9 or tax columns (0081).
      .from(vendorSource(viewer.canReadFinancials))
      .select(
        vendorColumns(
          "id, name, status, archived_at, trades, insured_until, license_number, license_expires_on, w9_on_file, is_1099_exempt, last_used_on",
          viewer.canReadFinancials,
        ),
      )
      .is("archived_at", null)
      .neq("status", "do_not_use"),
    supabase.from("tickets").select("assigned_vendor_id, status, opened_on").not("assigned_vendor_id", "is", null),
    supabase.from("recurring_bills").select("id, name, next_due_on, autopay_arranged, paused_at").eq("is_active", true),
    supabase
      .from("tickets")
      .select("resolved_at, ticket_board_details!inner(actual_cost::text)")
      .gte("resolved_at", `${year}-01-01`)
      .not("ticket_board_details.actual_cost", "is", null),
    supabase.from("upkeep_log").select("cost::text, done_on, ticket_id").gte("done_on", `${year}-01-01`).is("ticket_id", null),
  ]);

  const reopened = new Map<string, string>();
  for (const e of reopenedRes.data ?? []) {
    const prev = reopened.get(e.ticket_id as string);
    if (!prev || (e.created_at as string) > prev) reopened.set(e.ticket_id as string, e.created_at as string);
  }

  // The assigned contractor's name: read by id, not embedded in the tickets query (a manager has no vendors table).
  const contractorNames = await vendorNames(
    supabase,
    (ticketsRes.data ?? []).map((r) => r.assigned_vendor_id as string | null),
    viewer.canReadFinancials,
  );

  const in7 = addDays(today, 7);
  const tickets: TodayTicket[] = (ticketsRes.data ?? []).map((r) => {
    const bd = one(r.ticket_board_details as unknown as Record<string, unknown> | Record<string, unknown>[] | null) as Record<string, unknown> | null;
    const triage = parseStoredTriage(bd?.triage);
    const bids = (r.ticket_bids as { status: string; valid_until: string | null }[] | null) ?? [];
    const expiring = bids
      .filter((b) => b.status === "received" && b.valid_until && b.valid_until >= today && b.valid_until <= in7)
      .map((b) => b.valid_until as string)
      .sort();
    return {
      id: r.id as string,
      reference: r.reference as number,
      title: r.title as string,
      status: r.status as TicketStatus,
      priority: r.priority as TicketPriority,
      emergency_kind: (r.emergency_kind as string | null) ?? null,
      due_on: (bd?.due_on as string | null) ?? null,
      scheduled_for: (r.scheduled_for as string | null) ?? null,
      scheduled_window: (r.scheduled_window as string | null) ?? null,
      assigned_vendor_id: (r.assigned_vendor_id as string | null) ?? null,
      contractor_name: contractorNames.get((r.assigned_vendor_id as string | null) ?? "") ?? null,
      resolved_at: (r.resolved_at as string | null) ?? null,
      opened_on: r.opened_on as string,
      created_at: r.created_at as string,
      reporter_is_me: Boolean(viewer.personId && r.reported_by === viewer.personId),
      where: whereLabel((one(r.units as unknown as { label: string } | null)?.label as string | undefined) ?? null, (r.location_detail as string | null) ?? null),
      triage_emergency: triage?.state === "done" ? (triage.emergency ?? null) : null,
      emergency_suggestion_dismissed_at: (bd?.emergency_suggestion_dismissed_at as string | null) ?? null,
      triage_at: triage?.at ?? null,
      bids: {
        requested: bids.filter((b) => b.status === "requested").length,
        received: bids.filter((b) => b.status === "received").length,
        accepted: bids.filter((b) => b.status === "accepted").length,
        expiringSoon: expiring.length,
        expiringOn: expiring[0] ?? null,
      },
      reopenedAt: reopened.get(r.id as string) ?? null,
    };
  });

  // Contractors in use: on an open problem, an active upkeep job's usual one, or used in the last year.
  const openUse = new Set<string>();
  const lastUse = new Map<string, string>();
  for (const u of usedRes.data ?? []) {
    const id = u.assigned_vendor_id as string;
    if (u.status !== "resolved" && u.status !== "closed") openUse.add(id);
    const prev = lastUse.get(id);
    if (!prev || (u.opened_on as string) > prev) lastUse.set(id, u.opened_on as string);
  }
  const upkeepUse = new Set((tasksRes.data ?? []).map((t) => t.vendor_id as string | null).filter(Boolean) as string[]);
  const yearAgo = addDays(today, -365);
  const contractors = vendorRows(vendorsRes.data)
    .map((v) => {
      const id = v.id as string;
      const last = [v.last_used_on as string | null, lastUse.get(id) ?? null].filter(Boolean).sort().pop() ?? null;
      const inUse = openUse.has(id) || upkeepUse.has(id) || Boolean(last && last >= yearAgo);
      const trades = (v.trades as string[] | null) ?? [];
      return {
        id,
        name: v.name as string,
        inUse,
        compliance: complianceFor(
          {
            insured_until: (v.insured_until as string | null) ?? null,
            license_number: (v.license_number as string | null) ?? null,
            license_expires_on: (v.license_expires_on as string | null) ?? null,
            // Not shown to a property manager, so never read as "missing".
            w9_on_file: taxFlag(v.w9_on_file, viewer.canReadFinancials),
            is_1099_exempt: taxFlag(v.is_1099_exempt, viewer.canReadFinancials),
            status: v.status as string,
            archived_at: null,
            inUse,
            tradeNeedsLicense: trades.some((s) => tradeBySlug(s)?.licenseTypical),
          },
          today,
        ).items,
      };
    })
    .filter((c) => c.inUse);

  const spending = recordedRepairCosts({
    year,
    tickets: (spentTickets.data ?? []).map((t) => ({
      resolved_at: (t.resolved_at as string | null) ?? null,
      actual_cost: (one(t.ticket_board_details as unknown as { actual_cost: string | null } | null)?.actual_cost as string | null) ?? null,
    })),
    upkeepLog: (spentUpkeep.data ?? []).map((l) => ({ cost: (l.cost as string | null) ?? null, done_on: l.done_on as string, ticket_id: (l.ticket_id as string | null) ?? null })),
  });

  const { sections, stats } = buildToday({
    todayIso: today,
    since,
    tickets,
    unsentQuoteRequests: unsentRes.count ?? 0,
    tasks: (tasksRes.data ?? []).map((t) => ({ id: t.id as string, name: t.name as string, next_due_on: t.next_due_on as string })),
    contractors,
    bills: ((bills.data ?? []) as Record<string, unknown>[]).map((b) => ({
      id: b.id as string,
      name: b.name as string,
      next_due_on: (b.next_due_on as string | null) ?? null,
      autopay_arranged: b.autopay_arranged === true,
      paused_at: (b.paused_at as string | null) ?? null,
    })),
    spending,
  });

  const shownEmpty = SHOWN_SECTIONS.every((s) => sections[s].length === 0);

  return (
    <div className="space-y-6">
      <section aria-label="Repairs at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCell
          label="Open problems"
          value={String(stats.open)}
          bad={stats.urgent > 0}
          note={
            stats.open > 0
              ? `Reported and not yet fixed or closed.${stats.urgent > 0 ? ` ${stats.urgent} marked urgent.` : ""}`
              : "Nothing open. When someone reports a problem, it shows up here."
          }
        />
        <StatCell
          label="Upkeep overdue"
          value={String(stats.upkeepOverdue)}
          bad={stats.upkeepOverdue > 0}
          note={
            stats.upkeepOverdue > 0
              ? "Regular upkeep jobs that are past their due date."
              : "Nothing overdue. Upkeep is your calendar of regular jobs, like boiler service."
          }
          link={stats.upkeepOverdue > 0 ? undefined : { href: "/repairs?view=upkeep", label: "See or add upkeep" }}
        />
        <StatCell
          label="Visits this week"
          value={String(stats.visitsThisWeek)}
          note={
            stats.visitsThisWeek > 0
              ? "Contractor visits planned in the next 7 days."
              : "No visits planned. Pick a contractor and set a visit date on a problem to see it here."
          }
        />
        <StatCell
          label="Repair costs this year"
          value={moneyText(fromCents(stats.recordedCostsCents)) || "$0"}
          note={
            stats.recordedCostsCents > 0
              ? "Final costs recorded on finished problems and upkeep. Not the payments in the books."
              : "Nothing recorded yet. Enter a final cost on a problem you finish, and it totals here."
          }
        />
      </section>

      {shownEmpty ? null : (
        SHOWN_SECTIONS.filter((s) => sections[s].length > 0).map((s) =>
          s === "emergencies" ? (
            <section key={s} className="border-l-[3px] border-bad">
              <Card navy title={TODAY_SECTION_TITLE[s]}>
                <TodayList items={sections[s]} />
              </Card>
            </section>
          ) : (
            <Card navy key={s} title={TODAY_SECTION_TITLE[s]}>
              <TodayList items={sections[s]} />
            </Card>
          ),
        )
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  note,
  bad = false,
  link,
}: {
  label: string;
  value: string;
  note: string;
  bad?: boolean;
  link?: { href: string; label: string };
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-paper">
      <div className="band bg-ink px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-paper">{label}</div>
      <div className="px-4 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className={`figures text-[22px] leading-tight ${bad ? "text-bad-text" : "text-ink"}`}>{value}</div>
          {link ? (
            <Link href={link.href} className="shrink-0 text-[11px] font-medium text-ink underline underline-offset-2">
              {link.label}
            </Link>
          ) : null}
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-mute">{note}</p>
      </div>
    </div>
  );
}

function TodayList({ items }: { items: TodayItem[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((it) => (
        <li key={it.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Link href={it.href} className="text-[14px] font-medium text-ink underline-offset-2 hover:underline">
              {it.title}
            </Link>
            {it.detail ? <p className="mt-0.5 text-[13px] text-mute">{it.detail}</p> : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {it.ticketIds ? <CloseAllButton ids={it.ticketIds} /> : null}
            {it.action ? (
              <Link
                href={it.action.href}
                className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill"
              >
                {it.action.label}
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
