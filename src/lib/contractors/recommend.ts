import "server-only";
import { isUuid, type Supabase } from "@/lib/repairs/server";
import { parseStoredTriage } from "@/lib/repairs/validate";
import { vocabPhrase } from "@/lib/repairs/vocabulary";
import { templateForName } from "@/lib/upkeep/schedule";
import { firstParam, parseWants, type FindParams } from "./find-params";
import type { JobWant, SavedCandidate } from "./ranking";
import { guessTradeFromText, isTradeSlug, tradeBySlug, type Trade } from "./trades";

/**
 * The job a contractor search is for, and the board's own contractors who
 * fit it (repairs-spec §9.1). What reaches Google or web search is decided
 * here and only here: the trade's own words, an upkeep template's phrase, or
 * a phrase the board confirmed with "Use it", always re-run through
 * vocabPhrase so a hand-edited URL can carry nothing outside the vocabulary.
 * The triage phrase is only ever offered, never sent on its own.
 */

export interface JobContext {
  trade: Trade | null;
  /** What will be searched: the confirmed phrase, else the template phrase, else "". */
  phrase: string;
  /** vocabPhrase(triage.search_phrase) for a ticket, when it differs from phrase; else "". */
  suggestedPhrase: string;
  urgent: boolean;
  wants: JobWant[];
  source:
    | { kind: "ticket"; id: string; reference: number; title: string; assignedVendorId: string | null; open: boolean }
    | { kind: "task"; id: string; name: string }
    | { kind: "trade" };
}

const OPEN = new Set(["open", "in_progress", "waiting_on_contractor"]);

/** Null when the ticket or task in the URL isn't visible to the caller. */
export async function resolveJob(supabase: Supabase, sp: FindParams): Promise<JobContext | null> {
  const ticketId = firstParam(sp.ticket);
  const taskId = firstParam(sp.task);
  const tradeParam = firstParam(sp.trade);
  const urlTrade = tradeParam && isTradeSlug(tradeParam) ? tradeBySlug(tradeParam) : null;
  const confirmed = vocabPhrase(firstParam(sp.phrase) ?? null);

  if (ticketId) {
    if (!isUuid(ticketId)) return null;
    const { data } = await supabase
      .from("tickets")
      .select("id, reference, title, trade, priority, emergency_kind, status, assigned_vendor_id, ticket_board_details(triage)")
      .eq("id", ticketId)
      .limit(1);
    const t = data?.[0];
    if (!t) return null;
    const details = (Array.isArray(t.ticket_board_details) ? t.ticket_board_details[0] : t.ticket_board_details) as { triage?: unknown } | null;
    const triage = details?.triage ? parseStoredTriage(details.triage) : null;
    const triageTrade = triage?.state === "done" && triage.trade && isTradeSlug(triage.trade) ? triage.trade : null;
    const trade = urlTrade ?? tradeBySlug((t.trade as string | null) ?? triageTrade);
    const suggested = triage?.state === "done" ? vocabPhrase(triage.search_phrase ?? null) : "";
    const urgent = t.priority === "urgent" || t.emergency_kind !== null;
    return {
      trade: trade && trade.googleQuery ? trade : null,
      phrase: confirmed,
      suggestedPhrase: suggested && suggested !== confirmed ? suggested : "",
      urgent,
      wants: parseWants(sp.want, urgent),
      source: {
        kind: "ticket",
        id: t.id as string,
        reference: t.reference as number,
        title: t.title as string,
        assignedVendorId: (t.assigned_vendor_id as string | null) ?? null,
        open: OPEN.has(t.status as string),
      },
    };
  }

  if (taskId) {
    if (!isUuid(taskId)) return null;
    const { data } = await supabase.from("upkeep_tasks").select("id, name, trade").eq("id", taskId).limit(1);
    const task = data?.[0];
    if (!task) return null;
    const own = tradeBySlug((task.trade as string | null) ?? guessTradeFromText(task.name as string));
    const trade = urlTrade ?? own;
    const template = templateForName(task.name as string);
    // The template's words describe the template's trade; after "Change" to another trade they would mislead.
    const templatePhrase = template && trade && template.trade === trade.slug ? template.searchPhrase : "";
    return {
      trade: trade && trade.googleQuery ? trade : null,
      phrase: confirmed || vocabPhrase(templatePhrase),
      suggestedPhrase: "",
      urgent: false,
      wants: parseWants(sp.want, false),
      source: { kind: "task", id: task.id as string, name: task.name as string },
    };
  }

  return {
    trade: urlTrade && urlTrade.googleQuery ? urlTrade : null,
    phrase: confirmed,
    suggestedPhrase: "",
    urgent: false,
    wants: parseWants(sp.want, false),
    source: { kind: "trade" },
  };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const latest = (...dates: (string | null | undefined)[]): string | null =>
  dates.filter((d): d is string => Boolean(d)).map((d) => d.slice(0, 10)).sort().pop() ?? null;

/**
 * The board's contractors for a trade and its related trades: not archived,
 * not do-not-use, with review averages and tag counts, jobs and last-used
 * dates (problems, payments, upkeep), and the compliance facts ranking uses.
 * Saved contractors have no stored location, so distance is null (neutral).
 */
export async function loadSavedCandidates(
  supabase: Supabase,
  trade: Trade | string,
  relatedTrades: string[],
  todayIso: string,
): Promise<SavedCandidate[]> {
  const slug = typeof trade === "string" ? trade : trade.slug;
  const { data: vendors } = await supabase
    .from("vendors")
    .select(
      "id, name, trades, status, phone, email, website_url, google_rating, google_review_count, board_rating, last_used_on, emergency_service, job_tags, insured_until, license_number, w9_on_file, rate_hourly::text, rate_trip_fee::text, rate_after_hours::text, rates_as_of",
    )
    .is("archived_at", null)
    .neq("status", "do_not_use")
    .overlaps("trades", [slug, ...relatedTrades])
    .order("name")
    .limit(200);
  const rows = vendors ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((v) => v.id as string);

  const [reviews, tickets, expenses, upkeep] = await Promise.all([
    supabase.from("contractor_reviews").select("vendor_id, rating, tags").in("vendor_id", ids),
    supabase.from("tickets").select("assigned_vendor_id, opened_on").in("assigned_vendor_id", ids),
    supabase.from("expenses").select("vendor_id, paid_on").in("vendor_id", ids),
    supabase.from("upkeep_log").select("vendor_id, done_on, ticket_id").in("vendor_id", ids),
  ]);

  const rev = new Map<string, { sum: number; count: number; tags: Record<string, number> }>();
  for (const r of reviews.data ?? []) {
    const cur = rev.get(r.vendor_id as string) ?? { sum: 0, count: 0, tags: {} };
    cur.sum += Number(r.rating);
    cur.count += 1;
    for (const tag of (r.tags as string[] | null) ?? []) cur.tags[tag] = (cur.tags[tag] ?? 0) + 1;
    rev.set(r.vendor_id as string, cur);
  }
  const jobs = new Map<string, number>();
  const last = new Map<string, string>();
  const bump = (id: string | null, date: string | null) => {
    if (!id || !date) return;
    const d = date.slice(0, 10);
    if (!last.has(id) || d > last.get(id)!) last.set(id, d);
  };
  for (const t of tickets.data ?? []) {
    const id = t.assigned_vendor_id as string;
    jobs.set(id, (jobs.get(id) ?? 0) + 1);
    bump(id, t.opened_on as string);
  }
  for (const e of expenses.data ?? []) bump(e.vendor_id as string, e.paid_on as string);
  for (const u of upkeep.data ?? []) {
    const id = u.vendor_id as string;
    // A close-out that also logged upkeep is one job, already counted as the problem.
    if (!u.ticket_id) jobs.set(id, (jobs.get(id) ?? 0) + 1);
    bump(id, u.done_on as string);
  }

  return rows.map((v) => {
    const id = v.id as string;
    const r = rev.get(id);
    const insured = (v.insured_until as string | null) ?? null;
    return {
      kind: "saved" as const,
      vendorId: id,
      name: v.name as string,
      trades: (v.trades as string[] | null) ?? [],
      status: v.status as "preferred" | "okay",
      phone: str(v.phone),
      email: str(v.email),
      website: str(v.website_url),
      googleRating: v.google_rating === null || v.google_rating === undefined ? null : Number(v.google_rating),
      googleReviewCount: (v.google_review_count as number | null) ?? null,
      boardReviews: {
        count: r?.count ?? 0,
        average: r && r.count ? r.sum / r.count : null,
        tags: (r?.tags ?? {}) as SavedCandidate["boardReviews"]["tags"],
      },
      boardRating: (v.board_rating as number | null) ?? null,
      jobs: jobs.get(id) ?? 0,
      lastUsedOn: latest(last.get(id), v.last_used_on as string | null),
      emergencyService: v.emergency_service === true,
      jobTags: ((v.job_tags as string[] | null) ?? []) as SavedCandidate["jobTags"],
      rates: {
        hourly: (v.rate_hourly as string | null) ?? null,
        tripFee: (v.rate_trip_fee as string | null) ?? null,
        afterHours: (v.rate_after_hours as string | null) ?? null,
        asOf: (v.rates_as_of as string | null) ?? null,
      },
      compliance: {
        coiCurrent: Boolean(insured && insured >= todayIso),
        coiExpired: Boolean(insured && insured < todayIso),
        licenseOnFile: Boolean(str(v.license_number)),
        w9OnFile: v.w9_on_file === true,
      },
      distanceMiles: null,
    };
  });
}
