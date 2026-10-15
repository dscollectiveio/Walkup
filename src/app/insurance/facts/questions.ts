// The facts form's questions and the fact keys each posts (insurance-spec
// §9.8): a question with a follow-up (employees and how many) posts both.
// Pure, so the server page can map ?only= keys to questions.

import type { FactKey } from "@/lib/insurance/facts";

/** Question → the fact keys it posts. */
export const QUESTION_KEYS: Record<string, FactKey[]> = {
  is_condominium: ["is_condominium"],
  replacement_cost_estimate: ["replacement_cost_estimate"],
  replacement_cost_as_of: ["replacement_cost_as_of"],
  replacement_cost_source: ["replacement_cost_source"],
  building_count: ["building_count"],
  total_square_feet: ["total_square_feet"],
  flood_zone: ["flood_zone"],
  has_below_grade_units: ["has_below_grade_units"],
  has_basement: ["has_basement"],
  has_boiler: ["has_boiler"],
  has_elevator: ["has_elevator"],
  has_sprinklers: ["has_sprinklers"],
  has_amenities: ["has_amenities"],
  has_commercial_space: ["has_commercial_space"],
  has_employees: ["has_employees", "employee_count"],
  uses_volunteers: ["uses_volunteers"],
  manager_handles_funds: ["manager_handles_funds", "management_company"],
  rental_share: ["rental_share"],
  declaration_coverage_form: ["declaration_coverage_form"],
  declaration_required_lines: ["declaration_required_lines"],
  declaration_insurance_section: ["declaration_insurance_section"],
  declaration_notes: ["declaration_notes"],
  owners_must_carry_ho6: ["owners_must_carry_ho6", "owners_ho6_min_liability"],
};

/** The question a fact key belongs to (employee_count → has_employees). */
export function questionFor(key: FactKey): string {
  return Object.entries(QUESTION_KEYS).find(([, keys]) => keys.includes(key))?.[0] ?? key;
}
