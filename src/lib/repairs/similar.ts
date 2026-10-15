// "Already reported?" on the report form (repairs-spec §4.7): open problems
// whose titles look like the one being typed, in the same place. Pure.

const STOP_WORDS = new Set(["the", "a", "an", "of", "in", "on", "at", "to", "is", "it", "and", "or", "my", "our"]);
const THRESHOLD = 0.34;
const MAX_RESULTS = 3;

/** Lowercase letter runs, stop words and anything under 3 letters dropped. */
export function titleTokens(title: string): Set<string> {
  return new Set(
    (title ?? "")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Open tickets that look like the same problem: Jaccard >= 0.34 and the same place (shared, or the same unit). At most 3, closest first. */
export function similarOpenTickets(
  draft: { title: string; where: "shared" | string },
  open: { id: string; reference: number; title: string; unit_id: string | null }[],
): { id: string; reference: number; title: string }[] {
  const mine = titleTokens(draft.title);
  if (mine.size === 0) return [];
  return open
    .filter((t) => (draft.where === "shared" ? t.unit_id === null : t.unit_id === draft.where))
    .map((t) => ({ t, score: jaccard(mine, titleTokens(t.title)) }))
    .filter((x) => x.score >= THRESHOLD)
    .sort((a, b) => b.score - a.score || b.t.reference - a.t.reference)
    .slice(0, MAX_RESULTS)
    .map(({ t }) => ({ id: t.id, reference: t.reference, title: t.title }));
}
