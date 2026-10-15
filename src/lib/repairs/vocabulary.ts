// The only words Walkup will put in a Google or web search phrase
// (repairs-spec §4.8). Built at module load from the trade list, the upkeep
// templates, the trade keywords and a fixed list, and from nothing else, so
// names, street words, digits and unit words can't reach a search engine.

import { TRADE_KEYWORDS, TRADES } from "@/lib/contractors/trades";
import { UPKEEP_TEMPLATES } from "@/lib/upkeep/schedule";

const FIXED_WORDS = `repair repairs replace replacement install
installation inspection inspect service cleaning clean leak leaking leaky
drip dripping clog clogged blocked backup broken cracked crack cold hot
heat heating cooling noise noisy rattling stuck jammed loose damaged damage
water gas electric electrical power outage emergency sewer drain drains
pipe pipes frozen burst flood flooding mold mould rot rotted rotten moisture
damp ceiling wall walls floor floors stair stairs stairwell hallway hall
basement roof attic porch deck balcony door doors window windows lock
locks buzzer intercom outlet outlets breaker panel light lights fixture
smoke detector detectors alarm alarms boiler furnace radiator radiators
thermostat vent vents chimney gutter gutters downspout downspouts brick
bricks mortar concrete sidewalk steps tile tiles carpet drywall plaster
paint painting siding fence garage elevator sump pump ejector toilet faucet
sink tub shower dryer washer appliance appliances pest pests mice rats
roaches termites bees wasps tree trees branch snow ice salting
landscaping lawn tuckpointing masonry waterproofing foundation structural
condo multi-unit building residential`;

/** Lowercase words of letters and hyphens; "&", digits and punctuation split words and are dropped. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z-]+/)
    .map((w) => w.replace(/^-+|-+$/g, ""))
    .filter(Boolean);
}

// Joining words from the sources above ("Smoke and CO detector", "crack in
// wall") carry nothing a search needs, and a phrase of just "and" is noise.
const FUNCTION_WORDS = new Set(["a", "an", "and", "at", "in", "of", "on", "or", "the", "to"]);

function buildVocabulary(): ReadonlySet<string> {
  const out = new Set<string>();
  const add = (text: string | null | undefined) => {
    for (const w of words(text ?? "")) if (!FUNCTION_WORDS.has(w)) out.add(w);
  };
  for (const t of TRADES) {
    add(t.label);
    add(t.googleQuery);
  }
  for (const t of UPKEEP_TEMPLATES) {
    add(t.searchPhrase);
    add(t.name);
  }
  for (const [, keywords] of TRADE_KEYWORDS) for (const k of keywords) add(k.replace(/\*$/, ""));
  add(FIXED_WORDS);
  return out;
}

/** Every word Walkup will put in a Google or web search phrase. Lowercase, letters and hyphens only. */
export const REPAIR_VOCABULARY: ReadonlySet<string> = buildVocabulary();

const MAX_PHRASE_WORDS = 5;

/**
 * A search phrase made only of vocabulary words: lowercase, split on anything
 * that isn't a letter or hyphen, keep words in REPAIR_VOCABULARY (first five,
 * in order, deduped), join with spaces; "" when none survive. So
 * "Bo radiator cold" becomes "radiator cold".
 */
export function vocabPhrase(raw: string | null): string {
  if (!raw) return "";
  const kept: string[] = [];
  for (const w of words(raw)) {
    if (kept.length >= MAX_PHRASE_WORDS) break;
    if (REPAIR_VOCABULARY.has(w) && !kept.includes(w)) kept.push(w);
  }
  return kept.join(" ");
}
