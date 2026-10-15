/**
 * Normalisers for imported text (import-spec 4.3). Pure.
 *
 * Money is always a decimal string; no JavaScript number ever stands for an
 * amount (DECISIONS #20). A value that cannot be read is reported as such, never
 * guessed at and never rounded.
 */

import { guessTradeFromText, TRADES } from "@/lib/contractors/trades";

export type DateHint = "mdy" | "dmy" | "ymd" | "auto";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

function validIso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12 || d < 1) return null;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > dim) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function twoDigitYear(y: number, digits: number): number {
  if (digits > 2) return y;
  return y <= 69 ? 2000 + y : 1900 + y;
}

/** Excel's day 1 is 1900-01-01 but it counts a 1900-02-29 that never existed, so day 61 onward is days since 1899-12-30. */
function fromExcelSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 60000) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  const d = new Date(ms);
  return validIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Which order slash dates use, judged over a whole column: day-first only when
 * some value has a first part above 12 and none has a second part above 12.
 */
export function detectDateOrder(values: string[]): "mdy" | "dmy" {
  let firstOver12 = false;
  let secondOver12 = false;
  for (const v of values) {
    const m = /^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})\s*$/.exec(v);
    if (!m) continue;
    if (Number(m[1]) > 12) firstOver12 = true;
    if (Number(m[2]) > 12) secondOver12 = true;
  }
  return firstOver12 && !secondOver12 ? "dmy" : "mdy";
}

export function normalizeDate(text: string, hint: DateHint = "mdy"): { ok: true; iso: string } | { ok: false } {
  const t = text.trim();
  if (!t) return { ok: false };
  const ok = (iso: string | null) => (iso ? ({ ok: true, iso } as const) : ({ ok: false } as const));

  // 2026-02-03, 2026/2/3, 2026.02.03, with an optional time after it.
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(t);
  if (m) return ok(validIso(Number(m[1]), Number(m[2]), Number(m[3])));

  // 20260203
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (m && Number(m[1]) >= MIN_YEAR) return ok(validIso(Number(m[1]), Number(m[2]), Number(m[3])));

  // 2/3/2026, 02/03/26, 3.2.2026, 3-2-2026
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(t);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = twoDigitYear(Number(m[3]), m[3].length);
    let order: "mdy" | "dmy" = hint === "dmy" ? "dmy" : "mdy";
    if (hint === "auto") order = a > 12 ? "dmy" : "mdy";
    return ok(order === "mdy" ? validIso(y, a, b) : validIso(y, b, a));
  }

  // Feb 3, 2026 / February 3 2026 / Feb. 3rd, 2026
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    return mo ? ok(validIso(twoDigitYear(Number(m[3]), m[3].length), mo, Number(m[2]))) : { ok: false };
  }
  // 3 Feb 2026 / 3-Feb-2026 / 03-Feb-26
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/]+([A-Za-z]{3,9})\.?,?[\s\-/]+(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    return mo ? ok(validIso(twoDigitYear(Number(m[3]), m[3].length), mo, Number(m[1]))) : { ok: false };
  }

  // An Excel serial number as text: 46055 or 46055.5
  m = /^(\d{1,5})(?:\.\d+)?$/.exec(t);
  if (m) return ok(fromExcelSerial(Number(m[1])));

  return { ok: false };
}

/** True when the text is a date written out, not just a number that could be an Excel serial. */
export function looksLikeDate(text: string): boolean {
  return /[^0-9.\s]/.test(text) && normalizeDate(text, "auto").ok;
}

/** Shift a plain decimal string left or right without going through a float. */
export function shiftDecimal(text: string, places: number): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return text;
  const [, sign, whole, frac = ""] = m;
  let digits = whole + frac;
  let point = whole.length + places;
  if (point < 0) {
    digits = "0".repeat(-point) + digits;
    point = 0;
  } else if (point > digits.length) {
    digits += "0".repeat(point - digits.length);
  }
  const intPart = digits.slice(0, point).replace(/^0+(?=\d)/, "") || "0";
  const fracPart = digits.slice(point).replace(/0+$/, "");
  const body = fracPart ? `${intPart}.${fracPart}` : intPart;
  return body === "0" ? "0" : `${sign}${body}`;
}

export type MoneyResult = { ok: true; text: string } | { ok: false; message?: string };

export const COMMA_DECIMAL_MESSAGE = "That amount uses a comma for decimals. Change it to 1234.50.";

export function normalizeMoney(text: string): MoneyResult {
  let t = text.replace(/[   ]/g, " ").trim();
  if (!t) return { ok: false };
  if (/\b(CR|DR)\.?$/i.test(t) || /^(CR|DR)\b/i.test(t)) return { ok: false };

  let signs = 0;
  if (/^\(.*\)$/.test(t)) {
    signs += 1;
    t = t.slice(1, -1).trim();
  }
  // A sign may come before or after the dollar sign, or trail the number (123.45-).
  for (let i = 0; i < 2; i++) {
    if (t.startsWith("-") || t.startsWith("\u2212")) {
      signs += 1;
      t = t.slice(1).trim();
    }
    if (t.startsWith("$")) t = t.slice(1).trim();
  }
  if (t.endsWith("-")) {
    signs += 1;
    t = t.slice(0, -1).trim();
  }
  if (signs > 1) return { ok: false };
  const negative = signs === 1;
  // A space is only ever a thousands separator ("1 234.50"); anywhere else it would glue two
  // numbers together ("100 200" is not 100200).
  if (/\s/.test(t)) {
    if (!/^\d{1,3}( \d{3})+(\.\d+)?$/.test(t)) return { ok: false };
    t = t.replace(/ /g, "");
  }
  if (!t) return { ok: false };

  // European 1.234,50 or 12,50
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t) || (/^\d+,\d{1,2}$/.test(t) && !/^\d{1,3},\d{3}$/.test(t))) {
    return { ok: false, message: COMMA_DECIMAL_MESSAGE };
  }
  if (t.includes(",")) {
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return { ok: false };
    t = t.replace(/,/g, "");
  }
  if (/^\.\d{1,2}$/.test(t)) t = `0${t}`;
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return { ok: false };
  const whole = m[1].replace(/^0+(?=\d)/, "");
  const frac = (m[2] ?? "").padEnd(2, "0");
  const body = `${whole}.${frac}`;
  return { ok: true, text: negative && body !== "0.00" ? `-${body}` : body };
}

/** A decimal with up to six places, as typed; the % sign is dropped. Null when it is not one. */
function plainPercent(text: string): string | null {
  const t = text.replace(/\s+/g, "").replace(/%$/, "");
  const m = /^(\d{1,3})(?:\.(\d{1,6}))?$/.exec(t) ?? /^(\d)(?:\.(\d{1,8}))?$/.exec(t);
  return m ? t : null;
}

export type PercentResult =
  | { ok: true; values: (string | null)[]; asFraction: boolean }
  | { ok: false; error: string };

/**
 * Column-level, because "0.25" means a quarter in one file and a quarter of a
 * percent in another. If every filled value is at most 1 and they sum to
 * between 0.99 and 1.01 they are fractions of the whole, so multiply by 100.
 * Values that cannot be read come back as typed (null for empty), so the
 * database can say what is wrong with them.
 */
export function normalizePercent(texts: string[]): PercentResult {
  const parsed = texts.map((t) => {
    const trimmed = t.trim();
    if (!trimmed) return { empty: true as const, plain: null as string | null, text: "" };
    return { empty: false as const, plain: plainPercent(trimmed), text: trimmed };
  });
  const readable = parsed.filter((p) => !p.empty && p.plain !== null);
  const nums = readable.map((p) => Number(p.plain));
  const asFraction =
    nums.length > 0 && nums.every((n) => n > 0 && n <= 1) && Math.abs(nums.reduce((a, b) => a + b, 0) - 1) <= 0.01;
  const small = nums.some((n) => n <= 1);
  const big = nums.some((n) => n > 1);
  if (!asFraction && small && big) {
    const total = nums.reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 0.01) {
      return { ok: false, error: "Some ownership values look like fractions and some like percents." };
    }
  }
  return {
    ok: true,
    asFraction,
    values: parsed.map((p) => {
      if (p.empty) return null;
      if (p.plain === null) return p.text;
      return asFraction ? shiftDecimal(p.plain, 2) : p.plain;
    }),
  };
}

export function normalizePhone(text: string): string {
  return text
    .replace(/[^0-9 +().\-xX]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

export function normalizeEmail(text: string): string {
  let t = text.trim();
  const angled = /<([^<>]+)>/.exec(t);
  if (angled) t = angled[1].trim();
  t = t.replace(/^mailto:/i, "").trim();
  return t.toLowerCase();
}

/**
 * The trade a typed word stands for. A known trade gives its label (what the
 * contractor list shows) and slug (what searches use); anything else is kept
 * as typed, lowercased in the slug.
 */
export function normalizeTrade(text: string): { trade: string; slug: string } | null {
  const t = text.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  const exact = TRADES.find((x) => x.slug === lower || x.label.toLowerCase() === lower);
  if (exact) return { trade: exact.label, slug: exact.slug };
  const guessed = guessTradeFromText(t);
  if (guessed) {
    const trade = TRADES.find((x) => x.slug === guessed);
    if (trade) return { trade: trade.label, slug: trade.slug };
  }
  return { trade: t.slice(0, 60), slug: lower.slice(0, 60) };
}

/** The key for category, fund, payee and unit maps: lower, trimmed, spaces collapsed. */
export function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
