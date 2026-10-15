// The find page's URL (repairs-spec §9.1): which job, which kind of work,
// the confirmed search phrase and "What matters for this job". Every toggle
// is a GET link, so a search is linkable and works without JavaScript. Pure.

import { JOB_WANTS, type JobWant } from "./ranking";

export interface FindParams {
  ticket?: string;
  task?: string;
  trade?: string;
  phrase?: string;
  want?: string | string[];
}

/** Explicitly no wants, so an urgent job's default ("emergency") can be switched off. */
export const NO_WANTS = "none";

export const WANT_LABEL: Record<JobWant, string> = {
  emergency: "Emergency or after hours",
  condo_work: "Works on condo or multi-unit buildings",
  small_jobs: "Small jobs welcome",
  free_estimates: "Gives free estimates",
};

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * The wants in the URL, in the fixed order. With no `want` at all, an urgent
 * job starts with "emergency"; `want=none` means the board switched them all off.
 */
export function parseWants(want: string | string[] | undefined, urgent: boolean): JobWant[] {
  const list = (Array.isArray(want) ? want : want === undefined ? [] : [want]).map(String);
  if (list.length === 0) return urgent ? ["emergency"] : [];
  return JOB_WANTS.filter((w) => list.includes(w));
}

/** /repairs/find with the job, trade, phrase and wants, dropping empty values. */
export function findHref(p: { ticket?: string | null; task?: string | null; trade?: string | null; phrase?: string | null; wants?: JobWant[] | null }): string {
  const q = new URLSearchParams();
  if (p.ticket) q.set("ticket", p.ticket);
  if (p.task) q.set("task", p.task);
  if (p.trade) q.set("trade", p.trade);
  if (p.phrase) q.set("phrase", p.phrase);
  if (p.wants) {
    if (p.wants.length === 0) q.append("want", NO_WANTS);
    else for (const w of p.wants) q.append("want", w);
  }
  const s = q.toString();
  return s ? `/repairs/find?${s}` : "/repairs/find";
}

/** The same search with one want switched on or off. */
export function toggleWant(wants: JobWant[], want: JobWant): JobWant[] {
  return wants.includes(want) ? wants.filter((w) => w !== want) : JOB_WANTS.filter((w) => w === want || wants.includes(w));
}

/** The first value of a query parameter, trimmed. */
export function firstParam(v: string | string[] | undefined): string | undefined {
  const s = first(v)?.trim();
  return s ? s : undefined;
}

/** "offer emergency service, take small jobs and give free estimates": for the search-words line. */
export function joinWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** At most this many contractors in one quote request (repairs-spec §8.2). */
export const MAX_ASK = 5;

/** The ask bar's primary label and whether it may be pressed. */
export function askBarState(selected: number, forTicket: boolean): { label: string; disabled: boolean; note: string | null } {
  if (!forTicket) {
    return { label: `Save ${selected} to your contractors`, disabled: selected === 0, note: null };
  }
  return {
    label: `Ask ${selected} for quotes`,
    disabled: selected === 0 || selected > MAX_ASK,
    note: selected > MAX_ASK ? "Pick up to 5." : null,
  };
}
