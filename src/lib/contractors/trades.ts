// The one list of trades. Adding a trade is one line here (repairs-spec §11.1).
//
// `googleQuery` is the text sent to Google Places Text Search; null means the
// trade can't be searched (manual only). `placesType` is set only where
// Google's Table A has the type (checked against Google's Place Types page,
// 2026-10-14); everything else searches by text alone. `licenseLookupUrl` is
// a public license lookup for the building's jurisdiction, deliberately left
// unset until someone has verified the exact page, because a wrong link here
// would look authoritative. See docs/reference/build-prompt-budget-contractors-insurance-taxes.md.
//
// `licenseTypical` is a hint for the "No license number on file" chip, not a
// legal claim about who needs a license.

export type TradeGroup = "common" | "systems" | "outside" | "specialist" | "other";

export interface Trade {
  slug: string;
  label: string;
  group: TradeGroup;
  googleQuery: string | null;
  placesType?: string;
  /** Slugs that partly cover this work ("Also does …" in ranking). */
  related: string[];
  licenseTypical: boolean;
  licenseLookupUrl?: Partial<Record<string, string>>; // keyed by state code, e.g. "IL"
}

export const TRADES: Trade[] = [
  { slug: "plumbing", label: "Plumbing", group: "common", googleQuery: "plumber", placesType: "plumber", related: ["sewer", "backflow"], licenseTypical: true },
  { slug: "electrical", label: "Electrical", group: "common", googleQuery: "electrician", placesType: "electrician", related: [], licenseTypical: true },
  { slug: "hvac", label: "Heating & cooling", group: "systems", googleQuery: "HVAC contractor", related: [], licenseTypical: true },
  { slug: "roofing", label: "Roofing", group: "outside", googleQuery: "roofing contractor", placesType: "roofing_contractor", related: ["gutters"], licenseTypical: true },
  { slug: "masonry", label: "Masonry & tuckpointing", group: "outside", googleQuery: "masonry contractor", related: ["concrete", "waterproofing"], licenseTypical: false },
  { slug: "general", label: "General contractor", group: "common", googleQuery: "general contractor", related: ["handyman", "carpentry"], licenseTypical: true },
  { slug: "handyman", label: "Handyman", group: "common", googleQuery: "handyman service", related: ["general", "carpentry"], licenseTypical: false },
  { slug: "painting", label: "Painting", group: "common", googleQuery: "painting contractor", placesType: "painter", related: ["carpentry"], licenseTypical: false },
  { slug: "carpentry", label: "Carpentry", group: "common", googleQuery: "carpenter", related: ["handyman", "general"], licenseTypical: false },
  { slug: "windows", label: "Windows & glass", group: "outside", googleQuery: "window repair", related: ["carpentry"], licenseTypical: false },
  { slug: "flooring", label: "Flooring", group: "specialist", googleQuery: "flooring contractor", related: ["carpentry"], licenseTypical: false },
  { slug: "concrete", label: "Concrete & sidewalks", group: "outside", googleQuery: "concrete contractor", related: ["masonry"], licenseTypical: false },
  { slug: "waterproofing", label: "Basement waterproofing", group: "systems", googleQuery: "basement waterproofing", related: ["masonry", "plumbing"], licenseTypical: false },
  { slug: "sewer", label: "Sewer rodding & drains", group: "systems", googleQuery: "sewer and drain cleaning", related: ["plumbing"], licenseTypical: false },
  { slug: "backflow", label: "Backflow testing", group: "systems", googleQuery: "backflow testing", related: ["plumbing"], licenseTypical: true },
  { slug: "chimney", label: "Chimney & flue", group: "systems", googleQuery: "chimney sweep", related: ["masonry"], licenseTypical: false },
  { slug: "dryer_vent", label: "Dryer vent cleaning", group: "systems", googleQuery: "dryer vent cleaning", related: [], licenseTypical: false },
  { slug: "fire_safety", label: "Fire safety (extinguishers, alarms)", group: "systems", googleQuery: "fire extinguisher service", related: ["electrical"], licenseTypical: true },
  { slug: "elevator", label: "Elevator", group: "specialist", googleQuery: "elevator service company", related: [], licenseTypical: true },
  { slug: "garage_door", label: "Garage doors", group: "outside", googleQuery: "garage door repair", related: [], licenseTypical: false },
  { slug: "gutters", label: "Gutters", group: "outside", googleQuery: "gutter cleaning service", related: ["roofing"], licenseTypical: false },
  { slug: "landscaping", label: "Landscaping", group: "outside", googleQuery: "landscaping service", related: ["tree"], licenseTypical: false },
  { slug: "tree", label: "Tree service", group: "outside", googleQuery: "tree service", related: ["landscaping"], licenseTypical: false },
  { slug: "snow", label: "Snow removal", group: "outside", googleQuery: "snow removal service", related: ["landscaping"], licenseTypical: false },
  { slug: "cleaning", label: "Cleaning", group: "common", googleQuery: "commercial cleaning service", related: [], licenseTypical: false },
  { slug: "pest", label: "Pest control", group: "common", googleQuery: "pest control", related: [], licenseTypical: true },
  { slug: "locksmith", label: "Locksmith", group: "common", googleQuery: "locksmith", placesType: "locksmith", related: [], licenseTypical: false },
  { slug: "appliance", label: "Appliance repair", group: "common", googleQuery: "appliance repair", related: [], licenseTypical: false },
  { slug: "engineer", label: "Structural engineer", group: "specialist", googleQuery: "structural engineer", related: [], licenseTypical: true },
  { slug: "other", label: "Other", group: "other", googleQuery: null, related: [], licenseTypical: false },
];

/** Every slug as a non-empty tuple, for z.enum. */
export const TRADE_SLUGS = TRADES.map((t) => t.slug) as [string, ...string[]];

export const TRADE_GROUP_LABEL: Record<TradeGroup, string> = {
  common: "Common",
  systems: "Building systems",
  outside: "Outside",
  specialist: "Specialists",
  other: "Other",
};

const BY_SLUG = new Map(TRADES.map((t) => [t.slug, t]));

export function tradeLabel(slug: string): string {
  return BY_SLUG.get(slug)?.label ?? slug;
}

export function tradeBySlug(slug: string | null | undefined): Trade | null {
  return slug ? (BY_SLUG.get(slug) ?? null) : null;
}

export const SEARCHABLE_TRADES = TRADES.filter((t) => t.googleQuery !== null);

export function isTradeSlug(slug: string): boolean {
  return BY_SLUG.has(slug);
}

/**
 * Keywords for guessTradeFromText, in priority order (first match wins).
 * A keyword is a whole word (plural "s"/"es" allowed); a trailing `*` makes
 * it a stem with no end boundary ("roof*" matches "roofing"). Several words
 * match with any whitespace between them. The SQL backfills in 0053 use a
 * subset of these with the same boundaries (`\m…\M`).
 */
export const TRADE_KEYWORDS: readonly (readonly [slug: string, keywords: readonly string[]])[] = [
  ["backflow", ["backflow"]],
  ["sewer", ["sewer", "sewage", "rodd*", "main line"]],
  ["dryer_vent", ["dryer vent"]],
  ["fire_safety", ["extinguisher", "smoke detector", "carbon monoxide", "co detector", "fire alarm", "sprinkler"]],
  ["gutters", ["gutter", "downspout"]],
  ["chimney", ["chimney", "flue"]],
  ["elevator", ["elevator"]],
  ["garage_door", ["garage door"]],
  ["waterproofing", ["waterproof*", "basement seep*"]],
  ["tree", ["tree", "branch"]],
  ["windows", ["window", "glass"]],
  ["flooring", ["flooring", "tile", "carpet", "hardwood"]],
  ["concrete", ["sidewalk", "concrete", "steps"]],
  ["hvac", ["boiler", "furnace", "radiator", "heat", "heating", "thermostat", "hvac", "air condition*"]],
  ["roofing", ["roof*", "flashing", "skylight"]],
  ["masonry", ["tuckpoint*", "mason*", "brick", "mortar"]],
  ["plumbing", ["sump", "ejector", "water heater", "leak", "leaking", "leaky", "tap", "faucet", "toilet", "drain", "pipe", "plumb*"]],
  ["electrical", ["outlet", "breaker", "wiring", "electric*", "light", "light fixture", "spark*"]],
  ["painting", ["paint*"]],
  ["carpentry", ["door", "trim", "cabinet", "carpent*"]],
  ["locksmith", ["lock", "locked", "key", "buzzer", "intercom"]],
  ["pest", ["mice", "mouse", "rat", "roach", "bed bug", "pest"]],
  ["snow", ["snow", "ice", "icy"]],
  ["landscaping", ["landscap*", "lawn", "garden", "mulch"]],
  ["cleaning", ["clean*", "janitor*"]],
  ["appliance", ["appliance", "washer", "dryer", "fridge"]],
  ["engineer", ["crack in wall", "foundation", "sagging", "structural"]],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function keywordSource(keyword: string): string {
  const stem = keyword.endsWith("*");
  const body = (stem ? keyword.slice(0, -1) : keyword).split(/\s+/).map(escapeRe).join("\\s+");
  return stem ? `\\b${body}` : `\\b${body}(?:s|es)?\\b`;
}

const TRADE_PATTERNS: readonly (readonly [string, RegExp])[] = TRADE_KEYWORDS.map(([slug, words]) => [
  slug,
  new RegExp(words.map(keywordSource).join("|"), "i"),
]);

/**
 * The trade a free-text description most likely needs, or null. Keyword
 * order and word boundaries as in TRADE_KEYWORDS, so "water heater" reaches
 * plumbing (heat is a whole word), "duct tape" is not a tap and "block party"
 * is not a lock.
 */
export function guessTradeFromText(text: string): string | null {
  if (!text) return null;
  for (const [slug, re] of TRADE_PATTERNS) {
    if (re.test(text)) return slug;
  }
  return null;
}
