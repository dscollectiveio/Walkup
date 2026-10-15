// Text bound for the triage model (repairs-spec §4.8). It removes what can
// be recognised (tax IDs, emails, phone numbers, unit references such as
// "unit 2" or "#3", dollar amounts, street addresses) through the foundation's
// scrubWebTask, and drops pairs of capitalised words that read as a person's
// name ("Jane Doe's radiator"). A lone first name can still get through; the
// privacy page says reported problems go to the AI service. Nothing from the
// triage call reaches a search engine except through vocabPhrase.

import { scrubWebTask } from "@/lib/ai/verify";

const MODEL_TEXT_MAX = 2_000;

/** Capitalised words that start a pair without being a person ("Fire Department", "Main Street", days, months). */
const NOT_A_NAME = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "fire", "police", "gas", "water", "electric", "city", "main", "front", "back", "north", "south", "east", "west",
  "first", "second", "third", "top", "ground", "basement", "boiler", "hot", "cold", "building", "unit", "the", "no", "yes",
  "com", "ed", "chicago", "illinois",
]);

/** "Jane Doe" or "Jane Doe's": two capitalised words in a row, neither a common non-name word. */
function dropNamePairs(text: string): string {
  return text.replace(/\b([A-Z][a-z]{1,})\s+([A-Z][a-z]{1,})(?:['’]s)?\b/g, (m, a: string, b: string) =>
    NOT_A_NAME.has(a.toLowerCase()) || NOT_A_NAME.has(b.toLowerCase()) ? m : "[removed]",
  );
}

/** scrubWebTask() (which also cuts to 2,000), then cut to `max` (at most 2,000) at a word boundary. "" for nothing. */
export function scrubForModel(text: string | null, max: number): string {
  if (!text || !text.trim()) return "";
  const limit = Math.max(0, Math.min(Math.floor(max), MODEL_TEXT_MAX));
  const scrubbed = scrubWebTask(dropNamePairs(text), { names: [], addresses: [] });
  // At 2,000 characters scrubWebTask may have cut mid-word, so the last word is dropped too.
  const cutByScrub = scrubbed.length >= MODEL_TEXT_MAX;
  if (scrubbed.length <= limit && !cutByScrub) return scrubbed.trimEnd();
  const head = cutByScrub && limit >= scrubbed.length ? scrubbed : scrubbed.slice(0, limit + 1);
  const cut = head.lastIndexOf(" ");
  return (cut > 0 ? head.slice(0, cut) : scrubbed.slice(0, limit)).trimEnd();
}
