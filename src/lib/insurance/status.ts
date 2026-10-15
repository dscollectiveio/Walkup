// Policy lifecycle (insurance-spec §6.4). Status is computed, never stored: a
// policy stays active until its successor starts, so recording a renewal
// early never leaves the building looking uninsured. Pure.

import { DEFAULT_SECTIONS, LINE_KEYS, OPTIONAL_SECTIONS, isCoverageType, isSectionKey, sectionsFor, type CoverageType, type LineKey, type SectionKey } from "./coverage";
import { FIELD_DEFS, fieldsFor, optionLabel, rowBool, rowText, type FieldDef, type PolicyRow, type StatusInput } from "./fields";
import { centsOrNull, formatMoney, formatPercent, longDate } from "./format";

export type { PolicyRow, StatusInput };
export type PolicyStatus = "active" | "upcoming" | "expired" | "replaced" | "archived";

function asCoverage(c: string): CoverageType {
  return isCoverageType(c) ? c : "other";
}

/** Whole days from `fromIso` to `toIso` (date parts only, no zone shift). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  const b = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/**
 * todayIso is local (src/lib/dates todayIso()). In order:
 * 1. archived_at set → archived.
 * 2. a successor that is not archived and has started → replaced.
 *    2b. replaced_at set with no replaced_by_policy_id (a 0041 row the 0052
 *        backfill couldn't link) → replaced.
 * 3. starts after today → upcoming.
 * 4. ended before today (the end date is the last covered day) → expired.
 * 5. otherwise active.
 */
export function policyStatus(p: StatusInput, successor: StatusInput | null, todayIso: string): PolicyStatus {
  if (p.archived_at) return "archived";
  if (successor && !successor.archived_at && successor.effective_from <= todayIso) return "replaced";
  if (p.replaced_at && !p.replaced_by_policy_id) return "replaced";
  if (p.effective_from > todayIso) return "upcoming";
  if (p.effective_to < todayIso) return "expired";
  return "active";
}

export interface WithStatus<T> {
  policy: T;
  status: PolicyStatus;
  successor: T | null;
  /** A successor exists and is not archived. */
  renewed: boolean;
  /** Days from today to effective_to (negative once ended). */
  daysToEnd: number;
}

export function withStatus<T extends StatusInput>(rows: T[], todayIso: string): WithStatus<T>[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.map((policy) => {
    const successor = policy.replaced_by_policy_id ? byId.get(policy.replaced_by_policy_id) ?? null : null;
    return {
      policy,
      status: policyStatus(policy, successor, todayIso),
      successor,
      renewed: !!successor && !successor.archived_at,
      daysToEnd: daysBetween(todayIso, policy.effective_to),
    };
  });
}

/** The active policies. */
export function inForce<T extends StatusInput>(rows: T[], todayIso: string): T[] {
  return withStatus(rows, todayIso).filter((w) => w.status === "active").map((w) => w.policy);
}

/** The soonest-ending active policy that is not renewed, and whether it is inside its own reminder window. */
export function renewalFor<T extends StatusInput>(rows: T[], todayIso: string): { policy: T; daysToEnd: number; withinReminder: boolean } | null {
  const open = withStatus(rows, todayIso)
    .filter((w) => w.status === "active" && !w.renewed)
    .sort((a, b) => a.daysToEnd - b.daysToEnd || a.policy.id.localeCompare(b.policy.id));
  const w = open[0];
  if (!w) return null;
  return { policy: w.policy, daysToEnd: w.daysToEnd, withinReminder: w.daysToEnd <= w.policy.renewal_reminder_days };
}

/** A value that means "something is recorded" (enum "unknown" is the column default, not a value). */
function held(def: FieldDef, row: Record<string, unknown>): boolean {
  const v = row[def.column];
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && (v.trim() === "" || (def.kind === "enum" && v === "unknown"))) return false;
  return true;
}

/**
 * included_sections ∪ DEFAULT_SECTIONS[coverage] ∪ sections implied by
 * non-null values (rows saved before 0052 have no included_sections), limited
 * to what the coverage can carry (sectionsFor), in SECTION_KEYS order.
 */
export function effectiveSections(p: PolicyRow): SectionKey[] {
  const coverage = asCoverage(p.coverage);
  const included = new Set<string>((p.included_sections ?? []).filter(isSectionKey));
  for (const s of DEFAULT_SECTIONS[coverage]) included.add(s);
  for (const def of FIELD_DEFS) {
    if (def.group !== "basics" && def.group !== "agent" && OPTIONAL_SECTIONS[coverage].includes(def.group) && held(def, p)) {
      included.add(def.group);
    }
  }
  return sectionsFor(coverage, [...included]);
}

/** A stored value as words: "$2,400,000", "2%", "Yes", "March 1, 2026", an option label. */
export function displayValue(def: FieldDef, row: Record<string, unknown>): string | null {
  switch (def.kind) {
    case "money":
      return formatMoney(rowText(row, def.column));
    case "percent":
      return formatPercent(rowText(row, def.column));
    case "boolean": {
      const b = rowBool(row, def.column);
      return b === null ? null : b ? "Yes" : "No";
    }
    case "date": {
      const t = rowText(row, def.column);
      return t ? longDate(t) : null;
    }
    case "enum": {
      const t = rowText(row, def.column);
      return t && t !== "unknown" ? optionLabel(def.options, t) : null;
    }
    default:
      return rowText(row, def.column);
  }
}

/**
 * Non-null values in columns outside fieldsFor(coverage, effectiveSections(p)).
 * The old form stored all 26 fields on every type, so a legacy D&O row can hold
 * a building limit. The edit form shows these in "From the old form" (§9.3.4)
 * and clears them only when the board ticks "Clear these when I save".
 */
export function legacyValuesOutside(p: PolicyRow): { key: string; label: string; value: string }[] {
  const shown = new Set(fieldsFor(asCoverage(p.coverage), effectiveSections(p), "policy").map((d) => d.key));
  const out: { key: string; label: string; value: string }[] = [];
  for (const def of FIELD_DEFS) {
    if (shown.has(def.key) || !held(def, p)) continue;
    const value = displayValue(def, p);
    if (value !== null) out.push({ key: def.key, label: def.label, value });
  }
  return out;
}

export interface LineCover {
  line: LineKey;
  policies: { id: string; carrier: string; coverage: string }[];
  /** Money text of the highest stated limit, or null ("Included"). */
  limit: string | null;
}

/** The section that gives a line, the column holding its limit, and the property flag that also gives it. */
const LINE_SOURCES: Record<LineKey, { section: SectionKey; limit: string; flag?: string }> = {
  property: { section: "property", limit: "building_limit" },
  liability: { section: "liability", limit: "liability_per_occurrence" },
  do: { section: "do", limit: "do_limit" },
  crime: { section: "crime", limit: "crime_limit" },
  umbrella: { section: "umbrella", limit: "umbrella_limit" },
  flood: { section: "flood", limit: "flood_building_limit", flag: "flood_covered" },
  earthquake: { section: "earthquake", limit: "earthquake_limit", flag: "earthquake_covered" },
  equipment: { section: "equipment", limit: "equipment_breakdown_limit", flag: "equipment_breakdown_included" },
  workers_comp: { section: "workers_comp", limit: "wc_el_each_accident" },
  cyber: { section: "cyber", limit: "cyber_limit" },
  epli: { section: "epli", limit: "epli_limit" },
};

/**
 * Which lines the given (in-force) policies give, with the highest stated
 * limit compared in cents. A property policy with flood_covered,
 * earthquake_covered or equipment_breakdown_included gives that line with a
 * null limit when no section of its own states one. "generic" gives no line.
 */
export function linesInForce(policies: PolicyRow[]): Record<LineKey, LineCover | null> {
  const out = Object.fromEntries(LINE_KEYS.map((k) => [k, null])) as Record<LineKey, LineCover | null>;
  for (const p of policies) {
    const sections = new Set(effectiveSections(p));
    for (const line of LINE_KEYS) {
      const src = LINE_SOURCES[line];
      const bySection = sections.has(src.section);
      const byFlag = !!src.flag && sections.has("property") && rowBool(p, src.flag) === true;
      if (!bySection && !byFlag) continue;
      const limit = bySection ? rowText(p, src.limit) : null;
      const cover = out[line] ?? { line, policies: [], limit: null };
      cover.policies.push({ id: p.id, carrier: p.carrier_name, coverage: p.coverage });
      const now = centsOrNull(cover.limit);
      const next = centsOrNull(limit);
      if (next !== null && (now === null || next > now)) cover.limit = limit;
      out[line] = cover;
    }
  }
  return out;
}

export interface DeductibleHintTicket {
  trade: string | null;
  emergency_kind: string | null;
  /** coalesce(actual_cost, estimated_cost), as ::text money. */
  actual_cost: string | null;
  estimated_cost: string | null;
  has_claim: boolean;
}

export interface DeductibleHint {
  kind: "water" | "property";
  deductible: string;
  policyId: string;
  text: string;
}

/**
 * Repairs task R-5: a board-only nudge on a water, sewage or fire ticket whose
 * cost (actual, else estimated) is at least the in-force master policy's
 * matching deductible. Water and sewage use the water deductible, falling back
 * to the property deductible when none is recorded; fire uses the property
 * deductible. Null when the ticket already has a claim, there is no master or
 * cost, or the cost is below the deductible.
 */
export function deductibleHint(
  ticket: DeductibleHintTicket,
  master: { id: string; property_deductible: string | null; water_damage_deductible: string | null } | null,
): DeductibleHint | null {
  if (!master || ticket.has_claim) return null;
  const cost = centsOrNull(ticket.actual_cost) ?? centsOrNull(ticket.estimated_cost);
  if (cost === null) return null;
  const water = ticket.trade === "plumbing" || ticket.emergency_kind === "flooding" || ticket.emergency_kind === "sewage";
  const fire = ticket.emergency_kind === "fire";
  let kind: "water" | "property" | null = null;
  let deductible: string | null = null;
  if (water && centsOrNull(master.water_damage_deductible) !== null) {
    kind = "water";
    deductible = master.water_damage_deductible;
  } else if ((water || fire) && centsOrNull(master.property_deductible) !== null) {
    kind = "property";
    deductible = master.property_deductible;
  }
  if (!kind || deductible === null) return null;
  const ded = centsOrNull(deductible) as number;
  if (cost < ded) return null;
  return {
    kind,
    deductible,
    policyId: master.id,
    text: `This repair is above your ${formatMoney(deductible)} ${kind} deductible. Worth asking your agent whether to file a claim.`,
  };
}
