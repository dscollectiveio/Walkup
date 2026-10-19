import "server-only";
import type { Supabase } from "@/lib/repairs/server";
import { buildCollections, centsFromNumeric, type RawCharge, type RawMessage, type RawOwner } from "./build";
import type { CollectionUnit } from "./suggest";

/**
 * What the Collections page and the rule preview read, through the caller's
 * own client (RLS decides what each role sees: the board reads the outbox and
 * block list, an accountant reads balances only).
 */
export interface CollectionsData {
  units: CollectionUnit[];
  rawUnits: { id: string; label: string }[];
  charges: RawCharge[];
  owners: RawOwner[];
  messages: RawMessage[];
  suppressed: Map<string, "bounce" | "complaint">;
  optedOutPersonIds: Set<string>;
  /** Total owed and overdue across the units listed, in cents. */
  totals: { owedCents: number; overdueCents: number };
}

export async function loadCollections(supabase: Supabase, associationId: string, todayIso: string, opts: { board: boolean }): Promise<CollectionsData | null> {
  const [unitsRes, chargesRes, ownersRes, managersRes] = await Promise.all([
    supabase.from("units").select("id, label, sort_order").order("sort_order"),
    supabase
      .from("charge_balances")
      .select("id, unit_id, charge_type, due_on, balance, status")
      .in("status", ["open", "partial"]),
    supabase
      .from("unit_owners")
      .select("unit_id, person_id, effective_to, persons(full_name, email)")
      .or(`effective_to.is.null,effective_to.gte.${todayIso}`),
    // The unit's property manager, when the board made them the main contact (0066).
    supabase
      .from("unit_property_managers")
      .select("unit_id, person_id, persons(full_name, email)")
      .eq("main_contact", "manager"),
  ]);
  if (unitsRes.error || chargesRes.error) {
    console.error("[collections] load", unitsRes.error?.code ?? chargesRes.error?.code ?? "-");
    return null;
  }

  const rawUnits = (unitsRes.data ?? []).map((u) => ({ id: u.id as string, label: u.label as string }));
  const charges: RawCharge[] = (chargesRes.data ?? []).map((c) => ({
    id: c.id as string,
    unit_id: c.unit_id as string,
    charge_type: c.charge_type as RawCharge["charge_type"],
    due_on: c.due_on as string,
    balanceCents: centsFromNumeric(c.balance as number | string),
  }));
  const ownerRows: RawOwner[] = (ownersRes.data ?? []).flatMap((o) => {
    const p = o.persons as unknown as { full_name: string; email: string | null } | null;
    return p ? [{ unit_id: o.unit_id as string, person_id: o.person_id as string, full_name: p.full_name, email: p.email }] : [];
  });
  // Walkup's email for a unit goes to its manager, not its owners, when the manager is the main
  // contact and has an email. The database makes the same choice (email_contact_person), so this
  // only keeps what the page predicts in step with what is sent.
  const managerFor = new Map<string, RawOwner>();
  for (const m of managersRes.data ?? []) {
    const p = m.persons as unknown as { full_name: string; email: string | null } | null;
    if (p && (p.email ?? "").trim() !== "" && ownerRows.some((o) => o.unit_id === (m.unit_id as string))) {
      managerFor.set(m.unit_id as string, { unit_id: m.unit_id as string, person_id: m.person_id as string, full_name: p.full_name, email: p.email });
    }
  }
  const owners: RawOwner[] = [
    ...ownerRows.filter((o) => !managerFor.has(o.unit_id)),
    ...managerFor.values(),
  ];

  let messages: RawMessage[] = [];
  const suppressed = new Map<string, "bounce" | "complaint">();
  const optedOutPersonIds = new Set<string>();
  if (opts.board) {
    const [outbox, block, optouts] = await Promise.all([
      supabase
        .from("email_outbox")
        .select("unit_ids, kind, status, provider_message_id, sent_at, claimed_at, queued_at, created_at")
        .in("kind", ["dues_reminder"])
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase.from("email_suppressions").select("email, reason"),
      supabase.rpc("email_optouts", { p_association_id: associationId }),
    ]);
    messages = (outbox.data ?? []).map((m) => ({
      unit_ids: (m.unit_ids as string[]) ?? [],
      kind: m.kind as string,
      status: m.status as string,
      provider_message_id: (m.provider_message_id as string | null) ?? null,
      at: ((m.sent_at ?? m.claimed_at ?? m.queued_at ?? m.created_at) as string | null) ?? null,
    }));
    for (const s of block.data ?? []) suppressed.set((s.email as string).toLowerCase(), s.reason as "bounce" | "complaint");
    for (const o of (optouts.data ?? []) as { person_id: string; dues_reminders: boolean; unsubscribed_all: boolean }[]) {
      if (!o.dues_reminders || o.unsubscribed_all) optedOutPersonIds.add(o.person_id);
    }
  }

  const units = buildCollections({ todayIso, units: rawUnits, charges, owners, messages, suppressed, optedOutPersonIds });
  return {
    units,
    rawUnits,
    charges,
    owners,
    messages,
    suppressed,
    optedOutPersonIds,
    totals: {
      owedCents: units.reduce((s, u) => s + u.owedCents, 0),
      overdueCents: units.reduce((s, u) => s + u.overdueCents, 0),
    },
  };
}
