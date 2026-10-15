// Contractors found by Anthropic web search, checked against what the search
// actually returned (repairs-spec §9.3, brief decision 5). Pure; every rule
// has a unit test (tests/unit/contractor-web-verify.test.ts).
//
// The foundation's verifyItems has already kept only source URLs this search
// returned and checked the name appears in the item's own sources; this file
// adds the contractor rules on top: no lead-generation services, no directory
// as a website, contact details and ratings only from the part of a page that
// is about this business, and "what they offer" only from their own site.

import { z } from "zod";
import {
  appearsInCitations,
  hostOf,
  isSingleMailbox,
  normaliseBusinessName,
  normaliseUrl,
  normaliseUrlExact,
  phoneDigits,
  verifyWebsite,
  type Citation,
} from "@/lib/ai/verify";
import type { JobWant } from "./ranking";

export const webContractorSchema = z.object({
  name: z.string(),
  websiteUrl: z.string().nullable(),
  cityOrArea: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  rating: z.number().nullable(),
  reviewCount: z.number().nullable(),
  ratingSource: z.string().nullable(),
  emergencyService: z.boolean().nullable(),
  mentionsCondoWork: z.boolean().nullable(),
  smallJobsWelcome: z.boolean().nullable(),
  freeEstimates: z.boolean().nullable(),
  snippet: z.string().nullable(),
  sourceUrls: z.array(z.string()),
});
export type WebContractor = z.infer<typeof webContractorSchema>;

/** Lead-generation and referral services: never a business, never a business's website. */
export const LEAD_GEN_HOSTS: string[] = [
  "homeadvisor.com", "angi.com", "angieslist.com", "thumbtack.com", "networx.com", "porch.com",
  "bark.com", "fixr.com", "homeguide.com", "buildzoom.com", "craftjack.com",
];
/** Pages that list many businesses: usable as a source, never as a website, and facts on them count only next to the business's name. */
export const DIRECTORY_HOSTS: string[] = [
  "yelp.com", "bbb.org", "yellowpages.com", "superpages.com", "mapquest.com", "houzz.com", "nextdoor.com",
  "facebook.com", "google.com", "manta.com", "chamberofcommerce.com", "expertise.com",
  "threebestrated.com", "bestprosintown.com", "patch.com", "reddit.com", "linkedin.com",
];

/** True when the host is one of `list` or a subdomain of one. */
export function hostIn(host: string | null, list: string[]): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/^www\./, "");
  return list.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Lowercase, punctuation stripped, inc|llc|co|corp|company|the dropped, spaces collapsed. */
export function normaliseName(name: string): string {
  return normaliseBusinessName(name);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const DROP_RE = "(?:inc|incorporated|llc|co|corp|corporation|company|ltd|the)";

/** A pattern for the name in raw text: its normalised tokens, any punctuation or legal suffix between them. */
function namePattern(name: string): RegExp | null {
  const tokens = normaliseName(name).split(" ").filter(Boolean);
  if (tokens.length === 0 || tokens.join(" ").length < 3) return null;
  // Between tokens: punctuation or spaces, and any legal suffix the normalised name dropped ("Acme Co. Plumbing").
  const gap = `[^\\p{L}\\p{N}]+(?:${DROP_RE}[^\\p{L}\\p{N}]+)*`;
  const body = tokens.map((t) => (t === "and" ? "(?:and|&)" : escapeRe(t))).join(gap);
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}

/** Every index of the name in a text, bounded by non-alphanumerics (case and punctuation ignored). */
export function findNameAll(text: string, name: string): number[] {
  const re = namePattern(name);
  if (!re || !text) return [];
  return [...text.matchAll(re)].map((m) => m.index ?? 0);
}

/** Index of the name in a text, bounded by non-alphanumerics, or -1. */
export function findName(text: string, name: string): number {
  return findNameAll(text, name)[0] ?? -1;
}

const PHONE_RE = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g;

/** The text with every 10-digit phone number blanked out (same length, so indexes still line up). */
function blankPhones(text: string): string {
  return text.replace(PHONE_RE, (m) => (phoneDigits(m) ? " ".repeat(m.length) : m));
}

/**
 * "4.8" matches 4.8 (and 4.80) but not 14.85 or 4.85; a count "123" matches
 * 123 and "1,234" matches 1234 or 1,234, never inside a longer number or a
 * phone number. Returns match indexes.
 */
export function findNumber(text: string, value: number, kind: "rating" | "count"): number[] {
  if (!Number.isFinite(value) || !text) return [];
  let re: RegExp;
  if (kind === "rating") {
    const [whole, frac] = value.toFixed(1).split(".");
    re = new RegExp(`(?<![\\d.])${whole}\\.${frac}0?(?![\\d])`, "g");
  } else {
    if (!Number.isInteger(value) || value < 0) return [];
    const digits = String(value);
    const groups: string[] = [];
    for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
    re = new RegExp(`(?<![\\d,.])${groups.join(",?")}(?![\\d,]*\\d)`, "g");
  }
  const hay = kind === "count" ? blankPhones(text) : text;
  return [...hay.matchAll(re)].map((m) => m.index ?? 0);
}

/** How far after its name a business's details may sit on a page that lists several. */
export const NAME_WINDOW = 200;
const SEPARATORS = /\n\s*\n|…|\.\.\./g;

/**
 * The part of a page "about this business": from each occurrence of its name
 * to 200 characters later, cut at a listing separator (a blank line or an
 * ellipsis) and before the second phone number (a listing carries one), so a
 * neighbouring listing's phone or rating never counts for it.
 */
export function nameSegments(text: string, name: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  for (const i of findNameAll(text, name)) {
    let end = Math.min(text.length, i + NAME_WINDOW);
    const rest = text.slice(i, end);
    for (const m of rest.matchAll(SEPARATORS)) {
      if ((m.index ?? 0) > 0) {
        end = Math.min(end, i + (m.index ?? 0));
        break;
      }
    }
    let phones = 0;
    for (const m of text.slice(i, end).matchAll(PHONE_RE)) {
      if (!phoneDigits(m[0])) continue;
      phones += 1;
      if (phones === 2) {
        end = i + (m.index ?? 0);
        break;
      }
    }
    out.push({ start: i, text: text.slice(i, end) });
  }
  return out;
}

const STAR_CUE = /\b(?:stars?|out of 5|rating|rated)\b|\/\s?5\b|★/i;
const UNIT_AFTER = /^\s?(?:mi|miles?|km|ft|feet|yrs?|years?|%)\b/i;

/**
 * The rating beside a star cue or directly before its review count ("4.8 (123 reviews)"), not "4.5 miles";
 * the count followed within 15 characters by reviews or ratings; the two within 80 characters of each other.
 */
function ratingInSegment(text: string, rating: number, count: number): boolean {
  const len = rating.toFixed(1).length;
  const ratingAt = findNumber(text, rating, "rating").filter((i) => {
    const around = text.slice(Math.max(0, i - 20), i + len + 25);
    const beforeCount = /^0?\s*[(\[,/·|-]?\s*[\d,]+\s*(?:reviews?|ratings?)\b/i.test(text.slice(i + len));
    return (STAR_CUE.test(around) || beforeCount) && !UNIT_AFTER.test(text.slice(i + len));
  });
  const countAt = findNumber(text, count, "count").filter((i) =>
    /^[\d,]+[\s\S]{0,15}?(?:reviews?|ratings?)\b/i.test(text.slice(i, i + 40)),
  );
  return ratingAt.some((r) => countAt.some((c) => Math.abs(r - c) <= 80));
}

/** Names the rater, in these words or the host: "Google" in the passage or on google.com. */
const SOURCE_ALIAS: Record<string, string> = { betterbusinessbureau: "bbb", googlereviews: "google", googlemaps: "google" };
function sourceNamed(source: string, text: string, url: string): boolean {
  const squashed = source.toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = SOURCE_ALIAS[squashed] ?? squashed;
  if (key.length < 3) return false;
  const host = (hostOf(url) ?? "").replace(/[^a-z0-9]/g, "");
  if (host.includes(key)) return true;
  const words = source.trim().split(/\s+/).map(escapeRe).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${words}${key !== squashed ? `|${escapeRe(key)}` : ""})(?![\\p{L}\\p{N}])`, "iu").test(text);
}

/** Trade and place words that don't identify a business on their own. */
const GENERIC_NAME_WORDS = new Set([
  "and", "plumbing", "plumber", "plumbers", "heating", "cooling", "air", "hvac", "roofing", "roofers", "electric", "electrical",
  "electrician", "construction", "contractor", "contractors", "contracting", "services", "service", "repair", "repairs", "home",
  "building", "buildings", "group", "chicago", "illinois", "north", "south", "east", "west", "city", "general", "masonry",
  "painting", "cleaning", "pest", "control", "tree", "lawn", "landscaping", "sewer", "drain", "drains", "doors", "windows",
]);

/** True when every word of the name is a trade or place word: "Plumbing Contractors" names no business. */
export function isGenericName(name: string): boolean {
  const tokens = normaliseName(name).split(" ").filter(Boolean);
  return tokens.length === 0 || tokens.every((t) => GENERIC_NAME_WORDS.has(t));
}

/**
 * True when a distinctive word of the name (3+ characters, not a trade or place word) is a whole label of
 * the host ("acme" in acme.com, acme-plumbing.com) or, for words of 4+ characters, starts a label
 * ("acme" in acmeplumbing.com). Never a substring: "pro" and "ace" sit inside unrelated hosts (REVIEW-2 #22).
 */
export function hostCarriesName(host: string, name: string): boolean {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".").slice(0, -1);
  if (labels.length === 0) return false;
  return normaliseName(name)
    .split(" ")
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length >= 3 && !GENERIC_NAME_WORDS.has(t))
    .some(
      (t) =>
        labels.includes(t) ||
        (t.length >= 4 && labels.some((l) => l.split("-").includes(t) || l.replace(/-/g, "").startsWith(t))),
    );
}

const FLAG_RULES: { key: "emergencyService" | "mentionsCondoWork" | "smallJobsWelcome" | "freeEstimates"; re: RegExp }[] = [
  { key: "emergencyService", re: /emergenc|24\s*(\/|-)?\s*(7|hours?|hrs?)\b|after[- ]hours/i },
  { key: "mentionsCondoWork", re: /\bcondo(minium)?s?\b|\bmulti-?(unit|family)\b|\bapartment (buildings?|complex(es)?)\b|\bhoas?\b|\bproperty manag/i },
  { key: "smallJobsWelcome", re: /no job (is )?too small|small jobs? (are )?welcome|we (do|take) small jobs/i },
  { key: "freeEstimates", re: /\bfree (estimates?|quotes?|inspections?)\b/i },
];

/** "(312) 555-0142" from any 10-digit form. */
export function formatPhone(value: string): string | null {
  const d = phoneDigits(value);
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Cut to 160 characters at a word boundary, with "…". */
export function snippetOf(text: string): string {
  const t = collapse(text);
  if (t.length <= 160) return t;
  const head = t.slice(0, 159);
  const at = head.lastIndexOf(" ");
  return `${(at > 80 ? head.slice(0, at) : head).replace(/[\s,;:.-]+$/, "")}…`;
}

export interface WebVerifyContext {
  searchUrls: Set<string>;
  searchUrlsExact?: Set<string>;
  /** The item's own citations (foundation citationsFor). */
  citations: Citation[];
  urlSpelling?: ReadonlyMap<string, string>;
}

/** §9.3 rules 1 to 10. Null drops the item. */
export function verifyWebContractor(item: WebContractor, ctx: WebVerifyContext): WebContractor | null {
  const name = (item.name ?? "").trim();
  if (!name || name.length > 80) return null;
  // A name made only of trade and place words ("Plumbing Contractors") is the heading of a list, not a business.
  if (isGenericName(name)) return null;

  // 1. Sources this search returned, no lead-generation services.
  const sourceUrls: string[] = [];
  const seen = new Set<string>();
  for (const u of item.sourceUrls ?? []) {
    if (typeof u !== "string") continue;
    const host = hostOf(u);
    if (!host || hostIn(host, LEAD_GEN_HOSTS)) continue;
    const key = normaliseUrl(u);
    const known = ctx.searchUrls.has(key) || (ctx.searchUrlsExact?.has(normaliseUrlExact(u)) ?? false);
    if (!known || seen.has(key)) continue;
    seen.add(key);
    sourceUrls.push(u);
  }
  // 3. Nothing returned by the search backs this item.
  if (sourceUrls.length === 0) return null;
  const sourceKeys = new Set(sourceUrls.map(normaliseUrl));

  // 2. The business's own website: not a directory or lead-gen host, returned by
  //    the search, and named on a cited page from that host.
  let website: string | null = null;
  let websiteHost: string | null = null;
  if (item.websiteUrl) {
    const raw = item.websiteUrl.trim();
    const host = hostOf(raw);
    const httpish = /^https?:\/\//i.test(raw);
    if (httpish && host && !hostIn(host, LEAD_GEN_HOSTS) && !hostIn(host, DIRECTORY_HOSTS)) {
      const kept = verifyWebsite(raw, {
        searchUrls: ctx.searchUrls,
        searchUrlsExact: ctx.searchUrlsExact ?? new Set(),
        urlSpelling: ctx.urlSpelling,
      });
      const fromHost = ctx.citations.filter((c) => hostOf(c.url) === host);
      const namedThere = fromHost.some((c) => findName(`${c.citedText} ${c.title ?? ""}`, name) >= 0);
      // An article that mentions the business names it too; its own site carries
      // the name in the host or in a page title.
      const looksOwn = hostCarriesName(host, name) || fromHost.some((c) => c.title !== null && findName(c.title, name) >= 0);
      if (kept && namedThere && looksOwn) {
        const u = new URL(kept);
        const path = u.pathname.replace(/\/+$/, "");
        website = `https://${host}${path || "/"}`;
        websiteHost = host;
      }
    }
  }

  const relevant = ctx.citations.filter(
    (c) => sourceKeys.has(normaliseUrl(c.url)) || (websiteHost !== null && hostOf(c.url) === websiteHost),
  );

  // 4. The name must be on a page this item cites.
  if (!relevant.some((c) => findName(`${c.citedText} ${c.title ?? ""}`, name) >= 0)) return null;

  // 5.
  const ownSite = websiteHost ? relevant.filter((c) => hostOf(c.url) === websiteHost) : [];
  const nameCitations = relevant.filter((c) => findName(c.citedText, name) >= 0);
  const segments = nameCitations.flatMap((c) => nameSegments(c.citedText, name).map((s) => s.text));

  // 6. Phone and email: on their own site, or next to their name on one page.
  let phone: string | null = null;
  if (item.phone) {
    const want = phoneDigits(item.phone);
    const onOwnSite = appearsInCitations(item.phone, ownSite, "phone");
    const nextToName = want !== null && segments.some((s) => [...s.matchAll(PHONE_RE)].some((m) => phoneDigits(m[0]) === want));
    if (onOwnSite || nextToName) phone = formatPhone(item.phone);
  }
  let email: string | null = null;
  if (item.email) {
    const value = item.email.trim();
    const domain = value.split("@")[1]?.toLowerCase() ?? "";
    // One plain mailbox: "info@acme.com?bcc=x@y.example" is not an address (REVIEW-2 #6).
    const okDomain = isSingleMailbox(value) && Boolean(domain) && !hostIn(domain, LEAD_GEN_HOSTS) && !hostIn(domain, DIRECTORY_HOSTS);
    const asCitation = (s: string): Citation => ({ url: "", title: null, citedText: s });
    if (okDomain && (appearsInCitations(value, ownSite, "email") || appearsInCitations(value, segments.map(asCitation), "email"))) {
      email = value;
    }
  }

  // 7. Rating, count and source together, from one listing next to the name. The count must be followed by
  //    "reviews" or "ratings", the rating must carry a star or "out of 5" cue, the source must be named in that
  //    passage or be the page's own host, and a rating printed on the contractor's own site is theirs, not a
  //    review site's, so it is never kept as one (REVIEW-2 #5).
  let rating: number | null = null;
  let reviewCount: number | null = null;
  let ratingSource: string | null = null;
  const source = item.ratingSource?.trim() ?? "";
  if (
    typeof item.rating === "number" && item.rating >= 0 && item.rating <= 5 &&
    typeof item.reviewCount === "number" && Number.isInteger(item.reviewCount) && item.reviewCount >= 1 &&
    source && source.length <= 30
  ) {
    const together = nameCitations
      .filter((c) => websiteHost === null || hostOf(c.url) !== websiteHost)
      .some((c) =>
        nameSegments(c.citedText, name).some(
          (seg) => ratingInSegment(seg.text, item.rating!, item.reviewCount!) && sourceNamed(source, seg.text, c.url),
        ),
      );
    if (together) {
      rating = item.rating;
      reviewCount = item.reviewCount;
      ratingSource = source;
    }
  }

  // 8. What they offer: only from their own site.
  const flags = Object.fromEntries(
    FLAG_RULES.map(({ key, re }) => [key, ownSite.some((c) => re.test(c.citedText)) ? true : null]),
  ) as Pick<WebContractor, "emergencyService" | "mentionsCondoWork" | "smallJobsWelcome" | "freeEstimates">;

  // 9. Where they're based, when a cited passage says so.
  const city = item.cityOrArea?.trim() ?? "";
  const cityOrArea = city && city.length <= 60 && appearsInCitations(city, [...ownSite, ...nameCitations], "text") ? city : null;

  // 10. A quote from their site (else from a page naming them), never model-written.
  const quoteFrom = ownSite[0] ?? nameCitations[0] ?? null;
  const snippet = quoteFrom ? snippetOf(quoteFrom.citedText) || null : null;

  return {
    name,
    websiteUrl: website,
    cityOrArea,
    phone,
    email,
    rating,
    reviewCount,
    ratingSource,
    ...flags,
    snippet,
    sourceUrls,
  };
}

// ---------------------------------------------------------------------------
// The research task (§9.3): only Walkup's own words and the building's area.
// ---------------------------------------------------------------------------

const WANT_WORDS: Record<JobWant, string> = {
  emergency: "offer emergency or after-hours service",
  condo_work: "work on condominium or multi-unit buildings",
  small_jobs: "take small jobs",
  free_estimates: "give free estimates",
};

function joinAnd(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export const WEB_ITEM_GUIDANCE =
  "websiteUrl is the business's own site only. Every phone, email and rating must appear in a quoted passage that is about this business. The four true/false facts come only from the business's own site.";

export function webSearchTask(opts: {
  tradeLabel: string; phrase: string; wants: JobWant[]; city: string | null; state: string | null; postalCode: string | null;
}): string {
  const where = [opts.city, [opts.state, opts.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const lines = [
    `Find up to 8 local businesses that do ${opts.tradeLabel.toLowerCase()} work${opts.phrase ? ` (specifically: ${opts.phrase})` : ""} for residential buildings in or near ${where}.`,
  ];
  if (opts.wants.length) lines.push(`Prefer businesses whose own website says they ${joinAnd(opts.wants.map((w) => WANT_WORDS[w]))}.`);
  lines.push(
    "",
    "For each business, report:",
    "- name: the business name as the business itself writes it.",
    "- websiteUrl: the business's own website if you found it, not a directory, review site, article or listing page. Otherwise null.",
    "- cityOrArea: the city or neighbourhood the business says it is based in, only if a page you cite shows it. Otherwise null.",
    "- phone and email: only if they appear on a page you cite, next to the business's name or on its own website. Otherwise null.",
    '- rating and reviewCount: only if one page you cite shows both for this business, with ratingSource naming the site that shows them (for example "Google", "Yelp" or "BBB"). Otherwise all three null.',
    "- emergencyService, mentionsCondoWork, smallJobsWelcome, freeEstimates: true only if the business's own website, in a passage you cite, says so. Otherwise null.",
    "- snippet: always null.",
    "- sourceUrls: every page you used for this business.",
    "",
    "Only include businesses that appear in your search results. A page that lists many businesses is a source for each of them, but take a business's details only from the part of the page about that business. Do not list lead-generation or referral services (such as HomeAdvisor, Angi, Thumbtack, Networx or Porch) as businesses. Do not guess at any detail.",
  );
  return lines.join("\n");
}
