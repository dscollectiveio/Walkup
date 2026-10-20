// The searches a person has run on Find a contractor, kept in their own browser so they can run one
// again. Pure: the page reads and writes the browser's storage, this is the list logic and the wording.

export interface HistoryEntry {
  /** The find page link that re-runs exactly this search. */
  href: string;
  /** Which problem or upkeep job it was for ("" for a search with none), so a list only shows its own. */
  job: string;
  tradeLabel: string;
  /** The words searched, for "describe the scope of work". */
  phrase: string;
  miles: number;
  minRating: number;
  minReviews: number;
  emergency: boolean;
  /** When it was run (ISO). */
  at: string;
}

export const HISTORY_LIMIT = 10;

/** Newest first, the same search moved to the top rather than listed twice, and no more than the limit. */
export function addEntry(list: HistoryEntry[], entry: HistoryEntry, limit: number = HISTORY_LIMIT): HistoryEntry[] {
  return [entry, ...list.filter((e) => e.href !== entry.href)].slice(0, limit);
}

/** Whatever was stored, as a clean list; anything that isn't one comes back empty. */
export function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (e): e is HistoryEntry =>
          e !== null &&
          typeof e === "object" &&
          typeof e.href === "string" &&
          e.href.startsWith("/repairs/find") &&
          typeof e.tradeLabel === "string" &&
          typeof e.at === "string",
      )
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

/** "Plumbing, 15 miles, 4+ stars, Emergency Services (Oct 20)". */
export function historyLabel(e: HistoryEntry): string {
  const what = e.phrase ? `"${e.phrase}"` : e.tradeLabel;
  const parts = [
    what,
    `${e.miles} miles`,
    e.minRating ? `${e.minRating}+ stars` : null,
    e.minReviews ? `${e.minReviews}+ reviews` : null,
    e.emergency ? "Emergency Services" : null,
  ].filter(Boolean);
  const when = new Date(e.at);
  const day = Number.isNaN(when.getTime()) ? "" : ` (${when.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`;
  return `${parts.join(", ")}${day}`;
}
