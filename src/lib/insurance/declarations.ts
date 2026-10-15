// Parsers for what a declarations page prints, and the rules for what reading
// may fill in on its own (insurance-spec §6.3). Pure: no model, no database,
// so every rule is tested.
//
// Extraction fills, the user saves. A value is pre-filled only when the model
// was confident, found exactly one reading, and that reading parses cleanly.
// Everything else goes to review with the candidate and the text it came
// from, or stays blank. A limit, deductible, or date is never guessed. A
// quote's candidates are never pre-filled at all (a third party's PDF can
// carry hidden text the board never sees).
//
// The field table lives in fields.ts and the coverage list in coverage.ts;
// the old names are re-exported here so src/lib/documents/pipeline.ts and the
// legacy review screen keep compiling until they move (Integration task I-9).

import {
  COVERAGE_FORM_HELP,
  COVERAGE_FORMS,
  FIELD_DEFS,
  FIELD_KEYS,
  PAYMENT_SCHEDULES,
  POLICY_TYPES,
  type FieldDef,
  type FieldGroup,
  type FieldKind,
} from "./fields";
import { SECTION_KEYS, SECTION_LABEL } from "./coverage";

export { COVERAGE_FORM_HELP, COVERAGE_FORMS, FIELD_DEFS, FIELD_KEYS, PAYMENT_SCHEDULES, POLICY_TYPES };
export type { FieldDef, FieldGroup, FieldKind };

/** Section headings for the field groups, in form order. */
export const GROUP_LABEL: Record<FieldGroup, string> = {
  basics: SECTION_LABEL.basics,
  agent: SECTION_LABEL.agent,
  ...(Object.fromEntries(SECTION_KEYS.map((s) => [s, SECTION_LABEL[s]])) as Record<(typeof SECTION_KEYS)[number], string>),
};

/** The same bar the Document Hub uses for filing (classify.ts). */
export const AUTO_FILL_CONFIDENCE = 0.85;

export interface Candidate {
  value: string;
  page: number | null;
  snippet: string;
  /** Set on every candidate of a quote read (§7.1.6 step 8): never pre-filled. */
  forceReview?: boolean;
}

export interface RawField {
  name: string;
  candidates: Candidate[];
  confidence: number;
}

export type FieldStatus = "high" | "review" | "blank";

/** Where a value came from (insurance_policy_field_sources.source). */
export type FieldSource = "extracted" | "manual" | "quote" | "previous_policy" | "agent_confirmed";

export interface ResolvedField {
  key: string;
  status: FieldStatus;
  /** The parsed value to pre-fill (DB string form): only for "high". */
  value: string | null;
  /** What to show under "Is this right?": only for "review". */
  candidates: Candidate[];
  page: number | null;
  snippet: string | null;
  confidence: number | null;
  reason: string | null;
  /**
   * What "Use this" fills for a review field, when Walkup can offer one.
   * resolveField and fromRecord always set it; optional only so the legacy
   * review screen's hand-built blanks still type-check until it is deleted.
   */
  suggested?: string | null;
  /** Set by fromRecord: the stored provenance of a prefilled value. */
  source?: FieldSource;
}

// ---------------------------------------------------------------------------
// Money

/** numeric(14,2) holds 12 digits before the point. */
const MAX_WHOLE_DIGITS = 12;
const STRICT_MONEY = /^\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

function strictMoneyMatch(raw: string): RegExpExecArray | null {
  return STRICT_MONEY.exec(String(raw ?? "").trim().replace(/^USD\s*/i, ""));
}

/** Strict: "$2,400,000", "2400000", "5,000.00". Not "1M", not "$5k", not ranges. Auto-fill grade. */
export function parseMoney(raw: string): number | null {
  const m = strictMoneyMatch(raw);
  if (!m) return null;
  const whole = m[1].replace(/,/g, "").replace(/^0+(?=\d)/, "");
  if (whole.length > MAX_WHOLE_DIGITS) return null; // over numeric(14,2)
  const n = Number(`${whole}.${(m[2] ?? "").padEnd(2, "0")}`);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** parseMoney as the DB string ("2400000.00"), built from the digits so no float rounding is involved. */
function parseMoneyText(raw: string): string | null {
  const m = strictMoneyMatch(raw);
  if (!m) return null;
  const whole = m[1].replace(/,/g, "").replace(/^0+(?=\d)/, "");
  if (whole.length > MAX_WHOLE_DIGITS) return null; // over numeric(14,2): would fail at save
  return `${whole}.${(m[2] ?? "").padEnd(2, "0")}`;
}

const LOOSE_MONEY =
  /^(?:usd\s*)?\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(million|mil|mm|m|thousand|k)?(?![a-z])/i;

/**
 * Loose, review grade: "$1M", "$1 million", "$2.5M", "$500K", "1,000,000 each
 * occurrence" (first figure). Returns "2500000.00" or null. A range ("1-2M",
 * "1 to 2 million") or a second figure after the first is ambiguous: null.
 */
export function parseMoneyLoose(raw: string): string | null {
  const s = String(raw ?? "").trim();
  const m = LOOSE_MONEY.exec(s);
  if (!m) return null;
  const rest = s.slice(m[0].length);
  if (/\d/.test(rest)) return null;
  // A scale word we do not know ("$1.5 billion", "$2 bn") must not be read as the bare number.
  if (!m[3] && /^\s*(?:b(?:n|il|illion)?|t(?:rn|rillion)?|k|m|mm|mil|million|thousand|hundred|cents?)\b/i.test(rest)) return null;
  const unit = (m[3] ?? "").toLowerCase();
  const exp = unit === "" ? 0 : unit === "k" || unit === "thousand" ? 3 : 6;
  const whole = m[1].replace(/,/g, "");
  const frac = m[2] ?? "";
  // value = whole.frac × 10^exp, in cents = digits × 10^(exp + 2 - frac.length)
  const digits = BigInt(`${whole}${frac}`);
  const shift = exp + 2 - frac.length;
  let cents: bigint;
  if (shift >= 0) {
    cents = digits * BigInt(10) ** BigInt(shift);
  } else {
    const div = BigInt(10) ** BigInt(-shift);
    if (digits % div !== BigInt(0)) return null; // fractions of a cent
    cents = digits / div;
  }
  if (cents > BigInt("99999999999999")) return null; // over numeric(14,2): 12 digits and 2 decimals
  const c = cents.toString().padStart(3, "0");
  return `${c.slice(0, -2)}.${c.slice(-2)}`;
}

// ---------------------------------------------------------------------------
// Percent

/**
 * "2%", "2 %", "2.5%", "0.02" (only when ≤ 1 and written with a decimal point)
 * → "0.0200". "2" alone is ambiguous → null. Over 100%, or finer than a
 * hundredth of a percent → null.
 */
export function parsePercent(raw: string): string | null {
  const s = String(raw ?? "").trim();
  let bp4: number;
  let m = /^(\d{1,3})(?:\.(\d{1,2}))?\s*%$/.exec(s);
  if (m) {
    bp4 = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  } else if ((m = /^(0|1)?\.(\d{1,4})$/.exec(s))) {
    bp4 = Number(m[1] ?? "0") * 10_000 + Number(m[2].padEnd(4, "0"));
  } else {
    return null;
  }
  if (bp4 > 10_000) return null;
  return `${Math.floor(bp4 / 10_000)}.${String(bp4 % 10_000).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Dates

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

function isoIfReal(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * ISO "2026-03-01", US "03/01/2026" / "3/1/2026", "March 1, 2026",
 * "Mar 1, 2026", "Mar. 1 2026", "1 March 2026". Two-digit years stay null
 * (ambiguous), as do impossible dates.
 */
export function parseDate(raw: string): string | null {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) return isoIfReal(Number(match[1]), Number(match[2]), Number(match[3]));
  if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) {
    return isoIfReal(Number(match[3]), Number(match[1]), Number(match[2]));
  }
  if ((match = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/i.exec(s))) {
    const mo = MONTHS[match[1].toLowerCase()];
    return mo ? isoIfReal(Number(match[3]), mo, Number(match[2])) : null;
  }
  if ((match = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?,? (\d{4})$/i.exec(s))) {
    const mo = MONTHS[match[2].toLowerCase()];
    return mo ? isoIfReal(Number(match[3]), mo, Number(match[1])) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Yes / no

const TRUE_WORDS = ["yes", "y", "true", "included", "covered", "applies", "included in policy"];
const FALSE_WORDS = ["no", "n", "false", "excluded", "not covered", "not included", "does not apply", "not applicable"];

/**
 * yes/no/true/false/included/covered/excluded/not covered, plus "not
 * included", "applies", "does not apply", and "waived" (true only for
 * waiver_of_subrogation; elsewhere null, because a waived coinsurance or
 * deductible says nothing about the field).
 */
export function parseBoolean(raw: string, key?: string): boolean | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[.\s]+$/, "").replace(/\s+/g, " ");
  if (s === "waived") return key === "waiver_of_subrogation" ? true : null;
  if (TRUE_WORDS.includes(s)) return true;
  if (FALSE_WORDS.includes(s)) return false;
  return null;
}

/** Dispatch by kind; returns the DB string form ("2400000.00", "0.0200", "true", ISO date, enum value). */
export function parseFieldValue(def: FieldDef, raw: string): string | null {
  switch (def.kind) {
    case "money":
      return parseMoneyText(raw);
    case "percent":
      return parsePercent(raw);
    case "date":
      return parseDate(raw);
    case "boolean": {
      const b = parseBoolean(raw, def.key);
      return b === null ? null : String(b);
    }
    case "enum": {
      const v = String(raw ?? "").trim().toLowerCase();
      return def.options?.some((o) => o.value === v) ? v : null;
    }
    default: {
      const t = String(raw ?? "").trim();
      return t === "" ? null : t;
    }
  }
}

// ---------------------------------------------------------------------------
// Resolution

export const REVIEW_REASONS = {
  twoFigures: "More than one figure appears next to this label.",
  shortForm: "Written in short form. Check the full amount.",
  unclean: "This didn't read as a clean value.",
  fromQuote: "From a quote: check it against the document.",
  unsure: "Walkup wasn't sure about this one.",
} as const;

export function resolveField(def: FieldDef, raw: RawField | undefined): ResolvedField {
  const blank: ResolvedField = {
    key: def.key, status: "blank", value: null, candidates: [], page: null, snippet: null, confidence: null, reason: null,
    suggested: null,
  };
  if (!raw || raw.candidates.length === 0) return blank;

  const confidence = Math.min(1, Math.max(0, Number.isFinite(raw.confidence) ? raw.confidence : 0));
  const parsed = raw.candidates.map((c) => ({ c, v: parseFieldValue(def, c.value) }));
  const distinct = new Set(parsed.map((p) => p.v ?? `unparsed:${p.c.value}`));
  const first = raw.candidates[0];
  const review = (reason: string, suggested: string | null = null): ResolvedField => ({
    key: def.key,
    status: "review",
    value: null,
    candidates: raw.candidates,
    page: first.page,
    snippet: first.snippet,
    confidence,
    reason,
    suggested,
  });

  if (distinct.size > 1) return review(REVIEW_REASONS.twoFigures);
  if (parsed[0].v === null) {
    const loose = def.kind === "money" ? parseMoneyLoose(first.value) : null;
    return loose !== null ? review(REVIEW_REASONS.shortForm, loose) : review(REVIEW_REASONS.unclean);
  }
  if (raw.candidates.some((c) => c.forceReview)) return review(REVIEW_REASONS.fromQuote, parsed[0].v);
  if (confidence < AUTO_FILL_CONFIDENCE) return review(REVIEW_REASONS.unsure, parsed[0].v);
  return {
    key: def.key,
    status: "high",
    value: parsed[0].v,
    candidates: raw.candidates,
    page: first.page,
    snippet: first.snippet,
    confidence,
    reason: null,
    suggested: null,
  };
}

/** One ResolvedField per def, in def order. Fields outside `defs` are never shown. */
export function resolveAll(raw: RawField[], defs: FieldDef[] = FIELD_DEFS): ResolvedField[] {
  const byName = new Map(raw.map((r) => [r.name, r]));
  return defs.map((def) => resolveField(def, byName.get(def.key)));
}

/**
 * A saved policy or quote row as prefilled fields (replaces fromQuote): "start
 * from a quote", "copy last term" and the edit form. A quote row is read
 * through each def's quote column, anything else through `column` (a
 * quote-mode def from fieldsFor already carries the quote column in both).
 * Null values come back blank.
 */
export function fromRecord(row: Record<string, unknown>, defs: FieldDef[], source: FieldSource): ResolvedField[] {
  return defs.map((def) => {
    const column = source === "quote" ? def.quoteColumn : def.column;
    const v = column ? row[column] : null;
    const value =
      v === null || v === undefined ? null
      : typeof v === "boolean" ? String(v)
      : typeof v === "number" ? (def.kind === "money" ? v.toFixed(2) : String(v))
      : String(v).trim() === "" ? null
      : String(v);
    return {
      key: def.key,
      status: value === null ? "blank" : "high",
      value,
      candidates: [],
      page: null,
      snippet: null,
      confidence: null,
      reason: null,
      suggested: null,
      ...(value === null ? {} : { source }),
    };
  });
}

// ---------------------------------------------------------------------------
// Legacy review-screen warnings (src/app/insurance/review, removed in §15 step 6)

export interface Warning {
  key: string;
  text: string;
}

/** Warning chips, each only when the data actually supports it. */
export function policyWarnings(input: {
  values: Record<string, string | null>;
  legalName: string | null;
  renewalReminderDays: number;
  today: Date;
  /** Page where the water deductible would usually be, when known. */
  deductiblesPage: number | null;
}): Warning[] {
  const out: Warning[] = [];
  const v = input.values;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (v.named_insured && input.legalName && norm(v.named_insured) !== norm(input.legalName)) {
    out.push({
      key: "named_insured",
      text: `The named insured (“${v.named_insured}”) doesn't match the association's legal name on file (“${input.legalName}”).`,
    });
  }
  if (v.expires_on) {
    const days = Math.round((new Date(`${v.expires_on}T00:00:00`).getTime() - input.today.getTime()) / 86_400_000);
    if (days >= 0 && days <= input.renewalReminderDays) {
      out.push({ key: "expires_on", text: `This policy renews in ${days} day${days === 1 ? "" : "s"}.` });
    } else if (days < 0) {
      out.push({ key: "expires_on", text: "This policy's end date has already passed." });
    }
  }
  if (!v.coverage_form || v.coverage_form === "unknown") {
    out.push({
      key: "coverage_form",
      text: "Ask your agent whether this is bare walls, single entity, or all-in. It matters for what unit owners need to cover themselves.",
    });
  }
  if ((v.policy_type ?? "property") === "property" && !v.water_damage_deductible) {
    out.push({
      key: "water_damage_deductible",
      text: `Many condo master policies carry a separate, higher deductible for water damage.${
        input.deductiblesPage ? ` Check page ${input.deductiblesPage}.` : " Check the deductibles section."
      }`,
    });
  }
  return out;
}
