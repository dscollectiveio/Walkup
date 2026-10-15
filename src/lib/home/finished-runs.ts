// Background AI runs that finished after the person left the page
// (foundation-spec 5.3, owned here): the contractor web search and the
// Marketplace's agency and insurer searches run in after(), so whoever started
// one may have moved on before it ended. Home says so for a day, then lets it
// go: the result itself stays on its own page. Pure.
//
// Insurance reads are not here: loadInsuranceBanners already raises "Walkup
// finished reading {file}" until the board saves or dismisses it.

import { findHref } from "@/lib/contractors/find-params";
import { JOB_WANTS, type JobWant } from "@/lib/contractors/ranking";
import { tradeBySlug } from "@/lib/contractors/trades";

/** How long a finished run stays on Home. */
export const FINISHED_RUN_HOURS = 24;

export interface FinishedRun {
  key: string;
  title: string;
  why: string;
  href: string;
  action: string;
  failed: boolean;
}

export interface ContractorRunRow {
  id: string;
  trade: string;
  /** `${phrase}|${wants}` lower-cased (webCacheKey in lib/contractors/found). */
  query_key: string;
  ai_state: string;
  ai_finished_at: string | null;
  resultCount: number;
}

export interface MarketRunRow {
  kind: string;
  ai_state: string;
  ai_finished_at: string | null;
  itemCount: number;
}

const BACKGROUND = "It ran in the background after you left the page.";

function recent(finishedAt: string | null, now: Date): boolean {
  if (!finishedAt) return false;
  const t = Date.parse(finishedAt);
  return Number.isFinite(t) && t <= now.getTime() + 60_000 && now.getTime() - t <= FINISHED_RUN_HOURS * 3_600_000;
}

/** The phrase and wants back out of a web cache row's query_key, for a link to the same search. */
export function parseQueryKey(queryKey: string): { phrase: string; wants: JobWant[] } {
  const bar = queryKey.lastIndexOf("|");
  const phrase = (bar >= 0 ? queryKey.slice(0, bar) : queryKey).trim();
  const listed = bar >= 0 ? queryKey.slice(bar + 1).split(",").map((w) => w.trim()) : [];
  return { phrase, wants: JOB_WANTS.filter((w) => listed.includes(w)) };
}

export function finishedRuns(input: { contractor: ContractorRunRow[]; market: MarketRunRow[]; now: Date }): FinishedRun[] {
  const runs: { at: number; run: FinishedRun }[] = [];

  for (const r of input.contractor) {
    if ((r.ai_state !== "done" && r.ai_state !== "failed") || !recent(r.ai_finished_at, input.now)) continue;
    const trade = tradeBySlug(r.trade);
    const { phrase, wants } = parseQueryKey(r.query_key);
    const what = phrase || trade?.label.toLowerCase() || "contractors";
    // The same search: an empty wants list goes out as want=none, so the find
    // page doesn't add its urgent-job default and miss the cached row.
    const href = findHref({ trade: r.trade, phrase: phrase || null, wants });
    const failed = r.ai_state === "failed";
    runs.push({
      at: Date.parse(r.ai_finished_at!),
      run: failed
        ? {
            key: `contractor:${r.id}`,
            title: `The contractor search for “${what}” didn't finish`,
            why: "Open it to see why and try again.",
            href,
            action: "Open the search",
            failed,
          }
        : {
            key: `contractor:${r.id}`,
            title: `Contractor search finished: ${r.resultCount} found for “${what}”`,
            why: BACKGROUND,
            href,
            action: r.resultCount > 0 ? "See them" : "Open the search",
            failed,
          },
    });
  }

  for (const m of input.market) {
    if ((m.ai_state !== "done" && m.ai_state !== "failed") || !recent(m.ai_finished_at, input.now)) continue;
    const who = m.kind === "insurers" ? "insurer" : "agency";
    const failed = m.ai_state === "failed";
    runs.push({
      at: Date.parse(m.ai_finished_at!),
      run: failed
        ? {
            key: `market:${m.kind}`,
            title: `The ${who} search didn't finish`,
            why: "Open the Marketplace to see why and try again.",
            href: "/insurance?view=market",
            action: "Open the Marketplace",
            failed,
          }
        : {
            key: `market:${m.kind}`,
            title: `${who === "insurer" ? "Insurer" : "Agency"} search finished: ${m.itemCount} found`,
            why: BACKGROUND,
            href: "/insurance?view=market",
            action: m.itemCount > 0 ? "See them" : "Open the Marketplace",
            failed,
          },
    });
  }

  // Newest first.
  return runs.sort((a, b) => b.at - a.at).map((r) => r.run);
}
