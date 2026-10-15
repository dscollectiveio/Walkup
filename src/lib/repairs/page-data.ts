import "server-only";
import { buildingTodayIso } from "@/lib/dates";
import type { BuildingEmergencyInfo } from "./emergency";
import type { Supabase } from "./server";

/**
 * Reads several Repairs pages share (repairs-spec §2, §5, §14): who is
 * looking, and the building's emergency facts. Everything goes through the
 * caller's own client, so RLS and the SECURITY DEFINER readers decide what
 * comes back.
 */

export interface RepairsViewer {
  associationId: string;
  displayName: string;
  isMember: boolean;
  isBoard: boolean;
  isAdmin: boolean;
  /** Board plus the accountant. */
  canReadFinancials: boolean;
  /** Board or owner: may report problems and add notes (the accountant is read-only in Repairs). */
  canReport: boolean;
  personId: string | null;
  todayIso: string;
}

export async function loadViewer(supabase: Supabase): Promise<RepairsViewer | null> {
  const { data: associations } = await supabase.from("associations").select("id, display_name, legal_name").limit(1);
  const a = associations?.[0];
  if (!a) return null;
  const assoc = a.id as string;
  const [member, board, admin, financials, reporter, person] = await Promise.all([
    supabase.rpc("is_member", { assoc }),
    supabase.rpc("is_board", { assoc }),
    supabase.rpc("has_role_in", { assoc, roles: ["board_admin"] }),
    supabase.rpc("can_read_financials", { assoc }),
    supabase.rpc("has_role_in", { assoc, roles: ["board_admin", "board_member", "owner"] }),
    supabase.rpc("current_person_id", { assoc }),
  ]);
  return {
    associationId: assoc,
    displayName: ((a.display_name as string | null)?.trim() || (a.legal_name as string | null)?.trim() || "your building"),
    isMember: member.data === true,
    isBoard: board.data === true,
    isAdmin: admin.data === true,
    canReadFinancials: financials.data === true,
    canReport: reporter.data === true,
    personId: typeof person.data === "string" ? person.data : null,
    todayIso: buildingTodayIso(),
  };
}

export interface EmergencyContactRow {
  name: string;
  label: string | null;
  phone: string;
}

export interface EmergencyInfo {
  /** null when the board hasn't entered a single fact. */
  building: BuildingEmergencyInfo | null;
  contacts: EmergencyContactRow[];
  updatedAt: string | null;
}

const FACT_KEYS: (keyof BuildingEmergencyInfo)[] = [
  "water_shutoff_location",
  "gas_utility_name",
  "gas_emergency_phone",
  "electric_panel_location",
  "electric_utility_name",
  "electric_emergency_phone",
  "elevator_company_name",
  "elevator_company_phone",
  "other_notes",
];

/** building_emergency_info(): owners get the contacts marked show_to_owners; board and accountant all of them. */
export async function loadEmergencyInfo(supabase: Supabase, associationId: string): Promise<EmergencyInfo> {
  const { data, error } = await supabase.rpc("building_emergency_info", { p_association_id: associationId });
  if (error) {
    console.error("[repairs] building_emergency_info", error.code ?? "-", error.message ?? "");
    return { building: null, contacts: [], updatedAt: null };
  }
  const row = (Array.isArray(data) ? data[0] : data) as (Record<string, unknown> | undefined);
  if (!row) return { building: null, contacts: [], updatedAt: null };
  const building = Object.fromEntries(
    FACT_KEYS.map((k) => {
      const v = row[k];
      return [k, typeof v === "string" && v.trim() ? v.trim() : null];
    }),
  ) as unknown as BuildingEmergencyInfo;
  const any = FACT_KEYS.some((k) => building[k] !== null);
  const contacts = (Array.isArray(row.contacts) ? row.contacts : [])
    .map((c: { name?: unknown; label?: unknown; phone?: unknown }) => ({
      name: String(c?.name ?? "").trim(),
      label: typeof c?.label === "string" && c.label.trim() ? c.label.trim() : null,
      phone: String(c?.phone ?? "").trim(),
    }))
    .filter((c) => c.name && c.phone);
  return { building: any ? building : null, contacts, updatedAt: (row.updated_at as string | null) ?? null };
}

/** Board viewers: saved contractors who take emergency calls (the board says so), for the safety banner. */
export async function loadEmergencyContractors(
  supabase: Supabase,
): Promise<{ name: string; phone: string; trades: string[]; preferred: boolean }[]> {
  const { data } = await supabase
    .from("vendors")
    .select("name, phone, trades, status, archived_at, emergency_service")
    .eq("emergency_service", true)
    .is("archived_at", null)
    .neq("status", "do_not_use")
    .not("phone", "is", null)
    .order("name");
  return (data ?? [])
    .filter((v) => typeof v.phone === "string" && v.phone.trim())
    .map((v) => ({
      name: v.name as string,
      phone: (v.phone as string).trim(),
      trades: (v.trades as string[] | null) ?? [],
      preferred: v.status === "preferred",
    }));
}

/**
 * The "since" moment for "New since your last visit" (repairs-spec §15.1),
 * read the same way mark_repairs_seen() decides it: a visit is a 30-minute
 * window, so inside it the previous visit counts; after it, the last one.
 * The page's client island then records this visit.
 */
export async function loadRepairsSince(supabase: Supabase, associationId: string): Promise<string | null> {
  const { data } = await supabase.from("repairs_seen").select("seen_at, prev_seen_at").eq("association_id", associationId).limit(1);
  const row = data?.[0];
  if (!row) return null;
  const seen = Date.parse(row.seen_at as string);
  return Date.now() - seen < 30 * 60_000 ? ((row.prev_seen_at as string | null) ?? null) : (row.seen_at as string);
}
