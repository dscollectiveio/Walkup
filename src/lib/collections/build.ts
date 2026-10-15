import { suggest, type CollectionUnit, type LastResult } from "./suggest";

/**
 * Turns the rows the Collections page reads into one CollectionUnit per unit
 * that is behind (money spec 8.1). Pure: every date is text, every amount is
 * integer cents. The caller converts the numeric the database sends with
 * centsFromNumeric.
 */

/** PostgREST sends numeric(14,2) as a JSON number. Two decimals round-trip exactly through Math.round(x * 100) at any realistic size. */
export function centsFromNumeric(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return Math.round(Number(v) * 100);
}

export interface RawCharge {
  id: string;
  unit_id: string;
  charge_type: "assessment" | "special_assessment" | "late_fee" | "other";
  due_on: string;
  balanceCents: number;
}

export interface RawOwner {
  unit_id: string;
  person_id: string;
  full_name: string;
  email: string | null;
}

export interface RawMessage {
  unit_ids: string[];
  kind: string;
  status: string;
  provider_message_id: string | null;
  /** When it went out, or was claimed or queued; ISO timestamp. */
  at: string | null;
}

export interface CollectionsInput {
  todayIso: string;
  units: { id: string; label: string }[];
  charges: RawCharge[];
  owners: RawOwner[];
  messages: RawMessage[];
  /** Lower-case addresses on the association's block list, with why. */
  suppressed: Map<string, "bounce" | "complaint">;
  /** People who turned off dues reminders or everything. */
  optedOutPersonIds: Set<string>;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

function addDays(iso: string, n: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

const WENT_OUT = new Set(["sent", "delivered", "bounced", "complained"]);

function resultOf(m: RawMessage): LastResult {
  if (m.status === "bounced") return "bounced";
  if (m.status === "complained") return "complained";
  if (m.provider_message_id?.startsWith("manual:")) return "by_hand";
  if (m.status === "delivered") return "delivered";
  return "sent";
}

export function buildCollections(input: CollectionsInput): CollectionUnit[] {
  const { todayIso } = input;
  const out: CollectionUnit[] = [];

  for (const unit of input.units) {
    const charges = input.charges.filter((c) => c.unit_id === unit.id && c.balanceCents > 0);
    if (charges.length === 0) continue;

    const aging = { current: 0, d1_30: 0, d31_60: 0, d60plus: 0 };
    let owed = 0;
    let overdue = 0;
    let oldest: string | null = null;
    for (const c of charges) {
      const d = Math.max(0, daysBetween(c.due_on, todayIso));
      owed += c.balanceCents;
      if (d === 0) aging.current += c.balanceCents;
      else {
        overdue += c.balanceCents;
        if (d <= 30) aging.d1_30 += c.balanceCents;
        else if (d <= 60) aging.d31_60 += c.balanceCents;
        else aging.d60plus += c.balanceCents;
        if (oldest === null || c.due_on < oldest) oldest = c.due_on;
      }
    }
    if (overdue <= 0) continue; // the page lists units that are behind
    const daysOverdue = oldest ? Math.max(0, daysBetween(oldest, todayIso)) : 0;

    const owners = input.owners.filter((o) => o.unit_id === unit.id);
    const withEmail = owners.filter((o) => (o.email ?? "").trim() !== "");
    const blocked = (o: RawOwner) => input.suppressed.get((o.email ?? "").toLowerCase());
    const bouncedAll = withEmail.length > 0 && withEmail.every((o) => blocked(o) === "bounce");
    const remaining = withEmail.filter((o) => !blocked(o));
    const optedOutAll =
      !bouncedAll && remaining.length > 0 && remaining.every((o) => input.optedOutPersonIds.has(o.person_id));

    const reminders = input.messages
      .filter((m) => m.kind === "dues_reminder" && m.unit_ids.includes(unit.id) && WENT_OUT.has(m.status) && m.at)
      .sort((a, b) => (a.at! < b.at! ? 1 : -1));
    const last = reminders[0] ?? null;
    const lastOn = last?.at ? last.at.slice(0, 10) : null;
    const sinceOldest = oldest ? reminders.filter((m) => m.at!.slice(0, 10) >= oldest!) : reminders;
    const capped = lastOn && daysBetween(lastOn, todayIso) < 7 ? addDays(lastOn, 7) : null;

    const fees = charges
      .filter((c) => c.charge_type === "late_fee")
      .sort((a, b) => (a.due_on < b.due_on ? 1 : -1));

    const base: Omit<CollectionUnit, "suggestion"> = {
      unitId: unit.id,
      label: unit.label,
      ownerNames: owners.map((o) => o.full_name),
      owedCents: owed,
      overdueCents: overdue,
      oldestOverdueOn: oldest,
      daysOverdue,
      aging,
      lastReminderOn: lastOn,
      remindersSent: sinceOldest.length,
      lastResult: last ? resultOf(last) : null,
      hasEmail: withEmail.length > 0,
      optedOut: optedOutAll,
      bounced: bouncedAll || (last ? last.status === "bounced" : false),
      cappedUntil: capped,
      openLateFeeChargeId: fees[0]?.id ?? null,
      openLateFeeCents: fees[0]?.balanceCents ?? 0,
    };
    out.push({ ...base, suggestion: suggest(base, todayIso) });
  }

  return out.sort((a, b) => b.overdueCents - a.overdueCents || a.label.localeCompare(b.label, undefined, { numeric: true }));
}
