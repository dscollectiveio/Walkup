/** What kind of unit a unit is (units.unit_type, migration 0061). */
export const UNIT_TYPES = [
  { value: "commercial", label: "Commercial" },
  { value: "residential", label: "Residential" },
  { value: "residential_penthouse", label: "Residential - Penthouse" },
  { value: "other", label: "Other" },
] as const;

export function unitTypeLabel(value: string | null | undefined): string | null {
  return UNIT_TYPES.find((t) => t.value === value)?.label ?? null;
}

/** A posted value, or null when blank or not one of the four. */
export function parseUnitType(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return UNIT_TYPES.some((t) => t.value === v) ? v : null;
}
