import { humanDate } from "@/lib/repairs/format";
import { STATUS_LABEL, type TicketStatus } from "@/lib/repairs/labels";

// Pure half of the portal's repairs summary (owner-portal-spec 4.5); the query is in repairs-summary.ts.

export interface OwnerRepairsSummary {
  /** Reports the owner made that are not resolved or closed. */
  open: number;
  /** Their reports marked fixed within the last 30 days that they have not confirmed. */
  waitingOnYou: number;
  latest: { id: string; reference: number; title: string; status: string; line: string } | null;
}

export interface TicketGlance {
  id: string;
  reference: number;
  title: string;
  status: TicketStatus;
  resolved_at: string | null;
  scheduled_for: string | null;
  scheduled_window: string | null;
  updated_at: string;
}

function daysBetween(fromIso: string, toIso: string): number {
  const f = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const t = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((t - f) / 86_400_000);
}

/** Pure: the line under the latest report, in repairs-spec 14.1 order of precedence. */
export function glanceLine(t: TicketGlance, todayIso: string): string {
  if (t.status === "resolved" && t.resolved_at && daysBetween(t.resolved_at, todayIso) <= 30) {
    return `Fixed ${humanDate(t.resolved_at, todayIso)}: is it fixed?`;
  }
  if (t.scheduled_for && t.scheduled_for >= todayIso && t.status !== "closed" && t.status !== "resolved") {
    return `Visit planned for ${humanDate(t.scheduled_for, todayIso)}${t.scheduled_window ? `, ${t.scheduled_window}` : ""}`;
  }
  return STATUS_LABEL[t.status] ?? t.status;
}

/** Pure: counts and the latest line from the owner's reports, newest update first. */
export function summariseRepairs(rows: TicketGlance[], todayIso: string): OwnerRepairsSummary {
  const open = rows.filter((t) => t.status !== "resolved" && t.status !== "closed").length;
  const waitingOnYou = rows.filter(
    (t) => t.status === "resolved" && t.resolved_at !== null && daysBetween(t.resolved_at, todayIso) <= 30,
  ).length;
  const latest = rows[0] ?? null;
  return {
    open,
    waitingOnYou,
    latest: latest
      ? {
          id: latest.id,
          reference: latest.reference,
          title: latest.title,
          status: latest.status,
          line: glanceLine(latest, todayIso),
        }
      : null,
  };
}

