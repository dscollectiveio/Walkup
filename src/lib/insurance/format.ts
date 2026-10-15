// Display and arithmetic helpers for insurance figures (insurance-spec §6.5).
// Money arrives as numeric(14,2) text ("2400000.00") and is handled in integer
// cents; percentages arrive as numeric(6,4) fraction text ("0.0200" = 2%) and
// are handled in integer ten-thousandths ("bp4"). Pure.

import { toCents } from "@/lib/money/cents";
import { longDate as datesLongDate } from "@/lib/dates";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * "2400000.00" -> "$2,400,000"; with `cents: true`, or when the value has
 * cents, "$1,255.33". Null, blank or unparsable -> null.
 */
export function formatMoney(text: string | null, opts?: { cents?: boolean }): string | null {
  if (text === null || text === undefined) return null;
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(text).trim());
  if (!m) return null;
  const [, sign, whole, frac = ""] = m;
  const cents = frac.padEnd(2, "0");
  const intPart = groupThousands(whole.replace(/^0+(?=\d)/, ""));
  const showCents = opts?.cents === true || cents !== "00";
  return `${sign}$${intPart}${showCents ? `.${cents}` : ""}`;
}

/** "0.0200" -> 200 (integer ten-thousandths). Throws on anything that isn't a fraction with up to 4 decimals. */
export function bp4FromFraction(fraction: string): number {
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(String(fraction).trim());
  if (!m) throw new Error(`not a fraction: ${JSON.stringify(fraction)}`);
  return Number(m[1]) * 10_000 + Number((m[2] ?? "").padEnd(4, "0"));
}

/** 200 -> "0.0200". */
export function fractionFromBp4(bp4: number): string {
  if (!Number.isSafeInteger(bp4) || bp4 < 0) throw new Error(`not a bp4 value: ${bp4}`);
  return `${Math.floor(bp4 / 10_000)}.${String(bp4 % 10_000).padStart(4, "0")}`;
}

/** "0.0200" -> "2%", "0.0125" -> "1.25%", "1.0000" -> "100%". Null or unparsable -> null. */
export function formatPercent(fraction: string | null): string | null {
  if (fraction === null || fraction === undefined) return null;
  let bp4: number;
  try {
    bp4 = bp4FromFraction(fraction);
  } catch {
    return null;
  }
  // bp4 / 100 is the percent with two decimals.
  const whole = Math.floor(bp4 / 100);
  const dec = String(bp4 % 100).padStart(2, "0").replace(/0+$/, "");
  return `${whole}${dec ? `.${dec}` : ""}%`;
}

/** "2027-03-01" -> "March 1, 2027" (src/lib/dates longDate). */
export function longDate(iso: string): string {
  return datesLongDate(iso);
}

function shortDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return iso;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return iso;
  return `${SHORT_MONTHS[mo - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** "Mar 1, 2026 to Mar 1, 2027". */
export function periodLabel(from: string, to: string): string {
  return `${shortDay(from)} to ${shortDay(to)}`;
}

function usDigits(raw: string): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

/** US 10-digit -> "(312) 555-0100"; anything else trimmed as given; blank -> null. */
export function formatPhone(raw: string): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  // An extension or other trailing text keeps the raw form.
  if (/[a-z]/i.test(t)) return t;
  const d = usDigits(t);
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : t;
}

/** "tel:+13125550100"; null without 10 digits. */
export function telHref(raw: string): string | null {
  const d = usDigits(String(raw ?? "").replace(/\s*(?:x|ext\.?)\s*\d+$/i, ""));
  return d ? `tel:+1${d}` : null;
}

/**
 * cents × (bp4 / 10000), rounded half up, computed with BigInt so values at the
 * numeric(14,2) ceiling (1e14 cents) times 10000 don't pass 2^53. Returns a
 * safe integer (the result itself is ≤ the cents input for bp4 ≤ 10000) or
 * throws if it isn't one.
 */
export function mulCentsBp4(cents: number, bp4: number): number {
  if (!Number.isSafeInteger(cents) || !Number.isSafeInteger(bp4)) throw new Error("mulCentsBp4 needs integers");
  const product = BigInt(cents) * BigInt(bp4);
  const neg = product < BigInt(0);
  const abs = neg ? -product : product;
  const rounded = (abs + BigInt(5_000)) / BigInt(10_000);
  const out = Number(neg ? -rounded : rounded);
  if (!Number.isSafeInteger(out)) throw new Error("mulCentsBp4 result is not a safe integer");
  return out;
}

/** Money text to cents, or null for null/blank/unparsable (toCents throws on junk). */
export function centsOrNull(text: string | null | undefined): number | null {
  if (text === null || text === undefined || String(text).trim() === "") return null;
  try {
    return toCents(String(text));
  } catch {
    return null;
  }
}

/** Fraction text to bp4, or null. */
export function bp4OrNull(text: string | null | undefined): number | null {
  if (text === null || text === undefined || String(text).trim() === "") return null;
  try {
    return bp4FromFraction(String(text));
  } catch {
    return null;
  }
}
