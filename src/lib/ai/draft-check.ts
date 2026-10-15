/**
 * Code-enforced checks on model-written email drafts (brief decisions 5, 8).
 *
 * The prompt tells the model to use only the facts it was given; this file
 * makes sure of it. Anything shaped like money, a date, a phone number or a
 * long reference number that isn't in the facts is turned into a visible
 * "[check: ...]" blank, links the facts didn't contain are removed, and a
 * sentence that commits the board is flagged unless the board decided it.
 * DraftEmail highlights every bracketed blank, so nothing slips through
 * unread. Pure, client-safe.
 */

/** Facts are text: money formatted with src/lib/money before the call (DECISIONS #20), dates with longDate. */
export type DraftFacts = Record<string, string | boolean | null | string[]>;

export interface DraftCheckContext {
  facts: DraftFacts;
  signOff: string;
  recipientName?: string | null;
  purpose: string;
}

function factText(v: DraftFacts[string]): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join("; ");
  return String(v);
}

/** Everything the model was given, as one string. */
export function haystackOf(ctx: DraftCheckContext): string {
  return [
    ...Object.values(ctx.facts ?? {}).map(factText),
    ctx.signOff ?? "",
    ctx.recipientName ?? "",
    ctx.purpose ?? "",
  ].join("\n");
}

const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TRAILING = /[.,;:!?)\]}'"»”’]+$/;

/**
 * Prompt-injection containment (review 1 #11): any URL or email address not present
 * (case-insensitive) in the facts or sign-off is replaced with "[link removed]".
 * Trailing punctuation is not part of the match.
 */
export function stripUnknownLinks(text: string, ctx: DraftCheckContext): string {
  const hay = haystackOf(ctx).toLowerCase();
  const replace = (m: string) => {
    const trail = TRAILING.exec(m)?.[0] ?? "";
    const core = trail ? m.slice(0, -trail.length) : m;
    if (!core) return m;
    return hay.includes(core.toLowerCase()) ? m : `[link removed]${trail}`;
  };
  return text.replace(URL_RE, replace).replace(EMAIL_RE, replace);
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const MONEY_RE = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const US_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/g;
const NAMED_DATE_RE =
  /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/g;
const PHONE_RE = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g;
const NUMBER_TOKEN_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*/g;
const COMMIT_RE =
  /\b(we accept|we are accepting|we're accepting|please proceed|go ahead and|you're hired|you are hired|we recommend|we approve|is approved)\b/gi;
const NAME_RE = /\b[A-Z][a-z'’]+(?:\s+[A-Z][a-z'’]+)+\b/g;

const NAME_ALLOW = ["thank you", "best regards", "kind regards", "condominium association", "board of directors", "illinois"];
/** Ordinary words that open a sentence or a greeting, not a name. */
const LEADING_WORDS = new Set([
  "hi", "hello", "dear", "thanks", "thank", "best", "kind", "warm", "regards", "sincerely", "please",
  "we", "i", "the", "our", "your", "this", "that", "hope", "could", "would", "can", "let", "if",
]);

function moneyKey(s: string): string | null {
  const m = /(\d[\d,]*)(?:\.(\d{1,2}))?/.exec(s.replace(/\s/g, ""));
  if (!m) return null;
  const whole = m[1].replace(/,/g, "").replace(/^0+(?=\d)/, "");
  const cents = (m[2] ?? "").padEnd(2, "0");
  return `${whole}.${cents}`;
}

interface DateKey { m: number; d: number; y?: number }

function monthIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, "");
  return MONTHS.findIndex((m) => m.startsWith(w.slice(0, 3)));
}

function datesIn(text: string): { start: number; end: number; key: DateKey; raw: string }[] {
  const out: { start: number; end: number; key: DateKey; raw: string }[] = [];
  for (const m of text.matchAll(ISO_DATE_RE)) {
    out.push({ start: m.index!, end: m.index! + m[0].length, raw: m[0], key: { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } });
  }
  for (const m of text.matchAll(US_DATE_RE)) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    out.push({ start: m.index!, end: m.index! + m[0].length, raw: m[0], key: { m: mo, d, y } });
  }
  for (const m of text.matchAll(NAMED_DATE_RE)) {
    const mo = monthIndex(m[1]) + 1;
    const d = Number(m[2]);
    if (mo < 1 || d < 1 || d > 31) continue;
    out.push({ start: m.index!, end: m.index! + m[0].length, raw: m[0], key: { m: mo, d, y: m[3] ? Number(m[3]) : undefined } });
  }
  return out;
}

function sameDate(a: DateKey, b: DateKey): boolean {
  if (a.m !== b.m || a.d !== b.d) return false;
  return a.y === undefined || b.y === undefined || a.y === b.y;
}

function phoneKey(s: string): string | null {
  let d = s.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

function isYear(token: string): boolean {
  if (!/^\d{4}$/.test(token)) return false;
  const n = Number(token);
  return n >= 1800 && n <= 2100;
}

interface Hit {
  start: number;
  end: number;
  raw: string;
  /** replace: becomes "[check: raw]"; warnOnly: warning without a change. */
  mode: "replace" | "warnOnly";
  warning: string;
}

const checkWarning = (raw: string) => `Check ${raw}: it isn't in the details Walkup gave the AI.`;

/**
 * Decision 5 for drafts, in code. Haystack = all fact values, the sign-off, the recipient
 * name and the purpose. Money, dates, phone numbers and tokens with 4+ digits (other than
 * years 1800..2100) not found in the haystack become "[check: <original>]" with a warning.
 * Commitment phrases are replaced the same way unless facts.boardDecision is non-empty.
 * Runs of capitalised words that aren't in the haystack are warned about, never replaced.
 * Returns the text and warnings in order of appearance, deduped.
 */
export function checkDraftAgainstFacts(text: string, ctx: DraftCheckContext): { text: string; warnings: string[] } {
  const hay = haystackOf(ctx);
  const hayLower = hay.toLowerCase();
  const hayMoney = new Set<string>();
  for (const m of hay.matchAll(MONEY_RE)) {
    const k = moneyKey(m[0]);
    if (k) hayMoney.add(k);
  }
  for (const m of hay.matchAll(/\d[\d,]*(?:\.\d{1,2})?/g)) {
    const k = moneyKey(m[0]);
    if (k) hayMoney.add(k);
  }
  const hayDates = datesIn(hay).map((d) => d.key);
  const hayPhones = new Set<string>();
  for (const m of hay.matchAll(PHONE_RE)) {
    const k = phoneKey(m[0]);
    if (k) hayPhones.add(k);
  }
  const hayDigits = new Set<string>();
  for (const m of hay.matchAll(NUMBER_TOKEN_RE)) {
    const d = m[0].replace(/\D/g, "");
    if (d) hayDigits.add(d);
  }
  const decided = typeof ctx.facts?.boardDecision === "string" && ctx.facts.boardDecision.trim() !== "";

  // Candidates in priority order; overlaps resolved below (earlier priority wins).
  const candidates: (Hit & { priority: number })[] = [];
  if (!decided) {
    for (const m of text.matchAll(COMMIT_RE)) {
      candidates.push({
        start: m.index!, end: m.index! + m[0].length, raw: m[0], mode: "replace", priority: 0,
        warning: `This draft commits the board ("${m[0]}"). Keep it only if the board decided that.`,
      });
    }
  }
  for (const m of text.matchAll(MONEY_RE)) {
    const k = moneyKey(m[0]);
    if (k && hayMoney.has(k)) {
      candidates.push({ start: m.index!, end: m.index! + m[0].length, raw: m[0], mode: "warnOnly", priority: 1, warning: "" });
      continue;
    }
    candidates.push({ start: m.index!, end: m.index! + m[0].length, raw: m[0], mode: "replace", priority: 1, warning: checkWarning(m[0]) });
  }
  for (const d of datesIn(text)) {
    const ok = hayDates.some((h) => sameDate(d.key, h));
    candidates.push({ start: d.start, end: d.end, raw: d.raw, mode: ok ? "warnOnly" : "replace", priority: 2, warning: ok ? "" : checkWarning(d.raw) });
  }
  for (const m of text.matchAll(PHONE_RE)) {
    const k = phoneKey(m[0]);
    if (!k) continue;
    const ok = hayPhones.has(k);
    candidates.push({ start: m.index!, end: m.index! + m[0].length, raw: m[0], mode: ok ? "warnOnly" : "replace", priority: 3, warning: ok ? "" : checkWarning(m[0]) });
  }
  for (const m of text.matchAll(NUMBER_TOKEN_RE)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 4 || isYear(m[0])) continue;
    const ok = hayDigits.has(digits);
    candidates.push({ start: m.index!, end: m.index! + m[0].length, raw: m[0], mode: ok ? "warnOnly" : "replace", priority: 4, warning: ok ? "" : checkWarning(m[0]) });
  }

  const nameWarnings: { start: number; warning: string }[] = [];
  for (const m of text.matchAll(NAME_RE)) {
    // Split at month and weekday names, and drop greeting/sentence openers.
    const words = m[0].split(/\s+/);
    let offset = m.index!;
    const runs: { words: string[]; start: number }[] = [];
    let current: { words: string[]; start: number } | null = null;
    for (const w of words) {
      const at = text.indexOf(w, offset);
      offset = at + w.length;
      const lw = w.toLowerCase();
      if (MONTHS.includes(lw) || WEEKDAYS.includes(lw)) {
        current = null;
        continue;
      }
      if (!current) {
        if (LEADING_WORDS.has(lw)) continue;
        current = { words: [], start: at };
        runs.push(current);
      }
      current.words.push(w);
    }
    for (const run of runs) {
      if (run.words.length < 2) continue;
      const name = run.words.join(" ");
      const lower = name.toLowerCase();
      if (NAME_ALLOW.includes(lower) || hayLower.includes(lower)) continue;
      nameWarnings.push({ start: run.start, warning: `Check the name "${name}": it isn't in the details Walkup gave the AI.` });
    }
  }

  candidates.sort((a, b) => a.priority - b.priority || a.start - b.start);
  const chosen: Hit[] = [];
  for (const c of candidates) {
    if (chosen.some((h) => c.start < h.end && h.start < c.end)) continue;
    chosen.push(c);
  }
  chosen.sort((a, b) => a.start - b.start);

  let out = "";
  let at = 0;
  const ordered: { start: number; warning: string }[] = [...nameWarnings];
  for (const h of chosen) {
    if (h.mode !== "replace") continue;
    out += text.slice(at, h.start) + `[check: ${h.raw}]`;
    at = h.end;
    ordered.push({ start: h.start, warning: h.warning });
  }
  out += text.slice(at);

  ordered.sort((a, b) => a.start - b.start);
  const warnings = [...new Set(ordered.map((w) => w.warning).filter(Boolean))];
  return { text: out, warnings };
}
