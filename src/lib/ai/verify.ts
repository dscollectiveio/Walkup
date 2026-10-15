import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { REDACTION_MARKER, redactTaxIds } from "@/lib/documents/redact";

/**
 * Brief decision 5 in code: anti-fabrication for web research.
 *
 * webResearch() runs verifyItems() on everything the model structured before
 * an area's own `verify` sees it, so an area with a weak check still can't
 * show a business no search returned, a contact detail cited for a different
 * business, or a model-written description. Pure (types only from the SDK),
 * so the rules are tested directly.
 */

export interface Citation { url: string; title: string | null; citedText: string }

const ALNUM = /[\p{L}\p{N}]/u;
const isAlnum = (ch: string | undefined) => ch !== undefined && ALNUM.test(ch);

function parseUrl(url: string): URL | null {
  try {
    return new URL(url.trim());
  } catch {
    return null;
  }
}

function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/** host + path, lowercase, no scheme, no "www.", no query, no hash, no trailing slash. Invalid input: trimmed lowercase. */
export function normaliseUrl(url: string): string {
  const u = parseUrl(url);
  if (!u || !u.hostname) return url.trim().toLowerCase();
  const host = stripWww(u.hostname) + (u.port ? `:${u.port}` : "");
  const path = u.pathname.replace(/\/+$/, "");
  return `${host}${path}`.toLowerCase();
}

/** normaliseUrl plus the query string with its parameters sorted; used for exact matches on aggregator hosts. */
export function normaliseUrlExact(url: string): string {
  const u = parseUrl(url);
  if (!u || !u.hostname) return url.trim().toLowerCase();
  const params = [...u.searchParams.entries()].sort(([a, av], [b, bv]) =>
    a === b ? av.localeCompare(bv) : a.localeCompare(b),
  );
  const query = new URLSearchParams(params).toString();
  return `${normaliseUrl(url)}${query ? `?${query.toLowerCase()}` : ""}`;
}

/** Lowercase host without "www.", or null for an unparsable URL. */
export function hostOf(url: string): string | null {
  const u = parseUrl(url);
  return u && u.hostname ? stripWww(u.hostname) : null;
}

/**
 * Directory, review and social hosts. On these a URL is accepted only by an exact match
 * (normaliseUrlExact) with a URL the search returned, never by host, because they appear in
 * almost every search. Subdomains included (m.facebook.com, www.yelp.com).
 */
export const AGGREGATOR_HOSTS: readonly string[] = [
  "yelp.com", "angi.com", "angieslist.com", "bbb.org", "facebook.com", "google.com",
  "goo.gl", "mapquest.com", "yellowpages.com", "nextdoor.com", "homeadvisor.com",
  "thumbtack.com", "houzz.com", "instagram.com", "linkedin.com", "manta.com",
  "buildzoom.com", "porch.com", "networx.com", "bark.com", "chamberofcommerce.com",
  // Social, blogging, link-shortener and page-builder hosts: many unrelated people publish on one host,
  // and one search result there must not approve any other path on it (REVIEW-2 #3, #22).
  "x.com", "twitter.com", "youtube.com", "youtu.be", "github.com", "medium.com", "reddit.com",
  "pinterest.com", "tiktok.com", "linktr.ee", "bit.ly", "t.co", "tinyurl.com", "ow.ly", "is.gd",
  "wixsite.com", "fb.com", "fb.me", "g.page", "business.site", "blogspot.com", "wordpress.com",
  "weebly.com", "tumblr.com", "substack.com", "godaddysites.com", "carrd.co", "sites.google.com",
  "vimeo.com", "quora.com", "wikipedia.org", "snapchat.com",
];

export function isAggregatorHost(host: string): boolean {
  const h = stripWww(host);
  return AGGREGATOR_HOSTS.some((a) => h === a || h.endsWith(`.${a}`));
}

/** Host of a normalised URL ("acme.com/about" -> "acme.com"). */
function hostOfNormalised(n: string): string {
  return n.split(/[/?]/)[0];
}

/**
 * True when some search URL has the same host as `url`. Always false for aggregator hosts.
 * Kept for the contract; prefer verifyWebsite().
 */
export function hostInSearch(url: string, searchUrls: Set<string>): boolean {
  const host = hostOf(url);
  if (!host || isAggregatorHost(host)) return false;
  for (const s of searchUrls) {
    if (hostOfNormalised(s) === host) return true;
  }
  return false;
}

export interface UrlEvidence {
  searchUrls: Set<string>;
  searchUrlsExact: Set<string>;
  /** normaliseUrl / normaliseUrlExact -> the URL as the search spelled it. Optional; verifyItems fills it. */
  urlSpelling?: ReadonlyMap<string, string>;
}

/**
 * A business's own website, decision 5. Returns the URL to store, or null.
 *   - not http(s), unparsable, or an aggregator host without an exact match -> null
 *   - normaliseUrl(url) in searchUrls -> the search's own spelling of that URL
 *   - aggregator host with normaliseUrlExact(url) in searchUrlsExact -> that exact URL
 *   - otherwise, only when the claimed path is "" or "/" and hostInSearch() -> the origin
 *     `https://{host}/` (never the model's path)
 */
export function verifyWebsite(url: string, ev: UrlEvidence): string | null {
  const u = parseUrl(url);
  if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) return null;
  const host = hostOf(url);
  if (!host) return null;

  if (isAggregatorHost(host)) {
    const exact = normaliseUrlExact(url);
    if (!ev.searchUrlsExact.has(exact)) return null;
    return ev.urlSpelling?.get(exact) ?? url.trim();
  }

  const n = normaliseUrl(url);
  if (ev.searchUrls.has(n)) return ev.urlSpelling?.get(n) ?? url.trim();

  if ((u.pathname === "" || u.pathname === "/") && hostInSearch(url, ev.searchUrls)) {
    return `https://${host}/`;
  }
  return null;
}

/**
 * One plain mailbox and nothing else: no "?", "&", ",", ";", spaces, brackets or second "@". An address that
 * carries mailto parameters ("a@b.com?bcc=x@y.example") is not an address (REVIEW-2 #6).
 */
export function isSingleMailbox(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && /^[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/.test(v);
}

const PHONE_RE = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g;

/** Last 10 digits of a phone-shaped string (a leading 1 dropped), or null when it isn't 10 digits. */
export function phoneDigits(value: string): string | null {
  let d = value.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

/** Every phone number in a text, as 10-digit strings. Digits are never joined across numbers. */
export function phonesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PHONE_RE)) {
    const d = phoneDigits(m[0]);
    if (d) out.push(d);
  }
  return out;
}

/** NFKC, curly quotes to straight, whitespace collapsed. */
export function normaliseText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const GRADE_RE = /^[A-F][+-]{0,2}$/;

/** Indices where `value` occurs in `text` with the text-mode boundary rules (both already normalised). */
function textOccurrences(text: string, value: string): { start: number; end: number }[] {
  if (!value) return [];
  const strict = value.length < 3 || GRADE_RE.test(value);
  const hay = strict ? text : text.toLowerCase();
  const needle = strict ? value : value.toLowerCase();
  const out: { start: number; end: number }[] = [];
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    const end = i + needle.length;
    const before = text[i - 1];
    const after = text[end];
    const okBefore = !isAlnum(before) || !isAlnum(needle[0]);
    let okAfter = !isAlnum(after) || !isAlnum(needle[needle.length - 1]);
    if (strict && (after === "+" || after === "-")) okAfter = false;
    if (okBefore && okAfter) out.push({ start: i, end });
    from = i + 1;
  }
  return out;
}

function emailOccurs(text: string, value: string): boolean {
  const hay = text.toLowerCase();
  const needle = value.trim().toLowerCase();
  if (!needle) return false;
  const inside = /[a-z0-9._%+-]/;
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return false;
    const before = hay[i - 1];
    const after = hay[i + needle.length];
    // A full stop that ends the sentence ("write to bob@acme.com.") is not part of the address.
    const afterOk =
      after === undefined ||
      !inside.test(after) ||
      (after === "." && !/[a-z0-9]/.test(hay[i + needle.length + 1] ?? ""));
    if ((before === undefined || !inside.test(before)) && afterOk) return true;
    from = i + 1;
  }
}

/**
 * Decision 5's contact check, run against the citations it is given (verifyItems passes
 * only the item's own).
 *   phone: 10-digit numbers extracted from each cited text; true when one equals the value's.
 *   email: case-insensitive, bounded by characters outside [a-z0-9._%+-].
 *   text:  NFKC, straight quotes, collapsed whitespace; bounded by non-alphanumerics;
 *          case-insensitive, except values under 3 characters or shaped like a letter grade
 *          ("A", "A+", "B++"): then case-sensitive and a following "+" or "-" must match too.
 */
export function appearsInCitations(value: string, citations: Citation[], kind: "phone" | "email" | "text"): boolean {
  if (!value || !value.trim()) return false;
  if (kind === "phone") {
    const want = phoneDigits(value);
    if (!want) return false;
    return citations.some((c) => phonesIn(c.citedText).includes(want));
  }
  if (kind === "email") return citations.some((c) => emailOccurs(c.citedText, value));
  const v = normaliseText(value);
  return citations.some((c) => textOccurrences(normaliseText(c.citedText), v).length > 0);
}

const NAME_DROP = new Set(["inc", "incorporated", "llc", "co", "corp", "corporation", "company", "ltd", "the"]);

/**
 * Lowercase, NFKC, "&" -> "and", punctuation to spaces, drop the tokens
 * inc|incorporated|llc|l l c|co|corp|corporation|company|ltd|the, collapse spaces.
 * "Acme Plumbing, Inc." -> "acme plumbing".
 */
export function normaliseBusinessName(name: string): string {
  const tokens = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "l" && tokens[i + 1] === "l" && tokens[i + 2] === "c") {
      i += 2;
      continue;
    }
    if (!NAME_DROP.has(tokens[i])) out.push(tokens[i]);
  }
  return out.join(" ");
}

/**
 * True when normaliseBusinessName(name) appears as a whole-token sequence in
 * normaliseBusinessName(text) for one of the item's own citations or own result
 * titles. Names shorter than 3 characters after normalising, or longer than 120 raw
 * characters, are false.
 */
export function nameAppears(name: string, citations: Citation[], titles: string[]): boolean {
  if (!name || name.length > 120) return false;
  const n = normaliseBusinessName(name);
  if (n.length < 3) return false;
  const texts = [...citations.map((c) => c.citedText), ...titles];
  return texts.some((t) => ` ${normaliseBusinessName(t)} `.includes(` ${n} `));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labelPattern(label: string, flags = "iu"): RegExp {
  const squashed = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  const body = squashed === "ambest"
    ? "a\\.?\\s*m\\.?\\s*best"
    : escapeRe(label.trim()).replace(/\s+/g, "\\s+");
  // Whole word: a one-letter label must not match inside any other word.
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, flags);
}

/** Words that are not the name of anyone who gives a rating. */
const NOT_A_RATER = new Set(["rating", "ratings", "review", "reviews", "stars", "star", "score", "grade", "rated", "out of"]);

function reviewsPattern(reviews: number): RegExp {
  const plain = String(reviews);
  const grouped = reviews.toLocaleString("en-US");
  const alts = [...new Set([grouped, plain])].map(escapeRe).join("|");
  return new RegExp(`(?<![\\d,])(?:${alts})(?![\\d,])[\\s\\S]{0,15}?review`, "i");
}

const RATING_CUE = /\b(?:stars?|out of 5|rating|ratings|rated|reviews?)\b|\/\s?5\b|★/i;

/** Occurrences of a rating value in a cited text, with the unit and grade rules. */
function ratingOccurrences(text: string, value: string): { start: number; end: number }[] {
  if (GRADE_RE.test(value)) return textOccurrences(text, value);
  const out: { start: number; end: number }[] = [];
  const re = new RegExp(`(?<![\\d.])${escapeRe(value)}(?!\\d|\\.\\d)`, "g");
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const rest = text.slice(end);
    if (/^[\s\S]{0,3}?(?:mi\b|miles\b|km\b|ft\b|%|stars?\s+out\s+of\s+10)/i.test(rest)) continue;
    out.push({ start, end });
  }
  return out;
}

/**
 * A rating is kept only with what makes it meaningful (decisions 5, 6):
 *   value   numeric "4.8" (0..5, one decimal) or a letter grade ("A+", AM Best style)
 *   label   who gave it: "AM Best", "BBB", "Google", "Yelp", or another site name <= 30 chars
 *   reviews optional count
 * Kept when ONE citation contains the value and, within 60 characters of it, the label or
 * (numeric only) the review count followed within 15 characters by "review". Grades always
 * need the label. reviews survives only when found that way; otherwise it becomes null.
 */
export function verifyRating(
  r: { value: string; label: string; reviews: number | null },
  citations: Citation[],
): { value: string; label: string; reviews: number | null } | null {
  const value = (r.value ?? "").trim();
  const label = (r.label ?? "").trim();
  if (!label || label.length > 30) return null;
  // A rating needs a named rater: at least three letters, and not a generic word like "rating".
  if ((label.match(/\p{L}/gu) ?? []).length < 3 || NOT_A_RATER.has(label.toLowerCase())) return null;
  const grade = GRADE_RE.test(value);
  if (!grade) {
    if (!/^\d(?:\.\d)?$/.test(value) || Number(value) > 5) return null;
  }
  const reviews = typeof r.reviews === "number" && Number.isFinite(r.reviews) && r.reviews >= 0
    ? Math.round(r.reviews)
    : null;
  const labelRe = labelPattern(label);
  const labelAll = labelPattern(label, "giu");
  const reviewsRe = reviews === null ? null : reviewsPattern(reviews);

  let kept: { value: string; label: string; reviews: number | null } | null = null;
  for (const c of citations) {
    const text = normaliseText(c.citedText);
    // The rater's own name can contain the grade ("A.M. Best" has an A): blank it before looking for the grade.
    const searchable = grade ? text.replace(labelAll, (m) => " ".repeat(m.length)) : text;
    for (const occ of ratingOccurrences(searchable, value)) {
      const window = text.slice(Math.max(0, occ.start - 60), occ.end + 60);
      // A bare number is a rating only with a rating cue beside it ("4.8 stars", "4.8 out of 5", "rated 4.8").
      const near = text.slice(Math.max(0, occ.start - 20), occ.end + 25);
      const cueOk = grade || RATING_CUE.test(near);
      if (!cueOk) continue;
      const labelOk = labelRe.test(window);
      const reviewsOk = reviewsRe ? reviewsRe.test(window) : false;
      if (!(labelOk || (!grade && reviewsOk))) continue;
      if (reviewsOk) return { value, label, reviews };
      kept ??= { value, label, reviews: null };
    }
  }
  return kept;
}

const MARKETING_RE =
  /(?<![\p{L}\p{N}])(top[\s-]+(?:choice|pick|notch|quality|rated)|lowest\s+prices?|number\s+one|recommended|recommend|cheapest|affordable|guaranteed|guarantee|best)(?![\p{L}\p{N}])|#1(?!\d)/giu;
/** The rating agency's name is not a superlative. */
const AM_BEST_RE = /a\.?\s*m\.?\s*best/gi;

/**
 * Decision 1 for anything the model wrote. Flags (case-insensitive, whole words):
 *   best | top-rated | top rated | top (choice|pick|notch|quality|rated) | #1 | number one |
 *   recommended | recommend | cheapest | affordable | lowest price(s) | guaranteed | guarantee
 * "top floor" passes, and so does "AM Best" (the rating agency). Returns the flagged words
 * in order of appearance, lowercased.
 */
export function lintMarketingCopy(text: string): { ok: boolean; found: string[] } {
  const masked = (text ?? "").replace(AM_BEST_RE, (m) => " ".repeat(m.length));
  const found = [...masked.matchAll(MARKETING_RE)].map((m) => m[0].toLowerCase().replace(/\s+/g, " "));
  return { ok: found.length === 0, found };
}

/**
 * Claims are short statements an area wants to show ("24/7 emergency service"). A claim is
 * kept only when it is a verbatim quote from one of the given citations, is at most 140
 * characters, and passes lintMarketingCopy. Returns { text, url } with the citation it came from.
 */
export function verifyClaims(claims: string[], citations: Citation[]): { text: string; url: string }[] {
  const out: { text: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const raw of claims ?? []) {
    if (typeof raw !== "string") continue;
    const text = raw.trim();
    if (!text || text.length > 140 || seen.has(text.toLowerCase())) continue;
    if (!lintMarketingCopy(text).ok) continue;
    const c = citations.find((x) => appearsInCitations(text, [x], "text"));
    if (!c) continue;
    seen.add(text.toLowerCase());
    out.push({ text, url: c.url });
  }
  return out;
}

const REMOVED = "[removed]";
const DIGIT_WORD = "(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)";
const ADDRESS_RE = new RegExp(
  "\\b\\d{1,6}\\s+(?:(?:n|s|e|w|north|south|east|west)\\.?\\s+)?(?:[a-z0-9'-]+\\s+){1,3}?" +
    "(?:ave|avenue|st|street|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|pl|place|pkwy|parkway|ter|terrace|way|hwy|highway)\\b\\.?",
  "gi",
);

/** Street words that are written both ways ("Ave" and "Avenue"); a stored address matches either. */
const STREET_WORDS: Record<string, string[]> = {
  ave: ["ave", "avenue"], avenue: ["ave", "avenue"], st: ["st", "street"], street: ["st", "street"],
  rd: ["rd", "road"], road: ["rd", "road"], blvd: ["blvd", "boulevard"], boulevard: ["blvd", "boulevard"],
  dr: ["dr", "drive"], drive: ["dr", "drive"], ln: ["ln", "lane"], lane: ["ln", "lane"],
  ct: ["ct", "court"], court: ["ct", "court"], pl: ["pl", "place"], place: ["pl", "place"],
  pkwy: ["pkwy", "parkway"], parkway: ["pkwy", "parkway"], ter: ["ter", "terrace"], terrace: ["ter", "terrace"],
  n: ["n", "north"], north: ["n", "north"], s: ["s", "south"], south: ["s", "south"],
  e: ["e", "east"], east: ["e", "east"], w: ["w", "west"], west: ["w", "west"],
};

function flexiblePhrase(phrase: string): string | null {
  const tokens = phrase.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const parts = tokens.map((t) => {
    const core = t.replace(/[.,]+$/, "");
    if (!core) return null;
    const alts = STREET_WORDS[core.toLowerCase()];
    return alts ? `(?:${alts.join("|")})[.,]?` : `${escapeRe(core)}[.,]?`;
  });
  if (parts.some((p) => p === null)) return null;
  // Punctuation or spaces between words, so "415 W. Oakdale" matches "415 W Oakdale".
  return parts.join("[\\s.,]*\\s*");
}

function replaceWhole(text: string, phrase: string): string {
  const body = flexiblePhrase(phrase);
  if (!body) return text;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
  return text.replace(re, REMOVED);
}

const byLengthDesc = (a: string, b: string) => b.length - a.length;

/**
 * Decision 4: what goes to the search must not carry personal data. In order: tax IDs,
 * emails, URLs, phone numbers, unit references, dollar amounts, the association's
 * addresses and names, the people's names (full names first, then single tokens, skipping
 * `keep`), then grouped numbers and 4+ digit numbers other than years 1800..2100. Each is
 * replaced with "[removed]"; runs merge, whitespace collapses, cut to 2,000 characters.
 * webResearch adds the ZIP itself after scrubbing.
 */
export function scrubWebTask(
  text: string,
  redact: { names: string[]; addresses: string[]; keep?: string[] },
): string {
  let t = redactTaxIds(text ?? "").text.split(REDACTION_MARKER).join(REMOVED);
  t = t.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, REMOVED);
  // "jane at gmail dot com" and "jane [at] gmail [dot] com"
  t = t.replace(/\b[\w.+-]+\s*[\[(]?\s*(?:at|@)\s*[\])]?\s*[\w-]+\s*[\[(]?\s*(?:dot|\.)\s*[\])]?\s*[a-z]{2,}\b/gi, REMOVED);
  t = t.replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, REMOVED);
  t = t.replace(PHONE_RE, REMOVED);
  // A phone number spelled out ("three one two five five five zero one four two"): seven or more digit words in a row.
  t = t.replace(new RegExp(`\\b(?:${DIGIT_WORD}[\\s,.-]+){6,}${DIGIT_WORD}\\b`, "gi"), REMOVED);
  // A street address: number, optional direction, one to three words, a street word ("1900 N Clark St", "415 W Oakdale Avenue").
  t = t.replace(ADDRESS_RE, REMOVED);
  // "1900 N Clark": a number, a direction letter, a capitalised street name, no street word.
  t = t.replace(/\b\d{1,6}\s+[NSEW]\.?\s+[A-Z][a-z]+\b/g, REMOVED);
  // Unit references: the token must hold a digit or be a single letter, so
  // "12 units" and "unit count" (decision 4 allows the unit count) survive.
  t = t.replace(
    /\b(?:unit|apt\.?|apartment|suite|ste\.?)(?:\s*#\s*|\s+)(?=[a-z0-9-]{1,6}\b)(?:[a-z-]*\d[a-z0-9-]*|[a-z])\b|\b(?:unit|apt\.?|apartment|suite|ste\.?)\s+(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b|#\s*[a-z0-9-]{1,6}\b/gi,
    REMOVED,
  );
  t = t.replace(/\$\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|million|thousand)?\b/gi, REMOVED);

  for (const a of [...(redact.addresses ?? [])].filter((s) => s && s.trim().length >= 3).sort(byLengthDesc)) {
    t = replaceWhole(t, a);
  }

  const keep = new Set((redact.keep ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean));
  const names = [...new Set((redact.names ?? []).map((n) => n.trim()).filter((n) => n.length >= 2))]
    .filter((n) => !keep.has(n.toLowerCase()) && n.toLowerCase() !== "removed");
  const full = names.filter((n) => /\s/.test(n)).sort(byLengthDesc);
  const single = names.filter((n) => !/\s/.test(n)).sort(byLengthDesc);
  for (const n of [...full, ...single]) t = replaceWhole(t, n);

  t = t.replace(/\b\d{1,3}(?:,\d{3})+\b/g, REMOVED);
  t = t.replace(/\b\d{4,}\b/g, (m) => {
    const n = Number(m);
    return m.length === 4 && n >= 1800 && n <= 2100 ? m : REMOVED;
  });

  t = t.replace(/\[removed\](?:[\s,;:]*\[removed\])+/g, REMOVED);
  t = t.replace(/\s+/g, " ").trim();
  return t.slice(0, 2_000);
}

export interface Evidence {
  searchUrls: Set<string>;                         // normaliseUrl of every web_search_result.url and citation url
  searchUrlsExact: Set<string>;                    // normaliseUrlExact of the same
  results: { url: string; title: string | null }[]; // unique by normalised url, original spelling, first seen first
  citations: Citation[];
  notes: string;                                   // research text with [n] markers after cited blocks, <= 30,000 chars
  sources: { n: number; url: string; title: string | null; quotes: string[] }[]; // cited first, then other results; <= 60; quotes <= 3 x 300 chars
  searchErrors: string[];                          // web_search_tool_result_error codes seen
}

const MAX_NOTES = 30_000;
const MAX_SOURCES = 60;
const MAX_QUOTES = 3;
const QUOTE_CHARS = 300;

/** Walk every response's content (all pause_turn continuations). */
export function collectEvidence(responses: { content: BetaContentBlock[] }[]): Evidence {
  const searchUrls = new Set<string>();
  const searchUrlsExact = new Set<string>();
  const results: { url: string; title: string | null }[] = [];
  const resultIndex = new Map<string, number>();
  const citations: Citation[] = [];
  const searchErrors: string[] = [];
  const textBlocks: { text: string; citedUrls: string[] }[] = [];

  const addUrl = (url: string) => {
    searchUrls.add(normaliseUrl(url));
    searchUrlsExact.add(normaliseUrlExact(url));
  };

  for (const res of responses) {
    for (const block of res.content ?? []) {
      if (block.type === "web_search_tool_result") {
        if (Array.isArray(block.content)) {
          for (const r of block.content) {
            if (!r?.url) continue;
            addUrl(r.url);
            const n = normaliseUrl(r.url);
            if (!resultIndex.has(n)) {
              resultIndex.set(n, results.length);
              results.push({ url: r.url, title: r.title || null });
            }
          }
        } else if (block.content && "error_code" in block.content) {
          searchErrors.push(block.content.error_code);
        }
      } else if (block.type === "text") {
        const citedUrls: string[] = [];
        for (const c of block.citations ?? []) {
          if (c.type !== "web_search_result_location") continue;
          addUrl(c.url);
          citations.push({ url: c.url, title: c.title ?? null, citedText: c.cited_text ?? "" });
          citedUrls.push(c.url);
        }
        textBlocks.push({ text: block.text, citedUrls });
      }
    }
  }

  // Number sources: cited URLs first (first-cited first), then the other results.
  const order: string[] = [];
  const info = new Map<string, { url: string; title: string | null; quotes: string[] }>();
  const spelling = (url: string) => {
    const i = resultIndex.get(normaliseUrl(url));
    return i === undefined ? { url, title: null } : results[i];
  };
  for (const c of citations) {
    const n = normaliseUrl(c.url);
    let entry = info.get(n);
    if (!entry) {
      const r = spelling(c.url);
      entry = { url: r.url, title: r.title ?? c.title, quotes: [] };
      info.set(n, entry);
      order.push(n);
    }
    const q = c.citedText.trim().slice(0, QUOTE_CHARS);
    if (q && entry.quotes.length < MAX_QUOTES && !entry.quotes.includes(q)) entry.quotes.push(q);
  }
  for (const r of results) {
    const n = normaliseUrl(r.url);
    if (info.has(n)) continue;
    info.set(n, { url: r.url, title: r.title, quotes: [] });
    order.push(n);
  }
  const numberOf = new Map(order.map((n, i) => [n, i + 1]));
  const sources = order.slice(0, MAX_SOURCES).map((n, i) => ({ n: i + 1, ...info.get(n)! }));

  const notes = textBlocks
    .map(({ text, citedUrls }) => {
      const marks = [...new Set(citedUrls.map((u) => numberOf.get(normaliseUrl(u))))]
        .filter((n): n is number => n !== undefined && n <= MAX_SOURCES)
        .map((n) => `[${n}]`)
        .join("");
      return marks ? `${text} ${marks}` : text;
    })
    .join("")
    .trim()
    .slice(0, MAX_NOTES);

  return { searchUrls, searchUrlsExact, results, citations, notes, sources, searchErrors };
}

/**
 * An item's own citations: those whose normalised URL is one of `sourceUrls`, plus those on
 * the same host as a non-aggregator source URL (the business's other pages). Never another
 * item's directory page.
 */
export function citationsFor(sourceUrls: string[], ev: Evidence): Citation[] {
  const own = new Set(sourceUrls.map(normaliseUrl));
  const hosts = new Set(
    sourceUrls
      .map(hostOf)
      .filter((h): h is string => h !== null && !isAggregatorHost(h)),
  );
  return ev.citations.filter((c) => {
    if (own.has(normaliseUrl(c.url))) return true;
    const h = hostOf(c.url);
    return h !== null && hosts.has(h);
  });
}

export interface VerifyContext {
  searchUrls: Set<string>;
  searchUrlsExact: Set<string>;
  citations: Citation[];   // this item's own (citationsFor), never the whole response
  titles: string[];        // titles of this item's own source results
  /** normalised -> search spelling, so verifyWebsite(url, ctx) keeps the search's spelling. */
  urlSpelling?: ReadonlyMap<string, string>;
}

export type Verified<T> = T & {
  /** One entry per kept source URL: the first cited quote from it (<= 300 chars), or null. */
  evidence: { url: string; title: string | null; quote: string | null }[];
};

function looksLikeUrl(s: string): boolean {
  return /^(?:https?:\/\/|www\.)\S+$/i.test(s.trim());
}
function looksLikeEmailValue(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
function looksLikePhone(s: string): boolean {
  return /^[\d\s()+.\-]+$/.test(s.trim()) && s.replace(/\D/g, "").length >= 7;
}

/**
 * Per item, in order (any failure drops the item):
 *   1. name = nameOf(item); a non-empty string <= 120 characters.
 *   2. sourceUrls returned by this search (aggregator hosts by exact match only),
 *      respelled to the search's spelling, deduped. None left -> drop.
 *   3. ctx with the item's own citations and titles.
 *   4. nameAppears(name, ctx.citations, ctx.titles).
 *   5. out = verify({ ...item, sourceUrls: kept }, ctx); null (or a throw) -> drop.
 *   6. out.sourceUrls a non-empty subset of kept.
 *   7. Marketing lint on top-level free-text fields (not the name, URLs, emails, phones):
 *      a flagged string becomes null; flagged entries leave string[] fields.
 *   8. Attach evidence.
 */
export function verifyItems<T extends { sourceUrls: string[] }>(
  items: T[],
  ev: Evidence,
  nameOf: (item: T) => string | null,
  verify: (item: T, ctx: VerifyContext) => T | null,
): Verified<T>[] {
  const spelling = new Map<string, string>();
  const titleOf = new Map<string, string | null>();
  for (const r of ev.results) {
    for (const key of [normaliseUrl(r.url), normaliseUrlExact(r.url)]) {
      if (!spelling.has(key)) spelling.set(key, r.url);
    }
    if (!titleOf.has(normaliseUrl(r.url))) titleOf.set(normaliseUrl(r.url), r.title);
  }
  for (const c of ev.citations) {
    for (const key of [normaliseUrl(c.url), normaliseUrlExact(c.url)]) {
      if (!spelling.has(key)) spelling.set(key, c.url);
    }
    if (!titleOf.get(normaliseUrl(c.url))) titleOf.set(normaliseUrl(c.url), c.title);
  }

  const out: Verified<T>[] = [];
  for (const item of items ?? []) {
    if (!item || typeof item !== "object") continue;

    let name: string | null;
    try {
      name = nameOf(item);
    } catch {
      continue;
    }
    if (typeof name !== "string" || !name.trim() || name.length > 120) continue;

    const kept: string[] = [];
    const keptKeys = new Set<string>();
    for (const u of Array.isArray(item.sourceUrls) ? item.sourceUrls : []) {
      if (typeof u !== "string") continue;
      const host = hostOf(u);
      if (!host) continue;
      const key = isAggregatorHost(host) ? normaliseUrlExact(u) : normaliseUrl(u);
      const set = isAggregatorHost(host) ? ev.searchUrlsExact : ev.searchUrls;
      if (!set.has(key) || keptKeys.has(key)) continue;
      keptKeys.add(key);
      kept.push(spelling.get(key) ?? u.trim());
    }
    if (kept.length === 0) continue;

    const keptNorm = new Set(kept.map(normaliseUrl));
    const citations = citationsFor(kept, ev);
    const titles = [
      ...new Set(
        [...ev.results, ...ev.citations]
          .filter((r) => keptNorm.has(normaliseUrl(r.url)))
          .map((r) => r.title)
          .filter((t): t is string => Boolean(t)),
      ),
    ];
    const ctx: VerifyContext = {
      searchUrls: ev.searchUrls,
      searchUrlsExact: ev.searchUrlsExact,
      citations,
      titles,
      urlSpelling: spelling,
    };

    if (!nameAppears(name, citations, titles)) continue;

    let result: T | null;
    try {
      result = verify({ ...item, sourceUrls: kept }, ctx);
    } catch {
      continue;
    }
    if (!result || !Array.isArray(result.sourceUrls) || result.sourceUrls.length === 0) continue;
    const keptExact = new Set(kept.map(normaliseUrlExact));
    if (!result.sourceUrls.every((u) => typeof u === "string" && keptExact.has(normaliseUrlExact(u)))) continue;

    const linted: Record<string, unknown> = { ...result };
    for (const [key, value] of Object.entries(linted)) {
      if (key === "sourceUrls" || key === "evidence") continue;
      if (typeof value === "string") {
        if (value === name || looksLikeUrl(value) || looksLikeEmailValue(value) || looksLikePhone(value)) continue;
        if (!lintMarketingCopy(value).ok) linted[key] = null;
      } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        linted[key] = (value as string[]).filter(
          (v) => v === name || looksLikeUrl(v) || looksLikeEmailValue(v) || looksLikePhone(v) || lintMarketingCopy(v).ok,
        );
      }
    }

    const evidence = (result.sourceUrls as string[]).map((url) => {
      const n = normaliseUrl(url);
      const quote = ev.citations.find((c) => normaliseUrl(c.url) === n)?.citedText.trim().slice(0, QUOTE_CHARS) ?? null;
      return { url, title: titleOf.get(n) ?? null, quote: quote || null };
    });

    out.push({ ...(linted as T), evidence });
  }
  return out;
}
