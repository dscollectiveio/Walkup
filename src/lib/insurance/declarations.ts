// The declarations-page field list and the rules for what extraction may
// fill in on its own. Pure — no model, no database — so every rule is tested.
//
// Extraction fills, the user saves. A value is pre-filled only when the model
// was confident, found exactly one reading, and that reading parses cleanly.
// Everything else goes to review with the candidate and the text it came
// from, or stays blank. A limit, deductible, or date is never guessed.

export type FieldGroup = "basics" | "agent" | "limits" | "deductibles";
export type FieldKind = "text" | "money" | "date" | "enum" | "boolean";

export interface FieldDef {
  key: string;
  label: string;
  group: FieldGroup;
  kind: FieldKind;
  /** Column on insurance_policies / insurance_quotes it saves to. */
  column: string;
  options?: { value: string; label: string }[];
  /** Must have a value before a policy can be saved (NOT NULL columns). */
  required?: boolean;
  /** One plain sentence shown next to the field. */
  help?: string;
}

export const POLICY_TYPES = [
  { value: "property", label: "Master policy (building & property)" },
  { value: "general_liability", label: "General liability" },
  { value: "directors_officers", label: "Directors & officers (D&O)" },
  { value: "umbrella", label: "Umbrella" },
  { value: "flood", label: "Flood" },
  { value: "workers_comp", label: "Workers' compensation" },
  { value: "other", label: "Other" },
];

export const COVERAGE_FORMS = [
  { value: "bare_walls", label: "Bare walls" },
  { value: "single_entity", label: "Single entity" },
  { value: "all_in", label: "All-in" },
  { value: "unknown", label: "Not sure" },
];

export const PAYMENT_SCHEDULES = [
  { value: "annual", label: "Once a year" },
  { value: "semi_annual", label: "Twice a year" },
  { value: "quarterly", label: "Quarterly" },
  { value: "monthly", label: "Monthly" },
  { value: "unknown", label: "Not sure" },
];

export const COVERAGE_FORM_HELP =
  "Bare walls covers the structure only; single entity adds the original fixtures inside units; all-in adds owners' improvements too. It decides what unit owners must insure themselves.";

export const FIELD_DEFS: FieldDef[] = [
  { key: "policy_type", label: "Kind of policy", group: "basics", kind: "enum", column: "coverage", options: POLICY_TYPES, required: true },
  { key: "carrier_name", label: "Insurer", group: "basics", kind: "text", column: "carrier_name", required: true },
  { key: "policy_number", label: "Policy number", group: "basics", kind: "text", column: "policy_number" },
  { key: "named_insured", label: "Named insured", group: "basics", kind: "text", column: "named_insured" },
  { key: "insured_address", label: "Insured address", group: "basics", kind: "text", column: "insured_address" },
  { key: "effective_on", label: "Starts", group: "basics", kind: "date", column: "effective_from", required: true },
  { key: "expires_on", label: "Renews on", group: "basics", kind: "date", column: "effective_to", required: true },
  { key: "annual_premium", label: "Annual premium", group: "basics", kind: "money", column: "annual_premium", required: true },
  { key: "payment_schedule", label: "Paid", group: "basics", kind: "enum", column: "payment_schedule", options: PAYMENT_SCHEDULES },

  { key: "agency_name", label: "Agency", group: "agent", kind: "text", column: "agency_name" },
  { key: "agent_name", label: "Agent", group: "agent", kind: "text", column: "broker_name" },
  { key: "agent_phone", label: "Agent phone", group: "agent", kind: "text", column: "agent_phone" },
  { key: "agent_email", label: "Agent email", group: "agent", kind: "text", column: "broker_email" },

  { key: "building_limit", label: "Building", group: "limits", kind: "money", column: "building_limit" },
  { key: "coverage_form", label: "Coverage form", group: "limits", kind: "enum", column: "coverage_form", options: COVERAGE_FORMS, help: COVERAGE_FORM_HELP },
  { key: "liability_per_occurrence", label: "Liability, per incident", group: "limits", kind: "money", column: "liability_per_occurrence" },
  { key: "liability_aggregate", label: "Liability, total per year", group: "limits", kind: "money", column: "liability_aggregate" },
  { key: "do_limit", label: "Directors & officers", group: "limits", kind: "money", column: "do_limit" },
  { key: "umbrella_limit", label: "Umbrella", group: "limits", kind: "money", column: "umbrella_limit" },
  { key: "ordinance_or_law", label: "Ordinance or law coverage", group: "limits", kind: "boolean", column: "ordinance_or_law" },
  { key: "loss_assessment_limit", label: "Loss assessment", group: "limits", kind: "money", column: "loss_assessment_limit" },
  { key: "water_backup_limit", label: "Water / sewer backup", group: "limits", kind: "money", column: "water_backup_limit" },
  { key: "flood_covered", label: "Flood covered", group: "limits", kind: "boolean", column: "flood_covered" },

  { key: "property_deductible", label: "Property", group: "deductibles", kind: "money", column: "property_deductible" },
  { key: "water_damage_deductible", label: "Water damage", group: "deductibles", kind: "money", column: "water_damage_deductible" },
  { key: "wind_hail_deductible", label: "Wind / hail", group: "deductibles", kind: "money", column: "wind_hail_deductible" },
  { key: "per_unit_deductible", label: "Per unit", group: "deductibles", kind: "money", column: "per_unit_deductible" },
];

export const FIELD_KEYS = FIELD_DEFS.map((f) => f.key) as [string, ...string[]];
export const GROUP_LABEL: Record<FieldGroup, string> = {
  basics: "Policy basics",
  agent: "Agent",
  limits: "Coverage limits",
  deductibles: "Deductibles",
};

/** The same bar the Document Hub uses for filing (classify.ts). */
export const AUTO_FILL_CONFIDENCE = 0.85;

export interface Candidate {
  value: string;
  page: number | null;
  snippet: string;
}

export interface RawField {
  name: string;
  candidates: Candidate[];
  confidence: number;
}

export type FieldStatus = "high" | "review" | "blank";

export interface ResolvedField {
  key: string;
  status: FieldStatus;
  /** The parsed value to pre-fill — only for "high". */
  value: string | null;
  /** What to show under "Is this right?" — only for "review". */
  candidates: Candidate[];
  page: number | null;
  snippet: string | null;
  confidence: number | null;
  reason: string | null;
}

/** Strict: "$2,400,000", "2400000", "5,000.00". Not "1M", not "$5k", not ranges. */
export function parseMoney(raw: string): number | null {
  const s = raw.trim().replace(/^USD\s*/i, "");
  if (!/^\$?\s?(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** ISO "2026-03-01" or US "03/01/2026" / "3/1/2026". Anything else is ambiguous. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseBoolean(raw: string): boolean | null {
  const s = raw.trim().toLowerCase();
  if (["yes", "y", "true", "included", "covered"].includes(s)) return true;
  if (["no", "n", "false", "excluded", "not covered"].includes(s)) return false;
  return null;
}

export function parseFieldValue(def: FieldDef, raw: string): string | null {
  switch (def.kind) {
    case "money": {
      const n = parseMoney(raw);
      return n === null ? null : n.toFixed(2);
    }
    case "date":
      return parseDate(raw);
    case "boolean": {
      const b = parseBoolean(raw);
      return b === null ? null : String(b);
    }
    case "enum": {
      const v = raw.trim().toLowerCase();
      return def.options?.some((o) => o.value === v) ? v : null;
    }
    default: {
      const t = raw.trim();
      return t === "" ? null : t;
    }
  }
}

export function resolveField(def: FieldDef, raw: RawField | undefined): ResolvedField {
  const blank: ResolvedField = {
    key: def.key, status: "blank", value: null, candidates: [], page: null, snippet: null, confidence: null, reason: null,
  };
  if (!raw || raw.candidates.length === 0) return blank;

  const confidence = Math.min(1, Math.max(0, raw.confidence));
  const parsed = raw.candidates.map((c) => ({ c, v: parseFieldValue(def, c.value) }));
  const distinct = new Set(parsed.map((p) => p.v ?? `unparsed:${p.c.value}`));
  const first = raw.candidates[0];
  const review = (reason: string): ResolvedField => ({
    key: def.key,
    status: "review",
    value: null,
    candidates: raw.candidates,
    page: first.page,
    snippet: first.snippet,
    confidence,
    reason,
  });

  if (distinct.size > 1) return review("More than one figure appears next to this label.");
  if (parsed[0].v === null) return review("This didn't read as a clean value.");
  if (confidence < AUTO_FILL_CONFIDENCE) return review("Walkup wasn't sure about this one.");
  return {
    key: def.key,
    status: "high",
    value: parsed[0].v,
    candidates: raw.candidates,
    page: first.page,
    snippet: first.snippet,
    confidence,
    reason: null,
  };
}

export function resolveAll(raw: RawField[]): ResolvedField[] {
  const byName = new Map(raw.map((r) => [r.name, r]));
  return FIELD_DEFS.map((def) => resolveField(def, byName.get(def.key)));
}

export interface Warning {
  key: string;
  text: string;
}

/** Warning chips — each only when the data actually supports it. */
export function policyWarnings(input: {
  values: Record<string, string | null>;
  legalName: string | null;
  renewalReminderDays: number;
  today: Date;
  /** Page where the water deductible would usually be, when known. */
  deductiblesPage: number | null;
}): Warning[] {
  const out: Warning[] = [];
  const v = input.values;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (v.named_insured && input.legalName && norm(v.named_insured) !== norm(input.legalName)) {
    out.push({
      key: "named_insured",
      text: `The named insured (“${v.named_insured}”) doesn't match the association's legal name on file (“${input.legalName}”).`,
    });
  }
  if (v.expires_on) {
    const days = Math.round((new Date(`${v.expires_on}T00:00:00`).getTime() - input.today.getTime()) / 86_400_000);
    if (days >= 0 && days <= input.renewalReminderDays) {
      out.push({ key: "expires_on", text: `This policy renews in ${days} day${days === 1 ? "" : "s"}.` });
    } else if (days < 0) {
      out.push({ key: "expires_on", text: "This policy's end date has already passed." });
    }
  }
  if (!v.coverage_form || v.coverage_form === "unknown") {
    out.push({
      key: "coverage_form",
      text: "Ask your agent whether this is bare walls, single entity, or all-in. It matters for what unit owners need to cover themselves.",
    });
  }
  if ((v.policy_type ?? "property") === "property" && !v.water_damage_deductible) {
    out.push({
      key: "water_damage_deductible",
      text: `Many Chicago policies have a separate, higher water deductible.${
        input.deductiblesPage ? ` Check page ${input.deductiblesPage}.` : " Check the deductibles section."
      }`,
    });
  }
  return out;
}
