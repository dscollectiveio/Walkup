// The field table (insurance-spec §6.2, authoritative): every value a policy
// or quote holds, its label, the section it shows in, how it parses, and the
// column it saves to on insurance_policies and insurance_quotes. The save
// RPCs' allowlists (0052 part 17) are checked against this list by
// tests/db/insurance-v2.test.ts, so the two can't drift. Pure.

import { z } from "zod";
import { COVERAGE_TYPES, sectionsFor, type CoverageType, type SectionKey } from "./coverage";

export type FieldKind = "text" | "money" | "percent" | "date" | "enum" | "boolean";
export type FieldGroup = "basics" | "agent" | SectionKey;
export type FieldMode = "policy" | "quote";

export interface FieldDef {
  key: string;                 // stable provenance key (field_sources.field_name); old keys kept
  label: string;
  group: FieldGroup;
  kind: FieldKind;
  column: string;              // insurance_policies column
  quoteColumn: string | null;  // insurance_quotes column (null = not on quotes)
  options?: { value: string; label: string }[];
  required?: "policy" | "both";// NOT NULL on save
  help?: string;               // one plain sentence
  readHint?: string;           // extra instruction for the reader prompt
  quoteLabel?: string;         // the label on a quote, when it differs
}

type Option = { value: string; label: string };

export const POLICY_TYPES: Option[] = COVERAGE_TYPES.map((c) => ({ value: c.value, label: c.label }));

export const PAYMENT_SCHEDULES: Option[] = [
  { value: "annual", label: "Once a year" },
  { value: "semi_annual", label: "Twice a year" },
  { value: "quarterly", label: "Quarterly" },
  { value: "monthly", label: "Monthly" },
  { value: "unknown", label: "Not sure" },
];

export const COVERAGE_FORMS: Option[] = [
  { value: "bare_walls", label: "Bare walls" },
  { value: "single_entity", label: "Single entity (original fixtures)" },
  { value: "all_in", label: "All-in (including owners' improvements)" },
  { value: "unknown", label: "Not sure" },
];

export const VALUATIONS: Option[] = [
  { value: "replacement_cost", label: "Replacement cost" },
  { value: "extended_replacement_cost", label: "Extended replacement cost" },
  { value: "functional_replacement_cost", label: "Functional replacement cost" },
  { value: "actual_cash_value", label: "Actual cash value (depreciated)" },
  { value: "unknown", label: "Not sure" },
];

export const CAUSE_OF_LOSS_FORMS: Option[] = [
  { value: "special", label: "Special form (all risks unless excluded)" },
  { value: "broad", label: "Broad form (named perils)" },
  { value: "basic", label: "Basic form (named perils)" },
  { value: "unknown", label: "Not sure" },
];

export const FLOOD_PROGRAMS: Option[] = [
  { value: "nfip", label: "National Flood Insurance Program" },
  { value: "private", label: "Private flood" },
  { value: "unknown", label: "Not sure" },
];

export const COVERAGE_FORM_HELP =
  "Bare walls covers the structure only; single entity adds the original fixtures inside units; all-in adds owners' improvements too. It decides what unit owners must insure themselves.";

/** The label of an option value ("single_entity" -> "Single entity (original fixtures)"), or the value. */
export function optionLabel(options: Option[] | undefined, value: string): string {
  return options?.find((o) => o.value === value)?.label ?? value;
}

const f = (
  key: string, label: string, group: FieldGroup, kind: FieldKind, column: string,
  quoteColumn: string | null | "same", extra: Partial<FieldDef> = {},
): FieldDef => ({ key, label, group, kind, column, quoteColumn: quoteColumn === "same" ? column : quoteColumn, ...extra });

export const FIELD_DEFS: FieldDef[] = [
  // Policy basics
  f("policy_type", "Kind of policy", "basics", "enum", "coverage", "coverage", { options: POLICY_TYPES, required: "both" }),
  f("carrier_name", "Insurer", "basics", "text", "carrier_name", "carrier_name", { required: "both" }),
  f("policy_number", "Policy number", "basics", "text", "policy_number", "quote_number", { quoteLabel: "Quote number" }),
  f("named_insured", "Named insured", "basics", "text", "named_insured", "named_insured"),
  f("insured_address", "Insured address", "basics", "text", "insured_address", null),
  f("effective_on", "Starts", "basics", "date", "effective_from", "covers_from", { required: "policy" }),
  f("expires_on", "Renews on", "basics", "date", "effective_to", "covers_to", { required: "policy", quoteLabel: "Ends" }),
  f("annual_premium", "Annual premium", "basics", "money", "annual_premium", "annual_premium", {
    required: "both", help: "The total for the year, including taxes and fees if the page shows one total.",
  }),
  f("taxes_and_fees", "Taxes and fees", "basics", "money", "taxes_and_fees", "taxes_and_fees", {
    help: "Only if listed separately from the premium.",
  }),
  f("payment_schedule", "Paid", "basics", "enum", "payment_schedule", "payment_schedule", { options: PAYMENT_SCHEDULES }),
  f("claims_phone", "Claims phone number", "basics", "text", "claims_phone", "claims_phone", {
    readHint: "The insurer's number for reporting a claim, if printed. Not the agent's office number.",
    help: "The number to call first when there's damage.",
  }),

  // Agent
  f("agency_name", "Agency", "agent", "text", "agency_name", "agency_name"),
  f("agent_name", "Agent", "agent", "text", "broker_name", "broker_name"),
  f("agent_phone", "Agent phone", "agent", "text", "agent_phone", "agent_phone"),
  f("agent_email", "Agent email", "agent", "text", "broker_email", "broker_email"),

  // Property
  f("building_limit", "Building", "property", "money", "building_limit", "building_limit"),
  f("business_personal_property_limit", "Association's contents", "property", "money", "business_personal_property_limit", "same", {
    help: "Furniture, tools and supplies the association owns.",
  }),
  f("loss_of_income_limit", "Loss of assessments or income", "property", "money", "loss_of_income_limit", "same"),
  f("valuation", "Valuation", "property", "enum", "valuation", "valuation", { options: VALUATIONS }),
  f("extended_replacement_percent", "Extended replacement, extra", "property", "percent", "extended_replacement_percent", "same", {
    help: "For example 25% above the building limit.",
  }),
  f("coinsurance_percent", "Coinsurance", "property", "percent", "coinsurance_percent", "same", {
    help: "Often 80%, 90% or 100%. Leave blank if waived.",
  }),
  f("agreed_value", "Agreed value (coinsurance waived)", "property", "boolean", "agreed_value", "same"),
  f("cause_of_loss_form", "Causes of loss", "property", "enum", "cause_of_loss_form", "same", { options: CAUSE_OF_LOSS_FORMS }),
  f("coverage_form", "What's covered inside units", "property", "enum", "coverage_form", "coverage_form", {
    options: COVERAGE_FORMS, help: COVERAGE_FORM_HELP,
  }),
  f("ordinance_or_law", "Ordinance or law included", "property", "boolean", "ordinance_or_law", "same"),
  f("ordinance_law_a_included", "Coverage A (undamaged part)", "property", "boolean", "ordinance_law_a_included", "same"),
  f("ordinance_law_b_limit", "Coverage B (demolition)", "property", "money", "ordinance_law_b_limit", "same"),
  f("ordinance_law_c_limit", "Coverage C (increased cost to rebuild)", "property", "money", "ordinance_law_c_limit", "same"),
  f("ordinance_law_bc_limit", "Coverage B and C combined", "property", "money", "ordinance_law_bc_limit", "same", {
    readHint: "Only when B and C share one limit.",
  }),
  f("water_backup_limit", "Water or sewer backup", "property", "money", "water_backup_limit", "same"),
  f("equipment_breakdown_included", "Equipment breakdown included", "property", "boolean", "equipment_breakdown_included", "same"),
  f("flood_covered", "Flood covered", "property", "boolean", "flood_covered", "same"),
  f("earthquake_covered", "Earthquake covered", "property", "boolean", "earthquake_covered", "same"),
  f("loss_assessment_limit", "Loss assessment", "property", "money", "loss_assessment_limit", "same"),
  f("waiver_of_subrogation", "Waiver of subrogation", "property", "boolean", "waiver_of_subrogation", "same", {
    help: "The insurer gives up suing owners or the board to recover what it paid.",
  }),

  // Property deductibles
  f("property_deductible", "All other perils", "property_deductibles", "money", "property_deductible", "same"),
  f("water_damage_deductible", "Water damage", "property_deductibles", "money", "water_damage_deductible", "same"),
  f("wind_hail_deductible", "Wind or hail (dollars or minimum)", "property_deductibles", "money", "wind_hail_deductible", "same"),
  f("wind_hail_deductible_percent", "Wind or hail (percent)", "property_deductibles", "percent", "wind_hail_deductible_percent", "same", {
    help: "A percentage of the building value, often 1% or 2%.",
  }),
  f("per_unit_deductible", "Per unit", "property_deductibles", "money", "per_unit_deductible", "same"),

  // General liability
  f("liability_per_occurrence", "Each occurrence", "liability", "money", "liability_per_occurrence", "same"),
  f("liability_aggregate", "General aggregate", "liability", "money", "liability_aggregate", "same"),
  f("products_completed_aggregate", "Products and completed operations", "liability", "money", "products_completed_aggregate", "same"),
  f("personal_advertising_injury_limit", "Personal and advertising injury", "liability", "money", "personal_advertising_injury_limit", "same"),
  f("medical_payments_limit", "Medical payments", "liability", "money", "medical_payments_limit", "same"),
  f("damage_to_premises_rented_limit", "Damage to premises rented", "liability", "money", "damage_to_premises_rented_limit", "same"),
  f("hired_non_owned_auto", "Hired and non-owned auto", "liability", "boolean", "hired_non_owned_auto", "same"),
  f("unit_owners_additional_insureds", "Unit owners are additional insureds", "liability", "boolean", "unit_owners_additional_insureds", "same"),
  f("manager_additional_insured", "Managing agent is an additional insured", "liability", "boolean", "manager_additional_insured", "same"),

  // D&O
  f("do_limit", "D&O limit", "do", "money", "do_limit", "do_limit"),
  f("do_retention", "Retention (deductible)", "do", "money", "do_retention", "same"),
  f("do_claims_made", "Claims-made", "do", "boolean", "do_claims_made", "same"),
  f("do_retro_date", "Prior acts date", "do", "date", "do_retro_date", "same"),
  f("do_full_prior_acts", "Full prior acts", "do", "boolean", "do_full_prior_acts", "same"),
  f("do_covers_non_monetary", "Covers non-money claims", "do", "boolean", "do_covers_non_monetary", "same"),
  f("do_covers_breach_of_contract", "Covers breach of contract defense", "do", "boolean", "do_covers_breach_of_contract", "same"),
  f("do_covers_insurance_decisions", "Covers decisions about insurance", "do", "boolean", "do_covers_insurance_decisions", "same"),
  f("do_includes_managing_agent", "Managing agent is insured", "do", "boolean", "do_includes_managing_agent", "same"),
  f("do_includes_past_future_board", "Past and future board members are insured", "do", "boolean", "do_includes_past_future_board", "same"),

  // Crime and fidelity
  f("crime_limit", "Employee theft (fidelity)", "crime", "money", "crime_limit", "same"),
  f("crime_deductible", "Deductible", "crime", "money", "crime_deductible", "same"),
  f("crime_includes_manager", "Property manager covered", "crime", "boolean", "crime_includes_manager", "same"),
  f("crime_social_engineering_limit", "Social engineering fraud", "crime", "money", "crime_social_engineering_limit", "same", {
    help: "Tricked into sending money to a fake contractor or manager.",
  }),
  f("crime_computer_fraud_limit", "Computer fraud", "crime", "money", "crime_computer_fraud_limit", "same"),
  f("crime_funds_transfer_limit", "Funds transfer fraud", "crime", "money", "crime_funds_transfer_limit", "same"),

  // Umbrella
  f("umbrella_limit", "Umbrella limit", "umbrella", "money", "umbrella_limit", "umbrella_limit"),
  f("umbrella_retention", "Retention", "umbrella", "money", "umbrella_retention", "same"),
  f("umbrella_includes_do", "Sits over D&O too", "umbrella", "boolean", "umbrella_includes_do", "same"),

  // Flood
  f("flood_building_limit", "Building", "flood", "money", "flood_building_limit", "same"),
  f("flood_contents_limit", "Contents", "flood", "money", "flood_contents_limit", "same"),
  f("flood_deductible", "Deductible", "flood", "money", "flood_deductible", "same"),
  f("flood_program", "Program", "flood", "enum", "flood_program", "same", { options: FLOOD_PROGRAMS }),
  f("flood_zone_rated", "Flood zone on the policy", "flood", "text", "flood_zone_rated", "same"),

  // Earthquake
  f("earthquake_limit", "Limit", "earthquake", "money", "earthquake_limit", "same"),
  f("earthquake_deductible_percent", "Deductible (percent)", "earthquake", "percent", "earthquake_deductible_percent", "same"),
  f("earthquake_deductible", "Deductible (dollars or minimum)", "earthquake", "money", "earthquake_deductible", "same"),

  // Equipment breakdown
  f("equipment_breakdown_limit", "Limit per accident", "equipment", "money", "equipment_breakdown_limit", "same"),
  f("equipment_breakdown_deductible", "Deductible", "equipment", "money", "equipment_breakdown_deductible", "same"),

  // Workers' compensation
  f("wc_el_each_accident", "Employers' liability, each accident", "workers_comp", "money", "wc_el_each_accident", "same"),
  f("wc_el_disease_each_employee", "Disease, each employee", "workers_comp", "money", "wc_el_disease_each_employee", "same"),
  f("wc_el_disease_policy_limit", "Disease, policy limit", "workers_comp", "money", "wc_el_disease_policy_limit", "same"),
  f("wc_covers_volunteers", "Volunteers covered", "workers_comp", "boolean", "wc_covers_volunteers", "same"),

  // Cyber
  f("cyber_limit", "Limit", "cyber", "money", "cyber_limit", "same"),
  f("cyber_retention", "Retention", "cyber", "money", "cyber_retention", "same"),

  // Employment practices
  f("epli_limit", "Limit", "epli", "money", "epli_limit", "same"),
  f("epli_retention", "Retention", "epli", "money", "epli_retention", "same"),
  f("epli_third_party", "Covers claims by non-employees", "epli", "boolean", "epli_third_party", "same"),

  // Other coverage
  f("generic_limit", "Limit", "generic", "money", "coverage_limit", "coverage_limit"),
  f("generic_deductible", "Deductible", "generic", "money", "deductible", "deductible"),
];

export const FIELD_KEYS = FIELD_DEFS.map((d) => d.key) as [string, ...string[]];

export const FIELD_BY_KEY: ReadonlyMap<string, FieldDef> = new Map(FIELD_DEFS.map((d) => [d.key, d]));

/** The field def for a key, or undefined. */
export function fieldDef(key: string): FieldDef | undefined {
  return FIELD_BY_KEY.get(key);
}

/** The policy's editable columns that are not FIELD_DEFS (0052 part 17). */
export const POLICY_EXTRA_COLUMNS = [
  "included_sections", "endorsements", "exclusions", "premium_breakdown", "renewal_reminder_days", "notes", "agent_contact_id",
] as const;

/** The quote's editable columns that are not FIELD_DEFS (0052 part 17). */
export const QUOTE_EXTRA_COLUMNS = [
  "included_sections", "endorsements", "exclusions", "premium_breakdown", "notes", "quoted_on", "valid_until",
  "contact_id", "quote_request_id",
] as const;

/**
 * TS mirror of `insurance_policy_editable_columns()` (0052 part 17). The unit
 * test checks FIELD_DEFS against it; the DB test checks it against the SQL.
 */
export const POLICY_EDITABLE_COLUMNS: readonly string[] = [
  "coverage", "carrier_name", "policy_number", "named_insured", "insured_address",
  "effective_from", "effective_to", "annual_premium", "payment_schedule", "taxes_and_fees", "claims_phone",
  "agency_name", "broker_name", "agent_phone", "broker_email", "agent_contact_id",
  "included_sections",
  "building_limit", "business_personal_property_limit", "loss_of_income_limit", "valuation",
  "extended_replacement_percent", "coinsurance_percent", "agreed_value", "cause_of_loss_form",
  "coverage_form", "ordinance_or_law", "ordinance_law_a_included", "ordinance_law_b_limit",
  "ordinance_law_c_limit", "ordinance_law_bc_limit", "water_backup_limit",
  "equipment_breakdown_included", "flood_covered", "earthquake_covered", "loss_assessment_limit",
  "waiver_of_subrogation",
  "property_deductible", "water_damage_deductible", "wind_hail_deductible",
  "wind_hail_deductible_percent", "per_unit_deductible",
  "liability_per_occurrence", "liability_aggregate", "products_completed_aggregate",
  "personal_advertising_injury_limit", "medical_payments_limit", "damage_to_premises_rented_limit",
  "hired_non_owned_auto", "unit_owners_additional_insureds", "manager_additional_insured",
  "do_limit", "do_retention", "do_claims_made", "do_retro_date", "do_full_prior_acts",
  "do_covers_non_monetary", "do_covers_breach_of_contract", "do_covers_insurance_decisions",
  "do_includes_managing_agent", "do_includes_past_future_board",
  "crime_limit", "crime_deductible", "crime_includes_manager", "crime_social_engineering_limit",
  "crime_computer_fraud_limit", "crime_funds_transfer_limit",
  "umbrella_limit", "umbrella_retention", "umbrella_includes_do",
  "flood_building_limit", "flood_contents_limit", "flood_deductible", "flood_program", "flood_zone_rated",
  "earthquake_limit", "earthquake_deductible", "earthquake_deductible_percent",
  "equipment_breakdown_limit", "equipment_breakdown_deductible",
  "wc_el_each_accident", "wc_el_disease_each_employee", "wc_el_disease_policy_limit", "wc_covers_volunteers",
  "cyber_limit", "cyber_retention",
  "epli_limit", "epli_retention", "epli_third_party",
  "coverage_limit", "deductible",
  "endorsements", "exclusions", "premium_breakdown",
  "renewal_reminder_days", "notes",
];

/**
 * The fields a policy or quote of this coverage shows: basics, agent, and the
 * fields of sectionsFor(coverage, included). In quote mode, fields with no
 * quote column are dropped, and each def comes back with `column` set to the
 * quote column, the quote label, and `required: "policy"` lifted.
 */
export function fieldsFor(coverage: CoverageType, included: readonly string[], mode: FieldMode = "policy"): FieldDef[] {
  const sections = new Set<string>(sectionsFor(coverage, included));
  const defs = FIELD_DEFS.filter((d) => d.group === "basics" || d.group === "agent" || sections.has(d.group));
  if (mode === "policy") return defs;
  return defs
    .filter((d) => d.quoteColumn !== null)
    .map((d) => ({
      ...d,
      column: d.quoteColumn as string,
      label: d.quoteLabel ?? d.label,
      required: d.required === "both" ? "both" : undefined,
    }));
}

/** `col::text` for money and percent columns (DECISIONS #20: money crosses the API as text). */
function selectColumn(column: string, kind: FieldKind): string {
  return kind === "money" || kind === "percent" ? `${column}::text` : column;
}

const POLICY_BASE_COLUMNS = [
  "id", "association_id", "created_at", "updated_at", "archived_at", "replaced_at", "replaced_by_policy_id",
  "accepted_quote_id", "agent_contact_id", "source_document_id", "renewal_reminder_days", "notes",
  "included_sections", "endorsements", "exclusions", "premium_breakdown",
  "summary_text", "summary_source", "summary_written_at", "summary_error",
];

const QUOTE_BASE_COLUMNS = [
  "id", "association_id", "created_at", "updated_at", "quoted_on", "valid_until", "was_selected",
  "declined_reason", "declined_at", "quote_request_id", "document_id", "contact_id", "notes",
  "included_sections", "endorsements", "exclusions", "premium_breakdown",
];

/** The PostgREST select for a policy row: every field, money and percents as text. */
export function policySelect(): string {
  return [...POLICY_BASE_COLUMNS, ...FIELD_DEFS.map((d) => selectColumn(d.column, d.kind))].join(", ");
}

/** The PostgREST select for a quote row: every quote field, money and percents as text. */
export function quoteSelect(): string {
  return [
    ...QUOTE_BASE_COLUMNS,
    ...FIELD_DEFS.filter((d) => d.quoteColumn !== null).map((d) => selectColumn(d.quoteColumn as string, d.kind)),
  ].join(", ");
}

// The lists have their own editors and shapes (not FIELD_DEFS).
export const EndorsementSchema = z.object({ form_number: z.string().max(40).nullable(), title: z.string().min(1).max(200), page: z.number().int().positive().nullable() });
export const ExclusionSchema   = z.object({ title: z.string().min(1).max(200), page: z.number().int().positive().nullable() });
export const PremiumLineSchema = z.object({ label: z.string().min(1).max(120), amount: z.string().regex(/^\d+(\.\d{2})$/), page: z.number().int().positive().nullable() });
export type Endorsement = z.infer<typeof EndorsementSchema>;
export type Exclusion = z.infer<typeof ExclusionSchema>;
export type PremiumLine = z.infer<typeof PremiumLineSchema>;

/** What every policy-status computation needs (§6.4). */
export interface StatusInput {
  id: string; coverage: string; effective_from: string; effective_to: string;
  archived_at: string | null; replaced_by_policy_id: string | null; replaced_at: string | null;
  renewal_reminder_days: number;
}

/**
 * A policy row as loaded through policySelect(): money and percents are text,
 * booleans boolean, dates "YYYY-MM-DD". Columns not named here are read
 * through rowText()/rowBool().
 */
export interface PolicyRow extends StatusInput {
  carrier_name: string;
  annual_premium: string;
  included_sections?: string[] | null;
  [column: string]: unknown;
}

/** A column's value as trimmed text, or null (numbers are stringified, booleans are not text). */
export function rowText(row: Record<string, unknown> | null | undefined, column: string): string | null {
  const v = row?.[column];
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** A boolean column's value, or null. Accepts "true"/"false" strings from forms. */
export function rowBool(row: Record<string, unknown> | null | undefined, column: string): boolean | null {
  const v = row?.[column];
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}
