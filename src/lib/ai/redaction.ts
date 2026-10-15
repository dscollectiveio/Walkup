import "server-only";
import type { Supabase } from "./usage";

/**
 * Terms scrubWebTask removes before anything goes to web search (brief
 * decision 4), read under the caller's RLS. Web research is board-only, and
 * the board reads persons, so the list is complete for the people who use it.
 *
 *   names     every persons.full_name in the association, plus each of its tokens of 3 or
 *             more letters (excluding: the, and, von, van, der, del, los, las)
 *   addresses associations.street_address, legal_name and display_name
 *   keep      associations.city, state_code, and the state's name ("Illinois")
 */

const SKIP_TOKENS = new Set(["the", "and", "von", "van", "der", "del", "los", "las"]);

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** Pure part, exported for tests: names and their tokens. */
export function nameTerms(fullNames: string[]): string[] {
  const out = new Set<string>();
  for (const raw of fullNames) {
    const name = raw?.trim();
    if (!name) continue;
    out.add(name);
    for (const token of name.split(/[\s,.'’-]+/)) {
      if (/^\p{L}{3,}$/u.test(token) && !SKIP_TOKENS.has(token.toLowerCase())) out.add(token);
    }
  }
  return [...out];
}

export async function loadRedactionTerms(
  supabase: Supabase,
  associationId: string,
): Promise<{ names: string[]; addresses: string[]; keep: string[]; unavailable?: true }> {
  const [{ data: people, error: peopleError }, { data: assoc, error: assocError }] = await Promise.all([
    supabase.from("persons").select("full_name").eq("association_id", associationId),
    supabase
      .from("associations")
      .select("legal_name, display_name, street_address, city, state_code")
      .eq("id", associationId)
      .maybeSingle(),
  ]);

  const a = (assoc ?? null) as {
    legal_name: string | null; display_name: string | null; street_address: string | null;
    city: string | null; state_code: string | null;
  } | null;

  const names = nameTerms(((people ?? []) as { full_name: string | null }[]).map((p) => p.full_name ?? ""));
  const addresses = [a?.street_address, a?.legal_name, a?.display_name]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
  const state = a?.state_code?.trim().toUpperCase() ?? "";
  const keep = [a?.city?.trim(), state || undefined, STATE_NAMES[state]]
    .filter((s): s is string => Boolean(s));

  // A failed lookup must not read as "nothing to remove": the caller refuses to search (REVIEW-2 #11).
  return { names, addresses, keep, ...(peopleError || assocError || !a ? { unavailable: true as const } : {}) };
}
