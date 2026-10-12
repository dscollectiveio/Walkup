// The pure rules behind the platform-admin page, kept out of actions.ts (a
// "use server" file can only export actions) so they can be unit-tested and
// so the two paths that write a field map — saveFieldMap by hand and
// applySuggestedTemplate from Walkup's registry — go through one validator
// and can't drift apart. Also: how the pages/mirror inputs are read, the
// guards a suggested template must pass before its map is applied (§3.2),
// how an automatic link check is recorded, and the words for a
// tax_parameters row. Nothing here touches the database.

import { CONTRACTOR_KEYS, LEDGER_KEYS, SETTING_KEYS, type FieldKind, type FieldMap, type FieldSource, type MapEntry } from "@/lib/tax/autofill";
import { dateWords } from "@/lib/tax/copy";
import { isOfficialLinkUrl, type LinkKind } from "@/lib/tax/links";
import type { SuggestedTemplate } from "@/lib/tax/suggested";

/** The CHECK on tax_form_templates.form_code (0042). W-9 is never a template. */
export const TEMPLATE_FORM_CODES = ["irs_1120h", "irs_1120", "il_1120", "irs_1099_nec", "irs_1096", "il_sos_annual_report", "other"] as const;

/** The CHECK on tax_form_links.form_code (0048): the templates' codes plus the W-9 boards request. */
export const LINK_FORM_CODES = ["irs_1120h", "irs_1120", "il_1120", "irs_1099_nec", "irs_1096", "il_sos_annual_report", "irs_w9"] as const;

export const LINK_KINDS: readonly LinkKind[] = ["about", "form", "instructions", "file_online", "order_paper", "guidance", "law"];

/** The registry's reading order, the same numbers 0048 seeded. */
export const LINK_SORT_ORDER: Record<LinkKind, number> = {
  about: 10,
  form: 20,
  instructions: 30,
  file_online: 40,
  order_paper: 50,
  guidance: 60,
  law: 70,
};

/**
 * The CHECK on tax_form_templates.source_url and instructions_url, exactly:
 * https, the bare or www host of the three official sites, and a path. Tighter
 * than tax_form_links.url (no other subdomains, no ilga.gov) — a template is
 * fetched from here, a link is merely opened.
 */
export function isOfficialTemplateUrl(raw: string): boolean {
  return /^https:\/\/(www\.)?(irs\.gov|tax\.illinois\.gov|ilsos\.gov)\//.test(raw);
}

// ---------------------------------------------------------------------------
// Field maps
// ---------------------------------------------------------------------------

/** A map entry as it arrives — from the admin's form or from a suggested template — before anything is trusted. */
export interface RawMapEntry {
  label: string;
  section?: string;
  source: string;
  rule: string;
  citation: string;
  kind?: string;
  review?: boolean;
  zeroOk?: boolean;
  hint?: string;
}

const FIELD_KINDS: readonly FieldKind[] = ["money", "text", "date", "checkbox"];

/** What each source may read; null means the rule is free text checked another way. */
const ALLOWED_RULES: Record<FieldSource, readonly string[] | null> = {
  setting: SETTING_KEYS,
  ledger: LEDGER_KEYS,
  contractors: CONTRACTOR_KEYS,
  calculated: null,
  manual: null,
};

/**
 * Every mapped field must name a box that exists on the PDF, carry a plain
 * label and cite the instructions line it comes from, and use a rule the
 * auto-fill understands. One bad entry refuses the whole map — a map is
 * saved whole or not at all, never with the bad lines silently dropped.
 * The optional kind, review, zeroOk and hint are carried through (A4's
 * form page reads them); anything else on the entry is left behind.
 */
export function validateFieldMap(entries: Record<string, RawMapEntry>, names: ReadonlySet<string>): { map: FieldMap } | { error: string } {
  const unmatched = Object.keys(entries).filter((n) => !names.has(n));
  if (unmatched.length > 0) {
    const shown = unmatched.slice(0, 4).join(", ");
    const more = unmatched.length > 4 ? ` and ${unmatched.length - 4} more` : "";
    return { error: `${unmatched.length === 1 ? "A mapped field isn't" : `${unmatched.length} mapped fields aren't`} on this PDF: ${shown}${more}.` };
  }

  const map: FieldMap = {};
  for (const [name, raw] of Object.entries(entries)) {
    const label = raw.label.trim();
    const citation = raw.citation.trim();
    const rule = raw.rule.trim();
    if (!label) return { error: `${name}: give the line a plain label.` };
    if (!citation) return { error: `${name}: cite the instructions line or label this mapping comes from.` };
    if (!(raw.source in ALLOWED_RULES)) return { error: `${name}: unknown source.` };
    const source = raw.source as FieldSource;
    const keys = ALLOWED_RULES[source];
    if (keys && !keys.includes(rule)) return { error: `${name}: “${rule}” isn't a ${source} value Walkup can fill.` };
    if (source === "calculated" && !/^(add|sub|mul|max0)\(/.test(rule)) {
      return { error: `${name}: a calculation must be add(…), sub(…), mul(…) or max0(…) of other fields.` };
    }
    const kind = raw.kind?.trim() || undefined;
    if (kind !== undefined && !FIELD_KINDS.includes(kind as FieldKind)) return { error: `${name}: kind must be money, text, date or checkbox.` };
    if (raw.zeroOk && kind !== "money") return { error: `${name}: “Enter 0” only makes sense on a money line.` };

    const entry: MapEntry = { label, source, rule, citation };
    const section = raw.section?.trim();
    if (section) entry.section = section;
    if (kind) entry.kind = kind as FieldKind;
    if (raw.review) entry.review = true;
    if (raw.zeroOk) entry.zeroOk = true;
    const hint = raw.hint?.trim();
    if (hint) entry.hint = hint;
    map[name] = entry;
  }
  return { map };
}

/**
 * "4, 5, 6" or "4-6" → [4, 5, 6]; empty → null (every page). Pages are
 * 1-based, as the admin counts them in a PDF viewer; the DB CHECK on
 * include_pages wants a non-empty array of numbers ≥ 1, which this guarantees.
 */
export function parseIncludePages(text: string): { pages: number[] | null } | { error: string } {
  const t = text.trim();
  if (!t) return { pages: null };
  const pages = new Set<number>();
  for (const part of t.split(/[\s,;]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)-(\d+)$/);
    const from = range ? Number(range[1]) : /^\d+$/.test(part) ? Number(part) : NaN;
    const to = range ? Number(range[2]) : from;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
      return { error: `Pages to keep: “${part}” isn't a page number. Write them 1-based, like “4, 5, 6” or “4-6”.` };
    }
    for (let p = from; p <= to; p++) pages.add(p);
  }
  return { pages: [...pages].sort((a, b) => a - b) };
}

export function includePagesText(pages: number[] | null | undefined): string {
  return pages && pages.length > 0 ? pages.join(", ") : "";
}

/** One pair per line, "CopyB[0] -> Copy2[0]" (→ and => read the same); empty → no mirroring. */
export function parseMirror(text: string): { mirror: { from: string; to: string }[] } | { error: string } {
  const mirror: { from: string; to: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/\s*(?:->|→|=>)\s*/);
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return { error: `Mirror: write one pair per line as “CopyB[0] -> Copy2[0]”, not “${t}”.` };
    }
    if (parts[0] === parts[1]) return { error: `Mirror: “${parts[0]}” can't mirror itself.` };
    mirror.push({ from: parts[0], to: parts[1] });
  }
  return { mirror };
}

export function mirrorText(mirror: { from: string; to: string }[] | null | undefined): string {
  return (mirror ?? []).map((m) => `${m.from} -> ${m.to}`).join("\n");
}

// ---------------------------------------------------------------------------
// Suggested templates (§3.2)
// ---------------------------------------------------------------------------

export interface InspectedPdf {
  sha: string;
  title: string | null;
  names: ReadonlySet<string>;
}

const shortSha = (sha: string | null) => (sha ? `${sha.slice(0, 12)}…` : "none");

/**
 * Whether a suggested map may be applied to the PDF that was actually
 * fetched. Both the sha256 and the title must equal what the map was
 * authored against — a republished form gets a fresh look by a person,
 * never a map carried over by field name — and every name in the map must
 * be a box on that PDF. Otherwise the template is stored inactive with a
 * note saying why, and no map. Never decides activation: that is always a
 * person's click.
 */
export function suggestionDecision(entry: SuggestedTemplate, pdf: InspectedPdf): { apply: true; map: FieldMap } | { apply: false; note: string } {
  const because =
    pdf.sha !== entry.authoredAgainstSha256 || pdf.title !== entry.expectedTitle
      ? `the PDF at ${entry.sourceUrl} isn't the one the map was written against on ${entry.authoredOn}. ` +
        `Expected the title “${entry.expectedTitle ?? "none"}” and SHA-256 ${shortSha(entry.authoredAgainstSha256)}; ` +
        `got the title “${pdf.title ?? "none"}” and SHA-256 ${shortSha(pdf.sha)}. Probably a republished or next year's form.`
      : null;
  const validated = because ? null : validateFieldMap(entry.fieldMap, pdf.names);
  const reason = because ?? (validated && "error" in validated ? validated.error : null);
  if (reason !== null) {
    return {
      apply: false,
      note:
        `Walkup's suggested map (${entry.key}) was NOT applied: ${reason} ` +
        "The PDF is stored, inactive, with no map — map it by hand against the labeled preview. " +
        "The due rule and filing instructions below came from the suggestion; check them against this revision before activating.",
    };
  }
  return { apply: true, map: (validated as { map: FieldMap }).map };
}

// ---------------------------------------------------------------------------
// Link checks
// ---------------------------------------------------------------------------

export function isIlsosHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "ilsos.gov" || host.endsWith(".ilsos.gov");
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * What "Check all links" records in last_check_status: '200' when the page
 * answered, 'blocked' when the site refused a non-browser (403 anywhere;
 * ilsos.gov also drops the connection outright), else 'error: …'. A link
 * that now redirects off the official sites is an error whatever the status
 * — that is exactly the kind of rot a person should look at. Informational
 * only: a verification is a person's click, never this.
 */
export function classifyLinkCheck(url: string, outcome: { status: number; finalUrl: string } | { failed: string }): string {
  if ("failed" in outcome) return isIlsosHost(url) ? "blocked" : `error: ${outcome.failed.slice(0, 120)}`;
  if (!isOfficialLinkUrl(outcome.finalUrl)) return `error: redirected to ${hostOf(outcome.finalUrl)}`;
  if (outcome.status === 403) return "blocked";
  if (outcome.status >= 200 && outcome.status < 300) return "200";
  return `error: HTTP ${outcome.status}`;
}

// ---------------------------------------------------------------------------
// Rules and thresholds (tax_parameters)
// ---------------------------------------------------------------------------

/** Plain names for the keys 0005 seeded; an unknown key shows as itself. */
const PARAMETER_LABEL: Record<string, string> = {
  form_1120h_rate_condo: "1120-H tax rate (condominium and residential associations)",
  form_1120h_specific_deduction: "1120-H specific deduction",
  form_1120h_income_test: "1120-H income test — share of gross income that must be owner fees",
  form_1120h_expenditure_test: "1120-H expenditure test — share of spending that must be on the building",
  form_1099_nec_threshold: "1099-NEC threshold — payments to one contractor in a calendar year",
};

export function parameterLabel(key: string): string {
  return PARAMETER_LABEL[key] ?? key;
}

/** "30%" for a rate or test share, "$2,000.00" for an amount; the numeric arrives as text from the DB (DECISIONS #20). */
export function parameterValueWords(key: string, numericValue: string | number): string {
  const n = Number(numericValue);
  if (!Number.isFinite(n)) return String(numericValue);
  if (/_rate_|_test$/.test(key)) return `${Number((n * 100).toFixed(4))}%`;
  const cents = Math.round(n * 100);
  const whole = Math.trunc(Math.abs(cents) / 100).toLocaleString("en-US");
  return `${cents < 0 ? "-" : ""}$${whole}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

/** The day before an ISO date, in UTC arithmetic so Chicago's clock never shifts it. */
function dayBefore(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * The period a row applies to, in words. effective_to is exclusive (the
 * half-open range 0001's no-overlap constraint is built on), so a row ending
 * 2026-01-01 reads "through Dec 31, 2025".
 */
export function effectiveWords(effectiveFrom: string, effectiveTo: string | null): string {
  return effectiveTo
    ? `${dateWords(effectiveFrom, "short")} through ${dateWords(dayBefore(effectiveTo), "short")}`
    : `from ${dateWords(effectiveFrom, "short")}`;
}
