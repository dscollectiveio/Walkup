// Building facts the coverage check needs (insurance_building_facts, 0052
// part 9; the form is insurance-spec §9.8). Money is text, rental_share a
// fraction string ("0.3000"). Pure.

import { z } from "zod";
import { parseDate, parseMoneyLoose } from "./declarations";

export const FLOOD_ZONES = ["A", "AE", "AH", "AO", "AR", "A99", "V", "VE", "X", "B", "C", "D", "unknown"] as const;
export type FloodZone = (typeof FLOOD_ZONES)[number];

export const REPLACEMENT_COST_SOURCES = [
  { value: "appraisal", label: "Appraisal" },
  { value: "insurer_valuation", label: "Insurer's valuation" },
  { value: "board_estimate", label: "Our own estimate" },
  { value: "unknown", label: "Not sure" },
] as const;

export const DECLARATION_COVERAGE_FORMS = [
  { value: "bare_walls", label: "Bare walls" },
  { value: "single_entity", label: "Single entity" },
  { value: "all_in", label: "All-in" },
  { value: "unknown", label: "Not sure" },
] as const;

/** associations.construction_type (0041) and the labels Building Info shows. */
export const CONSTRUCTION_TYPES = [
  { value: "frame", label: "Frame (wood)" },
  { value: "joisted_masonry", label: "Brick or block walls, wood floors" },
  { value: "masonry_noncombustible", label: "Masonry, non-combustible" },
  { value: "fire_resistive", label: "Fire resistive (concrete / steel)" },
  { value: "other", label: "Other" },
] as const;

/** "joisted_masonry" → "Brick or block walls, wood floors"; null/"other" → null; an unknown value passes through. */
export function constructionLabel(code: string | null | undefined): string | null {
  if (!code || code === "other") return null;
  return CONSTRUCTION_TYPES.find((c) => c.value === code)?.label ?? code;
}

/** The coverage types the declaration may require (the SQL check's list). */
export const REQUIRED_LINE_VALUES = [
  "property", "general_liability", "directors_officers", "umbrella", "flood", "workers_comp", "fidelity_crime",
  "equipment_breakdown", "cyber", "earthquake", "employment_practices", "other",
] as const;

export interface BuildingFacts {
  id?: string;
  association_id: string;
  is_condominium: boolean;
  replacement_cost_estimate: string | null;
  replacement_cost_as_of: string | null;
  replacement_cost_source: "appraisal" | "insurer_valuation" | "board_estimate" | "unknown";
  building_count: number | null;
  total_square_feet: number | null;
  flood_zone: FloodZone | null;
  has_below_grade_units: boolean | null;
  has_basement: boolean | null;
  has_boiler: boolean | null;
  has_elevator: boolean | null;
  has_sprinklers: boolean | null;
  has_employees: boolean | null;
  employee_count: number | null;
  uses_volunteers: boolean | null;
  has_commercial_space: boolean | null;
  has_amenities: boolean | null;
  manager_handles_funds: boolean | null;
  management_company: string | null;
  rental_share: string | null;
  declaration_coverage_form: "bare_walls" | "single_entity" | "all_in" | "unknown";
  declaration_required_lines: string[];
  declaration_insurance_section: string | null;
  declaration_notes: string | null;
  owners_must_carry_ho6: boolean | null;
  owners_ho6_min_liability: string | null;
  updated_at?: string;
}

/** Every fact the form edits (the facts the check can say are missing). */
export const FACT_KEYS = [
  "is_condominium", "replacement_cost_estimate", "replacement_cost_as_of", "replacement_cost_source",
  "building_count", "total_square_feet", "flood_zone", "has_below_grade_units", "has_basement", "has_boiler",
  "has_elevator", "has_sprinklers", "has_amenities", "has_commercial_space", "has_employees", "employee_count",
  "uses_volunteers", "manager_handles_funds", "management_company", "rental_share", "declaration_coverage_form",
  "declaration_required_lines", "declaration_insurance_section", "declaration_notes", "owners_must_carry_ho6",
  "owners_ho6_min_liability",
] as const;
export type FactKey = (typeof FACT_KEYS)[number];

export function isFactKey(v: string): v is FactKey {
  return (FACT_KEYS as readonly string[]).includes(v);
}

/** Form labels (§9.8). */
export const FACT_LABEL: Record<FactKey, string> = {
  is_condominium: "Is the association a condominium?",
  replacement_cost_estimate: "Estimated cost to rebuild the building(s)",
  replacement_cost_as_of: "As of",
  replacement_cost_source: "Where the estimate came from",
  building_count: "Number of buildings",
  total_square_feet: "Total square feet",
  flood_zone: "Flood zone",
  has_below_grade_units: "Units below ground level (garden units)",
  has_basement: "A basement",
  has_boiler: "A boiler or central heating plant",
  has_elevator: "An elevator",
  has_sprinklers: "Sprinklers",
  has_amenities: "Shared amenities (pool, gym, roof deck)",
  has_commercial_space: "Commercial space (a shop or office)",
  has_employees: "Paid employees",
  employee_count: "How many employees",
  uses_volunteers: "Volunteers who do work for the building",
  manager_handles_funds: "A management company that handles the association's money",
  management_company: "Management company name",
  rental_share: "Share of units rented out",
  declaration_coverage_form: "What does the declaration say the association insures inside units?",
  declaration_required_lines: "Coverage the declaration requires",
  declaration_insurance_section: "Where that is in the declaration",
  declaration_notes: "Notes",
  owners_must_carry_ho6: "Do owners have to carry their own insurance?",
  owners_ho6_min_liability: "Minimum liability owners must carry",
};

/** The defaults of a fresh row (the column defaults in 0052). */
export function emptyFacts(associationId: string): BuildingFacts {
  return {
    association_id: associationId,
    is_condominium: true,
    replacement_cost_estimate: null,
    replacement_cost_as_of: null,
    replacement_cost_source: "unknown",
    building_count: null,
    total_square_feet: null,
    flood_zone: null,
    has_below_grade_units: null,
    has_basement: null,
    has_boiler: null,
    has_elevator: null,
    has_sprinklers: null,
    has_employees: null,
    employee_count: null,
    uses_volunteers: null,
    has_commercial_space: null,
    has_amenities: null,
    manager_handles_funds: null,
    management_company: null,
    rental_share: null,
    declaration_coverage_form: "unknown",
    declaration_required_lines: [],
    declaration_insurance_section: null,
    declaration_notes: null,
    owners_must_carry_ho6: null,
    owners_ho6_min_liability: null,
  };
}

/** True when a fact is unanswered: null, blank, or "unknown". */
export function factUnknown(facts: BuildingFacts | null, key: FactKey): boolean {
  if (!facts) return key !== "is_condominium";
  const v = facts[key];
  return v === null || v === undefined || v === "" || v === "unknown";
}

// ---------------------------------------------------------------------------
// The form's FormData strings → a row patch. Only keys present in the input
// appear in the output (the ?only= form posts just its questions).

type In = string | string[] | null | undefined;
const one = (v: In): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

function fail(ctx: z.RefinementCtx, message: string) {
  ctx.addIssue({ code: "custom", message });
  return z.NEVER;
}

const inp = z.union([z.string(), z.array(z.string()), z.null()]).optional();

const yesNo = inp.transform((v, ctx): boolean | null => {
  const s = one(v).toLowerCase();
  if (s === "" || s === "unsure" || s === "unknown") return null;
  if (s === "yes" || s === "true") return true;
  if (s === "no" || s === "false") return false;
  return fail(ctx, "Choose yes, no or not sure.");
});

const money = (label: string) =>
  inp.transform((v, ctx): string | null => {
    const s = one(v);
    if (s === "") return null;
    const m = parseMoneyLoose(s);
    if (m === null) return fail(ctx, `${label}: use digits, like 2400000 or $2,400,000.`);
    return m;
  });

const int = (label: string, min: number, max: number) =>
  inp.transform((v, ctx): number | null => {
    const s = one(v).replace(/,/g, "");
    if (s === "") return null;
    if (!/^\d+$/.test(s)) return fail(ctx, `${label}: use a whole number.`);
    const n = Number(s);
    if (n < min || n > max) return fail(ctx, `${label}: use a number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}.`);
    return n;
  });

const text = (max: number) =>
  inp.transform((v, ctx): string | null => {
    const s = one(v);
    if (s === "") return null;
    if (s.length > max) return fail(ctx, `Keep this under ${max.toLocaleString("en-US")} characters.`);
    return s;
  });

function oneOf<T extends string>(values: readonly T[], fallback: T | null, message: string) {
  return inp.transform((v, ctx): T | null => {
    const s = one(v);
    if (s === "") return fallback;
    if ((values as readonly string[]).includes(s)) return s as T;
    return fail(ctx, message);
  });
}

/**
 * Parses the facts form. Empty means null; yes/no/unsure map to
 * true/false/null; money goes through parseMoneyLoose; the rental share takes
 * "30%" or "30" (a fraction string comes out); the required lines come from
 * checkboxes. "Not sure" for "Is it a condominium?" keeps the default (true),
 * because the column can't be null and the Act is the safer assumption.
 */
export const factsSchema = z
  .object({
    is_condominium: inp.transform((v, ctx): boolean => {
      const s = one(v).toLowerCase();
      if (s === "no" || s === "false") return false;
      if (s === "" || s === "yes" || s === "true" || s === "unsure" || s === "unknown") return true;
      return fail(ctx, "Choose yes, no or not sure.");
    }),
    replacement_cost_estimate: money(FACT_LABEL.replacement_cost_estimate),
    replacement_cost_as_of: inp.transform((v, ctx): string | null => {
      const s = one(v);
      if (s === "") return null;
      return parseDate(s) ?? fail(ctx, "Enter the date of the estimate.");
    }),
    replacement_cost_source: oneOf(REPLACEMENT_COST_SOURCES.map((s) => s.value), "unknown", "Choose where the estimate came from."),
    building_count: int(FACT_LABEL.building_count, 1, 500),
    total_square_feet: int(FACT_LABEL.total_square_feet, 1, 10_000_000),
    flood_zone: oneOf(FLOOD_ZONES, null, "Choose a flood zone, or Not sure."),
    has_below_grade_units: yesNo,
    has_basement: yesNo,
    has_boiler: yesNo,
    has_elevator: yesNo,
    has_sprinklers: yesNo,
    has_amenities: yesNo,
    has_commercial_space: yesNo,
    has_employees: yesNo,
    employee_count: int(FACT_LABEL.employee_count, 0, 10_000),
    uses_volunteers: yesNo,
    manager_handles_funds: yesNo,
    management_company: text(200),
    rental_share: inp.transform((v, ctx): string | null => {
      const s = one(v).replace(/\s*%$/, "");
      if (s === "") return null;
      const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s);
      if (!m) return fail(ctx, "Share of units rented out: use a percent, like 30%.");
      const bp4 = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
      if (bp4 > 10_000) return fail(ctx, "Share of units rented out: use a percent from 0 to 100.");
      return `${Math.floor(bp4 / 10_000)}.${String(bp4 % 10_000).padStart(4, "0")}`;
    }),
    declaration_coverage_form: oneOf(DECLARATION_COVERAGE_FORMS.map((f) => f.value), "unknown", "Choose what the declaration says."),
    declaration_required_lines: z
      .union([z.string(), z.array(z.string()), z.null()])
      .optional()
      .transform((v, ctx): string[] => {
        const list = (Array.isArray(v) ? v : v ? [v] : []).map((s) => s.trim()).filter(Boolean);
        const bad = list.filter((s) => !(REQUIRED_LINE_VALUES as readonly string[]).includes(s));
        if (bad.length) return fail(ctx, "Choose coverage types from the list.");
        return [...new Set(list)];
      }),
    declaration_insurance_section: text(200),
    declaration_notes: text(2000),
    owners_must_carry_ho6: yesNo,
    owners_ho6_min_liability: money(FACT_LABEL.owners_ho6_min_liability),
  })
  .partial();

export type FactsPatch = Partial<Omit<BuildingFacts, "id" | "association_id" | "updated_at">>;

/**
 * factsSchema over a plain object, keeping only the keys present in `input`
 * (zod fills optional transforms with their empty value otherwise).
 */
export function parseFactsInput(input: Record<string, In>): { ok: true; patch: FactsPatch } | { ok: false; error: string } {
  const r = factsSchema.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "Check the answers." };
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    if (isFactKey(key)) patch[key] = (r.data as Record<string, unknown>)[key];
  }
  return { ok: true, patch: patch as FactsPatch };
}
