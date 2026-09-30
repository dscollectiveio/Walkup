// The one list of trades. Adding a trade is one line here.
//
// `googleQuery` is the text sent to Google Places Text Search; null means the
// trade can't be searched (manual only). `licenseLookupUrl` is a public
// license lookup for the building's jurisdiction — deliberately left unset
// until someone has verified the exact page, because a wrong link here would
// look authoritative. See docs/reference/build-prompt-budget-contractors-insurance-taxes.md.

export interface Trade {
  slug: string;
  label: string;
  googleQuery: string | null;
  licenseLookupUrl?: Partial<Record<string, string>>; // keyed by state code, e.g. "IL"
}

export const TRADES: Trade[] = [
  { slug: "plumbing", label: "Plumbing", googleQuery: "plumber" },
  { slug: "electrical", label: "Electrical", googleQuery: "electrician" },
  { slug: "hvac", label: "Heating & cooling", googleQuery: "HVAC contractor" },
  { slug: "roofing", label: "Roofing", googleQuery: "roofing contractor" },
  { slug: "masonry", label: "Masonry & tuckpointing", googleQuery: "masonry contractor" },
  { slug: "general", label: "General contractor", googleQuery: "general contractor" },
  { slug: "painting", label: "Painting", googleQuery: "painting contractor" },
  { slug: "carpentry", label: "Carpentry", googleQuery: "carpenter" },
  { slug: "landscaping", label: "Landscaping", googleQuery: "landscaping service" },
  { slug: "snow", label: "Snow removal", googleQuery: "snow removal service" },
  { slug: "cleaning", label: "Cleaning", googleQuery: "commercial cleaning service" },
  { slug: "pest", label: "Pest control", googleQuery: "pest control" },
  { slug: "locksmith", label: "Locksmith", googleQuery: "locksmith" },
  { slug: "appliance", label: "Appliance repair", googleQuery: "appliance repair" },
  { slug: "other", label: "Other", googleQuery: null },
];

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
