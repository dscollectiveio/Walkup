// Coverage types, the sections a policy's form shows, and the coverage
// "lines" the coverage check and the Overview map talk about
// (insurance-spec §6.1). Pure.

export const COVERAGE_TYPES = [
  { value: "property",             label: "Master policy (building and property)", short: "Master policy" },
  { value: "general_liability",    label: "General liability",                      short: "Liability" },
  { value: "directors_officers",   label: "Directors and officers (D&O)",           short: "D&O" },
  { value: "fidelity_crime",       label: "Crime and fidelity bond",                short: "Crime / fidelity" },
  { value: "umbrella",             label: "Umbrella",                               short: "Umbrella" },
  { value: "flood",                label: "Flood",                                  short: "Flood" },
  { value: "earthquake",           label: "Earthquake",                             short: "Earthquake" },
  { value: "equipment_breakdown",  label: "Equipment breakdown",                    short: "Equipment breakdown" },
  { value: "workers_comp",         label: "Workers' compensation",                  short: "Workers' comp" },
  { value: "cyber",                label: "Cyber",                                  short: "Cyber" },
  { value: "employment_practices", label: "Employment practices (EPL)",             short: "EPL" },
  { value: "other",                label: "Other",                                  short: "Other" },
] as const;
export type CoverageType = (typeof COVERAGE_TYPES)[number]["value"];

/** The coverage values as a tuple, for z.enum. */
export const COVERAGE_VALUES = COVERAGE_TYPES.map((c) => c.value) as unknown as readonly [CoverageType, ...CoverageType[]];

export function isCoverageType(v: string): v is CoverageType {
  return COVERAGE_TYPES.some((c) => c.value === v);
}

/** "Master policy (building and property)"; unknown values pass through. */
export function coverageLabel(v: string): string {
  return COVERAGE_TYPES.find((c) => c.value === v)?.label ?? v;
}

/** "Master policy"; unknown values pass through. */
export function coverageShort(v: string): string {
  return COVERAGE_TYPES.find((c) => c.value === v)?.short ?? v;
}

export const SECTION_KEYS = ["property", "property_deductibles", "liability", "do", "crime", "umbrella",
  "flood", "earthquake", "equipment", "workers_comp", "cyber", "epli", "generic"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export function isSectionKey(v: string): v is SectionKey {
  return (SECTION_KEYS as readonly string[]).includes(v);
}

export const SECTION_LABEL: Record<SectionKey | "basics" | "agent" | "lists" | "premium", string> = {
  basics: "Policy basics", agent: "Agent", property: "Property", property_deductibles: "Deductibles",
  liability: "General liability", do: "Directors and officers (D&O)", crime: "Crime and fidelity",
  umbrella: "Umbrella", flood: "Flood", earthquake: "Earthquake", equipment: "Equipment breakdown",
  workers_comp: "Workers' compensation", cyber: "Cyber", epli: "Employment practices",
  generic: "Limit and deductible", lists: "Endorsements and exclusions", premium: "Premium breakdown",
};

/** Sections every policy of this type shows. */
export const DEFAULT_SECTIONS: Record<CoverageType, SectionKey[]> = {
  property: ["property", "property_deductibles"], general_liability: ["liability"],
  directors_officers: ["do"], fidelity_crime: ["crime"], umbrella: ["umbrella"], flood: ["flood"],
  earthquake: ["earthquake"], equipment_breakdown: ["equipment"], workers_comp: ["workers_comp"],
  cyber: ["cyber"], employment_practices: ["epli"], other: ["generic"],
};

/** Sections a package of this type may also carry ("This policy also includes"). */
export const OPTIONAL_SECTIONS: Record<CoverageType, SectionKey[]> = {
  property: ["liability", "do", "crime", "equipment", "flood", "earthquake", "umbrella"],
  general_liability: ["do", "umbrella"], directors_officers: ["crime", "epli"],
  fidelity_crime: ["cyber"], umbrella: [], flood: [], earthquake: [], equipment_breakdown: [],
  workers_comp: [], cyber: ["crime"], employment_practices: [], other: [],
};

/**
 * The coverage sections a policy of this type shows: its defaults plus the
 * included ones it may carry, in SECTION_KEYS order. An included section that
 * isn't optional for the type is ignored. (The form wraps these in basics,
 * agent, lists and premium; those aren't SectionKeys.)
 */
export function sectionsFor(coverage: CoverageType, included: readonly string[]): SectionKey[] {
  const defaults = DEFAULT_SECTIONS[coverage] ?? DEFAULT_SECTIONS.other;
  const optional = OPTIONAL_SECTIONS[coverage] ?? [];
  const want = new Set<SectionKey>([...defaults, ...optional.filter((s) => included.includes(s))]);
  return SECTION_KEYS.filter((s) => want.has(s));
}

/** Coverage "lines" the check and the Overview map talk about. */
export const LINE_KEYS = ["property", "liability", "do", "crime", "umbrella", "flood", "earthquake",
  "equipment", "workers_comp", "cyber", "epli"] as const;
export type LineKey = (typeof LINE_KEYS)[number];
export const LINE_LABEL: Record<LineKey, string> = {
  property: "Building and property", liability: "General liability", do: "Directors and officers",
  crime: "Crime and fidelity bond", umbrella: "Umbrella", flood: "Flood", earthquake: "Earthquake",
  equipment: "Equipment breakdown", workers_comp: "Workers' compensation", cyber: "Cyber",
  epli: "Employment practices",
};

/** The coverage type whose default section is this line (for "add the policy" links). */
export const LINE_COVERAGE: Record<LineKey, CoverageType> = {
  property: "property", liability: "general_liability", do: "directors_officers", crime: "fidelity_crime",
  umbrella: "umbrella", flood: "flood", earthquake: "earthquake", equipment: "equipment_breakdown",
  workers_comp: "workers_comp", cyber: "cyber", epli: "employment_practices",
};

/** The line a coverage type's default section maps to (null for "other"). */
export function lineForCoverage(coverage: string): LineKey | null {
  const hit = (Object.entries(LINE_COVERAGE) as [LineKey, CoverageType][]).find(([, c]) => c === coverage);
  return hit ? hit[0] : null;
}
