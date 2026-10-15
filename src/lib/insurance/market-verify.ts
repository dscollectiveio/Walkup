// Marketplace research inputs and the verification of what comes back
// (insurance-spec §7.3; brief decisions 4 and 5). What leaves Walkup is only
// the building's public shape (city, state, ZIP, units, stories, year built,
// construction, coverage types). What comes back is kept only when the search
// actually returned it: an agency or insurer survives only if one of its own
// URLs was in the results and a citation from that URL names it; a phone,
// email, claim or rating survives only if a citation about that company shows
// it. Walkup never shows a model-written description. Pure (sha256 via
// node:crypto).

import { createHash } from "node:crypto";
import { z } from "zod";
import { appearsInCitations, hostOf, isSingleMailbox, normaliseUrl, verifyWebsite, type Citation } from "@/lib/ai/verify";
import { nameSegments } from "@/lib/contractors/web-verify";
import { WAITLIST_STATES } from "@/lib/site-config";
import { COVERAGE_TYPES } from "./coverage";
import { constructionLabel } from "./facts";
import { formatPhone } from "./format";

export const MARKET_LINES = ["property", "general_liability", "directors_officers", "fidelity_crime", "umbrella",
  "flood", "workers_comp", "equipment_breakdown", "cyber", "employment_practices", "earthquake"] as const;
export type MarketLine = (typeof MARKET_LINES)[number];

export const AgencyItem = z.object({
  name: z.string().describe("The agency's name exactly as its own site or a cited listing writes it."),
  website: z.string().nullable().describe("The agency's own website URL, only if it appeared in your search results."),
  city: z.string().nullable(),
  state: z.string().nullable().describe("Two-letter state code."),
  phone: z.string().nullable().describe("General office phone, only if a cited page shows it."),
  email: z.string().nullable().describe("General contact email, only if a cited page shows it."),
  lines: z.array(z.enum(MARKET_LINES)),
  worksWithAssociations: z.boolean(),
  independent: z.boolean().nullable(),
  about: z.string().nullable().describe("One sentence copied word for word from a cited page, or null."),
  sourceUrls: z.array(z.string()),
});
export type AgencyItem = z.infer<typeof AgencyItem>;

export const InsurerItem = z.object({
  name: z.string(),
  website: z.string().nullable(),
  writesAssociations: z.boolean(),
  writesInState: z.boolean().nullable(),
  lines: z.array(z.enum(MARKET_LINES)),
  amBestRating: z.string().nullable().describe("Exactly as written on a cited page, e.g. A+."),
  amBestSourceUrl: z.string().nullable(),
  about: z.string().nullable(),
  sourceUrls: z.array(z.string()),
});
export type InsurerItem = z.infer<typeof InsurerItem>;

/** What the UI needs to know about what was kept and where the quote came from. */
export interface VerifiedExtras {
  key: string;
  aboutSource: string | null;
  verified: { phone: boolean; email: boolean; rating: boolean; about: "quote" | "excerpt" | null };
}
export type VerifiedAgency = AgencyItem & VerifiedExtras;
export type VerifiedInsurer = InsurerItem & VerifiedExtras;

export interface VerifyCtx {
  searchUrls: Set<string>;
  /** normaliseUrlExact of every search URL: needed to accept a directory or social host by exact match. */
  searchUrlsExact?: Set<string>;
  /** normalised -> the search's own spelling of the URL (verifyItems fills it). */
  urlSpelling?: ReadonlyMap<string, string>;
  citations: Citation[];
}

export const ITEM_GUIDANCE =
  "name: as the company's own pages write it. about: a sentence copied exactly from one quoted source of this record, or null. Never write your own description.";

// ---------------------------------------------------------------------------
// Inputs (decision 4)

const STATE_NAMES: Record<string, string> = Object.fromEntries([
  ...WAITLIST_STATES.map((s) => [s.code, s.name] as const),
  ["IL", "Illinois"] as const,
]);

/** "IL" → "Illinois"; unknown codes pass through. */
export function stateNameFor(code: string): string {
  return STATE_NAMES[code.toUpperCase()] ?? code;
}

export interface MarketInputs {
  city: string;
  state: string;
  stateName: string;
  postal_code: string | null;
  units: number;
  stories: number | null;
  year_built: number | null;
  construction: string | null;
  coverages: string[];
}

/**
 * Exactly what may leave Walkup for a search. Null when the city or state is
 * missing (research is unavailable). Extra fields on `association` (its name,
 * street address, money) are ignored by construction.
 */
export function marketInputs(
  association: { city: string | null; state_code: string | null; postal_code?: string | null; stories?: number | null; year_built?: number | null; construction_type?: string | null },
  unitCount: number,
  coverages: string[],
): MarketInputs | null {
  const city = association.city?.trim();
  const state = association.state_code?.trim().toUpperCase();
  if (!city || !state) return null;
  const zip = association.postal_code?.trim().match(/^\d{5}/)?.[0] ?? null;
  const wanted = new Set(coverages);
  const construction = constructionLabel(association.construction_type ?? null);
  return {
    city,
    state,
    stateName: stateNameFor(state),
    postal_code: zip,
    units: unitCount,
    stories: association.stories ?? null,
    year_built: association.year_built ?? null,
    construction: construction ? construction.toLowerCase() : null,
    coverages: COVERAGE_TYPES.filter((c) => wanted.has(c.value) && c.value !== "other").map((c) => c.label),
  };
}

function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** `${kind}:` + sha256 hex of the inputs' stable JSON (key order doesn't matter). */
export function queryKey(kind: string, inputs: MarketInputs): string {
  return `${kind}:${sha256(stableJson(inputs))}`;
}

/** The web_search user_location: no postal code (the ZIP reaches the search only through the task text). */
export function marketUserLocation(inputs: MarketInputs): { city: string; region: string; country: string } {
  return { city: inputs.city, region: inputs.stateName, country: "US" };
}

/** The agencies task (§7.3.2), exact. */
export function agencyTask(i: MarketInputs): string {
  const building = `${i.units}-unit residential condominium${i.stories ? `, ${i.stories} stories` : ""}${i.year_built ? `, built in ${i.year_built}` : ""}${i.construction ? `, ${i.construction} construction` : ""}`;
  return [
    `Find independent insurance agencies or brokers that place insurance for condominium associations near ${i.city}, ${i.state}${i.postal_code ? ` ${i.postal_code}` : ""}. The association is a ${building}. Coverage it carries or is shopping for: ${i.coverages.join(", ")}.`,
    "",
    "For each agency, return: its name exactly as its pages write it; its own website; the city and state it is in; a general office phone number and a general contact email, only if they appear on a page you cite; which of these lines the cited pages say it handles: property, general_liability, directors_officers, fidelity_crime, umbrella, flood, workers_comp, equipment_breakdown, cyber, employment_practices, earthquake; whether a cited page says it insures condominium or community associations; whether a cited page says it is an independent agency or represents several insurance companies; one sentence copied word for word from a cited page that says what it does; and the URLs of the pages you relied on.",
    "",
    "Only include agencies you found on pages in your search results. Prefer agencies whose own pages mention condominium or community associations. Do not include any price, premium, rating or review score. Do not rank them. Return at most 8.",
  ].join("\n");
}

/** The insurers task (§7.3.2), exact. */
export function insurerTask(i: MarketInputs): string {
  return [
    `Find insurance companies that write master policies for small residential condominium associations in ${i.stateName}, and companies that write directors and officers, crime or fidelity, or umbrella coverage for community associations in ${i.stateName}. Context: a ${i.units}-unit condominium in ${i.city}, ${i.state}${i.year_built ? `, built in ${i.year_built}` : ""}${i.construction ? `, ${i.construction} construction` : ""}.`,
    "",
    `For each insurer, return: its name exactly as its pages write it; its own website; whether a cited page says it writes condominium or community association coverage; whether a cited page says it writes in ${i.stateName}; which of these lines the cited pages say it offers for associations: property, general_liability, directors_officers, fidelity_crime, umbrella, flood, workers_comp, equipment_breakdown, cyber, employment_practices, earthquake; its AM Best financial strength rating only if a cited page states it for this company by name, copied exactly (for example A+), and the URL of that page; one sentence copied word for word from a cited page that says what it offers associations; and the URLs of the pages you relied on.`,
    "",
    "Only include insurers you found on pages in your search results. Do not include any price or premium. Do not rank them. Return at most 8.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Verification (decision 5)

const NAME_SUFFIXES = ["insurance agency", "inc", "llc", "co", "company", "corp", "corporation", "agency", "group"]
  .sort((a, b) => b.length - a.length);

/**
 * NFKC, lowercase, "&" → "and", punctuation removed, whitespace collapsed, and
 * trailing "inc", "llc", "co", "company", "corp", "corporation", "agency",
 * "insurance agency", "group" removed (repeatedly: "Acme Insurance Agency,
 * Inc." → "acme").
 */
export function nameKey(s: string): string {
  let k = String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Longest suffix first, one at a time, so the order of the list can't matter.
  for (;;) {
    const suffix = NAME_SUFFIXES.find((x) => k.endsWith(` ${x}`));
    if (!suffix) return k;
    k = k.slice(0, -suffix.length - 1).trim();
  }
}

const containsWords = (hay: string, needle: string) => needle !== "" && ` ${hay} `.includes(` ${needle} `);

/**
 * Stable key for a found item: "host:" + hostOf(website) when the website
 * survived, else "name:" + sha256(nameKey(name)).slice(0, 16). Used by
 * saveFoundContact.
 */
export function itemKey(item: { name: string; website: string | null }): string {
  const host = item.website ? hostOf(item.website) : null;
  return host ? `host:${host}` : `name:${sha256(nameKey(item.name)).slice(0, 16)}`;
}

/** scheme, host and path only: no query string, no fragment, no credentials. */
function plainUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return null;
  }
}

interface Evidence {
  sourceUrls: string[];
  website: string | null;
  cites: Citation[];
  named: Citation[];
  attr: Citation[];
}

/** Steps 1 to 3 shared by both kinds; null drops the item. */
function evidence(item: { name: string; website: string | null; sourceUrls: string[] }, ctx: VerifyCtx): Evidence | null {
  const sourceUrls = [...new Set(item.sourceUrls.filter((u) => typeof u === "string" && ctx.searchUrls.has(normaliseUrl(u))))];
  // The website the model wrote is never kept as written: http(s) only, the search's own spelling of a page
  // it returned (or the bare origin), no query or fragment (REVIEW-2 #3).
  const checked = item.website
    ? verifyWebsite(item.website, {
        searchUrls: ctx.searchUrls,
        searchUrlsExact: ctx.searchUrlsExact ?? new Set(),
        urlSpelling: ctx.urlSpelling,
      })
    : null;
  const website = checked ? plainUrl(checked) : null;
  const own = new Set([...(website ? [website] : []), ...sourceUrls].map(normaliseUrl).filter((u) => ctx.searchUrls.has(u)));
  if (own.size === 0) return null;
  const cites = ctx.citations.filter((c) => own.has(normaliseUrl(c.url)));
  const key = nameKey(item.name);
  const named = cites.filter((c) => containsWords(nameKey(c.citedText), key) || containsWords(nameKey(c.title ?? ""), key));
  if (named.length === 0) return null;
  const siteHost = website ? hostOf(website) : null;
  const site = siteHost ? cites.filter((c) => hostOf(c.url) === siteHost) : [];
  const attr = [...new Set([...named, ...site])];
  return { sourceUrls, website, cites, named, attr };
}

const ASSOCIATIONS_RE = /condo(minium)? associations?|community associations?|homeowners'? associations?|\bHOAs?\b|master polic(y|ies)|common interest/i;
const INDEPENDENT_RE = /independent (insurance )?agen(cy|t)|represent(s|ing)? (several|multiple|many) (insurance )?(companies|carriers)/i;
const LINE_RES: Record<MarketLine, RegExp> = {
  property: /commercial property|master polic(y|ies)|association (property|package)|condominium (property|package)/i,
  general_liability: /general liability/i,
  directors_officers: /directors (and|&) officers|\bD&O\b/i,
  fidelity_crime: /fidelity|employee (theft|dishonesty)|crime (coverage|insurance|policy)/i,
  umbrella: /umbrella|excess liability/i,
  flood: /flood insurance|flood coverage/i,
  workers_comp: /workers'? comp/i,
  equipment_breakdown: /equipment breakdown|boiler (and|&) machinery/i,
  cyber: /cyber (liability|insurance|coverage)/i,
  employment_practices: /employment practices|\bEPLI\b/i,
  earthquake: /earthquake (insurance|coverage)/i,
};
const AM_BEST_ALL_RE = /A\.?\s?M\.?\s?Best/gi;
const RATING_RE = /^(A\+\+|A\+|A-|A|B\+\+|B\+|B-|B|C\+\+|C\+|C-|C|D|E|F|S)$/;
const PERSONAL_EMAIL_RE = /^[a-z]+\.[a-z]+$/i;

const someText = (cites: Citation[], re: RegExp) => cites.some((c) => re.test(c.citedText));

function keepLines(lines: readonly string[], attr: Citation[]): MarketLine[] {
  return [...new Set(lines)].filter((l): l is MarketLine => (MARKET_LINES as readonly string[]).includes(l) && someText(attr, LINE_RES[l as MarketLine]));
}

/** Cut at a word boundary to `max` characters with "…". */
function excerpt(text: string, max = 200): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

/** Step 12: a verbatim `about` from an attributable citation, else an excerpt of the first naming one. */
function verifyAbout(about: string | null, ev: Evidence): { about: string | null; aboutSource: string | null; kind: "quote" | "excerpt" | null } {
  if (about && !about.includes("$")) {
    const src = ev.attr.find((c) => appearsInCitations(about, [c], "text"));
    if (src) return { about: about.trim(), aboutSource: src.url, kind: "quote" };
  }
  const first = ev.named[0];
  if (first && !first.citedText.includes("$") && first.citedText.trim()) {
    return { about: excerpt(first.citedText), aboutSource: first.url, kind: "excerpt" };
  }
  return { about: null, aboutSource: null, kind: null };
}

/** Decision 5 for one agency (§7.3.4). Null drops it. */
export function verifyAgency(item: AgencyItem, ctx: VerifyCtx): VerifiedAgency | null {
  const ev = evidence(item, ctx);
  if (!ev) return null;
  // Phone and email count only from the agency's own website or from the part of a page right after its name
  // (a directory snippet lists the next agency's number too), and an email must be a single plain mailbox.
  const siteHost = ev.website ? hostOf(ev.website) : null;
  const contactCites: Citation[] = [
    ...(siteHost ? ev.cites.filter((c) => hostOf(c.url) === siteHost) : []),
    ...ev.named.flatMap((c) => nameSegments(c.citedText, item.name).map((s) => ({ url: c.url, title: null, citedText: s.text }))),
  ];
  const phone = item.phone && appearsInCitations(item.phone, contactCites, "phone") ? formatPhone(item.phone) : null;
  const local = item.email?.split("@")[0] ?? "";
  const email = item.email && isSingleMailbox(item.email) && appearsInCitations(item.email, contactCites, "email") && !PERSONAL_EMAIL_RE.test(local)
    ? item.email.trim() : null;
  const city = item.city && appearsInCitations(item.city, ev.attr, "text") ? item.city.trim() : null;
  const stateCode = item.state?.trim().toUpperCase() ?? null;
  const state = stateCode && /^[A-Z]{2}$/.test(stateCode) && (city !== null || ev.attr.some((c) => new RegExp(`\\b${stateCode}\\b`).test(c.citedText)))
    ? stateCode : null;
  const about = verifyAbout(item.about, ev);
  const out: AgencyItem = {
    name: item.name.trim(),
    website: ev.website,
    city,
    state,
    phone,
    email,
    lines: keepLines(item.lines, ev.attr),
    worksWithAssociations: item.worksWithAssociations === true && someText(ev.attr, ASSOCIATIONS_RE),
    independent: someText(ev.attr, INDEPENDENT_RE) ? true : null,
    about: about.about,
    sourceUrls: ev.sourceUrls,
  };
  return {
    ...out,
    key: itemKey(out),
    aboutSource: about.aboutSource,
    verified: { phone: phone !== null, email: email !== null, rating: false, about: about.kind },
  };
}

const RATING_CUE_RE = /\b(?:rat(?:ed|es|ing|ings)|financial strength|fsr|affirm(?:ed|s)?|assign(?:ed|s)?|holds?|upgrad(?:ed|es)|downgrad(?:ed|es)|maintain(?:ed|s)?)\b/i;
const AM_BEST_TOKEN = "AMBESTAGENCY";

/**
 * True when one sentence of `text` names the insurer, names AM Best, speaks of a rating and carries
 * `grade` as its own token. The agency's name is masked first, so its "A" is never a grade, and a
 * lone "A" followed by a lower-case word ("A mutual company") is an article, not a grade.
 */
export function ratingStatedFor(text: string, insurerName: string, grade: string): boolean {
  const key = nameKey(insurerName);
  if (!key || !RATING_RE.test(grade)) return false;
  const masked = text.replace(AM_BEST_ALL_RE, ` ${AM_BEST_TOKEN} `).replace(/\s+/g, " ");
  const token = new RegExp(`(^|[^A-Za-z0-9+\\-])${escapeRe(grade)}(?![A-Za-z0-9+\\-])${/^[A-F]$/.test(grade) ? "(?!\\s+[a-z])" : ""}`);
  return masked
    .split(/(?<=[.!?;])\s+/)
    .some((sentence) =>
      sentence.includes(AM_BEST_TOKEN) &&
      RATING_CUE_RE.test(sentence) &&
      containsWords(nameKey(sentence.replace(AM_BEST_TOKEN, " ")), key) &&
      token.test(sentence.replace(AM_BEST_TOKEN, " ")),
    );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Decision 5 for one insurer (§7.3.4). `state` is the association's two-letter code. Null drops it. */
export function verifyInsurer(item: InsurerItem, ctx: VerifyCtx, where: { state: string; stateName: string }): VerifiedInsurer | null {
  const ev = evidence(item, ctx);
  if (!ev) return null;

  const stateRe = new RegExp(`\\b${escapeRe(where.stateName)}\\b`, "i");
  const codeRe = new RegExp(`(,\\s*${escapeRe(where.state)}\\b|\\b${escapeRe(where.state)}\\s+\\d{5}\\b)`);
  const writesInState = ev.attr.some((c) => stateRe.test(c.citedText) || codeRe.test(c.citedText)) ? true : null;

  let amBestRating: string | null = null;
  let amBestSourceUrl: string | null = null;
  const rating = item.amBestRating?.trim() ?? "";
  if (RATING_RE.test(rating) && item.amBestSourceUrl) {
    const src = normaliseUrl(item.amBestSourceUrl);
    // The grade must sit in one sentence that names this insurer and AM Best and speaks of a rating
    // (REVIEW-2 #4); another insurer's grade, or the "A" of "A.M. Best", never counts.
    const hit = ctx.citations.find((c) => normaliseUrl(c.url) === src && ratingStatedFor(c.citedText, item.name, rating));
    if (hit) {
      amBestRating = rating;
      amBestSourceUrl = hit.url;
    }
  }

  const about = verifyAbout(item.about, ev);
  const out: InsurerItem = {
    name: item.name.trim(),
    website: ev.website,
    writesAssociations: item.writesAssociations === true && someText(ev.attr, ASSOCIATIONS_RE),
    writesInState,
    lines: keepLines(item.lines, ev.attr),
    amBestRating,
    amBestSourceUrl,
    about: about.about,
    sourceUrls: ev.sourceUrls,
  };
  return {
    ...out,
    key: itemKey(out),
    aboutSource: about.aboutSource,
    verified: { phone: false, email: false, rating: amBestRating !== null, about: about.kind },
  };
}

/**
 * Step 13: dedupe by key (first wins), drop agencies in another state, keep
 * at most 8, then sort by name so the model's order can't read as a ranking.
 */
export function finalizeMarketItems<T extends { key: string; name: string; state?: string | null }>(items: T[], associationState: string | null): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it.key)) continue;
    if (associationState && it.state && it.state.toUpperCase() !== associationState.toUpperCase()) continue;
    seen.add(it.key);
    out.push(it);
  }
  return out.slice(0, 8).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}
