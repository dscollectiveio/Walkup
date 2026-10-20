// Ranking contractors for a job, with the reasons shown (brief decision 6,
// repairs-spec §4.11). Ratings are review-count weighted, so 5.0 from one
// review does not outrank 4.8 from 900. Pure.

import { hostOf, normaliseBusinessName, phoneDigits } from "@/lib/ai/verify";
import { humanDate, monthYear } from "@/lib/repairs/format";
import { tradeLabel } from "./trades";

export const GOOGLE_PRIOR = { mean: 4.3, weight: 20 } as const;
export const BOARD_PRIOR = { mean: 3.5, weight: 2 } as const;
export const MAX_DISTANCE_MILES = 15;
export const WEIGHTS = {
  trade: 30, relatedTrade: 15, rating: 25, distance: 15,
  preferred: 20, usedBefore: 10, boardLoved: 5,
  coi: 5, license: 3, w9: 2, emergency: 10, wanted: 8,
} as const;
export const MAX_WHY = 5;

/** Review-count-weighted rating: (C*m + R*v) / (C + v). Null when there is no rating. */
export function bayesianRating(rating: number | null, count: number | null, prior: { mean: number; weight: number }): number | null {
  if (rating === null || rating === undefined || !Number.isFinite(rating)) return null;
  // A rating with no reviews behind it is not a rating (it would collapse to the prior and
  // outrank a contractor nobody has rated at all), and a count must be a finite number.
  const v = typeof count === "number" && Number.isFinite(count) && count > 0 ? count : 0;
  if (v === 0) return null;
  const r = Math.min(5, Math.max(1, rating));
  return (prior.weight * prior.mean + r * v) / (prior.weight + v);
}

/** 0..1: (bayes - 3.5) / 1.5 clamped; 0.3 when unrated. */
export function ratingComponent(bayes: number | null): number {
  if (bayes === null) return 0.3;
  return Math.min(1, Math.max(0, (bayes - 3.5) / 1.5));
}

export interface Why { key: string; text: string; tone: "good" | "neutral" | "warning" | "bad" }

/** "What matters for this job" toggles on the find page (9.1). */
export type JobWant = "emergency" | "condo_work" | "small_jobs" | "free_estimates";
export const JOB_WANTS: readonly JobWant[] = ["emergency", "condo_work", "small_jobs", "free_estimates"];
type JobTag = "condo_work" | "small_jobs" | "free_estimates";

export interface SavedCandidate {
  kind: "saved"; vendorId: string; name: string; trades: string[]; status: "preferred" | "okay";
  phone: string | null; email: string | null; website: string | null;
  googleRating: number | null; googleReviewCount: number | null;
  boardReviews: { count: number; average: number | null; tags: Partial<Record<"on_time" | "left_clean" | "price_matched" | "would_hire_again", number>> };
  boardRating: number | null;
  jobs: number; lastUsedOn: string | null;
  emergencyService: boolean;
  /** Board-entered. */
  jobTags: JobTag[];
  rates: { hourly: string | null; tripFee: string | null; afterHours: string | null; asOf: string | null };
  compliance: { coiCurrent: boolean; coiExpired: boolean; licenseOnFile: boolean; w9OnFile: boolean };
  distanceMiles: number | null;
}

export interface FoundCandidate {
  kind: "google" | "web";
  /** "g:<placeId>" | "w:<cache row id>:<index>" */
  candidateId: string;
  name: string; address: string | null;
  /** Web only, verified in a citation. */
  cityText: string | null;
  phone: string | null; email: string | null; website: string | null;
  /** ratingSource: "Google" or the site named in the citation. */
  rating: number | null; reviewCount: number | null; ratingSource: string | null;
  /** The cache row's fetched_at. */
  ratingAsOf: string;
  distanceMiles: number | null;
  /** Google only: open at the moment of the search, and open around the clock. null or absent = not known. */
  openNow?: boolean | null;
  open24h?: boolean | null;
  /** Verified from the business's own website (web) or not known (google): null = not known. */
  flags: { emergencyService: boolean | null; condoWork: boolean | null; smallJobs: boolean | null; freeEstimates: boolean | null };
  placeId: string | null; sourceUrls: string[]; snippet: string | null;
  alreadySaved: { vendorId: string; status: "preferred" | "okay" | "do_not_use"; doNotUseReason: string | null; archived: boolean } | null;
}

export interface RankContext { trade: string; relatedTrades: string[]; urgent: boolean; wants: JobWant[]; todayIso: string }

const FLAG_FOR_WANT: Record<JobWant, keyof FoundCandidate["flags"]> = {
  emergency: "emergencyService",
  condo_work: "condoWork",
  small_jobs: "smallJobs",
  free_estimates: "freeEstimates",
};

const SAVED_WANT_TEXT: Record<JobTag, string> = {
  condo_work: "Your board says: works on condo buildings",
  small_jobs: "Your board says: small jobs welcome",
  free_estimates: "Your board says: free estimates",
};
const FOUND_WANT_TEXT: Record<JobTag, string> = {
  condo_work: "Mentions condo work",
  small_jobs: "Small jobs welcome",
  free_estimates: "Free estimates",
};

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

function distanceTerm(miles: number | null): number {
  // unknown (missing or not a number) counts as halfway; a negative distance cannot beat the cap
  const known = typeof miles === "number" && Number.isFinite(miles);
  return WEIGHTS.distance * (known ? Math.min(1, Math.max(0, 1 - miles / MAX_DISTANCE_MILES)) : 0.5);
}

function milesText(miles: number): string {
  const r = Math.round(miles * 10) / 10;
  return `${r} mi away`;
}

/**
 * The emergency term, added once: urgent jobs (WEIGHTS.emergency) or the
 * "takes emergency calls" toggle (WEIGHTS.wanted) don't stack.
 */
function emergencyTerm(meets: boolean, ctx: RankContext): number {
  if (!meets) return 0;
  if (ctx.urgent) return WEIGHTS.emergency;
  return ctx.wants.includes("emergency") ? WEIGHTS.wanted : 0;
}

function savedRating(c: SavedCandidate): number | null {
  if (c.boardReviews.count > 0 && c.boardReviews.average !== null) {
    return bayesianRating(c.boardReviews.average, c.boardReviews.count, BOARD_PRIOR);
  }
  if (c.boardRating !== null) return bayesianRating(c.boardRating, 1, BOARD_PRIOR);
  return bayesianRating(c.googleRating, c.googleReviewCount, GOOGLE_PRIOR);
}

export function savedScore(c: SavedCandidate, ctx: RankContext): number {
  const trade = c.trades.includes(ctx.trade)
    ? WEIGHTS.trade
    : ctx.relatedTrades.some((t) => c.trades.includes(t)) ? WEIGHTS.relatedTrade : 0;
  const boardLoved = c.boardReviews.count >= 2 && (c.boardReviews.average ?? 0) >= 4;
  let score = trade
    + WEIGHTS.rating * ratingComponent(savedRating(c))
    + distanceTerm(c.distanceMiles)
    + (c.status === "preferred" ? WEIGHTS.preferred : 0)
    + (c.jobs > 0 ? WEIGHTS.usedBefore : 0)
    + (boardLoved ? WEIGHTS.boardLoved : 0)
    + (c.compliance.coiCurrent ? WEIGHTS.coi : 0)
    + (c.compliance.licenseOnFile ? WEIGHTS.license : 0)
    + (c.compliance.w9OnFile ? WEIGHTS.w9 : 0)
    + emergencyTerm(c.emergencyService, ctx);
  for (const want of ctx.wants) {
    if (want !== "emergency" && c.jobTags.includes(want)) score += WEIGHTS.wanted;
  }
  return score;
}

function isDoNotUse(c: FoundCandidate): boolean {
  return c.alreadySaved?.status === "do_not_use";
}

export function foundScore(c: FoundCandidate, ctx: RankContext): number {
  // Searched for the trade, so the trade term always applies. A do-not-use
  // match gets nothing beyond it.
  if (isDoNotUse(c)) return WEIGHTS.trade;
  // Public review sites share Google's prior; only the board's own reviews use BOARD_PRIOR.
  let score = WEIGHTS.trade
    + WEIGHTS.rating * ratingComponent(bayesianRating(c.rating, c.reviewCount, GOOGLE_PRIOR))
    + distanceTerm(c.distanceMiles)
    + emergencyTerm(c.flags.emergencyService === true, ctx);
  for (const want of ctx.wants) {
    if (want !== "emergency" && c.flags[FLAG_FOR_WANT[want]] === true) score += WEIGHTS.wanted;
  }
  return score;
}

export function savedWhy(c: SavedCandidate, ctx: RankContext): Why[] {
  const why: Why[] = [];
  if (c.trades.includes(ctx.trade)) {
    why.push({ key: "trade", text: `Does ${tradeLabel(ctx.trade)}`, tone: "good" });
  } else {
    const related = ctx.relatedTrades.find((t) => c.trades.includes(t));
    if (related) why.push({ key: "related_trade", text: `Also does ${tradeLabel(related)}`, tone: "neutral" });
  }
  if (c.status === "preferred") why.push({ key: "preferred", text: "Preferred by your board", tone: "good" });
  if (c.jobs > 0) {
    const last = c.lastUsedOn ? `, last ${monthYear(c.lastUsedOn)}` : "";
    why.push({ key: "used_before", text: `Used ${c.jobs} ${plural(c.jobs, "time")}${last}`, tone: "good" });
  }
  if (c.boardReviews.count > 0 && c.boardReviews.average !== null) {
    why.push({
      key: "board_reviews",
      text: `Your board: ${c.boardReviews.average.toFixed(1)} from ${c.boardReviews.count} ${plural(c.boardReviews.count, "review")}`,
      tone: c.boardReviews.average >= 4 ? "good" : "neutral",
    });
  }
  const hireAgain = c.boardReviews.tags.would_hire_again ?? 0;
  if (hireAgain >= 1) why.push({ key: "would_hire_again", text: `Your board: would hire again (${hireAgain})`, tone: "good" });
  if (c.googleRating !== null) {
    why.push({
      key: "rating",
      text: `Google ${c.googleRating.toFixed(1)} from ${(c.googleReviewCount ?? 0).toLocaleString("en-US")} ${plural(c.googleReviewCount ?? 0, "review")}`,
      tone: "neutral",
    });
  }
  if (c.distanceMiles !== null) why.push({ key: "distance", text: milesText(c.distanceMiles), tone: "neutral" });
  if (c.emergencyService && (ctx.urgent || ctx.wants.includes("emergency"))) {
    why.push({ key: "emergency", text: "Your board says: takes emergency calls", tone: "good" });
  }
  for (const want of ctx.wants) {
    if (want !== "emergency" && c.jobTags.includes(want)) why.push({ key: want, text: SAVED_WANT_TEXT[want], tone: "good" });
  }
  if (c.compliance.coiExpired) why.push({ key: "coi", text: "Certificate expired", tone: "warning" });
  else if (c.compliance.coiCurrent) why.push({ key: "coi", text: "Certificate on file", tone: "good" });
  return why.slice(0, MAX_WHY);
}

export function foundWhy(c: FoundCandidate, ctx: RankContext): Why[] {
  const why: Why[] = [];
  if (isDoNotUse(c)) {
    const reason = c.alreadySaved?.doNotUseReason?.trim();
    why.push({ key: "do_not_use", text: `Your board marked them do not use${reason ? `: ${reason}` : ""}`, tone: "bad" });
  }
  // A search match, not a fact about the business.
  why.push({ key: "trade", text: `Came up for "${tradeLabel(ctx.trade)}"`, tone: "neutral" });
  if (c.rating !== null) {
    const count = c.reviewCount ?? 0;
    why.push({
      key: "rating",
      text: `${c.ratingSource ?? "Google"} ${c.rating.toFixed(1)} from ${count.toLocaleString("en-US")} ${plural(count, "review")}, as listed on ${humanDate(c.ratingAsOf, ctx.todayIso)}`,
      tone: "neutral",
    });
  } else {
    why.push({ key: "rating", text: "No rating found", tone: "neutral" });
  }
  if (c.distanceMiles !== null) why.push({ key: "distance", text: milesText(c.distanceMiles), tone: "neutral" });
  else if (c.cityText?.trim()) why.push({ key: "city", text: c.cityText.trim(), tone: "neutral" });
  if (c.flags.emergencyService === true && (ctx.urgent || ctx.wants.includes("emergency"))) {
    why.push({ key: "emergency", text: "Advertises emergency service on their own site", tone: "good" });
  }
  for (const want of ctx.wants) {
    if (want !== "emergency" && c.flags[FLAG_FOR_WANT[want]] === true) why.push({ key: want, text: FOUND_WANT_TEXT[want], tone: "good" });
  }
  if (c.kind === "web") {
    const host = c.website ? hostOf(c.website) : c.sourceUrls[0] ? hostOf(c.sourceUrls[0]) : null;
    if (host) why.push({ key: "found_on", text: `Found on ${host}`, tone: "neutral" });
  }
  return why.slice(0, MAX_WHY);
}

const savedReviewCount = (c: SavedCandidate) => (c.boardReviews.count > 0 ? c.boardReviews.count : (c.googleReviewCount ?? 0));

/** Highest score first; ties on more reviews, then name. Do-not-use and archived contractors are never passed in. */
export function rankSaved(c: SavedCandidate[], ctx: RankContext): (SavedCandidate & { score: number; why: Why[] })[] {
  return c
    .map((s) => ({ ...s, score: savedScore(s, ctx), why: savedWhy(s, ctx) }))
    .sort((a, b) => b.score - a.score || savedReviewCount(b) - savedReviewCount(a) || a.name.localeCompare(b.name));
}

/** Highest score first; ties on more reviews, then name. A do-not-use match always sorts last. */
export function rankFound(c: FoundCandidate[], ctx: RankContext): (FoundCandidate & { score: number; why: Why[] })[] {
  return c
    .map((f) => ({ ...f, score: foundScore(f, ctx), why: foundWhy(f, ctx) }))
    .sort((a, b) =>
      Number(isDoNotUse(a)) - Number(isDoNotUse(b))
      || b.score - a.score
      || (b.reviewCount ?? 0) - (a.reviewCount ?? 0)
      || a.name.localeCompare(b.name));
}

function sameBusiness(a: FoundCandidate, b: FoundCandidate): boolean {
  const ha = a.website ? hostOf(a.website) : null;
  const hb = b.website ? hostOf(b.website) : null;
  if (ha && hb && ha === hb) return true;
  const pa = a.phone ? phoneDigits(a.phone) : null;
  const pb = b.phone ? phoneDigits(b.phone) : null;
  if (pa && pb && pa === pb) return true;
  const na = normaliseBusinessName(a.name);
  return na.length > 0 && na === normaliseBusinessName(b.name);
}

/**
 * Merge Google and web results that are the same business (same website
 * host, same phone digits, or names equal after normalising inc/llc/co/&/
 * and/the). Google's record wins; sourceUrls are unioned; flags take the
 * web's verified values; an email, city or snippet only the web found fills
 * Google's empty field. Web results with no Google match follow, in order.
 */
export function mergeFound(google: FoundCandidate[], web: FoundCandidate[]): FoundCandidate[] {
  const merged = google.map((g) => ({ ...g, sourceUrls: [...g.sourceUrls], flags: { ...g.flags } }));
  const extra: FoundCandidate[] = [];
  for (const w of web) {
    const g = merged.find((m) => sameBusiness(m, w));
    if (!g) {
      extra.push(w);
      continue;
    }
    for (const url of w.sourceUrls) if (!g.sourceUrls.includes(url)) g.sourceUrls.push(url);
    for (const key of Object.keys(g.flags) as (keyof FoundCandidate["flags"])[]) {
      if (w.flags[key] !== null) g.flags[key] = w.flags[key];
    }
    g.email ??= w.email;
    g.cityText ??= w.cityText;
    g.snippet ??= w.snippet;
  }
  return [...merged, ...extra];
}
